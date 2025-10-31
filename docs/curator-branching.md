# Curator Branching Workflow

This guide explains how to create dataset-specific branches before processing a new dataset.

## Overview

Each new dataset requires its own branch in:
1. The parent `dataset-curator` repository
2. All submodules in `data/`

Branch names typically match the BioProject accession (e.g., `PRJNA123456`).

## Prerequisites

Before creating branches, ensure your submodules are properly initialized and up-to-date.

### Check Submodule Status

After a fresh clone, submodules will be in **detached HEAD state** (pointing to a specific commit rather than a branch):

```bash
# Check status of a submodule
cd data/ApiCommonPresenters
git status
# Output: "HEAD detached at 56dd273d"
```

This is normal, but you need to checkout the base branch before creating your dataset branch.

### Verify Submodules Are Initialized

If submodules are empty or not initialized, run:

```bash
git submodule update --init
```

## Creating Branches

### 1. Create Parent Repository Branch

```bash
git checkout -b PRJNA123456
```

### 2. Create Submodule Branches

For each submodule, you need to:
1. Checkout the `master` branch (moves from detached HEAD state)
2. Pull the latest changes from remote
3. Create your dataset branch from the updated `master`

**Do this for all submodules at once:**

```bash
# Checkout master branch in all submodules
git submodule foreach 'git checkout master'

# Pull latest changes in all submodules
git submodule foreach 'git pull origin master'

# Create dataset branch in all submodules
git submodule foreach 'git checkout -b PRJNA123456'
```

**Why this matters:** Submodules start in detached HEAD state after cloning. Creating a branch from the latest `master` ensures your work is based on the most current code, not a potentially outdated pinned commit.

### 3. Verify Branch Setup

Check that you're on the correct branches:

```bash
# The following should all show PRJNA123456 as the current branch of the main repository
git status
git branch
git branch --show-current
# Check submodule branches
git submodule foreach 'git branch'
# Here's the same thing, but with cleaner output
git submodule --quiet foreach 'echo "$path: $(git branch --show-current)"'
```

## Ready to Process

Once branches are created, the user can start `claude` in the main directory and ask to process a new dataset.

## Troubleshooting

### Submodules Not Initialized

If you see empty directories in `data/`, the submodules aren't initialized:

```bash
# Initialize all submodules
git submodule update --init
```

### Still in Detached HEAD After Checkout

If you see "HEAD detached" after trying to checkout `master`, you may need to fetch first:

```bash
git submodule foreach 'git fetch origin && git checkout master'
```

### Different Base Branch Name

If your submodule uses `main` instead of `master`, adjust commands accordingly:

```bash
git submodule foreach 'git checkout main'
git submodule foreach 'git pull origin main'
```

## TO DO

Pull request creation, review and merging.
