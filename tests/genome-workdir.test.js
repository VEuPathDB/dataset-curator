import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { PipelineError, readJson, readText, sha256, sha256File, workPaths, writeJson } from '../shared/scripts/genome/workdir.js';

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

test('readJson refuses a missing file with the next step; writeJson round-trips', () => {
  const dir = scratch();
  assert.throws(() => readJson(join(dir, 'survey.json'), 'build', 'run survey first'),
    (e) => e instanceof PipelineError && /^build: .*survey\.json: is missing\nNext: run survey first$/.test(e.message));
  writeJson(join(dir, 'x', 'y.json'), { a: 1 });
  assert.deepEqual(readJson(join(dir, 'x', 'y.json'), 'build', 'n/a'), { a: 1 });
});
