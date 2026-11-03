---
name: propose-chipseq
description: Propose a ChIP-seq dataset (histone modification, TF binding, MNase, FAIRE or DNase) for VEuPathDB - check the SRA runs, pair ChIP samples with their input controls, choose the experiment type, curate contacts, write a proposal to VEuPathDatasets with samplesheet and STF, open the PR and ticket
---

# Propose a ChIP-seq Dataset

This skill gathers metadata for a ChIP-seq dataset, checks its libraries,
pairs the ChIP samples with their input controls, curates contacts, and writes
a **proposal** to VEuPathDatasets. It covers every `chipSeqExperiment`
experiment type: `histonemod`, `histonemod_noInput`, `tfbinding`, `mnase`,
`faire` and `dnase`. It ends with a pull request against `master` and a
ticket. Presenter XML and the dataset entry are rendered later by the
`load-proposals` skill when the data loading team starts a build. See
[proposal workflow](resources/proposal-workflow.md).

ChIP-seq proposals are single-organism and read from SRA only.

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
- Never push to `master`. The scripts push only to `proposal/<PROPOSAL>`.

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
  The organism must already be loaded on the rebuild branch, or be proposed by
  a genome proposal for the same build or an earlier one. `write-proposal.js`
  warns when only a genome proposal introduces it, and load waits for that
  genome.
- **Rebuild branch** (`rebuildRR`) to check the organism against. Always ask the
  curator; never guess it.

The **target build** is asked for at publish (Step 6), not here.

## Workflow Overview

### Step 0: Start the Proposal

```bash
node scripts/start-proposal.js <ACCESSION> --type chipseq --external-id bioproject=<ACCESSION> [--force-update]
```

Prints `proposalId`: the accession, or `<ACCESSION>_<type>` when a proposal of
another dataset type already has the accession (one study, several types).
Use `<PROPOSAL>` for that id from here on. Creates `proposal/<PROPOSAL>` off a
clean, current `master`, refusing if that branch already exists here or on
origin, or if another proposal of this type already covers the accession.
A proposal already on master whose manifest records no ticket is a hard stop,
because its status cannot be checked; `--force-update` overrides that and
treats it as proposed. Ask the curator before using it.

**Detailed instructions:** [Step 0 - Start Proposal](resources/step-0-start-proposal.md)

### Step 1: Fetch Metadata and Check the Libraries

```bash
node scripts/fetch-sra-metadata.js <ACCESSION> --no-geo
node scripts/check-library.js <ACCESSION> --type chipseq
```

`fetch-sra-metadata.js` writes `.curation/tmp/<ACCESSION>_sra_metadata.json`:
run metadata from ENA and sample attributes from NCBI BioSample.

`check-library.js` checks the runs are sequencing with reads and that their
library strategy is one the experiment types use. The accepted strategies are
ChIP-Seq, MNase-Seq, FAIRE-seq, DNase-Hypersensitivity, and WGS for inputs.
**Exit 1 is a hard stop**: report every `Error:` line to the curator and stop.
**Exit 3** means only some runs fail: show the curator those runs; they must be
left out of the Step 2 annotations (`write-proposal.js` refuses them if used).
Relay every `Warning:` line verbatim. For each warned run, ask the curator
whether to drop it (leave it out of the Step 2 annotations) or accept it.
Never decide for them.

```bash
node scripts/check-experiments.js <ACCESSION>
node scripts/find-publications.js <ACCESSION>
```

`check-experiments.js` flags BioSamples whose runs span differing SRA
experiments (SRX). `find-publications.js` writes
`.curation/tmp/<ACCESSION>_publications.json`; the curator confirms each
candidate paper. Read only the relevant Methods, then the curator chooses split
or merge per flagged BioSample. Follow the resource below.

**Detailed instructions:** [Step 1 - Fetch Metadata](resources/step-1-fetch-metadata.md)

### Step 2: Analyze Samples

Claude writes `.curation/tmp/<ACCESSION>_sample_annotations.json`:

- One sample per SRA experiment group: one SRX, or several SRX of one
  BioSample that are unflagged or that the curator merged in Step 1 (with
  `"experimentsMerged": "<reason>"`).
  Leave out runs the curator dropped in Step 1.
- Every sample has an explicit `sampleId`, because input pairing refers to it.
- Every sample has `role`: `"chip"` or `"input"`. A ChIP sample with a control
  has `"input": "<sampleId of its input>"`. Several ChIP samples may share one
  input. A ChIP sample has at most one input. Inputs never name an input. An
  empty or absent `input` both mean "no input control".
- Identify inputs from sample titles, `library_name` and BioSample attributes
  (for example `input`, `IgG`, `mock`, `whole cell extract`). Pair them by
  matching the remaining title tokens (life stage, replicate, strain). Show
  the curator the proposed pairs as a table and confirm them. **Never guess a
  pairing.** An unclear pair is the curator's call.
- Factors: `target` (the antibody, histone mark or TF, for example
  `H3K4me3`; `input` for inputs), plus whatever varies (life stage, strain,
  treatment, timepoint). Don't add a `role` factor: the STF gets a `role`
  column automatically.
- When every BioSample shares one generic title, ids fall back to BioSample
  accessions: propose readable labels and confirm them with the curator.
- No `strandedness` and no `organisms`.
- A split BioSample's samples get `<title>_<SRX>` or `<BioSample>_<SRX>` ids
  and default labels ending in their SRX; suggest a shorter `sampleId` and a
  readable label when those are long or generic. Describe how each was derived
  (a `replicate` or `timepoint` factor, for example) from the Methods or SRA
  metadata; never invent it.
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

### Step 4: Write the Proposal and Preview

```bash
node scripts/write-proposal.js \
  --accession <ACCESSION> --proposal <PROPOSAL> --external-id bioproject=<ACCESSION> \
  --type chipseq --project <PROJECT> \
  --organism <ORGANISM_ABBREV> \
  --rebuild-branch rebuild<RR> \
  --primary-contact <PRIMARY_CONTACT_ID> [--contact <ID> ...] \
  --skill propose-chipseq \
  --input .curation/tmp/<ACCESSION>_sra_metadata.json \
  --curated .curation/tmp/<ACCESSION>_sample_annotations.json \
  --overrides .curation/tmp/overrides.json

node scripts/render-proposal.js Proposals/<PROPOSAL>
node scripts/render-proposal.js --dataset Proposals/<PROPOSAL>
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
from the annotations. Never hand-edit `curated/dataset.json`, any more than
`presenter.json`: the renderer re-checks its derived props against the runs
and refuses a file that disagrees.

The organism must be loaded on `origin/rebuild<RR>`, or proposed by a genome
proposal for the same build or an earlier one. Relay every `Warning:` line to
the curator verbatim.

Write `.curation/tmp/overrides.json` first. It must give a readable `"name"`
for the experiment, a `"version"` (YYYY-MM-DD, when the data last changed), and
`shortDisplayName` and `shortAttribution` under `"presenter"`, plus the PubMed
IDs confirmed in Step 1 as `pubmedIds`. `displayName` is plain text with no
HTML tags. It must also give
`"dataset": { "props": { "experimentType": "<type>" } }`. Claude suggests the
type, and **the curator confirms it**:

- `histonemod`: histone marks with inputs
- `histonemod_noInput`: histone marks without inputs
- `tfbinding`: transcription factors and other chromatin proteins
- `mnase`, `faire`, `dnase`: from the library strategy

`extraBowtieParams` may be set under `dataset.props`. It defaults to empty.
Never set it unless the curator or the paper asks for specific bowtie2 options.
`hasPairedEnds`, `readsFileType` and `fromSRA` are derived. Runs that mix
single- and paired-end layouts are refused: ask the curator which runs to drop.

**Peaks:** tell the curator that peaks are called only for `histonemod`, and
only for ChIP samples that have an input. `hasCalledPeaks` follows
`experimentType` and cannot be overridden.

`write-proposal.js` also prints a `Warning:` line for unused inputs, ChIP
samples without an input, and runs whose library strategy doesn't match the
experiment type. Relay each verbatim and ask the curator about it.

The default `displayName` is `<assay> analysis of <species>`, where the assay
is the used runs' most common non-WGS library strategy (DNase-Hypersensitivity
shows as DNase-Seq, FAIRE-seq as FAIRE-Seq). Show it with the
`description` (the first SRA experiment title: it may have typos or be
generic) and `methodology` defaults, and ask whether to keep or override each.

Show the curator the rendered XML, adjust the overrides, and re-run until they
approve it. Never edit the rendered XML or `presenter.json`.

**Detailed instructions:** [Step 4 - Write Proposal](resources/step-4-write-proposal.md)

### Step 5: Preview the Loading Artifacts

```bash
node scripts/render-proposal.js --artifacts .curation/delivery Proposals/<PROPOSAL>
```

Copies the curated `samplesheet.csv` and `sampleAnnotations.json` under
`.curation/delivery/<Project>/<abbrev>/chipSeq/<name>/<version>/final/`, after
checking that they agree. The samplesheet has four columns,
`sample,fastq_1,fastq_2,input`. The STF files
(`curated/<abbrev>/entity-sample.{tsv,yaml}`) are not previewed: preprocessing
puts them in the STF corpus. It prints a preview of the target. Nothing is
delivered here: preprocessing writes the real delivery. `.curation/delivery`
is shared by every proposal previewed in this checkout; a preview overwrites
only this proposal's paths, so never delete the directory.

**Detailed instructions:** [Step 5 - Preview Artifacts](resources/step-5-preview-artifacts.md)

### Step 6: Publish

```bash
node scripts/publish-proposal.js <PROPOSAL> --build <NN>
```

`--build` becomes the ticket's `Build NN` milestone. It is needed only when
publish creates the ticket; to move a proposal to another build later, change
the milestone on GitHub. When updating a proposal that already has a ticket,
omit `--build` (or pass the build its milestone already has).

Commits the proposal and `allContacts.xml`, pushes, opens a PR against
`master`, creates or comments on the ticket (labelled `chipseq`), records it in the
manifest. If it fails, re-run the same command: publish resumes rather than
duplicating anything.

**Detailed instructions:** [Step 6 - Publish](resources/step-6-publish.md)

## Merging the proposal PR

If asked to merge a proposal PR, run `node scripts/merge-proposal.js
<PROPOSAL>`, never `gh pr merge`: it merges and moves the ticket from
`Initial draft` to `Proposed`. A person merging in the GitHub UI moves the
card by hand. See [Step 6](resources/step-6-publish.md#merging-the-proposal-pr).

## Next Steps

1. The curator reviews and merges the pull request (the ticket goes from
   `Initial draft` to `Proposed`); the data loading team verifies it later.
2. When the data loading team starts the build named by the ticket's
   milestone, `load-proposals` renders the presenter and the dataset entry,
   checks the curated loading artifacts agree and copies them out for the
   team, and closes out the proposal.

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
- `scripts/check-library.js` - Checks the runs' library source, depth and strategy (`--type chipseq`): hard stops and warnings
- `scripts/check-experiments.js` - Reports BioSamples whose runs span differing SRA experiments
- `scripts/find-publications.js` - Linked papers for the BioProject, else Europe PMC candidates to confirm, with full-text links
- `scripts/start-proposal.js`, `scripts/write-proposal.js`, `scripts/publish-proposal.js`, `scripts/merge-proposal.js` - proposal lifecycle
- `scripts/render-proposal.js` - preview the presenter XML, the dataset entry (`--dataset`) and the loading artifacts (`--artifacts`)
- `scripts/check-workspace.js` - Confirms the VEuPathDatasets checkout and prepares `.curation/`
