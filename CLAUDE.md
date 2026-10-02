# VEuPathDB Dataset Curator

This repository contains Claude Skills for curating datasets for VEuPathDB resources.

## What Are Claude Skills?

Claude Skills are model-invoked capabilities that Claude Code automatically activates based on user requests. Each skill provides:
- Guided workflows for specific dataset types
- Executable scripts for data processing
- Progressive disclosure of detailed instructions

## Who Are You Helping?

**Curator proposing a dataset?**
→ Tell me the dataset type and I'll activate the matching `propose-*` skill

**Data loading team starting a build?**
→ Say "load proposals for build NN" and I'll activate `load-proposals`

**Developer Working on Skills?**
→ See [docs/development.md](docs/development.md) for skill development guidelines and architecture

Developer: use the custom command `/dev-mode` to ensure development context is loaded.

## Repository Structure

```
dataset-curator/
├── skills/
│   ├── propose-genome-assembly/            # Phase 1: genome assembly proposals
│   ├── propose-bulk-rnaseq/                # Phase 1: bulk RNA-seq proposals
│   ├── load-proposals/                     # Phase 2: render proposals on rebuild branches
│   └── sample-annotations-to-stf/          # Utility: sample annotations to STF
├── shared/                                 # Canonical source for files shared across skills
│   ├── scripts/                            # Common scripts (synced into skills)
│   └── resources/                          # Common resources (synced into skills)
│       └── proposal-workflow.md            # Branch model for proposals and builds
├── bin/
│   └── sync-shared.js                      # Copies shared files into skills automatically
├── docs/                                   # Development documentation
│   └── development.md                      # Skill development guidelines
└── tmp/                                    # Temporary working files (not committed)
```

## Available Scripts

Run with `yarn <script-name>`:

- `sync-shared` - Copy shared files into skills (runs automatically via git hook)

## Important: Git Workflow

**Skills perform git operations on their own branches only:**
- `proposal/<accession>` off master (Phase 1) and `load/<accession>` off `rebuild<NN>` (Phase 2)
- Commit, push and open a pull request
- Never push to `master` or `rebuild*`

**Humans merge pull requests.** See `shared/resources/proposal-workflow.md`.

## Getting Started

1. Ensure you have Volta and Node.js installed
2. Run `yarn install` to install dependencies
3. Tell me what dataset type you're processing
4. I'll activate the appropriate skill and guide you through the workflow
