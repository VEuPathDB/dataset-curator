---
name: verify-bulk-rnaseq
description: Data loading team - verify a merged bulk RNA-seq proposal before it loads. Claims it, runs validate-proposal (library type and depth, sample labels and runs across samplesheet, analysisConfig and STF, ApiCommonData's analysisConfig parser, study-wrangler STF validation, optional build fitness) with the validation workspace the data loader names, posts the report on the ticket, reviews warnings and presenter text with the user, then mark-ready or request-revision
---

# Verify a Bulk RNA-seq Proposal

Between merge (`Proposed`) and load (`Ready to load`). The automated part is
`validate-proposal.js`; the judgment part is yours and the user's.
See [proposal workflow](resources/proposal-workflow.md) for the statuses.

## Before you start

```bash
node scripts/check-workspace.js
git fetch
```

Run from the top of a VEuPathDatasets checkout. Validation reads the proposal
from `origin/master`, so the checked-out branch does not matter.

**Ask the data loader for the validation workspace root.** It holds one
directory per dataset type (`rnaseq-validation/` for this skill), each with an
`env.json` (repos with url and ref, executables, build commands), base clones
in `repos/`, and `proposals/<ACCESSION>/`: a git worktree per repo on branch
`verify/<ACCESSION>` plus that proposal's `build/`. The scripts create and
reuse these. **Never guess the root, search for it, or reuse one from an
earlier conversation: ask the data loader.**

Run one validation at a time per dataset type: the base clones in `repos/` are
shared, so parallel runs collide.

## Step 1: Pick and claim

```bash
node scripts/list-proposals.js --status proposed
node scripts/start-verification.js <ACCESSION>
```

Claiming is optional; it assigns the issue to the user and sets
`Verification in progress`.

## Step 2: Validate

```bash
node scripts/validate-proposal.js --workspace <root> <ACCESSION>
```

The first run for a proposal fetches each repo and builds; later runs reuse
that code as is, so a fix made in a worktree survives. After editing code in
`proposals/<ACCESSION>/<repo>/`, add `--rebuild`. To move to the latest code
on each repo's ref, add `--refresh` (refused while a worktree holds
uncommitted or unpushed work). The `Repos:` line and the posted report record
each repo's ref and commit.

Add `--against origin/rebuild<RR>` when the user names a rebuild branch, to
also run the load checks (organisms settle, names free, organism dataset
files present) without checking anything out. Organism stops come out as
warnings: a person settles them at load with `--settle`. Use `--no-post` only for a
trial run; mark-ready reads the posted report.

Verdicts: `pass`; `needs-review` (warnings: each needs the user's explicit
acceptance); `fail` (errors). Show the user every finding.

- `could not verify: ...` is a workspace problem, not a proposal problem:
  tell the data loader what is missing and re-run. Never mark ready around it.
- Depth, library type and consistency errors go back to the curator.

## Step 3: Review with the user

- Every warning in the report (the text says what can go wrong).
- SRA runs still resolve and any server paths exist (the validators read a
  proposal-time snapshot).
- Sample annotations read sensibly.
- The curator's notes on the ticket.
- Presenter text: `Proposals/<ACCESSION>/curated/presenter.json` on
  `origin/master` (display name, summary, description, contacts).

## Step 4: Decide

```bash
node scripts/mark-ready.js --workspace <root> <ACCESSION> "<what was checked>"
node scripts/request-revision.js <ACCESSION> "<what the curator must fix>"
```

mark-ready refuses without a report for the current version of the proposal,
or when the latest report failed. Its comment records the verdict, tool
versions and the warnings the user accepted. A republished proposal returns
to `Proposed` and needs validating again.

`--workspace <root>` is required for a type with validators. mark-ready then
removes `proposals/<ACCESSION>/`. It refuses first, before touching the
ticket, while a worktree has uncommitted changes or commits on no remote
branch, or while `verify/<ACCESSION>` holds commits on no remote: push them
(`verify/<ACCESSION>`) and open a PR on that repo, or, only when the user says
the changes are disposable, add `--discard-changes` (it needs `--workspace`).
If removal fails after the ticket is Ready, mark-ready prints a `Warning:` and
exits 0; the ticket is fine, so remove `proposals/<ACCESSION>/` and its
`verify/<ACCESSION>` branches by hand. request-revision keeps the workspace
for the next round.

If a pushed fix branch was squash-merged and deleted upstream, its commits
count as unpushed after a fetch: confirm the fix is merged, then use
`--discard-changes`.

Builds run with `GUS_HOME` pointed at the proposal's `build/`, never the
caller's.

## Rules

- Never pass a workspace the data loader did not name.
- Never run two validations of one dataset type at once.
- Never mark ready on a `fail` verdict, and never accept a warning on the
  user's behalf.
- Never push; these scripts change only the ticket and the validation workspace.
- Never push to tool repos on the user's behalf; tell them what is unpushed.
