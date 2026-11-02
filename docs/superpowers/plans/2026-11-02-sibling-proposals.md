# Sibling Proposals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let one study accession (e.g. BioProject PRJNA1306639) carry proposals of several dataset types, each with its own directory, branch, ticket and lifecycle.

**Architecture:** A proposal's id is its directory name under `Proposals/`: the accession, or `<accession>_<datasetType>` when the accession is taken. Every path, branch and workspace handle switches from the accession to the id; the real accession stays in the manifest and is used only where an archive id is meant (dataStaging). Proposal uniqueness is enforced on manifest content, `(datasetType, external ids)`, not on paths.

**Tech Stack:** Node 18 ESM, `node:test`, git, `gh`. Spec: `docs/superpowers/specs/2026-11-02-sibling-proposals-design.md`.

**Conventions:** Run tests with `yarn test` (all) or `node --test tests/<file>.test.js`. Edit only `shared/scripts/**`; `skills/*/scripts` are synced copies (`yarn sync-shared`, also run by the pre-commit hook). Comments are rare and short; match surrounding style. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

**Naming rule used throughout:** a function parameter that names a proposal's directory/branch is `proposalId`; `accession` means only the archive id (`manifest.accession`).

---

## File map

| File | Change |
|---|---|
| `shared/scripts/lib/manifest.js` | id rule (`siblingProposalId`, `isProposalIdFor`), `validate` dir check, helpers take `proposalId` |
| `shared/scripts/lib/proposal-ops.js` | type-scoped guard, `startProposal` resolve/allocate, `writeProposal`/`publishProposal` by id, `assertNameIsFree` per class |
| `shared/scripts/lib/load-ops.js` | `listProposals` returns `proposalId`; load functions by id |
| `shared/scripts/lib/build-start-ops.js` | `cleanProposals` removes by id |
| `shared/scripts/lib/verification-ops.js`, `merge-ops.js`, `validation-ops.js`, `validation-workspace.js` | by id |
| `shared/scripts/lib/delivery-ops.js`, `delivery.js` | delivery by id, staging by `manifest.accession` |
| `shared/scripts/*.js` CLIs | `start-proposal --type`, `write-proposal --proposal`, usage strings, `list-proposals` output |
| `skills/*/SKILL.md` (+ `resources/step-0-start-proposal.md` where present) | pass `--type`, carry `proposalId` |
| `package.json`, `.claude-plugin/plugin.json` | 2.7.0 |

---

### Task 1: The proposal id rule in manifest.js

**Files:**
- Modify: `shared/scripts/lib/manifest.js:12-14`, `:181-203`, `:289-325`
- Test: `tests/manifest.test.js`

- [ ] **Step 1: Write the failing tests**

Add to `tests/manifest.test.js`, and add `siblingProposalId, isProposalIdFor` to its import from `manifest.js`:

```js
test('a proposal id is the accession, or the accession and dataset type', () => {
  assert.equal(siblingProposalId('PRJNA123456', 'dnaseq'), 'PRJNA123456_dnaseq');
  assert.equal(isProposalIdFor('PRJNA123456', valid()), true);
  assert.equal(isProposalIdFor('PRJNA123456_bulk-rnaseq', valid()), true);
  assert.equal(isProposalIdFor('PRJNA123456_dnaseq', valid()), false);
  assert.equal(isProposalIdFor('PRJNA123456_Foxy', valid()), false);
});

test('validate accepts a sibling directory named for the dataset type, and nothing else', () => {
  assert.deepEqual(validate(valid(), { dirName: 'PRJNA123456_bulk-rnaseq' }), []);
  assert.ok(validate(valid(), { dirName: 'PRJNA123456_dnaseq' }).some(e => /does not match proposal directory "PRJNA123456_dnaseq"/.test(e)));
  assert.ok(validate(valid(), { dirName: 'PRJNA123456_Foxy' }).some(e => /directory/.test(e)));
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/manifest.test.js`
Expected: FAIL, `siblingProposalId` is not exported.

- [ ] **Step 3: Implement**

Replace `manifest.js:12-14` with:

```js
export const proposalRelativePath = (proposalId) => `${PROPOSALS_DIR}/${proposalId}`;
export const proposalBranch = (proposalId) => `proposal/${proposalId}`;
export const manifestRelativePath = (proposalId) => `${proposalRelativePath(proposalId)}/${MANIFEST_FILENAME}`;
/** The id of a proposal whose accession another dataset type's proposal already has. */
export const siblingProposalId = (accession, datasetType) => `${accession}_${datasetType}`;
export const isProposalIdFor = (proposalId, m) => proposalId === m.accession || proposalId === siblingProposalId(m.accession, m.datasetType);
```

In `validate`, change the JSDoc line `opts.dirName - proposal directory basename to compare with accession` to `opts.dirName - proposal directory basename; the accession, or siblingProposalId of it`, and replace:

```js
    if (dirName && dirName !== m.accession) {
```

with:

```js
    if (dirName && !isProposalIdFor(dirName, m)) {
```

In `readOnRef` and `readTicketOnRef`, rename the parameter `accession` to `proposalId` (including `dirName: proposalId`), and in their JSDoc write `Proposals/<proposalId>`.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/manifest.test.js`
Expected: PASS, including the existing `accession must match the directory name when given`.

- [ ] **Step 5: Commit**

```bash
git add shared/scripts/lib/manifest.js tests/manifest.test.js
git commit -m "Proposal id: the accession, or the accession and dataset type"
```

---

### Task 2: The guard refuses only a proposal of the same type

**Files:**
- Modify: `shared/scripts/lib/proposal-ops.js:36-61` (`manifestOn`, `assertNoOtherProposalFor`) and its two callers (`startProposal`, `publishProposal`)
- Test: `tests/proposal-ops.test.js`

- [ ] **Step 1: Write the failing tests**

Add after `startProposal allows an update of the same accession whatever it records` in `tests/proposal-ops.test.js`:

```js
test('startProposal allows another dataset type for a BioProject a proposal already covers', async () => {
  const { repo } = setupRepo();
  plantProposalOnMaster(repo, { ...rnaPlanted('PRJNA000002', { bioproject: 'PRJNA000002' }), ticket: TICKET });
  const result = await startProposal({ git: createGit(repo), ticket: stubTicket(), accession: 'PRJNA000002', datasetType: 'dnaseq', externalIds: { bioproject: 'PRJNA000002' } });
  assert.deepEqual(result, { mode: 'new', proposalId: 'PRJNA000002_dnaseq' });
});

test('startProposal refuses a same-type proposal under another accession, naming how to update it', async () => {
  const { repo } = setupRepo();
  plantProposalOnMaster(repo, rnaPlanted('PRJNA000002', { bioproject: 'PRJNA000002', geo: 'GSE0002' }));
  await assert.rejects(
    startProposal({ git: createGit(repo), ticket: stubTicket(), accession: 'GSE0002', datasetType: 'bulk-rnaseq', externalIds: { geo: 'GSE0002', bioproject: 'PRJNA000002' } }),
    /already covers (GSE0002|PRJNA000002)[\s\S]*start-proposal\.js PRJNA000002 --type bulk-rnaseq/
  );
});

test('startProposal treats a proposal branch with no manifest yet as any type', async () => {
  const { root, repo, bare } = setupRepo();
  const other = otherClone(root, bare);
  execFileSync('git', ['-C', other, 'checkout', '-q', '-b', 'proposal/PRJNA000002_chipseq']);
  execFileSync('git', ['-C', other, 'push', '-q', '-u', 'origin', 'proposal/PRJNA000002_chipseq']);
  await assert.rejects(
    startProposal({ git: createGit(repo), ticket: stubTicket(), accession: 'GSE0002', datasetType: 'chipseq', externalIds: { geo: 'GSE0002', bioproject: 'PRJNA000002' } }),
    /Proposal PRJNA000002_chipseq \(origin\/proposal\/PRJNA000002_chipseq\) already covers PRJNA000002/
  );
});
```

Every existing `startProposal({...})` call in the tests now needs a `datasetType`. Add it with:

```bash
perl -0pi -e "s/(startProposal\(\{[^}]*?accession: '([^']+)')/\$1 . ', datasetType: ' . (\$2 =~ \/^GC[AF]_\/ ? \"'genome-assembly'\" : \"'bulk-rnaseq'\")/ge" tests/*.test.js
grep -n "startProposal({" tests/*.test.js | grep -v datasetType
```

Expected: the grep prints nothing (the three new tests already carry `datasetType`; check that none got a second one: `grep -c "datasetType: '[^']*', datasetType" tests/proposal-ops.test.js` prints `0`).

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/proposal-ops.test.js`
Expected: the first new test FAILs with `already covers PRJNA000002`; the second with a message not naming `--type`.

- [ ] **Step 3: Implement the guard**

Replace `assertNoOtherProposalFor` in `proposal-ops.js` with:

```js
/**
 * Refuses when another proposal of datasetType already covers one of ids: a
 * proposal branch named for one of them, or a manifest recording one, on
 * origin/master or on another proposal branch on origin. A branch with no
 * manifest yet counts as every type. Call after git.fetch().
 */
export function assertNoOtherProposalFor(git, proposalId, datasetType, ids) {
  const covering = (other, where, ref) => {
    const m = ref ? manifestOn(git, ref, other) : null;
    if (m && m.datasetType !== datasetType) return;
    const named = ids.find((id) => other === id || other === siblingProposalId(id, datasetType));
    const shared = named ?? idsOf(m ?? {}).find((id) => ids.includes(id));
    if (shared) throw new Error(`Proposal ${other} (${where}) already covers ${shared}. Propose under it instead: node scripts/start-proposal.js ${m?.accession ?? shared} --type ${datasetType}`);
  };
  for (const id of ids) {
    for (const other of [id, siblingProposalId(id, datasetType)]) {
      if (other !== proposalId && git.branchExists(proposalBranch(other))) covering(other, `branch ${proposalBranch(other)} here`, null);
    }
  }
  for (const other of git.listDir('origin/master', PROPOSALS_DIR)) {
    if (other !== proposalId) covering(other, 'origin/master', 'origin/master');
  }
  for (const branch of git.remoteBranches(proposalBranch(''))) {
    const other = branch.slice(proposalBranch('').length);
    if (other !== proposalId) covering(other, `origin/${branch}`, `origin/${branch}`);
  }
}
```

Note the old code looked a local branch's manifest up on a non-ref string (`branch proposal/X here`), which always failed and read as "no manifest"; passing `ref: null` keeps that behaviour explicitly.

Add `siblingProposalId` to the import from `./manifest.js` at the top of `proposal-ops.js`.

Update the two callers:
- In `startProposal`: `assertNoOtherProposalFor(git, proposalId, datasetType, idsOf({ accession, externalIds }))` (Task 3 introduces `proposalId` and `datasetType` there; until then pass `accession, datasetType`).
- In `publishProposal`: `assertNoOtherProposalFor(git, proposalId, manifest.datasetType, idsOf(manifest))` (Task 4 renames its parameter; until then `accession`).

- [ ] **Step 4: Run to verify the guard tests pass**

Run: `node --test tests/proposal-ops.test.js`
Expected: the second and third new tests PASS. The first still FAILs on `proposalId` until Task 3. The pre-existing guard tests at "refuses when a proposal on master already records one of the external ids" now need `--type bulk-rnaseq` in their expected message: change `start-proposal\.js PRJNA000002/` to `start-proposal\.js PRJNA000002 --type bulk-rnaseq/`.

- [ ] **Step 5: Commit**

```bash
git add shared/scripts/lib/proposal-ops.js tests/
git commit -m "The other-proposal guard refuses only the same dataset type"
```

---

### Task 3: startProposal resolves or allocates the proposal id

**Files:**
- Modify: `shared/scripts/lib/proposal-ops.js:63-104` (`startProposal`)
- Test: `tests/proposal-ops.test.js`

- [ ] **Step 1: Write the failing tests**

```js
test('startProposal resolves an existing sibling to its id and allocates the accession when free', async () => {
  const { repo } = setupRepo();
  const fresh = await startProposal({ git: createGit(repo), ticket: stubTicket(), accession: 'PRJNA000002', datasetType: 'dnaseq' });
  assert.deepEqual(fresh, { mode: 'new', proposalId: 'PRJNA000002' });

  const { repo: repo2 } = setupRepo();
  plantProposalOnMaster(repo2, { ...rnaPlanted('PRJNA000002', { bioproject: 'PRJNA000002' }), ticket: TICKET });
  plantProposalOnMaster(repo2, { ...rnaPlanted('PRJNA000002', { bioproject: 'PRJNA000002' }), datasetType: 'chipseq', ticket: { ...TICKET, id: '43', url: 'https://r/issues/43' } }, 'PRJNA000002_chipseq');
  const update = await startProposal({ git: createGit(repo2), ticket: stubTicket({ status: 'proposed' }), accession: 'PRJNA000002', datasetType: 'chipseq' });
  assert.equal(update.mode, 'update');
  assert.equal(update.proposalId, 'PRJNA000002_chipseq');
  assert.equal(update.existingTicket.id, '43');
  assert.equal(createGit(repo2).currentBranch(), 'proposal/PRJNA000002_chipseq');
});

test('startProposal allocates the sibling id while the accession is only a branch on origin', async () => {
  const { root, repo, bare } = setupRepo();
  const other = otherClone(root, bare);
  execFileSync('git', ['-C', other, 'checkout', '-q', '-b', 'proposal/PRJNA000002']);
  execFileSync('git', ['-C', other, 'push', '-q', '-u', 'origin', 'proposal/PRJNA000002']);
  plantProposalOnMaster(other, rnaPlanted('PRJNA000002', { bioproject: 'PRJNA000002' }));
  const result = await startProposal({ git: createGit(repo), ticket: stubTicket(), accession: 'PRJNA000002', datasetType: 'dnaseq' });
  assert.deepEqual(result, { mode: 'new', proposalId: 'PRJNA000002_dnaseq' });
});
```

(`plantProposalOnMaster` commits and runs a bare `git push`, so the branch needs its upstream first.)

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/proposal-ops.test.js`
Expected: FAIL, the result has no `proposalId`.

- [ ] **Step 3: Implement**

Add above `startProposal`:

```js
/** The id of the proposal of accession and datasetType on origin/master or its branch on origin, or null. */
function existingProposalId(git, accession, datasetType) {
  const isIt = (m) => m?.accession === accession && m?.datasetType === datasetType;
  return [accession, siblingProposalId(accession, datasetType)].find((id) =>
    isIt(manifestOn(git, 'origin/master', id)) ||
    (git.remoteBranchExists(proposalBranch(id)) && isIt(manifestOn(git, `origin/${proposalBranch(id)}`, id)))) ?? null;
}

/** The accession, unless a proposal of another type has it on master or as a branch here or on origin. */
function newProposalId(git, accession, datasetType) {
  const taken = git.listDir('origin/master', PROPOSALS_DIR).includes(accession) ||
    git.branchExists(proposalBranch(accession)) || git.remoteBranchExists(proposalBranch(accession));
  return taken ? siblingProposalId(accession, datasetType) : accession;
}
```

Replace `startProposal` with:

```js
/**
 * Verifies the checkout is on a clean, current master, finds the proposal of
 * accession and datasetType or allocates its id, checks no proposal branch
 * for that id is here or on origin and no other proposal of the type covers
 * one of externalIds; if the proposal is on origin/master, consults its
 * ticket. Creates proposal/<proposalId>.
 * Returns { mode: 'new', proposalId } or { mode: 'update', proposalId, existingTicket }.
 */
export async function startProposal({ git, ticket, accession, datasetType, externalIds = {}, forceUpdate = false }) {
  if (!datasetType) throw new Error('startProposal needs the dataset type');
  git.fetch();

  assertOnBranch(git, 'master', `git -C '${git.repoPath}' checkout master`);
  assertClean(git);
  if (!git.isUpToDate('master')) {
    throw new Error(`master is behind origin/master; run: git -C '${git.repoPath}' pull`);
  }
  const proposalId = existingProposalId(git, accession, datasetType) ?? newProposalId(git, accession, datasetType);
  const branch = proposalBranch(proposalId);
  if (git.branchExists(branch)) {
    throw new Error(`Branch ${branch} already exists here. Delete it to start over:\n  git -C '${git.repoPath}' branch -D ${branch}`);
  }
  if (git.remoteBranchExists(branch)) {
    throw new Error(`Branch ${branch} already exists on origin. Delete it to start over:\n  git -C '${git.repoPath}' push origin --delete ${branch}`);
  }
  assertNoOtherProposalFor(git, proposalId, datasetType, idsOf({ accession, externalIds }));

  let result = { mode: 'new', proposalId };
  const existing = readTicketOnRef(git, 'origin/master', proposalId);
  if (existing.exists) {
    if (existing.ticket) {
      const status = await ticket.getStatus(existing.ticket);
      if (!UPDATABLE_STATUSES.includes(status)) {
        throw new Error(`Proposal ${proposalId} exists and its ticket ${existing.ticket.url} status is "${status}". Only a ${UPDATABLE_STATUSES.slice(0, -1).join(', ')} or ${UPDATABLE_STATUSES.at(-1)} ticket can be updated.`);
      }
    } else if (!forceUpdate) {
      throw new Error(`Proposal ${proposalId} exists on master but its manifest has no ticket, so its status cannot be checked. Add the ticket to ${manifestRelativePath(proposalId)} on master, or re-run with --force-update to treat it as proposed.`);
    }
    result = { mode: 'update', proposalId, existingTicket: existing.ticket };
  }

  git.createBranch(branch, 'master');
  return result;
}
```

Add `manifestRelativePath` to the `./manifest.js` import if it is not already there. Rename `assertOnProposalBranch`'s parameter to `proposalId` and `manifestOn`'s to `proposalId`.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/proposal-ops.test.js`
Expected: PASS, including Task 2's first test. Existing tests asserting `result.mode` still pass; any `assert.deepEqual(result, { mode: 'new' })` must gain `proposalId`.

- [ ] **Step 5: Commit**

```bash
git add shared/scripts/lib/proposal-ops.js tests/proposal-ops.test.js
git commit -m "startProposal resolves an existing sibling or allocates its id"
```

---

### Task 4: writeProposal and publishProposal by id; experiment names per class

**Files:**
- Modify: `shared/scripts/lib/proposal-ops.js` (`assertNameIsFree` :138-160, `writeProposal` :281-395, `publishProposal` :404-517)
- Test: `tests/proposal-ops.test.js`

- [ ] **Step 1: Write the failing tests**

```js
test('writeProposal allows a sibling of another dataset class to use the same name', async () => {
  const { repo, root } = setupRepo();
  plantProposalOnMaster(repo, { ...plantedManifest, accession: 'PRJNA000003', datasetType: 'chipseq',
    organisms: loaded('tfakST1'),
    datasetClass: 'chipSeqExperiment', name: 'Doe_cold_shock_2024', version: '2024-05-01' });
  const git = createGit(repo);
  const { proposalId } = await startProposal({ git, ticket: stubTicket(), accession: 'PRJNA000003', datasetType: 'bulk-rnaseq' });
  assert.equal(proposalId, 'PRJNA000003_bulk-rnaseq');
  const { dir, manifest } = await writeProposal({
    rebuildBranch: REBUILD, git, repoPath: repo, proposalId, manifestInput: rnaManifestInput, curator: 'someone@apidb.org', ...rnaFiles(root, coldShock)
  });
  assert.equal(dir, join(repo, 'Proposals/PRJNA000003_bulk-rnaseq'));
  assert.equal(manifest.accession, 'PRJNA000003');
});

test('publishProposal titles the ticket with the proposal id', async () => {
  const { repo, root } = setupRepo();
  plantProposalOnMaster(repo, { ...plantedManifest, accession: 'PRJNA000003', datasetType: 'chipseq', organisms: loaded('tfakST1'), ticket: TICKET });
  const gh = stubGh();
  const git = createGit(repo, { exec: gh.exec });
  const { proposalId } = await startProposal({ git, ticket: stubTicket(), accession: 'PRJNA000003', datasetType: 'bulk-rnaseq' });
  await writeProposal({ rebuildBranch: REBUILD, git, repoPath: repo, proposalId, manifestInput: rnaManifestInput, curator: 'someone@apidb.org', ...rnaFiles(root, coldShock) });
  const ticket = stubTicket();
  await publishProposal({ git, ticket, repoPath: repo, proposalId, build: '02' });
  assert.match(ticket.calls[0][1], /^\[FungiDB\] PRJNA000003_bulk-rnaseq /);
  assert.match(ticket.calls[0][2], /^Proposal: `Proposals\/PRJNA000003_bulk-rnaseq`$/m);
});
```

`rnaManifestInput` (`tests/proposal-ops.test.js:417`) has accession `PRJNA000003`. The ticket stub records `create` as `['create', title, body, build, ...]`, as the existing publish test reads `calls[0][2]` (body) and `calls[0][3]` (build).

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/proposal-ops.test.js`
Expected: the first FAILs with `already uses the name "Doe_cold_shock_2024"`; the second with a `proposalId` / title mismatch.

- [ ] **Step 3: Implement**

`assertNameIsFree(git, rebuildRef, m, type, proposalId)`: skip the proposal itself by id and compare names within the class only:

```js
  for (const other of git.listDir('origin/master', PROPOSALS_DIR)) {
    if (other === proposalId) continue;
    let theirs;
    try { theirs = JSON.parse(git.showFile('origin/master', `${proposalRelativePath(other)}/${MANIFEST_FILENAME}`)); }
    catch { continue; }
    if (theirs.datasetClass !== m.datasetClass) continue;
    const shared = theirs.name === m.name && organisms.find((organism) => organismsIn(theirs).includes(organism));
    if (shared) {
      throw new Error(`Proposal ${other} on master already uses the name "${m.name}" for ${shared}; ${CHOOSE_NAME}`);
    }
    const across = usesNamePattern(type) && typeof theirs.name === 'string' && patternMatchWith(type, m, theirs);
    if (across) throw new Error(`Proposal ${other} on master ${across}; ${CHOOSE_NAME}`);
  }
```

`writeProposal({ ..., proposalId = manifestInput.accession, ... })`:
- `const accession = manifestInput.accession;` stays (it goes into the manifest).
- `assertOnProposalBranch(git, proposalId, \`node scripts/start-proposal.js ${accession} --type ${manifestInput.datasetType}\`)`.
- `const dir = join(repoPath, PROPOSALS_DIR, proposalId);`
- `readTicketOnRef(git, 'origin/master', proposalId)` and `manifestOn(git, 'origin/master', proposalId)`.
- `validate(manifest, { dirName: proposalId, contactIds, unplacedOk: true })`.
- `const staged = join(staging, proposalId);`
- `` `presenter for ${proposalId} ...` `` in the `assertValidPresenter` message.
- `assertNameIsFree(git, rebuildRef, full, datasetType, proposalId);`
- Update the JSDoc first line to `Writes Proposals/<proposalId>/ ...` and add `proposalId defaults to the accession.`

`publishProposal({ git, ticket, repoPath, proposalId, build })`: rename the parameter, and every `accession` in its body to `proposalId`, except:
- the title: `` const title = `[${projects}] ${proposalId} ${organisms}`; `` (this is the change; keep the comment above it),
- the "Nothing to publish" hint: `node scripts/write-proposal.js --proposal ${proposalId} --accession ${manifest.accession} ...`.

- [ ] **Step 4: Update callers of writeProposal/publishProposal in tests**

```bash
perl -0pi -e 's/(publishProposal\(\{[^}]*?)\baccession:/$1proposalId:/g' tests/*.test.js
grep -n "publishProposal({" tests/*.test.js | grep accession
```

Expected: the grep prints nothing.

- [ ] **Step 5: Run to verify**

Run: `node --test tests/proposal-ops.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add shared/scripts/lib/proposal-ops.js tests/
git commit -m "Write and publish proposals by id; experiment names clash only within a class"
```

---

### Task 5: Listing and cleanup by id

**Files:**
- Modify: `shared/scripts/lib/load-ops.js:36-60` (`listProposals`), `shared/scripts/lib/build-start-ops.js:56-90` (`cleanProposals`), `shared/scripts/list-proposals.js:30,38`, `shared/scripts/start-build.js:49-52`, `shared/scripts/lib/validation-workspace.js:318` (`removeDeliveries`)
- Test: `tests/load-ops.test.js`, `tests/build-start-ops.test.js`

- [ ] **Step 1: Write the failing tests**

In `tests/load-ops.test.js`, extend `listProposals reads manifests on origin/master and filters by the ticket build` with:

```js
  assert.deepEqual(all.proposals.map(p => p.proposalId).sort(), ['GCA_000001.1', 'PRJNA000002']);
```

In `tests/build-start-ops.test.js`, add:

```js
test('cleanProposals removes a loaded sibling by its id and keeps the other', async (t) => {
  const { repo } = setupProposals(t);
  const sib = join(repo, 'Proposals', 'PRJNA000002_chipseq');
  cpSync(join(repo, 'Proposals', 'PRJNA000002'), sib, { recursive: true });
  const p = join(sib, 'manifest.json');
  writeFileSync(p, JSON.stringify({ ...JSON.parse(readFileSync(p, 'utf-8')), datasetType: 'chipseq', ticket: { system: 'github', id: '44', url: 'https://r/issues/44' } }, null, 2) + '\n');
  commitAll(repo, 'a sibling');
  mergeBackDone(repo);
  const ticket = stubTicket({ builds: { 41: '74', 42: '74', 43: '74', 44: '73' }, statuses: { 44: 'qa' } });
  const gh = stubGh();
  const result = await cleanProposals({ git: createGit(repo, { exec: gh.exec }), ticket, rebuildBranch: 'rebuild02', build: '74' });
  assert.deepEqual(result.removed, ['PRJNA000002_chipseq']);
  assert.equal(git_(repo, 'ls-tree', '--name-only', 'origin/clean-proposals/build-74', 'Proposals/'), 'Proposals/GCA_000001.1\nProposals/PRJNA000002\nProposals/PRJNA000003');
});
```

In the existing `cleanProposals deletes earlier releases' loaded proposals only...` test, change `/fromProvider\/<accession>/` to `/fromProvider\/<proposal id>/`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/load-ops.test.js tests/build-start-ops.test.js`
Expected: FAIL; the cleanup removes `PRJNA000002` (the sibling's accession), not `PRJNA000002_chipseq`.

- [ ] **Step 3: Implement**

`listProposals`: loop variable `proposalId`; push `{ proposalId, manifest, build: found, status: current }`; errors `{ proposalId, message }`; JSDoc `Returns { proposals: [{ proposalId, manifest, build, status }], errors: [{ proposalId, message }] }`.

`cleanProposals`: `.map((p) => p.proposalId)`, loop variable `proposalId`, `kept` entries carry `proposalId` (they are `errors`), JSDoc and PR body: `'Each is archived in its delivery\'s fromProvider/<proposal id>.'`.

`removeDeliveries({ root, proposalIds })`: rename the key and loop variable.

`start-build.js`: `const removeDelivery = (proposalIds) => removeDeliveries({ root: values.workspace, proposalIds });` and `` console.error(`Kept ${k.proposalId}: ${k.message}`) ``.

`list-proposals.js:30`: print `[p.proposalId, p.manifest.accession, ...]`. Read lines 20-40 first: `p` there may be the manifest; if so, iterate the `{ proposalId, manifest }` entries and keep the remaining columns reading from `manifest`. Line 38: `e.proposalId`. Update its header comment's column list to name `proposal id, accession` first.

Also `check-organisms.js:26,30` prints `r.accession`/`e.accession` from `checkOrganisms` (Task 8 makes those `proposalId`); update them there.

- [ ] **Step 4: Run to verify**

Run: `node --test tests/load-ops.test.js tests/build-start-ops.test.js tests/validation-workspace.test.js`
Expected: PASS. Fix any `removeDeliveries({ ..., accessions })` call in `tests/validation-workspace.test.js` to `proposalIds`.

- [ ] **Step 5: Commit**

```bash
git add shared/scripts tests
git commit -m "List and clean up proposals by id"
```

---

### Task 6: Verification, validation and merge by id

**Files:**
- Modify: `shared/scripts/lib/verification-ops.js`, `merge-ops.js`, `validation-ops.js`, `validation-workspace.js`; CLIs `start-verification.js`, `validate-proposal.js`, `mark-ready.js`, `request-revision.js`, `merge-proposal.js`
- Test: `tests/proposal-ops.test.js` plus callers in `tests/validation-ops.test.js`, `tests/validation-workspace.test.js`

- [ ] **Step 1: Write the failing test**

Add after the startVerification tests in `tests/proposal-ops.test.js`:

```js
test('startVerification claims a sibling proposal by its id', async () => {
  const { repo } = setupRepo();
  plantProposalOnMaster(repo, { ...rnaPlanted('PRJNA000002', { bioproject: 'PRJNA000002' }), ticket: TICKET }, 'PRJNA000002_bulk-rnaseq');
  const ticket = stubTicket({ status: 'proposed' });
  const result = await startVerification({ git: createGit(repo, { exec: stubGh().exec }), ticket, proposalId: 'PRJNA000002_bulk-rnaseq' });
  assert.equal(result.status, 'verifying');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/proposal-ops.test.js`
Expected: FAIL, `Proposal undefined is not on origin/master`.

- [ ] **Step 3: Rename `accession` to `proposalId`**

In each function below, rename the parameter (or destructured key) `accession` to `proposalId` and every use in its body; messages that say "Proposal X"/"verify X" now print the id:

- `verification-ops.js`: `resolveDraft`, `requestRevision`, `verifiableTicket`, `startVerification`, `currentReport`, `currentDelivery`, `markReady`. At line ~168 the hand-cleanup hint must read `branch -D ${verifyBranch(proposalId)}` (import `verifyBranch` from `./validation-workspace.js`).
- `merge-ops.js`: `mergeProposal`.
- `validation-ops.js`: `reportPath(repoPath, proposalId)`, `validateProposal`. The report keeps `accession: manifest.accession` and gains `proposalId` right after it: `schemaVersion: REPORT_SCHEMA_VERSION, accession: manifest.accession, proposalId, datasetType: ...`. In `lib/validation.js:42` print `report.proposalId ?? report.accession`.
- `validation-workspace.js`: `verifyBranch`, `openVerifyWorkspace`, `verifyWorkspaceDisposal`, `openDeliveryDir`, `deliveryReader`; rename `badAccession` to `badProposalId` and its message to `proposal id "${proposalId}" must be a plain directory name`; JSDoc `proposals/<proposalId>/`, `delivery/<proposalId>/`.
- CLIs: positional `<accession>` becomes `<proposal>` in usage strings and the variable is `proposalId`; pass `proposalId` to the lib functions. `mark-ready.js` passes `proposalId` to `verifyWorkspaceDisposal`, `deliveryReader`, `markReady`.

Update test callers:

```bash
perl -0pi -e 's/(\b(?:startVerification|markReady|requestRevision|mergeProposal|validateProposal|openVerifyWorkspace|verifyWorkspaceDisposal|openDeliveryDir|deliveryReader)\(\{[^}]*?)\baccession:/$1proposalId:/g' tests/*.test.js tests/helpers.js
grep -nE "(startVerification|markReady|requestRevision|mergeProposal|validateProposal|openVerifyWorkspace|verifyWorkspaceDisposal|openDeliveryDir|deliveryReader)\(\{[^}]*accession:" tests/*.test.js tests/helpers.js
```

Expected: the grep prints nothing. Calls spanning a nested `{` before `accession:` are not caught; the test run in Step 4 finds them as `undefined` ids.

- [ ] **Step 4: Run to verify**

Run: `yarn test`
Expected: PASS, apart from delivery and load tests still on `accession` (Tasks 7 and 8).

- [ ] **Step 5: Commit**

```bash
git add shared/scripts tests
git commit -m "Verify, validate and merge proposals by id"
```

---

### Task 7: Delivery by id, staging by accession

**Files:**
- Modify: `shared/scripts/lib/delivery-ops.js`, `shared/scripts/lib/delivery.js:77-93`, `shared/scripts/prepare-delivery.js`
- Test: `tests/delivery-ops.test.js`, `tests/delivery.test.js`, `tests/delivery-roundtrip.test.js`

- [ ] **Step 1: Write the failing test**

In `tests/delivery-ops.test.js`, give `setup` a `proposalId = 'PRJNA000002'` option: use it for `join(repo, 'Proposals', proposalId)`, the commit message, and the report's `proposalTree` path (`` `Proposals/${proposalId}` ``), and return it. Change `prepare` to pass `proposalId: s.proposalId`. Then add:

```js
test('a sibling proposal is delivered under its id from its accession\'s staging', async () => {
  const s = setup({ proposalId: 'PRJNA000002_bulk-rnaseq', staging: [{ path: 'big.gff3' }] });
  mkdirSync(join(s.hosts, 'dataStaging/PRJNA000002'), { recursive: true });
  writeFileSync(join(s.hosts, 'dataStaging/PRJNA000002/big.gff3'), 'gff');
  const { dir, record } = await prepare(s);
  assert.equal(dir, join(s.typeDir, 'delivery/PRJNA000002_bulk-rnaseq'));
  assert.equal(record.staging.path, join(s.hosts, 'dataStaging/PRJNA000002'));
  assert.equal(record.accession, 'PRJNA000002');
  assert.equal(record.proposalId, 'PRJNA000002_bulk-rnaseq');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/delivery-ops.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement**

`prepareDelivery({ ..., proposalId, ... })`: rename the parameter and its uses, except:
- staging is the archive's: `stagingSource({ remote: stagingRemote, staging, accession: manifest.accession, proposalId })` and `pullStaging({ ..., accession: manifest.accession, ... })`;
- `stagingSource` checks the collision against the proposal copy's name: `if (top.includes(proposalId)) throw new Error(\`dataStaging/${accession} has an entry named ${proposalId}, which would collide with the proposal copy in fromProvider/\`);`
- the record: `schemaVersion: DELIVERY_SCHEMA_VERSION, accession: manifest.accession, proposalId, datasetType: ...`;
- `writeDeliveryTree({ ..., proposalId, ... })`.

`delivery.js` `writeDeliveryTree({ dir, finals, files, proposalDir, proposalId, stagingDir, record })`: copy to `join(next, home, proposalId)`; JSDoc `(as <proposalId>/)`.

`prepare-delivery.js`: positional `<proposal>`, passes `proposalId`.

Tests: `tests/delivery.test.js:20` change `accession: 'PRJNA1'` to `proposalId: 'PRJNA1'`; apply the same to any `writeDeliveryTree`/`prepareDelivery` call in `tests/delivery-roundtrip.test.js`:

```bash
perl -0pi -e 's/(\b(?:prepareDelivery|writeDeliveryTree)\(\{[^}]*?)\baccession:/$1proposalId:/g' tests/*.test.js
```

- [ ] **Step 4: Run to verify**

Run: `node --test tests/delivery-ops.test.js tests/delivery.test.js tests/delivery-roundtrip.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/scripts tests
git commit -m "Deliver proposals by id from their accession's staging"
```

---

### Task 8: Loading by id

**Files:**
- Modify: `shared/scripts/lib/load-ops.js`, `shared/scripts/load-proposal.js`, `shared/scripts/mark-loaded.js`, `shared/scripts/check-organisms.js`
- Test: `tests/load-ops.test.js`

- [ ] **Step 1: Write the failing test**

Using the existing load test setup in `tests/load-ops.test.js` (find the test that loads `PRJNA000002` and asserts the load commit subject), add a variant that first moves the proposal on master to its sibling id and loads it by that id:

Modelled on `the milestone is the release, not the branch: a build 03 proposal dry-runs on rebuild02`:

```js
test('a sibling proposal dry-runs by its id', async () => {
  const { repo } = setupRepo();
  editOnMaster(repo, () => {
    execFileSync('git', ['-C', repo, 'mv', 'Proposals/PRJNA000002', 'Proposals/PRJNA000002_bulk-rnaseq']);
  }, 'PRJNA000002 as a sibling');
  const pre = await checkLoadPreconditions({ git: createGit(repo), ticket: tickets(), repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, proposalId: 'PRJNA000002_bulk-rnaseq', dryRun: true });
  assert.equal(pre.branch, 'load/PRJNA000002_bulk-rnaseq');
  assert.equal(pre.manifest.accession, 'PRJNA000002');
  const result = await loadProposal({ git: createGit(repo), ticket: tickets(), repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, proposalId: 'PRJNA000002_bulk-rnaseq', dryRun: true });
  assert.equal(result.dryRun, true);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/load-ops.test.js`
Expected: FAIL, `No proposal found at Proposals/undefined`.

- [ ] **Step 3: Implement**

In `load-ops.js` rename `accession` to `proposalId` in `loadBranch`, `checkLoadPreconditions`, `isResume`, `dirtyTreeMessage`, `recoveryFooter`, `loadProposal`, `markLoaded`. That covers the load commit subject (`` `Load ${proposalId}: ...` ``), its resume check (`subject.startsWith(\`Load ${proposalId}: \`)`), the PR title and `markLoaded`'s lookups. The "Check the accession" hint at line ~97 becomes "Check the proposal id".

Messages that tell the user what to run next must name the id, not `manifest.accession`. The functions at lines ~205-260 (`assertDeliveryCurrent`-style checks that build `again` and `--settle` hints) receive the manifest only; add a `proposalId` parameter to each and pass it from `checkLoadPreconditions`. Leave `manifest.accession` where it only labels the dataset in an error (`Validation of ...`, `Settlement of ...`) and the scratch dir at line ~263, which `validate` accepts because the accession is always a valid directory name.

`checkOrganisms` (the listing at ~184-191): results carry `proposalId` from `listProposals`' entries instead of `manifest.accession`; update `check-organisms.js` to print `r.proposalId`/`e.proposalId`.

CLIs: `load-proposal.js` and `mark-loaded.js` take `<proposal>` and pass `proposalId`.

Update test callers:

```bash
perl -0pi -e 's/(\b(?:checkLoadPreconditions|loadProposal|markLoaded)\(\{[^}]*?)\baccession:/$1proposalId:/g' tests/*.test.js
```

- [ ] **Step 4: Run to verify**

Run: `yarn test`
Expected: PASS, whole suite.

- [ ] **Step 5: Commit**

```bash
git add shared/scripts tests
git commit -m "Load proposals by id"
```

---

### Task 9: start-proposal and write-proposal CLIs

**Files:**
- Modify: `shared/scripts/start-proposal.js`, `shared/scripts/write-proposal.js`

- [ ] **Step 1: start-proposal.js**

```js
#!/usr/bin/env node
/**
 * start-proposal.js - Checks preconditions, finds or allocates the proposal id
 * for the accession and dataset type, and creates proposal/<proposalId>.
 *
 * Usage: node start-proposal.js <accession> --type <datasetType> [--external-id kind=id ...] [--force-update]
 * Prints JSON: { "mode": "new", "proposalId": "..." } or { "mode": "update", "proposalId": "...", "existingTicket": {...} }
 */
import { parseArgs } from 'node:util';
import { openWorkspace } from './lib/config.js';
import { createGit } from './lib/git-ops.js';
import { createTicketClient } from './lib/ticket/index.js';
import { startProposal } from './lib/proposal-ops.js';
import { parseExternalIds } from './lib/manifest.js';

const USAGE = 'Usage: node start-proposal.js <accession> --type <datasetType> [--external-id kind=id ...] [--force-update]';

async function main() {
  const { values, positionals } = parseArgs({
    options: {
      type: { type: 'string' },
      'force-update': { type: 'boolean', default: false },
      'external-id': { type: 'string', multiple: true, default: [] }
    },
    allowPositionals: true
  });
  const [accession] = positionals;
  if (!accession || !values.type) { console.error(USAGE); process.exit(1); }
  const externalIds = parseExternalIds(values['external-id'], accession);
  const config = openWorkspace();
  const git = createGit(config.repoPath);
  const ticket = createTicketClient(config);
  const result = await startProposal({ git, ticket, accession, datasetType: values.type, externalIds, forceUpdate: values['force-update'] });
  console.log(JSON.stringify(result, null, 2));
  console.error(`On branch proposal/${result.proposalId} (${result.mode})`);
}

main().catch(err => { console.error(`Error: ${err.message}`); process.exit(1); });
```

- [ ] **Step 2: write-proposal.js**

- Header: `write-proposal.js - Writes Proposals/<proposalId>/ in VEuPathDatasets.` and in the usage add `[--proposal <id>]` after `--accession GCA_1.1`, with a line: `--proposal is the id start-proposal.js printed; it defaults to the accession.`
- Options: add `proposal: { type: 'string' },`.
- Call: `writeProposal({ git, repoPath: config.repoPath, proposalId: values.proposal ?? values.accession, ... })`.

- [ ] **Step 3: Remaining usage strings**

`publish-proposal.js`, `merge-proposal.js`, `start-verification.js`, `validate-proposal.js`, `prepare-delivery.js`, `mark-ready.js`, `request-revision.js`, `load-proposal.js`, `mark-loaded.js`: replace `<accession>` with `<proposal>` in the header comment and usage string, and pass `proposalId` (Tasks 4 and 6-8 changed the libs; this step catches any script those tasks missed):

```bash
grep -n "<accession>" shared/scripts/{publish-proposal,merge-proposal,start-verification,validate-proposal,prepare-delivery,mark-ready,request-revision,load-proposal,mark-loaded}.js
```

Expected after editing: no output.

- [ ] **Step 4: Smoke-check usage**

Run: `node shared/scripts/start-proposal.js PRJNA1; echo "exit $?"`
Expected: the usage line naming `--type`, `exit 1`.

- [ ] **Step 5: Run the suite and commit**

```bash
yarn test
git add shared/scripts
git commit -m "start-proposal requires --type and prints the proposal id; scripts take <proposal>"
```

---

### Task 10: Skills

**Files:**
- Modify: `skills/propose-genome-assembly/SKILL.md`, `skills/propose-bulk-rnaseq/SKILL.md`, `skills/propose-dnaseq/SKILL.md`, `skills/propose-chipseq/SKILL.md`, `skills/verify-bulk-rnaseq/SKILL.md`, `skills/load-proposals/SKILL.md`, and each skill's `resources/step-0-start-proposal.md` if present

- [ ] **Step 1: propose-* Step 0**

In each propose skill, the start command gains `--type`:

| Skill | Command |
|---|---|
| propose-genome-assembly | `node scripts/start-proposal.js <ASSEMBLY_ACCESSION> --type genome-assembly [--force-update]` |
| propose-bulk-rnaseq | `node scripts/start-proposal.js <ACCESSION> --type bulk-rnaseq --external-id bioproject=<PRJ> [--external-id geo=<GSE>] [--force-update]` |
| propose-dnaseq | `node scripts/start-proposal.js <ACCESSION> --type dnaseq --external-id bioproject=<ACCESSION> [--force-update]` |
| propose-chipseq | `node scripts/start-proposal.js <ACCESSION> --type chipseq --external-id bioproject=<ACCESSION> [--force-update]` |

Replace the paragraph after it (`Creates proposal/<ACCESSION> ...`) with:

```markdown
Prints `proposalId`: the accession, or `<ACCESSION>_<type>` when a proposal of
another dataset type already has the accession (one study, several types).
Use `<PROPOSAL>` for that id from here on. Creates `proposal/<PROPOSAL>` off a
clean, current `master`, refusing if that branch already exists here or on
origin, or if another proposal of this type already covers the accession.
```

Keep the rest of the existing paragraph (the `--force-update` explanation).

- [ ] **Step 2: propose-* later steps**

- `write-proposal.js` calls gain `--proposal <PROPOSAL>` after `--accession <ACCESSION>`.
- `render-proposal.js ... Proposals/<ACCESSION>` becomes `Proposals/<PROPOSAL>`.
- `publish-proposal.js <ACCESSION>` and `merge-proposal.js <ACCESSION>` become `<PROPOSAL>`.
- Fetch and check commands (`fetch-sra-metadata.js`, `check-library.js`, `check-experiments.js`, `find-publications.js`, `check-released-organism.js`, `fetch-pubmed.js`, `resolve-accessions.js`) keep `<ACCESSION>`: they read the archive.

- [ ] **Step 3: verify-bulk-rnaseq and load-proposals**

Every `<ACCESSION>` passed to `start-verification`, `validate-proposal`, `prepare-delivery`, `mark-ready`, `request-revision`, `load-proposal`, `mark-loaded` or `merge-proposal` becomes `<PROPOSAL>`. Where each skill introduces the proposals it works on (from `list-proposals.js` output), add one sentence: `The first column of list-proposals.js is the proposal id (<PROPOSAL>); it is the accession unless the study has proposals of several dataset types.`

- [ ] **Step 4: Check nothing was missed**

```bash
grep -nE "(start-proposal\.js [^\n]*)$" skills/*/SKILL.md | grep -v -- "--type"
grep -nE "(publish-proposal|merge-proposal|start-verification|validate-proposal|prepare-delivery|mark-ready|request-revision|load-proposal|mark-loaded)\.js[^\n]*<(ACCESSION|ASSEMBLY_ACCESSION)>" skills/*/SKILL.md skills/*/resources/*.md
```

Expected: no output from either.

- [ ] **Step 5: Commit**

```bash
git add skills
git commit -m "Skills carry the proposal id from start-proposal"
```

---

### Task 11: Version, sync, full run

**Files:**
- Modify: `package.json:3`, `.claude-plugin/plugin.json:3`

- [ ] **Step 1: Bump to 2.7.0** in both files.

- [ ] **Step 2: Sync and test**

```bash
yarn sync-shared
yarn test
```

Expected: all tests PASS (including `tests/skill-imports.test.js` and `tests/import-graph.test.js`).

- [ ] **Step 3: Leftover check**

```bash
grep -rnE "\baccession\b" shared/scripts/lib/{proposal-ops,merge-ops,verification-ops,validation-ops,validation-workspace,delivery-ops,load-ops,build-start-ops}.js | grep -vE "manifest\.accession|m\.accession|accession:|manifestInput\.accession|\{ accession|accession, datasetType|accession\)\.|existingProposalId|newProposalId|siblingProposalId\(accession"
```

Review each remaining hit: it must mean the archive id. Rename any that is a directory, branch or workspace handle.

- [ ] **Step 4: Commit**

```bash
git add package.json .claude-plugin/plugin.json skills
git commit -m "Sibling proposals (2.7.0)"
```

- [ ] **Step 5: End-to-end (with John)**

Propose the DNA-seq side of PRJNA1306639 with `propose-dnaseq` against the demo clone. Expected: `start-proposal.js` prints `proposalId: PRJNA1306639_dnaseq`, the branch is `proposal/PRJNA1306639_dnaseq`, and the ticket title reads `[<Project>] PRJNA1306639_dnaseq <organisms>`. Do not publish without John's go-ahead: publishing creates a real ticket.
