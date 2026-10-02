# Plan 4 of 4: Phase 2 load-proposals Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A single `load-proposals` skill the data loading team runs on `rebuild<NN>` to render each proposal's presenter into the project file, delete the proposal, open a PR, and mark the ticket `loading`. Proposals merged to master after the rebuild branch was cut (stragglers) are cherry-picked onto the load branch automatically.

**Architecture:** `shared/scripts/lib/load-ops.js` exposes `checkLoadPreconditions`, `loadProposal` and `listProposals`, all taking injected git and ticket clients. Two CLIs wrap them. Renderers are dispatched by `datasetType`. The skill directory holds only SKILL.md, resources, and synced scripts.

**Tech Stack:** Node 18+ standard library.

**Spec:** `docs/superpowers/specs/2026-09-18-two-phase-proposals-design.md`

**Depends on:** Plans 1 to 3 on the `two-phase-proposals` branch.

---

## File structure

| Path | Action | Responsibility |
|---|---|---|
| `shared/scripts/lib/load-ops.js` | Create | Preconditions, per-proposal load, listing |
| `shared/scripts/load-proposal.js` | Create | CLI: one accession, `--dry-run` |
| `shared/scripts/list-proposals.js` | Create | CLI: proposals on the current branch, `--build NN` |
| `tests/load-ops.test.js` | Create | Offline tests |
| `skills/load-proposals/SKILL.md` | Create | Phase 2 skill |
| `skills/load-proposals/resources/*.md` | Create | Preconditions, per-proposal flow, recovery |
| `package.json` | Modify | Sync targets include `load-proposals` |
| `.claude-plugin/plugin.json`, `README.md`, `CLAUDE.md` | Modify | Version 2.0.0, skill list |

---

### Task 1: load-ops library

**Files:**
- Create: `shared/scripts/lib/load-ops.js`, `tests/load-ops.test.js`

- [ ] **Step 1: Failing test**

Create `tests/load-ops.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createGit } from '../shared/scripts/lib/git-ops.js';
import { checkLoadPreconditions, loadProposal, listProposals } from '../shared/scripts/lib/load-ops.js';

const fixtures = new URL('./fixtures/', import.meta.url).pathname;

/**
 * Origin + clone with: allContacts.xml, an empty FungiDB.xml presenter file,
 * two proposals (build 02 and 03) on master, and rebuild02 cut from master.
 */
function setupRepo() {
  const root = mkdtempSync(join(tmpdir(), 'load-ops-'));
  const bare = join(root, 'origin.git');
  const repo = join(root, 'VEuPathDatasets');
  execFileSync('git', ['init', '--bare', '-q', '--initial-branch=master', bare]);
  execFileSync('git', ['clone', '-q', bare, repo]);
  execFileSync('git', ['-C', repo, 'config', 'user.email', 'loader@apidb.org']);
  execFileSync('git', ['-C', repo, 'config', 'user.name', 'Loader']);
  mkdirSync(join(repo, 'Model/lib/xml/datasetPresenters/contacts'), { recursive: true });
  cpSync(join(fixtures, 'allContacts.xml'), join(repo, 'Model/lib/xml/datasetPresenters/contacts/allContacts.xml'));
  writeFileSync(join(repo, 'Model/lib/xml/datasetPresenters/FungiDB.xml'), '<?xml version="1.0"?>\n<datasetPresenters>\n</datasetPresenters>\n');
  cpSync(join(fixtures, 'proposals/GCA_000001.1'), join(repo, 'Proposals/GCA_000001.1'), { recursive: true });
  cpSync(join(fixtures, 'proposals/PRJNA000002'), join(repo, 'Proposals/PRJNA000002'), { recursive: true });
  // PRJNA000002 targets build 03 in this scenario
  const m = JSON.parse(execFileSync('cat', [join(repo, 'Proposals/PRJNA000002/manifest.json')], { encoding: 'utf-8' }));
  writeFileSync(join(repo, 'Proposals/PRJNA000002/manifest.json'), JSON.stringify({ ...m, targetBuild: '03' }, null, 2));
  execFileSync('git', ['-C', repo, 'add', '.']);
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'init with proposals']);
  execFileSync('git', ['-C', repo, 'push', '-q', '-u', 'origin', 'master']);
  execFileSync('git', ['-C', repo, 'checkout', '-q', '-b', 'rebuild02']);
  execFileSync('git', ['-C', repo, 'push', '-q', '-u', 'origin', 'rebuild02']);
  return { root, repo };
}

function stubTicket() {
  const calls = [];
  return {
    calls,
    async comment(ref, body) { calls.push(['comment', ref.id, body]); },
    async setStatus(ref, s) { calls.push(['setStatus', ref.id, s]); },
    async getStatus() { return 'proposed'; },
    async create() { throw new Error('not used'); }
  };
}

function ghStub(url) {
  return (cmd, args, opts) => cmd === 'gh'
    ? `${url}\n`
    : execFileSync(cmd, args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
}

test('listProposals reads manifests on the current branch and filters by build', () => {
  const { repo } = setupRepo();
  const all = listProposals(repo);
  assert.deepEqual(all.map(p => p.accession).sort(), ['GCA_000001.1', 'PRJNA000002']);
  assert.deepEqual(listProposals(repo, { build: '02' }).map(p => p.accession), ['GCA_000001.1']);
});

test('preconditions: wrong branch', async () => {
  const { repo } = setupRepo();
  const git = createGit(repo);
  git.checkout('master');
  await assert.rejects(checkLoadPreconditions({ git, repoPath: repo, accession: 'GCA_000001.1' }), /on branch "master" but the proposal targets build 02 \(rebuild02\)/);
});

test('straggler: proposal only on master is cherry-picked onto the load branch and loaded', async () => {
  const { repo } = setupRepo();
  // add a build-02 proposal on master only, after rebuild02 was cut
  const git0 = createGit(repo);
  git0.checkout('master');
  cpSync(join(fixtures, 'proposals/PRJNA000002_no_overrides'), join(repo, 'Proposals/PRJNA000002_no_overrides'), { recursive: true });
  execFileSync('git', ['-C', repo, 'add', '.']);
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'straggler']);
  execFileSync('git', ['-C', repo, 'push', '-q']);
  const sha = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim();
  git0.checkout('rebuild02');

  const pre = await checkLoadPreconditions({ git: git0, repoPath: repo, accession: 'PRJNA000002_no_overrides' });
  assert.deepEqual(pre.straggler, [sha]);

  const git = createGit(repo, { exec: ghStub('https://github.com/x/y/pull/2') });
  const result = await loadProposal({ git, ticket: stubTicket(), repoPath: repo, accession: 'PRJNA000002_no_overrides' });
  assert.deepEqual(result.cherryPicked, [sha]);
  assert.equal(result.presenterName, 'tfak_PRJNA000002_no_overrides_rnaSeq_RSRC');
  assert.equal(git.fileExistsOnRef('origin/load/PRJNA000002_no_overrides', 'Proposals/PRJNA000002_no_overrides/manifest.json'), false);
  assert.match(git.showFile('origin/load/PRJNA000002_no_overrides', 'Model/lib/xml/datasetPresenters/FungiDB.xml'), /tfak_PRJNA000002_no_overrides_rnaSeq_RSRC/);
});

test('straggler: a missing proposal anywhere is a clear error', async () => {
  const { repo } = setupRepo();
  await assert.rejects(checkLoadPreconditions({ git: createGit(repo), repoPath: repo, accession: 'NOPE' }), /No proposal found/);
});

test('preconditions: presenter name collision', async () => {
  const { repo } = setupRepo();
  writeFileSync(join(repo, 'Model/lib/xml/datasetPresenters/FungiDB.xml'),
    '<datasetPresenters>\n  <datasetPresenter name="tfakST1_primary_genome_RSRC"></datasetPresenter>\n</datasetPresenters>\n');
  execFileSync('git', ['-C', repo, 'commit', '-q', '-am', 'collide']);
  const git = createGit(repo);
  await assert.rejects(checkLoadPreconditions({ git, repoPath: repo, accession: 'GCA_000001.1' }), /already exists in Model\/lib\/xml\/datasetPresenters\/FungiDB\.xml/);
});

test('loadProposal renders, deletes, commits, pushes, opens PR, updates ticket', async () => {
  const { repo } = setupRepo();
  // give the proposal a ticket
  const mPath = join(repo, 'Proposals/GCA_000001.1/manifest.json');
  const m = JSON.parse(execFileSync('cat', [mPath], { encoding: 'utf-8' }));
  writeFileSync(mPath, JSON.stringify({ ...m, ticket: { system: 'redmine', id: '42', url: 'https://r/issues/42' } }, null, 2));
  execFileSync('git', ['-C', repo, 'commit', '-q', '-am', 'ticket']);
  execFileSync('git', ['-C', repo, 'push', '-q']);

  const git = createGit(repo, { exec: ghStub('https://github.com/VEuPathDB/VEuPathDatasets/pull/11') });
  const ticket = stubTicket();
  const result = await loadProposal({ git, ticket, repoPath: repo, accession: 'GCA_000001.1' });

  assert.equal(result.presenterName, 'tfakST1_primary_genome_RSRC');
  assert.equal(result.prUrl, 'https://github.com/VEuPathDB/VEuPathDatasets/pull/11');
  assert.equal(git.currentBranch(), 'load/GCA_000001.1');
  assert.equal(git.isClean(), true);
  assert.equal(existsSync(join(repo, 'Proposals/GCA_000001.1')), false);
  const presenterFile = git.showFile('origin/load/GCA_000001.1', 'Model/lib/xml/datasetPresenters/FungiDB.xml');
  assert.match(presenterFile, /name="tfakST1_primary_genome_RSRC"/);
  assert.equal(git.fileExistsOnRef('origin/load/GCA_000001.1', 'Proposals/GCA_000001.1/manifest.json'), false);
  assert.deepEqual(ticket.calls.map(c => c[0]), ['comment', 'setStatus']);
  assert.equal(ticket.calls[1][2], 'loading');
  assert.match(ticket.calls[0][2], /pull\/11/);
});

test('loadProposal --dry-run changes nothing', async () => {
  const { repo } = setupRepo();
  const git = createGit(repo, { exec: ghStub('unused') });
  const ticket = stubTicket();
  const result = await loadProposal({ git, ticket, repoPath: repo, accession: 'GCA_000001.1', dryRun: true });
  assert.equal(result.presenterName, 'tfakST1_primary_genome_RSRC');
  assert.match(result.xml, /<datasetPresenter /);
  assert.equal(git.currentBranch(), 'rebuild02');
  assert.equal(existsSync(join(repo, 'Proposals/GCA_000001.1')), true);
  assert.equal(ticket.calls.length, 0);
});

test('loadProposal without a ticket in the manifest skips ticket calls and says so', async () => {
  const { repo } = setupRepo();
  const git = createGit(repo, { exec: ghStub('https://github.com/x/y/pull/1') });
  const ticket = stubTicket();
  const result = await loadProposal({ git, ticket, repoPath: repo, accession: 'GCA_000001.1' });
  assert.equal(ticket.calls.length, 0);
  assert.match(result.warnings.join(' '), /no ticket/);
});
```

- [ ] **Step 2: Run to verify failure, then implement**

Create `shared/scripts/lib/load-ops.js`:
```js
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { read as readManifest, assertValid, MANIFEST_FILENAME } from './manifest.js';
import { presenterFilePath, presenterFileRelativePath, presenterNameExists, insertPresenter, extractPresenterName } from './presenter-file.js';

export const PROPOSALS_DIR = 'Proposals';
export const loadBranch = (accession) => `load/${accession}`;
export const rebuildBranch = (build) => `rebuild${build}`;

async function loadRenderer(datasetType) {
  return import(new URL(`../renderers/${datasetType}.js`, import.meta.url));
}

/** Proposals on the working tree, optionally filtered by targetBuild. */
export function listProposals(repoPath, { build } = {}) {
  const dir = join(repoPath, PROPOSALS_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter(d => d.isDirectory() && existsSync(join(dir, d.name, MANIFEST_FILENAME)))
    .map(d => readManifest(join(dir, d.name)))
    .filter(m => !build || m.targetBuild === build);
}

/**
 * Rejects with a precise, actionable message on the first failed check.
 * For a proposal already on this branch the presenter is rendered here
 * (renderers are pure) so the name-collision check runs before anything is
 * touched. For a straggler (only on origin/master) the manifest is read from
 * that ref and `straggler` lists the commits to cherry-pick; rendering waits
 * until loadProposal has the files on disk.
 */
export async function checkLoadPreconditions({ git, repoPath, accession }) {
  if (!git.isClean()) throw new Error('VEuPathDatasets working tree is not clean; commit or stash first');

  const proposalDir = join(repoPath, PROPOSALS_DIR, accession);
  const relDir = `${PROPOSALS_DIR}/${accession}`;
  const relManifest = `${relDir}/${MANIFEST_FILENAME}`;
  let manifest;
  let straggler = null;
  if (existsSync(join(proposalDir, MANIFEST_FILENAME))) {
    manifest = readManifest(proposalDir);
  } else {
    git.fetch();
    if (!git.fileExistsOnRef('origin/master', relManifest)) {
      throw new Error(`No proposal found at ${relDir} on this branch or on origin/master`);
    }
    manifest = JSON.parse(git.showFile('origin/master', relManifest));
    assertValid(manifest, { dirName: accession });
    straggler = git.commitsForPath('origin/master', relDir); // oldest-first
  }

  const expected = rebuildBranch(manifest.targetBuild);
  if (git.currentBranch() !== expected) {
    throw new Error(`Checked out on branch "${git.currentBranch()}" but the proposal targets build ${manifest.targetBuild} (${expected}). Check out ${expected} first.`);
  }
  if (git.branchExists(loadBranch(accession))) {
    throw new Error(`Branch ${loadBranch(accession)} already exists. Inspect it, then delete to rerun:\n  git -C veupathdb-repos/VEuPathDatasets branch -D ${loadBranch(accession)}`);
  }
  const presenterPath = presenterFilePath(repoPath, manifest.project);
  if (!existsSync(presenterPath)) throw new Error(`Presenter file missing: ${presenterFileRelativePath(manifest.project)}`);

  if (straggler) return { manifest, proposalDir, presenterPath, straggler };
  const rendered = await renderAndCheck(manifest, proposalDir, presenterPath);
  return { manifest, proposalDir, presenterPath, straggler, ...rendered };
}

async function renderAndCheck(manifest, proposalDir, presenterPath) {
  const renderer = await loadRenderer(manifest.datasetType);
  const xml = renderer.render(proposalDir);
  const presenterName = extractPresenterName(xml);
  const presenterFile = readFileSync(presenterPath, 'utf-8');
  if (presenterNameExists(presenterFile, presenterName)) {
    throw new Error(`Presenter "${presenterName}" already exists in ${presenterFileRelativePath(manifest.project)}`);
  }
  return { xml, presenterName, presenterFile };
}

/**
 * Renders, inserts, deletes the proposal, commits once, pushes, opens a PR
 * against rebuild<NN>, comments on and transitions the ticket to "loading".
 * dryRun performs only checks and rendering.
 */
export async function loadProposal({ git, ticket, repoPath, accession, dryRun = false }) {
  const pre = await checkLoadPreconditions({ git, repoPath, accession });
  const { manifest, proposalDir, presenterPath, straggler } = pre;
  const warnings = [];
  if (!manifest.ticket) warnings.push(`Proposal ${accession} has no ticket recorded; ticket updates skipped.`);
  if (straggler) warnings.push(`Proposal ${accession} is not on ${git.currentBranch()}; will cherry-pick ${straggler.join(', ')} from origin/master.`);
  if (dryRun) return { presenterName: pre.presenterName, xml: pre.xml, manifest, warnings, cherryPicked: straggler || [], dryRun: true };

  const base = rebuildBranch(manifest.targetBuild);
  const branch = loadBranch(accession);
  git.createBranch(branch, base);
  let { presenterFile, xml, presenterName } = pre;
  if (straggler) {
    git.cherryPick(straggler);
    ({ presenterFile, xml, presenterName } = await renderAndCheck(manifest, proposalDir, presenterPath));
  }
  writeFileSync(presenterPath, insertPresenter(presenterFile, xml));
  git.add([presenterFileRelativePath(manifest.project)]);
  git.rm(`${PROPOSALS_DIR}/${accession}`);
  git.commit(`Load ${accession}: add ${presenterName} to ${manifest.project}, remove proposal`);
  git.push(branch);

  const title = `Load ${accession} (${manifest.datasetType}, ${manifest.project}) into build ${manifest.targetBuild}`;
  const body = [
    `Presenter: \`${presenterName}\` in \`${presenterFileRelativePath(manifest.project)}\``,
    `Proposal removed: \`${PROPOSALS_DIR}/${accession}\``,
    manifest.ticket ? `Ticket: ${manifest.ticket.url}` : 'Ticket: none recorded'
  ].join('\n');
  const prUrl = git.openPullRequest({ base, head: branch, title, body });

  if (manifest.ticket) {
    await ticket.comment(manifest.ticket, `Loading into ${base}. Pull request: ${prUrl}`);
    await ticket.setStatus(manifest.ticket, 'loading');
  }
  return { presenterName, xml, manifest, prUrl, branch, warnings, cherryPicked: straggler || [], dryRun: false };
}
```

- [ ] **Step 3: Run tests, expect all passing (55), then commit**

```bash
yarn test
git add shared/scripts/lib/load-ops.js tests/load-ops.test.js
git commit -m "Add load operations for Phase 2

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Phase 2 CLIs

**Files:**
- Create: `shared/scripts/load-proposal.js`, `shared/scripts/list-proposals.js`

- [ ] **Step 1: list-proposals.js**

```js
#!/usr/bin/env node
/**
 * list-proposals.js - Lists proposals on the current VEuPathDatasets branch.
 *
 * Usage: node list-proposals.js [--build NN] [--json]
 */
import { parseArgs } from 'node:util';
import { loadConfig } from './lib/config.js';
import { listProposals } from './lib/load-ops.js';

function main() {
  const { values } = parseArgs({ options: { build: { type: 'string' }, json: { type: 'boolean', default: false } } });
  const config = loadConfig();
  const proposals = listProposals(config.repoPath, { build: values.build });
  if (values.json) { console.log(JSON.stringify(proposals, null, 2)); return; }
  if (proposals.length === 0) { console.log(values.build ? `No proposals target build ${values.build}.` : 'No proposals.'); return; }
  console.log(['ACCESSION', 'TYPE', 'PROJECT', 'BUILD', 'TICKET'].join('\t'));
  for (const p of proposals) {
    console.log([p.accession, p.datasetType, p.project, p.targetBuild, p.ticket?.url || '-'].join('\t'));
  }
}

try { main(); } catch (err) { console.error(`Error: ${err.message}`); process.exit(1); }
```

- [ ] **Step 2: load-proposal.js**

```js
#!/usr/bin/env node
/**
 * load-proposal.js - Renders one proposal into its presenter file on rebuild<NN>.
 *
 * Usage: node load-proposal.js [--dry-run] <accession>
 */
import { parseArgs } from 'node:util';
import { loadConfig } from './lib/config.js';
import { createGit } from './lib/git-ops.js';
import { createTicketClient } from './lib/ticket/index.js';
import { loadProposal } from './lib/load-ops.js';

async function main() {
  const { values, positionals } = parseArgs({
    options: { 'dry-run': { type: 'boolean', default: false } }, allowPositionals: true
  });
  const [accession] = positionals;
  if (!accession) { console.error('Usage: node load-proposal.js [--dry-run] <accession>'); process.exit(1); }
  const config = loadConfig();
  const git = createGit(config.repoPath);
  const ticket = createTicketClient(config);
  const result = await loadProposal({ git, ticket, repoPath: config.repoPath, accession, dryRun: values['dry-run'] });
  for (const w of result.warnings) console.error(`Warning: ${w}`);
  if (result.dryRun) {
    if (result.cherryPicked.length) {
      console.error(`Dry run: straggler. Would cherry-pick ${result.cherryPicked.join(', ')} then load ${accession} into ${result.manifest.project}. XML preview needs the files on this branch, so none is shown.`);
      return;
    }
    console.error(`Dry run: would add ${result.presenterName} to ${result.manifest.project} and remove Proposals/${accession}.`);
    process.stdout.write(result.xml + '\n');
    return;
  }
  console.log(`Presenter:    ${result.presenterName}`);
  console.log(`Branch:       ${result.branch}`);
  if (result.cherryPicked.length) console.log(`Cherry-picked: ${result.cherryPicked.join(', ')}`);
  console.log(`Pull request: ${result.prUrl}`);
  console.log(`Ticket:       ${result.manifest.ticket ? result.manifest.ticket.url + ' (loading)' : 'none'}`);
}

main().catch(err => { console.error(`Error: ${err.message}`); process.exit(1); });
```

- [ ] **Step 3: Make executable and commit**

```bash
chmod +x shared/scripts/load-proposal.js shared/scripts/list-proposals.js
git add shared/scripts/load-proposal.js shared/scripts/list-proposals.js
git commit -m "Add Phase 2 CLIs: list and load proposals

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: load-proposals skill

**Files:**
- Create: `skills/load-proposals/SKILL.md`, `skills/load-proposals/resources/preconditions.md`, `skills/load-proposals/resources/recovery.md`
- Modify: `package.json` `sharedFiles`

- [ ] **Step 1: SKILL.md**

````markdown
---
name: load-proposals
description: Data loading team - bring dataset proposals from VEuPathDatasets Proposals/ into presenter XML on a rebuild branch, one PR per proposal, and mark tickets loading
---

# Load Dataset Proposals

Runs on a `rebuild<NN>` branch of VEuPathDatasets at the start of a build.
For each proposal targeting build `<NN>` it renders the presenter, deletes the
proposal, commits once, pushes `load/<accession>`, opens a PR against
`rebuild<NN>`, and marks the ticket `loading`. It is dataset-type agnostic;
renderers per `datasetType` live in `scripts/renderers/`.

See [proposal workflow](resources/proposal-workflow.md) for the branch model.

## Prerequisites Check

```bash
bash scripts/check-repos.sh VEuPathDatasets
ls curator.config.json
git -C veupathdb-repos/VEuPathDatasets branch --show-current
git -C veupathdb-repos/VEuPathDatasets status -sb
```

The branch must be `rebuild<NN>` and clean. If not, stop and tell the user;
do not check out or pull for them. `curator.config.json` follows
`curator.config.example.json`; Redmine needs `REDMINE_API_KEY`.

## Working Directory

Run everything from the curation workspace directory. Never `cd` into
`veupathdb-repos/`. Never push to `rebuild*` or `master`; the scripts push only
to `load/<accession>`.

## Required Information

- **Target build** `<NN>`, or a single **accession**.

## Workflow

### Step 1: List what is pending

```bash
node scripts/list-proposals.js --build <NN>
```

Show the table to the user and confirm which proposals to load. If it is
empty, check whether the expected proposals were merged to `master` after
`rebuild<NN>` was cut; see [preconditions](resources/preconditions.md).

### Step 2: Dry run each proposal

```bash
node scripts/load-proposal.js --dry-run <ACCESSION>
```

Prints the presenter XML that would be inserted and changes nothing. Run this
for every accession before loading any. A proposal merged to `master` after
`rebuild<NN>` was cut is reported as a straggler; the load step cherry-picks
it automatically. Fix anything else it reports (usually a presenter name
collision) before moving on.

### Step 3: Load

```bash
node scripts/load-proposal.js <ACCESSION>
```

One accession at a time. For a build sweep, loop over the accessions from
Step 1; a failure on one does not affect the others. After each, the working
tree is on `load/<ACCESSION>`. Check out `rebuild<NN>` before the next:

```bash
git -C veupathdb-repos/VEuPathDatasets checkout rebuild<NN>
```

### Step 4: Report

List the PR URLs and ticket URLs. The user reviews and merges the PRs into
`rebuild<NN>`. Tickets move to `done` outside this skill, when `rebuild<NN>`
merges to `master`.

## Recovery

If a load fails after the branch was created, the branch is left in place for
inspection. See [recovery](resources/recovery.md).

## Resources

- [Proposal Workflow](resources/proposal-workflow.md)
- [Preconditions](resources/preconditions.md)
- [Recovery](resources/recovery.md)

## Scripts

- `scripts/list-proposals.js` - proposals on the current branch, filter by build
- `scripts/load-proposal.js` - load one proposal; `--dry-run` to preview
- `scripts/render-proposal.js` - render XML for any proposal directory
- `scripts/renderers/<type>.js` - one renderer per dataset type
- `scripts/check-repos.sh` - repository check

All scripts are synced from `shared/` in dataset-curator.
````

- [ ] **Step 2: resources/preconditions.md**

```markdown
# Preconditions

`load-proposal.js` checks these in order and stops at the first failure with
the exact fix.

| Check | Failure message contains | Fix |
|---|---|---|
| Working tree clean | `working tree is not clean` | User commits or stashes |
| Proposal exists anywhere | `No proposal found` | Wrong accession, or the proposal PR was never merged. A proposal only on `origin/master` is a straggler, not an error: it is cherry-picked onto `load/<accession>` during the load. |
| Branch matches target build | `the proposal targets build NN (rebuildNN)` | Check out the right rebuild branch, or this proposal is for another build |
| `load/<accession>` absent | `already exists` | A previous run left it. Inspect, then `git branch -D load/<accession>` |
| Presenter file exists | `Presenter file missing` | The project has no presenter file; ask the user |
| Presenter name free | `already exists in Model/lib/xml/datasetPresenters/<Project>.xml` | The dataset was already loaded, or the name collides. Ask the user. |

## Why a straggler happens

`rebuild<NN>` is cut from `master` at build start. Any proposal merged to
`master` after that moment is not on `rebuild<NN>`. `load-proposal.js`
cherry-picks the proposal's commit onto `load/<accession>` so only that
proposal comes over, then renders and deletes it as usual. If the cherry-pick
conflicts (`Cherry-pick conflicts in: ...`), the branch is left mid-pick; the
user resolves or runs `git cherry-pick --abort`, then deletes the branch and
reruns.
```

- [ ] **Step 3: resources/recovery.md**

```markdown
# Recovery

## The load failed after `load/<accession>` was created

The branch holds whatever was committed. Report the error verbatim.

- If the commit exists but the push failed: the user can push manually or
  delete the branch and rerun.
- If the push succeeded but `gh pr create` failed: the user opens the PR in
  the GitHub UI, base `rebuild<NN>`, head `load/<accession>`.
- If the PR exists but the ticket update failed: the user updates the ticket
  by hand. The PR is the source of truth for what happened.

To rerun from scratch:

```bash
git -C veupathdb-repos/VEuPathDatasets checkout rebuild<NN>
git -C veupathdb-repos/VEuPathDatasets branch -D load/<accession>
```

Then `node scripts/load-proposal.js <accession>` again. Never force-push a
rebuild branch.

## A loaded proposal must be undone

Close the PR without merging and delete `load/<accession>`. The proposal is
still on `rebuild<NN>` and `master` because nothing was merged. Set the ticket
back to `proposed` by hand.
```

- [ ] **Step 4: Register sync targets and sync**

In `package.json` `sharedFiles`, add `"load-proposals"` to every entry under
`scripts/lib/` (including `scripts/lib/ticket/statuses.js`), `scripts/renderers/`, `scripts/render-proposal.js`,
`scripts/check-repos.sh`, `resources/valid-projects.json` and
`resources/proposal-workflow.md`. Add new entries:
```json
    "scripts/lib/load-ops.js": ["load-proposals"],
    "scripts/load-proposal.js": ["load-proposals"],
    "scripts/list-proposals.js": ["load-proposals"]
```
Do **not** sync `proposal-ops.js`, `start-proposal.js`, `write-proposal.js` or
`publish-proposal.js` into `load-proposals`; Phase 2 never creates proposals.

Run:
```bash
yarn sync-shared
node skills/load-proposals/scripts/render-proposal.js --name tests/fixtures/proposals/GCA_000001.1
ls skills/load-proposals/scripts/lib skills/load-proposals/scripts/renderers
```
Expected: `tfakST1_primary_genome_RSRC`; `lib/` lists config, contacts, manifest, presenter-file, git-ops, load-ops, ticket/; `renderers/` lists `_common`, `genome-assembly`, `bulk-rnaseq`.

- [ ] **Step 5: Commit**

```bash
git add skills/load-proposals package.json
git commit -m "Add load-proposals skill

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Release housekeeping

**Files:**
- Modify: `.claude-plugin/plugin.json`, `README.md`, `CLAUDE.md`, `docs/development.md`

- [ ] **Step 1: Version 2.0.0**

In `.claude-plugin/plugin.json` set `"version": "2.0.0"`. In `package.json`
set `"version": "2.0.0"`.

- [ ] **Step 2: README skill list and workspace setup**

Under "Available Skills" replace the list with:
```markdown
- **propose-genome-assembly**: Propose a genome assembly - fetch NCBI metadata, curate contacts, write a proposal to VEuPathDatasets, open the PR and ticket
- **propose-bulk-rnaseq**: Propose a bulk RNA-seq dataset - fetch SRA/GEO metadata, analyze samples, curate contacts, write a proposal, generate pipeline configs, open the PR and ticket
- **load-proposals**: Data loading team - render pending proposals into presenter XML on a rebuild branch, one PR per proposal
- **sample-annotations-to-stf**: Convert sample annotations JSON to STF format
```

In "Starting a Curation Session", after the symlink step, add:
```markdown
3. **Create your configuration** from the template in this repository:
   ```bash
   cp /path/to/dataset-curator/curator.config.example.json curator.config.json
   ```
   Edit the ticket settings. For Redmine, also `export REDMINE_API_KEY=...`.
   For GitHub issues, run `gh auth login` once.
```
and renumber the following steps.

Under "For Developers" symlink instructions, no change is needed because the
`ln -s .../skills/*` glob picks up `load-proposals`.

- [ ] **Step 3: CLAUDE.md skill tree**

Replace the `skills/` block in the repository structure with:
```
├── skills/
│   ├── propose-genome-assembly/            # Phase 1: genome assembly proposals
│   ├── propose-bulk-rnaseq/                # Phase 1: bulk RNA-seq proposals
│   ├── load-proposals/                     # Phase 2: render proposals on rebuild branches
│   └── sample-annotations-to-stf/          # Utility: sample annotations to STF
```
and change "Curator Processing a Dataset?" to:
```markdown
**Curator proposing a dataset?**
→ Tell me the dataset type and I'll activate the matching `propose-*` skill

**Data loading team starting a build?**
→ Say "load proposals for build NN" and I'll activate `load-proposals`
```

- [ ] **Step 4: Roleplay activation**

Start `claude` here and say "load proposals for build 02". Expected: the
`load-proposals` skill activates and its first action is the prerequisites
block. Say `STOP`.

- [ ] **Step 5: Final verification and commit**

```bash
yarn test
yarn sync-shared
grep -rn 'ApiCommon\|EbrcModel\|curate-genome\|curate-bulk\|generate-presenter-xml' --exclude-dir=.git --exclude-dir=node_modules . | grep -v '^./docs/superpowers/'
git add -A
git commit -m "Release 2.0.0: two-phase proposals

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
Expected: tests pass, sync clean, grep prints nothing.

---

## Done when

- `yarn test` passes offline.
- `skills/load-proposals` contains SKILL.md, three resources, and synced scripts with no Phase 1 scripts.
- Plugin version is 2.0.0 and README lists four skills.
- The `two-phase-proposals` branch is ready for a PR to main, which John opens.
