import { entryShape } from './entry-shape.js';
import { organismRecord } from './organism-record.js';

/** Run order matters: the report lists findings in this order. */
export const validators = [entryShape, organismRecord];
