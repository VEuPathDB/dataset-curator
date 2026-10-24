# Release vs Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop deriving the rebuild branch from the ticket's `Build NN` milestone; load and check-organisms take the rebuild branch explicitly.

**Architecture:** `Build NN` milestones are website releases; `rebuildRR` branches are database rebuilds, and one rebuild feeds many releases. `load-ops.js` gets a required `rebuildBranch` argument (validated against `/^rebuild\d+$/`); the CLIs take `--rebuild-branch` or fall back to the checked-out branch when it is a rebuild branch. The milestone still names the release, which the presenter render and the PR title use. Docs rename the placeholder `rebuild<NN>` to `rebuild<RR>` so the two numbers stop looking alike.

**Tech Stack:** Node.js ESM, `node:test`, git/gh via `lib/git-ops.js`.

Spec: `docs/superpowers/specs/2026-10-23-verify-bulk-rnaseq-design.md`, section "Prerequisite: release is not rebuild". Ship this as its own PR, on branch `release-vs-rebuild` off `main`, before the verify-bulk-rnaseq plan.

---

## File Structure

- Modify `shared/scripts/lib/load-ops.js`: `REBUILD_BRANCH`, `assertRebuildBranch`, `resolveRebuildBranch`; `rebuildBranch` argument on `checkLoadPreconditions`, `loadProposal`, `checkOrganisms`; drop `rebuildBranch(build)`.
- Modify `shared/scripts/load-proposal.js`, `shared/scripts/check-organisms.js`: `--rebuild-branch`.
- Modify `tests/load-ops.test.js`: pass `rebuildBranch`; replace the milestone-picks-branch test.
- Modify docs: `shared/resources/proposal-workflow.md`, `skills/load-proposals/SKILL.md`, `skills/load-proposals/resources/preconditions.md`, `skills/load-proposals/resources/recovery.md`, `skills/propose-bulk-rnaseq/SKILL.md`, `skills/propose-genome-assembly/SKILL.md`.

`yarn sync-shared` runs in the pre-commit hook and copies `shared/` into the skills; never edit a synced copy under `skills/*/scripts`. End every commit message with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Never commit to `main`.

---

### Task 1: Branch

- [ ] **Step 1: Create the branch**

```bash
git fetch origin
git switch -c release-vs-rebuild origin/main
```

---

### Task 2: load-ops takes the rebuild branch

**Files:**
- Modify: `shared/scripts/lib/load-ops.js`
- Test: `tests/load-ops.test.js`

- [ ] **Step 1: Thread `rebuildBranch` through every test call**

Every `checkLoadPreconditions`, `loadProposal` and `checkOrganisms` call in this file passes `repoPath: repo,` (69 sites). Add the constant after the `tickets` helper (line 13):

```js
const REBUILD = 'rebuild02';
```

Then:

```bash
sed -i 's/repoPath: repo, /repoPath: repo, rebuildBranch: REBUILD, /' tests/load-ops.test.js
grep -c 'rebuildBranch: REBUILD' tests/load-ops.test.js
```

Expected: the count equals the number of `repoPath: repo,` matches (69).

- [ ] **Step 2: Replace the test that ties branch to milestone**

Replace the test `'the rebuild branch comes from the ticket milestone'` (around line 524) with:

```js
test('the milestone is the release, not the branch: a build 03 proposal dry-runs on rebuild02', async () => {
  const { repo } = setupRepo();
  const result = await loadProposal({ git: createGit(repo), ticket: tickets(), repoPath: repo, rebuildBranch: REBUILD, accession: 'PRJNA000002', dryRun: true });
  assert.equal(result.dryRun, true);
  assert.equal(result.presenterNames.length, 1);
});

test('a load without a rebuild branch is refused before anything is read', async () => {
  const { repo } = setupRepo();
  for (const rebuildBranch of [undefined, 'master', 'build73', 'rebuild']) {
    await assert.rejects(checkLoadPreconditions({ git: createGit(repo), ticket: tickets(), repoPath: repo, rebuildBranch, accession: 'GCA_000001.1' }),
      /A rebuild branch such as rebuild02 is required; got "/);
  }
});

test('resolveRebuildBranch takes --rebuild-branch, else a checked-out rebuild branch', () => {
  const { repo } = setupRepo();
  const git = createGit(repo);
  assert.equal(resolveRebuildBranch(git, undefined), 'rebuild02');
  assert.equal(resolveRebuildBranch(git, 'rebuild03'), 'rebuild03');
  git.checkout('master');
  assert.throws(() => resolveRebuildBranch(git, undefined), /Pass --rebuild-branch rebuildRR, or run on the rebuild branch; "master" is not one/);
  assert.throws(() => resolveRebuildBranch(git, 'build73'), /"build73" is not one/);
});
```

Add `resolveRebuildBranch` to the import from `../shared/scripts/lib/load-ops.js` on line 9.

- [ ] **Step 3: Update the messages the old `because` text produced**

In `'preconditions: wrong branch names the checkout command'` replace the regex with:

```js
    /Expected to be on rebuild02, but on "master"\. Loading targets rebuild02\..*checkout rebuild02/s
```

In `'checkOrganisms runs only on the build rebuild branch, at origin'` rename the test to `'checkOrganisms runs only on the rebuild branch, at origin'` and replace the first regex with:

```js
    /Expected to be on rebuild02, but on "master"\. Organisms are checked on rebuild02\..*checkout rebuild02/s);
```

- [ ] **Step 4: Run the tests to see them fail**

Run: `node --test tests/load-ops.test.js`
Expected: FAIL; `resolveRebuildBranch` is not exported, and the new messages do not match.

- [ ] **Step 5: Implement in `shared/scripts/lib/load-ops.js`**

Replace line 26:

```js
export const rebuildBranch = (build) => `rebuild${build}`;
```

with:

```js
// Build NN milestones are website releases; rebuildRR branches are database rebuilds.
const REBUILD_BRANCH = /^rebuild\d+$/;

function assertRebuildBranch(rebuildBranch) {
  if (!REBUILD_BRANCH.test(rebuildBranch ?? '')) throw new Error(`A rebuild branch such as rebuild02 is required; got "${rebuildBranch}"`);
}

/** --rebuild-branch, else the checked-out branch when it is a rebuild branch. */
export function resolveRebuildBranch(git, given) {
  const chosen = given ?? git.currentBranch();
  if (!REBUILD_BRANCH.test(chosen ?? '')) throw new Error(`Pass --rebuild-branch rebuildRR, or run on the rebuild branch; "${chosen || 'detached HEAD'}" is not one`);
  return chosen;
}
```

In `checkLoadPreconditions`, change the signature and add the check as the first statement:

```js
export async function checkLoadPreconditions({ git, ticket, repoPath, rebuildBranch, accession, dryRun = false, settle = {} }) {
  assertRebuildBranch(rebuildBranch);
  const proposalDir = join(repoPath, PROPOSALS_DIR, accession);
```

Replace the dirty-tree line:

```js
  const dirty = onLoadBranch ? await dirtyTreeMessage(git, ticket, repoPath, accession) : undefined;
```

with:

```js
  const dirty = onLoadBranch ? dirtyTreeMessage(repoPath, accession, rebuildBranch) : undefined;
```

Replace:

```js
  const base = rebuildBranch(build);
```

with:

```js
  const base = rebuildBranch;
```

Replace:

```js
  assertOnCurrentRebuild(git, repoPath, base, `The proposal's ticket is in build ${build} (${base}).`);
```

with:

```js
  assertOnCurrentRebuild(git, repoPath, base, `Loading targets ${base}.`);
```

Replace the whole `checkOrganisms` function with:

```js
/**
 * Every Ready to load proposal on this rebuild branch (optionally only those
 * whose ticket is in build) with the abbreviation each organism would load
 * under and the stops a person must resolve first. Stragglers still only on
 * origin/master are checked when they load. Runs only on the rebuild branch, at origin.
 * Returns { results: [{ accession, organisms, stops }], errors }.
 */
export async function checkOrganisms({ git, ticket, repoPath, rebuildBranch, build }) {
  assertRebuildBranch(rebuildBranch);
  git.fetch();
  assertOnCurrentRebuild(git, repoPath, rebuildBranch, `Organisms are checked on ${rebuildBranch}.`);
  const { proposals, errors } = await listProposals(repoPath, { ticket, build, status: 'ready' });
  const results = proposals.map(({ manifest }) => ({ accession: manifest.accession, ...settlementFor(git, manifest) }));
  return { results, errors };
}
```

Replace the whole `dirtyTreeMessage` function with:

```js
/** A dirty load branch is a previous run, so it gets its own way out. */
function dirtyTreeMessage(repoPath, accession, base) {
  const branch = loadBranch(accession);
  return `A previous load left uncommitted changes on ${branch}; to start over: git -C '${repoPath}' checkout -f ${base} && git -C '${repoPath}' branch -D ${branch}`;
}
```

In `loadProposal`, change the signature and the precondition call:

```js
export async function loadProposal({ git, ticket, repoPath, rebuildBranch, accession, dryRun = false, deliveryBase, settle = {} }) {
  const pre = await checkLoadPreconditions({ git, ticket, repoPath, rebuildBranch, accession, dryRun, settle });
```

Replace the PR title line:

```js
    const title = `Load ${accession} (${manifest.datasetType}, ${projectsOf(manifest).join(', ')}) into build ${build}`;
```

with:

```js
    const title = `Load ${accession} (${manifest.datasetType}, ${projectsOf(manifest).join(', ')}) into ${base} for build ${build}`;
```

Update the `checkLoadPreconditions` doc comment: replace "The build comes from the milestone of the proposal's ticket, read through the ticket client, so a proposal with no ticket is refused." with "The build (the website release) comes from the milestone of the proposal's ticket, so a proposal with no ticket is refused; the rebuild branch is given, never derived from it."

- [ ] **Step 6: Run the tests**

Run: `node --test tests/load-ops.test.js`
Expected: PASS. A failure naming `into build` in a PR title assertion: update that expectation to `into rebuild02 for build 02`.

- [ ] **Step 7: Commit**

```bash
git add shared/scripts/lib/load-ops.js tests/load-ops.test.js
git commit -m "Load takes the rebuild branch instead of deriving it from the release milestone"
```

---

### Task 3: CLIs take --rebuild-branch

**Files:**
- Modify: `shared/scripts/load-proposal.js`
- Modify: `shared/scripts/check-organisms.js`

- [ ] **Step 1: `load-proposal.js`**

Replace the usage line in the header comment and the two usage strings with:

```
Usage: node load-proposal.js [--rebuild-branch rebuildRR] [--dry-run] [--settle <proposed>=<abbrev> ...] <accession>
```

Change the import:

```js
import { loadProposal, resolveRebuildBranch } from './lib/load-ops.js';
```

Add the option:

```js
    options: { 'dry-run': { type: 'boolean', default: false }, 'rebuild-branch': { type: 'string' }, settle: { type: 'string', multiple: true, default: [] } }, allowPositionals: true
```

Replace the `loadProposal` call:

```js
  const rebuildBranch = resolveRebuildBranch(git, values['rebuild-branch']);
  const result = await loadProposal({ git, ticket, repoPath: config.repoPath, rebuildBranch, accession, dryRun, settle });
```

- [ ] **Step 2: `check-organisms.js`**

Replace the whole file body below the shebang with:

```js
/**
 * check-organisms.js - For every Ready to load proposal on this rebuild branch
 * (optionally only one release's), prints the abbreviation each organism would
 * load under and every stop a person must resolve before it loads. Exits 1 on any stop.
 *
 * Usage: node check-organisms.js [--rebuild-branch rebuildRR] [--build NN]
 */
import { parseArgs } from 'node:util';
import { openWorkspace } from './lib/config.js';
import { createGit } from './lib/git-ops.js';
import { createTicketClient } from './lib/ticket/index.js';
import { checkOrganisms, resolveRebuildBranch } from './lib/load-ops.js';

async function main() {
  const { values } = parseArgs({ options: { build: { type: 'string' }, 'rebuild-branch': { type: 'string' } } });
  const config = openWorkspace();
  const git = createGit(config.repoPath);
  const rebuildBranch = resolveRebuildBranch(git, values['rebuild-branch']);
  const { results, errors } = await checkOrganisms({ git, ticket: createTicketClient(config), repoPath: config.repoPath, rebuildBranch, build: values.build });
  for (const r of results) {
    console.log(r.accession);
    for (const o of r.organisms) console.log(`  ${o.proposed} -> ${o.abbrev ?? '(stopped)'}${o.notes.length ? `  (${o.notes.join('; ')})` : ''}`);
    for (const s of r.stops) console.log(`  STOP ${s}`);
  }
  for (const e of errors) console.error(`Error: ${e.accession}: ${e.message}`);
  if (results.some((r) => r.stops.length) || errors.length) process.exit(1);
}

main().catch(err => { console.error(`Error: ${err.message}`); process.exit(1); });
```

- [ ] **Step 3: Smoke-test the argument handling**

Run from this repo (not a VEuPathDatasets checkout): `node shared/scripts/check-organisms.js --rebuild-branch nope`
Expected: `Error: ... is not a VEuPathDatasets checkout ...` (config fails first; the script parses). Then run `node --test tests/*.test.js`; expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add shared/scripts/load-proposal.js shared/scripts/check-organisms.js
git commit -m "load-proposal and check-organisms take --rebuild-branch"
```

---

### Task 4: Docs separate release from rebuild

**Files:**
- Modify: `shared/resources/proposal-workflow.md`, `skills/load-proposals/SKILL.md`, `skills/load-proposals/resources/preconditions.md`, `skills/load-proposals/resources/recovery.md`, `skills/propose-bulk-rnaseq/SKILL.md`, `skills/propose-genome-assembly/SKILL.md`

- [ ] **Step 1: Rename the placeholder**

```bash
sed -i 's/rebuild<NN>/rebuild<RR>/g; s/rebuildNN/rebuildRR/g' \
  shared/resources/proposal-workflow.md skills/load-proposals/SKILL.md \
  skills/load-proposals/resources/preconditions.md skills/load-proposals/resources/recovery.md \
  skills/propose-bulk-rnaseq/SKILL.md skills/propose-genome-assembly/SKILL.md
grep -rn 'rebuild<NN>\|rebuildNN' shared/resources skills/*/SKILL.md skills/load-proposals/resources
```

Expected: no output.

- [ ] **Step 2: `shared/resources/proposal-workflow.md`**

After the `## Branch model` code block, add:

```markdown
Two numbers, not one: a `Build NN` milestone is a **website release**; a
`rebuild<RR>` branch is a **database rebuild**. One rebuild feeds many
releases, so a proposal's milestone never picks its rebuild branch.
```

In "Phase 2: loading", replace item 1's first sentence `At build start, \`rebuild<RR>\` is cut from \`master\`.` with `When a database rebuild starts, \`rebuild<RR>\` is cut from \`master\`.`

Replace item 3's first sentence

```
3. The `load-proposals` skill, run on `rebuild<RR>`, picks proposals whose
   ticket milestone is `Build <NN>`. Only a `Ready to load` ticket loads; a
   proposal with no ticket, or a ticket with no build milestone, is refused.
```

with

```
3. The `load-proposals` skill, run on `rebuild<RR>`, loads `Ready to load`
   proposals; the ticket's `Build <NN>` milestone names the release the
   presenter is rendered for. A proposal with no ticket, or a ticket with no
   build milestone, is refused.
```

In "Stragglers", replace `A proposal for build NN that reaches master after \`rebuild<RR>\` was cut` with `A proposal that reaches master after \`rebuild<RR>\` was cut`.

- [ ] **Step 3: `skills/load-proposals/SKILL.md`**

Line 8: replace `Runs on a \`rebuild<RR>\` branch of VEuPathDatasets at the start of a build.` with `Runs on a \`rebuild<RR>\` branch of VEuPathDatasets (a database rebuild; one rebuild feeds many \`Build NN\` website releases).`

Line 11: replace `ticket is in build \`<NN>\` (the ticket's \`Build <NN>\` milestone) it renders` with `ticket is in a release being loaded (its \`Build <NN>\` milestone) it renders`.

Under "## Required Information" replace the bullet with:

```markdown
- The **rebuild branch** `rebuild<RR>` (ask; never guess it from a `Build NN` milestone).
- Optionally a **release** `<NN>` to narrow the listing, or a single **accession**.
```

Step 0 command becomes:

```bash
node scripts/check-organisms.js --rebuild-branch rebuild<RR> [--build <NN>]
```

and its first sentence becomes `Reports, for every \`Ready to load\` proposal (of release \`<NN>\` when given), how each proposed organism abbreviation would settle.`

Every `node scripts/load-proposal.js` command line in Steps 2 to 4 gains `--rebuild-branch rebuild<RR>` right after `load-proposal.js`.

- [ ] **Step 4: `skills/load-proposals/resources/preconditions.md`**

Replace the row starting `| Branch matches the ticket's build |` with:

```markdown
| On the rebuild branch | `Expected to be on rebuild<RR>` ... `Loading targets rebuild<RR>.` | Check out the rebuild branch named with `--rebuild-branch`, or pass the one that is checked out |
```

Add a row directly above "Working tree clean":

```markdown
| Rebuild branch named | `A rebuild branch such as rebuild02 is required` or `Pass --rebuild-branch rebuildRR` | Ask the loader which rebuild this is; a `Build NN` milestone is a release and never names it |
```

In "Why a straggler happens", replace `\`rebuild<RR>\` is cut from \`master\` at build start.` with `\`rebuild<RR>\` is cut from \`master\` when the rebuild starts.` and `so an earlier build's propose and load commits` with `so an earlier rebuild's propose and load commits`.

- [ ] **Step 5: Check and commit**

Run: `node --test tests/*.test.js`
Expected: PASS.

```bash
git add shared/resources/proposal-workflow.md skills/
git commit -m "Docs: a Build milestone is a release, a rebuild branch is a database rebuild"
```

- [ ] **Step 6: Milestone description (needs John)**

The `Build 73` milestone description says "Datasets targeting rebuild73". It is outward-facing; ask John before running:

```bash
env -u GITHUB_TOKEN gh api -X PATCH repos/VEuPathDB/VEuPathDatasets/milestones/1 -f description='Datasets for website release 73'
```

- [ ] **Step 7: Push and open the PR (after John says so)**

```bash
git push -u origin release-vs-rebuild
env -u GITHUB_TOKEN gh pr create --base main --title "Release milestone no longer picks the rebuild branch" --body "Build NN milestones are website releases; rebuildRR branches are database rebuilds. Load and check-organisms now take --rebuild-branch (or the checked-out rebuild branch). Spec: docs/superpowers/specs/2026-10-23-verify-bulk-rnaseq-design.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```
