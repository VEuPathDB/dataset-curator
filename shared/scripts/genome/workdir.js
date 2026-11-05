import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { gunzipSync } from 'node:zlib';

/** A failure that names the command, the file and the next step. */
export class PipelineError extends Error {
  constructor(command, file, problem, next) {
    super(`${command}: ${file}: ${problem}\nNext: ${next}`);
    this.name = 'PipelineError';
    Object.assign(this, { command, file, problem, next });
  }
}

export function workPaths(workDir) {
  const buildDir = join(workDir, 'build');
  return {
    fetchDir: join(workDir, 'fetch'),
    fetchJson: join(workDir, 'fetch', 'fetch.json'),
    surveyJson: join(workDir, 'survey.json'),
    recipeJson: join(workDir, 'recipe.json'),
    idsTsv: join(workDir, 'ids.tsv'),
    idsDefault: join(workDir, 'ids.default.tsv'),
    partitionsTsv: join(workDir, 'partitions.tsv'),
    buildDir,
    buildJson: join(buildDir, 'build.json'),
    normalized: join(buildDir, 'normalized.gff3'),
    finalDir: join(workDir, 'final'),
    genomeBuildJson: join(workDir, 'genome-build.json')
  };
}

export const sha256 = (data) => createHash('sha256').update(data).digest('hex');
export const sha256File = (path) => sha256(readFileSync(path));

export function readText(path) {
  const bytes = readFileSync(path);
  return (path.endsWith('.gz') ? gunzipSync(bytes) : bytes).toString('utf-8');
}

export function readJson(path, command, next) {
  if (!existsSync(path)) throw new PipelineError(command, path, 'is missing', next);
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch (e) {
    throw new PipelineError(command, path, `is not JSON: ${e.message}`, next);
  }
}

export function writeText(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

export const writeJson = (path, value) => writeText(path, `${JSON.stringify(value, null, 2)}\n`);

/** Write beside the target and rename, so a crash never leaves a half-written file. */
export function writeFileAtomic(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  const partial = `${path}.part`;
  writeFileSync(partial, data);
  renameSync(partial, path);
}

export const writeJsonAtomic = (path, value) => writeFileAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
