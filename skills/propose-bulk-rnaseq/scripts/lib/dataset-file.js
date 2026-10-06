import { join } from 'node:path';
import { likeToRegExp, namePatternsOnRef } from './presenter-file.js';

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
  for (const [, cls, body] of fileContent.matchAll(/<dataset\s+class="([^"]+)"[^>]*>([\s\S]*?)<\/dataset>/g)) {
    if (cls !== className) continue;
    const found = body.match(/<prop\s+name="name">\s*([^<]*?)\s*<\/prop>/)?.[1];
    if (found === name) return true;
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
