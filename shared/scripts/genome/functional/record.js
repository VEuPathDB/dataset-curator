import { join } from 'node:path';
import { GENERATOR } from '../record.js';
import { PipelineError, readJson } from '../workdir.js';

/** The functional.json contract; bump when its shape changes. */
export const FUNCTIONAL_SCHEMA_VERSION = 1;
export const FUNCTION_DIR = 'final/function';
const RERUN = 'run functional again';

export const functionalPaths = (workDir) => ({
  functionDir: join(workDir, FUNCTION_DIR),
  stagedDir: join(workDir, `${FUNCTION_DIR}.tmp`),
  functionalJson: join(workDir, 'functional.json')
});

export function newFunctionalRecord({ genomeBuildSha256, source, datasets, findings }) {
  return {
    schemaVersion: FUNCTIONAL_SCHEMA_VERSION,
    generator: { ...GENERATOR },
    genomeBuild: { sha256: genomeBuildSha256 },
    source,
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
    && Array.isArray(record.datasets) && Array.isArray(record.findings);
  if (!complete) throw new PipelineError(command, functionalJson, 'is incomplete: it needs genomeBuild.sha256, source, datasets and findings', RERUN);
  return record;
}
