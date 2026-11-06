const BOOLEANS = ['annotationIncludesTRNAs', 'isHugeGenome', 'isNotEbiGenome', 'isCore', 'runExportPred', 'isFamilyRepresentative'];
const isString = (v) => typeof v === 'string';

/** What is wrong with the amended organism props that are present and strings; the amendment and the organismRecord validator share it. */
export function organismValueProblems(record) {
  const problems = [];
  for (const k of BOOLEANS) {
    if (isString(record[k]) && record[k] !== 'true' && record[k] !== 'false') problems.push(`${k} must be "true" or "false", not "${record[k]}"`);
  }
  if (isString(record.maxIntronSize) && !/^[1-9]\d*$/.test(record.maxIntronSize)) problems.push(`maxIntronSize must be a positive integer, not "${record.maxIntronSize}"`);
  if (isString(record.orthomclAbbrev) && !/^[a-z]{4,8}$/.test(record.orthomclAbbrev)) problems.push(`orthomclAbbrev must be 4 to 8 lowercase letters, not "${record.orthomclAbbrev}"`);
  return problems;
}
