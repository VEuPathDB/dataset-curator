import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readEnvJson, createToolResolver } from '../shared/scripts/lib/validation-env.js';
import { toolEnv, openVerifyWorkspace } from '../shared/scripts/lib/validation-workspace.js';
import { parseAnalysisConfig } from '../shared/scripts/lib/tools/apicommondata.js';
import { validateEntity } from '../shared/scripts/lib/tools/study-wrangler.js';
import { fixtures } from './helpers.js';

const fakeExec = ({ version = '1.0.41', rFails = false } = {}) => (cmd, args) => {
  if (cmd.endsWith('Rscript')) { if (rFails) throw new Error('there is no package called study.wrangler'); return version; }
  throw new Error(`unexpected ${cmd} ${args.join(' ')}`);
};

/** A handle as validation-workspace.js returns it, with ApiCommonData's parser modules installed in build/. */
function handle({ modules = ['AnalysisConfigParser.pm', 'AnalysisConfigRepeatFinder.pm'], executables, repos } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'validation-handle-'));
  const buildDir = join(dir, 'build');
  mkdirSync(join(buildDir, 'lib/perl/ApiCommonData/Load'), { recursive: true });
  for (const m of modules) writeFileSync(join(buildDir, 'lib/perl/ApiCommonData/Load', m), '1;\n');
  mkdirSync(join(dir, 'bin'));
  writeFileSync(join(dir, 'bin/perl'), '');
  writeFileSync(join(dir, 'bin/Rscript'), '');
  return {
    dir, buildDir, env: toolEnv(buildDir),
    repos: repos ?? { ApiCommonData: { path: join(dir, 'ApiCommonData'), ref: 'master', sha: 'c0ffee' } },
    executables: executables ?? { perl: join(dir, 'bin/perl'), rscript: join(dir, 'bin/Rscript') }
  };
}

test('a workspace error makes every tool missing with that error', () => {
  const tools = createToolResolver({ error: 'No validation workspace given; ask the data loader' }, { exec: fakeExec() });
  assert.match(tools.resolveTool('apiCommonData').missing, /ask the data loader/);
  assert.equal(tools.workspace, null);
  assert.deepEqual(tools.repos(), {});
});

test('apiCommonData runs from the build and is versioned by its worktree', () => {
  const ws = handle();
  const tools = createToolResolver(ws, { exec: fakeExec() });
  const { tool } = tools.resolveTool('apiCommonData');
  assert.equal(tool.libDir, join(ws.buildDir, 'lib/perl'));
  assert.equal(tool.perl, join(ws.dir, 'bin/perl'));
  assert.equal(tool.env.PERL5LIB, join(ws.buildDir, 'lib/perl'));
  assert.equal(tool.version, 'c0ffee');
  assert.deepEqual(tools.versions(), { apiCommonData: 'c0ffee' });
  assert.deepEqual(tools.repos(), { ApiCommonData: { ref: 'master', sha: 'c0ffee' } });
  assert.equal(tools.workspace, ws.dir);
});

test('apiCommonData is missing without perl, its repo or its installed modules', () => {
  const missing = (ws) => createToolResolver(ws, { exec: fakeExec() }).resolveTool('apiCommonData').missing;
  assert.match(missing(handle({ executables: { rscript: '/x' } })), /env\.json has no executables\.perl/);
  assert.match(missing(handle({ executables: { perl: '/no/perl' } })), /perl not found at \/no\/perl/);
  assert.match(missing(handle({ repos: {} })), /env\.json lists no ApiCommonData repo/);
  assert.match(missing(handle({ modules: ['AnalysisConfigParser.pm'] })), /ApiCommonData\/Load has no AnalysisConfigRepeatFinder\.pm; does the build install ApiCommonData\?/);
});

test('studyWrangler runs Rscript with the build R library and checks its version', () => {
  const ws = handle();
  const { tool } = createToolResolver(ws, { exec: fakeExec({ version: '1.0.42' }) }).resolveTool('studyWrangler');
  assert.equal(tool.rscript, join(ws.dir, 'bin/Rscript'));
  assert.equal(tool.env.R_LIBS, join(ws.buildDir, 'lib/R'));
  assert.equal(tool.version, '1.0.42');
  const missing = (w, o) => createToolResolver(w, { exec: fakeExec(o) }).resolveTool('studyWrangler').missing;
  assert.match(missing(handle({ executables: { perl: '/x' } })), /env\.json has no executables\.rscript/);
  assert.match(missing(handle({ executables: { rscript: '/no/R' } })), /Rscript not found at \/no\/R/);
  assert.match(missing(handle(), { rFails: true }), /study\.wrangler is not installed in .*build\/lib\/R/);
  assert.match(missing(handle(), { version: '1.0.9' }), /study\.wrangler 1\.0\.9 is older than 1\.0\.41/);
});

test('an unknown tool name is missing, and resolution is cached', () => {
  let probes = 0;
  const tools = createToolResolver(handle(), { exec: () => { probes++; return '1.0.41'; } });
  assert.match(tools.resolveTool('blast').missing, /unknown tool "blast"/);
  tools.resolveTool('studyWrangler');
  tools.resolveTool('studyWrangler');
  assert.equal(probes, 1);
});

const REAL = process.env.VALIDATION_ROOT;
const needsWorkspace = { skip: !REAL && 'VALIDATION_ROOT is not set; ask John for the validation workspace root to run real-tool tests' };
const fixtureOrganism = join(fixtures, 'proposals/PRJNA000002/curated/tfakST1');
const realTools = () => createToolResolver(openVerifyWorkspace({ root: REAL, datasetType: 'bulk-rnaseq', accession: 'real-tool-tests' }));

test('ApiCommonData parses the fixture analysisConfig.xml', needsWorkspace, () => {
  const { tool, missing } = realTools().resolveTool('apiCommonData');
  assert.equal(missing, undefined);
  const parsed = parseAnalysisConfig(tool, join(fixtureOrganism, 'analysisConfig.xml'));
  assert.deepEqual(parsed.steps.map((s) => s.class), ['ApiCommonData::Load::RnaSeqAnalysisEbi']);
  assert.deepEqual(parsed.groups, [{ displayName: 'Control', samples: ['SAMN1'] }, { displayName: 'Stressed', samples: ['SAMN2'] }]);
});

test('ApiCommonData reports XML it cannot read', needsWorkspace, () => {
  const { tool } = realTools().resolveTool('apiCommonData');
  const bad = join(mkdtempSync(join(tmpdir(), 'acd-bad-')), 'analysisConfig.xml');
  writeFileSync(bad, '<xml><step class="x">');
  assert.throws(() => parseAnalysisConfig(tool, bad), /./);
});

test('study.wrangler accepts the fixture entity and rejects a broken one', needsWorkspace, () => {
  const { tool, missing } = realTools().resolveTool('studyWrangler');
  assert.equal(missing, undefined);
  assert.equal(validateEntity(tool, join(fixtureOrganism, 'entity-sample.tsv'), join(fixtureOrganism, 'entity-sample.yaml')).ok, true);
  const dir = mkdtempSync(join(tmpdir(), 'stf-bad-'));
  const [header, first] = readFileSync(join(fixtureOrganism, 'entity-sample.tsv'), 'utf-8').split('\n');
  writeFileSync(join(dir, 'entity-sample.tsv'), `${header}\n${first}\n${first}\n`);
  copyFileSync(join(fixtureOrganism, 'entity-sample.yaml'), join(dir, 'entity-sample.yaml'));
  assert.equal(validateEntity(tool, join(dir, 'entity-sample.tsv'), join(dir, 'entity-sample.yaml')).ok, false);
});

const envDir = (values) => {
  const dir = mkdtempSync(join(tmpdir(), 'env-json-'));
  if (values !== undefined) writeFileSync(join(dir, 'env.json'), typeof values === 'string' ? values : JSON.stringify(values));
  return dir;
};
const V2 = { schemaVersion: 2, repos: { ApiCommonData: { url: '/r/acd.git', ref: 'master', followsRebuild: true } }, executables: { perl: '/usr/bin/perl' }, build: ['true'] };

test('readEnvJson accepts a v2 env.json', () => {
  assert.deepEqual(readEnvJson(envDir(V2)).values, V2);
  assert.equal(readEnvJson(envDir({ ...V2, build: undefined })).error, undefined);
});

test('readEnvJson explains what is wrong with an env.json', () => {
  assert.match(readEnvJson(envDir()).error, /env\.json not found; ask the data loader/);
  assert.match(readEnvJson(envDir('{ nope')).error, /is not valid JSON/);
  assert.match(readEnvJson(envDir({ schemaVersion: 1 })).error, /schemaVersion 1 is the old flat validation-env\.json; rewrite it as schemaVersion 2/);
  assert.match(readEnvJson(envDir({ ...V2, schemaVersion: 3 })).error, /schemaVersion must be 2/);
  assert.match(readEnvJson(envDir({ ...V2, repos: [] })).error, /"repos" must be an object/);
  assert.match(readEnvJson(envDir({ ...V2, repos: { x: { url: '/u' } } })).error, /repos\.x needs string "url" and "ref"/);
  assert.match(readEnvJson(envDir({ ...V2, repos: { x: { url: '/u', ref: 'm', followsRebuild: 'yes' } } })).error, /repos\.x\.followsRebuild must be true or false/);
  for (const bad of ['..', 'build', 'a/b']) assert.match(readEnvJson(envDir({ ...V2, repos: { [bad]: { url: '/u', ref: 'm' } } })).error, /must be a plain directory name other than build/);
  assert.match(readEnvJson(envDir({ ...V2, executables: { perl: 'perl' } })).error, /executables\.perl must be an absolute path/);
  assert.match(readEnvJson(envDir({ ...V2, build: 'make' })).error, /"build" must be an array of shell commands/);
});
