import { libraryType } from './bulk-rnaseq/validators/library-type.js';
import { consistency } from './bulk-rnaseq/validators/consistency.js';
import { perlParse } from './bulk-rnaseq/validators/perl-parse.js';
import { stf } from './bulk-rnaseq/validators/stf.js';

// A type with validators must have a current, non-failing report before mark-ready.
const VALIDATORS = { 'bulk-rnaseq': [libraryType, consistency, perlParse, stf] };

export const validatorsFor = (datasetType) => VALIDATORS[datasetType] ?? [];
