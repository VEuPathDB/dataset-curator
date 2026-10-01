---
name: load-proposals
description: Data loading team - verify merged dataset proposals (start-verification, then mark-ready or request-revision), then bring Ready to load proposals from VEuPathDatasets Proposals/ into presenter and dataset XML on a rebuild branch, copy the curated loading artifacts out for the server once they agree, one PR per proposal, set each ticket's project Status to Loading in progress, and to Post Load QA once the load PR merges
---

# Load Dataset Proposals

Runs on a `rebuild<NN>` branch of VEuPathDatasets at the start of a build.
A person first verifies each merged proposal and marks it `Ready to load` or
sends it back (`Needs revision`). For each `Ready to load` proposal whose
ticket is in build `<NN>` (the ticket's `Build <NN>` milestone) it renders the presenter and, for dataset types with a
`classes.xml` class (bulk RNA-seq), the `<dataset>` entry for
`Datasets/lib/xml/datasets/<Project>/<organismAbbrev>.xml`. One load adds a
presenter, a `<dataset>` and a delivery directory per organism. It deletes the
proposal and commits all of that once, pushes `load/<accession>`, opens a PR
against `rebuild<NN>`, and sets the ticket's Status on the GitHub Project to
`Loading in progress`. It also checks that the
proposal's curated loading artifacts (`analysisConfig.xml`, `samplesheet.csv`,
sample annotations, STF files) agree, and copies them, not regenerates them,
under `.curation/delivery/`, laid out like the class's
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

Lists the proposals whose ticket milestone is `Build <NN>`, with each
ticket's Status (read-only). Add `--status proposed` to see the ones awaiting
verification, or `--status ready` for the ones that can load. A proposal with
no ticket is left out of a `--build` listing, and one whose ticket has no build
milestone or no readable status is reported as an error (`load-proposal.js`
refuses both). Prints a table of the proposals that could be read, then
reports anything it could not read as `Error: <accession>: <message>` on
stderr (it does not hide the ones that did read). It exits 1 only if nothing
could be listed. Show the table to the user; investigate any errors reported
alongside it. If the table is empty, check whether the expected proposals were
merged to `master` after `rebuild<NN>` was cut; see
[preconditions](resources/preconditions.md).

### Step 2: Verification

Merging a proposal PR is not verification: a merged proposal is still at
`Proposed`, and only `Ready to load` proposals load. For each `Proposed`
proposal, claim it first so others can see who is on it (optional):

```bash
node scripts/start-verification.js <ACCESSION>
```

It refuses unless the proposal is on `origin/master`, no update from
`proposal/<ACCESSION>` is awaiting review (a failed lookup refuses too), and
the ticket is at `Proposed`. It assigns the issue to you and sets the Status
to `Verification in progress`.

Then the automated part:

```bash
node scripts/load-proposal.js --dry-run <ACCESSION>
```

A dry run changes nothing, so it accepts a ticket at `Proposed`,
`Verification in progress`, `Ready to load` or `Needs revision`. It runs every load check: the organism dataset
files exist on `rebuild<NN>` and do not already hold the dataset, the
presenter and dataset names do not collide, and the curated artifacts agree.
It prints the presenter and dataset entries that would be written. Then the
user checks the rest, with your help where you can read the evidence:

- **Reads reachable**: SRA runs resolve, or the server paths or URLs in the
  sample annotations exist.
- **Organism dataset files present** on `rebuild<NN>` for every organism the
  proposal names (`Datasets/lib/xml/datasets/<Project>/<organismAbbrev>.xml`);
  the dry run checks this.
- **Sample annotations sensible**: sample names, labels and factors read
  correctly, and replicates share a label.
- **Presenter text reviewed**: display name, summary, description and
  contacts.

Use the dry run's presenter and dataset entries for the last two.

The outcome is one of two commands. When it passes:

```bash
node scripts/mark-ready.js <ACCESSION> ["<what was checked>"]
```

It refuses unless the proposal is on `origin/master`, no update from
`proposal/<ACCESSION>` is awaiting review, and the ticket is at `Proposed` or
`Verification in progress`. It comments `Verified: <note>` once when a note is given, and sets the
Status to `Ready to load`.

When something only the curator can fix is wrong:

```bash
node scripts/request-revision.js <ACCESSION> "<what the curator must fix>"
```

It comments `Needs revision: <reason>` on the ticket once and sets its Status
to `Needs revision`. On a ticket already at `Needs revision` it adds the new
reason and leaves the Status; from `Loading in progress` on it refuses.
The curator's republish returns the ticket to `Proposed`, to be verified
again.

### Step 3: Dry run each Ready to load proposal again

```bash
node scripts/load-proposal.js --dry-run <ACCESSION>
```

Prints the presenter XML and the dataset entry that would be inserted, and
the delivery target, and changes nothing. It checks the project's Status
field and reads the ticket's build and status, all read-only. It refuses a
ticket at `Loading in progress` or later; the real load refuses anything not
at `Ready to load`. Run this for every accession before loading any, since
the rebuild branch may have moved since verification. A proposal merged to `master` after `rebuild<NN>` was cut is reported as
a straggler; the load step cherry-picks it automatically. Fix anything else
it reports (usually a presenter name collision, or a dataset name the
organism file already has) before moving on, or send the proposal back with
`request-revision.js`.

### Step 4: Load

```bash
node scripts/load-proposal.js <ACCESSION>
```

One accession at a time, `Ready to load` only. It prints the hand-off: the
local artifact directory, the `@@manualDeliveryDir@@/...` target, and where
the reads come from. For a build sweep, loop over the accessions from
`list-proposals.js --build <NN> --status ready`; a failure on one does not
affect the others. After each, the working tree is on `load/<ACCESSION>`.
Check out `rebuild<NN>` before the next:

```bash
git checkout rebuild<NN>
```

### Step 5: Report

List the PR URLs, ticket URLs and each hand-off. The user reviews and merges
the PRs into `rebuild<NN>`, and copies each artifact directory to its target.

### Step 6: Mark loaded

After the user says the load PR has merged:

```bash
node scripts/mark-loaded.js <ACCESSION>
```

It refuses unless the pull request from `load/<ACCESSION>` has merged into a
rebuild branch and the ticket is at `Loading in progress`. It then comments
`Loaded into <base>: <PR URL>` on the ticket once and sets its Status to
`Post Load QA`. It finds the ticket in the merged pull request itself, so the
`load/<ACCESSION>` branch may already be deleted. Re-running once the ticket
is at `Post Load QA`, `Final QA` or `Done` changes nothing.

The rest is by hand, outside this skill: the data loaders check the loaded
data and move the ticket to `Final QA`, and the outreach team sets `Done`.

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
