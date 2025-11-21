# VEuPathDB Dataset Curator

Claude Skills for curating new datasets for VEuPathDB resources with AI assistance by Claude Code.

## For Curators

### Prerequisites

#### Install Volta

[Volta](https://volta.sh/) manages Node.js versions:

```bash
curl https://get.volta.sh | bash
```

#### Install Node.js

```bash
volta install node
```

#### Install Claude Code

```bash
volta install @anthropic-ai/claude-code
```

**Note:** The first time you run `claude`, you'll need to complete a one-time account linking and login process.

#### GitHub Desktop (Recommended)

If you don't already have it, download from [desktop.github.com](https://desktop.github.com)

### Setup

#### 1. Clone This Repository

Using GitHub Desktop:
1. File → Clone Repository
2. URL: `https://github.com/VEuPathDB/dataset-curator.git`
3. Local Path: Choose your preferred location (e.g., `~/Documents/GitHub/dataset-curator`)

Or via command line:
```bash
git clone https://github.com/VEuPathDB/dataset-curator.git
cd dataset-curator
```

#### 2. Install the Curation Skills

Link the skills into your Claude Code skills directory:

```bash
ln -s ~/Documents/GitHub/dataset-curator/skills/curate-genome-assembly ~/.claude/skills/curate-genome-assembly
```

**Note**: Adjust the path if you cloned to a different location.

#### 3. Set Up VEuPathDB Repository Access

Skills need access to VEuPathDB configuration repositories. If you already have these cloned via GitHub Desktop, simply create a symlink in your working directory:

```bash
cd ~/Documents/GitHub/dataset-curator
ln -s ~/Documents/GitHub veupathdb-repos
```

This assumes your GitHub Desktop directory contains `ApiCommonDatasets`, `ApiCommonPresenters`, and `EbrcModelCommon`.

**Alternative**: If you don't have these repositories yet, the skill will guide you through setting them up when you first run it.

### Usage

#### Starting a Curation Session

1. Create a working directory for your curation session:
   ```bash
   mkdir ~/my-curation-workspace
   cd ~/my-curation-workspace
   ```

2. Set up the veupathdb-repos symlink:
   ```bash
   ln -s ~/Documents/GitHub veupathdb-repos
   ```

3. Start Claude Code:
   ```bash
   claude
   ```

4. Tell Claude what you want to do:
   ```
   I want to curate a new genome assembly
   ```

Claude will activate the appropriate skill and guide you through the workflow.

**Important**: Follow the [git branching guidelines](https://github.com/VEuPathDB/dataset-curator/blob/main/docs/curator-branching.md) before starting. Create dataset-specific branches in your repositories using GitHub Desktop.

### What Happens During Curation

- **Claude Code handles**: Fetching NCBI data, processing metadata, generating XML configurations, updating files
- **You handle**: Git operations (branches, commits, pull requests) via GitHub Desktop or command line

This separation ensures you maintain full control of your git history and can easily review or rollback changes.

### Available Skills

- **curate-genome-assembly**: Process genome assembly datasets - fetch NCBI metadata, generate organism XML, update ApiCommonDatasets configurations

More skills coming soon!

---

## For Developers

This repository is a **Claude Skills development environment**. Skills are developed directly in the `skills/` directory and distributed via git.

### Development Setup

1. **Clone the repository** (as above)

2. **Install Node.js dependencies**:
   ```bash
   yarn install
   ```

   Volta automatically manages the correct yarn version for this project.

3. **Read the development guide**:
   - [Development Guidelines](docs/development.md) - Skill development standards and architecture
   - [CLAUDE.md](CLAUDE.md) - Instructions for Claude Code (also useful reference for understanding workflows)

4. **Use `/dev-mode` command**: When developing skills, run `/dev-mode` in Claude Code to load development context

### Repository Structure

```
dataset-curator/
├── skills/                     # Claude Skills (develop AND distribute from here)
│   └── curate-genome-assembly/ # Genome assembly curation skill
├── shared/                     # Canonical source for shared files
│   ├── scripts/                # Common scripts synced into skills
│   └── resources/              # Common resources synced into skills
├── bin/
│   └── sync-shared.js          # Copies shared files into skills
├── docs/                       # Development documentation
└── veupathdb-repos/            # Local checkouts (gitignored)
```

### Development Workflow

1. Edit skills in `skills/` or shared files in `shared/`
2. Run `yarn sync-shared` to distribute shared files (or commit - git hook does it automatically)
3. Test skills by running `claude` in this directory
4. Commit changes when ready

See [docs/development.md](docs/development.md) for detailed guidelines on:
- Creating new skills
- Writing zero-dependency scripts
- Progressive disclosure patterns
- Testing and distribution

### Contributing

Skills must:
- Have zero npm dependencies (use Node.js standard library only)
- Inline templates as JavaScript template literals
- Follow progressive disclosure (concise SKILL.md, detailed resources/)
- Be self-contained and portable

Run `yarn sync-shared` before committing to ensure shared files are synchronized.
