import { readCuratedJson, constantsOf, ORGANISM_RECORD_FILENAME, AMENDED_ORGANISM_KEYS } from '../../_common.js';
import { ORGANISM_RECORD_SCHEMA_VERSION } from '../amendment.js';
import { organismValueProblems } from '../organism-values.js';

const NAME = 'organismRecord';
const AMEND = 'run amend-proposal.js and publish';
const isString = (v) => typeof v === 'string';

/** What keeps an organism record from rendering the organism dataset: an unamended record, a missing or malformed prop, or constants that disagree with it. */
export function organismRecordProblems(record, constants) {
  if (record.schemaVersion > ORGANISM_RECORD_SCHEMA_VERSION) {
    return [`curated/organism.json is schema version ${record.schemaVersion}, newer than this tool knows; update the tool`];
  }
  if (record.schemaVersion !== ORGANISM_RECORD_SCHEMA_VERSION) {
    return [`curated/organism.json is schema version ${record.schemaVersion}, without the props preprocessing adds; ${AMEND}`];
  }
  const problems = AMENDED_ORGANISM_KEYS.filter((k) => !isString(record[k])).map((k) => (record[k] === undefined ? `curated/organism.json has no ${k}; ${AMEND}` : `${k} must be a string`));
  problems.push(...organismValueProblems(record));
  for (const k of ['genomeSource', 'genomeVersion']) {
    if (record[k] !== undefined && constants[k] !== record[k]) problems.push(`constant ${k} is "${constants[k] ?? ''}" but the organism record says "${record[k]}"; ${AMEND}`);
  }
  if (record.isFamilyRepresentative === 'true') {
    for (const k of ['familyNcbiTaxonIds', 'familyNameForFiles']) {
      if (!record[k]) problems.push(`a family representative needs ${k}; run amend-proposal.js --organism ${k}=... and publish`);
    }
  }
  return problems;
}

export const organismRecord = {
  name: NAME,
  kind: 'content',
  tools: [],
  run: async ({ proposalDir }) => organismRecordProblems(readCuratedJson(proposalDir, ORGANISM_RECORD_FILENAME), constantsOf(proposalDir))
    .map((message) => ({ validator: NAME, severity: 'error', message }))
};
