import { readFileSync } from 'node:fs';
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
    injectorProps: { hasMultipleSamples: multiple, isDESeq: multiple }
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
  const p = readPresenter(proposalDir, { requiredFields });
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
  const { strandedness } = readCuratedJson(proposalDir, `${m.accession}_sample_annotations.json`);
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
  return ['sample,fastq_1,fastq_2,strandedness', ...rows.map((r) => r.join(','))].join('\n') + '\n';
}

/**
 * Phase 2 (and the Phase 1 preview): the files the data loading team copies
 * into one organism's delivery directory, from the manifest and curated records.
 * Returns { files: { relativePath: text } }.
 */
export function renderArtifacts(proposalDir, organism) {
  const m = loadManifest(proposalDir);
  requireIdentity(m, datasetClass);
  const { props, source } = readDataset(proposalDir);
  if (source?.type !== 'sra') {
    throw new Error(`Artifacts for ${m.accession}: a "${source?.type}" read source needs per-sample file paths, which proposals do not carry yet`);
  }
  const annotationsText = readFileSync(join(proposalDir, 'curated', `${m.accession}_sample_annotations.json`), 'utf-8');
  const annotations = JSON.parse(annotationsText);
  const stranded = props.isStrandSpecific === 'true';
  const { tsv, yaml } = sampleAnnotationsToStf(annotations);
  const stfDir = `sample-annotations-stf/${nameFor(m, organismOf(m, organism))}`;
  return {
    files: {
      'analysisConfig.xml': analysisConfig(annotations, m, stranded),
      'samplesheet.csv': samplesheet(annotations, props.hasPairedEnds === 'true', stranded),
      'sampleAnnotations.json': annotationsText,
      [`${stfDir}/entity-sample.tsv`]: tsv,
      [`${stfDir}/entity-sample.yaml`]: yaml
    }
  };
}
