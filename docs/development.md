# Development Guide

This guide explains how to develop Claude Skills for dataset curation.

## Repository Architecture

This is a **Claude Skills development repository**. Skills are developed directly in the `skills/` directory and are ready for deployment as-is (no build step required).

### Directory Structure

```
dataset-curator/
├── skills/                     # Claude Skills (develop AND distribute from here)
│   └── propose-genome-assembly/ # Example skill
│       ├── SKILL.md            # Skill definition with YAML frontmatter
│       ├── scripts/            # JavaScript scripts (zero dependencies)
│       └── resources/          # Detailed documentation (progressive disclosure)
├── shared/                     # Canonical source for shared files
│   ├── scripts/                # Common scripts synced into skills
│   └── resources/              # Common resources synced into skills
├── bin/
│   └── sync-shared.js          # Copies shared files into skills
├── .husky/
│   └── pre-commit              # Git hook runs sync-shared automatically
└── docs/                       # Development documentation
```

## Creating a New Skill

### 1. Create Skill Directory Structure

```bash
mkdir -p skills/my-new-skill/{scripts,resources}
```

### 2. Create SKILL.md with YAML Frontmatter

Create `skills/my-new-skill/SKILL.md`:

```markdown
---
name: my-new-skill
description: Brief description (max 1024 chars) for skill discovery
---

# Skill Title

Overview and workflow...
```

**Important frontmatter fields:**
- `name`: Lowercase, hyphens, numbers only, max 64 chars
- `description`: Clear, specific description for Claude to decide when to activate this skill

### 3. Implement Progressive Disclosure

**Keep SKILL.md concise** (under 5,000 words):
- Overview and workflow
- Links to detailed resources
- Script usage examples

**Detailed documentation goes in resources/**:
- `resources/step-1-*.md` - Detailed step instructions
- `resources/reference-data.json` - Data files
- Links from SKILL.md: `[Step 1 Details](resources/step-1-details.md)`

### 4. Write Scripts (Zero Dependencies)

Scripts must use **JavaScript with inlined templates** (no external dependencies):

```javascript
#!/usr/bin/env node
import { readFileSync } from 'fs';

// Inline templates as JavaScript template literals
function generateOutput(data) {
  return `<output>
    <field>${data.value}</field>
  </output>`;
}

// Main logic
function main() {
  // ... script implementation
}

main();
```

**Key principles:**
- Pure JavaScript (no TypeScript, no compilation)
- No npm dependencies
- Inline templates using template literals
- Use Node.js standard library only

### 5. Configure Shared Files (If Needed)

If your skill needs shared scripts or resources, add to `package.json`:

```json
{
  "sharedFiles": {
    "scripts/check-workspace.js": [
      "propose-genome-assembly",
      "my-new-skill"
    ]
  }
}
```

Then run: `yarn sync-shared`

## Shared File System

### When to Use Shared Files

Use shared files when:
- Multiple skills need the same script or resource
- Maintaining consistency across skills is important
- Examples: validation scripts, project lists, common utilities

### How It Works

1. **Develop in shared/**: Edit canonical source in `shared/scripts/` or `shared/resources/`
2. **Configure in package.json**: List which skills need each shared file
3. **Run sync**: `yarn sync-shared` (or let git hook do it automatically)
4. **Files copied**: Shared files are duplicated into each skill

**Important**: Skills receive **copies** of shared files, not links. Each skill remains self-contained.

### Developer Workflow

```bash
# Edit shared file
vim shared/scripts/check-workspace.js

# Sync to skills (or commit and git hook does it)
yarn sync-shared

# Files are updated in all configured skills
git diff skills/*/scripts/check-workspace.js
```

## Shared Library

`shared/scripts/lib/` is a zero-dependency library synced into skills that
need it. Modules import each other by relative path, so the directory shape
must be preserved when adding `sharedFiles` entries.

| Module | Purpose |
|---|---|
| `lib/config.js` | Finds the VEuPathDatasets checkout, loads `curator.config.json` (shipped in `resources/`, overridable at `.curation/curator.config.json`); `openWorkspace` also creates `.curation/` and excludes it from git |
| `lib/manifest.js` | Proposal manifest schema: `validate`, `read`, `write`, `readOnRef`; `externalIds` (`EXTERNAL_ID_PATTERNS`, `parseExternalIds`, `idsOf`) |
| `lib/geo-xref.js` | `resolveAccession`: BioProject and GEO series in either direction, SuperSeries split per sub-series BioProject; network through an injected `fetchText` |
| `lib/contacts.js` | Reads contact ids from `allContacts.xml` |
| `lib/dataset-classes.js` | Reads one class from `classes.xml`: its props, loader `datasetName` pattern and delivery path |
| `lib/guards.js` | Refusals both phases share: clean tree, expected branch |
| `lib/presenter-file.js` | Insert and lookup in a project presenter file |
| `lib/dataset-file.js` | Lookup and insertion in an organism dataset file under `Datasets/lib/xml/datasets/<Project>/` |
| `lib/git-ops.js` | `createGit(repoPath)`: branch, commit, push, `gh pr create` |
| `lib/proposal-ops.js` | Phase 1 operations: start, write and publish a proposal |
| `lib/load-ops.js` | Phase 2 operations: list proposals, check preconditions, load one |
| `lib/ticket/` | `createTicketClient(config)`: GitHub issues |
| `lib/ticket/statuses.js` | The shared status vocabulary |
| `dataset-types/<type>.js` | One module per dataset type; see the contract below |
| `lib/artifacts.js` | Delivery location from the class, writing artifacts, the hand-off note |
| `lib/stf.js` | Sample annotations to STF entity files (also behind the `sample-annotations-to-stf` skill) |
| `render-proposal.js` | CLI over the dataset-type modules |
| lifecycle CLIs | `start-`, `write-`, `publish-proposal.js` (Phase 1); `list-proposals.js`, `load-proposal.js` (Phase 2) |

#### Dataset-type contract

`derive*` functions run in Phase 1, from `write-proposal.js`, and turn the
proposal's inputs plus curator overrides into curated records. `render*`
functions run in both phases and read only the manifest and those records;
`renderPresenter` and `renderDataset` never open `inputs/`.

| Export | Phase | Purpose |
|---|---|---|
| `organismRule` | both | `{ new: true, max }` for a type that introduces organisms (at most `max`), or `{ new: false }` for one that uses organisms already loaded or proposed. Drives the manifest's `organisms` array and the Phase 1 cross-check |
| `deriveOrganism(inputs, accession, overrides, warn)` | 1 | a `new` type only: species, strain and NCBI taxon id for the proposed organism, from the inputs and `overrides.organism`; calls `warn` for a fallback the curator should see |
| `injectorDefaults`, `requiredFields`, `requiredInjectorProps` | both | site defaults applied at render; presenter fields, and injector props, that must not be empty (beyond `displayName`, `summary`, `description`) |
| `derivePresenter(dir, overrides.presenter)` | 1 | the `curated/presenter.json` record |
| `presenterNames(dir)` | both | one presenter name per organism, primary first, derived from the manifest |
| `renderPresenter(dir, { build, organism })` | both | one organism's presenter XML |
| `datasetClass` | both | the `classes.xml` class, or absent for types without a dataset entry yet |
| `deriveIdentity(dir, { primaryContactName })` | 1 | default `name` and `version` |
| `deriveDataset(dir, classDef, overrides.dataset)` | 1 | the `curated/dataset.json` record, checked against the class |
| `renderDataset(dir, classDef)` | both | the `<dataset>` entry for each organism file |
| `normalizeCurated(dir, datasetOverrides)` | 1 | types with loading artifacts: rewrites the staged sample annotations in normalized form (sample ids, labels) |
| `deriveArtifacts(dir)` | 1 | types with loading artifacts: `{ filename: text }` for `derivedCuratedFiles` |
| `derivedCuratedFiles` | 1 | the files under `curated/` that `deriveArtifacts` rewrites on every write |
| `checkCurated(dir)`, `assertCuratedAgree(dir)` | 1 and 2 | the agreement check: error strings, and the same as a thrown error. Run at write, at publish and at load |
| `renderArtifacts(dir, organism)` | both | `{ files }` for one organism's delivery directory, after the agreement check |

Types are registered in `dataset-types/index.js`.

The record schemas and validation live in `dataset-types/_common.js`, and class
definitions come from the checkout's `classes.xml` via `lib/dataset-classes.js`.
Keep site-wide defaults such as `injectorDefaults` out of the records, so
changing a default reaches every queued proposal at load time.

The `render-proposal.js` CLI warns on stderr when a record's `injectorProps`
include a name that isn't in the type's defaults.

### GitHub issues backend

`ticket.github` keys (all required):

- `repo`, the issues repository.
- `milestone`, a title template such as `"Build {build}"`.
  `create` files the issue under the milestone for the build it is given,
  creating the milestone first if the repository has none by that title.
  `getBuild` reads the build back from the ticket's milestone and fails
  without one. The milestone is the only record of a proposal's build.
- `project` (`owner`, `number`, `statusField`, `statusOptions`). Ticket status
  is the issue's single-select Status field on this GitHub Project.
  `statusOptions` maps every status in `ticket/statuses.js` to an option name
  (shipped, matching the Dataset Curation board: `draft` → `Initial draft`,
  `proposed` → `Proposed`,
  `verifying` → `Verification in progress`, `revision` → `Needs revision`,
  `ready` → `Ready to load`, `loading` → `Loading in progress`, `qa` →
  `Post Load QA`, `finalqa` → `Final QA`, `done` → `Done`). `create` adds the issue to the
  project with Status `Initial draft`, `setStatus` sets it, `getStatus` reads it
  with one `gh api graphql` call, and `checkProject` confirms read-only that
  the field and every configured option exist (publish and load run it before
  changing anything). `statusOption(status)` gives the option name for
  messages. Reading and setting fail loudly: an issue missing from the
  project, with no Status, or with an option outside `statusOptions` is
  refused; the first two carry `code: 'NO_STATUS'`, which a publish re-run of
  its own fresh ticket repairs. The options are added to the field by hand and
  the backend never edits the field. The `gh` token needs the `project` scope
  (`gh auth refresh -s project`).

  Who sets what: publish sets `draft` (also on a fresh re-run and in the
  post-create recovery), and returns an updated `verifying`, `ready` or
  `revision` ticket to `proposed`. `merge-proposal.js` (`mergeProposal` in
  `lib/merge-ops.js`) merges a proposal PR and sets `proposed`; a person
  merging by hand moves the card. Verification commands treat a merged `draft`
  as `proposed` with a notice and refuse an unmerged one; a person verifies the merged proposal, optionally claiming it with
  `start-verification.js` (`verifying`, and `assign` adds them as assignee),
  then runs `mark-ready.js` (`ready`) or `request-revision.js` (`revision`;
  on a ticket already there it only adds the reason). Load accepts only
  `ready` and sets `loading`; `mark-loaded.js` sets `qa` after the load PR
  merges. `finalqa` (data loaders) and `done` (outreach team) are set by
  hand; no skill sets them. From `loading` on, a proposal is locked.
  `create` also assigns the issue to the `gh` user (`--assignee @me`), the
  curator filing the proposal.
- `typeLabels`, a map from dataset type to issue label (shipped:
  `bulk-rnaseq` → `rnaseq`, `genome-assembly` → `genome`). `create` labels
  the issue with its dataset type, creating the label on first use, and
  refuses a dataset type missing from the map before calling `gh`;
  `checkDatasetType` makes the same check offline, and publish runs it in
  its preflight so updates are checked too. A new
  dataset type needs an entry here. Labels carry no status.

If `gh issue create` prints no issue URL, `create` looks for the one open
issue with exactly that title, and otherwise says an issue may have been
created. If `create` fails after the issue exists (the project step), the
error names the issue and carries it as `error.ticket`; `publishProposal` records it in the
manifest before rethrowing, and on the re-run re-sets Status `Initial draft` on a
ticket not yet on master instead of filing a second issue.

### External ids

A manifest's optional `externalIds` records every archive id a proposal is
known by, the accession's own included (`{ bioproject, geo }`). Kinds and
their patterns live in `EXTERNAL_ID_PATTERNS`; an accession of a known kind
must appear under its kind. `start-proposal.js` and `publish-proposal.js`
refuse when another proposal, on `origin/master` or another `proposal/*`
branch on origin, is named for or records one of them. `write-proposal.js`
keeps ids already recorded and adds those given with `--external-id`.

### Adding a dataset type

1. Create `shared/scripts/dataset-types/<type>.js` implementing the contract above; the dataset exports are needed only once the type has a `classes.xml` class.
2. Add a fixture under `tests/fixtures/proposals/` (with `curated/presenter.json` from `derivePresenter`, and any overrides under `tests/fixtures/overrides/`) and tests in `tests/dataset-types.test.js`.
3. Register the module in `dataset-types/index.js`.
4. Register the module in `package.json` `sharedFiles` for every skill.
5. Add the type to `ticket.github.typeLabels` in `shared/resources/curator.config.json`.
6. Create the `propose-<type>` skill.

### Tests

```bash
yarn test
```

Tests run against `shared/` with Node's built-in runner. Git tests use a
throwaway repository in the system temp directory. Ticket backends are tested
with injected stubs; no test reaches the network. Golden `expected.xml` files
under `tests/fixtures/proposals/` pin renderer output; regenerate them
deliberately with the CLI when a template change is intended.

## Testing Skills

### During Development

Test skills using Claude Code in this repository:

```bash
claude
# Tell Claude: "I want to curate a genome assembly"
# Claude should activate the propose-genome-assembly skill
```

### Skill Activation

Skills are **model-invoked** - Claude decides when to activate based on:
- User's request
- Skill's description in frontmatter
- Context of the conversation

Test with various phrasings:
- "Process a genome assembly dataset"
- "I have a new genome to curate"
- "Help with genome assembly curation"

## Skill Development Checklist

- [ ] SKILL.md has proper YAML frontmatter (name, description)
- [ ] Description clearly indicates when skill is relevant
- [ ] SKILL.md is concise (under 5,000 words)
- [ ] Detailed docs in resources/ with progressive disclosure
- [ ] Scripts are JavaScript with inlined templates
- [ ] Scripts have zero npm dependencies
- [ ] Scripts have shebang header (`#!/usr/bin/env node`) and are executable (`chmod +x scripts/*.js`)
- [ ] Shared files configured in package.json if needed
- [ ] Run `yarn sync-shared` before committing
- [ ] Test skill activation with Claude Code
- [ ] Git hook ensures shared files stay in sync
- [ ] **Update README.md** add new skill to "Available Skills"

## Documentation Style

### Markdown Hyperlinks

**Within skills**: Use relative paths from current file:

```markdown
[Step 1](resources/step-1.md)           # From SKILL.md to resources/
[Proposal Workflow](proposal-workflow.md)  # Within resources/
```

**Important**: Don't link outside skill directory (`../../`) - skills must be self-contained!

## Distribution

Skills in `skills/` are ready for distribution:

1. **Git-based distribution** (current):
   - Users clone this repository
   - Skills work directly from `skills/` directory

2. **User installation** (future):
   - Copy skill directory to `~/.claude/skills/`
   - Skill is self-contained and works immediately

## Philosophy

### DRY Development, Self-Contained Distribution

- **During development**: Single source in `shared/`, sync to skills
- **For distribution**: Each skill has everything it needs (zero dependencies)

### Zero Dependencies

- No npm packages in skills
- No template libraries (inline templates instead)
- Pure JavaScript using Node.js standard library
- Self-contained: works anywhere Node.js runs

### Progressive Disclosure

- SKILL.md: Overview and workflow
- resources/: Detailed step-by-step instructions
- Claude loads resources only when needed
- Keeps context window manageable

## Common Patterns

### Workspace Checking

Skills run from the top of a VEuPathDatasets checkout and verify it first:

```bash
node scripts/check-workspace.js
```

Add check-workspace.js to your skill via sharedFiles config. Scratch paths are
relative to the checkout: `.curation/tmp/` and `.curation/delivery/`.

### Data Validation

Load validation data from resources/:

```javascript
const validProjects = JSON.parse(
  readFileSync(new URL('../resources/valid-projects.json', import.meta.url), 'utf-8')
);
```

### Template Inlining

Instead of external template files:

```javascript
// ❌ Don't do this (external dependency)
const template = Handlebars.compile(readFileSync('template.xml', 'utf-8'));

// ✅ Do this (inline template)
function generateXML(data) {
  return `<root>
    <field>${data.value}</field>
  </root>`;
}
```

## Git Workflow

### Git Hook

A pre-commit hook automatically runs `yarn sync-shared` to keep shared files in sync.

### Who Does What

**Skills** (via shared scripts) branch, commit, push and open pull requests
on `proposal/*` and `load/*` branches in the VEuPathDatasets checkout they run from.

**Humans** review and merge pull requests. Skills never push to `master` or
`rebuild*` branches.
