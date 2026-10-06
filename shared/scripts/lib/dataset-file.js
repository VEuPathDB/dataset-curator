import { join } from 'node:path';
import { escapeRegExp, filesWithNamePattern } from './presenter-file.js';

const DATASETS_DIR = 'Datasets/lib/xml/datasets';

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

/** Organism files on ref, in any project, with a dataset of this class and name. */
export function filesWithDatasetName(git, ref, className, name) {
  const hits = git.grepOnRef(ref, `<prop +name="name"> *${escapeRegExp(name)} *</prop>`, DATASETS_DIR);
  return [...new Set(hits.map((h) => h.path))].filter((path) => datasetNameExists(git.showFile(ref, path), className, name));
}

/**
 * What a presenter's datasetNamePattern would make name collide with on ref, or
 * null: for a multi-organism presenter, a dataset of that name in any organism
 * file; for a single organism, another presenter whose pattern matches it.
 */
export function namePatternClash(git, ref, { className, name, pattern, multi }) {
  if (multi) {
    const file = filesWithDatasetName(git, ref, className, name)[0];
    return file ? `${file} on ${ref} already has a ${className} named "${name}", which the multi-organism presenter's datasetNamePattern "${pattern}" would also match` : null;
  }
  const file = filesWithNamePattern(git, ref, pattern)[0];
  return file ? `${file} on ${ref} has a presenter with datasetNamePattern "${pattern}", which would also match this proposal's dataset` : null;
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
