---
name: propose-genome-assembly
description: Propose a genome assembly dataset for VEuPathDB - fetch NCBI metadata, curate contacts, write a proposal to VEuPathDatasets, open the PR and ticket
---

# Propose a Genome Assembly Dataset

This skill gathers metadata for a genome assembly, curates contacts, and writes
a **proposal** to VEuPathDatasets. It ends with a pull request against
`master` and a ticket. Presenter XML is rendered later by the `load-proposals`
skill when the data loading team starts a build. See
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
- DO NOT `cd` into `veupathdb-repos/`; use `git -C veupathdb-repos/VEuPathDatasets ...`
- Never push to `master`. The scripts push only to `proposal/<accession>`.
- Intermediate files go in `tmp/`.

## Required Information

Ask for all of these before starting:

- **VEuPathDB project** from [resources/valid-projects.json](resources/valid-projects.json)
- **Assembly GenBank accession** including version (e.g. `GCA_000988875.2`)
- **Target build** as two or more digits (e.g. `02`), matching the `rebuildNN` branch it should load in
- **Organism abbreviation** (e.g. `afumAf293`). If unknown, derive first letter of genus + first three of species + strain with special characters removed, and confirm with the curator.

## Workflow

### Step 0: Start the Proposal

```bash
node scripts/start-proposal.js <ASSEMBLY_ACCESSION>
```

Checks that VEuPathDatasets is on a clean, current `master`, then creates
`proposal/<ASSEMBLY_ACCESSION>`. Prints `{"mode":"new"}` or, if a proposal
already exists on master with a ticket in `proposed` status,
`{"mode":"update","existingTicket":{...}}`. Keep that JSON for Step 6.

**Detailed instructions:** [Step 0 - Start Proposal](resources/step-0-start-proposal.md)

### Step 1: Fetch Assembly Metadata from NCBI

```bash
curl -X GET "https://api.ncbi.nlm.nih.gov/datasets/v2/genome/accession/<ASSEMBLY_ACCESSION>/dataset_report" \
  -H "Accept: application/json" > tmp/<ASSEMBLY_ACCESSION>_dataset_report.json
```

**Detailed instructions:** [Step 1 - Fetch NCBI Metadata](resources/step-1-fetch-ncbi.md)

### Step 2: Fetch BioProject Metadata

```bash
node scripts/fetch-bioproject.js <BIOPROJECT_ACCESSION>
```

Output: `tmp/<BIOPROJECT>_bioproject.json`.

**Detailed instructions:** [Step 2 - Fetch BioProject](resources/step-2-fetch-bioproject.md)

### Step 3: Fetch PubMed Data

```bash
node scripts/fetch-pubmed.js <ASSEMBLY_ACCESSION>
```

Output: `tmp/<ASSEMBLY_ACCESSION>_pubmed.json`.

**Detailed instructions:** [Step 3 - Fetch PubMed](resources/step-3-fetch-pubmed.md)

### Step 4: Curate Contacts

Search and, if needed, add contacts in
`veupathdb-repos/VEuPathDatasets/Model/lib/xml/datasetPresenters/contacts/allContacts.xml`.
New contacts are committed with the proposal. Note the primary and additional
contact IDs.

**Detailed instructions:** [Step 4 - Curate Contacts](resources/step-4-curate-contacts.md)

### Step 5: Write the Proposal and Preview

```bash
node scripts/write-proposal.js \
  --accession <ASSEMBLY_ACCESSION> --type genome-assembly --project <PROJECT> \
  --organism <ORGANISM_ABBREV> --build <TARGET_BUILD> \
  --primary-contact <PRIMARY_CONTACT_ID> [--contact <ID> ...] \
  --skill propose-genome-assembly \
  --input tmp/<ASSEMBLY_ACCESSION>_dataset_report.json \
  --input tmp/<BIOPROJECT>_bioproject.json \
  --input tmp/<ASSEMBLY_ACCESSION>_pubmed.json

node scripts/render-proposal.js veupathdb-repos/VEuPathDatasets/Proposals/<ASSEMBLY_ACCESSION>
```

Show the curator the rendered XML. To change text (description, summary,
PubMed IDs), write `curated/presenter-overrides.json` and re-run
`write-proposal.js` with `--curated tmp/presenter-overrides.json`. Never edit
the rendered XML; it is not stored.

**Detailed instructions:** [Step 5 - Write Proposal](resources/step-5-write-proposal.md)

### Step 6: Publish

```bash
node scripts/publish-proposal.js <ASSEMBLY_ACCESSION> [--existing-ticket '<json from step 0>']
```

Commits the proposal and `allContacts.xml`, pushes, opens a PR against
`master`, creates the ticket (or comments on the existing one), records the
ticket in the manifest and amends. Prints the PR and ticket URLs.

**Detailed instructions:** [Step 6 - Publish](resources/step-6-publish.md)

## Next Steps

1. The curator reviews and merges the pull request.
2. When the data loading team starts build `<TARGET_BUILD>`, `load-proposals`
   renders the presenter and closes out the proposal.

## Resources

- [Proposal Workflow](resources/proposal-workflow.md)
- [Step 0 - Start Proposal](resources/step-0-start-proposal.md)
- [Step 1 - Fetch NCBI Metadata](resources/step-1-fetch-ncbi.md)
- [Step 2 - Fetch BioProject](resources/step-2-fetch-bioproject.md)
- [Step 3 - Fetch PubMed](resources/step-3-fetch-pubmed.md)
- [Step 4 - Curate Contacts](resources/step-4-curate-contacts.md)
- [Step 5 - Write Proposal](resources/step-5-write-proposal.md)
- [Step 6 - Publish](resources/step-6-publish.md)
- [Editing Large XML Files](resources/editing-large-xml.md)
- [Valid VEuPathDB Projects](resources/valid-projects.json)

## Scripts

- `scripts/fetch-bioproject.js` - BioProject metadata from NCBI
- `scripts/fetch-pubmed.js` - PubMed records linked to the assembly
- `scripts/start-proposal.js`, `scripts/write-proposal.js`, `scripts/publish-proposal.js` - proposal lifecycle (synced from shared/)
- `scripts/render-proposal.js` - preview the presenter XML (synced from shared/)
- `scripts/check-repos.sh` - repository check (synced from shared/)
