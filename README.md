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

#### Install the Curation Skills Plugin

Start Claude Code with `claude` from any directory. However, it's a good idea to make a dedicated directory to do Claude-based curation work and run `claude` from inside that directory. (See "Starting a Curation Session" below.)

1. **Add the VEuPathDB marketplace** to Claude Code:
   ```
   /plugin marketplace add VEuPathDB/dataset-curator
   ```

2. **Install the curation-skills plugin**:
   - The plugin installation UI will appear
   - Use `Space` to select the `curation-skills` plugin
   - Press `i` to install
   - Restart Claude Code (`/exit` then run `claude` again) to load the skills

That's it for setup! You're ready to start curating.

**Note on VEuPathDB Repositories**: Skills need access to one or more VEuPathDB configuration repositories (e.g. `ApiCommonDatasets`, `ApiCommonPresenters`, `EbrcModelCommon`). If you already have these cloned via GitHub Desktop, you'll create a symlink to them from your curation workspace directory. If not, the skill will guide you through setting them up when you first run it.

### Usage

#### Starting a Curation Session

1. **Create a curation workspace directory** for your curation sessions:
   ```bash
   mkdir ~/my-curation-workspace
   cd ~/my-curation-workspace
   ```

   You can create different workspace directories for different datasets, or reuse the same one.

2. **Set up a link to your GitHub repositories** in your curation workspace directory:
   ```bash
   ln -s ~/Documents/GitHub veupathdb-repos
   ```

   This links to your GitHub Desktop repositories so changes appear in your actual clones. Claude Code will edit files in these repositories, but you will manage branching, committing, pulling and pushing using the GitHub Desktop GUI.

3. **Start Claude Code**:
   ```bash
   claude
   ```

4. **Tell Claude what you want to do**:
   ```
   I want to curate a new genome assembly
   ```

Claude will activate the appropriate skill and guide you through the workflow.

**Important**: Follow the [git branching guidelines](shared/resources/curator-branching.md) before starting. Create dataset-specific branches in your repositories using GitHub Desktop.

### What Happens During Curation

- **Claude Code handles**: Fetching NCBI data, processing metadata, generating XML configurations, updating files
- **You handle**: Git operations (branches, commits, pull requests) via GitHub Desktop or command line

This separation ensures you maintain full control of your git history and can easily review or rollback changes.

### Updating Claude Code

Claude Code is under active development with frequent updates and improvements. Although Claude Code displays "Auto-updating..." on startup, this mechanism doesn't work reliably when installed via Volta.

**Recommended**: Manually update Claude Code weekly by rerunning the installation command:

```bash
volta install @anthropic-ai/claude-code
```

This ensures you have the latest features, bug fixes, and improvements.

### Updating Skills

As we improve and fix bugs in the curation skills, you'll want to update to the latest version:

1. **Check for updates** using the plugin management UI:
   ```
   /plugin
   ```
   - Select `2. Manage and uninstall plugins`
   - Select `dataset-curator` marketplace
   - Select `curation-skills` plugin
   - Choose `Update now` if an update is available

2. **Restart Claude Code sessions**: Close any active `claude` sessions and start fresh. Skills are loaded when Claude Code starts.

**Important**: Don't update skills in the middle of a curation session. Complete your current workflow, commit your changes, then update skills before starting a new dataset.

### Available Skills

- **curate-genome-assembly**: Process genome assembly datasets - fetch NCBI metadata, generate organism XML, update ApiCommonDatasets configurations
- **curate-bulk-rnaseq**: Process bulk RNA-seq datasets - fetch SRA/GEO metadata, analyze sample factors, generate presenter XML and pipeline configurations

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
