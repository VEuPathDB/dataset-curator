import { join } from 'node:path';

export function presenterFileRelativePath(project) {
  return `Model/lib/xml/datasetPresenters/${project}.xml`;
}

export function presenterFilePath(repoPath, project) {
  return join(repoPath, presenterFileRelativePath(project));
}

const PRESENTERS_DIR = 'Model/lib/xml/datasetPresenters';

export function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Presenter files on ref with a presenter whose datasetNamePattern is pattern. */
export function filesWithNamePattern(git, ref, pattern) {
  const hits = git.grepOnRef(ref, `datasetNamePattern *= *"${escapeRegExp(pattern)}"`, PRESENTERS_DIR);
  return [...new Set(hits.map((h) => h.path))];
}

/**
 * Note: this is a plain regex scan, not an XML parser, so it will also match
 * a name that appears inside an XML comment. Deliberately conservative.
 */
export function presenterNameExists(fileContent, name) {
  return new RegExp(`<datasetPresenter\\s+name\\s*=\\s*"${escapeRegExp(name)}"`).test(fileContent);
}

export function extractPresenterName(block) {
  const m = block.match(/<datasetPresenter\s+name\s*=\s*"([^"]+)"/);
  if (!m) throw new Error('Rendered block has no <datasetPresenter name="..."> element');
  return m[1];
}

/** Inserts before the final closing root tag; dataset types own their own indentation. */
export function insertPresenter(fileContent, block) {
  const nl = fileContent.includes('\r\n') ? '\r\n' : '\n';
  const closing = '</datasetPresenters>';
  const idx = fileContent.lastIndexOf(closing);
  if (idx === -1) throw new Error(`Presenter file has no closing ${closing} tag`);
  const before = fileContent.slice(0, idx).replace(/\s*$/, `${nl}${nl}`);
  const normalizedBlock = block.replace(/\r?\n/g, nl);
  return `${before}${normalizedBlock}${nl}${nl}${closing}${nl}`;
}
