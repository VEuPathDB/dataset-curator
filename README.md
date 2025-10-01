# VEuPathDB Dataset Curator

Tools and SOPs for curating new datasets for VEuPathDB resources.

## Cloning the Repository

This repository uses git submodules. Clone with:

```bash
git clone --recurse-submodules https://github.com/VEuPathDB/veupathdb-dataset-curator.git
# or, recommended
git clone --recurse-submodules git@github.com:VEuPathDB/dataset-curator.git
```

### Recommended: Configure Submodule Diff Display

For better visibility of submodule changes in `git diff` and `git log`:

```bash
git config diff.submodule log
```

### If You Already Cloned Without Submodules

If you did a vanilla clone, initialize and fetch the submodules:

```bash
git submodule update --init --recursive
```

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

## Setup

```bash
npm install
```

## Usage

See `CLAUDE.md` for detailed instructions.
