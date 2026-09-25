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
repository, put a copy at `.curation/curator.config.json` in the checkout. The
Redmine backend also needs `REDMINE_API_KEY` in the environment.

## Working Directory

All commands run from the top of the VEuPathDatasets checkout.

**For Claude Code**:
- DO NOT `cd` into subdirectories.
- Never push to `master`. The scripts push only to `proposal/<accession>`.

The workflow creates:
- `.curation/tmp/` - intermediate files (ignored by git)
- `.curation/delivery/bulk-rnaseq/<BIOPROJECT>/` - pipeline outputs (ignored by git)

## Required Information

Ask for all of these before starting:

- **VEuPathDB project** from [resources/valid-projects.json](resources/valid-projects.json)
- **BioProject accession** (e.g. `PRJNA1018599`)
- **Target build** as two or more digits (e.g. `02`), matching the `rebuildNN` branch it should load in
- **Organism abbreviation** of the reference organism (e.g. `afumAf293`), confirmed with the curator

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
  --organism <ORGANISM_ABBREV> --build <TARGET_BUILD> \
  --primary-contact <PRIMARY_CONTACT_ID> [--contact <ID> ...] \
  --skill propose-bulk-rnaseq \
  --input .curation/tmp/<BIOPROJECT>_sra_metadata.json \
  [--input .curation/tmp/<GSE>_family.xml] [--input .curation/tmp/<BIOPROJECT>_pdf_extracted.json] \
  --curated .curation/tmp/<BIOPROJECT>_sample_annotations.json \
  --overrides .curation/tmp/presenter-overrides.json

node scripts/render-proposal.js Proposals/<BIOPROJECT>
node scripts/render-proposal.js --name Proposals/<BIOPROJECT> > .curation/tmp/<BIOPROJECT>_presenter_name.txt
```

`write-proposal.js` derives `curated/presenter.json`, the structured record
Phase 2 renders from, and refuses to write the proposal until every required
field is filled. `shortDisplayName` and `shortAttribution` are required and
can't be derived, so write `.curation/tmp/presenter-overrides.json` with them
under `"presenter"` first (plus any PubMed IDs or injector properties), and a
readable `"name"` for the experiment. Show the curator the
rendered XML, adjust the overrides, and re-run until they approve it. Never
edit the rendered XML or `presenter.json`.

**Detailed instructions:** [Step 4 - Write Proposal](resources/step-4-write-proposal.md)

### Step 5: Generate Delivery Outputs

Generate pipeline configuration files for the data processing team.

**Commands:**
```bash
bash scripts/check-delivery-dirs.sh bulk-rnaseq <BIOPROJECT>
node scripts/generate-analysis-config.js <BIOPROJECT> [--strand-specific]
node scripts/generate-samplesheet.js <BIOPROJECT> [strandedness]
node skills/sample-annotations-to-stf/scripts/sample-annotations-to-stf.js <BIOPROJECT> \
  "$(cat .curation/tmp/<BIOPROJECT>_presenter_name.txt)" \
  .curation/delivery/bulk-rnaseq/<BIOPROJECT>/sample-annotations-stf
```

The `strandedness` argument accepts: `stranded`, `unstranded`, or `auto`. If omitted, the script checks `_pdf_extracted.json` and `_sample_annotations.json` before falling back to `auto`.

**Outputs in `.curation/delivery/bulk-rnaseq/<BIOPROJECT>/`:**
- `analysisConfig.xml` - Pipeline configuration
- `samplesheet.csv` - Also for the processing pipeline
- `sample-annotations-stf/<presenterName>/entity-sample.tsv` - Sample data in STF format
- `sample-annotations-stf/<presenterName>/entity-sample.yaml` - Variable definitions in STF format

**Detailed instructions:** [Step 5 - Generate Outputs](resources/step-5-generate-outputs.md)

### Step 6: Publish

```bash
node scripts/publish-proposal.js <BIOPROJECT>
```

Commits the proposal and `allContacts.xml`, pushes, opens a PR against
`master`, creates or comments on the ticket, records it in the manifest. If it
fails, re-run the same command: publish resumes rather than duplicating
anything.

**Detailed instructions:** [Step 6 - Publish](resources/step-6-publish.md)

## Next Steps

1. The curator reviews and merges the pull request.
2. Deliver `.curation/delivery/bulk-rnaseq/<BIOPROJECT>/` to the data processing team.
3. When the data loading team starts build `<TARGET_BUILD>`, `load-proposals`
   renders the presenter and closes out the proposal.

## Resources

- [Proposal Workflow](resources/proposal-workflow.md)
- [Step 0 - Start Proposal](resources/step-0-start-proposal.md)
- [Step 1 - Fetch Metadata](resources/step-1-fetch-metadata.md)
- [Step 2 - Analyze Samples](resources/step-2-analyze-samples.md)
- [Step 3 - Curate Contacts](resources/step-3-curate-contacts.md)
- [Step 4 - Write Proposal](resources/step-4-write-proposal.md)
- [Step 5 - Generate Outputs](resources/step-5-generate-outputs.md)
- [Step 6 - Publish](resources/step-6-publish.md)
- [Sample Annotations to STF](../sample-annotations-to-stf/SKILL.md)
- [PDF Extraction](resources/pdf-extraction.md)
- [Editing Large XML Files](resources/editing-large-xml.md)
- [Valid VEuPathDB Projects](resources/valid-projects.json)

## Scripts

- `scripts/fetch-sra-metadata.js` - Fetches SRA run metadata from ENA + BioSample attributes from NCBI
- `scripts/fetch-miniml.js` - Fetches MINiML XML for GEO-linked datasets
- `scripts/generate-analysis-config.js` - Generates analysisConfig.xml for pipeline
- `scripts/generate-samplesheet.js` - Generates/delivers samplesheet.csv and sampleAnnotations.json
- `scripts/start-proposal.js`, `scripts/write-proposal.js`, `scripts/publish-proposal.js` - proposal lifecycle (synced from shared/)
- `scripts/render-proposal.js` - preview the presenter XML and print its name (synced from shared/)
- `scripts/check-workspace.js` - Confirms the VEuPathDatasets checkout and prepares `.curation/` (synced from shared/)
- `scripts/check-delivery-dirs.sh` - Creates delivery directory structure (synced from shared/)
