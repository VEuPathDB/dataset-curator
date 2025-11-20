# Curator Branching Workflow

This guide explains how to create dataset-specific branches before processing a new dataset.

## Overview

Each new dataset requires its own branch in all required repositories in `project_home/`.

Branch names typically match the BioProject accession (e.g., `PRJNA123456`).

## Prerequisites

### Ensure Required Repositories Are Cloned

Before creating branches, ensure you have cloned the required repositories into `project_home/`. The specific repositories needed depend on which SOP you're following - check the "Required Repositories" section of your SOP.

For example, the genome assembly SOP requires:
- `ApiCommonDatasets`
- `ApiCommonPresenters`
- `EbrcModelCommon`

To clone a repository:

```bash
# Create project_home directory if it doesn't exist
mkdir -p project_home

# Clone required repositories
cd project_home
git clone <repository-url> ApiCommonDatasets
git clone <repository-url> ApiCommonPresenters
git clone <repository-url> EbrcModelCommon
cd ..
```

**Note:** The `project_home/` directory is gitignored and won't be committed to the dataset-curator repository.

## Creating Branches

For each required repository in `project_home/`, create a dataset-specific branch:

```bash
# Navigate to each repository and create the branch
cd project_home/ApiCommonDatasets
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
  cd "project_home/$repo"
  git checkout -b PRJNA123456
  cd ../..
done
```

### Verify Branch Setup

Check that you're on the correct branches:

```bash
# Check project_home repositories
for repo in ApiCommonDatasets ApiCommonPresenters EbrcModelCommon; do
  if [ -d "project_home/$repo" ]; then
    echo "$repo: $(cd project_home/$repo && git branch --show-current)"
  fi
done
```

## Ready to Process

Once branches are created, you can start processing your dataset following the appropriate SOP.

## Troubleshooting

### Repository Not Found

If you see an error that a repository doesn't exist in `project_home/`, you need to clone it first:

```bash
cd project_home
git clone <repository-url> <repository-name>
cd ..
```

### Wrong Base Branch

If you need to create your dataset branch from a specific base branch (not `master` or `main`), checkout that branch first:

```bash
cd project_home/ApiCommonDatasets
git checkout <base-branch-name>
git pull origin <base-branch-name>
git checkout -b PRJNA123456
cd ../..
```

## TO DO

Pull request creation, review and merging.
