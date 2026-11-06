import { libraryType } from './library-type.js';
import { consistency } from './consistency.js';
import { perlParse } from './perl-parse.js';
import { stf } from './stf.js';

/** Run order matters: the report lists findings in this order. */
export const validators = [libraryType, consistency, perlParse, stf];
