# SOP: Genome Assembly Dataset

This SOP guides processing of genome assembly datasets for VEuPathDB resources.

## Prerequisites

### 1. Required Repositories

This SOP requires the following repositories to be present in `veupathdb-repos/`:
- `ApiCommonDatasets`
- `ApiCommonPresenters`
- `EbrcModelCommon`

**Check repository status:**

Before proceeding, verify that the required repositories exist and check their current branch and status:

```bash
for repo in ApiCommonDatasets ApiCommonPresenters EbrcModelCommon; do
  if [ -d "veupathdb-repos/$repo" ]; then
    echo "=== $repo ==="
    cd "veupathdb-repos/$repo"
    echo "Branch: $(git branch --show-current)"
    git status --short
    cd ../..
  else
    echo "ERROR: veupathdb-repos/$repo does not exist"
  fi
done
```

If the repositories don't exist, clone them into `veupathdb-repos/` before proceeding.

If you need to create new branches for this dataset (typically named after the BioProject accession, e.g., `PRJNA123456`), see [the instructions here](../docs/curator-branching.md).

**Proceed with dataset processing?** The user should review the branch and status information and confirm they wish to proceed.

### 2. Required Information

Gather the following before starting - you'll pass these to scripts as needed:

- **VEuPathDB project** - one of:
  - AmoebaDB
  - CryptoDB
  - FungiDB
  - GiardiaDB
  - HostDB
  - MicrosporidiaDB
  - PiroplasmaDB
  - PlasmoDB
  - SchistoDB
  - ToxoDB
  - TrichDB
  - TriTrypDB
  - VectorBase
- **Assembly GenBank accession** (`GCA_...`, including version suffix as appropriate)
- **Is this the reference strain?** (`true` or `false` - typically true for the first sequenced genome in a genus)

## Processing Steps

### Step 1: Fetch Assembly Metadata from NCBI

Fetch the assembly metadata from NCBI using the GenBank accession:

```bash
curl -X GET "https://api.ncbi.nlm.nih.gov/datasets/v2/genome/accession/<GENBANK_ACCESSION>/dataset_report" -o tmp/<GENBANK_ACCESSION>_dataset_report.json
```

Replace `<GENBANK_ACCESSION>` with your actual accession (e.g., `GCA_000988875.2`).

### Step 2: Add `organism` and optional `referenceStrain` elements to top level project dataset XML file

Generate and insert the organism dataset XML:

```bash
npx tsx bin/generate-dataset-organism-xml.ts <GENBANK_ACCESSION> <PROJECT_ID> <IS_REFERENCE_STRAIN>
```

Example:
```bash
npx tsx bin/generate-dataset-organism-xml.ts GCA_000988875.2 FungiDB true
```

- The script will generate XML to stdout/context
- Use the Edit tool to insert or replace the generated XML in `veupathdb-repos/ApiCommonDatasets/Datasets/lib/xml/datasets/<PROJECT_ID>.xml`
  - If an organism with the same `organismAbbrev` exists, replace it
  - Otherwise, the new organism element(s) will be appended to the end of the `<datasets>...</datasets>` element
- Warn/advise the curator if any TODO fields remain in the generated XML

### Step 3: TBC

[To be filled in]

## Next Steps

After completing this SOP:
1. Review generated files
2. Commit changes to your dataset branch
3. Create pull request for review
