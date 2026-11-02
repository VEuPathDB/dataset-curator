import * as genomeAssembly from './genome-assembly.js';
import * as bulkRnaseq from './bulk-rnaseq.js';
import * as dnaseq from './dnaseq.js';
import * as chipseq from './chipseq.js';

/** Every dataset type, by the datasetType a manifest names. */
export const DATASET_TYPES = { 'genome-assembly': genomeAssembly, 'bulk-rnaseq': bulkRnaseq, dnaseq, chipseq };
