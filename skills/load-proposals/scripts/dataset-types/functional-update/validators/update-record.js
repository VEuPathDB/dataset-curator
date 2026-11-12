import { checkCurated } from '../../functional-update.js';

const NAME = 'updateRecord';

export const updateRecord = {
  name: NAME,
  kind: 'content',
  tools: [],
  run: async ({ proposalDir }) => checkCurated(proposalDir).map((message) => ({ validator: NAME, severity: 'error', message }))
};
