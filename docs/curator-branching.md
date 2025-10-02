# Curator Branching Workflow

This guide explains how to create dataset-specific branches before processing a new dataset.

## Overview

Each new dataset requires its own branch in:
1. The parent `veupathdb-dataset-curator` repository
2. All submodules in `data/`

Branch names typically match the BioProject accession (e.g., `PRJNA123456`).

## Creating Branches

### 1. Create Parent Repository Branch

```bash
git checkout -b PRJNA123456
```

### 2. Create Submodule Branches

Create the same branch in all submodules:

```bash
git submodule foreach 'git checkout -b PRJNA123456'
```

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

Once branches are created, return to the appropriate SOP in `SOPs/` to begin processing your dataset.

## TO DO

Pull request creation, review and merging.
