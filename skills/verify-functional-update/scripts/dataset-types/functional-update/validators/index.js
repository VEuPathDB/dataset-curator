import { converted } from './converted.js';
import { updateRecord } from './update-record.js';

/** converted first, so the report's preprocess sha256 comes from it. */
export const validators = [converted, updateRecord];
