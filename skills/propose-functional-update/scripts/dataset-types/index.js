import { unknownDatasetType } from '../lib/manifest.js';
import { isDatasetTypeName } from './meta.js';
import { loadLazy } from './lazy.js';

// Literal paths, so a skill's closure can see them. A skill carries only the dataset types it handles; asking it
// for another gets a plain error. Names, validation workspaces and library strategies need no module: see meta.js.
const LOADERS = {
  'genome-assembly': () => import('./genome-assembly.js'),
  'bulk-rnaseq': () => import('./bulk-rnaseq.js'),
  dnaseq: () => import('./dnaseq.js'),
  chipseq: () => import('./chipseq.js'),
  'functional-update': () => import('./functional-update.js')
};

export async function loadDatasetType(datasetType) {
  if (!isDatasetTypeName(datasetType)) throw new Error(unknownDatasetType(datasetType));
  return loadLazy(LOADERS[datasetType], import.meta.url, `dataset type "${datasetType}"`);
}
