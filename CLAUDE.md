# VEuPathDB Dataset Curator

This repository contains Claude Skills for curating datasets for VEuPathDB resources.

## What Are Claude Skills?

Claude Skills are model-invoked capabilities that Claude Code automatically activates based on user requests. Each skill provides:
- Guided workflows for specific dataset types
- Executable scripts for data processing
- Progressive disclosure of detailed instructions

## Who Are You Helping?

**Curator Processing a Dataset?**
→ Tell me what type of dataset you're working on, and I'll activate the appropriate skill

**Developer Working on Skills?**
→ See [docs/development.md](docs/development.md) for skill development guidelines and architecture

Developer: use the custom command `/dev-mode` to ensure development context is loaded.

## Repository Structure

```
dataset-curator/
├── skills/                                 # Claude Skills for dataset curation
│   └── curate-genome-assembly/             # Genome assembly curation skill
│       ├── SKILL.md                        # Skill definition with progressive disclosure
│       ├── scripts/                        # JavaScript processing scripts (zero dependencies)
│       └── resources/                      # Detailed step-by-step instructions
├── shared/                                 # Canonical source for files shared across skills
│   ├── scripts/                            # Common scripts (synced into skills)
│   └── resources/                          # Common resources (synced into skills)
├── bin/
│   └── sync-shared.js                      # Copies shared files into skills automatically
├── veupathdb-repos/                        # Local checkout (gitignored)
│   └── VEuPathDatasets/                    # Dataset definitions, presenters, contacts, classes
├── docs/                                   # Development documentation
│   ├── development.md                      # Skill development guidelines
│   └── proposal-workflow.md                # Branch model for proposals and builds
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
