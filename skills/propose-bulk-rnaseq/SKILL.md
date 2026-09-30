---
name: propose-bulk-rnaseq
description: Propose a bulk RNA-seq dataset for VEuPathDB - fetch SRA/GEO metadata, analyze samples, curate contacts, write a proposal to VEuPathDatasets, generate pipeline configs, open the PR and ticket
---

# Propose a Bulk RNA-seq Dataset

This skill gathers metadata for a bulk RNA-seq dataset, analyzes its samples,
curates contacts, and writes a **proposal** to VEuPathDatasets. It ends with a
pull request against `master` and a ticket. Presenter XML is rendered later by
the `load-proposals` skill when the data loading team starts a build. See
[proposal workflow](resources/proposal-workflow.md).

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
- **BioProject accession** (e.g. `PRJNA1018599`)
- **Reference organism abbreviation** (e.g. `afumAf293`), confirmed with the curator
- Optionally, **additional organisms** the reads should also be aligned to, by abbreviation

The **target build** is asked for at publish (Step 6), not here.

## Optional: Journal Article PDF

If a journal article is available for this dataset, providing it enhances the curation workflow:

- **Better descriptions**: Abstract and introduction provide richer experiment context
- **Strandedness detection**: Methods section reveals library prep protocol
- **Contact identification**: Author affiliations clarify roles (experimentalist, analyst, submitter)
- **Sample annotation context**: Methods help decode unclear sample metadata

**To include a PDF:**
1. Download the article PDF
2. Copy it to `.curation/tmp/<BIOPROJECT>_article.pdf` (e.g., `.curation/tmp/PRJNA1018599_article.pdf`)
3. Tell Claude the PDF is available when starting Step 1

The PDF will be processed by a subagent once in Step 1 and extracted data saved to `.curation/tmp/<BIOPROJECT>_pdf_extracted.json` for use throughout the workflow.

## Workflow Overview

### Step 0: Start the Proposal

```bash
node scripts/start-proposal.js <BIOPROJECT> [--force-update]
```

Creates `proposal/<BIOPROJECT>` off a clean, current `master`, refusing if that
branch already exists here or on origin. A proposal already on master whose
manifest records no ticket is a hard stop, because its status cannot be
checked; `--force-update` overrides that and treats it as proposed. Ask the
curator before using it. Nothing from the printed JSON is needed later.

**Detailed instructions:** [Step 0 - Start Proposal](resources/step-0-start-proposal.md)

### Step 1: Fetch Metadata (and Extract PDF)

Fetch run-level metadata from ENA and sample attributes from NCBI BioSample. If a journal article PDF is available, extract key information for use in later steps.

**Commands:**
```bash
node scripts/fetch-sra-metadata.js <BIOPROJECT>
```

**Output:** `.curation/tmp/<BIOPROJECT>_sra_metadata.json`

**Optional - Fetch MINiML for GEO-linked datasets:**
```bash
node scripts/fetch-miniml.js <BIOPROJECT>
```

**Output:** `.curation/tmp/<GSE>_family.xml` (if GEO-linked)

**Optional - Extract PDF data:**

If `.curation/tmp/<BIOPROJECT>_article.pdf` is present, a subagent will extract it (do not read it yourself).

**Output (on success):** `.curation/tmp/<BIOPROJECT>_pdf_extracted.json`

**Detailed instructions:** [Step 1 - Fetch Metadata](resources/step-1-fetch-metadata.md)

### Step 2: Analyze Samples

Claude analyzes the fetched metadata to:
1. Identify experimental factors (attributes that vary between samples)
2. Generate sample annotations with meaningful labels
3. Group technical replicates
4. Determine strand specificity

If the reads are not in SRA, this step is a conversation with the curator
instead; see "Reads not in SRA" in the step's instructions.

**Output:** `.curation/tmp/<BIOPROJECT>_sample_annotations.json`

**Detailed instructions:** [Step 2 - Analyze Samples](resources/step-2-analyze-samples.md)

### Step 3: Curate Contacts

Identify and curate contact entries from GEO contributors or BioProject submitters.

**Actions:**
- Search existing contacts in `Model/lib/xml/datasetPresenters/contacts/allContacts.xml`
- Create new contact entries if needed
- Present choices to curator for review

**Detailed instructions:** [Step 3 - Curate Contacts](resources/step-3-curate-contacts.md)

### Step 4: Write the Proposal and Preview

```bash
node scripts/write-proposal.js \
  --accession <BIOPROJECT> --type bulk-rnaseq --project <PROJECT> \
  --organism <ORGANISM_ABBREV> [--also-organism <ABBREV> ...] \
  --primary-contact <PRIMARY_CONTACT_ID> [--contact <ID> ...] \
  --skill propose-bulk-rnaseq \
  --input .curation/tmp/<BIOPROJECT>_sra_metadata.json \
  [--input .curation/tmp/<GSE>_family.xml] [--input .curation/tmp/<BIOPROJECT>_pdf_extracted.json] \
  --curated .curation/tmp/<BIOPROJECT>_sample_annotations.json \
  --overrides .curation/tmp/overrides.json

node scripts/render-proposal.js Proposals/<BIOPROJECT>
node scripts/render-proposal.js --dataset Proposals/<BIOPROJECT>
```

For reads not in SRA (a server or URLs), there is no SRA metadata file, so
leave out the `--input` for it. Pass only the annotations and overrides, with
`dataset.source` in the overrides:

```bash
node scripts/write-proposal.js \
  --accession <ID> --type bulk-rnaseq --project <PROJECT> \
  --organism <ORGANISM_ABBREV> [--also-organism <ABBREV> ...] \
  --primary-contact <PRIMARY_CONTACT_ID> [--contact <ID> ...] \
  --skill propose-bulk-rnaseq \
  --curated .curation/tmp/<ID>_sample_annotations.json \
  --overrides .curation/tmp/overrides.json
```

`write-proposal.js` derives `curated/presenter.json`, the structured record
Phase 2 renders from, and the loading artifacts in `curated/`
(`samplesheet.csv`, `analysisConfig.xml`, `entity-sample.tsv` and `.yaml`). It
refuses to write the proposal until every required field is filled and the
artifacts agree with each other and with `dataset.json`.

`shortDisplayName` and `shortAttribution` are required and can't be derived,
so write `.curation/tmp/overrides.json` with them under `"presenter"` first
(plus any PubMed IDs or injector properties), and a readable `"name"` for the
experiment. `graphXAxisSamplesDescription` is also required: it is drafted
from the factor display names, so check it. Without SRA metadata,
`displayName` and `summary` must be given under `"presenter"`; `description`
too unless a GEO MINiML supplies it. The overrides also need a `"version"`
(YYYY-MM-DD, when the data last changed) alongside `"name"`, unless a GEO series
supplies it. Show the curator the rendered XML, adjust the overrides, and re-run until
they approve it. Never edit the rendered XML or `presenter.json`.

**Detailed instructions:** [Step 4 - Write Proposal](resources/step-4-write-proposal.md)

### Step 5: Preview the Loading Artifacts

```bash
node scripts/render-proposal.js --artifacts .curation/delivery Proposals/<BIOPROJECT>
```

Copies the curated `analysisConfig.xml`, `samplesheet.csv`,
`sampleAnnotations.json` and the STF files under `.curation/delivery/`, after
checking that they agree. There is one delivery directory per organism, laid
out like the class's delivery directory, each with its own
`sample-annotations-stf/<organism presenter name>/` directory. It prints where
the data loading team will copy them. Nothing is delivered here: the data
loading team copies them and checks the server.

**Detailed instructions:** [Step 5 - Preview Artifacts](resources/step-5-preview-artifacts.md)

### Step 6: Publish

```bash
node scripts/publish-proposal.js <BIOPROJECT> --build <NN>
```

`--build` becomes the ticket's `Build NN` milestone. It is needed only when
publish creates the ticket; to move a proposal to another build later, change
the milestone on GitHub. When updating a proposal that already has a ticket,
omit `--build` (or pass the build its milestone already has).

Commits the proposal and `allContacts.xml`, pushes, opens a PR against
`master`, creates or comments on the ticket, records it in the manifest. If it
fails, re-run the same command: publish resumes rather than duplicating
anything.

**Detailed instructions:** [Step 6 - Publish](resources/step-6-publish.md)

## Next Steps

1. The curator reviews and merges the pull request.
2. When the data loading team starts the build named by the ticket's
   milestone, `load-proposals` renders the presenter and the dataset entry, generates the loading
   artifacts for them to copy, and closes out the proposal.

## Resources

- [Proposal Workflow](resources/proposal-workflow.md)
- [Step 0 - Start Proposal](resources/step-0-start-proposal.md)
- [Step 1 - Fetch Metadata](resources/step-1-fetch-metadata.md)
- [Step 2 - Analyze Samples](resources/step-2-analyze-samples.md)
- [Step 3 - Curate Contacts](resources/step-3-curate-contacts.md)
- [Step 4 - Write Proposal](resources/step-4-write-proposal.md)
- [Step 5 - Preview Artifacts](resources/step-5-preview-artifacts.md)
- [Step 6 - Publish](resources/step-6-publish.md)
- [Sample Annotations to STF](../sample-annotations-to-stf/SKILL.md)
- [PDF Extraction](resources/pdf-extraction.md)
- [Editing Large XML Files](resources/editing-large-xml.md)
- [Valid VEuPathDB Projects](resources/valid-projects.json)

## Scripts

- `scripts/fetch-sra-metadata.js` - Fetches SRA run metadata from ENA + BioSample attributes from NCBI
- `scripts/fetch-miniml.js` - Fetches MINiML XML for GEO-linked datasets
- `scripts/start-proposal.js`, `scripts/write-proposal.js`, `scripts/publish-proposal.js` - proposal lifecycle (synced from shared/)
- `scripts/render-proposal.js` - preview the presenter XML, the dataset entry (`--dataset`) and the loading artifacts (`--artifacts`) (synced from shared/)
- `scripts/check-workspace.js` - Confirms the VEuPathDatasets checkout and prepares `.curation/` (synced from shared/)
