# Plan 3 of 4: Phase 1 Propose Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `curate-genome-assembly` and `curate-bulk-rnaseq` into `propose-genome-assembly` and `propose-bulk-rnaseq`, which end by writing a proposal to VEuPathDatasets, opening a PR against master, and creating a ticket.

**Architecture:** Three shared operations in `shared/scripts/lib/proposal-ops.js` (`startProposal`, `writeProposal`, `publishProposal`) take injected git and ticket clients so they are testable offline. Three thin CLIs wrap them. Data fetching and contact curation steps are untouched. The old `generate-presenter-xml.js` scripts are deleted; the preview uses `render-proposal.js` from Plan 2.

**Tech Stack:** Node 18+ standard library. `parseArgs` from `node:util`.

**Spec:** `docs/superpowers/specs/2026-09-18-two-phase-proposals-design.md`

**Depends on:** Plans 1 and 2 on the `two-phase-proposals` branch.

---

## File structure

| Path | Action | Responsibility |
|---|---|---|
| `shared/scripts/lib/proposal-ops.js` | Create | `startProposal`, `writeProposal`, `publishProposal` |
| `shared/scripts/start-proposal.js` | Create | CLI: preconditions, create `proposal/<acc>` branch |
| `shared/scripts/write-proposal.js` | Create | CLI: copy inputs/curated, write manifest |
| `shared/scripts/publish-proposal.js` | Create | CLI: commit, push, PR, ticket, amend |
| `tests/proposal-ops.test.js` | Create | Offline tests with a temp git repo and stubs |
| `skills/propose-genome-assembly/` | Rename from `curate-genome-assembly` | Phase 1 genome skill |
| `skills/propose-bulk-rnaseq/` | Rename from `curate-bulk-rnaseq` | Phase 1 RNA-seq skill |
| `skills/*/scripts/generate-presenter-xml.js` | Delete | Replaced by renderers |
| `skills/*/resources/step-*.md` | Create/Modify | New write and publish steps |
| `package.json`, `README.md`, `CLAUDE.md` | Modify | Names and sync targets |

---

### Task 1: Rename the skills

**Files:**
- Rename: `skills/curate-genome-assembly` to `skills/propose-genome-assembly`, `skills/curate-bulk-rnaseq` to `skills/propose-bulk-rnaseq`
- Modify: `package.json` `sharedFiles`, both `SKILL.md` frontmatter, `README.md`

- [ ] **Step 1: Move directories and rewrite sync targets**

Run:
```bash
git mv skills/curate-genome-assembly skills/propose-genome-assembly
git mv skills/curate-bulk-rnaseq skills/propose-bulk-rnaseq
sed -i 's/"curate-genome-assembly"/"propose-genome-assembly"/g; s/"curate-bulk-rnaseq"/"propose-bulk-rnaseq"/g' package.json
yarn sync-shared
```
Expected: sync reports zero errors; no `skills/curate-*` directories recreated.

- [ ] **Step 2: Frontmatter**

`skills/propose-genome-assembly/SKILL.md` lines 1-4:
```yaml
---
name: propose-genome-assembly
description: Propose a genome assembly dataset for VEuPathDB - fetch NCBI metadata, curate contacts, write a proposal to VEuPathDatasets, open the PR and ticket
---
```
`skills/propose-bulk-rnaseq/SKILL.md` lines 1-4:
```yaml
---
name: propose-bulk-rnaseq
description: Propose a bulk RNA-seq dataset for VEuPathDB - fetch SRA/GEO metadata, analyze samples, curate contacts, write a proposal to VEuPathDatasets, generate pipeline configs, open the PR and ticket
---
```

- [ ] **Step 3: Names in README and CLAUDE.md**

Run:
```bash
sed -i 's/curate-genome-assembly/propose-genome-assembly/g; s/curate-bulk-rnaseq/propose-bulk-rnaseq/g' README.md CLAUDE.md docs/development.md CLAUDE-skills-strategy.md
grep -rn 'curate-genome-assembly\|curate-bulk-rnaseq' --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=docs/superpowers . | grep -v '^./docs/superpowers/'
```
Expected: no output. (Cross-skill references in `skills/propose-bulk-rnaseq/SKILL.md` to `sample-annotations-to-stf` are unaffected.)

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "Rename curate-* skills to propose-*

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: proposal-ops library

**Files:**
- Create: `shared/scripts/lib/proposal-ops.js`, `tests/proposal-ops.test.js`

- [ ] **Step 1: Failing test**

Create `tests/proposal-ops.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createGit } from '../shared/scripts/lib/git-ops.js';
import { startProposal, writeProposal, publishProposal } from '../shared/scripts/lib/proposal-ops.js';

const fixtures = new URL('./fixtures/', import.meta.url).pathname;

/** Bare origin + clone that looks like VEuPathDatasets: master with allContacts.xml. */
function setupRepo() {
  const root = mkdtempSync(join(tmpdir(), 'proposal-ops-'));
  const bare = join(root, 'origin.git');
  const repo = join(root, 'VEuPathDatasets');
  execFileSync('git', ['init', '--bare', '-q', '--initial-branch=master', bare]);
  execFileSync('git', ['clone', '-q', bare, repo]);
  execFileSync('git', ['-C', repo, 'config', 'user.email', 'someone@apidb.org']);
  execFileSync('git', ['-C', repo, 'config', 'user.name', 'Some One']);
  mkdirSync(join(repo, 'Model/lib/xml/datasetPresenters/contacts'), { recursive: true });
  cpSync(join(fixtures, 'allContacts.xml'), join(repo, 'Model/lib/xml/datasetPresenters/contacts/allContacts.xml'));
  execFileSync('git', ['-C', repo, 'add', '.']);
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'init']);
  execFileSync('git', ['-C', repo, 'push', '-q', '-u', 'origin', 'master']);
  return { root, repo };
}

function stubTicket({ status = 'proposed' } = {}) {
  const calls = [];
  return {
    calls,
    async create({ title, body }) { calls.push(['create', title, body]); return { system: 'redmine', id: '42', url: 'https://r/issues/42' }; },
    async comment(ref, body) { calls.push(['comment', ref.id, body]); },
    async getStatus(ref) { calls.push(['getStatus', ref.id]); return status; },
    async setStatus(ref, s) { calls.push(['setStatus', ref.id, s]); }
  };
}

const manifestInput = {
  accession: 'GCA_000001.1', datasetType: 'genome-assembly', project: 'FungiDB',
  organismAbbrev: 'tfakST1', targetBuild: '02',
  contacts: { primary: 'jane.doe', additional: ['ravi.kumar'] },
  skill: { name: 'propose-genome-assembly', version: '2.0.0' }
};

test('startProposal refuses when not on master or dirty', async () => {
  const { repo } = setupRepo();
  const git = createGit(repo);
  writeFileSync(join(repo, 'junk'), 'x');
  await assert.rejects(startProposal({ git, ticket: stubTicket(), accession: 'X' }), /working tree is not clean/);
});

test('startProposal creates the branch for a new accession', async () => {
  const { repo } = setupRepo();
  const git = createGit(repo);
  const result = await startProposal({ git, ticket: stubTicket(), accession: 'GCA_000001.1' });
  assert.equal(result.mode, 'new');
  assert.equal(git.currentBranch(), 'proposal/GCA_000001.1');
});

test('startProposal on an existing proposal consults the ticket', async () => {
  const { repo } = setupRepo();
  // plant an existing proposal with a ticket on master
  const dir = join(repo, 'Proposals/GCA_000001.1');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({
    ...manifestInput, schemaVersion: 1, curator: 'someone@apidb.org', createdAt: '2026-09-18T00:00:00.000Z',
    ticket: { system: 'redmine', id: '42', url: 'https://r/issues/42' }
  }));
  execFileSync('git', ['-C', repo, 'add', '.']);
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'existing']);
  execFileSync('git', ['-C', repo, 'push', '-q']);

  const blocked = stubTicket({ status: 'loading' });
  await assert.rejects(startProposal({ git: createGit(repo), ticket: blocked, accession: 'GCA_000001.1' }), /status is "loading"/);

  const ok = await startProposal({ git: createGit(repo), ticket: stubTicket({ status: 'proposed' }), accession: 'GCA_000001.1' });
  assert.equal(ok.mode, 'update');
  assert.equal(ok.existingTicket.id, '42');
});

test('writeProposal copies files and writes a valid manifest', async () => {
  const { repo, root } = setupRepo();
  const tmp = join(root, 'tmp'); mkdirSync(tmp);
  const src = join(fixtures, 'proposals/GCA_000001.1/inputs');
  for (const f of ['GCA_000001.1_dataset_report.json', 'PRJNA000001_bioproject.json', 'GCA_000001.1_pubmed.json']) {
    cpSync(join(src, f), join(tmp, f));
  }
  const dir = writeProposal({
    repoPath: repo, manifestInput, curator: 'someone@apidb.org',
    inputs: [join(tmp, 'GCA_000001.1_dataset_report.json'), join(tmp, 'PRJNA000001_bioproject.json'), join(tmp, 'GCA_000001.1_pubmed.json')],
    curated: []
  });
  assert.equal(dir, join(repo, 'Proposals/GCA_000001.1'));
  assert.ok(existsSync(join(dir, 'inputs/GCA_000001.1_dataset_report.json')));
  const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf-8'));
  assert.equal(m.schemaVersion, 1);
  assert.equal(m.curator, 'someone@apidb.org');
  assert.equal(m.ticket, undefined);
  assert.ok(!Number.isNaN(Date.parse(m.createdAt)));
});

test('writeProposal rejects unknown contacts', async () => {
  const { repo } = setupRepo();
  assert.throws(() => writeProposal({
    repoPath: repo, curator: 'someone@apidb.org', inputs: [], curated: [],
    manifestInput: { ...manifestInput, contacts: { primary: 'nobody', additional: [] } }
  }), /nobody.*not found in allContacts/);
});

test('publishProposal commits, pushes, opens PR, creates ticket, amends manifest', async () => {
  const { repo, root } = setupRepo();
  const ghCalls = [];
  const exec = (cmd, args, opts) => {
    if (cmd === 'gh') { ghCalls.push(args); return 'https://github.com/VEuPathDB/VEuPathDatasets/pull/7\n'; }
    return execFileSync(cmd, args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
  };
  const git = createGit(repo, { exec });
  const ticket = stubTicket();
  await startProposal({ git, ticket, accession: 'GCA_000001.1' });

  const tmp = join(root, 'tmp'); mkdirSync(tmp);
  const src = join(fixtures, 'proposals/GCA_000001.1/inputs');
  cpSync(join(src, 'GCA_000001.1_dataset_report.json'), join(tmp, 'GCA_000001.1_dataset_report.json'));
  writeProposal({ repoPath: repo, manifestInput, curator: 'someone@apidb.org', inputs: [join(tmp, 'GCA_000001.1_dataset_report.json')], curated: [] });

  const result = await publishProposal({ git, ticket, repoPath: repo, accession: 'GCA_000001.1' });
  assert.equal(result.prUrl, 'https://github.com/VEuPathDB/VEuPathDatasets/pull/7');
  assert.equal(result.ticket.id, '42');
  assert.equal(git.isClean(), true);
  assert.equal(ghCalls[0][1], 'create');
  assert.ok(ghCalls[0].includes('master'));
  assert.equal(ticket.calls[0][0], 'create');
  assert.match(ticket.calls[0][2], /pull\/7/);
  const onRemote = JSON.parse(git.showFile('origin/proposal/GCA_000001.1', 'Proposals/GCA_000001.1/manifest.json'));
  assert.deepEqual(onRemote.ticket, { system: 'redmine', id: '42', url: 'https://r/issues/42' });
  assert.equal(git.commitsForPath('origin/proposal/GCA_000001.1', 'Proposals/GCA_000001.1').length, 1);
});

test('publishProposal on an update comments instead of creating a ticket', async () => {
  const { repo, root } = setupRepo();
  const exec = (cmd, args, opts) => cmd === 'gh'
    ? 'https://github.com/VEuPathDB/VEuPathDatasets/pull/8\n'
    : execFileSync(cmd, args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
  const git = createGit(repo, { exec });
  const ticket = stubTicket();
  await startProposal({ git, ticket, accession: 'GCA_000001.1' });
  const tmp = join(root, 'tmp'); mkdirSync(tmp);
  cpSync(join(fixtures, 'proposals/GCA_000001.1/inputs/GCA_000001.1_dataset_report.json'), join(tmp, 'r.json'));
  writeProposal({ repoPath: repo, manifestInput, curator: 'someone@apidb.org', inputs: [join(tmp, 'r.json')], curated: [] });
  const result = await publishProposal({
    git, ticket, repoPath: repo, accession: 'GCA_000001.1',
    existingTicket: { system: 'redmine', id: '42', url: 'https://r/issues/42' }
  });
  assert.equal(result.ticket.id, '42');
  assert.equal(ticket.calls[0][0], 'comment');
});
```

- [ ] **Step 2: Run to verify failure, then implement**

Create `shared/scripts/lib/proposal-ops.js`:
```js
import { mkdirSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { join, basename } from 'node:path';
import { write as writeManifest, read as readManifest, validate, MANIFEST_FILENAME } from './manifest.js';
import { readContactIds, contactsPath, CONTACTS_RELATIVE_PATH } from './contacts.js';

export const PROPOSALS_DIR = 'Proposals';
export const proposalBranch = (accession) => `proposal/${accession}`;
export const proposalRelativePath = (accession) => `${PROPOSALS_DIR}/${accession}`;

/**
 * Verifies the checkout is on a clean, current master; if a proposal already
 * exists on origin/master, consults its ticket. Creates proposal/<accession>.
 * Returns { mode: 'new' } or { mode: 'update', existingTicket }.
 */
export async function startProposal({ git, ticket, accession }) {
  git.fetch();
  if (git.currentBranch() !== 'master') throw new Error(`Expected to be on master, but on "${git.currentBranch()}"`);
  if (!git.isClean()) throw new Error('VEuPathDatasets working tree is not clean; commit or stash first');
  if (!git.isUpToDate('master')) throw new Error('master is behind origin/master; run: git -C veupathdb-repos/VEuPathDatasets pull');
  if (git.branchExists(proposalBranch(accession))) {
    throw new Error(`Branch ${proposalBranch(accession)} already exists. Delete it to start over:\n  git -C veupathdb-repos/VEuPathDatasets branch -D ${proposalBranch(accession)}`);
  }

  let result = { mode: 'new' };
  const manifestPath = `${proposalRelativePath(accession)}/${MANIFEST_FILENAME}`;
  if (git.fileExistsOnRef('origin/master', manifestPath)) {
    const existing = JSON.parse(git.showFile('origin/master', manifestPath));
    if (existing.ticket) {
      const status = await ticket.getStatus(existing.ticket);
      if (status !== 'proposed') {
        throw new Error(`Proposal ${accession} exists and its ticket ${existing.ticket.url} status is "${status}". It cannot be updated.`);
      }
    }
    result = { mode: 'update', existingTicket: existing.ticket };
  }

  git.createBranch(proposalBranch(accession), 'master');
  return result;
}

/**
 * Writes Proposals/<accession>/ with inputs/, curated/ and manifest.json.
 * Replaces any existing directory contents. Returns the proposal directory.
 */
export function writeProposal({ repoPath, manifestInput, curator, inputs, curated }) {
  const dir = join(repoPath, PROPOSALS_DIR, manifestInput.accession);
  const contactIds = readContactIds(contactsPath(repoPath));

  const manifest = {
    schemaVersion: 1,
    accession: manifestInput.accession,
    datasetType: manifestInput.datasetType,
    project: manifestInput.project,
    organismAbbrev: manifestInput.organismAbbrev,
    targetBuild: manifestInput.targetBuild,
    contacts: { primary: manifestInput.contacts.primary, additional: manifestInput.contacts.additional || [] },
    curator,
    createdAt: new Date().toISOString(),
    skill: manifestInput.skill
  };
  if (manifestInput.ticket) manifest.ticket = manifestInput.ticket;

  // Validate before touching the filesystem.
  const errors = validate(manifest, { dirName: manifestInput.accession, contactIds });
  if (errors.length) throw new Error(`Invalid manifest:\n  - ${errors.join('\n  - ')}`);

  if (existsSync(dir)) rmSync(dir, { recursive: true });
  mkdirSync(join(dir, 'inputs'), { recursive: true });
  mkdirSync(join(dir, 'curated'), { recursive: true });
  for (const f of inputs) copyFileSync(f, join(dir, 'inputs', basename(f)));
  for (const f of curated) copyFileSync(f, join(dir, 'curated', basename(f)));
  writeManifest(dir, manifest, { contactIds });
  return dir;
}

/**
 * Commits the proposal and contacts, pushes, opens a PR against master,
 * creates (or comments on) the ticket, records it in the manifest, amends.
 */
export async function publishProposal({ git, ticket, repoPath, accession, existingTicket }) {
  const branch = proposalBranch(accession);
  if (git.currentBranch() !== branch) throw new Error(`Expected to be on ${branch}, but on "${git.currentBranch()}"`);

  const dir = join(repoPath, PROPOSALS_DIR, accession);
  const manifest = readManifest(dir);
  const title = `[${manifest.project}] ${manifest.datasetType} ${accession} for build ${manifest.targetBuild}`;

  git.add([proposalRelativePath(accession), CONTACTS_RELATIVE_PATH]);
  git.commit(`Propose ${accession} (${manifest.datasetType}, ${manifest.project}, build ${manifest.targetBuild})`);
  git.push(branch);

  const summary = [
    `Dataset type: ${manifest.datasetType}`,
    `Project: ${manifest.project}`,
    `Organism: ${manifest.organismAbbrev}`,
    `Target build: ${manifest.targetBuild}`,
    `Primary contact: ${manifest.contacts.primary}`,
    `Additional contacts: ${manifest.contacts.additional.join(', ') || 'none'}`,
    `Curator: ${manifest.curator}`
  ].join('\n');

  const prUrl = git.openPullRequest({ base: 'master', head: branch, title, body: `${summary}\n\nProposal: \`${proposalRelativePath(accession)}\`` });

  let ref = existingTicket;
  if (ref) {
    await ticket.comment(ref, `Proposal updated. Pull request: ${prUrl}\n\n${summary}`);
  } else {
    ref = await ticket.create({ title, body: `Pull request: ${prUrl}\n\n${summary}` });
  }

  writeManifest(dir, { ...manifest, ticket: ref });
  git.add([`${proposalRelativePath(accession)}/${MANIFEST_FILENAME}`]);
  git.amendNoEdit();
  git.push(branch, { force: true });

  return { prUrl, ticket: ref, title };
}
```

- [ ] **Step 3: Run tests, expect all passing (48), then commit**

```bash
yarn test
git add shared/scripts/lib/proposal-ops.js tests/proposal-ops.test.js
git commit -m "Add proposal operations: start, write, publish

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Phase 1 CLIs

**Files:**
- Create: `shared/scripts/start-proposal.js`, `shared/scripts/write-proposal.js`, `shared/scripts/publish-proposal.js`
- Modify: `package.json` `sharedFiles`

- [ ] **Step 1: start-proposal.js**

```js
#!/usr/bin/env node
/**
 * start-proposal.js - Checks preconditions and creates proposal/<accession>.
 *
 * Usage: node start-proposal.js <accession>
 * Prints JSON: { "mode": "new" } or { "mode": "update", "existingTicket": {...} }
 */
import { loadConfig } from './lib/config.js';
import { createGit } from './lib/git-ops.js';
import { createTicketClient } from './lib/ticket/index.js';
import { startProposal } from './lib/proposal-ops.js';

async function main() {
  const [accession] = process.argv.slice(2);
  if (!accession) { console.error('Usage: node start-proposal.js <accession>'); process.exit(1); }
  const config = loadConfig();
  const git = createGit(config.repoPath);
  const ticket = createTicketClient(config);
  const result = await startProposal({ git, ticket, accession });
  console.log(JSON.stringify(result, null, 2));
  console.error(`On branch proposal/${accession} (${result.mode})`);
}

main().catch(err => { console.error(`Error: ${err.message}`); process.exit(1); });
```

- [ ] **Step 2: write-proposal.js**

```js
#!/usr/bin/env node
/**
 * write-proposal.js - Writes Proposals/<accession>/ in VEuPathDatasets.
 *
 * Usage:
 *   node write-proposal.js --accession GCA_1.1 --type genome-assembly --project FungiDB \
 *     --organism tfakST1 --build 02 --primary-contact jane.doe [--contact ravi.kumar ...] \
 *     --skill propose-genome-assembly --input tmp/a.json [--input tmp/b.json ...] [--curated tmp/c.json ...]
 */
import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { loadConfig } from './lib/config.js';
import { writeProposal } from './lib/proposal-ops.js';

/** plugin.json is two levels up from shared/scripts and three from skills/<name>/scripts. */
const pluginVersion = () => {
  for (const rel of ['../../.claude-plugin/plugin.json', '../../../.claude-plugin/plugin.json']) {
    try {
      return JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf-8')).version;
    } catch { /* try the next location */ }
  }
  return 'unknown';
};

function main() {
  const { values } = parseArgs({
    options: {
      accession: { type: 'string' }, type: { type: 'string' }, project: { type: 'string' },
      organism: { type: 'string' }, build: { type: 'string' }, 'primary-contact': { type: 'string' },
      contact: { type: 'string', multiple: true, default: [] }, skill: { type: 'string' },
      input: { type: 'string', multiple: true, default: [] }, curated: { type: 'string', multiple: true, default: [] }
    }
  });
  for (const k of ['accession', 'type', 'project', 'organism', 'build', 'primary-contact', 'skill']) {
    if (!values[k]) { console.error(`Missing --${k}`); process.exit(1); }
  }
  const config = loadConfig();
  const curator = execFileSync('git', ['-C', config.repoPath, 'config', 'user.email'], { encoding: 'utf-8' }).trim();
  const dir = writeProposal({
    repoPath: config.repoPath,
    curator,
    inputs: values.input,
    curated: values.curated,
    manifestInput: {
      accession: values.accession, datasetType: values.type, project: values.project,
      organismAbbrev: values.organism, targetBuild: values.build,
      contacts: { primary: values['primary-contact'], additional: values.contact },
      skill: { name: values.skill, version: pluginVersion() }
    }
  });
  console.log(dir);
}

try { main(); } catch (err) { console.error(`Error: ${err.message}`); process.exit(1); }
```

- [ ] **Step 3: publish-proposal.js**

```js
#!/usr/bin/env node
/**
 * publish-proposal.js - Commits, pushes, opens the PR and creates the ticket.
 *
 * Usage: node publish-proposal.js <accession> [--existing-ticket '<json from start-proposal>']
 */
import { parseArgs } from 'node:util';
import { loadConfig } from './lib/config.js';
import { createGit } from './lib/git-ops.js';
import { createTicketClient } from './lib/ticket/index.js';
import { publishProposal } from './lib/proposal-ops.js';

async function main() {
  const { values, positionals } = parseArgs({
    options: { 'existing-ticket': { type: 'string' } }, allowPositionals: true
  });
  const [accession] = positionals;
  if (!accession) { console.error('Usage: node publish-proposal.js <accession> [--existing-ticket <json>]'); process.exit(1); }
  const config = loadConfig();
  const git = createGit(config.repoPath);
  const ticket = createTicketClient(config);
  const existingTicket = values['existing-ticket'] ? JSON.parse(values['existing-ticket']) : undefined;
  const result = await publishProposal({ git, ticket, repoPath: config.repoPath, accession, existingTicket });
  console.log(`Pull request: ${result.prUrl}`);
  console.log(`Ticket:       ${result.ticket.url}`);
  console.log('Next: review and merge the pull request.');
}

main().catch(err => { console.error(`Error: ${err.message}`); process.exit(1); });
```

- [ ] **Step 4: Register, sync, smoke-test argument parsing**

Add to `package.json` `sharedFiles`, each with `["propose-genome-assembly", "propose-bulk-rnaseq"]`:
`scripts/lib/proposal-ops.js`, `scripts/start-proposal.js`, `scripts/write-proposal.js`, `scripts/publish-proposal.js`.

Run:
```bash
chmod +x shared/scripts/start-proposal.js shared/scripts/write-proposal.js shared/scripts/publish-proposal.js
yarn sync-shared
node skills/propose-genome-assembly/scripts/write-proposal.js 2>&1 | head -1
```
Expected: `Missing --accession`.

- [ ] **Step 5: Commit**

```bash
git add shared/scripts package.json skills/
git commit -m "Add Phase 1 CLIs: start, write, publish proposal

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: propose-genome-assembly SKILL.md and resources

**Files:**
- Modify: `skills/propose-genome-assembly/SKILL.md` (full rewrite below)
- Create: `skills/propose-genome-assembly/resources/step-0-start-proposal.md`, `step-5-write-proposal.md`, `step-6-publish.md`
- Delete: `skills/propose-genome-assembly/resources/step-5-update-presenter.md`, `skills/propose-genome-assembly/scripts/generate-presenter-xml.js`

- [ ] **Step 1: Rewrite SKILL.md**

Replace the entire file body after the frontmatter with:

````markdown
# Propose a Genome Assembly Dataset

This skill gathers metadata for a genome assembly, curates contacts, and writes
a **proposal** to VEuPathDatasets. It ends with a pull request against
`master` and a ticket. Presenter XML is rendered later by the `load-proposals`
skill when the data loading team starts a build. See
[proposal workflow](resources/proposal-workflow.md).

## Prerequisites Check

This workflow requires the **VEuPathDatasets** repository in `veupathdb-repos/`
and a `curator.config.json` in the curation workspace directory.

```bash
bash scripts/check-repos.sh VEuPathDatasets
ls curator.config.json
```

If either is missing, follow the printed instructions. The config template is
`curator.config.example.json` in the dataset-curator repository. The Redmine
backend also needs `REDMINE_API_KEY` in the environment.

## Working Directory (Curation Workspace Directory)

All commands run from the curation workspace directory, the one containing
`veupathdb-repos/` and `curator.config.json`.

**For Claude Code**:
- DO NOT `cd` into `veupathdb-repos/`; use `git -C veupathdb-repos/VEuPathDatasets ...`
- Never push to `master`. The scripts push only to `proposal/<accession>`.
- Intermediate files go in `tmp/`.

## Required Information

Ask for all of these before starting:

- **VEuPathDB project** from [resources/valid-projects.json](resources/valid-projects.json)
- **Assembly GenBank accession** including version (e.g. `GCA_000988875.2`)
- **Target build** as two or more digits (e.g. `02`), matching the `rebuildNN` branch it should load in
- **Organism abbreviation** (e.g. `afumAf293`). If unknown, derive first letter of genus + first three of species + strain with special characters removed, and confirm with the curator.

## Workflow

### Step 0: Start the Proposal

```bash
node scripts/start-proposal.js <ASSEMBLY_ACCESSION>
```

Checks that VEuPathDatasets is on a clean, current `master`, then creates
`proposal/<ASSEMBLY_ACCESSION>`. Prints `{"mode":"new"}` or, if a proposal
already exists on master with a ticket in `proposed` status,
`{"mode":"update","existingTicket":{...}}`. Keep that JSON for Step 6.

**Detailed instructions:** [Step 0 - Start Proposal](resources/step-0-start-proposal.md)

### Step 1: Fetch Assembly Metadata from NCBI

```bash
curl -X GET "https://api.ncbi.nlm.nih.gov/datasets/v2/genome/accession/<ASSEMBLY_ACCESSION>/dataset_report" \
  -H "Accept: application/json" > tmp/<ASSEMBLY_ACCESSION>_dataset_report.json
```

**Detailed instructions:** [Step 1 - Fetch NCBI Metadata](resources/step-1-fetch-ncbi.md)

### Step 2: Fetch BioProject Metadata

```bash
node scripts/fetch-bioproject.js <BIOPROJECT_ACCESSION>
```

Output: `tmp/<BIOPROJECT>_bioproject.json`.

**Detailed instructions:** [Step 2 - Fetch BioProject](resources/step-2-fetch-bioproject.md)

### Step 3: Fetch PubMed Data

```bash
node scripts/fetch-pubmed.js <ASSEMBLY_ACCESSION>
```

Output: `tmp/<ASSEMBLY_ACCESSION>_pubmed.json`.

**Detailed instructions:** [Step 3 - Fetch PubMed](resources/step-3-fetch-pubmed.md)

### Step 4: Curate Contacts

Search and, if needed, add contacts in
`veupathdb-repos/VEuPathDatasets/Model/lib/xml/datasetPresenters/contacts/allContacts.xml`.
New contacts are committed with the proposal. Note the primary and additional
contact IDs.

**Detailed instructions:** [Step 4 - Curate Contacts](resources/step-4-curate-contacts.md)

### Step 5: Write the Proposal and Preview

```bash
node scripts/write-proposal.js \
  --accession <ASSEMBLY_ACCESSION> --type genome-assembly --project <PROJECT> \
  --organism <ORGANISM_ABBREV> --build <TARGET_BUILD> \
  --primary-contact <PRIMARY_CONTACT_ID> [--contact <ID> ...] \
  --skill propose-genome-assembly \
  --input tmp/<ASSEMBLY_ACCESSION>_dataset_report.json \
  --input tmp/<BIOPROJECT>_bioproject.json \
  --input tmp/<ASSEMBLY_ACCESSION>_pubmed.json

node scripts/render-proposal.js veupathdb-repos/VEuPathDatasets/Proposals/<ASSEMBLY_ACCESSION>
```

Show the curator the rendered XML. To change text (description, summary,
PubMed IDs), write `curated/presenter-overrides.json` and re-run
`write-proposal.js` with `--curated tmp/presenter-overrides.json`. Never edit
the rendered XML; it is not stored.

**Detailed instructions:** [Step 5 - Write Proposal](resources/step-5-write-proposal.md)

### Step 6: Publish

```bash
node scripts/publish-proposal.js <ASSEMBLY_ACCESSION> [--existing-ticket '<json from step 0>']
```

Commits the proposal and `allContacts.xml`, pushes, opens a PR against
`master`, creates the ticket (or comments on the existing one), records the
ticket in the manifest and amends. Prints the PR and ticket URLs.

**Detailed instructions:** [Step 6 - Publish](resources/step-6-publish.md)

## Next Steps

1. The curator reviews and merges the pull request.
2. When the data loading team starts build `<TARGET_BUILD>`, `load-proposals`
   renders the presenter and closes out the proposal.

## Resources

- [Proposal Workflow](resources/proposal-workflow.md)
- [Step 0 - Start Proposal](resources/step-0-start-proposal.md)
- [Step 1 - Fetch NCBI Metadata](resources/step-1-fetch-ncbi.md)
- [Step 2 - Fetch BioProject](resources/step-2-fetch-bioproject.md)
- [Step 3 - Fetch PubMed](resources/step-3-fetch-pubmed.md)
- [Step 4 - Curate Contacts](resources/step-4-curate-contacts.md)
- [Step 5 - Write Proposal](resources/step-5-write-proposal.md)
- [Step 6 - Publish](resources/step-6-publish.md)
- [Editing Large XML Files](resources/editing-large-xml.md)
- [Valid VEuPathDB Projects](resources/valid-projects.json)

## Scripts

- `scripts/fetch-bioproject.js` - BioProject metadata from NCBI
- `scripts/fetch-pubmed.js` - PubMed records linked to the assembly
- `scripts/start-proposal.js`, `scripts/write-proposal.js`, `scripts/publish-proposal.js` - proposal lifecycle (synced from shared/)
- `scripts/render-proposal.js` - preview the presenter XML (synced from shared/)
- `scripts/check-repos.sh` - repository check (synced from shared/)
````

- [ ] **Step 2: Create step-0-start-proposal.md**

```markdown
# Step 0: Start the Proposal

## What it checks

`start-proposal.js` refuses to continue unless VEuPathDatasets is:

- on `master`
- clean (no uncommitted changes)
- up to date with `origin/master`
- without an existing `proposal/<accession>` branch

Each failure prints the exact command to fix it. Show it to the curator and
stop; do not run `git` fix-ups yourself.

## Existing proposals

If `Proposals/<accession>/` already exists on `origin/master`, the script reads
its manifest and asks the ticket system for the status:

| Status | Result |
|---|---|
| `proposed` | Continue as an update. Output includes `existingTicket`. Save it for Step 6. |
| `loading` or `done` | Stop. The dataset is being or has been loaded. |
| no ticket recorded | Continue as an update with no existing ticket; Step 6 creates one. |

## Output

```json
{ "mode": "new" }
```
or
```json
{ "mode": "update", "existingTicket": { "system": "redmine", "id": "12345", "url": "https://..." } }
```
```

- [ ] **Step 3: Create step-5-write-proposal.md**

```markdown
# Step 5: Write the Proposal and Preview

## What write-proposal.js does

1. Reads `curator.config.json` to find VEuPathDatasets.
2. Reads contact IDs from `allContacts.xml` and validates the primary and
   additional contacts exist. Unknown IDs fail here, before anything is written.
3. Replaces `Proposals/<accession>/` with fresh `inputs/`, `curated/` and
   `manifest.json`. Input files keep their names.
4. Records the curator's git `user.email` and the plugin version.

The manifest has no `ticket` field yet; Step 6 adds it.

## Preview

```bash
node scripts/render-proposal.js veupathdb-repos/VEuPathDatasets/Proposals/<ACCESSION>
```

This runs the same renderer `load-proposals` will run later. Show the curator
the result. It proves the proposal renders and lets them catch bad metadata
while they still have context.

## Curator edits go in overrides, not XML

If the curator wants different text, create `tmp/presenter-overrides.json`
with any of these keys, then re-run `write-proposal.js` adding
`--curated tmp/presenter-overrides.json`, and preview again:

```json
{
  "displayName": "…",
  "shortDisplayName": "…",
  "shortAttribution": "…",
  "summary": "…",
  "description": "…",
  "methodology": "…",
  "pubmedIds": ["12345678"],
  "injectorProps": { "isCurated": "true" }
}
```

Omit keys you do not want to override. The rendered XML is never stored, so
editing it would be lost.

## Presenter name

`<organismAbbrev>_primary_genome_RSRC`, taken from the manifest. If it collides
with an existing presenter, `load-proposals` will refuse later; check now:

```bash
grep -c 'name="<ORGANISM_ABBREV>_primary_genome_RSRC"' veupathdb-repos/VEuPathDatasets/Model/lib/xml/datasetPresenters/<PROJECT>.xml
```
Expected: `0`.
```

- [ ] **Step 4: Create step-6-publish.md**

```markdown
# Step 6: Publish

## What publish-proposal.js does, in order

1. Confirms the current branch is `proposal/<accession>`.
2. `git add Proposals/<accession> Model/lib/xml/datasetPresenters/contacts/allContacts.xml`
3. Commits: `Propose <accession> (<type>, <project>, build <NN>)`
4. Pushes `proposal/<accession>` to origin.
5. Opens a pull request against `master` with `gh pr create`. Title:
   `[<project>] <type> <accession> for build <NN>`.
6. Creates the ticket through the configured adapter with the PR link, or
   comments on the existing ticket when `--existing-ticket` is given.
7. Writes the ticket reference into `manifest.json`, amends the commit, and
   force-pushes with lease. The branch is the skill's own, so this is safe.

## If it fails

Anything after step 3 leaves a commit on `proposal/<accession>`. Report the
error to the curator. Typical causes and fixes:

| Error | Fix |
|---|---|
| `gh: not logged in` | `gh auth login` in a terminal, then re-run the script |
| `REDMINE_API_KEY environment variable is required` | export it, re-run |
| `a pull request for branch ... already exists` | An earlier run got as far as the PR. Do not re-run. Ask the curator to check the PR and the ticket by hand and finish any missing step manually. |

Do not force-push or delete branches to recover; the curator decides.

## After success

Print the PR and ticket URLs and remind the curator that merging the PR is
their step. Nothing else remains for this skill.
```

- [ ] **Step 5: Delete replaced files**

```bash
git rm -q skills/propose-genome-assembly/resources/step-5-update-presenter.md skills/propose-genome-assembly/scripts/generate-presenter-xml.js
grep -rn 'generate-presenter-xml\|step-5-update-presenter' skills/propose-genome-assembly
```
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add skills/propose-genome-assembly
git commit -m "propose-genome-assembly: write proposal, preview, publish

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: propose-bulk-rnaseq SKILL.md and resources

**Files:**
- Modify: `skills/propose-bulk-rnaseq/SKILL.md` (sections replaced below)
- Create: `skills/propose-bulk-rnaseq/resources/step-0-start-proposal.md` (same content as Task 4 Step 2), `step-4-write-proposal.md`, `step-6-publish.md` (same content as Task 4 Step 4)
- Modify: `skills/propose-bulk-rnaseq/resources/step-5-generate-outputs.md`
- Delete: `skills/propose-bulk-rnaseq/resources/step-4-generate-presenter.md`, `skills/propose-bulk-rnaseq/scripts/generate-presenter-xml.js`

- [ ] **Step 1: Replace the prerequisites and working-directory sections**

Replace everything from `## Prerequisites Check` through the end of the `## Working Directory` section with:

````markdown
## Prerequisites Check

This workflow requires the **VEuPathDatasets** repository in `veupathdb-repos/`
and a `curator.config.json` in the curation workspace directory.

```bash
bash scripts/check-repos.sh VEuPathDatasets
ls curator.config.json
```

If either is missing, follow the printed instructions. The config template is
`curator.config.example.json` in the dataset-curator repository. The Redmine
backend also needs `REDMINE_API_KEY` in the environment.

## Working Directory (Curation Workspace Directory)

All commands run from the curation workspace directory, the one containing
`veupathdb-repos/` and `curator.config.json`.

**For Claude Code**:
- DO NOT `cd` into subdirectories; use `git -C veupathdb-repos/VEuPathDatasets ...`
- Never push to `master`. The scripts push only to `proposal/<accession>`.

The workflow creates:
- `tmp/` - intermediate files (gitignored)
- `delivery/bulk-rnaseq/<BIOPROJECT>/` - pipeline outputs (gitignored)
````

- [ ] **Step 2: Replace Required Information**

```markdown
## Required Information

Ask for all of these before starting:

- **VEuPathDB project** from [resources/valid-projects.json](resources/valid-projects.json)
- **BioProject accession** (e.g. `PRJNA1018599`)
- **Target build** as two or more digits (e.g. `02`), matching the `rebuildNN` branch it should load in
- **Organism abbreviation** of the reference organism (e.g. `afumAf293`), confirmed with the curator
```

- [ ] **Step 3: Insert Step 0 before Step 1**

```markdown
### Step 0: Start the Proposal

```bash
node scripts/start-proposal.js <BIOPROJECT>
```

Creates `proposal/<BIOPROJECT>` off a clean, current `master`. Keep the printed
JSON for Step 6.

**Detailed instructions:** [Step 0 - Start Proposal](resources/step-0-start-proposal.md)
```

- [ ] **Step 4: Replace Step 4**

Replace the whole `### Step 4: Generate Presenter XML` section with:

````markdown
### Step 4: Write the Proposal and Preview

```bash
node scripts/write-proposal.js \
  --accession <BIOPROJECT> --type bulk-rnaseq --project <PROJECT> \
  --organism <ORGANISM_ABBREV> --build <TARGET_BUILD> \
  --primary-contact <PRIMARY_CONTACT_ID> [--contact <ID> ...] \
  --skill propose-bulk-rnaseq \
  --input tmp/<BIOPROJECT>_sra_metadata.json \
  [--input tmp/<GSE>_family.xml] [--input tmp/<BIOPROJECT>_pdf_extracted.json] \
  --curated tmp/<BIOPROJECT>_sample_annotations.json \
  [--curated tmp/presenter-overrides.json]

node scripts/render-proposal.js veupathdb-repos/VEuPathDatasets/Proposals/<BIOPROJECT>
node scripts/render-proposal.js --name veupathdb-repos/VEuPathDatasets/Proposals/<BIOPROJECT> > tmp/<BIOPROJECT>_presenter_name.txt
```

Show the curator the rendered XML. `shortDisplayName`, `shortAttribution`,
PubMed IDs and injector properties come from `tmp/presenter-overrides.json`;
write it, re-run `write-proposal.js`, and preview again. Never edit the
rendered XML.

**Detailed instructions:** [Step 4 - Write Proposal](resources/step-4-write-proposal.md)
````

- [ ] **Step 5: Adjust Step 5 and add Step 6**

In `### Step 5: Generate Delivery Outputs`, the commands are unchanged; they
already read `tmp/<BIOPROJECT>_presenter_name.txt`, which Step 4 now writes
via `render-proposal.js --name`.

After Step 5 add:

````markdown
### Step 6: Publish

```bash
node scripts/publish-proposal.js <BIOPROJECT> [--existing-ticket '<json from step 0>']
```

Commits the proposal and `allContacts.xml`, pushes, opens a PR against
`master`, creates or comments on the ticket, records it in the manifest.

**Detailed instructions:** [Step 6 - Publish](resources/step-6-publish.md)
````

Replace `## Next Steps` with:
```markdown
## Next Steps

1. The curator reviews and merges the pull request.
2. Deliver `delivery/bulk-rnaseq/<BIOPROJECT>/` to the data processing team.
3. When the data loading team starts build `<TARGET_BUILD>`, `load-proposals`
   renders the presenter and closes out the proposal.
```

Update the Resources and Scripts lists: replace the Step 4 link with
`[Step 4 - Write Proposal](resources/step-4-write-proposal.md)`, add Step 0,
Step 6 and `[Proposal Workflow](resources/proposal-workflow.md)`; replace the
`generate-presenter-xml.js` bullet with:
```markdown
- `scripts/start-proposal.js`, `scripts/write-proposal.js`, `scripts/publish-proposal.js` - proposal lifecycle (synced from shared/)
- `scripts/render-proposal.js` - preview the presenter XML and print its name (synced from shared/)
```

- [ ] **Step 6: Create step-4-write-proposal.md**

Same as Task 4 Step 3 (`step-5-write-proposal.md`) with these differences: the
title is `# Step 4: Write the Proposal and Preview`; `--type bulk-rnaseq`; the
required input is `tmp/<BIOPROJECT>_sra_metadata.json`; `_family.xml` and
`_pdf_extracted.json` are optional inputs; `tmp/<BIOPROJECT>_sample_annotations.json`
is a required `--curated` file; and the presenter name section reads:

```markdown
## Presenter name

`<genusInitial><species3>_<BIOPROJECT>_rnaSeq_RSRC`, derived from the SRA
organism name (e.g. `afum_PRJNA123456_rnaSeq_RSRC`). Print it with:

```bash
node scripts/render-proposal.js --name veupathdb-repos/VEuPathDatasets/Proposals/<BIOPROJECT>
```

Step 5 needs it in `tmp/<BIOPROJECT>_presenter_name.txt`.
```

Also carry over the "templateInjector Properties" table from the old
`step-4-generate-presenter.md` (lines 160-168), reworded to say these are set
via `injectorProps` in `presenter-overrides.json`.

- [ ] **Step 7: Copy shared step docs, delete replaced files**

```bash
cp skills/propose-genome-assembly/resources/step-0-start-proposal.md skills/propose-bulk-rnaseq/resources/
cp skills/propose-genome-assembly/resources/step-6-publish.md skills/propose-bulk-rnaseq/resources/
git rm -q skills/propose-bulk-rnaseq/resources/step-4-generate-presenter.md skills/propose-bulk-rnaseq/scripts/generate-presenter-xml.js
grep -rn 'generate-presenter-xml\|step-4-generate-presenter\|ApiCommon' skills/propose-bulk-rnaseq
```
Expected: no output.

- [ ] **Step 8: Commit**

```bash
git add skills/propose-bulk-rnaseq
git commit -m "propose-bulk-rnaseq: write proposal, preview, publish

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Contact-step wording and roleplay check

**Files:**
- Modify: `skills/propose-genome-assembly/resources/step-4-curate-contacts.md`, `skills/propose-bulk-rnaseq/resources/step-3-curate-contacts.md`

- [ ] **Step 1: Say where contacts land**

At the end of the "Creating New Contacts" section in each file, add:
```markdown
New contacts are committed together with the proposal in the publish step and
reach `master` when the curator merges the PR. Do not commit them separately.
```

- [ ] **Step 2: Roleplay activation**

Start `claude` in this repository and say each of:
- "I want to propose a new genome assembly"
- "Propose an RNA-seq dataset for FungiDB, build 02"

Expected: the matching `propose-*` skill activates and its first action is
`check-repos.sh VEuPathDatasets` plus the config check. Say `STOP` to end.

- [ ] **Step 3: Commit**

```bash
git add skills/
git commit -m "Contacts steps: note contacts travel with the proposal

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Done when

- `yarn test` passes.
- No `generate-presenter-xml.js` remains under `skills/`.
- Both `propose-*` SKILL.md files describe Steps 0 through 6 and link only to resources that exist (`ls skills/propose-*/resources/` matches every link).
- `yarn sync-shared` reports zero errors.
