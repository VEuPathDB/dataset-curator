# Load from Master Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Load renders presenter and dataset XML from the proposal on `origin/master` without ever putting the proposal on the rebuild branch, copies `master`'s `allContacts.xml` in the load commit, archives the proposal under `fromProvider/proposal/` in delivery, and a `start-build.js` syncs contacts, merges the rebuild branch back and deletes earlier releases' loaded proposals.

**Architecture:** Every reader of proposals (`listProposals`, `checkOrganisms`, `checkLoadPreconditions`, `loadProposal`, `markLoaded`) reads `Proposals/` from `origin/master` through git, exporting a scratch copy when files are needed. The straggler/cherry-pick path and the proposal deletion are removed. A resume is recognised by the load commit on `load/<acc>`. Build start is three explicit steps in `lib/build-start-ops.js`, each opening a PR people merge.

**Tech Stack:** Node.js ESM, `node:test`, git and gh through `lib/git-ops.js`.

Spec: `docs/superpowers/specs/2026-10-23-load-from-master-design.md`. Prerequisite: PR #28 (release vs rebuild) merged; this plan uses `rebuildBranch`, `assertRebuildBranch` and `isAncestor` from it.

**Rules for whoever executes this plan:**
- Branch `load-from-master` from `origin/main` after #28 merges. Never commit to `main`; never push unless the controller says so.
- Edit `shared/`, `tests/`, skill-owned docs; `yarn sync-shared` (pre-commit hook) copies `shared/` into `skills/*/`; include its changes, never hand-edit synced copies.
- End every commit message with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Baseline after #28: full suite 554 pass, 0 fail, 1 skipped. Report exact counts after each task.

---

## File Structure

- `shared/scripts/lib/load-ops.js`: proposals read from `origin/master`; straggler, cherry-pick and deletion removed; resume by load commit; contacts copied; delivery re-exported with archive.
- `shared/scripts/lib/artifacts.js`: `fromProviderOf`, `archiveProposal`; `handoffNote` names the archive.
- `shared/scripts/lib/build-start-ops.js` (new): `syncContacts`, `mergeBack`, `cleanProposals`.
- `shared/scripts/start-build.js` (new): CLI for the three steps.
- `shared/scripts/lib/git-ops.js`: remove `cherryPick` (no caller left).
- `shared/scripts/load-proposal.js`, `list-proposals.js`: CLI output and arguments.
- Tests: `tests/load-ops.test.js` (reworked), `tests/artifacts.test.js`, `tests/build-start-ops.test.js` (new), `tests/git-ops.test.js`.
- Docs: `shared/resources/proposal-workflow.md`, `skills/load-proposals/SKILL.md`, `skills/load-proposals/resources/{preconditions,recovery}.md`, `CLAUDE.md`, `package.json` `sharedFiles`.

---

### Task 1: Proposals are listed from origin/master

**Files:** Modify `shared/scripts/lib/load-ops.js` (`listProposals`, `settlementFor`, `checkOrganisms`), `shared/scripts/list-proposals.js`; Test `tests/load-ops.test.js`

- [ ] **Step 1: Write the failing tests** (in `tests/load-ops.test.js`, replace the first test `'listProposals reads manifests on the current branch and filters by the ticket build'` with the first test below, add the second)

```js
test('listProposals reads manifests on origin/master and filters by the ticket build', async () => {
  const { repo } = setupRepo();
  const git = createGit(repo);
  const all = await listProposals(git, { ticket: tickets() });
  assert.deepEqual(all.proposals.map(p => [p.manifest.accession, p.build]).sort(), [['GCA_000001.1', '02'], ['PRJNA000002', '03']]);
  assert.deepEqual(all.errors, []);
  assert.deepEqual((await listProposals(git, { ticket: tickets(), build: '02' })).proposals.map(p => p.manifest.accession), ['GCA_000001.1']);
});

test('listProposals ignores proposals that are only on the rebuild branch', async () => {
  const { repo } = setupRepo();
  const git = createGit(repo);
  cpSync(join(fixtures, 'proposals/PRJNA000003'), join(repo, 'Proposals/PRJNA000003'), { recursive: true });
  commitAll(repo, 'a proposal on rebuild02 only');
  const { proposals } = await listProposals(git, { ticket: tickets() });
  assert.equal(proposals.some(p => p.manifest.accession === 'PRJNA000003'), false);
});
```

Change every other `listProposals(repo, ...)` call in the file to `listProposals(createGit(repo), ...)`. Tests that edit a manifest to make `listProposals` report an error must now make that edit on `master` (see the `editOnMaster` helper in Task 2, Step 1; add it now).

- [ ] **Step 2: Run** `node --test tests/load-ops.test.js` — Expected: FAIL (`listProposals` takes a repo path).

- [ ] **Step 3: Implement**

`listProposals` becomes:

```js
/**
 * Proposals on origin/master with the build and status their ticket has,
 * optionally filtered by build and status. Read-only; callers fetch first.
 * One unreadable manifest or ticket must not hide the rest, so it is reported
 * in `errors` rather than thrown.
 * Returns { proposals: [{ manifest, build, status }], errors: [{ accession, message }] }.
 */
export async function listProposals(git, { ticket, build, status } = {}) {
  if (status !== undefined) assertStatus(status);
  const proposals = [];
  const errors = [];
  const contactIds = readContactIdsOnRef(git, 'origin/master');
  for (const accession of git.listDir('origin/master', PROPOSALS_DIR)) {
    try {
      const manifest = readOnRef(git, 'origin/master', accession, { contactIds });
      if (!manifest) continue;
      const found = manifest.ticket ? await ticket.getBuild(manifest.ticket) : null;
      if (build && found !== build) continue;
      const current = manifest.ticket ? await ticket.getStatus(manifest.ticket) : null;
      if (status && current !== status) continue;
      proposals.push({ manifest, build: found, status: current });
    } catch (err) {
      errors.push({ accession, message: err.message });
    }
  }
  return { proposals, errors };
}
```

In `settlementFor`, claims come only from `origin/master` (the rebuild branch's `Proposals/` is a stale snapshot from its cut):

```js
    claims: pendingGenomeProposals(git, ['origin/master']),
```

In `checkOrganisms`, call `listProposals(git, { ticket, build, status: 'ready' })`.

`list-proposals.js`: create git and fetch before listing:

```js
import { createGit } from './lib/git-ops.js';
...
  const git = createGit(config.repoPath);
  git.fetch();
  const { proposals, errors } = await listProposals(git, { ticket, build: values.build, status: values.status });
```

and its header says "Lists the proposals on origin/master with each ticket's build and status. Read-only."

- [ ] **Step 4: Run** `node --test tests/load-ops.test.js`, then the full suite. Expected: PASS except load tests that Task 2 reworks; if any fail here, they must be only tests that rely on proposals on the rebuild branch — list them in the report and leave them for Task 2 (do not delete them here).

- [ ] **Step 5: Commit** — `git commit -m "Proposals are listed from origin/master"`

---

### Task 2: Load reads the proposal from origin/master, commits XML and contacts only

**Files:** Modify `shared/scripts/lib/load-ops.js`, `shared/scripts/load-proposal.js`, `shared/scripts/lib/git-ops.js`; Test `tests/load-ops.test.js`, `tests/git-ops.test.js`

This is the core change. Use a capable model.

- [ ] **Step 1: Rework the test setup**

In `tests/load-ops.test.js`:

```js
/** Applies edit on master, commits and pushes there, and returns to rebuild02. */
function editOnMaster(repo, edit, message) {
  execFileSync('git', ['-C', repo, 'checkout', '-q', 'master']);
  edit();
  commitAll(repo, message);
  execFileSync('git', ['-C', repo, 'checkout', '-q', 'rebuild02']);
}
```

`setupRepo` cuts `rebuild02` from master **before** the proposals are added, so the rebuild branch never has them:

```js
const setupRepo = () => {
  const { root, repo, bare } = initRepo('load-ops-');
  writeFileSync(join(repo, 'Model/lib/xml/datasetPresenters/FungiDB.xml'), '<?xml version="1.0"?>\n<datasetPresenters>\n</datasetPresenters>\n');
  commitAll(repo, 'presenters');
  execFileSync('git', ['-C', repo, 'branch', 'rebuild02']);
  execFileSync('git', ['-C', repo, 'push', '-q', '-u', 'origin', 'rebuild02']);
  cpSync(join(fixtures, 'proposals/GCA_000001.1'), join(repo, 'Proposals/GCA_000001.1'), { recursive: true });
  cpSync(join(fixtures, 'proposals/PRJNA000002'), join(repo, 'Proposals/PRJNA000002'), { recursive: true });
  setManifestFields(repo, 'GCA_000001.1', { ticket: { system: 'github', id: '41', url: 'https://r/issues/41' } });
  setManifestFields(repo, 'PRJNA000002', { ticket: { system: 'github', id: '43', url: 'https://r/issues/43' } });
  commitAll(repo, 'merge proposals');
  execFileSync('git', ['-C', repo, 'checkout', '-q', 'rebuild02']);
  return { root, repo, bare };
};
```

Then go through every test:
- An edit to `Proposals/...` (manifest fields, curated files, `moveArtifacts`, `alignTo`) followed by `commitAll` becomes `editOnMaster(repo, () => { ...the edits... }, message)`. Edits to organism dataset files, presenter files, `classes.xml` or `allContacts.xml` that model the **rebuild branch** stay on `rebuild02`. Edits that model a contact or proposal arriving through Phase 1 go on master.
- Delete these tests (their behaviour no longer exists): `'straggler: proposal only on master is cherry-picked onto the load branch and loaded'`, `'straggler: only commits after the rebuild cut are cherry-picked'`, `'a cherry-pick left mid-flight is aborted by the start-over command'`, `'straggler: a settled organism is rendered after the cherry-pick'`.
- Rename and rework `'straggler: a contact its own commit adds on master travels with it'` into `'a contact the proposal added on master arrives with the load commit'` (Step 2), and `'straggler: a presenter already on this build is refused before anything is created'` into `'a presenter already on the rebuild branch is refused before anything is created'` (the presenter is put into FungiDB.xml on rebuild02).
- Every assertion that the load commit deleted the proposal, that `Proposals/<acc>` is gone after load, or that the PR body says `Proposal removed`, is inverted: the load commit touches no `Proposals/` path, and the PR body says `Proposal: \`Proposals/<acc>\` on master (archived in delivery)`.
- `cherryPicked` disappears from results; drop assertions on it.

- [ ] **Step 2: Write the new tests**

```js
const loadCommitFiles = (repo) => execFileSync('git', ['-C', repo, 'show', '--name-only', '--format=', 'HEAD'], { encoding: 'utf-8' }).trim().split('\n').sort();

test('a load commit holds the presenter and dataset files, and no proposal', async (t) => {
  const { repo, deliveryBase } = rnaOnRebuild(t);
  const gh = ghStub();
  await loadProposal({ git: createGit(repo, { exec: gh.exec }), ticket: tickets(), repoPath: repo, rebuildBranch: REBUILD, accession: 'PRJNA000002', deliveryBase });
  assert.deepEqual(loadCommitFiles(repo), ['Datasets/lib/xml/datasets/FungiDB/tfakST1.xml', 'Model/lib/xml/datasetPresenters/FungiDB.xml']);
  assert.equal(existsSync(join(repo, 'Proposals/PRJNA000002')), false);
});

test('a contact the proposal added on master arrives with the load commit', async (t) => {
  const { repo, deliveryBase } = rnaOnRebuild(t);
  const contacts = join(repo, 'Model/lib/xml/datasetPresenters/contacts/allContacts.xml');
  editOnMaster(repo, () => {
    writeFileSync(contacts, readFileSync(contacts, 'utf-8').replace('</contacts>', '  <contact>\n    <contactId>new.person</contactId>\n    <name>New Person</name>\n  </contact>\n</contacts>'));
    setManifestFields(repo, 'PRJNA000002', { contacts: { primary: 'new.person', additional: [] } });
  }, 'proposal with a new contact');
  const gh = ghStub();
  await loadProposal({ git: createGit(repo, { exec: gh.exec }), ticket: tickets(), repoPath: repo, rebuildBranch: REBUILD, accession: 'PRJNA000002', deliveryBase });
  const master = execFileSync('git', ['-C', repo, 'show', 'origin/master:Model/lib/xml/datasetPresenters/contacts/allContacts.xml'], { encoding: 'utf-8' });
  assert.equal(readFileSync(contacts, 'utf-8'), master);
  assert.ok(loadCommitFiles(repo).includes('Model/lib/xml/datasetPresenters/contacts/allContacts.xml'));
});

test('an accession loaded before loads again without dragging its earlier commits', async (t) => {
  const { repo, deliveryBase } = rnaOnRebuild(t);
  const first = ghStub();
  await loadProposal({ git: createGit(repo, { exec: first.exec }), ticket: tickets(), repoPath: repo, rebuildBranch: REBUILD, accession: 'PRJNA000002', deliveryBase });
  // The first load merges into rebuild02, which is merged back into master.
  execFileSync('git', ['-C', repo, 'checkout', '-q', 'rebuild02']);
  execFileSync('git', ['-C', repo, 'merge', '-q', '--no-edit', 'load/PRJNA000002']);
  execFileSync('git', ['-C', repo, 'push', '-q']);
  editOnMaster(repo, () => {
    execFileSync('git', ['-C', repo, 'merge', '-q', '--no-edit', 'origin/rebuild02']);
    setManifestFields(repo, 'PRJNA000002', { version: '2024-06-01' });
  }, 'merge back, then a new version of the proposal');
  execFileSync('git', ['-C', repo, 'branch', '-D', 'load/PRJNA000002']);
  execFileSync('git', ['-C', repo, 'push', '-q', 'origin', '--delete', 'load/PRJNA000002']);
  const second = ghStub();
  await assert.rejects(
    loadProposal({ git: createGit(repo, { exec: second.exec }), ticket: tickets(), repoPath: repo, rebuildBranch: REBUILD, accession: 'PRJNA000002', deliveryBase }),
    /Presenter ".*" already exists in Model\/lib\/xml\/datasetPresenters\/FungiDB\.xml/);
  assert.equal(second.calls.some((a) => a[0] === 'pr' && a[1] === 'create'), false);
});

test('a resume is refused when HEAD is not this accession\'s load commit', async () => {
  const { repo } = setupRepo();
  execFileSync('git', ['-C', repo, 'checkout', '-q', '-b', 'load/GCA_000001.1']);
  writeFileSync(join(repo, 'NOTES'), 'not a load\n');
  commitAll(repo, 'unrelated work');
  await assert.rejects(
    checkLoadPreconditions({ git: createGit(repo), ticket: tickets(), repoPath: repo, rebuildBranch: REBUILD, accession: 'GCA_000001.1' }),
    /Expected to be on rebuild02, but on "load\/GCA_000001\.1"/);
});
```

(The re-load test pins that a second load of an already-loaded dataset is refused by the presenter collision check before any branch, rather than failing on a cherry-pick of the first round's commits. If `commitAll` needs an upstream for `load/GCA_000001.1`, push with `-u`.)

- [ ] **Step 3: Run** `node --test tests/load-ops.test.js` — Expected: FAIL broadly.

- [ ] **Step 4: Implement in `load-ops.js`**

Imports: drop `readManifest` (the `read as readManifest` import) and `readContactIds`/`contactsPath` if unused afterwards; add `CONTACTS_RELATIVE_PATH` from `./contacts.js`.

Replace the manifest-locating block and everything from `if (!isStraggler)` to the end of `checkLoadPreconditions` so it reads, in order:

```js
export async function checkLoadPreconditions({ git, ticket, repoPath, rebuildBranch, accession, dryRun = false, settle = {} }) {
  assertRebuildBranch(rebuildBranch);
  const relDir = proposalRelativePath(accession);
  const branch = loadBranch(accession);
  git.fetch();

  const onLoadBranch = (git.currentBranch() || '') === branch;
  const dirty = onLoadBranch ? dirtyTreeMessage(repoPath, accession, rebuildBranch) : undefined;
  assertClean(git, () => dirty);

  // Proposals live on master only; contacts are edited there and copied in the load commit.
  const manifest = readOnRef(git, 'origin/master', accession, { contactIds: readContactIdsOnRef(git, 'origin/master') });
  if (!manifest) {
    throw new Error(`No proposal found at ${relDir} on origin/master. Check the accession, or confirm its proposal pull request was merged.`);
  }
  if (!manifest.ticket) {
    throw new Error(`Proposal ${accession} has no ticket, so it has no build. Record its ticket in ${relDir}/${MANIFEST_FILENAME} on master.`);
  }
  await ticket.checkProject();
  const build = await ticket.getBuild(manifest.ticket);
  const base = rebuildBranch;
  const presenterPath = presenterFilePath(repoPath, homeProject(manifest));

  if (isResume(git, accession, base)) {
    const settled = settledOrStop(git, manifest, settle);
    await assertSettledAsCommitted(git, manifest, { relDir, build, settled, repoPath, base, branch });
    return { manifest, presenterPath, base, branch, build, resume: true, settled };
  }
  // ...status checks unchanged...
  assertOnCurrentRebuild(git, repoPath, base, `Loading targets ${base}.`);
  const settled = settledOrStop(git, manifest, settle);
  // ...branch-exists, remote-branch-exists, presenter-file checks unchanged...
  const rendered = await withProposalFromRef(git, 'origin/master', relDir,
    (dir) => renderAndCheck(git, manifest, dir, presenterPath, repoPath, build, settled));
  return { manifest, presenterPath, base, branch, build, resume: false, settled, ...rendered };
}
```

Add:

```js
/** On load/<acc>, cut from base, with this accession's load commit at HEAD: a run that failed after committing. */
function isResume(git, accession, base) {
  const branch = loadBranch(accession);
  if ((git.currentBranch() || '') !== branch || git.aheadOf(base) < 1) return false;
  if (!git.isAncestor(base, 'HEAD')) {
    throw new Error(`Branch ${branch} was not cut from ${base}; resume with the --rebuild-branch it was loaded from`);
  }
  return git.headSubject().startsWith(`Load ${accession}: `);
}
```

Update the doc comment of `checkLoadPreconditions` to describe: proposal and contacts read from `origin/master`; the render runs on a scratch export; a resume is the load commit at HEAD of `load/<acc>` cut from the rebuild branch.

`assertSettledAsCommitted`: render the presenter names from `origin/master` instead of `HEAD~1`:

```js
    const names = await withProposalFromRef(git, 'origin/master', relDir, (dir) => withSettledProposal(dir, manifest, settled,
      (d) => [extractPresenterName(datasetType.renderPresenter(d, { build }))]));
```

`datasetOrganismsFromCommit`: the subject no longer ends in `, remove proposal`:

```js
  return new RegExp(`, ${name} to (.+)$`).exec(subject)?.[1].split(' ') ?? null;
```

`recoveryFooter({ git, repoPath, accession, base, branch })`: resumable when `isResume` would be true (wrap in try, any throw means not resumable); remove the cherry-pick detection and the `abort` prefix entirely:

```js
function recoveryFooter({ git, repoPath, accession, base, branch }) {
  let resumable = false;
  try { resumable = isResume(git, accession, base); } catch { resumable = false; }
  if (resumable) return 'Re-run the same command to resume.';
  return `To start over: git -C '${repoPath}' checkout -f ${base} && git -C '${repoPath}' branch -D ${branch}`;
}
```

`loadProposal`: no straggler, no `git.rm`, contacts copied, delivery always from a fresh export:

```js
export async function loadProposal({ git, ticket, repoPath, rebuildBranch, accession, dryRun = false, deliveryBase, settle = {} }) {
  const pre = await checkLoadPreconditions({ git, ticket, repoPath, rebuildBranch, accession, dryRun, settle });
  const { manifest, base, branch, build, resume } = pre;
  const relDir = proposalRelativePath(accession);
  const warnings = [];
  if (resume) warnings.push(`Branch ${branch} already holds the load commit; resuming with push, pull request and ticket.`);
  if (dryRun) {
    const presenters = pre.presenters ?? [];
    return {
      presenterNames: pre.presenters ? presenters.map((p) => p.name) : presenterNamesFromCommit(git.headSubject()),
      presenters, dataset: pre.dataset ?? null, manifest, warnings, settled: pre.settled, dryRun: true
    };
  }

  git.checkGhAuth();
  const { presenterFile, presenters } = pre;
  let presenterNames = presenters?.map((p) => p.name);
  let prUrl;
  let handoff = null;
  let dataset = pre.dataset ?? null;
  try {
    if (!resume) {
      git.createBranch(branch, base);
      const writes = [{ relFile: presenterFileRelativePath(homeProject(manifest)), content: presenters.reduce((c, p) => insertPresenter(c, p.xml), presenterFile) },
        ...(dataset?.organisms ?? []).map((o) => ({ relFile: o.relFile, content: insertDataset(o.datasetFile, dataset.xml) }))];
      const masterContacts = git.showFile('origin/master', CONTACTS_RELATIVE_PATH);
      if (readFileSync(join(repoPath, CONTACTS_RELATIVE_PATH), 'utf-8') !== masterContacts) writes.push({ relFile: CONTACTS_RELATIVE_PATH, content: masterContacts });
      for (const w of writes) writeFileSync(join(repoPath, w.relFile), w.content);
      git.add(writes.map((w) => w.relFile));
      const alsoDataset = dataset ? `, ${manifest.name} to ${dataset.organisms.map((o) => o.organism).join(' ')}` : '';
      git.commit(`Load ${accession}: add ${presenterNames.join(' ')} to ${homeProject(manifest)}${alsoDataset}`);
    }
    presenterNames ??= presenterNamesFromCommit(git.headSubject());
    handoff = await deliver({ git, manifest, settled: pre.settled, repoPath, relDir, deliveryBase });
    git.push(branch, resume ? { force: git.remoteBranchExists(branch) } : {});
    // ...title, body (with the Proposal line from Step 1), PR, ticket comment and status as before...
  } catch (err) {
    throw new Error(`${err.message}\n${recoveryFooter({ git, repoPath, accession, base, branch })}`, { cause: err });
  }
  return { presenterNames, manifest, prUrl, branch, base, warnings, handoff, settled: pre.settled, dryRun: false, resumed: Boolean(resume) };
}

/** Writes the loading artifacts from a fresh export of the proposal on origin/master; returns the hand-off, or null without a dataset class. */
async function deliver({ git, manifest, settled, repoPath, relDir, deliveryBase }) {
  return withProposalFromRef(git, 'origin/master', relDir, (dir) => withSettledProposal(dir, manifest, settled, async (d, m) => {
    const { dataset } = await renderDatasetParts(m, d, repoPath, { check: false });
    if (!dataset) return null;
    excludeScratch(repoPath);
    const deliveryRoot = deliveryBase ?? join(repoPath, SCRATCH_DIR, 'delivery');
    const deliveries = dataset.organisms.map((o) => ({ localDir: writeArtifacts(deliveryRoot, o.delivery.relative, o.files), target: o.delivery.target, files: o.files }));
    return handoffNote({ deliveries, source: dataset.source });
  }));
}
```

(Task 3 adds the archive to `deliver`.) The `dataset` variable in `loadProposal` is still needed for the commit writes and the PR body; for a resume it is `null` before `deliver`, so the PR body's Dataset line uses `pre.settled` organisms and `datasetFileRelativePath(projectOf(manifest, o.proposed), o.abbrev)` when `dataset` is null — or simply have `deliver` also return the dataset and use it. Keep whichever is simpler and tested.

Remove `proposalDir` from every return value and parameter it no longer serves.

`load-proposal.js`: remove the two `cherryPicked` output lines and the dry-run "would ... remove Proposals/<acc>" text: the dry run says `Dry run: would add <presenters> to <Project>.`

`git-ops.js`: remove `cherryPick` and its test in `tests/git-ops.test.js` (`grep -rn cherryPick shared tests` must be empty). Keep `commitsForPath` (used by `organisms.js`).

- [ ] **Step 5: Run** `node --test tests/load-ops.test.js tests/git-ops.test.js`, then the full suite. Expected: PASS. Report how many tests were deleted, reworked and added.

- [ ] **Step 6: Commit** — `git commit -m "Load renders from the proposal on origin/master; no cherry-pick, no proposal on the rebuild branch"`

---

### Task 3: Archive the proposal in fromProvider

**Files:** Modify `shared/scripts/lib/artifacts.js`, `shared/scripts/lib/load-ops.js` (`deliver`, `renderDatasetParts`); Test `tests/artifacts.test.js`, `tests/load-ops.test.js`

- [ ] **Step 1: Write the failing tests** (`tests/artifacts.test.js`; add imports `fromProviderOf`, `archiveProposal`, and `lstatSync`, `readlinkSync`, `realpathSync`, `existsSync` from `node:fs` as needed)

```js
test('fromProviderOf is the sibling of final, and refuses any other delivery path', () => {
  assert.equal(fromProviderOf('FungiDB/tfakST1/rnaSeq/Doe/2024-05-01/final'), 'FungiDB/tfakST1/rnaSeq/Doe/2024-05-01/fromProvider');
  assert.throws(() => fromProviderOf('FungiDB/tfakST1/rnaSeq/Doe/2024-05-01/data'), /must end in "final" so fromProvider can sit beside it; got "FungiDB\/tfakST1\/rnaSeq\/Doe\/2024-05-01\/data"/);
});

test('archiveProposal copies the proposal under the first organism and links the others to it', () => {
  const root = mkdtempSync(join(tmpdir(), 'archive-'));
  const proposal = join(mkdtempSync(join(tmpdir(), 'proposal-')), 'PRJNA1');
  mkdirSync(join(proposal, 'curated'), { recursive: true });
  writeFileSync(join(proposal, 'manifest.json'), '{}');
  writeFileSync(join(proposal, 'curated/presenter.json'), '{}');
  const finals = ['FungiDB/a1/rnaSeq/N/v/final', 'HostDB/h1/rnaSeq/N/v/final'];
  const archive = archiveProposal(root, finals, proposal);
  assert.equal(archive, join(root, 'FungiDB/a1/rnaSeq/N/v/fromProvider'));
  assert.ok(existsSync(join(archive, 'proposal/manifest.json')));
  assert.ok(existsSync(join(archive, 'proposal/curated/presenter.json')));
  const link = join(root, 'HostDB/h1/rnaSeq/N/v/fromProvider');
  assert.ok(lstatSync(link).isSymbolicLink());
  assert.equal(readlinkSync(link), '../../../../../FungiDB/a1/rnaSeq/N/v/fromProvider');
  assert.equal(realpathSync(link), realpathSync(archive));
  // Re-running replaces both.
  archiveProposal(root, finals, proposal);
  assert.ok(lstatSync(link).isSymbolicLink());
});

test('handoffNote names the archive and asks for a copy that keeps symlinks', () => {
  const note = handoffNote({ deliveries: [{ localDir: '/d/final', target: '@@manualDeliveryDir@@/x/final', files: { 'samplesheet.csv': '' } }], source: { type: 'sra' }, archive: { localDir: '/d/fromProvider', target: '@@manualDeliveryDir@@/x/fromProvider' } });
  assert.match(note, /Proposal archive: `\/d\/fromProvider` to `@@manualDeliveryDir@@\/x\/fromProvider`/);
  assert.match(note, /cp -a or rsync -a/);
});
```

and in `tests/load-ops.test.js`:

```js
test('an rnaseq load archives the proposal in the first organism\'s fromProvider and links the second', async (t) => {
  const { repo, deliveryBase } = rnaForTwoOrganisms(t);
  const gh = ghStub();
  const result = await loadProposal({ git: createGit(repo, { exec: gh.exec }), ticket: tickets(), repoPath: repo, rebuildBranch: REBUILD, accession: 'PRJNA000002', deliveryBase });
  const home = join(deliveryBase, 'FungiDB/tfakST1/rnaSeq/Doe_heat_shock_2024/2024-05-01/fromProvider');
  assert.ok(existsSync(join(home, 'proposal/manifest.json')));
  const second = join(deliveryBase, 'FungiDB/tfakST2/rnaSeq/Doe_heat_shock_2024/2024-05-01/fromProvider');
  assert.ok(lstatSync(second).isSymbolicLink());
  assert.equal(realpathSync(second), realpathSync(home));
  assert.match(result.handoff, /Proposal archive:/);
});
```

(Adjust the second organism's project/abbrev to whatever `rnaForTwoOrganisms` sets.)

- [ ] **Step 2: Run** — Expected: FAIL.

- [ ] **Step 3: Implement in `artifacts.js`**

```js
import { mkdirSync, writeFileSync, cpSync, rmSync, symlinkSync } from 'node:fs';
import { join, dirname, basename, relative } from 'node:path';

/** fromProvider always sits beside the class's final delivery directory. */
export function fromProviderOf(finalRelative) {
  if (basename(finalRelative) !== 'final') throw new Error(`A delivery path must end in "final" so fromProvider can sit beside it; got "${finalRelative}"`);
  return join(dirname(finalRelative), 'fromProvider');
}

/**
 * Copies the whole proposal to the first organism's fromProvider/proposal and
 * makes every other organism's fromProvider a relative symlink to it, so the
 * link survives copying the tree to the server. Returns the first fromProvider.
 */
export function archiveProposal(baseDir, finalRelatives, proposalDir) {
  const [home, ...others] = finalRelatives.map((f) => join(baseDir, fromProviderOf(f)));
  rmSync(home, { recursive: true, force: true });
  mkdirSync(home, { recursive: true });
  cpSync(proposalDir, join(home, 'proposal'), { recursive: true });
  for (const link of others) {
    mkdirSync(dirname(link), { recursive: true });
    rmSync(link, { recursive: true, force: true });
    symlinkSync(relative(dirname(link), home), link);
  }
  return home;
}
```

`handoffNote({ deliveries, source, archive })`: after the `Copy ...` lines, when `archive` is given:

```js
    ...(archive ? [`Proposal archive: \`${archive.localDir}\` to \`${archive.target}\`; the other organisms' fromProvider link to it, so copy with cp -a or rsync -a to keep the links`] : []),
```

In `load-ops.js`:
- `renderDatasetParts` calls `fromProviderOf(delivery.relative)` for each organism right after `deliveryLocation`, so a non-`final` path is refused during the precondition render, before any branch.
- `deliver` archives the **original** (unsettled) export `dir` and passes the archive to `handoffNote`:

```js
    const home = archiveProposal(deliveryRoot, dataset.organisms.map((o) => o.delivery.relative), dir);
    const target = `${dirname(dataset.organisms[0].delivery.target.replace(/\/$/, ''))}/fromProvider`;
    return handoffNote({ deliveries, source: dataset.source, archive: { localDir: home, target } });
```

(`dir` is the outer `withProposalFromRef` export; restructure `deliver` so it is in scope.)

- [ ] **Step 4: Run** `node --test tests/artifacts.test.js tests/load-ops.test.js`, then the full suite. Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -m "Archive the proposal in fromProvider beside final, linked for every other organism"`

---

### Task 4: markLoaded reads the ticket from origin/master

**Files:** Modify `shared/scripts/lib/load-ops.js` (`markLoaded`); Test `tests/load-ops.test.js`

- [ ] **Step 1: Tests.** Replace `'markLoaded finds the ticket from a clone without the load branch, fetching the PR head'` with:

```js
test('markLoaded finds the ticket on origin/master from any clone', async () => {
  const { root, bare, gh } = await loadedGenome();
  const other = otherClone(root, bare, 'master');
  const ticket = stubTicket({ status: 'loading' });
  const result = await markLoaded({ git: createGit(other, { exec: gh.exec }), ticket, accession: 'GCA_000001.1' });
  assert.equal(result.ticket.id, '41');
});

test('markLoaded refuses when the proposal is no longer on origin/master', async () => {
  const { repo, gh } = await loadedGenome();
  editOnMaster(repo, () => execFileSync('git', ['-C', repo, 'rm', '-r', '-q', 'Proposals/GCA_000001.1']), 'cleaned');
  await assert.rejects(markLoaded({ git: createGit(repo, { exec: gh.exec }), ticket: stubTicket({ status: 'loading' }), accession: 'GCA_000001.1' }),
    /Proposals\/GCA_000001\.1 is not on origin\/master/);
});
```

(Use the existing helper at line ~928 that loads GCA_000001.1 and returns what a merged load PR reports; name it as it is in the file and adapt the destructuring. Ticket ids follow that helper.) Remove the test's reliance on `refs/pull/<n>/head`.

- [ ] **Step 2: Run** — Expected: FAIL.

- [ ] **Step 3: Implement**

```js
/**
 * After the load pull request has merged: moves the ticket of a loaded proposal
 * to `qa` (Post Load QA) and notes the pull request on it once. The proposal is
 * still on origin/master (clean-proposals removes it only after Post Load QA).
 * Re-running once the ticket is past loading changes nothing.
 * Returns { prUrl, base, ticket, alreadyLoaded }.
 */
export async function markLoaded({ git, ticket, accession }) {
  const branch = loadBranch(accession);
  git.fetch();
  const pr = git.findMergedPullRequest(branch);
  if (!pr) throw new Error(`No merged pull request from ${branch}; mark ${accession} loaded after its load pull request merges`);
  const manifest = readOnRef(git, 'origin/master', accession);
  if (!manifest) throw new Error(`${proposalRelativePath(accession)} is not on origin/master, so its ticket cannot be found; set its Status by hand`);
  if (!manifest.ticket) throw new Error(`The manifest of ${accession} on origin/master has no ticket`);
  // ...status handling unchanged...
}
```

- [ ] **Step 4: Run** the full suite. Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -m "markLoaded reads the ticket from origin/master"`

---

### Task 5: Build start

**Files:** Create `shared/scripts/lib/build-start-ops.js`, `shared/scripts/start-build.js`; Modify `shared/scripts/lib/load-ops.js` (export `assertRebuildBranch`, `LOADED_STATUSES`); Test `tests/build-start-ops.test.js`

- [ ] **Step 1: Write the failing tests** (`tests/build-start-ops.test.js`)

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createGit } from '../shared/scripts/lib/git-ops.js';
import { syncContacts, mergeBack, cleanProposals } from '../shared/scripts/lib/build-start-ops.js';
import { CONTACTS_RELATIVE_PATH } from '../shared/scripts/lib/contacts.js';
import { fixtures, initRepo, stubTicket, stubGh } from './helpers.js';

const git_ = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf-8' }).trim();
const commitAll = (repo, message) => { git_(repo, 'add', '-A'); git_(repo, 'commit', '-q', '-m', message); git_(repo, 'push', '-q'); };
const addContact = (repo, id) => {
  const path = join(repo, CONTACTS_RELATIVE_PATH);
  writeFileSync(path, readFileSync(path, 'utf-8').replace('</contacts>', `  <contact>\n    <contactId>${id}</contactId>\n    <name>${id}</name>\n  </contact>\n</contacts>`));
};

/** master and rebuild02, with a contact added on master after the cut. */
function setup() {
  const { root, repo, bare } = initRepo('build-start-');
  git_(repo, 'branch', 'rebuild02');
  git_(repo, 'push', '-q', '-u', 'origin', 'rebuild02');
  addContact(repo, 'later.person');
  commitAll(repo, 'a proposal adds a contact');
  git_(repo, 'checkout', '-q', 'rebuild02');
  return { root, repo, bare };
}

test('syncContacts opens a PR copying master\'s allContacts.xml onto the rebuild branch', async () => {
  const { repo } = setup();
  const gh = stubGh();
  const result = await syncContacts({ git: createGit(repo, { exec: gh.exec }), repoPath: repo, rebuildBranch: 'rebuild02' });
  assert.equal(result.changed, true);
  assert.equal(git_(repo, 'show', `origin/sync-contacts/rebuild02:${CONTACTS_RELATIVE_PATH}`), git_(repo, 'show', `origin/master:${CONTACTS_RELATIVE_PATH}`));
  const create = gh.calls.find((a) => a[0] === 'pr' && a[1] === 'create');
  assert.deepEqual([create[3], create[5]], ['rebuild02', 'sync-contacts/rebuild02']);
});

test('syncContacts does nothing when the files already match', async () => {
  const { repo } = setup();
  git_(repo, 'checkout', 'origin/master', '--', CONTACTS_RELATIVE_PATH);
  commitAll(repo, 'already synced');
  const gh = stubGh();
  assert.deepEqual(await syncContacts({ git: createGit(repo, { exec: gh.exec }), repoPath: repo, rebuildBranch: 'rebuild02' }), { changed: false });
  assert.equal(gh.calls.length, 0);
});

test('mergeBack refuses while contacts differ, and after a sync merges without conflict', async () => {
  const { repo } = setup();
  const gh = stubGh();
  await assert.rejects(mergeBack({ git: createGit(repo, { exec: gh.exec }), rebuildBranch: 'rebuild02', build: '74' }), /allContacts\.xml differs .* run start-build\.js sync-contacts first/);
  await syncContacts({ git: createGit(repo, { exec: gh.exec }), repoPath: repo, rebuildBranch: 'rebuild02' });
  git_(repo, 'checkout', '-q', 'rebuild02');
  git_(repo, 'merge', '-q', '--no-edit', 'origin/sync-contacts/rebuild02');
  git_(repo, 'push', '-q');
  const opened = stubGh();
  await mergeBack({ git: createGit(repo, { exec: opened.exec }), rebuildBranch: 'rebuild02', build: '74' });
  const create = opened.calls.find((a) => a[0] === 'pr' && a[1] === 'create');
  assert.deepEqual([create[3], create[5]], ['master', 'rebuild02']);
  git_(repo, 'checkout', '-q', 'master');
  git_(repo, 'merge', '-q', '--no-edit', 'origin/rebuild02');
});

test('cleanProposals deletes earlier releases\' loaded proposals only, after the merge-back', async () => {
  const { repo } = setup();
  writeFileSync(join(repo, 'NOTES'), 'a load on rebuild02\n');
  commitAll(repo, 'rebuild02 moves on');
  git_(repo, 'checkout', '-q', 'master');
  for (const acc of ['GCA_000001.1', 'PRJNA000002', 'PRJNA000003']) cpSync(join(fixtures, 'proposals', acc), join(repo, 'Proposals', acc), { recursive: true });
  const setTicket = (acc, id) => {
    const p = join(repo, 'Proposals', acc, 'manifest.json');
    writeFileSync(p, JSON.stringify({ ...JSON.parse(readFileSync(p, 'utf-8')), ticket: { system: 'github', id, url: `https://r/issues/${id}` } }, null, 2) + '\n');
  };
  setTicket('GCA_000001.1', '41'); setTicket('PRJNA000002', '42'); setTicket('PRJNA000003', '43');
  commitAll(repo, 'proposals');
  const ticket = stubTicket({ builds: { 41: '73', 42: '73', 43: '74' }, statuses: { 41: 'qa', 42: 'ready', 43: 'done' } });
  const gh = stubGh();
  await assert.rejects(cleanProposals({ git: createGit(repo, { exec: gh.exec }), ticket, rebuildBranch: 'rebuild02', build: '74' }), /origin\/rebuild02 is not merged into origin\/master yet/);
  git_(repo, 'merge', '-q', '--no-edit', 'origin/rebuild02');
  git_(repo, 'push', '-q');
  const result = await cleanProposals({ git: createGit(repo, { exec: gh.exec }), ticket, rebuildBranch: 'rebuild02', build: '74' });
  assert.deepEqual(result.removed, ['GCA_000001.1']);
  assert.equal(git_(repo, 'ls-tree', '--name-only', 'origin/clean-proposals/build-74', 'Proposals/'), 'Proposals/PRJNA000002\nProposals/PRJNA000003');
});
```

(If `stubGh` arg positions differ from `create[3]`/`create[5]`, find `--base`/`--head` by index of the flag instead.)

- [ ] **Step 2: Run** — Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

In `load-ops.js`, export `assertRebuildBranch` and `LOADED_STATUSES` (add `export`).

`shared/scripts/lib/build-start-ops.js`:

```js
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTACTS_RELATIVE_PATH } from './contacts.js';
import { proposalRelativePath } from './manifest.js';
import { assertClean, assertOnBranch } from './guards.js';
import { assertRebuildBranch, listProposals, LOADED_STATUSES } from './load-ops.js';

// Contacts are only edited on master; a rebuild branch holds a copy, so merging it back cannot conflict.
const contactsDiffer = (git, rebuildBranch) =>
  git.showFile(`origin/${rebuildBranch}`, CONTACTS_RELATIVE_PATH) !== git.showFile('origin/master', CONTACTS_RELATIVE_PATH);

/** Opens a PR copying master's allContacts.xml onto the rebuild branch, unless they already match. Returns { changed, prUrl }. */
export async function syncContacts({ git, repoPath, rebuildBranch }) {
  assertRebuildBranch(rebuildBranch);
  git.fetch();
  if (!contactsDiffer(git, rebuildBranch)) return { changed: false };
  git.checkGhAuth();
  const branch = `sync-contacts/${rebuildBranch}`;
  const open = git.findPullRequest(branch);
  if (open) return { changed: true, prUrl: open };
  assertClean(git);
  assertOnBranch(git, rebuildBranch, `git -C '${repoPath}' checkout ${rebuildBranch}`, { because: 'Contacts are synced onto the rebuild branch.' });
  if (!git.isUpToDate(rebuildBranch)) throw new Error(`${rebuildBranch} is not at origin/${rebuildBranch}; run: git -C '${repoPath}' pull`);
  git.createBranch(branch, rebuildBranch);
  writeFileSync(join(repoPath, CONTACTS_RELATIVE_PATH), git.showFile('origin/master', CONTACTS_RELATIVE_PATH));
  git.add([CONTACTS_RELATIVE_PATH]);
  git.commit(`Sync allContacts.xml from master onto ${rebuildBranch}`);
  git.push(branch);
  const prUrl = git.openPullRequest({ base: rebuildBranch, head: branch, title: `Sync contacts from master onto ${rebuildBranch}`,
    body: 'Copies master\'s allContacts.xml. Contacts are only edited on master, so this makes the merge back conflict-free.' });
  return { changed: true, prUrl };
}

/** Opens (or reports the open) PR merging the rebuild branch into master; refuses while contacts differ. Returns { prUrl }. */
export async function mergeBack({ git, rebuildBranch, build }) {
  assertRebuildBranch(rebuildBranch);
  git.fetch();
  if (contactsDiffer(git, rebuildBranch)) {
    throw new Error(`allContacts.xml differs between origin/${rebuildBranch} and origin/master; run start-build.js sync-contacts first and merge its PR`);
  }
  git.checkGhAuth();
  const prUrl = git.findPullRequest(rebuildBranch) ?? git.openPullRequest({ base: 'master', head: rebuildBranch,
    title: `Merge ${rebuildBranch} into master for build ${build}`, body: `Loaded datasets of ${rebuildBranch} back into master at the start of build ${build}.` });
  return { prUrl };
}

/**
 * After the merge-back: opens a PR on master deleting each proposal whose
 * ticket is in an earlier build and past loading. The delivery archive keeps
 * them. Returns { removed, kept: [{ accession, message }], prUrl }.
 */
export async function cleanProposals({ git, ticket, repoPath, rebuildBranch, build }) {
  assertRebuildBranch(rebuildBranch);
  git.fetch();
  if (!git.isAncestor(`origin/${rebuildBranch}`, 'origin/master')) {
    throw new Error(`origin/${rebuildBranch} is not merged into origin/master yet; run start-build.js merge-back and merge its PR first`);
  }
  const { proposals, errors } = await listProposals(git, { ticket });
  const removed = proposals
    .filter((p) => p.build !== null && Number(p.build) < Number(build) && LOADED_STATUSES.includes(p.status))
    .map((p) => p.manifest.accession)
    .sort();
  if (!removed.length) return { removed, kept: errors };
  git.checkGhAuth();
  const branch = `clean-proposals/build-${build}`;
  const open = git.findPullRequest(branch);
  if (open) return { removed, kept: errors, prUrl: open };
  assertClean(git);
  git.createBranch(branch, 'origin/master');
  for (const accession of removed) git.rm(proposalRelativePath(accession));
  git.commit(`Remove proposals loaded before build ${build}: ${removed.join(' ')}`);
  git.push(branch);
  const prUrl = git.openPullRequest({ base: 'master', head: branch, title: `Remove proposals loaded before build ${build}`,
    body: [`Each is archived in its delivery's fromProvider/proposal.`, ...removed.map((a) => `- \`${proposalRelativePath(a)}\``)].join('\n') });
  return { removed, kept: errors, prUrl };
}
```

`shared/scripts/start-build.js`:

```js
#!/usr/bin/env node
/**
 * start-build.js - The start of a website build, one step at a time; each step
 * opens a pull request for a person to merge before the next:
 *   sync-contacts     copy master's allContacts.xml onto the rebuild branch
 *   merge-back        merge the rebuild branch into master
 *   clean-proposals   delete from master the proposals loaded for earlier builds
 *
 * Usage: node start-build.js --rebuild-branch rebuildRR --build NN <step>
 */
import { parseArgs } from 'node:util';
import { openWorkspace } from './lib/config.js';
import { createGit } from './lib/git-ops.js';
import { createTicketClient } from './lib/ticket/index.js';
import { syncContacts, mergeBack, cleanProposals } from './lib/build-start-ops.js';

const USAGE = 'Usage: node start-build.js --rebuild-branch rebuildRR --build NN sync-contacts|merge-back|clean-proposals';

async function main() {
  const { values, positionals } = parseArgs({ options: { 'rebuild-branch': { type: 'string' }, build: { type: 'string' } }, allowPositionals: true });
  const [step] = positionals;
  const rebuildBranch = values['rebuild-branch'];
  if (!rebuildBranch || !values.build || positionals.length !== 1) { console.error(USAGE); process.exit(1); }
  const config = openWorkspace();
  const git = createGit(config.repoPath);
  if (step === 'sync-contacts') {
    const r = await syncContacts({ git, repoPath: config.repoPath, rebuildBranch });
    console.log(r.changed ? `Pull request: ${r.prUrl}` : `allContacts.xml already matches master on ${rebuildBranch}; nothing to do.`);
  } else if (step === 'merge-back') {
    console.log(`Pull request: ${(await mergeBack({ git, rebuildBranch, build: values.build })).prUrl}`);
  } else if (step === 'clean-proposals') {
    const r = await cleanProposals({ git, ticket: createTicketClient(config), repoPath: config.repoPath, rebuildBranch, build: values.build });
    for (const k of r.kept) console.error(`Kept ${k.accession}: ${k.message}`);
    console.log(r.removed.length ? `Removing ${r.removed.join(' ')}. Pull request: ${r.prUrl}` : 'No proposals loaded before this build remain on master.');
  } else {
    console.error(USAGE);
    process.exit(1);
  }
}

main().catch(err => { console.error(`Error: ${err.message}`); process.exit(1); });
```

- [ ] **Step 4: Run** `node --test tests/build-start-ops.test.js`, then the full suite. Expected: PASS.

- [ ] **Step 5: Wire the sync.** In `package.json` `sharedFiles`, add `"scripts/lib/build-start-ops.js": ["load-proposals"]` and `"scripts/start-build.js": ["load-proposals"]`. Run `yarn sync-shared` and `node --test tests/skill-imports.test.js` (PASS).

- [ ] **Step 6: Commit** — `git commit -m "start-build.js: sync contacts, merge back, clean earlier builds' proposals"`

---

### Task 6: Docs

**Files:** `shared/resources/proposal-workflow.md`, `skills/load-proposals/SKILL.md`, `skills/load-proposals/resources/preconditions.md`, `skills/load-proposals/resources/recovery.md`, `CLAUDE.md`

- [ ] **Step 1: `proposal-workflow.md`**
- Branch model block: `rebuild02` is cut once and kept across builds; at the start of each build it is merged into `master`.
- Phase 2: load reads the proposal from `origin/master`, renders presenter and dataset XML onto `load/<acc>` cut from `rebuild<RR>`, copies `master`'s `allContacts.xml` in the same commit, never puts the proposal on the rebuild branch, and archives it in delivery under `fromProvider/proposal/` (first organism; the others' `fromProvider` link to it).
- Replace the "Stragglers" section with "Build start": the three `start-build.js` steps and why contacts are only edited on `master`.
- "Things to know": `Proposals/` on master holds pending and recently loaded proposals until `clean-proposals`; ticket status is the truth. Remove the modify/delete merge-back bullet and the straggler wording.
- Rules: skills push only to `proposal/*`, `load/*`, `sync-contacts/*` and `clean-proposals/*`.

- [ ] **Step 2: `skills/load-proposals/SKILL.md`, `preconditions.md`, `recovery.md`**
- Remove every straggler and cherry-pick mention (Step 3 dry-run note, preconditions "Why a straggler happens", recovery's cherry-pick section).
- The proposal is read from `origin/master`; the dry run prints the same.
- Step 4 hand-off: copy delivery with `cp -a` or `rsync -a`.
- Add a "Build start" step (before Step 0) running the three `start-build.js` steps in order, each after the previous PR merged; never merge for the user.
- Preconditions: "Proposal exists" now reads `No proposal found at Proposals/<acc> on origin/master`; contacts row: checked against `origin/master`'s `allContacts.xml`.
- Recovery: a resume is recognised by the load commit at the head of `load/<acc>`.

- [ ] **Step 3: `CLAUDE.md`** git workflow line: branches `proposal/<accession>`, `load/<accession>`, `sync-contacts/rebuild<RR>`, `clean-proposals/build-<NN>`.

- [ ] **Step 4: Check** `grep -rni "straggler\|cherry" shared/resources skills/load-proposals CLAUDE.md` → nothing. Full suite PASS.

- [ ] **Step 5: Commit** — `git commit -m "Docs: load from master, archive in fromProvider, build start"`

---

### Task 7: Push and PR (controller, after John says so)

```bash
git push -u origin load-from-master
env -u GITHUB_TOKEN gh pr create --base main --title "Load from master: no proposal on the rebuild branch; build start" --body "Spec: docs/superpowers/specs/2026-10-23-load-from-master-design.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

## Effect on the verify-bulk-rnaseq plan

Plan B Task 14 (load re-runs the content validators) should call validation once in `checkLoadPreconditions`, on the `origin/master` export inside `withProposalFromRef` before `renderAndCheck`, instead of threading `validate` through `renderAndCheck`'s three former call sites. Plan B Task 10's `buildFitness` uses `pendingGenomeProposals(git, [against, 'origin/master'])`; change it to `['origin/master']` to match `settlementFor`. Update Plan B before executing it.
