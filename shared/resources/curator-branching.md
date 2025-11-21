# Curator Branching Workflow

This guide explains how to create dataset-specific branches before processing a new dataset.

## Overview

Each new dataset requires its own branch in all required repositories in `veupathdb-repos/`.

Branch names typically match the BioProject accession (e.g., `PRJNA123456`).

## Prerequisites

### Ensure Required Repositories Are Cloned

Before creating branches, ensure you have cloned the required repositories into `veupathdb-repos/`. The specific repositories needed depend on which SOP you're following - check the "Required Repositories" section of your SOP.

For example, the genome assembly SOP requires:
- `ApiCommonDatasets`
- `ApiCommonPresenters`
- `EbrcModelCommon`

To clone a repository:

```bash
# Create veupathdb-repos directory if it doesn't exist
mkdir -p veupathdb-repos

# Clone required repositories
cd veupathdb-repos
git clone <repository-url> ApiCommonDatasets
git clone <repository-url> ApiCommonPresenters
git clone <repository-url> EbrcModelCommon
cd ..
```

**Note:** The `veupathdb-repos/` directory is gitignored and won't be committed to the dataset-curator repository.

## Creating Branches

For each required repository in `veupathdb-repos/`, create a dataset-specific branch:

```bash
# Navigate to each repository and create the branch
cd veupathdb-repos/ApiCommonDatasets
git checkout -b PRJNA123456
cd ../ApiCommonPresenters
git checkout -b PRJNA123456
cd ../EbrcModelCommon
git checkout -b PRJNA123456
cd ../..
```

**Alternative:** Use a loop to create branches in all repositories at once:

```bash
for repo in ApiCommonDatasets ApiCommonPresenters EbrcModelCommon; do
  cd "veupathdb-repos/$repo"
  git checkout -b PRJNA123456
  cd ../..
done
```

### Verify Branch Setup

Check that you're on the correct branches:

```bash
# Check veupathdb-repos repositories
for repo in ApiCommonDatasets ApiCommonPresenters EbrcModelCommon; do
  if [ -d "veupathdb-repos/$repo" ]; then
    echo "$repo: $(cd veupathdb-repos/$repo && git branch --show-current)"
  fi
done
```

## Ready to Process

Once branches are created, you can start processing your dataset following the appropriate SOP.

## Troubleshooting

### Repository Not Found

If you see an error that a repository doesn't exist in `veupathdb-repos/`, you need to clone it first:

```bash
cd veupathdb-repos
git clone <repository-url> <repository-name>
cd ..
```

### Wrong Base Branch

If you need to create your dataset branch from a specific base branch (not `master` or `main`), checkout that branch first:

```bash
cd veupathdb-repos/ApiCommonDatasets
git checkout <base-branch-name>
git pull origin <base-branch-name>
git checkout -b PRJNA123456
cd ../..
```

## TO DO

Pull request creation, review and merging.
