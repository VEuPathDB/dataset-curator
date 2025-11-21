# Development Guide

This guide explains how to develop Claude Skills for dataset curation.

## Repository Architecture

This is a **Claude Skills development repository**. Skills are developed directly in the `skills/` directory and are ready for deployment as-is (no build step required).

### Directory Structure

```
dataset-curator/
├── skills/                     # Claude Skills (develop AND distribute from here)
│   └── curate-genome-assembly/ # Example skill
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
    "scripts/check-repos.sh": [
      "curate-genome-assembly",
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
vim shared/scripts/check-repos.sh

# Sync to skills (or commit and git hook does it)
yarn sync-shared

# Files are updated in all configured skills
git diff skills/*/scripts/check-repos.sh
```

## Testing Skills

### During Development

Test skills using Claude Code in this repository:

```bash
claude
# Tell Claude: "I want to curate a genome assembly"
# Claude should activate the curate-genome-assembly skill
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
- [ ] Scripts are executable (`chmod +x scripts/*.js`)
- [ ] Shared files configured in package.json if needed
- [ ] Run `yarn sync-shared` before committing
- [ ] Test skill activation with Claude Code
- [ ] Git hook ensures shared files stay in sync
- [ ] **Update README.md** with symlink installation instructions for the new skill

## Documentation Style

### Markdown Hyperlinks

**Within skills**: Use relative paths from current file:

```markdown
[Step 1](resources/step-1.md)           # From SKILL.md to resources/
[Curator Workflow](curator-branching.md) # Within resources/
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

### Repository Checking

Many skills need to verify veupathdb-repos/:

```bash
bash scripts/check-repos.sh ApiCommonDatasets ApiCommonPresenters
```

Add check-repos.sh to your skill via sharedFiles config.

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

### Curator vs Developer Responsibilities

**Curators** handle git operations in veupathdb-repos/:
- Creating branches
- Committing changes
- Creating pull requests

**Claude Code** handles content operations:
- Fetching external data
- Processing and transforming data
- Creating/modifying files

This separation ensures curators maintain full control of git history.
