import { copyFileSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { defaultExec } from '../../lib/tools/exec.js';
import { isChromosomePrimary } from '../partitions.js';
import { apiCommonDataCommit, BIO_SEQIO_FIX, compileProblem, runPreprocessGFF3, SCRIPT_PATH } from '../preprocess-gff3.js';
import { PipelineError, readJson, sha256File, swapDirs, workPaths, writeJsonAtomic } from '../workdir.js';

function resolveScript(apiCommonData, preprocessGFF3, exec) {
  if (!apiCommonData) throw new PipelineError('finalize', '--apiCommonData', 'is required', 'pass --apiCommonData <an ApiCommonData checkout>');
  const script = preprocessGFF3 ?? join(apiCommonData, SCRIPT_PATH);
  if (!existsSync(script)) throw new PipelineError('finalize', script, 'is missing', 'point --apiCommonData at an ApiCommonData checkout');
  let problem;
  try {
    problem = compileProblem(script, { exec });
  } catch (e) {
    throw new PipelineError('finalize', 'perl', e.message, 'install perl or put it on PATH');
  }
  if (problem) throw new PipelineError('finalize', script, `does not compile:\n${problem}`, BIO_SEQIO_FIX);
  try {
    return { script, ...apiCommonDataCommit(apiCommonData, { exec }) };
  } catch (e) {
    throw new PipelineError('finalize', apiCommonData, e.message, 'point --apiCommonData at a git checkout of ApiCommonData');
  }
}

const stale = (file) => new PipelineError('finalize', file, 'changed since build', 'run build again');

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
}

function finalizePartition(part, { script, exec, buildDir, outDir, workDir }) {
  const src = join(buildDir, basename(part.dir));
  const dest = join(outDir, basename(part.dir));
  const recorded = { 'genome.gff3': part.files.gff3, 'genome.fasta': part.files.fasta, 'chromosomeMap.txt': part.files.chromosomeMap };
  for (const [name, digest] of Object.entries(recorded)) {
    if (digest === null) continue;
    const path = join(src, name);
    if (!existsSync(path) || sha256File(path) !== digest) throw stale(path);
  }
  mkdirSync(dest, { recursive: true });
  const expected = ['genome.fasta'];
  if (part.featureCount > 0) {
    const input = join(src, 'genome.gff3');
    try {
      runPreprocessGFF3(script, input, join(dest, 'genome.gff'), { exec });
    } catch (e) {
      throw new PipelineError('finalize', input, e.message.replace(`failed on ${input}`, 'failed'), 'fix the script or the build, then run finalize again');
    }
    expected.push('genome.gff');
  }
  copyFileSync(join(src, 'genome.fasta'), join(dest, 'genome.fasta'));
  if (isChromosomePrimary(part)) {
    copyFileSync(join(src, 'chromosomeMap.txt'), join(dest, 'chromosomeMap.txt'));
    expected.push('chromosomeMap.txt');
  }
  for (const name of expected) {
    const path = join(workDir, part.dir, name);
    const staged = join(dest, name);
    if (!existsSync(staged) || statSync(staged).size === 0) throw new PipelineError('finalize', path, 'is missing or empty', 'run build and finalize again');
  }
}

/** preprocessGFF3 per partition into final.tmp, swapped to final/, then genome-build.json last. */
export async function runFinalize({ workDir, apiCommonData, preprocessGFF3, exec = defaultExec, now = () => new Date().toISOString() }) {
  const p = workPaths(workDir);
  const build = readJson(p.buildJson, 'finalize', 'run build first');
  checkNotStale(build, p, workDir);
  const { script, commit, dirty } = resolveScript(apiCommonData, preprocessGFF3, exec);
  const outDir = join(workDir, 'final.tmp');
  try {
    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });
    for (const part of build.partitions) finalizePartition(part, { script, exec, buildDir: p.buildDir, outDir, workDir });
    rmSync(p.genomeBuildJson, { force: true });
    swapDirs(outDir, p.finalDir);
    const record = { ...build, apiCommonData: { commit, dirty, preprocessGFF3: { sha256: sha256File(script) } }, finalizedAt: now() };
    writeJsonAtomic(p.genomeBuildJson, record);
    return record;
  } catch (e) {
    rmSync(outDir, { recursive: true, force: true });
    if (e instanceof PipelineError) throw e;
    throw new PipelineError('finalize', outDir, e.message, 'check disk space and permissions in the work directory, then run finalize again');
  }
}
