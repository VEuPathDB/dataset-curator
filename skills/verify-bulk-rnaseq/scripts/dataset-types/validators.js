import { DATASET_TYPE_META, isDatasetTypeName } from './meta.js';
import { loadLazy } from './lazy.js';

// A type with validators must have a current, non-failing report before mark-ready (see hasValidators in meta.js).
// Literal paths, so a skill's closure can see them; a skill that does not carry a type's validators gets a plain error.
const LOADERS = {
  'bulk-rnaseq': () => import('./bulk-rnaseq/validators/index.js'),
  'genome-assembly': () => import('./genome-assembly/validators/index.js'),
  'functional-update': () => import('./functional-update/validators/index.js')
};

export { hasValidators } from './meta.js';
export const validatorsFor = async (datasetType) => (Object.hasOwn(LOADERS, datasetType)
  ? (await loadLazy(LOADERS[datasetType], import.meta.url, `the ${datasetType} validators`)).validators
  : []);
export const validationWorkspaceFor = (datasetType) => (isDatasetTypeName(datasetType) ? DATASET_TYPE_META[datasetType].validationWorkspace : null);
export const validationWorkspaceNames = () => [...new Set(Object.values(DATASET_TYPE_META).map((t) => t.validationWorkspace))];
