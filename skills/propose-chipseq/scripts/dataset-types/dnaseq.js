import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  loadManifest, readInputJson, readPresenter, applyOverrides, requireIdentity, readDataset, onlyEntry,
  assertValidDataset, datasetElement, PRESENTER_SCHEMA_VERSION, DATASET_SCHEMA_VERSION, escapeXml, injectorProps,
  requireBuild, presenterBodyXml
} from './_common.js';
import { DEFAULT_SOURCE, bioprojectLinks, methodologyFrom } from './_sra-samples.js';
import { sraExperimentType, runsOf, usedRuns, organismOf } from './_sra-experiment.js';
import { libraryProblems } from '../lib/library-checks.js';

export const datasetClass = 'dnaseqExperiment';
export const datasetClasses = [datasetClass];
export const singleEntry = true;
export const injectorDefaults = { hasCNVData: 'false' };
export const requiredFields = ['shortDisplayName', 'shortAttribution'];
export const requiredInjectorProps = ['hasCNVData'];
/** Organism-file constants the dataset entry references; load checks them and inserts any missing. */
export const requiredOrganismConstants = { ploidy: /^[1-9]\d*$/ };
export const libraryStrategies = ['WGS'];

const INJECTOR = 'org.apidb.apicommon.model.datasetInjector.IsolatesHTS';
export const datasetNameFor = (organism, name) => `${organism}_${name}_dnaseqExperiment_RSRC`;
const releasedFile = (m) => `${m.accession}_released_organism.json`;

export const {
  derivedCuratedFiles, presenterNames, normalizeCurated, deriveArtifacts, checkCurated, assertCuratedAgree, renderArtifacts, corpusFiles, stagingProblems
} = sraExperimentType({ type: 'dnaseq', datasetNameFor });

/** No GEO series dates a DNA-seq proposal, so the curator supplies name and version. */
export const deriveIdentity = () => ({ version: undefined, name: undefined });

/** The released-organism input, refused unless check-released-organism ran for the manifest's organism and project. */
function releasedOrganism(proposalDir, m) {
  const { proposedOrganismAbbrev: organism, project } = m.organisms[0];
  const rerun = `run check-released-organism.js ${m.accession} --organism ${organism} --project ${project} and pass --input .curation/tmp/${releasedFile(m)}`;
  if (!existsSync(join(proposalDir, 'inputs', releasedFile(m)))) throw new Error(`${m.accession} needs inputs/${releasedFile(m)}; ${rerun}`);
  const file = readInputJson(proposalDir, releasedFile(m));
  if (file?.organism !== organism || file?.project !== project) {
    throw new Error(`inputs/${releasedFile(m)} is for ${file?.organism} (${file?.project}), not ${organism} (${project}); ${rerun}`);
  }
  if (!file.released || typeof file.released !== 'object') throw new Error(`inputs/${releasedFile(m)} has no "released" record; ${rerun}`);
  return file;
}

/** Phase 1: the presenter record. hasCNVData defaults from the released assembly having chromosomes. */
export function derivePresenter(proposalDir, overrides = {}) {
  const m = loadManifest(proposalDir);
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
    links: bioprojectLinks(m),
    history: {},
    injectorProps: { hasCNVData: String(released.chromosomeCount > 0) }
  }, overrides);
}

export function renderPresenter(proposalDir, { build } = {}) {
  requireBuild(build);
  const m = loadManifest(proposalDir);
  const { name } = onlyEntry(proposalDir, m);
  const p = readPresenter(proposalDir, { requiredFields, requiredInjectorProps });
  return `  <datasetPresenter name="${escapeXml(datasetNameFor(organismOf(m), name))}"
                    projectName="${escapeXml(m.organisms[0].project)}">
${presenterBodyXml(p, m, build)}    <templateInjector className="${INJECTOR}">
${injectorProps(injectorDefaults, p.injectorProps)}
    </templateInjector>
  </datasetPresenter>`;
}

/** Phase 1: the dnaseqExperiment record. ploidy is the organism file's constant, never a value. */
export function deriveDataset(proposalDir, classDef, overrides = {}) {
  const m = loadManifest(proposalDir);
  if (overrides.props?.ploidy !== undefined) throw new Error('dataset.props.ploidy comes from the organism file ($$ploidy$$); set it at load with --ploidy');
  if (overrides.source && overrides.source.type !== 'sra') throw new Error('dnaseq reads from SRA only');
  const runs = runsOf(proposalDir, m);
  const used = usedRuns(proposalDir, m);
  const { errors } = libraryProblems(runs, { used, strategies: libraryStrategies });
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

export const corpus = { root: 'common/dnaSeq/sampleDetailsForEda', layout: 'per-organism' };
