import * as genomeAssembly from './genome-assembly.js';
import * as bulkRnaseq from './bulk-rnaseq.js';
import * as dnaseq from './dnaseq.js';
import * as chipseq from './chipseq.js';
import * as functionalUpdate from './functional-update.js';
import { unknownDatasetType } from '../lib/manifest.js';

/** Every dataset type, by the datasetType a manifest names. */
export const DATASET_TYPES = { 'genome-assembly': genomeAssembly, 'bulk-rnaseq': bulkRnaseq, dnaseq, chipseq, 'functional-update': functionalUpdate };

export async function loadDatasetType(datasetType) {
  if (!Object.hasOwn(DATASET_TYPES, datasetType)) throw new Error(unknownDatasetType(datasetType));
  return DATASET_TYPES[datasetType];
}
