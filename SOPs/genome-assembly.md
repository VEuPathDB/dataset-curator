# SOP: Genome Assembly Dataset

This SOP guides processing of genome assembly datasets for VEuPathDB resources.

## Prerequisites

### 1. Branch Setup

**Have you created dataset-specific branches?**

You should have created branches in both the parent repository and relevant submodules (typically named after the BioProject accession, e.g., `PRJNA123456`).

If not, see [the instructions here](../docs/curator-branching.md).

### 2. Required Information

Gather the following before starting:

- **VEuPathDB project** - is this for VectorBase, PlasmoDD, ToxoDB, FungiDB, etc?
- **Assembly GenBank accession** (`GCA_...`, including version suffix as appropriate)
- **Is this the reference strain?** (typically the first sequenced genome in a genus)

Store these in the environment variables `PROJECT_ID`, `GENBANK_ACCESSION` and `IS_REFERENCE_STRAIN` for further use below. Booleans should be represented as `yes` or `no`.

## Processing Steps

### Step 1: Fetch Assembly Metadata from NCBI

- curl -X GET "https://api.ncbi.nlm.nih.gov/datasets/v2/genome/accession/$GENBANK_ACCESSION/dataset_report" -o tmp/${GENBANK_ACCESSION}_dataset_report.json

### Step 2: Create main dataset XML file

[To be filled in]

### Step 3: TBC

[To be filled in]

## Next Steps

After completing this SOP:
1. Review generated files
2. Commit changes to your dataset branch
3. Create pull request for review
