# VEuPathDB Dataset Curator

This repository contains tools and standard operating procedures (SOPs) for processing new datasets for VEuPathDB resources.

## Who Are You Helping?

**Curator Processing a Dataset?**
→ Ask what type of dataset they're working on, then follow the appropriate SOP in [SOPs/](SOPs/)

**Developer Working on Scripts/SOPs?**
→ See [docs/development.md](docs/development.md) for repository architecture and development guidelines

Developer: use the custom command `/dev-mode` to ensure this context is loaded.

## Repository Structure

```
dataset-curator/
├── SOPs/                                   # Step-by-step procedures for curators
│   └── genome-assembly.md                  # SOP for processing genome assemblies
├── bin/                                    # TypeScript scripts for data processing
│   └── generate-dataset-organism-xml.ts    # Generate organism dataset XML from NCBI data
├── lib/
│   └── templates/                          # XML templates for dataset configuration
│       └── dataset-organism.xml            # Template for organism dataset entries
├── data/                                   # Git submodules of configuration repositories
│   ├── ApiCommonDatasets/                  # Dataset definitions (submodule)
│   ├── ApiCommonPresenters/                # Presenter configurations (submodule)
│   └── EbrcModelCommon/                    # Shared model definitions (submodule)
├── docs/                                   # Development documentation
│   ├── development.md                      # Repository architecture and guidelines
│   └── curator-branching.md                # Git branching workflow for curators
└── tmp/                                    # Temporary working files (not committed)
```

## Available Scripts

Run with `npx run <script-name>`:

- `typecheck` - Validate TypeScript without running
- `typecheck:watch` - As above, but forever.
- (Additional scripts will be documented as they're added)

## Important: Git Workflow

**The curator handles all git operations manually:**
- Creating branches in parent and submodule repos
- Committing changes
- Creating PRs

**Claude Code handles content operations:**
- Fetching external data (NCBI, etc.)
- Processing and transforming data
- Creating/modifying files according to templates

This separation allows curators to maintain full control of the git history and easily rollback if needed.

## Getting Started

1. Ensure you have Volta and Node.js installed
2. Run `npm install` to install dependencies
3. Ask the curator what dataset type they're processing
4. Follow the corresponding SOP in [SOPs/](SOPs/)
