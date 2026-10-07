# VEuPathDB Dataset Curator

Claude Skills for curating new datasets for VEuPathDB resources with AI assistance by Claude Code.

- **Curators** propose datasets (Phase 1). See [For Curators](#for-curators).
- **The data loading team** verifies and loads proposals (Phase 2). See [For the Data Loading Team](#for-the-data-loading-team).
- **Developers** maintain the skills. See [For Developers](#for-developers).

---

## For Curators

### How curation works

Skills run **inside your clone of the `VEuPathDatasets` repository**, which holds dataset definitions, presenters and contacts. For each dataset, Claude:

1. fetches the metadata (NCBI, SRA/GEO), curates contacts and writes the proposal;
2. commits it to a `proposal/<accession>` branch and pushes it;
3. opens a pull request and files a ticket on the `VEuPathDatasets` GitHub Project at status `Initial draft`.

You review and merge the pull request. **Nothing reaches `master` without your merge.**

> **Upgrading from an earlier version?** Earlier versions ran `claude` from any dedicated folder. You no longer need a separate working folder, or to work in other repositories such as EbrcModelCommons or ApiCommonPreseters for curation. Skip the [Prerequisites](#prerequisites) you already have (Volta, Node.js and Claude Code are one-time installs), then follow [Setup](#setup) from step 1. Finish any work in progress in your old folder before you remove it.

### Prerequisites

These instructions are written for macOS.

#### 1. Install Volta

[Volta](https://volta.sh/) manages Node.js versions:

```bash
curl https://get.volta.sh | bash
```

Quit Terminal (Cmd+Q) and reopen it afterwards.

#### 2. Install Node.js

```bash
volta install node
```

On an Apple Silicon Mac (M1, M2, M3, M4…), confirm that Node is the Apple Silicon build:

```bash
node -p process.arch    # should print arm64
```

If it prints `x64`, fix it before going further. See [`Error: claude native binary not installed`](#error-claude-native-binary-not-installed-apple-silicon-macs).

#### 3. Install Claude Code

```bash
volta install @anthropic-ai/claude-code
claude --version
```

The first time you run `claude`, you'll need to complete a one-time account linking and login process.

#### 4. Install GitHub Desktop (recommended)

If you don't already have it, download it from [desktop.github.com](https://desktop.github.com).

#### 5. Install the GitHub CLI (`gh`)

The skills use `gh` to open pull requests and update tickets. Check whether you already have it:

```bash
gh --version
```

If you get `command not found`, install it with GitHub's installer. You do **not** need Homebrew.

1. Go to **https://github.com/cli/cli/releases/latest**.
2. Scroll down to the **Assets** section (click **Show all assets** if needed).
3. Download the file ending in **`_macOS_universal.pkg`** (e.g. `gh_2.102.0_macOS_universal.pkg`). It works on both Intel and Apple Silicon Macs.
4. Double-click the `.pkg` in your Downloads folder and follow the prompts.

**If macOS says "Apple could not verify … is free of malware":**

1. Click **Done** (not "Move to Trash").
2. Open **System Settings → Privacy & Security**.
3. Scroll to the **Security** section and click **Open Anyway** next to the message about the blocked file.
4. Enter your Mac password or use Touch ID, then click **Open** on the final warning.

The **Open Anyway** button only appears for about an hour after the blocked attempt. If you don't see it, double-click the `.pkg` again and return to Privacy & Security. If the button is missing or grayed out, your Mac is probably institutionally managed; ask IT to install the GitHub CLI for you.

When the installer finishes, quit Terminal (Cmd+Q), reopen it, and run `gh --version` to confirm.

### Setup

#### 1. Log in to GitHub from the command line

```bash
gh auth login
```

| Prompt | Answer |
|---|---|
| Where do you use GitHub? | **GitHub.com** |
| Preferred protocol for Git operations? | **HTTPS** (matches GitHub Desktop clones) |
| Authenticate Git with your GitHub credentials? | **Yes** |
| How would you like to authenticate GitHub CLI? | **Login with a web browser** |

Copy the one-time code shown in the terminal, press **Enter**, paste the code in the browser page that opens, and click **Authorize GitHub CLI**.

Then add the `project` permission, which the skills need to update ticket status:

```bash
gh auth refresh -s project
```

This shows another one-time code; repeat the browser step. Then check:

```bash
gh auth status
```

You should see `Logged in to github.com account <your-username>` and **`'project'`** under **Token scopes**.

#### 2. Get the VEuPathDatasets repository

If you already have `VEuPathDatasets` in GitHub Desktop, use that clone as is. Otherwise clone it in GitHub Desktop (**File → Clone Repository → `VEuPathDB/VEuPathDatasets`**), or from the command line:

```bash
git clone git@github.com:VEuPathDB/VEuPathDatasets.git
```

#### 3. Check your Git email

Each proposal's manifest records the curator from `git config user.email`. Make sure it's yours:

```bash
cd /path/to/VEuPathDatasets
git config user.email
```

If it's wrong or empty, set it with `git config --global user.email "you@example.org"`.

#### 4. Start Claude Code in the repository

In GitHub Desktop, choose **Repository → Open in Terminal**, then run:

```bash
claude
```

The first time you start Claude Code in this folder, it asks a quick safety question:

```
Accessing workspace:

 .../VEuPathDatasets

 Quick safety check: Is this a project you created or one you trust? ...

 ❯ No, exit
   Yes, I trust this folder
```

Check that the path ends in **`VEuPathDatasets`**. If it does, press the **down arrow** to highlight **Yes, I trust this folder** and press **Enter**. The skills need permission to read, edit and run files here. Claude Code remembers your answer. If the path shows a different folder, choose **No, exit**, `cd` into your VEuPathDatasets folder and try again.

After an update, Claude Code may also show one-time notices (what changed, which model is the default, an offer to try a new display mode). These don't affect the skills; choose whichever option you prefer.

#### 5. Install (or update) the curation skills plugin

Inside Claude Code:

1. **Add the VEuPathDB marketplace** (first install only):
   ```
   /plugin marketplace add VEuPathDB/dataset-curator
   ```
   It should report "Successfully added marketplace: dataset-curator".

2. **Install the curation-skills plugin**: type `/plugin`, choose **option 1**, press `Space` to select `curation-skills`, and press `i` to install.

   **Already installed?** Type `/plugin` and choose **2. Manage and uninstall plugins → `dataset-curator` → `curation-skills` → Update now**.

3. **Restart Claude Code** so the skills load: type `/exit`, then run `claude` again from the same folder.

#### 6. Read the proposal workflow

Before your first dataset, read the [proposal workflow](shared/resources/proposal-workflow.md).

### Every curation session

#### 1. Prepare the repo in GitHub Desktop

- Select the **VEuPathDatasets** repository.
- Switch the current branch to **`master`**.
- Click **Fetch origin**, then **Pull origin**.
- Make sure the **Changes** tab is empty. Commit or discard any leftover changes first.

#### 2. Open a terminal in the repo

In GitHub Desktop, choose **Repository → Open in Terminal** and confirm you're in the right place:

```bash
pwd          # should end in /VEuPathDatasets
git status   # should say: On branch master, nothing to commit
```

#### 3. Start Claude Code

```bash
claude
```

If Claude Code asks **"Is this a project you created or one you trust?"**, check that the path ends in `VEuPathDatasets` and choose **Yes, I trust this folder**.

#### 4. Tell Claude what you want to curate

```
I want to propose a new genome assembly
```

or

```
I want to propose a bulk RNA-seq dataset
```

Claude activates the matching skill and guides you through the workflow. See [Proposing a dataset](#proposing-a-dataset) for what you'll need to know along the way, such as the rebuild branch and organism abbreviations.

Scratch files go in `.curation/`, which the skills keep out of `git status` through `.git/info/exclude`, so they won't appear in GitHub Desktop's Changes list.

#### 5. Review and merge

- Open the pull request on GitHub and review the proposal.
- **Merge only when the dataset is completely finalised.** Merging moves the ticket from `Initial draft` to `Proposed`, where the data loading team picks it up.
- Back in GitHub Desktop, switch to **`master`** and **Pull origin** so your clone is current for the next dataset.

> **Changing a proposal at `Initial draft`:** You can change the files under `curated/` at any time before merging. **Do not modify files under `inputs/`.** If anything in `inputs/` needs to change, close the pull request (deleting its branch) and start a fresh proposal.

### Proposing a dataset

#### Rebuild branch and organisms

- **Rebuild branch.** Proposals are written against a rebuild branch, given as `--rebuild-branch rebuildNN` (for example `rebuild02`). Organism abbreviations are checked against the organism files on that branch on `origin`. **Don't guess the branch.** It stays the same for a whole year; ask the data loading team if you're unsure which one is current.
- **Abbreviations are proposals.** In Phase 1 you only propose an organism abbreviation; the data loading team confirms or settles it at load time.
- **Naming new organisms.** A new organism from a genome proposal should follow the `<g><sp><Strain>` convention, for example `pfal3D7` or `bcinB05-10`. Off-convention names give a warning when proposing, and stop the load.
- **Organisms from pending genomes.** An RNA-seq proposal can use an organism that only a pending genome proposal introduces. You'll get a warning, and the RNA-seq dataset can't load before that genome does.

#### Aligning one BioProject to several genomes

One proposal can align a BioProject to several organisms, for example a parasite and its host, or the species of a multi-species BioProject.

- `--organism` is the first, or "home", organism, and `--project` is its project. **List the parasite first.**
- Each `--also-organism` takes its project from where the rebuild branch has it, so a HostDB host can join a PlasmoDB proposal.
- Splitting a multi-species BioProject across genomes works the same way: one proposal with several organisms that share no samples. There are no suffixed proposal IDs.

#### Saying which samples go to which genome

With two or more organisms, **every sample** in the sample annotations needs an `"organisms"` list, and **every organism** needs at least one sample. `write-proposal` refuses otherwise; there's no silent default.

```json
"organisms": ["pfal3D7", "<host_abbrev>"]
```

The three usual cases are:

| Case | Assignment |
|---|---|
| Every sample goes to every organism | Each sample lists all organisms |
| Uninfected or control samples | Those samples list the host only |
| Multi-species BioProject | Each sample lists only its own species |

Remove any sample that aligns to no organism.

#### What gets generated

- The curated artifacts (samplesheet, analysisConfig, sample entity files) live under **`curated/<abbrev>/`**, one set per organism, built from that organism's samples.
- With several organisms, each analysisConfig's profile set name starts with the organism abbreviation.
- A multi-organism proposal gets **one presenter**, `<name>_rnaSeq_RSRC`, with one injector per organism. It goes in the first organism's project file.
- Injector props that differ by organism go in the overrides:
  ```json
  "presenter": {
    "organisms": {
      "<abbrev>": { "injectorProps": { ... } }
    }
  }
  ```
  `hasMultipleSamples` and `isDESeq` are worked out per organism.
- The experiment name of a multi-organism proposal must be **unique across all organisms**, because the presenter's name pattern would match any `*_<name>_rnaSeq_RSRC` dataset. Clashes are refused in both directions; if this happens, pick another `"name"`.

#### Re-running `write-proposal`

- If re-running would drop a curated file that no current organism uses, `write-proposal` stops and asks. You can replace it; keeping it is refused.
- Older (`schemaVersion` 3) proposals migrate to v4 when you re-run `write-proposal`. Untouched files move quietly; hand-edited ones go through the usual keep/replace choice.
- The manifest records the curator from `git config user.email`, so check it before re-writing someone else's proposal.

#### Contacts

New contacts are appended to the end of `allContacts.xml` without a prompt.

### Ticket status

A ticket's status is its **Status** field on the configured GitHub Project, and its label names the dataset type.

| Status | Set by |
|---|---|
| `Initial draft` | Publishing the proposal (Claude files the ticket here) |
| `Proposed` | Merging the proposal PR (`merge-proposal.js` does this when Claude merges) |
| `Verification in progress` | Data loading team, optionally claiming it with `start-verification.js` |
| `Needs revision` | Data loading team, `request-revision.js` |
| `Ready to load` | Data loading team, `mark-ready.js`. Only `Ready to load` proposals load. |
| `Loading in progress` | During the load |
| `Post Load QA` | `mark-loaded.js`, after the load PR merges |
| `Final QA`, `Done` | Set by hand |

A merged proposal stays `Proposed` until the data loading team verifies it. The status options must exist on the project's Status field; they are added by hand. Ticket settings ship with the skills (`ticket.github` in `curator.config.json`: `project` with `statusOptions`, and `typeLabels`); a copy at `.curation/curator.config.json` overrides them for this clone.

### Keeping things up to date

#### Claude Code

Claude Code displays "Auto-updating..." on startup, but this doesn't work reliably when installed via Volta. Update manually about once a week:

```bash
volta install @anthropic-ai/claude-code
```

#### Skills

1. In Claude Code, type `/plugin` and choose **2. Manage and uninstall plugins → `dataset-curator` → `curation-skills`** (`Enter` for details) **→ Update now** if an update is available.
2. Restart Claude Code (`/exit`, then `claude`). Skills are loaded when Claude Code starts.

**Don't update skills in the middle of a curation session.** Finish your current workflow and commit your changes first.

Every proposal records the plugin version from `.claude-plugin/plugin.json` in its manifest, so keeping the skills current matters beyond `/plugin` update notifications.

### Available Skills

- **propose-genome-assembly**: Propose a genome assembly - fetch NCBI metadata, curate contacts, write a proposal to VEuPathDatasets, open the PR and ticket
- **propose-bulk-rnaseq**: Propose a bulk RNA-seq dataset - fetch SRA/GEO metadata, analyze samples, curate contacts, write a proposal (one or several organisms), generate pipeline configs, open the PR and ticket
- **load-proposals**: Data loading team - render pending proposals into presenter XML and dataset entries, and lay out delivery directories, per organism on a rebuild branch, one PR per proposal
- **sample-annotations-to-stf**: Convert sample annotations JSON to STF format

### Troubleshooting

| Problem | Fix |
|---|---|
| `zsh: command not found: brew` | You don't need Homebrew. Install `gh` with the `.pkg` installer ([Prerequisites step 5](#5-install-the-github-cli-gh)). |
| `zsh: command not found: gh` after installing | Quit Terminal completely (Cmd+Q) and reopen it. |
| "Apple could not verify…" when opening the `.pkg` | Use **System Settings → Privacy & Security → Open Anyway** ([Prerequisites step 5](#5-install-the-github-cli-gh)). |
| `project` missing from **Token scopes** | Run `gh auth refresh -s project`. |
| `curation-skills` not shown in `/plugin` | Install it fresh ([Setup step 5](#5-install-or-update-the-curation-skills-plugin)). |
| Skills don't seem to activate | Make sure you started `claude` from inside the `VEuPathDatasets` folder, and restarted Claude Code after installing or updating the plugin. |
| Not sure which folder you're in | Run `pwd`, or open a terminal from GitHub Desktop with **Repository → Open in Terminal**. |
| `write-proposal` refuses because samples lack `"organisms"` | With two or more organisms, every sample needs an `"organisms"` list and every organism needs a sample ([details](#saying-which-samples-go-to-which-genome)). |
| Experiment name clash refused | Pick another `"name"`; multi-organism names must be unique across all organisms. |
| `Error: claude native binary not installed` | See below. |

#### `Error: claude native binary not installed` (Apple Silicon Macs)

After installing or updating Claude Code with Volta, running `claude` may fail with:

```
Error: claude native binary not installed.

Either postinstall did not run (--ignore-scripts, some pnpm configs)
or the platform-native optional dependency was not downloaded
(--omit=optional).
```

Newer versions of Claude Code include a separate program built for your Mac's specific chip. On Apple Silicon Macs, this error usually means **Volta downloaded the Intel version of Node.js**, so the installer looked for the wrong chip type and the program was never put in place. This can happen if Volta was ever run in Intel mode via Rosetta.

**1. Check for the mismatch**

```bash
uname -m
node -p process.arch
file "$(volta which node)"
```

On an Apple Silicon Mac, all three should say **`arm64`**. If `node -p process.arch` says **`x64`**, or `file` says **`x86_64`**, you have the Intel version of Node and the steps below will fix it. If all three already say `arm64`, this isn't the cause; ask for help.

**2. Remove the Intel copy of Node**

Use the version number from the path that `volta which node` shows (for example `24.16.0`):

```bash
rm -rf ~/.volta/tools/image/node/24.16.0
rm -f ~/.volta/tools/inventory/node/node-v24.16.0-darwin-x64*
```

**3. Reinstall Node in Apple Silicon mode**

```bash
arch -arm64 volta install node@24.16.0
```

Rerun the checks from step 1; all three should now say `arm64`. If they still show `x86_64`/`x64`, your Terminal app may be set to run in Intel mode: quit Terminal, find it in **Applications → Utilities**, select it and press **Cmd+I**. If **Open using Rosetta** is ticked, untick it, reopen Terminal, and repeat steps 2 and 3.

**4. Reinstall Claude Code**

```bash
volta uninstall @anthropic-ai/claude-code
volta install @anthropic-ai/claude-code
claude --version
```

`claude --version` should now print a version number, e.g. `2.1.289 (Claude Code)`.

**Optional cleanup.** Older Node versions in `~/.volta/tools/image/node/` may hold stale copies of Claude Code. List them with `ls ~/.volta/tools/image/node/`, and delete any version folder other than the one `volta which node` reports, for example `rm -rf ~/.volta/tools/image/node/24.15.0`.

---

## For the Data Loading Team

The **load-proposals** skill renders `Ready to load` proposals into presenter XML and dataset entries and lays out delivery directories, per organism on a rebuild branch, with one PR per proposal. Use [Ticket status](#ticket-status) scripts (`start-verification.js`, `mark-ready.js`, `request-revision.js`, `mark-loaded.js`) to move tickets through verification and loading.

- **Settle organisms before loading.** Run `check-organisms --build NN` to see the abbreviation each organism will load under. Any conflict or uncertainty stops the load until a person decides with `--settle <proposed>=<abbrev>`.
- **One presenter, several datasets.** A multi-organism load writes one presenter to the first organism's project file, plus a `<dataset>` entry and a delivery directory for each organism in its own project.
- **Name collisions are checked again at load.** If one is found, request a revision (`request-revision.js`) so the curator picks a new name.
- **A resumed load must use the same `--settle`.** Re-running after a failed load is refused unless you pass the same `--settle` as the run that made the commit.
- **Off-convention organism names** (not `<g><sp><Strain>`) stop the load.

---

## Recent changes

**Proposal schema v4 (multi-organism support).**

- `write-proposal` requires `--rebuild-branch rebuildNN`; organism abbreviations are checked against that branch.
- One BioProject can be aligned to several genomes (`--organism`, `--project`, `--also-organism`), with per-sample `"organisms"` assignment.
- Curated artifacts moved to `curated/<abbrev>/`, one set per organism; multi-organism proposals get one presenter with one injector per organism.
- New contacts are appended to `allContacts.xml` without a prompt.
- Loads settle organism abbreviations with `check-organisms` and `--settle`.
- All four open VEuPathDatasets proposal PRs (#80, #82, #84, #85) are now v4. Any older (`schemaVersion` 3) proposal migrates the same way when it's next re-written.

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
