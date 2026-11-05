import { copyFileSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { defaultExec } from '../../lib/tools/exec.js';
import { BIO_SEQIO_FIX, compileProblem, runPreprocessGFF3, SCRIPT_PATH } from '../preprocess-gff3.js';
import { BUILD_FILES, SCHEMA_VERSION } from '../record.js';
import { isIoError, PipelineError, readJson, recoverSwap, sha256File, swapDirs, workPaths, writeJsonAtomic } from '../workdir.js';
import { checkoutState, readIsfMapText } from './inputs.js';

function resolveScript(apiCommonData, preprocessGFF3, exec) {
  const script = preprocessGFF3 ?? join(apiCommonData, SCRIPT_PATH);
  if (!existsSync(script)) throw new PipelineError('finalize', script, 'is missing', 'point --apiCommonData at an ApiCommonData checkout');
  let problem;
  try {
    problem = compileProblem(script, { exec });
  } catch (e) {
    throw new PipelineError('finalize', 'perl', e.message, 'install perl or put it on PATH');
  }
  if (problem) throw new PipelineError('finalize', script, `does not compile:\n${problem}`, BIO_SEQIO_FIX);
  return script;
}

/** The map at finalize's checkout must be the one build validated the GFF against. */
function checkIsfMap(apiCommonData, build) {
  const { file, record } = readIsfMapText(apiCommonData, 'finalize');
  if (record.sha256 !== build.apiCommonData.isfMap.sha256) {
    throw new PipelineError('finalize', file, 'differs from the ISF map build checked against',
      'run build again with this checkout, or finalize with the checkout build used');
  }
  return record;
}

const stale = (file) => new PipelineError('finalize', file, 'changed since build', 'run build again');

const FILE_NAME = /^[\w.-]+$/;
const isName = (x) => typeof x === 'string' && FILE_NAME.test(x);
const isNameOrNull = (x) => x === null || isName(x);
const isDigestOrNull = (x) => x === null || typeof x === 'string';

function partitionOk(part) {
  const { final, buildFiles } = part ?? {};
  return typeof part?.dir === 'string'
    && isName(final?.fasta) && isNameOrNull(final.gff) && isNameOrNull(final.chromosomeMap)
    && typeof buildFiles?.gff3 === 'string' && typeof buildFiles.fasta === 'string' && isDigestOrNull(buildFiles.chromosomeMap);
}

function recordProblems(build) {
  const hasDigest = (x) => typeof x?.sha256 === 'string';
  const optionalFile = (key) => build?.[key] == null || (hasDigest(build[key]) && typeof build[key].file === 'string');
  const partitionsOk = Array.isArray(build?.partitions) && build.partitions.every(partitionOk);
  return [
    ...(hasDigest(build?.normalized) ? [] : ['normalized.sha256']),
    ...(hasDigest(build?.recipe) ? [] : ['recipe.sha256']),
    ...(hasDigest(build?.apiCommonData?.isfMap) ? [] : ['apiCommonData.isfMap.sha256']),
    ...['ids', 'partitionsTsv'].filter((key) => !optionalFile(key)).map((key) => `${key} file and sha256`),
    ...(partitionsOk ? [] : ['partitions, each with a dir, final file names and buildFiles'])
  ];
}

function checkRecord(build, p) {
  if (build?.schemaVersion !== SCHEMA_VERSION) throw new PipelineError('finalize', p.buildJson, 'was written by an older build', 'run build again');
  const problems = recordProblems(build);
  if (problems.length) throw new PipelineError('finalize', p.buildJson, `is incomplete: no ${problems.join(', ')}`, 'run build again');
}

/** Every input build recorded must still be on disk as build saw it. */
function checkNotStale(build, p, workDir) {
  if (!existsSync(p.normalized) || sha256File(p.normalized) !== build.normalized.sha256) {
    throw new PipelineError('finalize', p.normalized, 'does not match build/build.json', 'run build again');
  }
  if (!existsSync(p.recipeJson) || sha256File(p.recipeJson) !== build.recipe.sha256) throw stale(p.recipeJson);
  for (const recorded of [build.ids, build.partitionsTsv]) {
    if (!recorded) continue;
    const path = join(workDir, recorded.file);
    if (!existsSync(path) || sha256File(path) !== recorded.sha256) throw stale(path);
  }
  for (const part of build.partitions) {
    for (const [key, digest] of Object.entries(part.buildFiles)) {
      if (digest === null) continue;
      const path = join(p.buildDir, basename(part.dir), BUILD_FILES[key]);
      if (!existsSync(path) || sha256File(path) !== digest) throw stale(path);
    }
  }
}

/** Writes exactly the files build named in `part.final`, then checks each is there and non-empty. */
function finalizePartition(part, { script, exec, buildDir, outDir, workDir }) {
  const src = join(buildDir, basename(part.dir));
  const dest = join(outDir, basename(part.dir));
  const { final } = part;
  mkdirSync(dest, { recursive: true });
  if (final.gff) {
    const input = join(src, BUILD_FILES.gff3);
    try {
      runPreprocessGFF3(script, input, join(dest, final.gff), { exec });
    } catch (e) {
      const problem = e.input ? `preprocessGFF3 failed: ${e.output}` : e.message;
      throw new PipelineError('finalize', e.input ?? input, problem, 'fix the script or the build, then run finalize again');
    }
  }
  copyFileSync(join(src, BUILD_FILES.fasta), join(dest, final.fasta));
  if (final.chromosomeMap) copyFileSync(join(src, BUILD_FILES.chromosomeMap), join(dest, final.chromosomeMap));
  for (const name of Object.values(final).filter(Boolean)) {
    const staged = join(dest, name);
    if (!existsSync(staged) || statSync(staged).size === 0) {
      throw new PipelineError('finalize', join(workDir, part.dir, name), 'is missing or empty', 'run build and finalize again');
    }
  }
}

/** preprocessGFF3 per partition into final.tmp, swapped to final/, then genome-build.json last. */
export async function runFinalize({ workDir, apiCommonData, preprocessGFF3, exec = defaultExec, now = () => new Date().toISOString() }) {
  const p = workPaths(workDir);
  recoverSwap(p.buildDir);
  const build = readJson(p.buildJson, 'finalize', 'run build first');
  checkRecord(build, p);
  checkNotStale(build, p, workDir);
  const isfMap = checkIsfMap(apiCommonData, build);
  const script = resolveScript(apiCommonData, preprocessGFF3, exec);
  const { commit, dirty } = checkoutState(apiCommonData, 'finalize', exec);
  const outDir = join(workDir, 'final.tmp');
  try {
    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });
    for (const part of build.partitions) finalizePartition(part, { script, exec, buildDir: p.buildDir, outDir, workDir });
    rmSync(p.genomeBuildJson, { force: true });
    swapDirs(outDir, p.finalDir);
    const record = {
      ...build,
      apiCommonData: { commit, dirty, isfMap, preprocessGFF3: { sha256: sha256File(script), override: Boolean(preprocessGFF3) } },
      finalizedAt: now()
    };
    writeJsonAtomic(p.genomeBuildJson, record);
    return record;
  } catch (e) {
    rmSync(outDir, { recursive: true, force: true });
    if (!isIoError(e)) throw e;
    throw new PipelineError('finalize', outDir, e.message, 'check disk space and permissions in the work directory, then run finalize again');
  }
}
