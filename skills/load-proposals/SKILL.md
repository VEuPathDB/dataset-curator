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
node scripts/check-workspace.js
git branch --show-current
git status -sb
```

The branch must be `rebuild<NN>` and clean. If not, stop and tell the user;
do not check out or pull for them. Ticket settings ship in
`resources/curator.config.json`, overridable per clone at
`.curation/curator.config.json`; Redmine needs `REDMINE_API_KEY`.

## Working Directory

Run everything from the top of the VEuPathDatasets checkout. Never `cd` into
subdirectories. Never push to `rebuild*` or `master`; the scripts push only
to `load/<accession>`.

## Required Information

- **Target build** `<NN>`, or a single **accession**.

## Workflow

### Step 1: List what is pending

```bash
node scripts/list-proposals.js --build <NN>
```

Prints a table of the proposals that could be read, then reports any manifest
it could not read as `Error: <accession>: <message>` on stderr (it does not
hide the ones that did read). It exits 1 only if nothing could be listed. Show
the table to the user and confirm which proposals to load; investigate any
errors reported alongside it. If the table is empty, check whether the
expected proposals were merged to `master` after `rebuild<NN>` was cut; see
[preconditions](resources/preconditions.md).

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
git checkout rebuild<NN>
```

### Step 4: Report

List the PR URLs and ticket URLs. The user reviews and merges the PRs into
`rebuild<NN>`. Tickets move to `done` outside this skill, when `rebuild<NN>`
merges to `master`.

## Recovery

If a load fails, the branch is left in place. Re-running resumes when the
error's last line says so; otherwise it tells you how to start over. See
[recovery](resources/recovery.md).

## Resources

- [Proposal Workflow](resources/proposal-workflow.md)
- [Preconditions](resources/preconditions.md)
- [Recovery](resources/recovery.md)

## Scripts

- `scripts/list-proposals.js` - proposals on the current branch, filter by build
- `scripts/load-proposal.js` - load one proposal; `--dry-run` to preview
- `scripts/render-proposal.js` - render XML for any proposal directory
- `scripts/renderers/<type>.js` - one renderer per dataset type
- `scripts/check-workspace.js` - workspace check

All scripts are synced from `shared/` in dataset-curator.
