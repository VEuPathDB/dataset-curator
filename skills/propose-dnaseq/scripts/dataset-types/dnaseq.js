import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  loadManifest, readInputJson, readCuratedJson, readPresenter, applyOverrides, requireIdentity, readDataset,
  assertValidDataset, datasetElement, PRESENTER_SCHEMA_VERSION, DATASET_SCHEMA_VERSION, escapeXml, injectorProps,
  requireBuild, presenterBodyXml
} from './_common.js';
import { DEFAULT_SOURCE, normalizeSamples, samplesheet, parseSamplesheet, checkSamplesAgree } from './_sra-samples.js';
import { sampleAnnotationsToStf } from '../lib/stf.js';
import { libraryProblems } from '../lib/library-checks.js';
import { organismsOf, externalIdKindOf } from '../lib/manifest.js';

export const datasetClass = 'dnaseqExperiment';
export const injectorDefaults = { hasCNVData: 'false' };
export const requiredFields = ['shortDisplayName', 'shortAttribution'];
export const requiredInjectorProps = ['hasCNVData'];
/** Gene CNV needs orthomcl paralogs, so the organism must already be released. */
export const organismRule = { new: false, max: 1, pending: 'refuse' };
/** Organism-file constants the dataset entry references; load checks them and inserts any missing. */
export const requiredOrganismConstants = { ploidy: /^[1-9]\d*$/ };

const INJECTOR = 'org.apidb.apicommon.model.datasetInjector.IsolatesHTS';
export const datasetNameFor = (organism, name) => `${organism}_${name}_dnaseqExperiment_RSRC`;
export const annotationsFile = (m) => `${m.accession}_sample_annotations.json`;
const sraFile = (m) => `${m.accession}_sra_metadata.json`;
const releasedFile = (m) => `${m.accession}_released_organism.json`;
const runsOf = (dir, m) => readInputJson(dir, sraFile(m)).runs || [];
const organismOf = (m) => organismsOf(m)[0];

export const derivedCuratedFiles = ['samplesheet.csv', 'entity-sample.tsv', 'entity-sample.yaml'];

/** No GEO series dates a DNA-seq proposal, so the curator supplies name and version. */
export const deriveIdentity = () => ({ version: undefined, name: undefined });

export function presenterNames(proposalDir) {
  const m = loadManifest(proposalDir);
  requireIdentity(m, datasetClass);
  return [datasetNameFor(organismOf(m), m.name)];
}

function releasedOrganism(proposalDir, m) {
  if (!existsSync(join(proposalDir, 'inputs', releasedFile(m)))) {
    throw new Error(`${m.accession} needs inputs/${releasedFile(m)}; run check-released-organism.js and pass --input .curation/tmp/${releasedFile(m)}`);
  }
  return readInputJson(proposalDir, releasedFile(m));
}

function linksFor(m) {
  const ids = { ...(externalIdKindOf(m.accession) ? { [externalIdKindOf(m.accession)]: m.accession } : {}), ...m.externalIds };
  return ids.bioproject ? [{ text: 'NCBI Bioproject', url: `https://www.ncbi.nlm.nih.gov/bioproject/${ids.bioproject}` }] : [];
}

function methodologyFrom(runs) {
  const uniq = (key) => [...new Set(runs.map((r) => r[key]).filter(Boolean))];
  return [['Library strategy', 'library_strategy'], ['Layout', 'library_layout'], ['Sequencing', 'instrument_model']]
    .map(([label, key]) => [label, uniq(key)]).filter(([, v]) => v.length).map(([label, v]) => `${label}: ${v.join(', ')}`).join('. ');
}

/** Phase 1: the presenter record. hasCNVData defaults from the released assembly having chromosomes. */
export function derivePresenter(proposalDir, overrides = {}) {
  const m = loadManifest(proposalDir);
  requireIdentity(m, datasetClass);
  const runs = runsOf(proposalDir, m);
  const { released } = releasedOrganism(proposalDir, m);
  const species = runs.map((r) => r.scientific_name).find(Boolean);
  if (!species) throw new Error(`No scientific_name in any run of ${m.accession}`);
  return applyOverrides({
    schemaVersion: PRESENTER_SCHEMA_VERSION,
    displayName: `DNA-Seq analysis of ${species}`,
    shortDisplayName: '',
    shortAttribution: '',
    summary: `DNA-Seq analysis of <i>${species}</i>`,
    description: [...new Set(runs.map((r) => r.experiment_title).filter(Boolean))][0] || '',
    methodology: methodologyFrom(runs),
    protocol: '', caveat: '', acknowledgement: '', releasePolicy: '',
    pubmedIds: [],
    links: linksFor(m),
    history: {},
    injectorProps: { hasCNVData: String(released.chromosomeCount > 0) }
  }, overrides);
}

export function renderPresenter(proposalDir, { build } = {}) {
  requireBuild(build);
  const m = loadManifest(proposalDir);
  requireIdentity(m, datasetClass);
  const p = readPresenter(proposalDir, { requiredFields, requiredInjectorProps });
  return `  <datasetPresenter name="${escapeXml(datasetNameFor(organismOf(m), m.name))}"
                    projectName="${escapeXml(m.organisms[0].project)}">
${presenterBodyXml(p, m, build)}    <templateInjector className="${INJECTOR}">
${injectorProps(injectorDefaults, p.injectorProps)}
    </templateInjector>
  </datasetPresenter>`;
}

/** Phase 1: rewrites the staged annotations in normalized form; SRA only, one organism. */
export function normalizeCurated(proposalDir, datasetOverrides = {}) {
  const m = loadManifest(proposalDir);
  if (datasetOverrides?.source && datasetOverrides.source.type !== 'sra') throw new Error('dnaseq reads from SRA only');
  const annotations = readCuratedJson(proposalDir, annotationsFile(m));
  if (annotations.samples?.some((s) => s.organisms !== undefined)) throw new Error(`dnaseq proposals are single-organism; remove "organisms" from the samples in ${annotationsFile(m)}`);
  const normalized = normalizeSamples(annotations, runsOf(proposalDir, m), { source: DEFAULT_SOURCE });
  writeFileSync(join(proposalDir, 'curated', annotationsFile(m)), JSON.stringify(normalized, null, 2) + '\n');
}

/** Phase 1: the dnaseqExperiment record. ploidy is the organism file's constant, never a value. */
export function deriveDataset(proposalDir, classDef, overrides = {}) {
  const m = loadManifest(proposalDir);
  requireIdentity(m, datasetClass);
  if (overrides.props?.ploidy !== undefined) throw new Error('dataset.props.ploidy comes from the organism file ($$ploidy$$); set it at load with --ploidy');
  if (overrides.source && overrides.source.type !== 'sra') throw new Error('dnaseq reads from SRA only');
  const runs = runsOf(proposalDir, m);
  const { errors } = libraryProblems(runs);
  if (errors.length) throw new Error(`Runs of ${m.accession} fail the library checks:\n  - ${errors.join('\n  - ')}`);
  const record = { schemaVersion: DATASET_SCHEMA_VERSION, props: { fromSRA: 'true', ...overrides.props, ploidy: '$$ploidy$$' }, source: DEFAULT_SOURCE };
  assertValidDataset(record, classDef, { runAccessions: runs.map((r) => r.run_accession) }, `dataset for ${m.accession} (set values under "dataset" in --overrides)`);
  return record;
}

export function renderDataset(proposalDir, classDef) {
  const m = loadManifest(proposalDir);
  requireIdentity(m, datasetClass);
  const d = readDataset(proposalDir);
  if (d.props?.ploidy !== '$$ploidy$$') throw new Error(`curated/dataset.json of ${m.accession}: props.ploidy must be $$ploidy$$`);
  assertValidDataset(d, classDef, {}, `curated/dataset.json of ${m.accession}`);
  return datasetElement(m, classDef, d.props);
}

/** Phase 1: the organism's loading artifacts, keyed <proposed abbreviation>/<file>. */
export function deriveArtifacts(proposalDir) {
  const m = loadManifest(proposalDir);
  requireIdentity(m, datasetClass);
  const annotations = readCuratedJson(proposalDir, annotationsFile(m));
  const p = m.organisms[0].proposedOrganismAbbrev;
  const { tsv, yaml } = sampleAnnotationsToStf(annotations, { sra: true });
  return { [`${p}/samplesheet.csv`]: samplesheet(annotations.samples), [`${p}/entity-sample.tsv`]: tsv, [`${p}/entity-sample.yaml`]: yaml };
}

/** Errors when the curated artifacts and the sample annotations disagree. */
export function checkCurated(proposalDir) {
  const m = loadManifest(proposalDir);
  const p = m.organisms[0].proposedOrganismAbbrev;
  const missing = [annotationsFile(m), ...derivedCuratedFiles.map((f) => `${p}/${f}`)].filter((f) => !existsSync(join(proposalDir, 'curated', f)));
  if (missing.length) return missing.map((f) => `curated/${f} is missing; re-run write-proposal.js`);
  const text = (f) => readFileSync(join(proposalDir, 'curated', p, f), 'utf-8');
  let annotations;
  try { annotations = JSON.parse(readFileSync(join(proposalDir, 'curated', annotationsFile(m)), 'utf-8')); }
  catch (e) { return [`${annotationsFile(m)} is not valid JSON: ${e.message}`]; }
  const sheet = parseSamplesheet(text('samplesheet.csv'));
  return [
    ...sheet.errors,
    ...sheet.rows.filter((r) => r.fastq2).map((r) => `samplesheet.csv line ${r.line} (${r.sample}) has a fastq_2, but an SRA source lists each run once`),
    ...checkSamplesAgree({ samplesheet: text('samplesheet.csv'), tsv: text('entity-sample.tsv'), sampleIds: (annotations.samples ?? []).map((s) => s.sampleId), versus: annotationsFile(m) })
  ];
}

export function assertCuratedAgree(proposalDir) {
  const errors = checkCurated(proposalDir);
  if (errors.length) throw new Error(`Curated artifacts of ${loadManifest(proposalDir).accession} disagree:\n  - ${errors.join('\n  - ')}`);
}

/** Phase 2 (and the Phase 1 preview): the curated artifacts laid out for the delivery directory. */
export function renderArtifacts(proposalDir, organism) {
  const m = loadManifest(proposalDir);
  requireIdentity(m, datasetClass);
  assertCuratedAgree(proposalDir);
  const settled = organism ?? organismOf(m);
  const p = m.organisms[0].proposedOrganismAbbrev;
  const text = (f) => readFileSync(join(proposalDir, 'curated', p, f), 'utf-8');
  const stfDir = `sample-annotations-stf/${datasetNameFor(settled, m.name)}`;
  return {
    files: {
      'samplesheet.csv': text('samplesheet.csv'),
      'sampleAnnotations.json': readFileSync(join(proposalDir, 'curated', annotationsFile(m)), 'utf-8'),
      [`${stfDir}/entity-sample.tsv`]: text('entity-sample.tsv'),
      [`${stfDir}/entity-sample.yaml`]: text('entity-sample.yaml')
    }
  };
}
