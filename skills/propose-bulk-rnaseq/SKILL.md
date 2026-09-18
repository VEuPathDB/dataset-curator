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

This workflow requires the **VEuPathDatasets** repository in `veupathdb-repos/`
and a `curator.config.json` in the curation workspace directory.

```bash
bash scripts/check-repos.sh VEuPathDatasets
ls curator.config.json
```

If either is missing, follow the printed instructions. The config template is
`curator.config.example.json` in the dataset-curator repository. The Redmine
backend also needs `REDMINE_API_KEY` in the environment.

## Working Directory (Curation Workspace Directory)

All commands run from the curation workspace directory, the one containing
`veupathdb-repos/` and `curator.config.json`.

**For Claude Code**:
- DO NOT `cd` into subdirectories; use `git -C veupathdb-repos/VEuPathDatasets ...`
- Never push to `master`. The scripts push only to `proposal/<accession>`.

The workflow creates:
- `tmp/` - intermediate files (gitignored); create it first with `mkdir -p tmp`
- `delivery/bulk-rnaseq/<BIOPROJECT>/` - pipeline outputs (gitignored)

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
2. Copy it to `tmp/<BIOPROJECT>_article.pdf` (e.g., `tmp/PRJNA1018599_article.pdf`)
3. Tell Claude the PDF is available when starting Step 1

The PDF will be processed by a subagent once in Step 1 and extracted data saved to `tmp/<BIOPROJECT>_pdf_extracted.json` for use throughout the workflow.

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

**Output:** `tmp/<BIOPROJECT>_sra_metadata.json`

**Optional - Fetch MINiML for GEO-linked datasets:**
```bash
node scripts/fetch-miniml.js <BIOPROJECT>
```

**Output:** `tmp/<GSE>_family.xml` (if GEO-linked)

**Optional - Extract PDF data:**

If `tmp/<BIOPROJECT>_article.pdf` is present, a subagent will extract it (do not read it yourself).

**Output (on success):** `tmp/<BIOPROJECT>_pdf_extracted.json`

**Detailed instructions:** [Step 1 - Fetch Metadata](resources/step-1-fetch-metadata.md)

### Step 2: Analyze Samples

Claude analyzes the fetched metadata to:
1. Identify experimental factors (attributes that vary between samples)
2. Generate sample annotations with meaningful labels
3. Group technical replicates
4. Determine strand specificity

**Output:** `tmp/<BIOPROJECT>_sample_annotations.json`

**Detailed instructions:** [Step 2 - Analyze Samples](resources/step-2-analyze-samples.md)

### Step 3: Curate Contacts

Identify and curate contact entries from GEO contributors or BioProject submitters.

**Actions:**
- Search existing contacts in `veupathdb-repos/VEuPathDatasets/Model/lib/xml/datasetPresenters/contacts/allContacts.xml`
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
  --input tmp/<BIOPROJECT>_sra_metadata.json \
  [--input tmp/<GSE>_family.xml] [--input tmp/<BIOPROJECT>_pdf_extracted.json] \
  --curated tmp/<BIOPROJECT>_sample_annotations.json \
  [--curated tmp/presenter-overrides.json]

node scripts/render-proposal.js veupathdb-repos/VEuPathDatasets/Proposals/<BIOPROJECT>
node scripts/render-proposal.js --name veupathdb-repos/VEuPathDatasets/Proposals/<BIOPROJECT> > tmp/<BIOPROJECT>_presenter_name.txt
```

Show the curator the rendered XML. `shortDisplayName`, `shortAttribution`,
PubMed IDs and injector properties come from `tmp/presenter-overrides.json`;
write it, re-run `write-proposal.js`, and preview again. Never edit the
rendered XML.

**Detailed instructions:** [Step 4 - Write Proposal](resources/step-4-write-proposal.md)

### Step 5: Generate Delivery Outputs

Generate pipeline configuration files for the data processing team.

**Commands:**
```bash
bash scripts/check-delivery-dirs.sh bulk-rnaseq <BIOPROJECT>
node scripts/generate-analysis-config.js <BIOPROJECT> [--strand-specific]
node scripts/generate-samplesheet.js <BIOPROJECT> [strandedness]
node skills/sample-annotations-to-stf/scripts/sample-annotations-to-stf.js <BIOPROJECT> \
  "$(cat tmp/<BIOPROJECT>_presenter_name.txt)" \
  delivery/bulk-rnaseq/<BIOPROJECT>/sample-annotations-stf
```

The `strandedness` argument accepts: `stranded`, `unstranded`, or `auto`. If omitted, the script checks `_pdf_extracted.json` and `_sample_annotations.json` before falling back to `auto`.

**Outputs in `delivery/bulk-rnaseq/<BIOPROJECT>/`:**
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
2. Deliver `delivery/bulk-rnaseq/<BIOPROJECT>/` to the data processing team.
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
- `scripts/check-repos.sh` - Validates veupathdb-repos/ repository setup (synced from shared/)
- `scripts/check-delivery-dirs.sh` - Creates delivery directory structure (synced from shared/)
