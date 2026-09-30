import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  loadManifest, readInputJson, readCuratedJson, findInputBySuffix, readPresenter, applyOverrides, requireIdentity,
  readDataset, assertValidDataset, datasetElement, PRESENTER_SCHEMA_VERSION, DATASET_SCHEMA_VERSION,
  escapeForCDATA, escapeXml, contactElements, pubmedElements, linkElements, injectorProps, requireBuild
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
function descriptionFrom(sra, miniml) {
  const summary = miniml?.match(/<Summary[^>]*>([\s\S]*?)<\/Summary>/i);
  if (summary) return summary[1].trim();
  const titles = [...new Set(sra.runs.map(r => r.experiment_title).filter(Boolean))];
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

function organismOf(m, organism = m.referenceOrganismAbbrev) {
  if (!organismsOf(m).includes(organism)) throw new Error(`${organism} is not an organism of ${m.accession}`);
  return organism;
}

/** Phase 1: the presenter record from the proposal's inputs plus curator overrides. */
export function derivePresenter(proposalDir, overrides = {}) {
  const m = loadManifest(proposalDir);
  requireIdentity(m, datasetClass);
  const sra = readInputJson(proposalDir, `${m.accession}_sra_metadata.json`);
  const miniml = findInputBySuffix(proposalDir, '_family.xml');
  const runs = sra.runs || [];
  const organismName = organismFromRuns(runs, m.accession);
  const multiple = new Set(runs.map(r => r.sample_accession)).size > 1 ? 'true' : 'false';
  const { factors = {} } = readCuratedJson(proposalDir, annotationsFile(m));
  const xAxis = Object.values(factors).map((f) => f.displayName).filter(Boolean).join(', ');

  return applyOverrides({
    schemaVersion: PRESENTER_SCHEMA_VERSION,
    displayName: `RNA-Seq analysis of <i>${organismName}</i>`,
    shortDisplayName: '',
    shortAttribution: '',
    summary: `RNA-Seq analysis of <i>${organismName}</i>`,
    description: descriptionFrom(sra, miniml),
    methodology: methodologyFrom(runs),
    protocol: '', caveat: '', acknowledgement: '', releasePolicy: '',
    pubmedIds: [],
    links: [{ text: 'NCBI Bioproject', url: `https://www.ncbi.nlm.nih.gov/bioproject/${m.accession}` }],
    history: {},
    injectorProps: { hasMultipleSamples: multiple, isDESeq: multiple, graphXAxisSamplesDescription: xAxis }
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

const runsOf = (proposalDir, m) => readInputJson(proposalDir, `${m.accession}_sra_metadata.json`).runs || [];

const SAMPLE_ID = /^[A-Za-z0-9_.-]+$/;
const REPLICATE_SUFFIX = /[\s_](replicate[\s_]?|rep|R)\d+$/i;
const toSampleId = (title) => title.trim().replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/^_+|_+$/g, '');
const annotationsFile = (m) => `${m.accession}_sample_annotations.json`;

/**
 * Every sample gets its BioSample, a sampleId the samplesheet, STF and
 * analysisConfig all use, and a label replicates share. The SRA sample title
 * names the samples without a sampleId when each has a distinct one that no
 * curator sampleId uses; otherwise the BioSample does. A sampleId or label
 * already in the annotations is the curator's.
 */
export function normalizeSamples(annotations, runs) {
  const byRun = new Map(runs.map((r) => [r.run_accession, r]));
  const drafts = annotations.samples.map((s, i) => {
    const who = s.sampleId ?? s.label ?? ((s.runs || []).join(',') || `sample #${i + 1}`);
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
    const titles = distinct('sample_title').map((t) => t.trim());
    return { sample: { ...s, biosample: biosamples[0] }, title: titles.length === 1 ? titles[0] : undefined };
  });
  const ids = drafts.map((d) => d.title && toSampleId(d.title));
  const chosen = new Set(drafts.map((d) => d.sample.sampleId).filter(Boolean));
  const unnamed = ids.filter((id, i) => !drafts[i].sample.sampleId);
  const byTitle = unnamed.every(Boolean) && new Set(unnamed).size === unnamed.length && !unnamed.some((id) => chosen.has(id));
  const samples = drafts.map(({ sample, title }, i) => {
    const sampleId = sample.sampleId ?? (byTitle ? ids[i] : sample.biosample);
    const stripped = byTitle && title ? title.replace(REPLICATE_SUFFIX, '') : '';
    return { ...sample, sampleId, label: sample.label ?? (stripped || (byTitle && title) || sampleId) };
  });
  const seen = new Set();
  for (const { sampleId } of samples) {
    if (!SAMPLE_ID.test(sampleId)) throw new Error(`sampleId "${sampleId}" may contain only letters, digits, _, . and -`);
    if (seen.has(sampleId)) throw new Error(`sampleId "${sampleId}" is used twice`);
    seen.add(sampleId);
  }
  return { ...annotations, samples };
}

/** Phase 1: rewrites the staged sample annotations in normalized form. */
export function normalizeCurated(proposalDir) {
  const m = loadManifest(proposalDir);
  const path = join(proposalDir, 'curated', annotationsFile(m));
  const normalized = normalizeSamples(readCuratedJson(proposalDir, annotationsFile(m)), runsOf(proposalDir, m));
  writeFileSync(path, JSON.stringify(normalized, null, 2) + '\n');
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

/**
 * Phase 1: the rnaSeqExperiment record. Values the inputs leave ambiguous
 * (mixed layouts, unknown strandedness) are refused unless the curator sets
 * them under dataset.props in the overrides.
 */
export function deriveDataset(proposalDir, classDef, overrides = {}) {
  const m = loadManifest(proposalDir);
  requireIdentity(m, datasetClass);
  const runs = runsOf(proposalDir, m);
  const chosen = overrides.props || {};
  const source = overrides.source || { type: 'sra' };

  const layouts = [...new Set(runs.map((r) => (r.library_layout || '').toUpperCase()))];
  const hasPairedEnds = chosen.hasPairedEnds ?? (layouts.length === 1 && ['PAIRED', 'SINGLE'].includes(layouts[0]) ? String(layouts[0] === 'PAIRED') : undefined);
  if (hasPairedEnds === undefined) {
    throw new Error(`Runs of ${m.accession} have library layouts ${layouts.join(', ') || 'none'}; one experiment needs one layout. Set dataset.props.hasPairedEnds in --overrides if that is intended.`);
  }
  const { strandedness } = readCuratedJson(proposalDir, annotationsFile(m));
  const isStrandSpecific = chosen.isStrandSpecific ?? STRANDED[strandedness];
  if (isStrandSpecific === undefined) {
    throw new Error(`Sample annotations give strandedness "${strandedness}"; rnaSeqExperiment needs isStrandSpecific true or false. Fix the annotations or set dataset.props.isStrandSpecific in --overrides.`);
  }

  const record = {
    schemaVersion: DATASET_SCHEMA_VERSION,
    props: { limitNU: '30', hasPairedEnds, isStrandSpecific, alignWithCdsCoordinates: 'false', fromSRA: String(source.type === 'sra'), ...chosen },
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
 * Rewritten into curated/ on every write-proposal.js run; a hand edit made
 * after the last run is kept and checked at publish and load.
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

/** One row per run; for SRA the pipeline fetches reads by run accession, so fastq_2 repeats it when paired. */
function samplesheet(annotations, paired, stranded) {
  const rows = annotations.samples
    .flatMap((s) => (s.runs || []).map((run) => [s.sampleId, run, paired ? run : '', stranded ? 'stranded' : 'unstranded']))
    .sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
  return [SAMPLESHEET_HEADER, ...rows.map((r) => r.join(','))].join('\n') + '\n';
}

/** Phase 1: the loading artifacts, from the normalized annotations and dataset.json. */
export function deriveArtifacts(proposalDir) {
  const m = loadManifest(proposalDir);
  requireIdentity(m, datasetClass);
  const { props, source } = readDataset(proposalDir);
  if (source?.type !== 'sra') {
    throw new Error(`Artifacts for ${m.accession}: a "${source?.type}" read source needs per-sample file paths, which proposals do not carry yet`);
  }
  const annotations = readCuratedJson(proposalDir, annotationsFile(m));
  const stranded = props.isStrandSpecific === 'true';
  const { tsv, yaml } = sampleAnnotationsToStf(annotations);
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

/** Errors when the curated artifacts disagree on sample ids, layout or strandedness. */
export function checkCurated(proposalDir) {
  const text = (f) => {
    const p = join(proposalDir, 'curated', f);
    return existsSync(p) ? readFileSync(p, 'utf-8') : null;
  };
  const files = Object.fromEntries(derivedCuratedFiles.map((f) => [f, text(f)]));
  const missing = derivedCuratedFiles.filter((f) => files[f] === null);
  if (missing.length) return missing.map((f) => `curated/${f} is missing; re-run write-proposal.js`);

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

  const xml = files['analysisConfig.xml'];
  const property = (name) => propertyTags(xml).find((t) => t.attrs.name === name);
  const samples = property('samples');
  if (!samples || samples.selfClosing) errors.push('analysisConfig.xml has no samples property');
  else {
    const body = xml.slice(samples.end, xml.indexOf('</property>', samples.end));
    const configIds = new Set();
    for (const [, raw] of body.matchAll(/<value\s*>([^<]*)<\/value\s*>/g)) {
      const value = unescapeXml(raw).trim();
      const bar = value.lastIndexOf('|');
      if (bar === -1) errors.push(`analysisConfig.xml value "${value}" is not label|sampleId`);
      else configIds.add(value.slice(bar + 1).trim());
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
