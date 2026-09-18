import { join } from 'node:path';

export function presenterFileRelativePath(project) {
  return `Model/lib/xml/datasetPresenters/${project}.xml`;
}

export function presenterFilePath(repoPath, project) {
  return join(repoPath, presenterFileRelativePath(project));
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function presenterNameExists(fileContent, name) {
  return new RegExp(`<datasetPresenter\\s+name="${escapeRegExp(name)}"`).test(fileContent);
}

export function extractPresenterName(block) {
  const m = block.match(/<datasetPresenter\s+name="([^"]+)"/);
  if (!m) throw new Error('Rendered block has no <datasetPresenter name="..."> element');
  return m[1];
}

/** Inserts before the final closing root tag; renderers own their own indentation. */
export function insertPresenter(fileContent, block) {
  const closing = '</datasetPresenters>';
  const idx = fileContent.lastIndexOf(closing);
  if (idx === -1) throw new Error(`Presenter file has no closing ${closing} tag`);
  const before = fileContent.slice(0, idx).replace(/\s*$/, '\n\n');
  return `${before}${block}\n\n${closing}\n`;
}
