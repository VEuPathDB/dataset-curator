# Curator Branching Workflow

This guide explains how to create dataset-specific branches before processing a new dataset.

## Overview

Each new dataset requires its own branch in all required repositories. Branch names typically match the BioProject accession (e.g., `PRJNA123456`).

## Prerequisites

### Set Up veupathdb-repos Directory

The skills expect a `veupathdb-repos/` directory in your curation workspace directory containing the required VEuPathDB configuration repositories. The specific repositories needed depend on which skill you're using - check the skill's prerequisites section.

**Recommended Setup**: Symlink to your existing GitHub Desktop clones:

```bash
ln -s ~/Documents/GitHub veupathdb-repos
```

This way, any changes made by the skills appear directly in your actual repository clones, and you can manage branches and commits using your preferred git tools.

**Alternative**: Clone repositories into a new directory:

```bash
mkdir veupathdb-repos
cd veupathdb-repos
git clone git@github.com:VEuPathDB/ApiCommonDatasets.git
git clone git@github.com:VEuPathDB/ApiCommonPresenters.git
git clone git@github.com:VEuPathDB/EbrcModelCommon.git
cd ..
```

**Note**: The `veupathdb-repos/` directory is gitignored and won't be committed to the dataset-curator repository.

## Creating Dataset Branches

Before starting a dataset workflow, create a dataset-specific branch in each required repository.

**Branch Naming Convention**: Use the BioProject accession number (e.g., `PRJNA123456`)

### Using GitHub Desktop

1. Open each required repository in GitHub Desktop
2. Create a new branch using Branch → New Branch
3. Name the branch with the BioProject accession
4. Repeat for each required repository

### Using Command Line

Create branches in all required repositories:

```bash
for repo in ApiCommonDatasets ApiCommonPresenters EbrcModelCommon; do
  git -C veupathdb-repos/$repo checkout -b PRJNA123456
done
```

Or navigate to each repository individually:

```bash
cd veupathdb-repos/ApiCommonDatasets
git checkout -b PRJNA123456
cd ../ApiCommonPresenters
git checkout -b PRJNA123456
cd ../EbrcModelCommon
git checkout -b PRJNA123456
cd ../..
```

## Verifying Branch Setup

Before starting the workflow, verify all repositories are on the correct branch.

**GitHub Desktop**: Check the "Current Branch" dropdown in each repository

**Command Line**: Check branch status across repositories:

```bash
for repo in ApiCommonDatasets ApiCommonPresenters EbrcModelCommon; do
  if [ -d "veupathdb-repos/$repo" ]; then
    echo "$repo: $(git -C veupathdb-repos/$repo branch --show-current)"
  fi
done
```

## Committing and Creating Pull Requests

After the skill completes its work:

1. **Review changes**: Use `git diff` or GitHub Desktop to review modifications
2. **Commit changes**: Create commits in each modified repository
3. **Push branches**: Push your branches to GitHub
4. **Create pull requests**: Open PRs for each repository following your team's review process

The curator handles all git operations - the skills only create and modify files.

## Troubleshooting

### Repository Not Found

If the skill reports a repository is missing:

1. Check that `veupathdb-repos/` exists and contains (or links to) your repositories
2. If using a symlink, verify it points to the correct location: `ls -la veupathdb-repos`
3. If repositories are genuinely missing, clone them into your GitHub directory

### Wrong Base Branch

If you need to create your dataset branch from a specific base branch (not `main`):

1. Checkout the base branch first
2. Pull latest changes
3. Create your dataset branch from there

**GitHub Desktop**: Use Branch → New Branch and select the base branch in the "From" dropdown

**Command Line**:
```bash
git -C veupathdb-repos/ApiCommonDatasets checkout base-branch-name
git -C veupathdb-repos/ApiCommonDatasets pull
git -C veupathdb-repos/ApiCommonDatasets checkout -b PRJNA123456
```
