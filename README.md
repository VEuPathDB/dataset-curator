# VEuPathDB Dataset Curator

Tools and SOPs for curating new datasets for VEuPathDB resources with AI hand-holding by Claude Code.

## Cloning the Repository

This repository uses git submodules, some of which are private. **Use SSH for the smoothest experience:**

```bash
git clone git@github.com:VEuPathDB/dataset-curator.git
cd dataset-curator
git submodule update --init
```

SSH authentication with configured keys allows seamless access to private submodules. HTTPS cloning will require entering credentials multiple times during submodule initialization.

### Recommended: Configure Submodule Diff Display

For better visibility of submodule changes in `git diff` and `git log`:

```bash
git config diff.submodule log
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

**Note:** The first time you run `claude`, you'll need to complete a one-time account linking and login process.

When curating for real, be sure to follow the [git branching guidelines](docs/curator-branching.md).
This is best done yourself, not by Claude.

Claude Code will follow detailed instructions in the file
[CLAUDE.md](./CLAUDE.md), but these are also human-readable and a
useful guide to how things work.
