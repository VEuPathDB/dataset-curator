import { isDeepStrictEqual } from 'node:util';
import { constantsOf, datasetsOf, readCuratedJson, ORGANISM_RECORD_FILENAME } from '../../_common.js';
import { constantsFrom, reportOf } from '../amendment.js';
import { entriesFrom } from '../entries.js';
import { recordsOrNull } from './records.js';

const NAME = 'matchesBuild';
const MESSAGE = 'the proposal was amended from another build; re-run amend-proposal and publish';

export const matchesBuild = {
  name: NAME,
  kind: 'preprocess',
  tools: [],
  run: async ({ workArea, proposalDir, manifest }) => {
    const found = recordsOrNull(workArea);
    if (!found) return [];
    const expected = constantsFrom(readCuratedJson(proposalDir, ORGANISM_RECORD_FILENAME), reportOf(proposalDir, manifest)).constants;
    const constants = constantsOf(proposalDir);
    const same = isDeepStrictEqual(datasetsOf(proposalDir, manifest), entriesFrom(found))
      && Object.entries(expected).every(([k, v]) => constants[k] === v);
    return same ? [] : [{ validator: NAME, severity: 'error', message: MESSAGE }];
  }
};
