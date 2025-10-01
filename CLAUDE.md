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
veupathdb-dataset-curator/
├── SOPs/                  # Step-by-step procedures for curators
│   └── genome-assembly.md
├── bin/                   # TypeScript scripts for data processing
├── lib/                   # Templates and shared utilities
├── data/                  # Git submodules of configuration repositories
└── docs/                  # Development documentation
```

## Available Scripts

Run with `npm run <script-name>`:

- `typecheck` - Validate TypeScript without running
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
- Running validation scripts

This separation allows curators to maintain full control of the git history and easily rollback if needed.

## Getting Started

1. Ensure you have Node.js installed (v14 or higher)
2. Run `npm install` to install dependencies
3. Ask the curator what dataset type they're processing
4. Follow the corresponding SOP in [SOPs/](SOPs/)
