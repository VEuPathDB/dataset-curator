import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig, openWorkspace, DEFAULT_CONFIG_PATH } from '../shared/scripts/lib/config.js';

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const github = { ticket: { system: 'github', github: { repo: 'o/r', labels: { proposed: 'a', loading: 'b', done: 'c' } } } };

function checkout({ veupath = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'curator-config-'));
  execFileSync('git', ['init', '--quiet', dir]);
  if (veupath) mkdirSync(join(dir, 'Model', 'lib', 'xml', 'datasetPresenters'), { recursive: true });
  return dir;
}

function configFile(config) {
  const path = join(mkdtempSync(join(tmpdir(), 'curator-default-')), 'curator.config.json');
  writeFileSync(path, typeof config === 'string' ? config : JSON.stringify(config));
  return path;
}

test('the shipped default config loads and selects a known ticket system', () => {
  const repo = checkout();
  const cfg = loadConfig(repo);
  assert.equal(cfg.configPath, DEFAULT_CONFIG_PATH);
  assert.equal(cfg.ticket.system, 'github');
});

test('loadConfig resolves the checkout root from a subdirectory', () => {
  const repo = checkout();
  const cfg = loadConfig(join(repo, 'Model', 'lib'), { defaultPath: configFile(github) });
  assert.equal(cfg.repoPath, execFileSync('git', ['-C', repo, 'rev-parse', '--show-toplevel'], { encoding: 'utf-8' }).trim());
  assert.equal(cfg.scratchPath, join(cfg.repoPath, '.curation'));
});

test('.curation/curator.config.json in the checkout overrides the default', () => {
  const repo = checkout();
  mkdirSync(join(repo, '.curation'));
  const override = join(repo, '.curation', 'curator.config.json');
  writeFileSync(override, JSON.stringify(github));
  const cfg = loadConfig(repo, { defaultPath: configFile({ ticket: { system: 'jira' } }) });
  assert.equal(cfg.ticket.github.repo, 'o/r');
  assert.ok(cfg.configPath.endsWith(join('.curation', 'curator.config.json')));
});

test('loadConfig refuses a directory outside git', () => {
  const dir = mkdtempSync(join(tmpdir(), 'curator-nogit-'));
  assert.throws(() => loadConfig(dir), /is not inside a git checkout/);
});

test('loadConfig refuses a git checkout that is not VEuPathDatasets', () => {
  const repo = checkout({ veupath: false });
  assert.throws(() => loadConfig(repo), /is not a VEuPathDatasets checkout/);
});

test('loadConfig rejects unknown ticket systems', () => {
  const path = configFile({ ticket: { system: 'redmine' } });
  assert.throws(() => loadConfig(checkout(), { defaultPath: path }),
    new RegExp(`^Error: ${escapeRegExp(path)}: ticket\\.system must be one of github`));
});

test('loadConfig requires the backend block for the selected system', () => {
  const path = configFile({ ticket: { system: 'github' } });
  assert.throws(() => loadConfig(checkout(), { defaultPath: path }),
    new RegExp(`^Error: ${escapeRegExp(path)}: ticket\\.github is required`));
});

test('loadConfig fails clearly when the file is malformed JSON', () => {
  const path = configFile('{ not valid json');
  assert.throws(() => loadConfig(checkout(), { defaultPath: path }),
    new RegExp(`^Error: ${escapeRegExp(path)} is not valid JSON:`));
});

test('openWorkspace creates .curation/tmp and keeps it out of git status, once', () => {
  const repo = checkout();
  const opts = { defaultPath: configFile(github) };
  openWorkspace(repo, opts);
  writeFileSync(join(repo, '.curation', 'tmp', 'x.json'), '{}');
  assert.ok(existsSync(join(repo, '.curation', 'tmp')));
  const status = execFileSync('git', ['-C', repo, 'status', '--porcelain', '--untracked-files=all'], { encoding: 'utf-8' });
  assert.equal(status.includes('.curation'), false);
  openWorkspace(repo, opts);
  const exclude = readFileSync(join(repo, '.git', 'info', 'exclude'), 'utf-8');
  assert.equal(exclude.split('\n').filter(l => l === '/.curation/').length, 1);
});
