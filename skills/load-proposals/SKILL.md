---
name: load-proposals
description: Data loading team - at build start sync contacts, merge the rebuild branch back and clean loaded proposals and their local deliveries; bring Ready to load proposals from VEuPathDatasets Proposals/ on origin/master into presenter and dataset XML on a rebuild branch, re-running content validation first, one PR per proposal, set each ticket's project Status to Loading in progress, and to Post Load QA once the load PR merges
---

# Load Dataset Proposals

Runs on a `rebuild<RR>` branch of VEuPathDatasets (a database rebuild; one rebuild feeds many `Build NN` website releases).
Proposals are verified before this skill runs (`verify-bulk-rnaseq`; genomes by hand for now). For each `Ready to load` proposal whose
ticket is in a release being loaded (its `Build <NN>` milestone) it renders the presenter and, for dataset types with a
`classes.xml` class (bulk RNA-seq), the `<dataset>` entry for
`Datasets/lib/xml/datasets/<Project>/<organismAbbrev>.xml`. One load adds a
presenter, plus a `<dataset>` per organism. A proposal aligned
to several organisms has one presenter, written to the first organism's project
file, and a `<dataset>` per organism in each organism's own project. It reads the
proposal from `origin/master` and commits the rendered XML (plus master's
`allContacts.xml` when it differs) once on `load/<accession>`, cut from
`rebuild<RR>`. The proposal never goes onto the rebuild branch. It pushes the
branch, opens a PR against `rebuild<RR>`, and sets the ticket's Status on the GitHub Project to
`Loading in progress`. Preprocessing
(`verify-bulk-rnaseq`, `prepare-delivery.js`) already wrote the loading
artifacts to the validation workspace's `delivery/<ACCESSION>/` and settled the
organisms; load only renders XML. For RNA-seq and DNA-seq it settles
organisms as the delivery record says and refuses a record for another rebuild
branch, an earlier proposal or a settlement that drifted: send it back through
prepare-delivery and mark-ready.

**Copying the delivery to the server (the rsync posted on the ticket), fetching
or linking the reads, and checking them there are the data loading team's
steps.** No script touches the server. Per-type code lives in
`scripts/dataset-types/`.

See [proposal workflow](resources/proposal-workflow.md) for the branch model.

## Prerequisites Check

```bash
node scripts/check-workspace.js
git branch --show-current
git status -sb
```

The branch must be `rebuild<RR>` and clean. If not, stop and tell the user;
do not check out or pull for them. Ticket settings ship in
`resources/curator.config.json`, overridable per clone at
`.curation/curator.config.json`.

## Working Directory

Run everything from the top of the VEuPathDatasets checkout. Never `cd` into
subdirectories. Never push to `rebuild*` or `master`; the scripts push only
to `load/<accession>`, `sync-contacts/*` and `clean-proposals/*`.

## Required Information

- The **rebuild branch** `rebuild<RR>` (ask; never guess it from a `Build NN` milestone or the checked-out branch). Pass it as `--rebuild-branch rebuild<RR>` on every `load-proposal.js` and `check-organisms.js` call; it is required.
- The **validation workspace root** `<root>` (ask the data loader; never guess). Load re-runs the content validators in `<root>/<type>-validation/loads/rebuild<RR>/` (each dataset type maps to its own directory: bulk RNA-seq uses `rnaseq-validation/loads/rebuild<RR>/`; genome assembly, `annotated-genome-validation/`, has no validators yet), worktrees of each repo at `rebuild<RR>` (repos marked `followsRebuild`) or their pinned ref, shared by every load in the rebuild, and refuses on any error. Add `--refresh` when a tool fix lands mid-build. Run one validation at a time per dataset type: the base clones in `repos/` are shared.
- Optionally a **release** `<NN>` to narrow the listing, or a single **accession**.

## Workflow

### Build start

Once at the start of each website build, run the steps in order. Each but the last opens a
PR; wait for the user to merge it before running the next, and never merge for
them:

```bash
node scripts/start-build.js --rebuild-branch rebuild<RR> --build <NN> sync-contacts
node scripts/start-build.js --rebuild-branch rebuild<RR> --build <NN> merge-back
node scripts/start-build.js --rebuild-branch rebuild<RR> --build <NN> --workspace <root> clean-proposals
node scripts/start-build.js --workspace <root> reset-load-workspaces
```

- `sync-contacts` copies master's `allContacts.xml` onto `rebuild<RR>`
  (contacts are only ever edited on master). It does nothing when they match.
  It needs the checkout on a clean, current `rebuild<RR>`.
- `merge-back` opens the PR merging `rebuild<RR>` into master. It refuses while
  the contacts differ. If `sync-contacts` reported an already-open PR but master
  gained more contacts since, merge-back still refuses: update that sync branch,
  or close it and re-run `sync-contacts`.
- `clean-proposals` refuses until the merge-back has merged. It deletes from
  master the proposals whose ticket is in an earlier build and at `Post Load
  QA`, `Final QA` or `Done`, and removes those proposals' local
  `delivery/<ACCESSION>/` under `--workspace`; the server's delivery archive
  keeps them. Proposals whose ticket cannot be read are kept and reported.
- `reset-load-workspaces` removes every `<type>-validation/loads/rebuild<digits>/` under `<root>` (for bulk RNA-seq, `rnaseq-validation/loads/rebuild*/`) so this build's loads validate against fresh code. It takes only `--workspace`. Run it after `merge-back` merges; it opens no PR. It removes all or nothing, and refuses a load workspace with edits (revert or delete it by hand).
- If master gains contacts after the merge-back PR is opened, that PR can
  conflict in `allContacts.xml`; take master's copy (see
  [recovery](resources/recovery.md)) or re-run `sync-contacts` first.
- Branches are `sync-contacts/rebuild<RR>-build-<NN>` and
  `clean-proposals/build-<NN>`. A leftover one with no open PR is refused with
  the command that deletes it.

`sync-contacts` and `clean-proposals` leave the checkout on their own branch.
Before Step 0, go back to the rebuild branch:

```bash
git checkout rebuild<RR>
git pull
```

`rebuild<RR>` is cut once and kept across builds; the merge-back brings it into
master at each build start.

### Step 0: Check organisms

```bash
node scripts/check-organisms.js --rebuild-branch rebuild<RR> [--build <NN>]
```

Reports, for every `Ready to load` proposal (of release `<NN>` when given), how each proposed
organism abbreviation would settle. Show the loader every `STOP`.

A stop ending `(a person may decide with --settle ...)` is cleared only by the
loader choosing an abbreviation in this conversation. **Never pass `--settle`
on your own judgment.** For RNA-seq and DNA-seq it is settled at preprocessing
(`prepare-delivery.js --settle`); load refuses `--settle` for them. Genome
assemblies are still settled at load. The other stops cannot be settled: a taken
abbreviation, a twin with the same taxon and strain, an abbreviation proposed
by another genome proposal (rival claim), a missing organism file.
They go back to the curator with `request-revision.js`.

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
alongside it. The listing reads `origin/master`. If the table is empty, check whether the
expected proposals were merged to `master` or already removed by
`clean-proposals`; see [preconditions](resources/preconditions.md).

### Step 2: Verification

Verification is not part of loading. Bulk RNA-seq proposals are verified with
the `verify-bulk-rnaseq` skill, which leaves a verification report and the
delivery record on the ticket and moves it to `Ready to load`. Genome and DNA-seq proposals have no
verify skill yet: check them by hand (the dry run in Step 3 is the automated part): presenter
text reads sensibly, the reads or assembly are reachable, and the organism
abbreviation is right. A DNA-seq proposal also needs
`prepare-delivery.js --workspace <root> --against origin/rebuild<RR> <ACCESSION>` first.
Then
`node scripts/mark-ready.js <ACCESSION> "<what was checked>"` or
`node scripts/request-revision.js <ACCESSION> "<reason>"`.

### Step 3: Dry run each Ready to load proposal again

```bash
node scripts/load-proposal.js --rebuild-branch rebuild<RR> --workspace <root> --dry-run <ACCESSION>
```

Prints the presenter XML and the dataset entry that would be inserted, and
and changes nothing. For RNA-seq and DNA-seq with no delivery record it warns and settles afresh. It checks the project's Status
field and reads the ticket's build and status, all read-only. It refuses a
ticket at `Loading in progress` or later; the real load refuses anything not
at `Ready to load`. Run this for every accession before loading any, since
the rebuild branch may have moved since verification. Fix anything it reports (usually a presenter name collision, or a dataset name the
organism file already has) before moving on, or send the proposal back with
`request-revision.js`.

### Step 4: Load

```bash
node scripts/load-proposal.js --rebuild-branch rebuild<RR> --workspace <root> <ACCESSION>
```

For a genome assembly, a person's choice adds `--settle <proposed>=<abbrev>`
(repeatable); RNA-seq and DNA-seq refuse it, since the delivery record carries
the settlement. Settling a genome away from a taken or claimed proposed
abbreviation is allowed and is noted in the load PR. A resumed genome load
needs the same `--settle` as the run that committed. Every resume needs the
same `--rebuild-branch`; a resume from a load branch cut from another rebuild
branch is refused.

Load genome proposals before the datasets that link to them. A linked dataset
loads only after its genome's load PR has merged into `rebuild<RR>`: it
resolves the organism by the organism file's `ncbiTaxonId` and `strainAbbrev`.
Genome loads do not yet write the organism file, so linked datasets stop until
that lands, unless a person settles one onto an existing organism file with
`--settle`.

The load PR lists each organism's settled abbreviation and any difference from
the proposal.

One accession at a time, `Ready to load` only. It prints the STF corpus step
for the person to run once the delivery is on the server (RNA-seq:
`ssh <host> '<root>/common/rnaSeq/sampleDetailsForEda/make-cumulative-links.sh <YYYY-MM>'`;
DNA-seq: merge `incoming/` by hand for now). For a build sweep, loop over the
accessions from `list-proposals.js --build <NN> --status ready`; a failure on
one does not affect the others. After each, the working tree is on
`load/<ACCESSION>`. Check out `rebuild<RR>` before the next:

```bash
git checkout rebuild<RR>
```

#### DNA-seq: the organism's ploidy

A DNA-seq dataset entry references the organism file's `$$ploidy$$`. When the
organism file has no `<constant name="ploidy">`, `load-proposal.js` stops, in
the Step 3 dry run as well as the load, with
`<abbrev> has no ploidy constant; confirm the value with the data loader, then pass --ploidy <abbrev>=<N>`.

1. Propose a value with a one-line biological rationale (for example,
   *Candida albicans* SC5314: 2, an obligate diploid; most filamentous fungi
   and apicomplexan blood stages: 1, haploid).
2. Ask the data loader to confirm or correct it.
3. Re-run with their value:

   ```bash
   node scripts/load-proposal.js --rebuild-branch rebuild<RR> [--dry-run] --ploidy <abbrev>=<N> <ACCESSION>
   ```

   DNA-seq has no content validators yet, so `--workspace` is not needed.
   The load inserts the constant after the organism file's last top-level
   `<constant>`. Pass the same `--ploidy` to the dry run and the load. A
   resumed load (its branch already holds the load commit) ignores `--ploidy`;
   so does a load whose type or organisms do not use it, with a
   `Warning: --ploidy <abbrev> was not used: ...` to relay.

**Never pass `--ploidy` without the loader's confirmation in this
conversation.** When the organism file already has a ploidy constant and
`--ploidy` gives a different value, the load stops
(`<abbrev> already has ploidy <M>; --ploidy says <N>`). That is a hard stop:
report it to the loader, and do not edit the organism file.

### Step 5: Report

List the PR URLs, ticket URLs and each printed STF corpus step. The user
reviews and merges the PRs into `rebuild<RR>`. After the load PR, run the
printed STF corpus step once the delivery is on the server.

### Step 6: Mark loaded

After the user says the load PR has merged:

```bash
node scripts/mark-loaded.js <ACCESSION>
```

It reads the proposal's ticket from `origin/master` and refuses unless the
pull request from `load/<ACCESSION>` has merged into a rebuild branch and the
ticket is at `Loading in progress`. The merged pull request must name that
ticket (`Part of ...` in its body); an earlier load of the same accession for
another ticket is refused. When the proposal is no longer on master
(`clean-proposals` removed it), set the Status by hand. It then comments
`Loaded into <base>: <PR URL>` on the ticket once and sets its Status to
`Post Load QA`. The `load/<ACCESSION>` branch may already be deleted. Re-running once the ticket
is at `Post Load QA`, `Final QA` or `Done` changes nothing.

The rest is by hand, outside this skill: the data loaders check the loaded
data and move the ticket to `Final QA`, and the outreach team sets `Done`.

## Merging the proposal PR

If you are asked to merge a proposal PR, run:

```bash
node scripts/merge-proposal.js <ACCESSION>
```

Never run `gh pr merge` directly. merge-proposal merges with a merge commit
(the `proposal/<ACCESSION>` branch is kept), comments `Merged <PR URL>` on
the ticket once and moves it to `Proposed`. It refuses unless the ticket is at
`Initial draft` or `Proposed`, and refuses with the ticket unchanged if GitHub
cannot merge the PR, or reports it queued or pending rather than merged (a
merge queue or required checks): the ticket moves only once GitHub reports
the PR merged. It merges only a PR into master. If it fails after the merge, re-run it: it finishes the
note and status without merging again. A person who merges in the GitHub UI
moves the card to `Proposed` by hand.

## Recovery

If a load fails, the branch is left in place. Re-running resumes when the
branch's head is this accession's load commit and the error's last line says so; otherwise it tells you how to start over. See
[recovery](resources/recovery.md).

## Resources

- [Proposal Workflow](resources/proposal-workflow.md)
- [Preconditions](resources/preconditions.md)
- [Recovery](resources/recovery.md)

## Scripts

- `scripts/check-organisms.js` - how each proposed organism would settle, per build
- `scripts/list-proposals.js` - proposals on `origin/master`, filter by build
- `scripts/prepare-delivery.js` - preprocessing: settle organisms and write the manual delivery to the validation workspace (see `verify-bulk-rnaseq`)
- `scripts/start-build.js` - build start: `sync-contacts`, `merge-back`, `clean-proposals`, `reset-load-workspaces`
- `scripts/load-proposal.js` - load one proposal; `--dry-run` to preview
- `scripts/render-proposal.js` - render the presenter (default), dataset entry (`--dataset`) or artifacts (`--artifacts <dir>`) for any proposal directory; it previews the *proposed* organism names, which may differ from the settled names in the load PR
- `scripts/dataset-types/<type>.js` - presenter, dataset entry and artifacts per dataset type
- `scripts/check-workspace.js` - workspace check

All scripts are synced from `shared/` in dataset-curator.
