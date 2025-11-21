---
name: curate-genome-assembly
description: Process genome assembly datasets for VEuPathDB resources - fetch NCBI metadata, generate organism XML, update ApiCommonDatasets configurations for BioProject accessions
---

# Genome Assembly Dataset Curation

This skill guides processing of genome assembly datasets for VEuPathDB resources.

## Prerequisites Check

This workflow requires the following repositories in `veupathdb-repos/`:
- ApiCommonDatasets
- ApiCommonPresenters
- EbrcModelCommon

**First, run the repository status check** to verify repositories are present:

```bash
bash scripts/check-repos.sh ApiCommonDatasets ApiCommonPresenters EbrcModelCommon
```

If repositories are missing, the script will provide clone instructions.

**Branch Confirmation:** After verifying repositories exist, check their current branches and status, then confirm with the user before proceeding. Users typically create dataset-specific branches (see [curator branching guidelines](resources/curator-branching.md)).

## Required Information

Gather the following before starting:

- **VEuPathDB project** - Valid projects listed in [resources/valid-projects.json](resources/valid-projects.json)
- **Assembly GenBank accession** (e.g., `GCA_000988875.2` including version)
- **Is this the reference strain?** (`true` or `false` - typically true for first sequenced genome in a genus)

## Workflow Overview

### Step 1: Fetch Assembly Metadata from NCBI

Fetch assembly metadata from NCBI using the GenBank accession.

**Detailed instructions:** [Step 1 - Fetch NCBI Metadata](resources/step-1-fetch-ncbi.md)

### Step 2: Generate Organism Dataset XML

Generate organism and optional referenceStrain dataset elements using NCBI metadata.

**Detailed instructions:** [Step 2 - Generate Organism XML](resources/step-2-generate-xml.md)

### Step 3: Insert XML into Project Dataset File

Insert or update the generated XML in the project's dataset configuration file.

**Detailed instructions:** [Step 3 - Update Dataset Files](resources/step-3-update-files.md)

## Next Steps

After completing this workflow:
1. Review generated files for TODO fields that require curator input
2. Commit changes to dataset branch (curator handles git operations)
3. Create pull request for review (curator handles PR creation)

## Resources

- [Step 1 - Fetch NCBI Metadata](resources/step-1-fetch-ncbi.md)
- [Step 2 - Generate Organism XML](resources/step-2-generate-xml.md)
- [Step 3 - Update Dataset Files](resources/step-3-update-files.md)
- [Curator Branching Guidelines](resources/curator-branching.md)
- [Valid VEuPathDB Projects](resources/valid-projects.json)

## Scripts

- `scripts/generate-organism-xml.js` - Generates organism dataset XML from NCBI data (template inlined, zero dependencies)
- `scripts/check-repos.sh` - Validates veupathdb-repos/ repository setup (synced from shared/)
