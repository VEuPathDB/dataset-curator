import * as genomeAssembly from './genome-assembly.js';
import * as bulkRnaseq from './bulk-rnaseq.js';

/** Every dataset type, by the datasetType a manifest names. */
export const DATASET_TYPES = { 'genome-assembly': genomeAssembly, 'bulk-rnaseq': bulkRnaseq };
