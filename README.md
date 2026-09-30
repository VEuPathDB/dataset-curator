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
   It will do some installation work and should hopefully report back "Successfully added marketplace: dataset-curator".

2. **Install the curation-skills plugin**:

   Re-enter the plugin management interface (still in Claude Code)
   ```
   /plugin
   ```
   
   - Choose Option 1
   - Use `Space` to select the `curation-skills` plugin
   - Press `i` to install
   - Restart Claude Code (`/exit` then run `claude` again) to load the skills

That's it for setup! You're ready to start curating.

**Note on the VEuPathDatasets Repository**: Skills run inside a checkout of `VEuPathDatasets`, which holds dataset definitions, presenters and contacts. An existing GitHub Desktop clone works as is.

### Usage

#### Starting a Curation Session

1. **Open your VEuPathDatasets checkout**, or clone one:
   ```bash
   git clone git@github.com:VEuPathDB/VEuPathDatasets.git
   cd VEuPathDatasets
   ```

   The checkout is your curation workspace. The skill creates `proposal/<accession>` branches, commits, pushes and opens a pull request; you review and merge it, in GitHub Desktop or on GitHub. Scratch files go in `.curation/`, which the skills keep out of `git status` through `.git/info/exclude`.

2. **Authenticate**: `gh auth login` once (with the `project` scope for GitHub Projects). Ticket settings ship with the skills; a copy at `.curation/curator.config.json` overrides them for this clone.

3. **Start Claude Code**:
   ```bash
   claude
   ```

4. **Tell Claude what you want to do**:
   ```
   I want to curate a new genome assembly
   ```

Claude will activate the appropriate skill and guide you through the workflow.

**Important**: Read the [proposal workflow](shared/resources/proposal-workflow.md) before starting. Skills work on `proposal/<accession>` branches and open pull requests for you to merge.

### What Happens During Curation

- **Claude Code handles**: Fetching NCBI data, processing metadata, curating contacts, writing the proposal, committing to a `proposal/<accession>` branch, opening the pull request and creating the ticket
- **You handle**: Reviewing and merging the pull request

Nothing reaches `master` without your merge.

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
   - Select `curation-skills` plugin (`<Enter>` for details)
   - Choose `Update now` if an update is available

2. **Restart Claude Code sessions**: Close any active `claude` sessions and start fresh. Skills are loaded when Claude Code starts.

**Important**: Don't update skills in the middle of a curation session. Complete your current workflow, commit your changes, then update skills before starting a new dataset.

### Available Skills

- **propose-genome-assembly**: Propose a genome assembly - fetch NCBI metadata, curate contacts, write a proposal to VEuPathDatasets, open the PR and ticket
- **propose-bulk-rnaseq**: Propose a bulk RNA-seq dataset - fetch SRA/GEO metadata, analyze samples, curate contacts, write a proposal, generate pipeline configs, open the PR and ticket
- **load-proposals**: Data loading team - render pending proposals into presenter XML and dataset entries, and lay out delivery directories, per organism on a rebuild branch, one PR per proposal
- **sample-annotations-to-stf**: Convert sample annotations JSON to STF format

Every proposal a curator writes records the plugin version from
`.claude-plugin/plugin.json` in its manifest, so keeping this version current
matters beyond `/plugin` update notifications.

---

## For Developers

This repository is a **Claude Skills development environment**. Skills are developed directly in the `skills/` directory and distributed via git.

### Development Setup

1. **Clone the repository**:
   ```bash
   git clone https://github.com/VEuPathDB/dataset-curator.git
   cd dataset-curator
   ```

2. **Install Node.js dependencies**:
   ```bash
   yarn install
   ```

   Volta automatically manages the correct yarn version for this project.

3. **Symlink skills for testing** in Claude Code:
   ```bash
   mkdir -p ~/.claude/skills
   cd ~/.claude/skills
   ln -s /path/to/dataset-curator/skills/* .
   ```

   This allows you to test skill changes when you run `claude`.

   **Important**: After editing skill files (especially `SKILL.md`), you must fully restart Claude Code with `/exit` then `claude` to reload them. The `/reset` command only clears conversation context - it does not reload skills from disk.

4. **Read the development guide**:
   - [Development Guidelines](docs/development.md) - Skill development standards and architecture
   - [CLAUDE.md](CLAUDE.md) - Instructions for Claude Code (also useful reference for understanding workflows)

5. **Use `/dev-mode` command**: When developing skills, run `/dev-mode` in Claude Code to load development context

### Publishing Updates

When publishing new versions for users to install:

1. **Update the version** in `.claude-plugin/plugin.json`:
   ```json
   {
     "name": "curation-skills",
     "version": "1.0.2",  // Increment this manually
     ...
   }
   ```

2. **Commit and push** changes to the default branch

3. **Users get updates**: Claude Code's plugin system pulls updates from the default branch. Users will see the new version available through `/plugin` → `Manage and uninstall plugins` → `Update now`

**Note**: The plugin system currently doesn't use git tags - it only tracks the version number in `plugin.json` and pulls from the default branch.

### Repository Structure

```
dataset-curator/
├── skills/                     # Claude Skills (develop AND distribute from here)
│   ├── propose-genome-assembly/  # Phase 1: genome assembly proposals
│   ├── propose-bulk-rnaseq/      # Phase 1: bulk RNA-seq proposals
│   ├── load-proposals/           # Phase 2: proposals into presenter XML
│   └── sample-annotations-to-stf/ # Sample annotations to STF
├── shared/                     # Canonical source for shared files
│   ├── scripts/                # Common scripts synced into skills
│   └── resources/              # Common resources synced into skills
├── bin/
│   └── sync-shared.js          # Copies shared files into skills
└── docs/                       # Development documentation
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

### Security Philosophy

This repository follows a **zero-dependency** approach for runtime skills:
- **Skills**: No npm dependencies - Node.js standard library only
- **Repository tooling**: Minimal dev dependencies (currently only `husky` for git hooks)
- **Supply chain security**: The absence of dependencies IS the security strategy
- **Dependency changes**: The pre-commit hook warns when `yarn.lock` changes - review carefully

This approach eliminates supply chain attack vectors while keeping skills portable and easy to audit.
