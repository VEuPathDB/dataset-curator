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
- Intermediate files go in `.curation/tmp/`, which `check-workspace.js` creates.

## Required Information

Ask for all of these before starting:

- **VEuPathDB project** from [resources/valid-projects.json](resources/valid-projects.json)
- **Assembly GenBank accession** including version (e.g. `GCA_000988875.2`)
- **Organism abbreviation** (e.g. `afumAf293`). If unknown, derive first letter of genus + first three of species + strain with special characters removed, and confirm with the curator.

The **target build** is asked for at publish (Step 6), not here.

## Workflow

### Step 0: Start the Proposal

```bash
node scripts/start-proposal.js <ASSEMBLY_ACCESSION> [--force-update]
```

Checks that VEuPathDatasets is on a clean, current `master` with no
`proposal/<ASSEMBLY_ACCESSION>` branch here or on origin, then creates that
branch. Prints `{"mode":"new"}` or `{"mode":"update",...}`. A proposal already
on master whose manifest records no ticket is a hard stop, because its status
cannot be checked; `--force-update` overrides that and treats it as proposed.
Ask the curator before using it. Nothing from this output is needed later.

**Detailed instructions:** [Step 0 - Start Proposal](resources/step-0-start-proposal.md)

### Step 1: Fetch Assembly Metadata from NCBI

```bash
curl -X GET "https://api.ncbi.nlm.nih.gov/datasets/v2/genome/accession/<ASSEMBLY_ACCESSION>/dataset_report" \
  -H "Accept: application/json" > .curation/tmp/<ASSEMBLY_ACCESSION>_dataset_report.json
```

**Detailed instructions:** [Step 1 - Fetch NCBI Metadata](resources/step-1-fetch-ncbi.md)

### Step 2: Fetch BioProject Metadata

```bash
node scripts/fetch-bioproject.js <BIOPROJECT_ACCESSION>
```

Output: `.curation/tmp/<BIOPROJECT>_bioproject.json`.

**Detailed instructions:** [Step 2 - Fetch BioProject](resources/step-2-fetch-bioproject.md)

### Step 3: Fetch PubMed Data

```bash
node scripts/fetch-pubmed.js <ASSEMBLY_ACCESSION>
```

Output: `.curation/tmp/<ASSEMBLY_ACCESSION>_pubmed.json`.

**Detailed instructions:** [Step 3 - Fetch PubMed](resources/step-3-fetch-pubmed.md)

### Step 4: Curate Contacts

Search and, if needed, add contacts in
`Model/lib/xml/datasetPresenters/contacts/allContacts.xml`.
New contacts are committed with the proposal. Note the primary and additional
contact IDs.

**Detailed instructions:** [Step 4 - Curate Contacts](resources/step-4-curate-contacts.md)

### Step 5: Write the Proposal and Preview

```bash
node scripts/write-proposal.js \
  --accession <ASSEMBLY_ACCESSION> --type genome-assembly --project <PROJECT> \
  --organism <ORGANISM_ABBREV> \
  --primary-contact <PRIMARY_CONTACT_ID> [--contact <ID> ...] \
  --skill propose-genome-assembly \
  --input .curation/tmp/<ASSEMBLY_ACCESSION>_dataset_report.json \
  --input .curation/tmp/<BIOPROJECT>_bioproject.json \
  --input .curation/tmp/<ASSEMBLY_ACCESSION>_pubmed.json

node scripts/render-proposal.js Proposals/<ASSEMBLY_ACCESSION>
```

`write-proposal.js` derives `curated/presenter.json`, the structured record
Phase 2 renders from, and refuses to write the proposal while a required field
is empty. Show the curator the rendered XML. To change text (description,
summary, PubMed IDs), write `.curation/tmp/overrides.json` and re-run
`write-proposal.js` with `--overrides .curation/tmp/overrides.json`.
Each run replaces `Proposals/<ASSEMBLY_ACCESSION>/` wholesale, so every
`--input` must be passed again. Never edit the rendered XML or files inside the
proposal directory.

**Detailed instructions:** [Step 5 - Write Proposal](resources/step-5-write-proposal.md)

### Step 6: Publish

```bash
node scripts/publish-proposal.js <ASSEMBLY_ACCESSION> --build <NN>
```

`--build` becomes the ticket's `Build NN` milestone. It is needed only when
publish creates the ticket; to move a proposal to another build later, change
the milestone on GitHub.

Commits the proposal and `allContacts.xml`, pushes, opens a PR against
`master`, creates the ticket (or comments on the existing one), records the
ticket in the manifest and amends. Prints the PR and ticket URLs. If it fails,
re-run the same command: publish resumes rather than duplicating anything.

**Detailed instructions:** [Step 6 - Publish](resources/step-6-publish.md)

## Next Steps

1. The curator reviews and merges the pull request.
2. When the data loading team starts the build named by the ticket's milestone, `load-proposals`
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
- `scripts/check-workspace.js` - Confirms the VEuPathDatasets checkout and prepares `.curation/` (synced from shared/)
