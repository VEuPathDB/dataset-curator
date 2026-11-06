import { readCuratedJson, constantsOf, ORGANISM_RECORD_FILENAME, AMENDED_ORGANISM_KEYS } from '../../_common.js';
import { ORGANISM_RECORD_SCHEMA_VERSION } from '../amendment.js';

const NAME = 'organismRecord';
const AMEND = 'run amend-proposal.js and publish';
const BOOLEANS = ['annotationIncludesTRNAs', 'isHugeGenome', 'isNotEbiGenome', 'isCore', 'runExportPred', 'isFamilyRepresentative'];
const isString = (v) => typeof v === 'string';

/** What keeps an organism record from rendering the organism dataset: an unamended record, a missing or malformed prop, or constants that disagree with it. */
export function organismRecordProblems(record, constants) {
  if (record.schemaVersion !== ORGANISM_RECORD_SCHEMA_VERSION) {
    return [`curated/organism.json is schema version ${record.schemaVersion}, without the props preprocessing adds; ${AMEND}`];
  }
  const problems = AMENDED_ORGANISM_KEYS.filter((k) => !isString(record[k])).map((k) => `curated/organism.json has no ${k}; ${AMEND}`);
  for (const k of BOOLEANS) {
    if (isString(record[k]) && record[k] !== 'true' && record[k] !== 'false') problems.push(`${k} must be "true" or "false", not "${record[k]}"`);
  }
  if (isString(record.maxIntronSize) && !/^[1-9]\d*$/.test(record.maxIntronSize)) problems.push(`maxIntronSize must be a positive integer, not "${record.maxIntronSize}"`);
  if (isString(record.orthomclAbbrev) && !/^[a-z]{4,8}$/.test(record.orthomclAbbrev)) problems.push(`orthomclAbbrev must be 4 to 8 lowercase letters, not "${record.orthomclAbbrev}"`);
  for (const k of ['genomeSource', 'genomeVersion']) {
    if (constants[k] !== record[k]) problems.push(`constant ${k} is "${constants[k] ?? ''}" but the organism record says "${record[k]}"; ${AMEND}`);
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
