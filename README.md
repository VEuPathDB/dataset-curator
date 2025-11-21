# VEuPathDB Dataset Curator

Tools and SOPs for curating new datasets for VEuPathDB resources with AI hand-holding by Claude Code.

## Setup

### 1. Clone This Repository

```bash
git clone git@github.com:VEuPathDB/dataset-curator.git
cd dataset-curator
```

### 2. Set Up VEuPathDB Repository Directory

Skills and scripts expect VEuPathDB configuration repositories to be in a `veupathdb-repos/` directory. You have two options:

#### Option A: Fresh Clone (Recommended for New Users)

Create a new directory and clone the required repositories:

```bash
mkdir veupathdb-repos
cd veupathdb-repos
git clone git@github.com:VEuPathDB/ApiCommonDatasets.git
git clone git@github.com:VEuPathDB/ApiCommonPresenters.git
git clone git@github.com:VEuPathDB/EbrcModelCommon.git
cd ..
```

#### Option B: Symlink Existing Checkouts (For GitHub Desktop Users)

If you already have these repositories checked out (e.g., via GitHub Desktop in `~/Documents/GitHub`):

```bash
ln -s ~/Documents/GitHub veupathdb-repos
```

**Note:** This assumes your GitHub Desktop directory contains `ApiCommonDatasets`, `ApiCommonPresenters`, and `EbrcModelCommon`.

## Prerequisites

### Install Volta

[Volta](https://volta.sh/) manages Node.js versions:

```bash
curl https://get.volta.sh | bash
```

### Install Node.js

```bash
volta install node
```

### Install Claude Code

```bash
volta install @anthropic-ai/claude-code
```

### 3. Install Dependencies

Enable Corepack (built into Node.js) for yarn support:

```bash
corepack enable
```

Install project dependencies:

```bash
yarn install
```

## Usage

After completing all the steps above, go into the directory and type
`claude` at the commandline to start Claude Code. You will then be able to
co-curate a dataset via natural language conversation with Claude's AI.

**Note:** The first time you run `claude`, you'll need to complete a one-time account linking and login process.

When curating for real, be sure to follow the [git branching guidelines](docs/curator-branching.md).
This is best done yourself, not by Claude.

Claude Code will follow detailed instructions in the file
[CLAUDE.md](./CLAUDE.md), but these are also human-readable and a
useful guide to how things work.
