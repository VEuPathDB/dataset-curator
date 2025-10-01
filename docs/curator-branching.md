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
git branch  # Should show PRJNA123456
git submodule foreach 'git branch'  # Check submodule branches
```

## Ready to Process

Once branches are created, return to the appropriate SOP in `SOPs/` to begin processing your dataset.

## TO DO

Pull request creation, review and merging.
