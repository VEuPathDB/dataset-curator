# VEuPathDB Dataset Curator

Tools and SOPs for curating new datasets for VEuPathDB resources.

## Cloning the Repository

This repository uses git submodules, some of which are private. **Use SSH for the smoothest experience:**

```bash
git clone --recurse-submodules git@github.com:VEuPathDB/dataset-curator.git
```

SSH authentication with configured keys allows seamless access to private submodules. HTTPS cloning will require entering credentials multiple times during submodule initialization.

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

Inside the `dataset-curator` directory:

```bash
npm install
```

## Usage

After completing all the steps above, go into the directory and type
`claude` at the commandline to start Claude Code. You will then be able to
co-curate a dataset via natural language conversation with Claude's AI.

When curating for real, be sure to follow the [git branching guidelines](docs/curator-branching.md).
This is best done yourself, not by Claude.

Claude Code will follow detailed instructions in the file
[CLAUDE.md](./CLAUDE.md), but these are also human-readable and a
useful guide to how things work.
