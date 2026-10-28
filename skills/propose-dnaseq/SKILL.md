---
name: propose-dnaseq
description: Propose a DNA-seq (isolate WGS) dataset for VEuPathDB - check the SRA runs are DNA with reads, confirm the organism is released, analyze isolates, curate contacts, write a proposal to VEuPathDatasets with samplesheet and STF, open the PR and ticket
---

# Propose a DNA-seq Dataset

This skill gathers metadata for a DNA-seq (isolate whole-genome sequencing)
dataset, checks its libraries, confirms the organism is on the released site,
analyzes its isolates, curates contacts, and writes a **proposal** to
VEuPathDatasets. It ends with a pull request against `master` and a ticket.
Presenter XML and the dataset entry are rendered later by the `load-proposals`
skill when the data loading team starts a build. See
[proposal workflow](resources/proposal-workflow.md).

DNA-seq proposals are single-organism and read from SRA only.

## Prerequisites Check

The workspace is a **VEuPathDatasets** checkout. Run this from its top
directory before anything else:

```bash
node scripts/check-workspace.js
```

It refuses to run anywhere else, and creates `.curation/` and adds it to the
clone's `.git/info/exclude`. Ticket settings ship with the skills in
`resources/curator.config.json`. To use different settings, for example a test
repository, put a copy at `.curation/curator.config.json` in the checkout.

## Working Directory

All commands run from the top of the VEuPathDatasets checkout.

**For Claude Code**:
- DO NOT `cd` into subdirectories.
- Never push to `master`. The scripts push only to `proposal/<accession>`.

The workflow creates:
- `.curation/tmp/` - intermediate files (ignored by git)
- `.curation/delivery/` - the Step 5 artifact preview (ignored by git)

## Required Information

Ask for all of these before starting:

- **VEuPathDB project** from [resources/valid-projects.json](resources/valid-projects.json)
- **BioProject accession** (e.g. `PRJNA1086165`). If the curator gives a
  BioSample (`SAMN…`, `SAMEA…`, `SAMD…`) instead, look up its BioProject:

  ```bash
  curl -s "https://www.ebi.ac.uk/ena/portal/api/filereport?accession=<SAMN>&result=read_run&fields=study_accession&format=tsv"
  ```

  Show the curator the `study_accession` and confirm it before Step 0. That
  BioProject is the `<ACCESSION>` from here on.
- **Reference organism abbreviation** (e.g. `bcinB05-10`), confirmed with the curator.
  It is the *proposed* abbreviation. Convention: `<g><sp><Strain>`: genus initial plus the first three letters of the species,
  lowercase, then the strain with `.` replaced by `-` and spaces by `_`
  (*Plasmodium falciparum* 3D7 is `pfal3D7`; *Botrytis cinerea* B05.10 is
  `bcinB05-10`). Letters, digits, `.`, `_` and `-` are allowed, starting with a
  letter or digit. Off-convention is a warning now, and Phase 2 stops on it.
- **Rebuild branch** (`rebuildRR`) to check the organism against. Always ask the
  curator; never guess it.

The **target build** is asked for at publish (Step 6), not here.

## Workflow Overview

### Step 0: Start the Proposal

```bash
node scripts/start-proposal.js <ACCESSION> --external-id bioproject=<ACCESSION> [--force-update]
```

Creates `proposal/<ACCESSION>` off a clean, current `master`, refusing if that
branch already exists here or on origin, or if another proposal already covers
the BioProject. A proposal already on master whose manifest records no ticket
is a hard stop, because its status cannot be checked; `--force-update`
overrides that and treats it as proposed. Ask the curator before using it.

**Detailed instructions:** [Step 0 - Start Proposal](resources/step-0-start-proposal.md)

### Step 1: Fetch Metadata and Check the Libraries

```bash
node scripts/fetch-sra-metadata.js <ACCESSION> --no-geo
node scripts/check-library.js <ACCESSION>
```

`fetch-sra-metadata.js` writes `.curation/tmp/<ACCESSION>_sra_metadata.json`:
run metadata from ENA and sample attributes from NCBI BioSample.

`check-library.js` checks the runs are DNA sequencing with reads.
**Exit 1 is a hard stop**: report every `Error:` line to the curator and stop.
**Exit 3** means only some runs fail: show the curator those runs; they must be
left out of the Step 2 annotations (`write-proposal.js` refuses them if used).
Relay every `Warning:` line verbatim. For each warned run, ask the curator
whether to drop it (leave it out of the Step 2 annotations) or accept it.
Never decide for them.

**Detailed instructions:** [Step 1 - Fetch Metadata](resources/step-1-fetch-metadata.md)

### Step 2: Analyze Samples

Claude writes `.curation/tmp/<ACCESSION>_sample_annotations.json`:

- One sample per BioSample, holding all of that BioSample's runs (technical
  replicates). Leave out runs the curator dropped in Step 1.
- Factors are isolate characteristics from the BioSample attributes: strain,
  isolate, host, geographic location, collection date. Keep these even when
  every sample has the same value; add other attributes only when they vary.
  A year-only collection date (`2011`) becomes an integer in the STF; use full
  dates only when the BioSample gives them, never invent one.
- When every BioSample shares one generic title, ids fall back to BioSample
  accessions: propose readable labels (for example from `isolate`) and
  confirm them with the curator.
- No `strandedness` and no `organisms`.
- BioSamples that share strain, sample name and every factor value: show them
  to the curator. They stay separate samples (they may share a label); never
  merge them.

**Detailed instructions:** [Step 2 - Analyze Samples](resources/step-2-analyze-samples.md)

### Step 3: Curate Contacts

Identify and curate contact entries from the BioProject submitter and any
linked publication.

**Actions:**
- Search existing contacts in `Model/lib/xml/datasetPresenters/contacts/allContacts.xml`
- Create new contact entries if needed
- Present choices to curator for review

**Detailed instructions:** [Step 3 - Curate Contacts](resources/step-3-curate-contacts.md)

### Step 4: Confirm the Organism Is Released, Write the Proposal and Preview

```bash
node scripts/check-released-organism.js <ACCESSION> --organism <ORGANISM_ABBREV> \
  --project <PROJECT> --rebuild-branch rebuild<RR> [--released-organism <source_id>]
```

Gene CNV needs the organism's orthomcl paralogs, so the organism must already
be on the released site. The script writes
`.curation/tmp/<ACCESSION>_released_organism.json`.

- **Exit 2**: no released record matches, or several organism files in the
  project share the taxon. It prints candidate records (JSON on stdout). Show them to the curator and ask which one is the organism, or
  whether it is not released yet. On a pick, re-run with
  `--released-organism <source_id>`. "Not released" is a hard stop: the
  organism must be released before this dataset can be proposed. **Never pick
  for the curator.**
- **Exit 1**: no Step 1 SRA metadata, the query failed (or the site's report
  changed shape), or the organism is not on the rebuild branch. Hard stop:
  report the error.

Then:

```bash
node scripts/write-proposal.js \
  --accession <ACCESSION> --external-id bioproject=<ACCESSION> \
  --type dnaseq --project <PROJECT> \
  --organism <ORGANISM_ABBREV> \
  --rebuild-branch rebuild<RR> \
  --primary-contact <PRIMARY_CONTACT_ID> [--contact <ID> ...] \
  --skill propose-dnaseq \
  --input .curation/tmp/<ACCESSION>_sra_metadata.json \
  --input .curation/tmp/<ACCESSION>_released_organism.json \
  --curated .curation/tmp/<ACCESSION>_sample_annotations.json \
  --overrides .curation/tmp/overrides.json

node scripts/render-proposal.js Proposals/<ACCESSION>
node scripts/render-proposal.js --dataset Proposals/<ACCESSION>
```

`write-proposal.js` derives `curated/presenter.json`, the structured record
Phase 2 renders from, `curated/dataset.json`, and the loading artifacts in
`curated/<abbrev>/` (`samplesheet.csv`, `entity-sample.tsv` and `.yaml`). It
refuses to write the proposal until every required field is filled and the
artifacts agree with each other and with the annotations. If a re-run would
change a curated artifact already in the proposal (a hand edit, or changed
annotations), it stops and names the files: ask the curator whether to keep
them (`--keep-edits`) or rewrite them (`--replace-edits`), or which per file
(`--keep-edit <file>`, `--replace-edit <file>`), then re-run with their choice.
Never choose for them. A kept file does not pick up label or factor changes
from the annotations.

The organism is checked against `origin/rebuild<RR>`. An organism that only a
pending genome proposal introduces is refused: it is not released. Relay every
`Warning:` line to the curator verbatim.

Write `.curation/tmp/overrides.json` first. It must give a readable `"name"`
for the experiment, a `"version"` (YYYY-MM-DD, when the data last changed), and
`shortDisplayName` and `shortAttribution` under `"presenter"`, plus any PubMed
IDs. `displayName` is plain text with no HTML tags.

`hasCNVData` is derived from the released assembly's chromosome count (`true`
when it is above 0). Tell the curator its value, and that they, or reviewers
later, can change it under `presenter.injectorProps`. `ploidy` is never set
here: the dataset entry references the organism file's `$$ploidy$$`, and load
sets the constant if it is missing.

Show the curator the default `description` (the first SRA experiment title:
it may have typos or be generic) and `methodology` (every library strategy
among the runs, such as `WXS, WGS` when a warned run is kept) and ask whether
to keep or override each.

Show the curator the rendered XML, adjust the overrides, and re-run until they
approve it. Never edit the rendered XML or `presenter.json`.

**Detailed instructions:** [Step 4 - Write Proposal](resources/step-4-write-proposal.md)

### Step 5: Preview the Loading Artifacts

```bash
node scripts/render-proposal.js --artifacts .curation/delivery Proposals/<ACCESSION>
```

Copies the curated `samplesheet.csv`, `sampleAnnotations.json` and the STF
files under
`.curation/delivery/<Project>/<abbrev>/SNP/<name>/<version>/final/`, after
checking that they agree. It prints where the data loading team will copy
them. Nothing is delivered here: the data loading team copies them and checks
the server. `.curation/delivery` is shared by every proposal previewed in this
checkout; a preview overwrites only this proposal's paths, so never delete the
directory.

**Detailed instructions:** [Step 5 - Preview Artifacts](resources/step-5-preview-artifacts.md)

### Step 6: Publish

```bash
node scripts/publish-proposal.js <ACCESSION> --build <NN>
```

`--build` becomes the ticket's `Build NN` milestone. It is needed only when
publish creates the ticket; to move a proposal to another build later, change
the milestone on GitHub. When updating a proposal that already has a ticket,
omit `--build` (or pass the build its milestone already has).

Commits the proposal and `allContacts.xml`, pushes, opens a PR against
`master`, creates or comments on the ticket (labelled `snp`), records it in the
manifest. If it fails, re-run the same command: publish resumes rather than
duplicating anything.

**Detailed instructions:** [Step 6 - Publish](resources/step-6-publish.md)

## Merging the proposal PR

If asked to merge a proposal PR, run `node scripts/merge-proposal.js
<accession>`, never `gh pr merge`: it merges and moves the ticket from
`Initial draft` to `Proposed`. A person merging in the GitHub UI moves the
card by hand. See [Step 6](resources/step-6-publish.md#merging-the-proposal-pr).

## Next Steps

1. The curator reviews and merges the pull request (the ticket goes from
   `Initial draft` to `Proposed`); the data loading team verifies it later.
2. When the data loading team starts the build named by the ticket's
   milestone, `load-proposals` renders the presenter and the dataset entry,
   confirms the organism's ploidy with the loader, checks the curated loading
   artifacts agree and copies them out for the team, and closes out the proposal.

## Resources

- [Proposal Workflow](resources/proposal-workflow.md)
- [Step 0 - Start Proposal](resources/step-0-start-proposal.md)
- [Step 1 - Fetch Metadata](resources/step-1-fetch-metadata.md)
- [Step 2 - Analyze Samples](resources/step-2-analyze-samples.md)
- [Step 3 - Curate Contacts](resources/step-3-curate-contacts.md)
- [Step 4 - Write Proposal](resources/step-4-write-proposal.md)
- [Step 5 - Preview Artifacts](resources/step-5-preview-artifacts.md)
- [Step 6 - Publish](resources/step-6-publish.md)
- [Editing Large XML Files](resources/editing-large-xml.md)
- [Valid VEuPathDB Projects](resources/valid-projects.json)

## Scripts

- `scripts/fetch-sra-metadata.js` - Fetches SRA run metadata from ENA + BioSample attributes from NCBI
- `scripts/check-library.js` - Checks the runs are DNA sequencing with reads: hard stops and warnings
- `scripts/check-released-organism.js` - Confirms the organism is on the released site and records its chromosome count
- `scripts/start-proposal.js`, `scripts/write-proposal.js`, `scripts/publish-proposal.js`, `scripts/merge-proposal.js` - proposal lifecycle
- `scripts/render-proposal.js` - preview the presenter XML, the dataset entry (`--dataset`) and the loading artifacts (`--artifacts`)
- `scripts/check-workspace.js` - Confirms the VEuPathDatasets checkout and prepares `.curation/`
