import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readValidationEnv, readEnvJson, createToolResolver } from '../shared/scripts/lib/validation-env.js';
import { parseAnalysisConfig } from '../shared/scripts/lib/tools/apicommondata.js';
import { validateEntity } from '../shared/scripts/lib/tools/study-wrangler.js';
import { fixtures } from './helpers.js';

/** A workspace with fake ApiCommonData modules and a fake perl/Rscript; env overrides validation-env.json keys. */
function workspace(env = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'validation-ws-'));
  mkdirSync(join(dir, 'ApiCommonData/Load/lib/perl'), { recursive: true });
  for (const m of ['AnalysisConfigParser.pm', 'AnalysisConfigRepeatFinder.pm']) writeFileSync(join(dir, 'ApiCommonData/Load/lib/perl', m), '1;\n');
  mkdirSync(join(dir, 'bin'));
  writeFileSync(join(dir, 'bin/perl'), '');
  writeFileSync(join(dir, 'bin/Rscript'), '');
  writeFileSync(join(dir, 'validation-env.json'), JSON.stringify({
    schemaVersion: 1, apiCommonData: 'ApiCommonData', perl: 'bin/perl', rscript: 'bin/Rscript', rLibs: null, ...env
  }));
  return dir;
}

/** exec answering git rev-parse and the study.wrangler version probe. */
const fakeExec = ({ version = '1.0.41', gitFails = false, rFails = false } = {}) => (cmd, args) => {
  if (cmd === 'git') { if (gitFails) throw new Error('not a git repository'); return 'c0ffee\n'; }
  if (cmd.endsWith('Rscript')) { if (rFails) throw new Error('there is no package called study.wrangler'); return version; }
  throw new Error(`unexpected ${cmd} ${args.join(' ')}`);
};

test('readValidationEnv needs a workspace and its validation-env.json', () => {
  assert.match(readValidationEnv(undefined).error, /No validation workspace given; ask the data loader/);
  const empty = mkdtempSync(join(tmpdir(), 'validation-ws-'));
  assert.match(readValidationEnv(empty).error, /validation-env\.json not found; ask the data loader/);
  writeFileSync(join(empty, 'validation-env.json'), '{ nope');
  assert.match(readValidationEnv(empty).error, /is not valid JSON/);
  writeFileSync(join(empty, 'validation-env.json'), '{"schemaVersion": 2}');
  assert.match(readValidationEnv(empty).error, /schemaVersion must be 1/);
  const ok = readValidationEnv(workspace());
  assert.equal(ok.error, undefined);
  assert.equal(ok.values.apiCommonData, 'ApiCommonData');
});

test('without a workspace every tool is missing with the ask-the-loader message', () => {
  const tools = createToolResolver(undefined, { exec: fakeExec() });
  assert.match(tools.resolveTool('apiCommonData').missing, /ask the data loader/);
  assert.equal(tools.workspace, null);
});

test('apiCommonData resolves relative to the workspace and records its commit', () => {
  const dir = workspace();
  const tools = createToolResolver(dir, { exec: fakeExec() });
  const { tool } = tools.resolveTool('apiCommonData');
  assert.equal(tool.path, join(dir, 'ApiCommonData'));
  assert.equal(tool.libDir, join(dir, 'ApiCommonData/Load/lib/perl'));
  assert.equal(tool.perl, join(dir, 'bin/perl'));
  assert.equal(tool.version, 'c0ffee');
  assert.deepEqual(tools.versions(), { apiCommonData: 'c0ffee' });
});

test('apiCommonData is missing when a key, a module, perl or git is missing', () => {
  assert.match(createToolResolver(workspace({ apiCommonData: undefined }), { exec: fakeExec() }).resolveTool('apiCommonData').missing, /has no "apiCommonData"/);
  assert.match(createToolResolver(workspace({ perl: undefined }), { exec: fakeExec() }).resolveTool('apiCommonData').missing, /has no "perl"/);
  assert.match(createToolResolver(workspace({ perl: 'bin/nope' }), { exec: fakeExec() }).resolveTool('apiCommonData').missing, /perl not found at .*bin\/nope/);
  assert.match(createToolResolver(workspace({ apiCommonData: 'elsewhere' }), { exec: fakeExec() }).resolveTool('apiCommonData').missing, /has no AnalysisConfigParser\.pm, AnalysisConfigRepeatFinder\.pm/);
  assert.match(createToolResolver(workspace(), { exec: fakeExec({ gitFails: true }) }).resolveTool('apiCommonData').missing, /is not a git checkout/);
});

test('studyWrangler resolves Rscript, R_LIBS and a new enough version', () => {
  const dir = workspace({ rLibs: 'R/library' });
  const { tool } = createToolResolver(dir, { exec: fakeExec({ version: '1.0.42' }) }).resolveTool('studyWrangler');
  assert.equal(tool.rscript, join(dir, 'bin/Rscript'));
  assert.equal(tool.env.R_LIBS, join(dir, 'R/library'));
  assert.equal(tool.version, '1.0.42');
});

test('studyWrangler is missing when Rscript, the package or the version falls short', () => {
  assert.match(createToolResolver(workspace({ rscript: undefined }), { exec: fakeExec() }).resolveTool('studyWrangler').missing, /has no "rscript"/);
  assert.match(createToolResolver(workspace({ rscript: 'bin/R-nope' }), { exec: fakeExec() }).resolveTool('studyWrangler').missing, /Rscript not found at/);
  assert.match(createToolResolver(workspace(), { exec: fakeExec({ rFails: true }) }).resolveTool('studyWrangler').missing, /study\.wrangler is not installed for .*Rscript/);
  assert.match(createToolResolver(workspace(), { exec: fakeExec({ version: '1.0.9' }) }).resolveTool('studyWrangler').missing, /study\.wrangler 1\.0\.9 is older than 1\.0\.41/);
});

test('an unknown tool name is missing, and resolution is cached', () => {
  let probes = 0;
  const exec = (cmd) => { probes++; return cmd === 'git' ? 'c0ffee' : '1.0.41'; };
  const tools = createToolResolver(workspace(), { exec });
  assert.match(tools.resolveTool('blast').missing, /unknown tool "blast"/);
  tools.resolveTool('apiCommonData');
  tools.resolveTool('apiCommonData');
  assert.equal(probes, 1);
});

const REAL = process.env.VALIDATION_WORKSPACE;
const needsWorkspace = { skip: !REAL && 'VALIDATION_WORKSPACE is not set; ask John for the validation workspace to run real-tool tests' };
const fixtureOrganism = join(fixtures, 'proposals/PRJNA000002/curated/tfakST1');

test('ApiCommonData parses the fixture analysisConfig.xml', needsWorkspace, () => {
  const { tool, missing } = createToolResolver(REAL).resolveTool('apiCommonData');
  assert.equal(missing, undefined);
  const parsed = parseAnalysisConfig(tool, join(fixtureOrganism, 'analysisConfig.xml'));
  assert.deepEqual(parsed.steps.map((s) => s.class), ['ApiCommonData::Load::RnaSeqAnalysisEbi']);
  assert.deepEqual(parsed.groups, [{ displayName: 'Control', samples: ['SAMN1'] }, { displayName: 'Stressed', samples: ['SAMN2'] }]);
});

test('ApiCommonData reports XML it cannot read', needsWorkspace, () => {
  const { tool } = createToolResolver(REAL).resolveTool('apiCommonData');
  const bad = join(mkdtempSync(join(tmpdir(), 'acd-bad-')), 'analysisConfig.xml');
  writeFileSync(bad, '<xml><step class="x">');
  assert.throws(() => parseAnalysisConfig(tool, bad), /./);
});

test('study.wrangler accepts the fixture entity and rejects a broken one', needsWorkspace, () => {
  const { tool, missing } = createToolResolver(REAL).resolveTool('studyWrangler');
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
