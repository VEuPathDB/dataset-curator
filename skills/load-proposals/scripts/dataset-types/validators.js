import { DATASET_TYPES } from './index.js';
import { validators as bulkRnaseq } from './bulk-rnaseq/validators/index.js';

// A type with validators must have a current, non-failing report before mark-ready.
const VALIDATORS = { 'bulk-rnaseq': bulkRnaseq };

export const validatorsFor = (datasetType) => (Object.hasOwn(VALIDATORS, datasetType) ? VALIDATORS[datasetType] : []);
export const validationWorkspaceFor = (datasetType) => (Object.hasOwn(DATASET_TYPES, datasetType) ? DATASET_TYPES[datasetType].validationWorkspace : null);
export const validationWorkspaceNames = () => [...new Set(Object.values(DATASET_TYPES).map((t) => t.validationWorkspace))];
