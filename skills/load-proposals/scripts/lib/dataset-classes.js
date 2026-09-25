import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const CLASSES_RELATIVE_PATH = 'Model/lib/xml/datasetClass/classes.xml';
/** Props every dataset carries from its manifest, not from curated/dataset.json. */
export const IDENTITY_PROPS = ['projectName', 'organismAbbrev', 'name', 'version'];

/**
 * One class from classes.xml: its <prop> names, the datasetLoader datasetName
 * pattern, and the @@manualDeliveryDir@@ path its <unpack> links from.
 * Regex scan rather than an XML parser: the file is large, flat and uses
 * DTD entities a parser would need resolving.
 */
export function readDatasetClass(repoPath, className) {
  const path = join(repoPath, CLASSES_RELATIVE_PATH);
  if (!existsSync(path)) throw new Error(`${CLASSES_RELATIVE_PATH} not found in ${repoPath}`);
  const xml = readFileSync(path, 'utf-8');
  const blocks = [...xml.matchAll(/<datasetClass\s+class="([^"]+)"[^>]*>([\s\S]*?)<\/datasetClass>/g)];
  const block = blocks.find(([, name]) => name === className)?.[2];
  if (block === undefined) throw new Error(`Dataset class "${className}" not found in ${CLASSES_RELATIVE_PATH}`);

  // Props of nested elements (datasetLoader and below) are not class props.
  const head = block.split(/<datasetLoader\b/)[0];
  const props = [...head.matchAll(/<prop\s+name="([^"]+)"/g)].map(m => m[1]);
  const datasetNamePattern = block.match(/<datasetLoader\b[^>]*\bdatasetName="([^"]+)"/)?.[1];
  const deliveryPath = block.match(/<unpack>\s*ln\s+-s\s+(@@manualDeliveryDir@@\/\S+)/)?.[1];
  if (!datasetNamePattern) throw new Error(`Dataset class "${className}" has no datasetLoader datasetName in ${CLASSES_RELATIVE_PATH}`);
  if (!deliveryPath) throw new Error(`Dataset class "${className}" has no "<unpack>ln -s @@manualDeliveryDir@@/..." line in ${CLASSES_RELATIVE_PATH}`);
  return { className, props, datasetNamePattern, deliveryPath };
}

/** Substitutes ${prop} placeholders from identity, refusing any it cannot fill. */
export function expandPattern(pattern, values) {
  return pattern.replace(/\$\{(\w+)\}/g, (whole, key) => {
    if (values[key] === undefined) throw new Error(`No value for ${whole} in "${pattern}"`);
    return values[key];
  });
}

/** The identity values the class patterns use, from a manifest. */
export const identityValues = (m) => ({
  projectName: m.project, organismAbbrev: m.organismAbbrev, name: m.name, version: m.version
});
