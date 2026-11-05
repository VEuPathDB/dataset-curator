import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import {
  isIoError, PipelineError, readJson, readText, recoverSwap, sha256, sha256File, swapDirs, workPaths, writeJson
} from '../shared/scripts/genome/workdir.js';

const scratch = () => mkdtempSync(join(tmpdir(), 'genome-workdir-'));

test('a PipelineError names the command, the file and the next step', () => {
  const e = new PipelineError('build', 'recipe.json', 'is missing', 'copy suggestedRecipe from survey.json');
  assert.equal(e.message, 'build: recipe.json: is missing\nNext: copy suggestedRecipe from survey.json');
  assert.equal(e.command, 'build');
  assert.equal(e.file, 'recipe.json');
  assert.equal(e.problem, 'is missing');
  assert.equal(e.next, 'copy suggestedRecipe from survey.json');
});

test('workPaths lays out the work area', () => {
  const p = workPaths('/w');
  assert.equal(p.fetchDir, '/w/fetch');
  assert.equal(p.fetchJson, '/w/fetch/fetch.json');
  assert.equal(p.surveyJson, '/w/survey.json');
  assert.equal(p.idsDefault, '/w/ids.default.tsv');
  assert.equal(p.buildJson, '/w/build/build.json');
  assert.equal(p.normalized, '/w/build/normalized.gff3');
  assert.equal(p.finalDir, '/w/final');
  assert.equal(p.genomeBuildJson, '/w/genome-build.json');
  assert.equal(p.recipeJson, '/w/recipe.json');
  assert.equal(p.idsTsv, '/w/ids.tsv');
  assert.equal(p.partitionsTsv, '/w/partitions.tsv');
  assert.equal(p.buildDir, '/w/build');
});

test('readText reads plain and gzipped files alike', () => {
  const dir = scratch();
  writeFileSync(join(dir, 'a.txt'), 'hello\n');
  writeFileSync(join(dir, 'a.txt.gz'), gzipSync('hello\n'));
  assert.equal(readText(join(dir, 'a.txt')), 'hello\n');
  assert.equal(readText(join(dir, 'a.txt.gz')), 'hello\n');
});

test('sha256 of text and of a file agree', () => {
  const dir = scratch();
  writeFileSync(join(dir, 'abc'), 'abc');
  assert.equal(sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(sha256File(join(dir, 'abc')), sha256('abc'));
});

test('readJson reports corrupt JSON as a PipelineError', () => {
  const dir = scratch();
  writeFileSync(join(dir, 'bad.json'), '{ nope');
  assert.throws(() => readJson(join(dir, 'bad.json'), 'build', 'rerun survey'),
    (e) => e instanceof PipelineError && /bad\.json: is not JSON: .*\nNext: rerun survey$/.test(e.message));
});

const dirWith = (path, text) => {
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'f'), text);
};
const fileIn = (path) => readFileSync(join(path, 'f'), 'utf-8');

test('swapDirs replaces the target and leaves no .old', () => {
  const dir = scratch();
  dirWith(join(dir, 'new'), 'new');
  dirWith(join(dir, 'final'), 'old');
  swapDirs(join(dir, 'new'), join(dir, 'final'));
  assert.equal(fileIn(join(dir, 'final')), 'new');
  assert.equal(existsSync(join(dir, 'final.old')), false);
  assert.equal(existsSync(join(dir, 'new')), false);
});

test('swapDirs works when the target is absent', () => {
  const dir = scratch();
  dirWith(join(dir, 'new'), 'new');
  swapDirs(join(dir, 'new'), join(dir, 'final'));
  assert.equal(fileIn(join(dir, 'final')), 'new');
});

test('swapDirs restores a target a crashed swap left only as .old, then swaps', () => {
  const dir = scratch();
  dirWith(join(dir, 'final.old'), 'survivor');
  dirWith(join(dir, 'new'), 'new');
  swapDirs(join(dir, 'new'), join(dir, 'final'));
  assert.equal(fileIn(join(dir, 'final')), 'new');
  assert.equal(existsSync(join(dir, 'final.old')), false);

  dirWith(join(dir, 'final2.old'), 'survivor');
  assert.throws(() => swapDirs(join(dir, 'missing'), join(dir, 'final2')), /ENOENT/);
  assert.equal(fileIn(join(dir, 'final2')), 'survivor');
});

test('recoverSwap puts back a target left only as .old and leaves an intact target alone', () => {
  const dir = scratch();
  dirWith(join(dir, 'build.old'), 'survivor');
  recoverSwap(join(dir, 'build'));
  assert.equal(fileIn(join(dir, 'build')), 'survivor');
  assert.equal(existsSync(join(dir, 'build.old')), false);
  dirWith(join(dir, 'build.old'), 'stale');
  recoverSwap(join(dir, 'build'));
  assert.equal(fileIn(join(dir, 'build')), 'survivor');
  recoverSwap(join(dir, 'absent'));
  assert.equal(existsSync(join(dir, 'absent')), false);
});

test('isIoError is true for file-system errors only', () => {
  const dir = scratch();
  let ioError;
  try { readFileSync(join(dir, 'missing')); } catch (e) { ioError = e; }
  assert.equal(isIoError(ioError), true);
  assert.equal(isIoError(new TypeError('boom')), false);
  assert.equal(isIoError(Object.assign(new Error('x'), { code: 'SPLIT_ACROSS' })), false);
  assert.equal(isIoError(new PipelineError('build', 'f', 'p', 'n')), false);
});

test('swapDirs puts the old target back and rethrows the original error when the second rename fails', () => {
  const dir = scratch();
  dirWith(join(dir, 'final'), 'old');
  assert.throws(() => swapDirs(join(dir, 'missing'), join(dir, 'final')), (e) => e.code === 'ENOENT');
  assert.equal(fileIn(join(dir, 'final')), 'old');
  assert.equal(existsSync(join(dir, 'final.old')), false);
});

test('readJson refuses a missing file with the next step; writeJson round-trips', () => {
  const dir = scratch();
  assert.throws(() => readJson(join(dir, 'survey.json'), 'build', 'run survey first'),
    (e) => e instanceof PipelineError && /^build: .*survey\.json: is missing\nNext: run survey first$/.test(e.message));
  writeJson(join(dir, 'x', 'y.json'), { a: 1 });
  assert.deepEqual(readJson(join(dir, 'x', 'y.json'), 'build', 'n/a'), { a: 1 });
});
