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
├── veupathdb-repos/                        # Local checkouts of configuration repositories (gitignored)
│   ├── ApiCommonDatasets/                  # Dataset definitions
│   ├── ApiCommonPresenters/                # Presenter configurations
│   └── EbrcModelCommon/                    # Shared model definitions
├── docs/                                   # Development documentation
│   ├── development.md                      # Skill development guidelines
│   └── curator-branching.md                # Git branching workflow for curators
└── tmp/                                    # Temporary working files (not committed)
```

## Available Scripts

Run with `yarn <script-name>`:

- `sync-shared` - Copy shared files into skills (runs automatically via git hook)

## Important: Git Workflow

**The curator handles all git operations manually:**
- Creating branches in veupathdb-repos/ repositories
- Committing changes
- Creating PRs

**Claude Code handles content operations:**
- Fetching external data (NCBI, etc.)
- Processing and transforming data
- Creating/modifying files according to templates

This separation allows curators to maintain full control of the git history and easily rollback if needed.

## Getting Started

1. Ensure you have Volta and Node.js installed
2. Run `yarn install` to install dependencies
3. Tell me what dataset type you're processing
4. I'll activate the appropriate skill and guide you through the workflow
