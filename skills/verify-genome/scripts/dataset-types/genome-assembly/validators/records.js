import { PipelineError } from '../../../genome/workdir.js';
import { preprocessedProblems, readPreprocessed } from '../preprocess.js';

const NAME = 'records';

/** The work area's records, or null when they cannot be read; the records validator reports why. */
export function recordsOrNull(workArea) {
  try {
    return readPreprocessed(workArea);
  } catch (e) {
    if (e instanceof PipelineError) return null;
    throw e;
  }
}

export const records = {
  name: NAME,
  kind: 'preprocess',
  tools: [],
  run: async ({ workArea, extras }) => {
    const found = readPreprocessed(workArea);
    if (extras) extras.preprocess = found.sha256;
    return preprocessedProblems(found, workArea).map((message) => ({ validator: NAME, severity: 'error', message }));
  }
};
