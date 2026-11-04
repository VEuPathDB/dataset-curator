import { readFileSync, existsSync } from 'node:fs';
import { join, posix } from 'node:path';
import { projectOf } from './manifest.js';

export const CLASSES_RELATIVE_PATH = 'Model/lib/xml/datasetClass/classes.xml';
/** Props a <dataset> element takes from its entry and organism, never from the entry's props. */
export const IDENTITY_PROPS = ['projectName', 'organismAbbrev', 'name', 'version'];

const EMPTY_GET = 'common/empty';

/**
 * Where a class loads from, relative to @@manualDeliveryDir@@: { dir, file }, file null for a whole directory.
 * manualGet common/empty defers to its "ln -s @@manualDeliveryDir@@/..." unpack; any other manualGet names the path.
 * Other unpack steps run at load and are not read here.
 */
function deliveryOf(block, className) {
  const fileOrDir = block.match(/<manualGet\s+fileOrDir="([^"]+)"/)?.[1];
  const linked = block.match(/<unpack>\s*ln\s+-s\s+@@manualDeliveryDir@@\/(\S+)/)?.[1];
  const path = fileOrDir === undefined || fileOrDir === EMPTY_GET ? linked : fileOrDir;
  if (!path) {
    throw new Error(`Dataset class "${className}" declares no manual delivery: neither <manualGet fileOrDir="..."> nor manualGet ${EMPTY_GET} with "<unpack>ln -s @@manualDeliveryDir@@/..." in ${CLASSES_RELATIVE_PATH}`);
  }
  const trimmed = path.replace(/\/+$/, '');
  const [dir, file] = posix.basename(trimmed) === 'final' ? [trimmed, null] : [posix.dirname(trimmed), posix.basename(trimmed)];
  if (posix.basename(dir) !== 'final') throw new Error(`Dataset class "${className}" delivers from "${path}", which is not a final/ directory or a file in one`);
  return { dir, file };
}

/**
 * One class from classes.xml: its <prop> names, the datasetLoader datasetName
 * pattern, and where its manual delivery is (see deliveryOf).
 * Regex scan rather than an XML parser: the file is large, flat and uses
 * DTD entities a parser would need resolving.
 */
export function parseDatasetClass(xml, className) {
  const blocks = [...xml.matchAll(/<datasetClass\s+class="([^"]+)"[^>]*>([\s\S]*?)<\/datasetClass>/g)];
  const block = blocks.find(([, name]) => name === className)?.[2];
  if (block === undefined) throw new Error(`Dataset class "${className}" not found in ${CLASSES_RELATIVE_PATH}`);

  // Props of nested elements (datasetLoader and below) are not class props.
  const head = block.split(/<datasetLoader\b/)[0];
  const props = [...head.matchAll(/<prop\s+name="([^"]+)"/g)].map(m => m[1]);
  const datasetNamePattern = block.match(/<datasetLoader\b[^>]*\bdatasetName="([^"]+)"/)?.[1];
  if (!datasetNamePattern) throw new Error(`Dataset class "${className}" has no datasetLoader datasetName in ${CLASSES_RELATIVE_PATH}`);
  return { className, props, datasetNamePattern, delivery: deliveryOf(block, className) };
}

export function readDatasetClass(repoPath, className) {
  const path = join(repoPath, CLASSES_RELATIVE_PATH);
  if (!existsSync(path)) throw new Error(`${CLASSES_RELATIVE_PATH} not found in ${repoPath}`);
  return parseDatasetClass(readFileSync(path, 'utf-8'), className);
}

export function readDatasetClassOnRef(git, ref, className) {
  if (!git.fileExistsOnRef(ref, CLASSES_RELATIVE_PATH)) throw new Error(`${CLASSES_RELATIVE_PATH} not found on ${ref}`);
  return parseDatasetClass(git.showFile(ref, CLASSES_RELATIVE_PATH), className);
}

/** Substitutes ${prop} placeholders from identity, refusing any it cannot fill. */
export function expandPattern(pattern, values) {
  return pattern.replace(/\$\{(\w+)\}/g, (whole, key) => {
    if (values[key] === undefined) throw new Error(`No value for ${whole} in "${pattern}"`);
    return values[key];
  });
}

/** The identity values the class patterns use, for one of the proposal's organisms. */
export const identityValues = (m, organism) => ({
  projectName: projectOf(m, organism), organismAbbrev: organism, name: m.name, version: m.version
});
