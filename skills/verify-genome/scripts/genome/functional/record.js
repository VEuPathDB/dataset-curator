import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { GENERATOR } from '../record.js';
import { PipelineError, readJson, sha256File } from '../workdir.js';

/** The functional.json contract; bump when its shape changes. */
export const FUNCTIONAL_SCHEMA_VERSION = 1;
export const FUNCTION_DIR = 'final/function';
const RERUN = 'run functional again';

export const functionalPaths = (workDir) => ({
  functionDir: join(workDir, FUNCTION_DIR),
  stagedDir: join(workDir, `${FUNCTION_DIR}.tmp`),
  functionalJson: join(workDir, 'functional.json')
});

export function newFunctionalRecord({ genomeBuildSha256, source, taxonId, gafDate, datasets, findings }) {
  return {
    schemaVersion: FUNCTIONAL_SCHEMA_VERSION,
    generator: { ...GENERATOR },
    genomeBuild: { sha256: genomeBuildSha256 },
    source,
    taxonId,
    gafDate,
    datasets: datasets.map((d) => ({
      datasetClass: d.datasetClass,
      name: d.name,
      file: `${FUNCTION_DIR}/${d.datasetClass}/${d.name}/${d.file}`,
      rows: d.rows.length,
      sha256: d.sha256,
      ids: { level: d.level, count: new Set(d.rows.map((row) => row[0])).size },
      props: d.props
    })),
    findings
  };
}

export function readFunctionalRecord(workDir, command) {
  const { functionalJson } = functionalPaths(workDir);
  const record = readJson(functionalJson, command, 'run functional');
  if (record?.schemaVersion !== FUNCTIONAL_SCHEMA_VERSION) {
    throw new PipelineError(command, functionalJson, `has schemaVersion ${record?.schemaVersion}, not ${FUNCTIONAL_SCHEMA_VERSION}`, RERUN);
  }
  const complete = typeof record.genomeBuild?.sha256 === 'string' && typeof record.source === 'string'
    && (record.taxonId === null || typeof record.taxonId === 'string') && typeof record.gafDate === 'string'
    && Array.isArray(record.datasets) && Array.isArray(record.findings);
  if (!complete) {
    throw new PipelineError(command, functionalJson, 'is incomplete: it needs genomeBuild.sha256, source, taxonId, gafDate, datasets and findings', RERUN);
  }
  return record;
}

/** Problems that make a record stale: a newer genome-build.json, or dataset files that are gone or changed. */
export function checkFunctionalCurrent(record, workDir, genomeBuildSha256) {
  const problems = [];
  if (record.genomeBuild.sha256 !== genomeBuildSha256) problems.push('functional.json is for an older genome-build.json');
  for (const d of record.datasets) {
    const path = join(workDir, d.file);
    if (!existsSync(path)) problems.push(`${d.file} is missing`);
    else if (sha256File(path) !== d.sha256) problems.push(`${d.file} does not match functional.json`);
  }
  return problems;
}
