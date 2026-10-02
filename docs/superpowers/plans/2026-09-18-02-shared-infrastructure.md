# Plan 2 of 4: Shared Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the zero-dependency library both phases share: config loading, manifest validation, presenter-file editing, git operations, the ticket adapter, and the two renderers, all under test.

**Architecture:** Everything lives in `shared/scripts/lib/` and `shared/scripts/renderers/` and is synced into skills by the existing `bin/sync-shared.js`. Modules import each other by relative path, which survives the sync because the directory shape is preserved. Tests live in `tests/` at the repository root and run against the canonical `shared/` copies; they are not synced. Side effects (git, gh, HTTP) are injected so tests never touch the network.

**Tech Stack:** Node 18+ standard library only: `node:test`, `node:assert`, `node:fs`, `node:path`, `node:child_process`, `node:util` (`parseArgs`), global `fetch`.

**Spec:** `docs/superpowers/specs/2026-09-18-two-phase-proposals-design.md`. Two additions the spec did not spell out, both consistent with it: (a) curator edits to presenter text live in `curated/presenter-overrides.json`, not in rendered XML; (b) `curator.config.json` is read from the curation workspace directory (the current working directory), because plugin users do not have this repository checked out.

**Depends on:** Plan 1 merged into the `two-phase-proposals` branch.

---

## File structure

| Path | Responsibility |
|---|---|
| `shared/scripts/lib/config.js` | Load and validate `curator.config.json`; resolve repo path |
| `shared/scripts/lib/contacts.js` | Read contact IDs from `allContacts.xml` |
| `shared/scripts/lib/manifest.js` | Manifest schema: validate, read, write |
| `shared/scripts/lib/presenter-file.js` | Pure string operations on a project presenter file |
| `shared/scripts/lib/git-ops.js` | Git and `gh` wrapper with injectable exec |
| `shared/scripts/lib/ticket/index.js` | Adapter selection, status vocabulary |
| `shared/scripts/lib/ticket/redmine.js` | Redmine REST backend |
| `shared/scripts/lib/ticket/github.js` | GitHub issues backend via `gh` |
| `shared/scripts/renderers/genome-assembly.js` | `render(proposalDir)` for genomes |
| `shared/scripts/renderers/bulk-rnaseq.js` | `render(proposalDir)` for RNA-seq |
| `shared/scripts/render-proposal.js` | CLI: dispatch on `datasetType`, print XML or name |
| `curator.config.example.json` | Committed template |
| `tests/*.test.js`, `tests/fixtures/` | Tests and fixture proposals |
| `package.json` | `test` script, `sharedFiles` entries |
| `.gitignore` | `curator.config.json` |

Sync targets: every new `shared/scripts/**` file syncs into `curate-genome-assembly`, `curate-bulk-rnaseq` and (Plan 4) `load-proposals`. Add each file to `sharedFiles` as it is created.

---

### Task 1: Test harness and config loader

**Files:**
- Create: `shared/scripts/lib/config.js`, `curator.config.example.json`, `tests/config.test.js`
- Modify: `package.json`, `.gitignore`

- [ ] **Step 1: Add the test script and gitignore entry**

In `package.json` `scripts`, add:
```json
    "test": "node --test tests/*.test.js"
```
Append to `.gitignore`:
```
# Curator environment configuration (copy from curator.config.example.json)
curator.config.json
```

- [ ] **Step 2: Write the failing test**

Create `tests/config.test.js`:
```js
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
```

- [ ] **Step 3: Run it to verify it fails**

Run: `yarn test`
Expected: FAIL, `Cannot find module .../shared/scripts/lib/config.js`.

- [ ] **Step 4: Implement config.js**

Create `shared/scripts/lib/config.js`:
```js
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const TICKET_SYSTEMS = ['redmine', 'github'];
export const CONFIG_FILENAME = 'curator.config.json';

/**
 * Loads curator.config.json from the curation workspace directory and
 * resolves derived paths. Throws with actionable messages on any problem.
 */
export function loadConfig(cwd = process.cwd()) {
  const path = join(cwd, CONFIG_FILENAME);
  if (!existsSync(path)) {
    throw new Error(
      `${CONFIG_FILENAME} not found in ${cwd}.\n` +
      `Copy curator.config.example.json from the dataset-curator repository to ${path} and edit it.`
    );
  }
  const raw = JSON.parse(readFileSync(path, 'utf-8'));
  const cfg = { veupathdbRepos: 'veupathdb-repos', ...raw };

  if (!cfg.ticket || !TICKET_SYSTEMS.includes(cfg.ticket.system)) {
    throw new Error(`ticket.system must be one of ${TICKET_SYSTEMS.join(', ')}`);
  }
  if (!cfg.ticket[cfg.ticket.system]) {
    throw new Error(`ticket.${cfg.ticket.system} is required when ticket.system is "${cfg.ticket.system}"`);
  }

  cfg.workspace = resolve(cwd);
  cfg.repoPath = join(cfg.workspace, cfg.veupathdbRepos, 'VEuPathDatasets');
  return cfg;
}
```

Create `curator.config.example.json`:
```json
{
  "veupathdbRepos": "veupathdb-repos",
  "ticket": {
    "system": "redmine",
    "redmine": {
      "url": "https://redmine.apidb.org",
      "project": "apidb",
      "statusIds": { "proposed": 1, "loading": 2, "done": 5 }
    },
    "github": {
      "repo": "VEuPathDB/VEuPathDatasets",
      "labels": { "proposed": "proposal", "loading": "loading", "done": "loaded" }
    }
  }
}
```

- [ ] **Step 5: Run tests**

Run: `yarn test`
Expected: 4 passing.

- [ ] **Step 6: Commit**

```bash
git add package.json .gitignore curator.config.example.json shared/scripts/lib/config.js tests/config.test.js
git commit -m "Add config loader and test harness

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Contacts reader

**Files:**
- Create: `shared/scripts/lib/contacts.js`, `tests/contacts.test.js`, `tests/fixtures/allContacts.xml`

- [ ] **Step 1: Fixture**

Create `tests/fixtures/allContacts.xml`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<contacts>
  <contact>
    <contactId>jane.doe</contactId>
    <name>Jane Doe</name>
    <institution>Example University</institution>
    <email>jane@example.edu</email>
    <address></address>
    <city></city>
    <state/>
    <zip></zip>
    <country></country>
  </contact>
  <contact>
    <contactId>ravi.kumar</contactId>
    <name>Ravi Kumar</name>
    <institution>Example Institute</institution>
    <email></email>
    <address></address>
    <city></city>
    <state/>
    <zip></zip>
    <country></country>
  </contact>
</contacts>
```

- [ ] **Step 2: Failing test**

Create `tests/contacts.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readContactIds, CONTACTS_RELATIVE_PATH } from '../shared/scripts/lib/contacts.js';

const fixture = new URL('./fixtures/allContacts.xml', import.meta.url).pathname;

test('readContactIds returns every contactId in file order', () => {
  assert.deepEqual(readContactIds(fixture), ['jane.doe', 'ravi.kumar']);
});

test('CONTACTS_RELATIVE_PATH points at the VEuPathDatasets contacts file', () => {
  assert.equal(CONTACTS_RELATIVE_PATH, 'Model/lib/xml/datasetPresenters/contacts/allContacts.xml');
});
```

- [ ] **Step 3: Run to verify failure**

Run: `yarn test`
Expected: FAIL, cannot find `contacts.js`.

- [ ] **Step 4: Implement**

Create `shared/scripts/lib/contacts.js`:
```js
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const CONTACTS_RELATIVE_PATH = 'Model/lib/xml/datasetPresenters/contacts/allContacts.xml';

export function contactsPath(repoPath) {
  return join(repoPath, CONTACTS_RELATIVE_PATH);
}

/** Regex scan rather than an XML parser: the file is ~40k lines and flat. */
export function readContactIds(filePath) {
  const xml = readFileSync(filePath, 'utf-8');
  return [...xml.matchAll(/<contactId>\s*([^<\s]+)\s*<\/contactId>/g)].map(m => m[1]);
}
```

- [ ] **Step 5: Run tests, expect 6 passing, then commit**

```bash
yarn test
git add shared/scripts/lib/contacts.js tests/contacts.test.js tests/fixtures/allContacts.xml
git commit -m "Add contacts reader

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Manifest schema

**Files:**
- Create: `shared/scripts/lib/manifest.js`, `tests/manifest.test.js`

- [ ] **Step 1: Failing test**

Create `tests/manifest.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validate, read, write } from '../shared/scripts/lib/manifest.js';

function valid() {
  return {
    schemaVersion: 1,
    accession: 'PRJNA123456',
    datasetType: 'bulk-rnaseq',
    project: 'FungiDB',
    organismAbbrev: 'afumAf293',
    targetBuild: '02',
    contacts: { primary: 'jane.doe', additional: ['ravi.kumar'] },
    curator: 'someone@apidb.org',
    createdAt: '2026-09-18T14:00:00.000Z',
    skill: { name: 'propose-bulk-rnaseq', version: '2.0.0' }
  };
}

test('a complete manifest has no errors', () => {
  assert.deepEqual(validate(valid()), []);
});

test('ticket is optional but must be well formed when present', () => {
  const m = { ...valid(), ticket: { system: 'redmine', id: '42', url: 'https://r/issues/42' } };
  assert.deepEqual(validate(m), []);
  const bad = { ...valid(), ticket: { system: 'jira', id: '42' } };
  const errors = validate(bad);
  assert.ok(errors.some(e => /ticket\.system/.test(e)));
  assert.ok(errors.some(e => /ticket\.url/.test(e)));
});

test('unknown schemaVersion is rejected', () => {
  assert.ok(validate({ ...valid(), schemaVersion: 99 }).some(e => /schemaVersion/.test(e)));
});

test('datasetType must have a renderer', () => {
  assert.ok(validate({ ...valid(), datasetType: 'proteomics' }).some(e => /renderer/.test(e)));
});

test('project must be a valid VEuPathDB project', () => {
  assert.ok(validate({ ...valid(), project: 'fungidb' }).some(e => /project/.test(e)));
});

test('targetBuild must be two or more digits', () => {
  assert.ok(validate({ ...valid(), targetBuild: '2' }).some(e => /targetBuild/.test(e)));
  assert.deepEqual(validate({ ...valid(), targetBuild: '102' }), []);
});

test('accession must match the directory name when given', () => {
  assert.ok(validate(valid(), { dirName: 'PRJNA000000' }).some(e => /directory/.test(e)));
});

test('contacts are checked against known ids when given', () => {
  const errors = validate(valid(), { contactIds: ['jane.doe'] });
  assert.ok(errors.some(e => /ravi\.kumar/.test(e)));
});

test('write validates, then read round-trips', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'manifest-')), 'PRJNA123456');
  mkdirSync(dir);
  write(dir, valid());
  const onDisk = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf-8'));
  assert.equal(onDisk.accession, 'PRJNA123456');
  assert.deepEqual(read(dir), valid());
});

test('write refuses an invalid manifest', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'manifest-')), 'PRJNA123456');
  mkdirSync(dir);
  assert.throws(() => write(dir, { ...valid(), project: 'Nope' }), /Invalid manifest/);
});

test('read refuses when directory name and accession disagree', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'manifest-')), 'PRJNA999999');
  mkdirSync(dir);
  write(dir, { ...valid(), accession: 'PRJNA999999' });
  assert.deepEqual(read(dir).accession, 'PRJNA999999');
  const wrong = join(mkdtempSync(join(tmpdir(), 'manifest-')), 'PRJNA000001');
  mkdirSync(wrong);
  // bypass write() validation to plant a mismatched file
  writeFileSync(join(wrong, 'manifest.json'), JSON.stringify(valid()));
  assert.throws(() => read(wrong), /directory/);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `yarn test`
Expected: FAIL, cannot find `manifest.js`.

- [ ] **Step 3: Implement**

Create `shared/scripts/lib/manifest.js`:
```js
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';

export const MANIFEST_FILENAME = 'manifest.json';
export const SUPPORTED_SCHEMA_VERSIONS = [1];
export const TICKET_SYSTEMS = ['redmine', 'github'];

const VALID_PROJECTS = JSON.parse(
  readFileSync(new URL('../../resources/valid-projects.json', import.meta.url), 'utf-8')
);

function rendererExists(datasetType) {
  if (typeof datasetType !== 'string' || !/^[a-z0-9-]+$/.test(datasetType)) return false;
  return existsSync(new URL(`../renderers/${datasetType}.js`, import.meta.url));
}

/**
 * Returns an array of error strings; empty means valid.
 * opts.dirName    - proposal directory basename to compare with accession
 * opts.contactIds - known contact ids from allContacts.xml
 */
export function validate(m, { dirName, contactIds } = {}) {
  const errors = [];
  const push = (msg) => errors.push(msg);

  if (!SUPPORTED_SCHEMA_VERSIONS.includes(m.schemaVersion)) {
    push(`schemaVersion must be one of ${SUPPORTED_SCHEMA_VERSIONS.join(', ')}`);
  }
  if (typeof m.accession !== 'string' || m.accession.length === 0) {
    push('accession is required');
  } else if (dirName && dirName !== m.accession) {
    push(`accession "${m.accession}" does not match proposal directory "${dirName}"`);
  }
  if (!rendererExists(m.datasetType)) {
    push(`datasetType "${m.datasetType}" has no renderer in renderers/`);
  }
  if (!VALID_PROJECTS.includes(m.project)) {
    push(`project "${m.project}" is not valid; expected one of ${VALID_PROJECTS.join(', ')}`);
  }
  if (typeof m.organismAbbrev !== 'string' || m.organismAbbrev.length === 0) {
    push('organismAbbrev is required');
  }
  if (typeof m.targetBuild !== 'string' || !/^\d{2,}$/.test(m.targetBuild)) {
    push('targetBuild must be a string of two or more digits, e.g. "02"');
  }

  if (!m.contacts || typeof m.contacts.primary !== 'string' || m.contacts.primary.length === 0) {
    push('contacts.primary is required');
  }
  if (!m.contacts || !Array.isArray(m.contacts.additional)) {
    push('contacts.additional must be an array');
  }
  if (contactIds && m.contacts) {
    const all = [m.contacts.primary, ...(m.contacts.additional || [])].filter(Boolean);
    for (const id of all) {
      if (!contactIds.includes(id)) push(`contact "${id}" not found in allContacts.xml`);
    }
  }

  if (m.ticket !== undefined) {
    if (!TICKET_SYSTEMS.includes(m.ticket?.system)) push(`ticket.system must be one of ${TICKET_SYSTEMS.join(', ')}`);
    if (typeof m.ticket?.id !== 'string' || m.ticket.id.length === 0) push('ticket.id is required');
    if (typeof m.ticket?.url !== 'string' || !/^https?:\/\//.test(m.ticket.url)) push('ticket.url must be an http(s) URL');
  }

  if (typeof m.curator !== 'string' || !/^[^@\s]+@[^@\s]+$/.test(m.curator)) {
    push('curator must be an email address');
  }
  if (typeof m.createdAt !== 'string' || Number.isNaN(Date.parse(m.createdAt))) {
    push('createdAt must be an ISO 8601 timestamp');
  }
  if (!m.skill || typeof m.skill.name !== 'string' || typeof m.skill.version !== 'string') {
    push('skill.name and skill.version are required');
  }
  return errors;
}

export function assertValid(m, opts) {
  const errors = validate(m, opts);
  if (errors.length > 0) {
    throw new Error(`Invalid manifest:\n  - ${errors.join('\n  - ')}`);
  }
}

export function read(proposalDir, opts = {}) {
  const path = join(proposalDir, MANIFEST_FILENAME);
  if (!existsSync(path)) throw new Error(`No ${MANIFEST_FILENAME} in ${proposalDir}`);
  const m = JSON.parse(readFileSync(path, 'utf-8'));
  assertValid(m, { dirName: basename(proposalDir), ...opts });
  return m;
}

export function write(proposalDir, m, opts = {}) {
  assertValid(m, { dirName: basename(proposalDir), ...opts });
  writeFileSync(join(proposalDir, MANIFEST_FILENAME), JSON.stringify(m, null, 2) + '\n');
}
```

The `datasetType must have a renderer` test needs `shared/scripts/renderers/bulk-rnaseq.js` to exist. Create it as a placeholder for now; Task 7 fills it in:
```js
export function render() { throw new Error('not implemented'); }
```

- [ ] **Step 4: Run tests, expect all passing (17), then commit**

```bash
yarn test
git add shared/scripts/lib/manifest.js shared/scripts/renderers/bulk-rnaseq.js tests/manifest.test.js
git commit -m "Add manifest schema with validation

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Presenter file operations

**Files:**
- Create: `shared/scripts/lib/presenter-file.js`, `tests/presenter-file.test.js`

- [ ] **Step 1: Failing test**

Create `tests/presenter-file.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  presenterNameExists, insertPresenter, extractPresenterName, presenterFileRelativePath
} from '../shared/scripts/lib/presenter-file.js';

const file = `<?xml version="1.0"?>
<datasetPresenters>
  <datasetPresenter name="existing_RSRC">
    <displayName><![CDATA[x]]></displayName>
  </datasetPresenter>
</datasetPresenters>
`;

const block = `  <datasetPresenter name="new_primary_genome_RSRC"
                    >
    <displayName><![CDATA[y]]></displayName>
  </datasetPresenter>`;

test('presenterNameExists finds exact names only', () => {
  assert.equal(presenterNameExists(file, 'existing_RSRC'), true);
  assert.equal(presenterNameExists(file, 'existing'), false);
  assert.equal(presenterNameExists(file, 'new_primary_genome_RSRC'), false);
});

test('insertPresenter places the block before the closing root tag', () => {
  const out = insertPresenter(file, block);
  const idxBlock = out.indexOf('new_primary_genome_RSRC');
  const idxClose = out.lastIndexOf('</datasetPresenters>');
  assert.ok(idxBlock > 0 && idxBlock < idxClose);
  assert.ok(out.endsWith('</datasetPresenters>\n'));
  assert.equal(out.split('<datasetPresenter ').length - 1, 2);
});

test('insertPresenter refuses a file without the root closing tag', () => {
  assert.throws(() => insertPresenter('<nope/>', block), /closing <\/datasetPresenters>/);
});

test('extractPresenterName reads the name attribute across a line break', () => {
  assert.equal(extractPresenterName(block), 'new_primary_genome_RSRC');
});

test('presenterFileRelativePath builds the project file path', () => {
  assert.equal(presenterFileRelativePath('FungiDB'), 'Model/lib/xml/datasetPresenters/FungiDB.xml');
});
```

- [ ] **Step 2: Run to verify failure, then implement**

Create `shared/scripts/lib/presenter-file.js`:
```js
import { join } from 'node:path';

export function presenterFileRelativePath(project) {
  return `Model/lib/xml/datasetPresenters/${project}.xml`;
}

export function presenterFilePath(repoPath, project) {
  return join(repoPath, presenterFileRelativePath(project));
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function presenterNameExists(fileContent, name) {
  return new RegExp(`<datasetPresenter\\s+name="${escapeRegExp(name)}"`).test(fileContent);
}

export function extractPresenterName(block) {
  const m = block.match(/<datasetPresenter\s+name="([^"]+)"/);
  if (!m) throw new Error('Rendered block has no <datasetPresenter name="..."> element');
  return m[1];
}

/** Inserts before the final closing root tag; renderers own their own indentation. */
export function insertPresenter(fileContent, block) {
  const closing = '</datasetPresenters>';
  const idx = fileContent.lastIndexOf(closing);
  if (idx === -1) throw new Error(`Presenter file has no closing ${closing} tag`);
  const before = fileContent.slice(0, idx).replace(/\s*$/, '\n\n');
  return `${before}${block}\n\n${closing}\n`;
}
```

- [ ] **Step 3: Run tests, expect all passing (22), then commit**

```bash
yarn test
git add shared/scripts/lib/presenter-file.js tests/presenter-file.test.js
git commit -m "Add presenter file operations

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Git operations

**Files:**
- Create: `shared/scripts/lib/git-ops.js`, `tests/git-ops.test.js`

- [ ] **Step 1: Failing test**

Create `tests/git-ops.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createGit } from '../shared/scripts/lib/git-ops.js';

/** A bare "origin" plus a working clone with one commit on master. */
function setupRepo() {
  const root = mkdtempSync(join(tmpdir(), 'git-ops-'));
  const bare = join(root, 'origin.git');
  const work = join(root, 'work');
  execFileSync('git', ['init', '--bare', '-q', '--initial-branch=master', bare]);
  execFileSync('git', ['clone', '-q', bare, work]);
  execFileSync('git', ['-C', work, 'config', 'user.email', 'test@example.org']);
  execFileSync('git', ['-C', work, 'config', 'user.name', 'Test']);
  writeFileSync(join(work, 'README'), 'hello\n');
  execFileSync('git', ['-C', work, 'add', 'README']);
  execFileSync('git', ['-C', work, 'commit', '-q', '-m', 'init']);
  execFileSync('git', ['-C', work, 'push', '-q', '-u', 'origin', 'master']);
  return { work, bare };
}

test('currentBranch, isClean, isUpToDate on a fresh clone', () => {
  const { work } = setupRepo();
  const git = createGit(work);
  assert.equal(git.currentBranch(), 'master');
  assert.equal(git.isClean(), true);
  git.fetch();
  assert.equal(git.isUpToDate('master'), true);
  writeFileSync(join(work, 'dirty'), 'x');
  assert.equal(git.isClean(), false);
});

test('createBranch, commit, push, branchExists', () => {
  const { work } = setupRepo();
  const git = createGit(work);
  assert.equal(git.branchExists('proposal/X'), false);
  git.createBranch('proposal/X', 'master');
  assert.equal(git.currentBranch(), 'proposal/X');
  mkdirSync(join(work, 'Proposals', 'X'), { recursive: true });
  writeFileSync(join(work, 'Proposals', 'X', 'manifest.json'), '{}');
  git.add(['Proposals/X']);
  git.commit('Add proposal X');
  git.push('proposal/X');
  assert.equal(git.branchExists('proposal/X'), true);
  assert.equal(git.fileExistsOnRef('origin/proposal/X', 'Proposals/X/manifest.json'), true);
  assert.equal(git.fileExistsOnRef('origin/master', 'Proposals/X/manifest.json'), false);
});

test('amend and force push with lease', () => {
  const { work } = setupRepo();
  const git = createGit(work);
  git.createBranch('proposal/Y', 'master');
  writeFileSync(join(work, 'a'), '1');
  git.add(['a']);
  git.commit('one');
  git.push('proposal/Y');
  writeFileSync(join(work, 'a'), '2');
  git.add(['a']);
  git.amendNoEdit();
  git.push('proposal/Y', { force: true });
  assert.equal(git.showFile('origin/proposal/Y', 'a'), '2');
});

test('rm removes a directory recursively and commitsForPath finds its commits', () => {
  const { work } = setupRepo();
  const git = createGit(work);
  mkdirSync(join(work, 'Proposals', 'Z', 'inputs'), { recursive: true });
  writeFileSync(join(work, 'Proposals', 'Z', 'inputs', 'f.json'), '{}');
  git.add(['Proposals/Z']);
  git.commit('Add Z');
  const commits = git.commitsForPath('master', 'Proposals/Z');
  assert.equal(commits.length, 1);
  git.rm('Proposals/Z');
  git.commit('Remove Z');
  assert.equal(git.fileExistsOnRef('HEAD', 'Proposals/Z/inputs/f.json'), false);
});

test('cherryPick applies commits and reports conflicting files on failure', () => {
  const { work } = setupRepo();
  const git = createGit(work);
  // commit A on master adds Proposals/S; a branch cut before A lacks it
  git.createBranch('rebuild02', 'master');
  git.checkout('master');
  mkdirSync(join(work, 'Proposals', 'S'), { recursive: true });
  writeFileSync(join(work, 'Proposals', 'S', 'manifest.json'), '{}');
  git.add(['Proposals/S']);
  git.commit('Add S');
  const sha = git.commitsForPath('master', 'Proposals/S')[0];
  git.checkout('rebuild02');
  git.createBranch('load/S', 'rebuild02');
  git.cherryPick([sha]);
  assert.equal(git.fileExistsOnRef('HEAD', 'Proposals/S/manifest.json'), true);

  // now force a conflict: same file, different content on both sides
  git.checkout('master');
  writeFileSync(join(work, 'README'), 'master version\n');
  git.add(['README']);
  git.commit('master README');
  const conflicting = git.commitsForPath('master', 'README')[0];
  git.checkout('load/S');
  writeFileSync(join(work, 'README'), 'load version\n');
  git.add(['README']);
  git.commit('load README');
  assert.throws(() => git.cherryPick([conflicting]), /Cherry-pick conflicts in:\n  README/);
  git.abortCherryPick();
  assert.equal(git.isClean(), true);
});

test('openPullRequest shells out to gh with GITHUB_TOKEN removed and returns the URL', () => {
  const calls = [];
  const exec = (cmd, args, opts) => {
    calls.push({ cmd, args, env: opts.env });
    return 'https://github.com/VEuPathDB/VEuPathDatasets/pull/7\n';
  };
  const git = createGit('/nowhere', { exec });
  const url = git.openPullRequest({ base: 'master', head: 'proposal/X', title: 't', body: 'b' });
  assert.equal(url, 'https://github.com/VEuPathDB/VEuPathDatasets/pull/7');
  assert.equal(calls[0].cmd, 'gh');
  assert.deepEqual(calls[0].args.slice(0, 2), ['pr', 'create']);
  assert.equal('GITHUB_TOKEN' in calls[0].env, false);
});
```

- [ ] **Step 2: Run to verify failure, then implement**

Create `shared/scripts/lib/git-ops.js`:
```js
import { execFileSync } from 'node:child_process';

function defaultExec(cmd, args, opts) {
  return execFileSync(cmd, args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
}

/**
 * Thin, explicit wrapper around git and gh for one repository.
 * exec is injectable so tests can stub gh without a network.
 */
export function createGit(repoPath, { exec = defaultExec } = {}) {
  const git = (...args) => exec('git', ['-C', repoPath, ...args], {}).trim();

  const envWithoutToken = () => {
    const env = { ...process.env };
    delete env.GITHUB_TOKEN;
    return env;
  };

  return {
    repoPath,
    currentBranch: () => git('branch', '--show-current'),
    isClean: () => git('status', '--porcelain') === '',
    fetch: () => { git('fetch', '--quiet', 'origin'); },
    isUpToDate: (branch) => git('rev-parse', 'HEAD') === git('rev-parse', `origin/${branch}`),
    branchExists: (name) => {
      try { git('rev-parse', '--verify', '--quiet', `refs/heads/${name}`); return true; }
      catch { return false; }
    },
    createBranch: (name, base) => { git('checkout', '--quiet', '-b', name, base); },
    checkout: (name) => { git('checkout', '--quiet', name); },
    add: (paths) => { git('add', '--', ...paths); },
    rm: (path) => { git('rm', '-r', '--quiet', '--', path); },
    commit: (message) => { git('commit', '--quiet', '-m', message); },
    amendNoEdit: () => { git('commit', '--quiet', '--amend', '--no-edit'); },
    push: (branch, { force = false } = {}) => {
      const args = ['push', '--quiet', '-u', 'origin', branch];
      if (force) args.push('--force-with-lease');
      git(...args);
    },
    fileExistsOnRef: (ref, path) => {
      try { git('cat-file', '-e', `${ref}:${path}`); return true; }
      catch { return false; }
    },
    showFile: (ref, path) => git('show', `${ref}:${path}`),
    commitsForPath: (ref, path) => {
      const out = git('log', '--format=%H', ref, '--', path);
      return out ? out.split('\n') : [];
    },
    cherryPick: (shas) => {
      try {
        git('cherry-pick', ...shas);
      } catch (err) {
        const files = git('diff', '--name-only', '--diff-filter=U');
        throw new Error(`Cherry-pick conflicts in:\n  ${files.split('\n').join('\n  ')}\nResolve or run: git -C ${repoPath} cherry-pick --abort`);
      }
    },
    abortCherryPick: () => { git('cherry-pick', '--abort'); },
    lsTree: (ref, dir) => {
      const out = git('ls-tree', '--name-only', ref, `${dir}/`);
      return out ? out.split('\n') : [];
    },
    openPullRequest: ({ base, head, title, body }) => {
      const out = exec('gh', [
        'pr', 'create', '--base', base, '--head', head, '--title', title, '--body', body
      ], { cwd: repoPath, env: envWithoutToken() });
      const url = out.trim().split('\n').pop();
      if (!/^https?:\/\//.test(url)) throw new Error(`gh pr create did not return a URL:\n${out}`);
      return url;
    }
  };
}
```

- [ ] **Step 3: Run tests, expect all passing (28), then commit**

```bash
yarn test
git add shared/scripts/lib/git-ops.js tests/git-ops.test.js
git commit -m "Add git operations wrapper

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Ticket adapter

**Files:**
- Create: `shared/scripts/lib/ticket/index.js`, `shared/scripts/lib/ticket/redmine.js`, `shared/scripts/lib/ticket/github.js`, `tests/ticket.test.js`

- [ ] **Step 1: Failing test**

Create `tests/ticket.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTicketClient, STATUSES } from '../shared/scripts/lib/ticket/index.js';

const redmineCfg = {
  ticket: {
    system: 'redmine',
    redmine: { url: 'https://redmine.example', project: 'apidb', statusIds: { proposed: 1, loading: 2, done: 5 } }
  }
};
const githubCfg = {
  ticket: {
    system: 'github',
    github: { repo: 'VEuPathDB/VEuPathDatasets', labels: { proposed: 'proposal', loading: 'loading', done: 'loaded' } }
  }
};

function fakeFetch(responses) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : undefined, headers: init.headers });
    const r = responses.shift();
    return { ok: true, status: 200, json: async () => r };
  };
  fn.calls = calls;
  return fn;
}

test('STATUSES is the shared vocabulary', () => {
  assert.deepEqual(STATUSES, ['proposed', 'loading', 'done']);
});

test('redmine create posts an issue and returns a reference', async () => {
  const fetchImpl = fakeFetch([{ issue: { id: 42 } }]);
  const client = createTicketClient(redmineCfg, { fetchImpl, env: { REDMINE_API_KEY: 'k' } });
  const ref = await client.create({ title: 'T', body: 'B' });
  assert.deepEqual(ref, { system: 'redmine', id: '42', url: 'https://redmine.example/issues/42' });
  const call = fetchImpl.calls[0];
  assert.equal(call.url, 'https://redmine.example/issues.json');
  assert.equal(call.method, 'POST');
  assert.equal(call.headers['X-Redmine-API-Key'], 'k');
  assert.deepEqual(call.body, { issue: { project_id: 'apidb', subject: 'T', description: 'B', status_id: 1 } });
});

test('redmine getStatus maps status ids back to our vocabulary', async () => {
  const fetchImpl = fakeFetch([{ issue: { id: 42, status: { id: 2 } } }]);
  const client = createTicketClient(redmineCfg, { fetchImpl, env: { REDMINE_API_KEY: 'k' } });
  assert.equal(await client.getStatus({ system: 'redmine', id: '42' }), 'loading');
});

test('redmine setStatus and comment issue PUTs', async () => {
  const fetchImpl = fakeFetch([{}, {}]);
  const client = createTicketClient(redmineCfg, { fetchImpl, env: { REDMINE_API_KEY: 'k' } });
  await client.setStatus({ system: 'redmine', id: '42' }, 'done');
  await client.comment({ system: 'redmine', id: '42' }, 'note');
  assert.deepEqual(fetchImpl.calls[0].body, { issue: { status_id: 5 } });
  assert.deepEqual(fetchImpl.calls[1].body, { issue: { notes: 'note' } });
  assert.equal(fetchImpl.calls[0].method, 'PUT');
});

test('redmine requires REDMINE_API_KEY', () => {
  assert.throws(() => createTicketClient(redmineCfg, { env: {} }), /REDMINE_API_KEY/);
});

test('github backend drives gh and strips GITHUB_TOKEN', async () => {
  const calls = [];
  const exec = (cmd, args, opts) => {
    calls.push({ cmd, args, env: opts.env });
    if (args[1] === 'create') return 'https://github.com/VEuPathDB/VEuPathDatasets/issues/9\n';
    if (args[1] === 'view') return JSON.stringify({ labels: [{ name: 'loading' }] });
    return '';
  };
  const client = createTicketClient(githubCfg, { exec });
  const ref = await client.create({ title: 'T', body: 'B' });
  assert.deepEqual(ref, { system: 'github', id: '9', url: 'https://github.com/VEuPathDB/VEuPathDatasets/issues/9' });
  assert.ok(calls[0].args.includes('--label') && calls[0].args.includes('proposal'));
  assert.equal('GITHUB_TOKEN' in calls[0].env, false);
  assert.equal(await client.getStatus(ref), 'loading');
  await client.setStatus(ref, 'done');
  const edit = calls.find(c => c.args[1] === 'edit');
  assert.ok(edit.args.includes('--add-label') && edit.args.includes('loaded'));
  assert.ok(edit.args.includes('--remove-label'));
});

test('a reference from a different system than the configured one is refused', async () => {
  const client = createTicketClient(githubCfg, { exec: () => '' });
  await assert.rejects(client.getStatus({ system: 'redmine', id: '1' }), /configured for github/);
});
```

- [ ] **Step 2: Run to verify failure, then implement**

Create `shared/scripts/lib/ticket/index.js`:
```js
import { createRedmineClient } from './redmine.js';
import { createGithubClient } from './github.js';

export const STATUSES = ['proposed', 'loading', 'done'];

export function assertStatus(status) {
  if (!STATUSES.includes(status)) throw new Error(`Unknown ticket status "${status}"; expected ${STATUSES.join(', ')}`);
}

/**
 * Returns { create, comment, getStatus, setStatus } for the configured system.
 * Backends receive injected fetch/exec/env so tests stay offline.
 */
export function createTicketClient(config, { fetchImpl = globalThis.fetch, exec, env = process.env } = {}) {
  const system = config.ticket.system;
  const guard = (client) => {
    const check = (ref) => {
      if (ref.system !== system) throw new Error(`Ticket ${ref.system}#${ref.id} but this workspace is configured for ${system}`);
    };
    return {
      create: (args) => client.create(args),
      comment: async (ref, body) => { check(ref); return client.comment(ref, body); },
      getStatus: async (ref) => { check(ref); return client.getStatus(ref); },
      setStatus: async (ref, status) => { check(ref); assertStatus(status); return client.setStatus(ref, status); }
    };
  };
  switch (system) {
    case 'redmine': return guard(createRedmineClient(config.ticket.redmine, { fetchImpl, env }));
    case 'github': return guard(createGithubClient(config.ticket.github, { exec, env }));
    default: throw new Error(`Unknown ticket system "${system}"`);
  }
}
```

Create `shared/scripts/lib/ticket/redmine.js`:
```js
export function createRedmineClient(cfg, { fetchImpl, env }) {
  const apiKey = env.REDMINE_API_KEY;
  if (!apiKey) throw new Error('REDMINE_API_KEY environment variable is required for the redmine ticket backend');
  const base = cfg.url.replace(/\/$/, '');
  const idToStatus = Object.fromEntries(Object.entries(cfg.statusIds).map(([k, v]) => [String(v), k]));

  async function call(method, path, body) {
    const res = await fetchImpl(`${base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Redmine-API-Key': apiKey },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`Redmine ${method} ${path} failed with HTTP ${res.status}`);
    if (res.status === 204) return {};
    return res.json();
  }

  const url = (id) => `${base}/issues/${id}`;

  return {
    async create({ title, body }) {
      const out = await call('POST', '/issues.json', {
        issue: { project_id: cfg.project, subject: title, description: body, status_id: cfg.statusIds.proposed }
      });
      const id = String(out.issue.id);
      return { system: 'redmine', id, url: url(id) };
    },
    async comment(ref, body) {
      await call('PUT', `/issues/${ref.id}.json`, { issue: { notes: body } });
    },
    async getStatus(ref) {
      const out = await call('GET', `/issues/${ref.id}.json`);
      const status = idToStatus[String(out.issue.status.id)];
      if (!status) throw new Error(`Redmine status id ${out.issue.status.id} is not mapped in ticket.redmine.statusIds`);
      return status;
    },
    async setStatus(ref, status) {
      await call('PUT', `/issues/${ref.id}.json`, { issue: { status_id: cfg.statusIds[status] } });
    }
  };
}
```

Create `shared/scripts/lib/ticket/github.js`:
```js
import { execFileSync } from 'node:child_process';

function defaultExec(cmd, args, opts) {
  return execFileSync(cmd, args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
}

export function createGithubClient(cfg, { exec = defaultExec, env = process.env }) {
  const labelToStatus = Object.fromEntries(Object.entries(cfg.labels).map(([k, v]) => [v, k]));

  const gh = (...args) => {
    const cleanEnv = { ...env };
    delete cleanEnv.GITHUB_TOKEN;
    return exec('gh', [...args, '--repo', cfg.repo], { env: cleanEnv }).trim();
  };

  return {
    async create({ title, body }) {
      const out = gh('issue', 'create', '--title', title, '--body', body, '--label', cfg.labels.proposed);
      const url = out.split('\n').pop();
      const id = url.split('/').pop();
      if (!/^\d+$/.test(id)) throw new Error(`gh issue create did not return an issue URL:\n${out}`);
      return { system: 'github', id, url };
    },
    async comment(ref, body) {
      gh('issue', 'comment', ref.id, '--body', body);
    },
    async getStatus(ref) {
      const { labels } = JSON.parse(gh('issue', 'view', ref.id, '--json', 'labels'));
      const found = labels.map(l => labelToStatus[l.name]).find(Boolean);
      if (!found) throw new Error(`Issue #${ref.id} has none of the status labels ${Object.values(cfg.labels).join(', ')}`);
      return found;
    },
    async setStatus(ref, status) {
      const others = Object.entries(cfg.labels).filter(([k]) => k !== status).map(([, v]) => v);
      const args = ['issue', 'edit', ref.id, '--add-label', cfg.labels[status]];
      for (const l of others) args.push('--remove-label', l);
      gh(...args);
    }
  };
}
```

- [ ] **Step 3: Run tests, expect all passing (34), then commit**

```bash
yarn test
git add shared/scripts/lib/ticket tests/ticket.test.js
git commit -m "Add ticket adapter with Redmine and GitHub backends

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Renderers and fixtures

The renderers are the existing `generate-presenter-xml.js` scripts refactored into pure `render(proposalDir)` functions. Data that used to come from CLI arguments or `TODO` placeholders now comes from the manifest (`project`, `contacts`, `targetBuild`, `organismAbbrev`) and from an optional `curated/presenter-overrides.json`.

**Overrides file** (all keys optional):
```json
{
  "displayName": "…", "shortDisplayName": "…", "shortAttribution": "…",
  "summary": "…", "description": "…", "methodology": "…",
  "pubmedIds": ["12345678"],
  "injectorProps": { "graphType": "line" }
}
```

**Files:**
- Create: `shared/scripts/renderers/genome-assembly.js`, `shared/scripts/renderers/bulk-rnaseq.js` (replace placeholder), `shared/scripts/renderers/_common.js`
- Create: `tests/renderers.test.js`, fixtures under `tests/fixtures/proposals/`

- [ ] **Step 1: Fixtures**

Create `tests/fixtures/proposals/GCA_000001.1/manifest.json`:
```json
{
  "schemaVersion": 1,
  "accession": "GCA_000001.1",
  "datasetType": "genome-assembly",
  "project": "FungiDB",
  "organismAbbrev": "tfakST1",
  "targetBuild": "02",
  "contacts": { "primary": "jane.doe", "additional": ["ravi.kumar"] },
  "curator": "someone@apidb.org",
  "createdAt": "2026-09-18T14:00:00.000Z",
  "skill": { "name": "propose-genome-assembly", "version": "2.0.0" }
}
```

Create `tests/fixtures/proposals/GCA_000001.1/inputs/GCA_000001.1_dataset_report.json`:
```json
{
  "reports": [
    {
      "source_database": "SOURCE_DATABASE_GENBANK",
      "organism": { "organism_name": "Testus fakeus", "infraspecific_names": { "strain": "ST-1" } },
      "assembly_info": {
        "bioproject_accession": "PRJNA000001",
        "release_date": "2024-03-05",
        "assembly_method": "Flye v. 2.9",
        "sequencing_tech": "Oxford Nanopore"
      },
      "assembly_stats": { "genome_coverage": "80.0" },
      "annotation_info": { "release_date": "2024-04-01" },
      "wgs_info": { "wgs_project_accession": "JAAAAA01" }
    }
  ]
}
```

Create `tests/fixtures/proposals/GCA_000001.1/inputs/PRJNA000001_bioproject.json`:
```json
{ "title": "Testus fakeus genome", "description": "Whole genome of Testus fakeus ST-1." }
```

Create `tests/fixtures/proposals/GCA_000001.1/inputs/GCA_000001.1_pubmed.json`:
```json
{ "papers": [ { "pmid": "11111111", "title": "A genome", "lastAuthor": "Doe J" } ] }
```

Create `tests/fixtures/proposals/PRJNA000002/manifest.json`:
```json
{
  "schemaVersion": 1,
  "accession": "PRJNA000002",
  "datasetType": "bulk-rnaseq",
  "project": "FungiDB",
  "organismAbbrev": "tfakST1",
  "targetBuild": "02",
  "contacts": { "primary": "jane.doe", "additional": [] },
  "curator": "someone@apidb.org",
  "createdAt": "2026-09-18T14:00:00.000Z",
  "skill": { "name": "propose-bulk-rnaseq", "version": "2.0.0" }
}
```

Create `tests/fixtures/proposals/PRJNA000002/inputs/PRJNA000002_sra_metadata.json`:
```json
{
  "bioproject": "PRJNA000002",
  "runs": [
    { "run_accession": "SRR1", "sample_accession": "SAMN1", "scientific_name": "Testus fakeus", "library_strategy": "RNA-Seq", "library_layout": "PAIRED", "instrument_model": "Illumina NovaSeq 6000", "experiment_title": "Testus fakeus heat shock" },
    { "run_accession": "SRR2", "sample_accession": "SAMN2", "scientific_name": "Testus fakeus", "library_strategy": "RNA-Seq", "library_layout": "PAIRED", "instrument_model": "Illumina NovaSeq 6000", "experiment_title": "Testus fakeus heat shock" }
  ]
}
```

Create `tests/fixtures/proposals/PRJNA000002/inputs/GSE0002_family.xml`:
```xml
<MINiML><Series><Summary>Heat shock response in Testus fakeus.</Summary></Series></MINiML>
```

Create `tests/fixtures/proposals/PRJNA000002/curated/presenter-overrides.json`:
```json
{
  "shortDisplayName": "Heat shock",
  "shortAttribution": "Doe et al.",
  "pubmedIds": ["22222222"],
  "injectorProps": { "graphType": "line" }
}
```

- [ ] **Step 2: Failing test**

Create `tests/renderers.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render as renderGenome } from '../shared/scripts/renderers/genome-assembly.js';
import { render as renderRnaSeq } from '../shared/scripts/renderers/bulk-rnaseq.js';
import { extractPresenterName } from '../shared/scripts/lib/presenter-file.js';

const fixtures = new URL('./fixtures/proposals/', import.meta.url).pathname;
const genomeDir = fixtures + 'GCA_000001.1';
const rnaDir = fixtures + 'PRJNA000002';

test('genome renderer builds the presenter from manifest and inputs', () => {
  const xml = renderGenome(genomeDir);
  assert.equal(extractPresenterName(xml), 'tfakST1_primary_genome_RSRC');
  assert.match(xml, /<history buildNumber="02"/);
  assert.match(xml, /genomeVersion="GCA_000001\.1"/);
  assert.match(xml, /annotationSource="GenBank" annotationVersion="Apr 1, 2024"/);
  assert.match(xml, /<primaryContactId>jane\.doe<\/primaryContactId>/);
  assert.match(xml, /<contactId>ravi\.kumar<\/contactId>/);
  assert.match(xml, /<pubmedId>11111111<\/pubmedId>/);
  assert.match(xml, /Whole genome of Testus fakeus ST-1\./);
  assert.match(xml, /WGS Project: JAAAAA01\. Assembly method: Flye v\. 2\.9\. Genome coverage: 80\.0x\. Sequencing technology: Oxford Nanopore/);
  assert.match(xml, /templateInjector projectName="FungiDB" className="org\.apidb\.apicommon\.model\.datasetInjector\.AnnotatedGenome"/);
  assert.doesNotMatch(xml, /TODO/);
});

test('genome renderer is deterministic', () => {
  assert.equal(renderGenome(genomeDir), renderGenome(genomeDir));
});

test('rnaseq renderer builds the presenter and applies overrides', () => {
  const xml = renderRnaSeq(rnaDir);
  assert.equal(extractPresenterName(xml), 'tfak_PRJNA000002_rnaSeq_RSRC');
  assert.match(xml, /<datasetPresenter name="tfak_PRJNA000002_rnaSeq_RSRC"\s+projectName="FungiDB">/);
  assert.match(xml, /<shortDisplayName>Heat shock<\/shortDisplayName>/);
  assert.match(xml, /<shortAttribution>Doe et al\.<\/shortAttribution>/);
  assert.match(xml, /<history buildNumber="02"\/>/);
  assert.match(xml, /<pubmedId>22222222<\/pubmedId>/);
  assert.match(xml, /Heat shock response in Testus fakeus\./);
  assert.match(xml, /<prop name="graphType">line<\/prop>/);
  assert.match(xml, /<prop name="hasMultipleSamples">true<\/prop>/);
  assert.match(xml, /<prop name="isDESeq">true<\/prop>/);
  assert.doesNotMatch(xml, /TODO/);
});

test('rnaseq renderer leaves empty elements when no overrides exist', () => {
  const xml = renderRnaSeq(genomeDir.replace('GCA_000001.1', 'PRJNA000002_no_overrides'));
  assert.match(xml, /<shortDisplayName><\/shortDisplayName>/);
});
```

For the last test, create `tests/fixtures/proposals/PRJNA000002_no_overrides/` as a copy of `PRJNA000002` minus `curated/`, with `manifest.json` accession changed to `PRJNA000002_no_overrides` and `inputs/PRJNA000002_no_overrides_sra_metadata.json` renamed accordingly (the `bioproject` field inside also set to `PRJNA000002_no_overrides`).

- [ ] **Step 3: Run to verify failure, then implement the common helper**

Create `shared/scripts/renderers/_common.js`:
```js
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { read as readManifest } from '../lib/manifest.js';

export function loadManifest(proposalDir) {
  return readManifest(proposalDir);
}

export function readInputJson(proposalDir, filename, { optional = false } = {}) {
  const path = join(proposalDir, 'inputs', filename);
  if (!existsSync(path)) {
    if (optional) return null;
    throw new Error(`Required input missing: ${path}`);
  }
  return JSON.parse(readFileSync(path, 'utf-8'));
}

export function findInputBySuffix(proposalDir, suffix) {
  const dir = join(proposalDir, 'inputs');
  if (!existsSync(dir)) return null;
  const name = readdirSync(dir).sort().find(f => f.endsWith(suffix));
  return name ? readFileSync(join(dir, name), 'utf-8') : null;
}

export function loadOverrides(proposalDir) {
  const path = join(proposalDir, 'curated', 'presenter-overrides.json');
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf-8')) : {};
}

export function escapeForCDATA(text) {
  return String(text).replace(/\]\]>/g, ']]&gt;');
}

export function contactElements(ids) {
  return ids.map(id => `    <contactId>${id}</contactId>`).join('\n');
}

export function pubmedElements(ids) {
  return ids.map(id => `    <pubmedId>${id}</pubmedId>`).join('\n');
}

/** Renders <prop> lines, letting overrides.injectorProps replace defaults by name. */
export function injectorProps(defaults, overrides = {}) {
  return Object.entries({ ...defaults, ...overrides })
    .map(([name, value]) => `      <prop name="${name}">${value}</prop>`)
    .join('\n');
}
```

- [ ] **Step 4: Implement the genome renderer**

Create `shared/scripts/renderers/genome-assembly.js`:
```js
import {
  loadManifest, readInputJson, loadOverrides, escapeForCDATA, contactElements, pubmedElements, injectorProps
} from './_common.js';

function formatDate(isoDate) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const [year, month, day] = isoDate.split('-');
  return `${months[parseInt(month, 10) - 1]} ${parseInt(day, 10)}, ${year}`;
}

function methodologyFrom(report) {
  const parts = [];
  if (report.wgs_info?.wgs_project_accession) parts.push(`WGS Project: ${report.wgs_info.wgs_project_accession}`);
  if (report.assembly_info?.assembly_method) parts.push(`Assembly method: ${report.assembly_info.assembly_method}`);
  if (report.assembly_stats?.genome_coverage) parts.push(`Genome coverage: ${report.assembly_stats.genome_coverage}x`);
  if (report.assembly_info?.sequencing_tech) parts.push(`Sequencing technology: ${report.assembly_info.sequencing_tech}`);
  return parts.join('. ');
}

export function presenterName(proposalDir) {
  return `${loadManifest(proposalDir).organismAbbrev}_primary_genome_RSRC`;
}

export function render(proposalDir) {
  const m = loadManifest(proposalDir);
  const o = loadOverrides(proposalDir);

  const report = readInputJson(proposalDir, `${m.accession}_dataset_report.json`).reports[0];
  const bioProjectAccession = report.assembly_info?.bioproject_accession;
  if (!bioProjectAccession) throw new Error('BioProject accession not found in assembly report');

  const bioProject = readInputJson(proposalDir, `${bioProjectAccession}_bioproject.json`, { optional: true });
  const pubmed = readInputJson(proposalDir, `${m.accession}_pubmed.json`, { optional: true });

  const organismName = report.organism?.organism_name || '';
  const strain = report.organism?.infraspecific_names?.strain || '';
  const organismForSummary = strain ? `<i>${organismName}</i> ${strain}` : `<i>${organismName}</i>`;

  const isRefSeq = (report.source_database || '').includes('REFSEQ');
  const annotationDate = report.annotation_info?.release_date || report.assembly_info?.release_date || '';

  const description = o.description ?? bioProject?.description ?? bioProject?.title
    ?? report.assembly_info?.bioproject_lineage?.[0]?.bioprojects?.[0]?.title ?? '';
  const methodology = o.methodology ?? methodologyFrom(report);
  const pubmedIds = o.pubmedIds ?? (pubmed?.papers?.map(p => p.pmid) || []);
  const name = `${m.organismAbbrev}_primary_genome_RSRC`;

  const contacts = contactElements(m.contacts.additional);
  const pubmeds = pubmedElements(pubmedIds);

  return `  <datasetPresenter name="${name}"
                    >
    <displayName><![CDATA[${o.displayName ?? 'Genome Sequence and Annotation'}]]></displayName>
    <shortDisplayName>${o.shortDisplayName ?? ''}</shortDisplayName>
    <shortAttribution>${o.shortAttribution ?? ''}</shortAttribution>
    <summary><![CDATA[${o.summary ?? `Genome Sequence and Annotation of ${organismForSummary}`}
                  ]]></summary>
    <description><![CDATA[

<b>General Description:</b> ${escapeForCDATA(description)}
<br><br><b>Methodology used:</b> ${escapeForCDATA(methodology)}

                  ]]></description>
    <protocol></protocol>
    <caveat></caveat>
    <acknowledgement></acknowledgement>
    <releasePolicy></releasePolicy>
    <history buildNumber="${m.targetBuild}"
             genomeSource="INSDC" genomeVersion="${m.accession}"
             annotationSource="${isRefSeq ? 'RefSeq' : 'GenBank'}" annotationVersion="${annotationDate ? formatDate(annotationDate) : ''}"/>
    <primaryContactId>${m.contacts.primary}</primaryContactId>
${contacts ? contacts + '\n' : ''}    <link>
      <text>NCBI Bioproject</text>
      <url>https://www.ncbi.nlm.nih.gov/bioproject/${bioProjectAccession}</url>
    </link>
    <link>
      <text>GenBank Assembly</text>
      <url>https://www.ncbi.nlm.nih.gov/assembly/${m.accession}</url>
    </link>
${pubmeds ? pubmeds + '\n' : ''}    <templateInjector projectName="${m.project}" className="org.apidb.apicommon.model.datasetInjector.AnnotatedGenome">
${injectorProps({
    isEuPathDBSite: 'true',
    optionalSpecies: '',
    specialLinkDisplayText: '',
    updatedAnnotationText: '',
    isCurated: 'false',
    specialLinkExternalDbName: '',
    showReferenceTranscriptomics: 'false'
  }, o.injectorProps)}
    </templateInjector>
  </datasetPresenter>`;
}
```

- [ ] **Step 5: Implement the RNA-seq renderer (replaces the placeholder)**

Create `shared/scripts/renderers/bulk-rnaseq.js`:
```js
import {
  loadManifest, readInputJson, findInputBySuffix, loadOverrides, escapeForCDATA, contactElements, pubmedElements, injectorProps
} from './_common.js';

/** First letter of genus plus first three of species, matching existing presenter names. */
function shortOrganismAbbrev(organismName) {
  const [genus = '', species = ''] = organismName.trim().split(/\s+/);
  return genus.charAt(0).toLowerCase() + species.substring(0, 3).toLowerCase();
}

function organismFromRuns(runs) {
  return [...new Set(runs.map(r => r.scientific_name).filter(Boolean))][0] || 'Unknown organism';
}

function descriptionFrom(sra, miniml) {
  const summary = miniml?.match(/<Summary[^>]*>([\s\S]*?)<\/Summary>/i);
  if (summary) return summary[1].trim();
  const titles = [...new Set(sra.runs.map(r => r.experiment_title).filter(Boolean))];
  return titles[0] || '';
}

function methodologyFrom(runs) {
  const uniq = (key) => [...new Set(runs.map(r => r[key]).filter(Boolean))];
  const parts = [];
  const strategies = uniq('library_strategy'); if (strategies.length) parts.push(`Library strategy: ${strategies.join(', ')}`);
  const layouts = uniq('library_layout'); if (layouts.length) parts.push(`Layout: ${layouts.join(', ')}`);
  const instruments = uniq('instrument_model'); if (instruments.length) parts.push(`Sequencing: ${instruments.join(', ')}`);
  return parts.join('. ');
}

function nameFor(m, runs) {
  return `${shortOrganismAbbrev(organismFromRuns(runs))}_${m.accession}_rnaSeq_RSRC`;
}

export function presenterName(proposalDir) {
  const m = loadManifest(proposalDir);
  const sra = readInputJson(proposalDir, `${m.accession}_sra_metadata.json`);
  return nameFor(m, sra.runs || []);
}

export function render(proposalDir) {
  const m = loadManifest(proposalDir);
  const o = loadOverrides(proposalDir);
  const sra = readInputJson(proposalDir, `${m.accession}_sra_metadata.json`);
  const miniml = findInputBySuffix(proposalDir, '_family.xml');

  const runs = sra.runs || [];
  const organismName = organismFromRuns(runs);
  const organismDisplay = `<i>${organismName}</i>`;
  const sampleCount = new Set(runs.map(r => r.sample_accession)).size;
  const hasMultipleSamples = sampleCount > 1 ? 'true' : 'false';

  const description = o.description ?? descriptionFrom(sra, miniml);
  const methodology = o.methodology ?? methodologyFrom(runs);
  const pubmedIds = o.pubmedIds ?? [];
  const contacts = contactElements(m.contacts.additional);
  const pubmeds = pubmedElements(pubmedIds);

  return `  <datasetPresenter name="${nameFor(m, runs)}"
                    projectName="${m.project}">
    <displayName><![CDATA[${o.displayName ?? `RNA-Seq analysis of ${organismDisplay}`}]]></displayName>
    <shortDisplayName>${o.shortDisplayName ?? ''}</shortDisplayName>
    <shortAttribution>${o.shortAttribution ?? ''}</shortAttribution>
    <summary><![CDATA[${o.summary ?? `RNA-Seq analysis of ${organismDisplay}`}]]></summary>
    <description><![CDATA[

<b>General Description:</b> ${escapeForCDATA(description)}
<br><br><b>Methodology used:</b> ${escapeForCDATA(methodology)}

                  ]]></description>
    <protocol></protocol>
    <caveat></caveat>
    <acknowledgement></acknowledgement>
    <releasePolicy></releasePolicy>
    <history buildNumber="${m.targetBuild}"/>
    <primaryContactId>${m.contacts.primary}</primaryContactId>
${contacts ? contacts + '\n' : ''}    <link>
      <text>NCBI Bioproject</text>
      <url>https://www.ncbi.nlm.nih.gov/bioproject/${m.accession}</url>
    </link>
${pubmeds ? pubmeds + '\n' : ''}    <templateInjector className="org.apidb.apicommon.model.datasetInjector.RNASeq">
${injectorProps({
    switchStrandsGBrowse: 'false',
    switchStrandsProfiles: 'false',
    graphForceXLabelsHorizontal: 'false',
    hasFishersExactTestData: 'false',
    isEuPathDBSite: 'true',
    jbrowseTracksOnly: 'false',
    graphType: 'bar',
    graphColor: '#336699',
    graphBottomMarginSize: '50',
    graphSampleLabels: '',
    showIntronJunctions: 'true',
    includeInUnifiedJunctions: '',
    isAlignedToAnnotatedGenome: 'true',
    hasMultipleSamples,
    graphXAxisSamplesDescription: '',
    graphPriorityOrderGrouping: '1000',
    optionalQuestionDescription: '',
    isDESeq: hasMultipleSamples,
    isDEGseq: 'false',
    includeProfileSimilarity: 'false',
    profileTimeShift: ''
  }, o.injectorProps)}
    </templateInjector>
  </datasetPresenter>`;
}
```

- [ ] **Step 6: Run tests, expect all passing (38), then commit**

```bash
yarn test
git add shared/scripts/renderers tests/renderers.test.js tests/fixtures/proposals
git commit -m "Add genome and RNA-seq renderers reading proposals

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: render-proposal CLI

**Files:**
- Create: `shared/scripts/render-proposal.js`, `tests/render-proposal.test.js`

- [ ] **Step 1: Failing test**

Create `tests/render-proposal.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const cli = new URL('../shared/scripts/render-proposal.js', import.meta.url).pathname;
const fixtures = new URL('./fixtures/proposals/', import.meta.url).pathname;

test('prints XML for a proposal directory', () => {
  const out = execFileSync('node', [cli, fixtures + 'GCA_000001.1'], { encoding: 'utf-8' });
  assert.match(out, /<datasetPresenter name="tfakST1_primary_genome_RSRC"/);
});

test('--name prints only the presenter name', () => {
  const out = execFileSync('node', [cli, '--name', fixtures + 'PRJNA000002'], { encoding: 'utf-8' });
  assert.equal(out.trim(), 'tfak_PRJNA000002_rnaSeq_RSRC');
});

test('fails with a clear message for a missing directory', () => {
  assert.throws(
    () => execFileSync('node', [cli, '/no/such/dir'], { encoding: 'utf-8', stdio: 'pipe' }),
    (err) => /No manifest\.json/.test(err.stderr)
  );
});
```

- [ ] **Step 2: Run to verify failure, then implement**

Create `shared/scripts/render-proposal.js` (make executable):
```js
#!/usr/bin/env node
/**
 * render-proposal.js - Renders presenter XML from a proposal directory.
 *
 * Usage: node render-proposal.js [--name] <proposalDir>
 *   --name  print only the presenter name instead of the XML
 */
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { read as readManifest } from './lib/manifest.js';

export async function loadRenderer(datasetType) {
  return import(new URL(`./renderers/${datasetType}.js`, import.meta.url));
}

async function main() {
  const { values, positionals } = parseArgs({
    options: { name: { type: 'boolean', default: false } },
    allowPositionals: true
  });
  if (positionals.length !== 1) {
    console.error('Usage: node render-proposal.js [--name] <proposalDir>');
    process.exit(1);
  }
  const proposalDir = resolve(positionals[0]);
  const manifest = readManifest(proposalDir);
  const renderer = await loadRenderer(manifest.datasetType);
  process.stdout.write(values.name ? renderer.presenterName(proposalDir) + '\n' : renderer.render(proposalDir) + '\n');
}

main().catch(err => { console.error(`Error: ${err.message}`); process.exit(1); });
```

Run: `chmod +x shared/scripts/render-proposal.js`

- [ ] **Step 3: Run tests, expect all passing (41), then commit**

```bash
yarn test
git add shared/scripts/render-proposal.js tests/render-proposal.test.js
git commit -m "Add render-proposal CLI

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Sync configuration

**Files:**
- Modify: `package.json` `sharedFiles`

- [ ] **Step 1: Register every new shared file for both existing skills**

Add to `sharedFiles` (Plan 4 appends `load-proposals` to each). Golden `expected.xml` files under `tests/fixtures/` are not synced; tests are not part of skills:
```json
    "scripts/lib/config.js": ["curate-genome-assembly", "curate-bulk-rnaseq"],
    "scripts/lib/contacts.js": ["curate-genome-assembly", "curate-bulk-rnaseq"],
    "scripts/lib/manifest.js": ["curate-genome-assembly", "curate-bulk-rnaseq"],
    "scripts/lib/presenter-file.js": ["curate-genome-assembly", "curate-bulk-rnaseq"],
    "scripts/lib/git-ops.js": ["curate-genome-assembly", "curate-bulk-rnaseq"],
    "scripts/lib/ticket/index.js": ["curate-genome-assembly", "curate-bulk-rnaseq"],
    "scripts/lib/ticket/redmine.js": ["curate-genome-assembly", "curate-bulk-rnaseq"],
    "scripts/lib/ticket/github.js": ["curate-genome-assembly", "curate-bulk-rnaseq"],
    "scripts/lib/ticket/statuses.js": ["curate-genome-assembly", "curate-bulk-rnaseq"],
    "scripts/renderers/_common.js": ["curate-genome-assembly", "curate-bulk-rnaseq"],
    "scripts/renderers/genome-assembly.js": ["curate-genome-assembly", "curate-bulk-rnaseq"],
    "scripts/renderers/bulk-rnaseq.js": ["curate-genome-assembly", "curate-bulk-rnaseq"],
    "scripts/render-proposal.js": ["curate-genome-assembly", "curate-bulk-rnaseq"]
```

Both renderers sync into both skills because `manifest.js` checks `renderers/<type>.js` exists relative to itself.

- [ ] **Step 2: Sync and smoke test from inside a skill copy**

Run:
```bash
yarn sync-shared
node skills/curate-genome-assembly/scripts/render-proposal.js --name tests/fixtures/proposals/GCA_000001.1
```
Expected: `tfakST1_primary_genome_RSRC`. This proves relative imports survive the sync.

- [ ] **Step 3: Update the pre-commit hook glob so nested synced files are staged**

Edit `.husky/pre-commit`, replacing:
```bash
git add skills/*/scripts/* skills/*/resources/* 2>/dev/null || true
```
with:
```bash
git add skills/*/scripts skills/*/resources 2>/dev/null || true
```

- [ ] **Step 4: Commit**

```bash
git add package.json .husky/pre-commit skills/
git commit -m "Sync shared library and renderers into curation skills

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Developer documentation

**Files:**
- Modify: `docs/development.md`

- [ ] **Step 1: Document the library and tests**

Append a section after "Shared File System":

````markdown
## Shared Library

`shared/scripts/lib/` is a zero-dependency library synced into skills that
need it. Modules import each other by relative path, so the directory shape
must be preserved when adding `sharedFiles` entries.

| Module | Purpose |
|---|---|
| `lib/config.js` | Loads `curator.config.json` from the curation workspace |
| `lib/manifest.js` | Proposal manifest schema: `validate`, `read`, `write` |
| `lib/contacts.js` | Reads contact ids from `allContacts.xml` |
| `lib/presenter-file.js` | Insert and lookup in a project presenter file |
| `lib/git-ops.js` | `createGit(repoPath)`: branch, commit, push, `gh pr create` |
| `lib/ticket/` | `createTicketClient(config)`: Redmine or GitHub issues |
| `renderers/<type>.js` | `render(proposalDir)` and `presenterName(proposalDir)` |
| `render-proposal.js` | CLI over the renderers |

### Adding a dataset type

1. Create `shared/scripts/renderers/<type>.js` exporting `render` and `presenterName`.
2. Add a fixture under `tests/fixtures/proposals/` and a test in `tests/renderers.test.js`.
3. Register the renderer in `package.json` `sharedFiles` for every skill.
4. Create the `propose-<type>` skill.

### Tests

```bash
yarn test
```

Tests run against `shared/` with Node's built-in runner. Git tests use a
throwaway repository in the system temp directory. Ticket backends are tested
with injected stubs; no test reaches the network.
````

- [ ] **Step 2: Commit**

```bash
git add docs/development.md
git commit -m "Document shared library and tests

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Done when

- `yarn test` passes with no network access.
- `yarn sync-shared` reports zero errors and `node skills/curate-bulk-rnaseq/scripts/render-proposal.js --name tests/fixtures/proposals/PRJNA000002` prints the presenter name.
- `curator.config.json` is gitignored and `curator.config.example.json` is committed.
