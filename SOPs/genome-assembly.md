# SOP: Genome Assembly Dataset

This SOP guides processing of genome assembly datasets for VEuPathDB resources.

## Prerequisites

### 1. Branch Setup

**Have you created dataset-specific branches?**

You should have created branches in both the parent repository and relevant submodules (typically named after the BioProject accession, e.g., `PRJNA123456`).

If not, see [the instructions here](../docs/curator-branching.md).

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
npx tsx bin/generate-dataset-xml.ts <GENBANK_ACCESSION> <PROJECT_ID> <IS_REFERENCE_STRAIN>
```

Example:
```bash
npx tsx bin/generate-dataset-xml.ts GCA_000988875.2 FungiDB true
```

- The script will generate XML to stdout/context
- Use the Edit tool to insert or replace the generated XML in `data/ApiCommonDatasets/Datasets/lib/xml/datasets/<PROJECT_ID>.xml`
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
