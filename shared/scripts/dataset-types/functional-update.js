import { loadManifest, readCuratedJson, readInputJson, onlyEntry, assertCuratedAgreeWith, DATASET_SCHEMA_VERSION, ORGANISM_FILE_CONSTANTS } from './_common.js';
import { organismsOf, projectOf } from '../lib/manifest.js';
import { UPDATE_FILENAME, deriveUpdate as derive, entryProps, updateProblems, entriesInputName, stagedInputName, historyDate } from './functional-update/update.js';

export const datasetClasses = ['productNames', 'GeneOntologyAssociations', 'EnzymeCommissionAssociations', 'geneName', 'comments', 'aliases'];
export const validationWorkspace = 'functional-update-validation';
export const singleEntry = true;
/** The proposal adds a history row to the organism's genome presenter instead of rendering its own. */
export const amendsPresenters = true;
export const requiredOrganismConstants = { genomeVersion: /^\S+$/ };
const carriedConstants = [...ORGANISM_FILE_CONSTANTS, ...Object.keys(requiredOrganismConstants)];
export const injectorDefaults = {};
export const requiredFields = [];
export const requiredInjectorProps = [];
export const UPDATE_RECORD_FILENAME = UPDATE_FILENAME;
export const ownRecordFiles = [UPDATE_FILENAME];

export const presenterNames = (dir) => [`${organismsOf(loadManifest(dir))[0]}_primary_genome_RSRC`];

export { preprocessedFiles } from './functional-update/delivery.js';

export const readUpdate = (dir) => readCuratedJson(dir, UPDATE_FILENAME);
const found = (dir, m) => readInputJson(dir, entriesInputName(m.accession));
const staged = (dir, m) => readInputJson(dir, stagedInputName(m.accession));

/** Phase 1: curated/update.json. */
export function deriveUpdate(dir, over = {}, { name } = {}) {
  const manifest = loadManifest(dir);
  return derive({ manifest, found: found(dir, manifest), datasetClasses }, over, { name });
}

/** The entry's class and name come from update.json; the version is the curator's curation date (--overrides "version"). */
export function deriveIdentity(dir) {
  const u = readUpdate(dir);
  return { datasetClass: u.datasetClass, name: u.name, version: undefined };
}

export function deriveDataset(dir, classDef, overrides = {}) {
  if (overrides.props !== undefined || overrides.source !== undefined) throw new Error('functional-update entries take no "dataset" overrides; their props come from the organism file');
  const m = loadManifest(dir);
  return { schemaVersion: DATASET_SCHEMA_VERSION, props: entryProps(readUpdate(dir), found(dir, m), carriedConstants), source: { type: 'server', paths: [staged(dir, m).path] } };
}

/** The entries this proposal re-versions rather than inserts: its one entry, in bump mode. */
export function amendsEntries(dir) {
  const u = readUpdate(dir);
  return u.mode === 'bump' ? [{ datasetClass: u.datasetClass, name: u.name }] : [];
}

/** Phase 2: the history row on the genome presenter, and in bump mode the entry's new version. */
export function loadEdits(dir, { manifest, build, given = {} }) {
  const organism = organismsOf(manifest)[0];
  const project = projectOf(manifest, organism);
  const u = readUpdate(dir);
  const entry = onlyEntry(dir, manifest);
  return [
    {
      op: 'appendHistory', project, presenter: `${organism}_primary_genome_RSRC`, build,
      functional: { source: u.history.functionalAnnotationSource, version: historyDate(entry.version) }, text: u.history.text, carry: given.history ?? {}
    },
    ...(u.mode === 'bump' ? [{ op: 'setEntryVersion', project, organism, datasetClass: entry.datasetClass, name: entry.name, version: entry.version }] : [])
  ];
}

export function checkCurated(dir) {
  const m = loadManifest(dir);
  return updateProblems({ update: readUpdate(dir), entry: onlyEntry(dir, m), manifest: m, staged: staged(dir, m) });
}
export const assertCuratedAgree = assertCuratedAgreeWith(checkCurated);
