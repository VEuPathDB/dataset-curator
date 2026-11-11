import { join } from 'node:path';
import { likeToRegExp, namePatternsOnRef, maskComments } from './presenter-file.js';
import { sameDatasetName } from './dataset-classes.js';

const DATASET_BLOCK = /<dataset\s+class="([^"]+)"[^>]*>([\s\S]*?)<\/dataset>/g;
const PROP = /<prop\s+name="([^"]+)">\s*([^<]*?)\s*<\/prop>/g;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const FUNCT_ANNOT_VERSION = '$$functAnnotVersion$$';
const DATASETS_DIR = 'Datasets/lib/xml/datasets';
const ORGANISM_FILE = /^Datasets\/lib\/xml\/datasets\/[^/]+\/([^/]+)\.xml$/;
const NAME_PROP = /<prop\s+name="name">\s*([^<]*?)\s*<\/prop>/;

export function datasetFileRelativePath(project, organismAbbrev) {
  return `Datasets/lib/xml/datasets/${project}/${organismAbbrev}.xml`;
}

export function datasetFilePath(repoPath, project, organismAbbrev) {
  return join(repoPath, datasetFileRelativePath(project, organismAbbrev));
}

/**
 * Whether the organism file already has a dataset of this class and name.
 * Regex scan, not an XML parser, so a match inside a comment counts too.
 */
export function datasetNameExists(fileContent, className, name) {
  for (const [, cls, body] of fileContent.matchAll(DATASET_BLOCK)) {
    if (cls !== className) continue;
    const found = body.match(NAME_PROP)?.[1];
    if (found === name) return true;
  }
  return false;
}

/**
 * Whether the organism file already has a dataset with the entry's datasetName: one of classDef's class
 * whose props match the entry's on the values the datasetName uses. Regex scan, so commented-out datasets count.
 */
export function entryDatasetExists(fileContent, classDef, entry) {
  for (const [, cls, body] of fileContent.matchAll(DATASET_BLOCK)) {
    if (cls !== classDef.className) continue;
    const props = Object.fromEntries([...body.matchAll(PROP)].map(([, k, v]) => [k, v]));
    if (sameDatasetName(classDef, { name: props.name, version: props.version, props }, entry)) return true;
  }
  return false;
}

/**
 * Datasets of className on ref, in any organism file, whose full name
 * fullName(abbrev, name) matches re, as { path, name }. Commented-out datasets count.
 */
export function datasetsMatching(git, ref, className, fullName, re) {
  const candidates = git.grepOnRef(ref, '<prop +name="name">', DATASETS_DIR).flatMap(({ path, text }) => {
    const abbrev = ORGANISM_FILE.exec(path)?.[1];
    const name = NAME_PROP.exec(text)?.[1];
    return abbrev && name !== undefined && re.test(fullName(abbrev, name)) ? [{ path, name }] : [];
  });
  return candidates.filter(({ path, name }) => datasetNameExists(git.showFile(ref, path), className, name));
}

/** Whether a dataset type's multi-organism presenter claims datasets by datasetNamePattern. */
export const usesNamePattern = (type) => Boolean(type.namePatternFor && type.datasetNameFor);

/**
 * Why datasetNamePattern (SQL LIKE) matching would make the proposal's datasets
 * collide on ref, or null: a pattern already there matching one of its datasets
 * or, with several organisms, its own pattern matching a dataset already there.
 * type supplies datasetNameFor(organism, name) and namePatternFor(name).
 */
export function namePatternClash(git, ref, type, { className, name, organisms }) {
  if (!usesNamePattern(type)) return null;
  const own = organisms.map((o) => type.datasetNameFor(o, name));
  for (const { path, pattern } of namePatternsOnRef(git, ref)) {
    const hit = own.find((d) => likeToRegExp(pattern).test(d));
    if (hit) return `${path} on ${ref} has a presenter with datasetNamePattern "${pattern}", which would also match this proposal's dataset ${hit}`;
  }
  if (organisms.length < 2) return null;
  const pattern = type.namePatternFor(name);
  const found = datasetsMatching(git, ref, className, type.datasetNameFor, likeToRegExp(pattern))[0];
  return found ? `${found.path} on ${ref} already has a ${className} named "${found.name}", which the multi-organism presenter's datasetNamePattern "${pattern}" would also match` : null;
}

/** Inserts before the final closing </datasets>, one blank line either side. */
export function insertDataset(fileContent, block) {
  const nl = fileContent.includes('\r\n') ? '\r\n' : '\n';
  const closing = '</datasets>';
  const idx = fileContent.lastIndexOf(closing);
  if (idx === -1) throw new Error(`Dataset file has no closing ${closing} tag`);
  const before = fileContent.slice(0, idx).replace(/\s*$/, `${nl}${nl}`);
  return `${before}${block.replace(/\r?\n/g, nl)}${nl}${closing}${nl}`;
}

/** The organism file's live (not commented-out) datasets of className as { index, end, text, props }. */
export function datasetsOfClass(fileContent, className) {
  return [...maskComments(fileContent).matchAll(DATASET_BLOCK)].filter(([, cls]) => cls === className).map((m) => ({
    index: m.index, end: m.index + m[0].length, text: fileContent.slice(m.index, m.index + m[0].length),
    props: Object.fromEntries([...m[2].matchAll(PROP)].map(([, k, v]) => [k, v]))
  }));
}

/** The organism file's top-level <constant> values by name; commented-out ones are skipped. */
export function organismFileConstants(fileContent) {
  return Object.fromEntries([...maskComments(fileContent).matchAll(/<constant\s+name="([^"]+)"\s+value="([^"]*)"\s*\/>/g)].map(([, k, v]) => [k, v]));
}

/**
 * Sets the version of the one dataset of op.datasetClass named op.name. Its current version must be op.version
 * (unchanged), an earlier date, or $$functAnnotVersion$$ (replaced with the literal). Idempotent.
 */
export function setEntryVersion(fileContent, { datasetClass, name, version }) {
  if (!ISO_DATE.test(version)) throw new Error(`version must be a date, YYYY-MM-DD; got "${version}"`);
  const found = datasetsOfClass(fileContent, datasetClass).filter((d) => d.props.name === name);
  if (found.length !== 1) throw new Error(found.length ? `${found.length} ${datasetClass} datasets are named ${name}` : `no ${datasetClass} dataset is named ${name}`);
  const [d] = found;
  const current = d.props.version;
  if (current === undefined) throw new Error(`the ${datasetClass} dataset named ${name} has no version prop`);
  if (current === version) return fileContent;
  if (!(current === FUNCT_ANNOT_VERSION || (ISO_DATE.test(current) && current < version))) {
    throw new Error(`the ${datasetClass} dataset named ${name} has version ${current}; only an earlier date or ${FUNCT_ANNOT_VERSION} is replaced by ${version}`);
  }
  const prop = /(<prop\s+name="version">)\s*[^<]*?\s*(<\/prop>)/.exec(maskComments(d.text));
  const next = d.text.slice(0, prop.index) + `${prop[1]}${version}${prop[2]}` + d.text.slice(prop.index + prop[0].length);
  return fileContent.slice(0, d.index) + next + fileContent.slice(d.end);
}
