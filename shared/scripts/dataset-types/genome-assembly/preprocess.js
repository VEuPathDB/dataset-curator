import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { sha256File } from '../../lib/file-hash.js';
import { readGenomeBuild, partitionName } from '../../genome/genome-build.js';
import { PipelineError, readJson, workPaths } from '../../genome/workdir.js';
import { readTrialRecord, trialPaths } from '../../genome/trial/record.js';
import { checkFunctionalCurrent, functionalPaths, readFunctionalRecord } from '../../genome/functional/record.js';

const COMMAND = 'verify';
const RERUN_TRIAL = 'the data loader runs genome-pipeline.js trial --undo, then trial';

function readFetchRecord(workArea) {
  const { fetchJson } = workPaths(workArea);
  const record = readJson(fetchJson, COMMAND, 'run genome-pipeline.js fetch');
  if (!['gff', 'fasta', 'report'].every((role) => typeof record?.files?.[role]?.url === 'string')) {
    throw new PipelineError(COMMAND, fetchJson, 'is incomplete: it needs files.gff, files.fasta and files.report with their url', 'delete fetch/fetch.json and run fetch again');
  }
  return record;
}

/**
 * The work area's records, each refused when missing or of an unknown schema version:
 * { genomeBuild, trial, functional, fetch, sha256: { genomeBuild, trial, functional } }.
 */
export function readPreprocessed(workArea, { afterHashing = () => {} } = {}) {
  const { genomeBuildJson } = workPaths(workArea);
  const { trialJson } = trialPaths(workArea);
  const { functionalJson } = functionalPaths(workArea);
  const hashed = Object.fromEntries([['genomeBuild', genomeBuildJson], ['trial', trialJson], ['functional', functionalJson]]
    .map(([key, file]) => [key, { file, sha: existsSync(file) ? sha256File(file) : null }]));
  afterHashing();
  const { build: genomeBuild } = readGenomeBuild(workArea, COMMAND);
  const trial = readTrialRecord(trialJson);
  if (!trial) throw new PipelineError(COMMAND, trialJson, 'is missing', 'the data loader runs genome-pipeline.js trial');
  const functional = readFunctionalRecord(workArea, COMMAND);
  const fetch = readFetchRecord(workArea);
  for (const { file, sha } of Object.values(hashed)) {
    if (!existsSync(file) || sha256File(file) !== sha) throw new PipelineError(COMMAND, file, 'changed while it was being read', 'run the verification again');
  }
  return { genomeBuild, trial, functional, fetch, sha256: Object.fromEntries(Object.entries(hashed).map(([key, { sha }]) => [key, sha])) };
}

/** What makes the work area undeliverable, each with the step that fixes it; the records validator and the delivery hook both use it. */
export function preprocessedProblems(records, workArea) {
  const { genomeBuild, trial, functional, sha256 } = records;
  const problems = [];
  if (trial.result !== 'passed') problems.push(`trial/trial.json: the trial result is "${trial.result}", not "passed"; ${RERUN_TRIAL}`);
  if (trial.genomeBuild.sha256 !== sha256.genomeBuild) problems.push(`trial/trial.json is for an older genome-build.json; ${RERUN_TRIAL}`);
  for (const part of genomeBuild.partitions) {
    const name = partitionName(part);
    const loaded = trial.loaded[name] ?? {};
    for (const [key, file] of Object.entries(part.final).filter(([, f]) => f)) {
      const path = join(part.dir, file);
      const at = join(workArea, path);
      if (!existsSync(at) || loaded[key] !== sha256File(at)) problems.push(`${path} is not the file the trial loaded; ${RERUN_TRIAL}`);
    }
    const produced = trial.outputs[name] ?? {};
    if (part.featureCount > 0 && !Object.keys(produced).length) problems.push(`trial/trial.json records no transcriptInfoAndIds for ${name}; ${RERUN_TRIAL}`);
    for (const [file, digest] of Object.entries(produced)) {
      const path = join(part.dir, file);
      const at = join(workArea, path);
      if (!existsSync(at) || sha256File(at) !== digest) problems.push(`${path} is not the file the trial produced; ${RERUN_TRIAL}`);
    }
  }
  problems.push(...checkFunctionalCurrent(functional, workArea, sha256.genomeBuild).map((p) => `${p}; run genome-pipeline.js functional again`));
  if (!trial.undone && !trial.kept) problems.push('trial/trial.json: the trial rows are neither undone nor kept; the data loader runs genome-pipeline.js trial --undo');
  return problems;
}
