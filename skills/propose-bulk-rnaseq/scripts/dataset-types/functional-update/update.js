import { isDate } from '../_common.js';
import { FUNCTIONAL_DEFAULTS } from '../genome-assembly/entries.js';

/** Phase 1 records of a functional-update proposal: curated/update.json and the one entry's props. */
export const UPDATE_FILENAME = 'update.json';
export const UPDATE_SCHEMA_VERSION = 1;
export const DEFAULT_HISTORY_TEXT = 'functional annotation updated';
export const MODES = ['bump', 'new'];

const CONSTANT_REF = /\$\$(\w+)\$\$/g;
const IDENTITY = ['projectName', 'organismAbbrev', 'name', 'version'];
const RERUN = 're-run check-functional-entries.js';

export const entriesInputName = (accession) => `${accession}_organism_entries.json`;
export const stagedInputName = (accession) => `${accession}_staged.json`;

const resolved = (value, constants) => value.replace(CONSTANT_REF, (whole, key) => constants[key] ?? whole);

/**
 * curated/update.json from the organism-entries input and the curator's "update" overrides: bump the one existing
 * entry (or the named one), or add a new entry when the curator names a new one and sets newEntry.
 */
export function deriveUpdate({ manifest, found, datasetClasses }, over = {}, { name } = {}) {
  const organism = manifest.organisms[0].proposedOrganismAbbrev;
  const cls = over.datasetClass;
  if (!datasetClasses.includes(cls)) throw new Error(`functional-update takes ${datasetClasses.join(', ')}; set "update": { "datasetClass": ... } in --overrides (got ${JSON.stringify(cls)})`);
  if (found.organism !== organism) throw new Error(`the organism-entries input is for ${found.organism}, not ${organism}; ${RERUN}`);
  if (found.datasetClass !== cls) throw new Error(`the organism-entries input lists ${found.datasetClass} entries, not ${cls}; ${RERUN}`);
  if (found.pendingGenomes?.length) throw new Error(`genome proposal ${found.pendingGenomes.join(', ')} on master names ${organism}; update it after that genome loads`);
  if (typeof over.functionalAnnotationSource !== 'string' || !over.functionalAnnotationSource.trim()) {
    throw new Error('functionalAnnotationSource has no default; ask the curator and set "update": { "functionalAnnotationSource": ... } in --overrides');
  }
  const names = found.entries.map((e) => e.name);
  let chosen = null;
  if (name === undefined) {
    if (over.newEntry) throw new Error('a new entry needs a "name" in --overrides');
    if (found.entries.length !== 1) throw new Error(`${organism} has ${found.entries.length} ${cls} entries (${names.join(', ') || 'none'}); set "name" in --overrides`);
    [chosen] = found.entries;
  } else if (names.includes(name)) {
    if (over.newEntry) throw new Error(`${name} already exists; drop "newEntry" to update it`);
    chosen = found.entries.find((e) => e.name === name);
  } else if (!over.newEntry) {
    throw new Error(`${organism} has no ${cls} entry named ${name} (it has ${names.join(', ') || 'none'}); set "update": { "newEntry": true } to add one`);
  }
  if (chosen && typeof chosen.version !== 'string') {
    throw new Error(`${organism}'s ${cls} entry ${chosen.name} has no version prop, so there is nothing to bump; ask the data loaders to fix the organism file`);
  }
  return {
    schemaVersion: UPDATE_SCHEMA_VERSION,
    datasetClass: cls,
    mode: chosen ? 'bump' : 'new',
    name: chosen?.name ?? name,
    previousVersion: chosen ? resolved(chosen.version, found.constants) : null,
    history: { functionalAnnotationSource: over.functionalAnnotationSource.trim(), text: over.text ?? DEFAULT_HISTORY_TEXT }
  };
}

/** The entry's props: a bump keeps the existing entry's (refusing constants outside carried), a new entry takes the class defaults. */
export function entryProps(update, found, carried) {
  if (update.mode === 'new') return { ...(FUNCTIONAL_DEFAULTS[update.datasetClass] ?? {}) };
  const existing = found.entries.find((e) => e.name === update.name);
  if (!existing) throw new Error(`the organism-entries input has no ${update.datasetClass} named ${update.name}; ${RERUN}`);
  const props = Object.fromEntries(Object.entries(existing.props).filter(([k]) => !IDENTITY.includes(k)));
  for (const [k, v] of Object.entries(props)) {
    for (const [, ref] of v.matchAll(CONSTANT_REF)) {
      if (!carried.includes(ref)) throw new Error(`props.${k} references $$${ref}$$, which a functional update cannot carry; ask the data loaders`);
    }
  }
  return props;
}

/** Agreement problems between update.json, the entry, the manifest's staging and the staged upload. */
export function updateProblems({ update, entry, manifest, staged }) {
  const problems = [];
  if (update?.schemaVersion !== UPDATE_SCHEMA_VERSION) problems.push(`curated/${UPDATE_FILENAME} must be schemaVersion ${UPDATE_SCHEMA_VERSION}`);
  if (!MODES.includes(update?.mode)) problems.push(`curated/${UPDATE_FILENAME} mode must be ${MODES.join(' or ')}`);
  if (!update?.history?.functionalAnnotationSource) problems.push(`curated/${UPDATE_FILENAME} history.functionalAnnotationSource is required`);
  if (!update?.history?.text) problems.push(`curated/${UPDATE_FILENAME} history.text is required`);
  if (entry.datasetClass !== update?.datasetClass || entry.name !== update?.name) {
    problems.push(`the entry is ${entry.datasetClass} ${entry.name}, but curated/${UPDATE_FILENAME} says ${update?.datasetClass} ${update?.name}`);
  }
  if (!isDate(entry.version)) problems.push(`version ${entry.version} must be a real date, YYYY-MM-DD`);
  else if (update?.mode === 'bump' && !isDate(update.previousVersion)) {
    problems.push(`current version "${update.previousVersion}" of ${update.datasetClass} ${update.name} is not a date; compare by hand and confirm with update.newEntry or fix the organism file`);
  } else if (update?.previousVersion && !(entry.version > update.previousVersion)) problems.push(`version ${entry.version} must be later than the entry's current ${update.previousVersion}`);
  const listed = manifest.staging ?? [];
  if (listed.length !== 1 || listed[0].path !== staged.file || listed[0].sha256 !== staged.sha256) {
    problems.push(`manifest staging must list exactly the staged ${staged.file} with its sha256; re-run stage-file.js and pass its "staging" in --overrides`);
  }
  if (entry.source?.type !== 'server' || entry.source.paths?.[0] !== staged.path) problems.push(`the entry's source must be the staged ${staged.path}`);
  return problems;
}
