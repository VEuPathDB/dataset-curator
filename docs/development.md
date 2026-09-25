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
| `lib/manifest.js` | Proposal manifest schema: `validate`, `read`, `write`, `readOnRef` |
| `lib/contacts.js` | Reads contact ids from `allContacts.xml` |
| `lib/dataset-classes.js` | Reads one class from `classes.xml`: its props, loader `datasetName` pattern and delivery path |
| `lib/guards.js` | Refusals both phases share: clean tree, expected branch |
| `lib/presenter-file.js` | Insert and lookup in a project presenter file |
| `lib/git-ops.js` | `createGit(repoPath)`: branch, commit, push, `gh pr create` |
| `lib/proposal-ops.js` | Phase 1 operations: start, write and publish a proposal |
| `lib/load-ops.js` | Phase 2 operations: list proposals, check preconditions, load one |
| `lib/ticket/` | `createTicketClient(config)`: Redmine or GitHub issues |
| `lib/ticket/statuses.js` | The shared status vocabulary |
| `dataset-types/<type>.js` | One module per dataset type: `derivePresenter`, `renderPresenter`, `presenterName`, `requiredFields`, `injectorDefaults` |
| `render-proposal.js` | CLI over the dataset-type modules |
| lifecycle CLIs | `start-`, `write-`, `publish-proposal.js` (Phase 1); `list-proposals.js`, `load-proposal.js` (Phase 2) |

Each dataset-type module has two halves. `derivePresenter(proposalDir, overrides)` runs in
Phase 1 (from `write-proposal.js`) and turns the proposal's inputs plus curator
overrides into the `curated/presenter.json` record. `renderPresenter(proposalDir)` runs
in both phases and reads only the manifest and that record; it never opens
`inputs/`. `requiredFields` lists the fields that type must not leave empty,
on top of `displayName`, `summary` and `description`. The record schema and its
validation live in `dataset-types/_common.js`. Keep site-wide defaults, such as
`injectorDefaults`, out of the record, so changing a default reaches every
queued proposal at load time.

The `render-proposal.js` CLI warns on stderr when a record's `injectorProps`
include a name that isn't in the type's defaults.

### GitHub issues backend precondition

Before a workspace configured with `ticket.system: "github"` is used for the
first time, the three labels named in `ticket.github.labels` must already
exist in the issues repository: `create` applies the `proposed` label on the
very first call (`--label proposed`), and `setStatus` relies on the other two
existing by the time it runs. The backend does not create any of them.

Two optional keys extend it:

- `milestone`, a title template such as `"Build {build}"`. `create` files the
  issue under the proposal's target-build milestone, creating the milestone
  first if the repository has none by that title.
- `project` (`owner`, `number`, `statusField`, `statusOptions`). `create` and
  `setStatus` add the issue to that GitHub Project and set its status column.
  The column is display only: labels remain the status the skills read, and a
  failed project update prints a warning instead of failing the ticket
  operation. The `gh` token needs the `project` scope (`gh auth refresh -s project`).

### Adding a dataset type

1. Create `shared/scripts/dataset-types/<type>.js` exporting `derivePresenter`, `renderPresenter`, `presenterName`, `requiredFields` and `injectorDefaults`.
2. Add a fixture under `tests/fixtures/proposals/` (with `curated/presenter.json` from `derivePresenter`, and any overrides under `tests/fixtures/overrides/`) and tests in `tests/dataset-types.test.js`.
3. Register the renderer in `package.json` `sharedFiles` for every skill.
4. Create the `propose-<type>` skill.

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
