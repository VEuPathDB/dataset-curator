import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from '../shared/scripts/lib/config.js';

function tmpWorkspace(config) {
  const dir = mkdtempSync(join(tmpdir(), 'curator-config-'));
  if (config !== undefined) {
    writeFileSync(join(dir, 'curator.config.json'), JSON.stringify(config));
  }
  return dir;
}

test('loadConfig fails clearly when the file is missing', () => {
  const dir = tmpWorkspace();
  assert.throws(() => loadConfig(dir), /curator\.config\.json not found.*curator\.config\.example\.json/s);
});

test('loadConfig applies defaults and resolves the repo path', () => {
  const dir = tmpWorkspace({ ticket: { system: 'redmine', redmine: { url: 'https://r.example', project: 'p', statusIds: { proposed: 1, loading: 2, done: 3 } } } });
  const cfg = loadConfig(dir);
  assert.equal(cfg.veupathdbRepos, 'veupathdb-repos');
  assert.equal(cfg.repoPath, join(dir, 'veupathdb-repos', 'VEuPathDatasets'));
});

test('loadConfig rejects unknown ticket systems', () => {
  const dir = tmpWorkspace({ ticket: { system: 'jira' } });
  assert.throws(() => loadConfig(dir), /ticket\.system must be one of redmine, github/);
});

test('loadConfig requires the backend block for the selected system', () => {
  const dir = tmpWorkspace({ ticket: { system: 'github' } });
  assert.throws(() => loadConfig(dir), /ticket\.github is required/);
});
