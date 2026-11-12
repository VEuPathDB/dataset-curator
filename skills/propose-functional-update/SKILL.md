---
name: propose-functional-update
description: Propose a functional annotation update (product names, GO terms, EC numbers, gene names, comments or aliases) for an organism already on VEuPathDB - read the organism's existing entries of the class, stage the curator's tab file on dataStaging, write the proposal (one re-versioned or new dataset entry plus the history row's source) to VEuPathDatasets, open the PR and draft ticket
---

# Propose a Functional Annotation Update

A curator has a tab-separated file of functional annotation for one organism
that is already loaded. This skill records it as a **proposal**: one dataset
entry (the organism's existing entry of that class with a new version, or a
new entry), `curated/update.json` (the history row's source and text), and the
file itself on dataStaging. Column mapping and conversion to the loader format
happen later, at verification. There is no presenter: at load the organism's
genome presenter gets a history row. See
[proposal workflow](resources/proposal-workflow.md).

One class per proposal: `productNames`, `GeneOntologyAssociations`,
`EnzymeCommissionAssociations`, `geneName`, `comments` or `aliases`.

## Prerequisites Check

The workspace is a **VEuPathDatasets** checkout. Run this from its top
directory before anything else:

```bash
node scripts/check-workspace.js
```

Ticket and staging settings ship in `resources/curator.config.json`; a copy at
`.curation/curator.config.json` in the checkout overrides them.

The curator needs passwordless `ssh` to the staging host (`staging.host` in
that config) with write access to its `staging.root`.

## Working Directory

All commands run from the top of the VEuPathDatasets checkout.

**For Claude Code**:
- DO NOT `cd` into subdirectories.
- Never push to `master`. The scripts push only to `proposal/<PROPOSAL>`.

## Required Information

Ask for all of these before starting:

- **The file**: a local path the curator gives.
- **Class**: infer it from the header and content (`GO:0005524` → GO terms,
  `2.7.11.1` → EC numbers, free-text descriptions → product names), then
  confirm it with the curator. If unsure, ask.
- **Organism**: abbreviation (a name is looked up in the project's organism
  files on the rebuild branch, then confirmed) and its **project** from
  [resources/valid-projects.json](resources/valid-projects.json).
- **functionalAnnotationSource** for the history row. There is no default:
  always ask.
- **Curation date** `YYYY-MM-DD`: the entry's new version and the history
  row's `functionalAnnotationVersion`. Not today's date unless the curator
  says so.
- **Rebuild branch** (`rebuildRR`). Always ask; never guess.
- **Primary contact**: the curator's contact id in
  `Model/lib/xml/datasetPresenters/contacts/allContacts.xml`.
- Optional **entry name**, only when the curator means a specific entry or a
  new one.

The proposal id is `<orgAbbrev>_<datasetClass>_<YYYYMMDD>`, with today's date
(the proposing date, not the curation date). Use `<PROPOSAL>` for it below.

## Workflow

### Step 0: Start the Proposal

```bash
node scripts/start-proposal.js <PROPOSAL> --type functional-update
```

Creates `proposal/<PROPOSAL>` off a clean, current `master`. It refuses when
that branch exists here or on origin.

### Step 1: Read the Organism's Entries

```bash
node scripts/check-functional-entries.js <PROPOSAL> --organism <abbrev> --project <Project> \
  --class <datasetClass> --rebuild-branch rebuildRR
```

Writes `.curation/tmp/<PROPOSAL>_organism_entries.json` and prints the
organism's entries of the class with their versions. Show them to the curator:

- One entry, no name given: that entry gets the new version.
- Several entries: ask which one, and pass its `name`.
- A name that does not exist is a **new entry**. Confirm explicitly that a new
  entry is meant, not a typo, before setting `newEntry`.

A genome proposal on master naming the organism is a hard stop: the update
waits until that genome loads. An organism file missing from the rebuild
branch means the organism is not loaded: hard stop.

### Step 2: Stage the File

```bash
node scripts/stage-file.js <PROPOSAL> <file>
```

Uploads the file with `rsync` to `<staging.root>/<PROPOSAL>/` on the staging
host and writes `.curation/tmp/<PROPOSAL>_staged.json`. The proposal
directory is created group-writable and setgid (`2775`) and the file group
read/write, so the data loaders can manage them. It checks the sha256 before
and after the upload and prints the `staging` override to use in Step 3.

- Re-running with the same file is safe: it reports it already staged.
- A different file of the same name already there is refused. Ask the data
  loaders; never delete or overwrite it yourself.
- An ssh failure names the passwordless-ssh requirement: the curator sets up
  their key, then re-run.

### Step 3: Write the Proposal

Write `.curation/tmp/<PROPOSAL>_overrides.json`:

```json
{
  "version": "<curation date>",
  "update": { "datasetClass": "<class>", "functionalAnnotationSource": "<source>" },
  "staging": [{ "path": "<file name>", "sha256": "<from stage-file>" }]
}
```

Add `"name": "<entry>"` at the top level when the curator named an entry, and
`"newEntry": true` inside `update` for a confirmed new one. `update.text`
replaces the history row's default text (`functional annotation updated`)
only when the curator asks. No `presenter` or `dataset` overrides: the entry's
props come from the organism file (a new entry takes the class defaults).

```bash
node scripts/write-proposal.js \
  --accession <PROPOSAL> --type functional-update --project <Project> --organism <abbrev> \
  --rebuild-branch rebuildRR --primary-contact <CONTACT_ID> --skill propose-functional-update \
  --input .curation/tmp/<PROPOSAL>_organism_entries.json \
  --input .curation/tmp/<PROPOSAL>_staged.json \
  --overrides .curation/tmp/<PROPOSAL>_overrides.json
```

Add `--input <file>` too when the file is at most 1 MiB, so reviewers can read
it in the pull request. A larger file is only on dataStaging.

Refusals name the fix: a version not later than the entry's current one, a
current version that is not a date, a `staging` that does not match the
staged file, an unknown entry name, a missing `functionalAnnotationSource`.
Fix the input or the override and re-run. Relay every `Warning:` line.

Preview the entry:

```bash
node scripts/render-proposal.js --dataset Proposals/<PROPOSAL>
```

### Step 4: Publish

Ask the curator for the target build (`NN`), then:

```bash
node scripts/publish-proposal.js <PROPOSAL> --build <NN>
```

Commits the proposal, pushes, opens a PR against `master`, and creates the
ticket (labelled `functional annotation`, Status `Initial draft`) under the
`Build NN` milestone. When updating a proposal that already has a ticket, omit
`--build`. If it fails, re-run the same command: publish resumes.

## Merging the proposal PR

If asked to merge a proposal PR, run `node scripts/merge-proposal.js
<PROPOSAL>`, never `gh pr merge`: it merges and moves the ticket from
`Initial draft` to `Proposed`.

## Next Steps

1. The curator reviews and merges the pull request.
2. The data loading team verifies it with `verify-functional-update`: maps
   the file's columns, converts it against the organism's released GFF.
3. At load, the entry gets its new version (or is added) and the genome
   presenter gets a history row for the build.

## Resources

- [Proposal Workflow](resources/proposal-workflow.md)
- [Valid VEuPathDB Projects](resources/valid-projects.json)

## Scripts

- `scripts/check-functional-entries.js` - The organism's entries of the class, its constants and any pending genome proposal
- `scripts/stage-file.js` - Uploads the curator's file to dataStaging (the one remote write)
- `scripts/start-proposal.js`, `scripts/write-proposal.js`, `scripts/publish-proposal.js`, `scripts/merge-proposal.js` - proposal lifecycle
- `scripts/render-proposal.js` - preview the dataset entry (`--dataset`)
- `scripts/check-workspace.js` - Confirms the VEuPathDatasets checkout and prepares `.curation/`
