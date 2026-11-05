# Verifying a proposal

The steps every `verify-*` skill shares, between merge (`Proposed`) and load
(`Ready to load`). The skill for the dataset type says what its validators
check, what its delivery holds and what to review with the user. See
[proposal workflow](proposal-workflow.md) for the statuses.

## Before you start

```bash
node scripts/check-workspace.js
git fetch
```

Run from the top of a VEuPathDatasets checkout. Validation reads the proposal
from `origin/master`, so the checked-out branch does not matter.

**Ask the data loader for the validation workspace root.** It holds one
directory per dataset type (`<type>-validation/`; the skill names it), each
with an `env.json` (repos with url and ref, executables, build commands), base
clones in `repos/`, and `proposals/<PROPOSAL>/`: a git worktree per repo on
branch `verify/<PROPOSAL>`, that proposal's `build/`, and, for types that
preprocess, its work area `preprocess/`. The scripts create and reuse these.
**Never guess the root, search for it, or reuse one from an earlier
conversation: ask the data loader.**

Run one validation at a time per dataset type: the base clones in `repos/` are
shared, so parallel runs collide.

## Pick and claim

```bash
node scripts/list-proposals.js --status proposed
node scripts/start-verification.js <PROPOSAL>
```

The first column of list-proposals.js is the proposal id (`<PROPOSAL>`); it is
the accession unless the study has proposals of several dataset types.

Claiming is optional; it assigns the issue to the user and sets
`Preprocessing`.

## Validate

```bash
node scripts/validate-proposal.js --workspace <root> <PROPOSAL>
```

The first run for a proposal fetches each repo and builds; later runs reuse
that code as is, so a fix made in a worktree survives. After editing code in
`proposals/<PROPOSAL>/<repo>/`, add `--rebuild`. To move to the latest code
on each repo's ref, add `--refresh` (refused while a worktree holds
uncommitted or unpushed work). The `Repos:` line and the posted report record
each repo's ref and commit.

Add `--against origin/rebuild<RR>` when the user names a rebuild branch, to
also run the load checks (organisms settle, names free, organism dataset
files present) without checking anything out. Organism stops come out as
warnings: a person settles them when preparing the delivery with `--settle`.
Use `--no-post` only for a trial run; mark-ready reads the posted report.

Verdicts: `pass`; `needs-review` (warnings: each needs the user's explicit
acceptance); `fail` (errors). Show the user every finding.

- `could not verify: ...` is a workspace problem, not a proposal problem:
  tell the data loader what is missing and re-run. Never mark ready around it.

## Prepare the delivery

```bash
node scripts/prepare-delivery.js --workspace <root> --against origin/rebuild<RR> <PROPOSAL>
```

Ask the data loader for the rebuild branch. This settles the organisms (a stop
is resolved here with `--settle <proposed>=<abbrev>`, never at load) and writes
the whole manual delivery to `<type>-validation/delivery/<PROPOSAL>/`:
`final/` per dataset entry, `fromProvider/` (the proposal from master plus the
files its manifest's `staging` lists from `dataStaging/<PROPOSAL>/`; nothing
else in the drop is pulled), an empty `workspace/` per organism, and whatever
else the type adds (the skill says what). It needs `staging` and
`manualDelivery` in the type's `env.json`.

For a type that preprocesses, `final/` also takes files from the work area
`proposals/<PROPOSAL>/preprocess/`. prepare-delivery refuses when the work area
is missing or the type finds it stale, and copies the files, so later edits in
the work area do not change a prepared delivery. `delivery.json` records each
file's sha256 and what produced it.

Re-running replaces everything except `workspace/`. If the proposal must
change (dataset class, props, version), update it through a proposal PR; once
merged, validate and prepare again.

## Decide

```bash
node scripts/mark-ready.js --workspace <root> <PROPOSAL> "<what was checked>"
node scripts/request-revision.js <PROPOSAL> "<what the curator must fix>"
```

mark-ready refuses without a report for the current version of the proposal,
or when the latest report failed. Its comment records the verdict, tool
versions and the warnings the user accepted. mark-ready also needs the
current delivery, checks the dataset entries against the rebuild branch the
delivery was prepared against, and posts the delivery record and the rsync on
the ticket; it never removes `delivery/`. A republished proposal returns to
`Proposed` (it stays at `Preprocessing` if published there) and needs
validating again.

`--workspace <root>` is required for a type with validators. mark-ready then
removes `proposals/<PROPOSAL>/`, including any `preprocess/` work area: keep
it until mark-ready, and preprocess again if a revision follows. It refuses
first, before touching the ticket, while a worktree has uncommitted changes or
commits on no remote branch, or while `verify/<PROPOSAL>` holds commits on no
remote: push them (`verify/<PROPOSAL>`) and open a PR on that repo, or, only
when the user says the changes are disposable, add `--discard-changes` (it
needs `--workspace`). If removal fails after the ticket is Ready, mark-ready
prints a `Warning:` and exits 0; the ticket is fine, so remove
`proposals/<PROPOSAL>/` and its `verify/<PROPOSAL>` branches by hand.
request-revision keeps the workspace for the next round.

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
- Never copy to the server yourself; print the rsync for the data loader.
- Never push; these scripts change only the ticket and the validation workspace.
- Never push to tool repos on the user's behalf; tell them what is unpushed.
