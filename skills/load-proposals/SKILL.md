---
name: load-proposals
description: Data loading team - bring dataset proposals from VEuPathDatasets Proposals/ into presenter and dataset XML on a rebuild branch, generate the loading artifacts to copy to the server, one PR per proposal, and mark tickets loading
---

# Load Dataset Proposals

Runs on a `rebuild<NN>` branch of VEuPathDatasets at the start of a build.
For each proposal whose ticket is in build `<NN>` (the ticket's `Build <NN>`
milestone) it renders the presenter and, for dataset types with a
`classes.xml` class (bulk RNA-seq), the `<dataset>` entry for
`Datasets/lib/xml/datasets/<Project>/<organismAbbrev>.xml`. One load adds a
presenter, a `<dataset>` and a delivery directory per organism. It deletes the
proposal and commits all of that once, pushes `load/<accession>`, opens a PR
against `rebuild<NN>`, and marks the ticket `loading`. It also writes the
loading artifacts (`analysisConfig.xml`, `samplesheet.csv`, sample annotations,
STF files) under `.curation/delivery/`, laid out like the class's
`@@manualDeliveryDir@@` directory. The PR and the ticket say where each file
goes.

**Copying the artifacts to the server, fetching or linking the reads, and
checking them there are the data loading team's steps.** No script touches the
server. Per-type code lives in `scripts/dataset-types/`.

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
`.curation/curator.config.json`.

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

Lists the proposals whose ticket milestone is `Build <NN>`. A proposal with
no ticket is left out of a `--build` listing, and one whose ticket has no build
milestone is reported as an error (`load-proposal.js` refuses both). Prints a
table of the proposals that could be read, then reports any manifest
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

Prints the presenter XML and the dataset entry that would be inserted, and
the delivery target, and changes nothing. It reads the ticket to find the
build, which is read-only. Run this
for every accession before loading any. A proposal merged to `master` after
`rebuild<NN>` was cut is reported as a straggler; the load step cherry-picks
it automatically. Fix anything else it reports (usually a presenter name
collision, or a dataset name the organism file already has) before moving
on.

### Step 3: Load

```bash
node scripts/load-proposal.js <ACCESSION>
```

One accession at a time. It prints the hand-off: the local artifact
directory, the `@@manualDeliveryDir@@/...` target, and where the reads come
from. For a build sweep, loop over the accessions from
Step 1; a failure on one does not affect the others. After each, the working
tree is on `load/<ACCESSION>`. Check out `rebuild<NN>` before the next:

```bash
git checkout rebuild<NN>
```

### Step 4: Report

List the PR URLs, ticket URLs and each hand-off. The user reviews and merges
the PRs into `rebuild<NN>`, and copies each artifact directory to its target. Tickets move to `done` outside this skill, when `rebuild<NN>`
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
- `scripts/render-proposal.js` - render the presenter (default), dataset entry (`--dataset`) or artifacts (`--artifacts <dir>`) for any proposal directory
- `scripts/dataset-types/<type>.js` - presenter, dataset entry and artifacts per dataset type
- `scripts/check-workspace.js` - workspace check

All scripts are synced from `shared/` in dataset-curator.
