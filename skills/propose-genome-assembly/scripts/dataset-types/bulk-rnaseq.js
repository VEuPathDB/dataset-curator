import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  loadManifest, readInputJson, readCuratedJson, findInputBySuffix, readPresenter, applyOverrides, requireIdentity,
  readDataset, assertValidDataset, datasetElement, PRESENTER_SCHEMA_VERSION, DATASET_SCHEMA_VERSION,
  escapeForCDATA, escapeXml, contactElements, pubmedElements, linkElements, injectorProps, requireBuild, SOURCE_TYPES
} from './_common.js';
import { sampleAnnotationsToStf } from '../lib/stf.js';
import { organismsOf } from '../lib/manifest.js';

export const injectorDefaults = {
  switchStrandsGBrowse: 'false',
  switchStrandsProfiles: 'false',
  graphForceXLabelsHorizontal: 'false',
  hasFishersExactTestData: 'false',
  isEuPathDBSite: 'true',
  jbrowseTracksOnly: 'false',
  graphType: 'bar',
  graphColor: '#336699',
  graphBottomMarginSize: '50',
  graphSampleLabels: '',
  showIntronJunctions: 'true',
  includeInUnifiedJunctions: '',
  isAlignedToAnnotatedGenome: 'true',
  hasMultipleSamples: 'false',
  graphXAxisSamplesDescription: '',
  graphPriorityOrderGrouping: '1000',
  optionalQuestionDescription: '',
  isDESeq: 'false',
  isDEGseq: 'false',
  includeProfileSimilarity: 'false',
  profileTimeShift: ''
};

export const datasetClass = 'rnaSeqExperiment';

/** Graph titles and attributions need these; a presenter without them is not ready to load. */
export const requiredFields = ['shortDisplayName', 'shortAttribution'];

/** A short description of the samples, shown under the expression graphs. */
export const requiredInjectorProps = ['graphXAxisSamplesDescription'];

export const organismFields = { primary: 'referenceOrganismAbbrev', additional: 'additionalOrganismAbbrevs' };

function organismFromRuns(runs, accession) {
  const name = [...new Set(runs.map(r => r.scientific_name).filter(Boolean))][0];
  if (!name) throw new Error(`No scientific_name in any run of ${accession}`);
  return name;
}

/** GEO MINiML summary text is kept as-is: its own XML/HTML entities pass through intentionally. */
function descriptionFrom(runs, miniml) {
  const summary = miniml?.match(/<Summary[^>]*>([\s\S]*?)<\/Summary>/i);
  if (summary) return summary[1].trim();
  const titles = [...new Set(runs.map(r => r.experiment_title).filter(Boolean))];
  return titles[0] || '';
}

function methodologyFrom(runs) {
  const uniq = (key) => [...new Set(runs.map(r => r[key]).filter(Boolean))];
  const parts = [];
  const strategies = uniq('library_strategy'); if (strategies.length) parts.push(`Library strategy: ${strategies.join(', ')}`);
  const layouts = uniq('library_layout'); if (layouts.length) parts.push(`Layout: ${layouts.join(', ')}`);
  const instruments = uniq('instrument_model'); if (instruments.length) parts.push(`Sequencing: ${instruments.join(', ')}`);
  return parts.join('. ');
}

/** The GEO series release date; the platform in the same MINiML has its own. */
function seriesReleaseDate(miniml) {
  const series = miniml?.match(/<Series\b[^>]*>([\s\S]*?)<\/Series>/)?.[1];
  return series?.match(/<Release-Date>\s*(\d{4}-\d{2}-\d{2})\s*<\/Release-Date>/)?.[1];
}

/** Surname as a name token: last word, diacritics dropped, letters and digits only. */
function surnameToken(fullName) {
  const last = (fullName || '').trim().split(/\s+/).pop() || '';
  return last.normalize('NFD').replace(/[^A-Za-z0-9]/g, '');
}

/**
 * Phase 1: default name and version. Either may be undefined, in which case
 * the curator must supply it.
 */
export function deriveIdentity(stagedDir, { primaryContactName } = {}) {
  const version = seriesReleaseDate(findInputBySuffix(stagedDir, '_family.xml'));
  const surname = surnameToken(primaryContactName);
  return { version, name: surname && version ? `${surname}_${version.slice(0, 4)}` : undefined };
}

/** Matches the datasetName of the rnaSeqExperiment datasetLoader in classes.xml. */
const nameFor = (m, organism) => `${organism}_${m.name}_rnaSeq_RSRC`;

function organismOf(m, organism = organismsOf(m)[0]) {
  if (!organismsOf(m).includes(organism)) throw new Error(`${organism} is not an organism of ${m.accession}`);
  return organism;
}

const BIOPROJECT = /^PRJ[NED][A-Z]\d+$/;

/**
 * Phase 1: the presenter record from the proposal's inputs plus curator
 * overrides. Without SRA metadata the organism-based text is left to the curator.
 */
export function derivePresenter(proposalDir, overrides = {}) {
  const m = loadManifest(proposalDir);
  requireIdentity(m, datasetClass);
  const runs = runsOf(proposalDir, m);
  const miniml = findInputBySuffix(proposalDir, '_family.xml');
  const annotations = readCuratedJson(proposalDir, annotationsFile(m));
  const organismName = runs.length ? organismFromRuns(runs, m.accession) : null;
  const title = organismName ? `RNA-Seq analysis of <i>${organismName}</i>` : '';
  const multiple = annotations.samples.length > 1 ? 'true' : 'false';
  const labels = annotations.samples.map((s) => s.label);
  const replicates = new Set(labels).size < labels.length ? 'true' : 'false';
  const xAxis = Object.values(annotations.factors || {}).map((f) => f.displayName).filter(Boolean).join(', ');

  return applyOverrides({
    schemaVersion: PRESENTER_SCHEMA_VERSION,
    displayName: title,
    shortDisplayName: '',
    shortAttribution: '',
    summary: title,
    description: descriptionFrom(runs, miniml),
    methodology: methodologyFrom(runs),
    protocol: '', caveat: '', acknowledgement: '', releasePolicy: '',
    pubmedIds: [],
    links: BIOPROJECT.test(m.accession) ? [{ text: 'NCBI Bioproject', url: `https://www.ncbi.nlm.nih.gov/bioproject/${m.accession}` }] : [],
    history: {},
    injectorProps: { hasMultipleSamples: multiple, isDESeq: replicates, graphXAxisSamplesDescription: xAxis }
  }, overrides);
}

export function presenterNames(proposalDir) {
  const m = loadManifest(proposalDir);
  requireIdentity(m, datasetClass);
  return organismsOf(m).map((organism) => nameFor(m, organism));
}

/** Phase 2: one organism's XML from the manifest and the presenter record only. */
export function renderPresenter(proposalDir, { build, organism } = {}) {
  requireBuild(build);
  const m = loadManifest(proposalDir);
  requireIdentity(m, datasetClass);
  const p = readPresenter(proposalDir, { requiredFields, requiredInjectorProps });
  const contacts = contactElements(m.contacts.additional);
  const pubmeds = pubmedElements(p.pubmedIds);

  return `  <datasetPresenter name="${escapeXml(nameFor(m, organismOf(m, organism)))}"
                    projectName="${m.project}">
    <displayName><![CDATA[${escapeForCDATA(p.displayName)}]]></displayName>
    <shortDisplayName>${escapeXml(p.shortDisplayName)}</shortDisplayName>
    <shortAttribution>${escapeXml(p.shortAttribution)}</shortAttribution>
    <summary><![CDATA[${escapeForCDATA(p.summary)}]]></summary>
    <description><![CDATA[

<b>General Description:</b> ${escapeForCDATA(p.description)}
<br><br><b>Methodology used:</b> ${escapeForCDATA(p.methodology)}

                  ]]></description>
    <protocol>${escapeXml(p.protocol)}</protocol>
    <caveat>${escapeXml(p.caveat)}</caveat>
    <acknowledgement>${escapeXml(p.acknowledgement)}</acknowledgement>
    <releasePolicy>${escapeXml(p.releasePolicy)}</releasePolicy>
    <history buildNumber="${escapeXml(build)}"/>
    <primaryContactId>${escapeXml(m.contacts.primary)}</primaryContactId>
${contacts ? contacts + '\n' : ''}${linkElements(p.links)}
${pubmeds ? pubmeds + '\n' : ''}    <templateInjector className="org.apidb.apicommon.model.datasetInjector.RNASeq">
${injectorProps(injectorDefaults, p.injectorProps)}
    </templateInjector>
  </datasetPresenter>`;
}

// --- dataset record ----------------------------------------------------------

const BOOLEAN_PROPS = ['hasPairedEnds', 'isStrandSpecific', 'alignWithCdsCoordinates', 'fromSRA'];
const STRANDED = { stranded: 'true', unstranded: 'false' };

const sraFile = (m) => `${m.accession}_sra_metadata.json`;
const runsOf = (proposalDir, m) => readInputJson(proposalDir, sraFile(m), { optional: true })?.runs || [];
/** SRA metadata is required for an sra source and optional otherwise. */
const readRuns = (proposalDir, m, source) => (source.type === 'sra' ? readInputJson(proposalDir, sraFile(m)).runs || [] : runsOf(proposalDir, m));
const DEFAULT_SOURCE = { type: 'sra' };

const SAMPLE_ID = /^[A-Za-z0-9_.-]+$/;
const REPLICATE_SUFFIX = /[\s_](replicate[\s_]?|rep|R)\d+$/i;
const FILE_NAME = /^[^/\\\s,]+$/;
const toSampleId = (title) => title.trim().replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/^_+|_+$/g, '');
/** analysisConfig.xml joins label|sampleId, so a label holds no pipe. */
const withoutPipes = (title) => title.replace(/\|/g, ' ').replace(/\s+/g, ' ').trim();

function assertLabel(label, who) {
  if (typeof label === 'string' && label.includes('|')) throw new Error(`Sample ${who}: label "${label}" may not contain |`);
}
const annotationsFile = (m) => `${m.accession}_sample_annotations.json`;

function assertSampleIds(samples) {
  const seen = new Set();
  for (const { sampleId } of samples) {
    if (!SAMPLE_ID.test(sampleId)) throw new Error(`sampleId "${sampleId}" may contain only letters, digits, _, . and -`);
    if (seen.has(sampleId)) throw new Error(`sampleId "${sampleId}" is used twice`);
    seen.add(sampleId);
  }
  return samples;
}

/** Reads not in SRA: the curator names each sample and its files; the source says where they are. */
function normalizeFileSamples(annotations) {
  const listed = new Set();
  return annotations.samples.map((s, i) => {
    const who = s.sampleId ?? s.label ?? `sample #${i + 1}`;
    if (s.runs !== undefined) throw new Error(`Sample ${who}: a server or url source lists files, not runs`);
    assertLabel(s.label, who);
    if (!s.sampleId) throw new Error(`Sample ${who}: reads not in SRA need a sampleId from the curator`);
    if (!Array.isArray(s.files) || !s.files.length) throw new Error(`Sample ${who}: files must list at least one { fastq_1, fastq_2 }`);
    for (const f of s.files) {
      if (!f?.fastq_1) throw new Error(`Sample ${who}: every files entry needs fastq_1`);
      for (const k of ['fastq_1', 'fastq_2']) {
        if (f[k] !== undefined && !(typeof f[k] === 'string' && FILE_NAME.test(f[k]))) {
          throw new Error(`Sample ${who}: ${k} "${f[k]}" must be a bare file name: no directory, spaces or commas`);
        }
        if (f[k] === undefined) continue;
        if (listed.has(f[k])) throw new Error(`Sample ${who}: file "${f[k]}" is listed twice`);
        listed.add(f[k]);
      }
    }
    return { ...s, label: s.label ?? s.sampleId };
  });
}

/**
 * Every sample gets a sampleId the samplesheet, STF and analysisConfig all
 * use, and a label replicates share. For SRA reads each also gets its
 * BioSample; the SRA sample title names the samples without a sampleId when
 * each has a distinct one that no curator sampleId uses; otherwise the
 * BioSample does. The label defaults to the title minus any replicate suffix
 * and pipes, however the id was chosen. A sampleId or label already in the
 * annotations is the curator's, and a curator label with a pipe is refused.
 */
export function normalizeSamples(annotations, runs, { source = DEFAULT_SOURCE } = {}) {
  if (source.type !== 'sra') return { ...annotations, samples: assertSampleIds(normalizeFileSamples(annotations)) };
  const byRun = new Map(runs.map((r) => [r.run_accession, r]));
  const drafts = annotations.samples.map((s, i) => {
    const who = s.sampleId ?? s.label ?? ((s.runs || []).join(',') || `sample #${i + 1}`);
    if (s.files !== undefined) throw new Error(`Sample ${who}: an sra source lists runs, not files`);
    assertLabel(s.label, who);
    if (!(s.runs || []).length) throw new Error(`Sample ${who}: lists no runs`);
    const own = s.runs.map((id) => {
      if (!byRun.has(id)) throw new Error(`Sample ${who}: run ${id} is not in the SRA metadata`);
      return byRun.get(id);
    });
    const distinct = (key) => [...new Set(own.map((r) => r[key]).filter(Boolean))];
    const biosamples = s.biosample ? [s.biosample] : distinct('sample_accession');
    if (biosamples.length !== 1) {
      throw new Error(`Sample ${who}: its runs come from ${biosamples.length} BioSamples (${biosamples.join(', ')}); one sample needs exactly one`);
    }
    const titles = [...new Set(distinct('sample_title').map((t) => t.trim()).filter(Boolean))];
    return { sample: { ...s, biosample: biosamples[0] }, title: titles.length === 1 ? titles[0] : undefined };
  });
  const ids = drafts.map((d) => d.title && toSampleId(d.title));
  const chosen = new Set(drafts.map((d) => d.sample.sampleId).filter(Boolean));
  const unnamed = ids.filter((id, i) => !drafts[i].sample.sampleId);
  const byTitle = unnamed.every(Boolean) && new Set(unnamed).size === unnamed.length && !unnamed.some((id) => chosen.has(id));
  const samples = drafts.map(({ sample, title }, i) => {
    const sampleId = sample.sampleId ?? (byTitle ? ids[i] : sample.biosample);
    const stripped = title ? withoutPipes(title.replace(REPLICATE_SUFFIX, '')) : '';
    return { ...sample, sampleId, label: sample.label ?? (stripped || withoutPipes(title || '') || sampleId) };
  });
  return { ...annotations, samples: assertSampleIds(samples) };
}

/** Phase 1: rewrites the staged sample annotations in normalized form. */
export function normalizeCurated(proposalDir, datasetOverrides = {}) {
  const m = loadManifest(proposalDir);
  const source = datasetOverrides.source ?? DEFAULT_SOURCE;
  if (!SOURCE_TYPES.includes(source?.type)) throw new Error(`source.type must be one of ${SOURCE_TYPES.join(', ')}`);
  const runs = readRuns(proposalDir, m, source);
  const normalized = normalizeSamples(readCuratedJson(proposalDir, annotationsFile(m)), runs, { source });
  writeFileSync(join(proposalDir, 'curated', annotationsFile(m)), JSON.stringify(normalized, null, 2) + '\n');
}

/** rnaSeqExperiment's own rules on top of the classes.xml shape. */
function propErrors(d) {
  const errors = BOOLEAN_PROPS
    .filter((p) => d.props?.[p] !== undefined && !['true', 'false'].includes(d.props[p]))
    .map((p) => `props.${p} must be "true" or "false"`);
  const limit = Number(d.props?.limitNU);
  if (d.props?.limitNU !== undefined && !(Number.isInteger(limit) && limit >= 1 && limit <= 30)) errors.push('props.limitNU must be an integer from 1 to 30');
  if (d.props?.fromSRA !== undefined && d.props.fromSRA !== String(d.source?.type === 'sra')) {
    errors.push(`props.fromSRA must be ${d.source?.type === 'sra'} when source.type is "${d.source?.type}"`);
  }
  return errors;
}

function assertDataset(d, classDef, opts, where) {
  const errors = propErrors(d);
  if (errors.length) throw new Error(`Invalid ${where}:\n  - ${errors.join('\n  - ')}`);
  assertValidDataset(d, classDef, opts, where);
}

const layoutsOf = (runs) => [...new Set(runs.map((r) => (r.library_layout || '').toUpperCase()))];

function pairedFromRuns(runs) {
  const layouts = layoutsOf(runs);
  return layouts.length === 1 && ['PAIRED', 'SINGLE'].includes(layouts[0]) ? String(layouts[0] === 'PAIRED') : undefined;
}

function layoutFromRuns(m, runs, chosen) {
  const paired = chosen.hasPairedEnds ?? pairedFromRuns(runs);
  if (paired === undefined) {
    throw new Error(`Runs of ${m.accession} have library layouts ${layoutsOf(runs).join(', ') || 'none'}; one experiment needs one layout. Set dataset.props.hasPairedEnds in --overrides if that is intended.`);
  }
  return paired;
}

/** hasPairedEnds is dataset-wide and curator-named files show the layout, so no override can change it. */
function layoutFromFiles(m, annotations, chosen, source) {
  if (!annotations.samples.some((s) => s.files?.length)) {
    throw new Error(`Sample annotations of ${m.accession} list no files; a ${source.type} source needs files per sample.`);
  }
  const paired = pairedFromFiles(annotations);
  if (paired === undefined) throw new Error(`Sample files of ${m.accession} mix paired and single entries; one experiment needs one layout.`);
  if (chosen.hasPairedEnds !== undefined && chosen.hasPairedEnds !== paired) {
    throw new Error(`dataset.props.hasPairedEnds is ${chosen.hasPairedEnds} but the sample files of ${m.accession} say ${paired}; for a ${source.type} source the layout comes from the files.`);
  }
  return paired;
}

function pairedFromFiles(annotations) {
  const entries = annotations.samples.flatMap((s) => s.files || []);
  if (entries.length && entries.every((f) => f.fastq_2)) return 'true';
  if (entries.length && entries.every((f) => !f.fastq_2)) return 'false';
  return undefined;
}

/**
 * Phase 1: the rnaSeqExperiment record. Values the inputs leave ambiguous
 * (mixed layouts, unknown strandedness) are refused unless the curator sets
 * them under dataset.props in the overrides.
 */
export function deriveDataset(proposalDir, classDef, overrides = {}) {
  const m = loadManifest(proposalDir);
  requireIdentity(m, datasetClass);
  const chosen = overrides.props || {};
  const source = overrides.source || DEFAULT_SOURCE;
  const runs = readRuns(proposalDir, m, source);

  const annotations = readCuratedJson(proposalDir, annotationsFile(m));
  const hasPairedEnds = source.type === 'sra' ? layoutFromRuns(m, runs, chosen) : layoutFromFiles(m, annotations, chosen, source);
  const { strandedness } = annotations;
  const isStrandSpecific = chosen.isStrandSpecific ?? STRANDED[strandedness];
  if (isStrandSpecific === undefined) {
    throw new Error(`Sample annotations give strandedness "${strandedness}"; rnaSeqExperiment needs isStrandSpecific true or false. Fix the annotations or set dataset.props.isStrandSpecific in --overrides.`);
  }

  const record = {
    schemaVersion: DATASET_SCHEMA_VERSION,
    props: { limitNU: '30', hasPairedEnds, isStrandSpecific, alignWithCdsCoordinates: 'false', fromSRA: String(source.type === 'sra'), ...chosen, hasPairedEnds },
    source
  };
  assertDataset(record, classDef, { runAccessions: runs.map((r) => r.run_accession) },
    `dataset for ${m.accession} (set values under "dataset" in --overrides)`);
  return record;
}

/** The <dataset> entry for the organism file, from the manifest and dataset.json only. */
export function renderDataset(proposalDir, classDef) {
  const m = loadManifest(proposalDir);
  requireIdentity(m, datasetClass);
  const d = readDataset(proposalDir);
  assertDataset(d, classDef, {}, `curated/dataset.json of ${m.accession}`);
  return datasetElement(m, classDef, d.props);
}

// --- loading artifacts -------------------------------------------------------

const SAMPLESHEET_HEADER = 'sample,fastq_1,fastq_2,strandedness';
/**
 * Derived into curated/ by write-proposal.js, which never overwrites a hand
 * edit without the curator's choice; checked again at publish and load.
 */
export const derivedCuratedFiles = ['samplesheet.csv', 'analysisConfig.xml', 'entity-sample.tsv', 'entity-sample.yaml'];

function analysisConfig(annotations, m, isStrandSpecific) {
  const profileSetName = annotations.profileSetName || `${m.name} RNA-Seq`;
  const values = annotations.samples
    .map((s) => `        <value>${escapeXml(`${s.label}|${s.sampleId}`)}</value>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<xml>
  <step class="ApiCommonData::Load::RnaSeqAnalysisEbi">
    <property name="profileSetName" value="${escapeXml(profileSetName)}"/>
    <property name="samples">
${values}
    </property>
    <property name="isStrandSpecific" value="${isStrandSpecific ? '1' : '0'}"/>
  </step>
</xml>
`;
}

/**
 * One row per run or files entry. For SRA the pipeline fetches reads by run
 * accession, so fastq_2 repeats it when paired.
 */
function samplesheet(annotations, paired, stranded) {
  const strand = stranded ? 'stranded' : 'unstranded';
  const rows = annotations.samples
    .flatMap((s) => (s.files
      ? s.files.map((f) => [s.sampleId, f.fastq_1, f.fastq_2 ?? '', strand])
      : (s.runs || []).map((run) => [s.sampleId, run, paired ? run : '', strand])))
    .sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
  return [SAMPLESHEET_HEADER, ...rows.map((r) => r.join(','))].join('\n') + '\n';
}

/** Phase 1: the loading artifacts, from the normalized annotations and dataset.json. */
export function deriveArtifacts(proposalDir) {
  const m = loadManifest(proposalDir);
  requireIdentity(m, datasetClass);
  const { props, source } = readDataset(proposalDir);
  const annotations = readCuratedJson(proposalDir, annotationsFile(m));
  const stranded = props.isStrandSpecific === 'true';
  const { tsv, yaml } = sampleAnnotationsToStf(annotations, { sra: source.type === 'sra' });
  return {
    'samplesheet.csv': samplesheet(annotations, props.hasPairedEnds === 'true', stranded),
    'analysisConfig.xml': analysisConfig(annotations, m, stranded),
    'entity-sample.tsv': tsv,
    'entity-sample.yaml': yaml
  };
}

const unescapeXml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** Every <property> start tag with its attributes, in any order and either quote style. */
function propertyTags(xml) {
  return [...xml.matchAll(/<property\b([^>]*?)(\/?)>/g)].map((m) => ({
    attrs: Object.fromEntries([...m[1].matchAll(/([\w:.-]+)\s*=\s*(["'])([\s\S]*?)\2/g)].map(([, k, , v]) => [k, unescapeXml(v)])),
    selfClosing: m[2] === '/',
    end: m.index + m[0].length
  }));
}

function differ(a, aName, b, bName) {
  const onlyA = [...a].filter((x) => !b.has(x));
  const onlyB = [...b].filter((x) => !a.has(x));
  if (!onlyA.length && !onlyB.length) return [];
  return [`${aName} and ${bName} disagree: only in ${aName}: ${onlyA.join(', ') || 'none'}; only in ${bName}: ${onlyB.join(', ') || 'none'}`];
}

/** Errors when the curated artifacts or sample annotations disagree on sample ids, layout or strandedness. */
export function checkCurated(proposalDir) {
  const text = (f) => {
    const p = join(proposalDir, 'curated', f);
    return existsSync(p) ? readFileSync(p, 'utf-8') : null;
  };
  const annotationsName = annotationsFile(loadManifest(proposalDir));
  const checked = [...derivedCuratedFiles, annotationsName];
  const files = Object.fromEntries(checked.map((f) => [f, text(f)]));
  const missing = checked.filter((f) => files[f] === null);
  if (missing.length) return missing.map((f) => `curated/${f} is missing${f === annotationsName ? '' : '; re-run write-proposal.js'}`);

  const { props } = readDataset(proposalDir);
  const paired = props.hasPairedEnds === 'true';
  const stranded = props.isStrandSpecific === 'true';
  const errors = [];

  const [header, ...lines] = files['samplesheet.csv'].split(/\r?\n/);
  if (header.trim() !== SAMPLESHEET_HEADER) errors.push(`samplesheet.csv header must be ${SAMPLESHEET_HEADER}`);
  const rows = lines
    .map((l, i) => ({ l: l.trim(), line: i + 2 }))
    .filter(({ l }) => l)
    .map(({ l, line }) => {
      const [sample, fastq1, fastq2, strandedness] = l.split(',').map((c) => c.trim());
      return { line, sample, fastq1, fastq2, strandedness };
    });
  const sheetIds = new Set(rows.map((r) => r.sample));
  for (const r of rows) {
    const row = `samplesheet.csv line ${r.line} (${r.sample})`;
    if (Boolean(r.fastq2) !== paired) errors.push(`${row} ${paired ? 'has no fastq_2' : 'has a fastq_2'} but dataset.json says hasPairedEnds ${paired}`);
    if (r.strandedness !== (stranded ? 'stranded' : 'unstranded')) errors.push(`${row} says ${r.strandedness} but dataset.json says isStrandSpecific ${stranded}`);
  }

  const stfIds = new Set(files['entity-sample.tsv'].split(/\r?\n/).slice(1).filter((l) => l.trim()).map((l) => l.split('\t')[0].trim()));
  errors.push(...differ(sheetIds, 'samplesheet.csv', stfIds, 'entity-sample.tsv'));

  let annotations;
  try { annotations = JSON.parse(files[annotationsName]); }
  catch (e) { errors.push(`${annotationsName} is not valid JSON: ${e.message}`); }
  if (annotations) errors.push(...differ(sheetIds, 'samplesheet.csv', new Set((annotations.samples || []).map((s) => s.sampleId)), annotationsName));

  const xml = files['analysisConfig.xml'];
  const property = (name) => propertyTags(xml).find((t) => t.attrs.name === name);
  const samples = property('samples');
  if (!samples || samples.selfClosing) errors.push('analysisConfig.xml has no samples property');
  else {
    const body = xml.slice(samples.end, xml.indexOf('</property>', samples.end));
    const configIds = new Set();
    for (const [, raw] of body.matchAll(/<value\s*>([^<]*)<\/value\s*>/g)) {
      const value = unescapeXml(raw).trim();
      const parts = value.split('|');
      if (parts.length !== 2) errors.push(`analysisConfig.xml value "${value}" is not label|sampleId`);
      else configIds.add(parts[1].trim());
    }
    errors.push(...differ(sheetIds, 'samplesheet.csv', configIds, 'analysisConfig.xml'));
  }
  const configStranded = property('isStrandSpecific')?.attrs.value;
  if (configStranded === undefined) errors.push('analysisConfig.xml has no isStrandSpecific property');
  else if (configStranded.trim() !== (stranded ? '1' : '0')) errors.push(`analysisConfig.xml isStrandSpecific is ${configStranded} but dataset.json says isStrandSpecific ${stranded}`);
  return errors;
}

export function assertCuratedAgree(proposalDir) {
  const errors = checkCurated(proposalDir);
  if (errors.length) throw new Error(`Curated artifacts of ${loadManifest(proposalDir).accession} disagree:\n  - ${errors.join('\n  - ')}`);
}

/**
 * Phase 2 (and the Phase 1 preview): the curated artifacts, checked and laid
 * out for one organism's delivery directory. Returns { files: { relativePath: text } }.
 */
export function renderArtifacts(proposalDir, organism) {
  const m = loadManifest(proposalDir);
  requireIdentity(m, datasetClass);
  assertCuratedAgree(proposalDir);
  const text = (f) => readFileSync(join(proposalDir, 'curated', f), 'utf-8');
  const stfDir = `sample-annotations-stf/${nameFor(m, organismOf(m, organism))}`;
  return {
    files: {
      'analysisConfig.xml': text('analysisConfig.xml'),
      'samplesheet.csv': text('samplesheet.csv'),
      'sampleAnnotations.json': text(annotationsFile(m)),
      [`${stfDir}/entity-sample.tsv`]: text('entity-sample.tsv'),
      [`${stfDir}/entity-sample.yaml`]: text('entity-sample.yaml')
    }
  };
}
