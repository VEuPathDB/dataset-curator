import { join } from 'node:path';

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

/** Inserts before the final closing </datasets>, one blank line either side. */
export function insertDataset(fileContent, block) {
  const nl = fileContent.includes('\r\n') ? '\r\n' : '\n';
  const closing = '</datasets>';
  const idx = fileContent.lastIndexOf(closing);
  if (idx === -1) throw new Error(`Dataset file has no closing ${closing} tag`);
  const before = fileContent.slice(0, idx).replace(/\s*$/, `${nl}${nl}`);
  return `${before}${block.replace(/\r?\n/g, nl)}${nl}${closing}${nl}`;
}
