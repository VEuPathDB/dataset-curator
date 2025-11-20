# Claude Skills Strategy for Dataset Curation

## Overview

This document outlines a strategy for creating standalone Claude Skills for each dataset curation type/SOP. Skills are developed directly in the `skills/` directory as self-contained units, with shared code managed through a sync mechanism.

## What Are Claude Skills?

Claude Skills are modular, reusable capabilities that extend Claude's functionality through:

1. **SKILL.md** - A markdown file with YAML frontmatter containing:
   - `name`: Unique identifier (lowercase, hyphens, numbers only, max 64 chars)
   - `description`: Brief description for skill discovery (max 1024 chars)
   - Detailed instructions that Claude reads when the skill is activated

2. **Optional scripts/** directory - Executable scripts in various languages (Python, JavaScript, shell)

3. **Optional resources/** directory - Supporting files (templates, configs, reference docs)

4. **Progressive Disclosure** - Claude loads detailed resources only when needed, preventing context window overload

Skills are **model-invoked** (Claude decides when to use them based on user requests and skill descriptions) rather than user-invoked like slash commands.

## Proposed Architecture

### Development Workflow

**Develop directly in `skills/` directory** - No separate publishing step:
   - Each skill is a directory containing SKILL.md, scripts, and resources
   - Skills ARE the SOPs (not generated from separate SOP files)
   - Scripts are JavaScript with inlined templates (zero dependencies)
   - What you develop is what users get
   - Test skills during development using Claude Code

**Shared code management**:
   - Common scripts/resources maintained in `shared/` directory
   - Sync mechanism copies shared files into skills automatically
   - Git hook ensures shared files stay in sync
   - Each skill remains self-contained (duplicated code, not linked)

### Directory Structure

```
dataset-curator/
├── shared/                              # Canonical source for shared files
│   ├── scripts/
│   │   ├── check-repos.sh              # Synced into multiple skills
│   │   └── validate-xml.js
│   └── resources/
│       └── valid-projects.json
├── skills/                              # Develop AND distribute from here
│   ├── curate-genome-assembly/
│   │   ├── SKILL.md                     # Frontmatter + overview + workflow links
│   │   ├── scripts/
│   │   │   ├── check-repos.sh          # 🔄 Synced from shared/
│   │   │   └── generate-organism-xml.js # Skill-specific (template inlined)
│   │   └── resources/
│   │       ├── step-1-fetch-ncbi.md    # Progressive disclosure
│   │       ├── step-2-generate-xml.md
│   │       ├── step-3-update-files.md
│   │       └── valid-projects.json     # 🔄 Synced from shared/
│   └── curate-transcriptomics/          # Future skill
│       ├── SKILL.md
│       └── scripts/
│           └── check-repos.sh          # 🔄 Synced from shared/
├── bin/
│   └── sync-shared.js                   # Copies shared/ files into skills/
├── .husky/
│   └── pre-commit                       # Git hook runs sync-shared
├── package.json                         # Sync config + yarn scripts
├── .claude/
│   └── commands/
└── veupathdb-repos/                     # Local repo checkouts (gitignored)
```

**Note**: During development, you may create temporary template files (e.g., `tmp/template.xml`) to help build inline JavaScript functions, then delete them before committing.

## Shared File Sync Mechanism

### Why Shared Files?

Some scripts and resources are common across multiple skills:
- `check-repos.sh` - Validates veupathdb-repos/ repositories
- `validate-xml.js` - Validates generated XML
- `valid-projects.json` - List of valid VEuPathDB projects

### Philosophy: DRY Development, Self-Contained Distribution

**During Development:**
- Maintain canonical source in `shared/` directory
- Edit once, sync to all skills that need it

**For Distribution:**
- Each skill contains its own copy (no shared dependencies)
- Skills remain self-contained and independently distributable
- No path resolution issues

### Sync Configuration

**In `package.json`:**
```json
{
  "name": "veupathdb-dataset-curator",
  "packageManager": "yarn@4.0.0",
  "scripts": {
    "sync-shared": "node bin/sync-shared.js",
    "prepare": "husky install"
  },
  "sharedFiles": {
    "scripts/check-repos.sh": [
      "curate-genome-assembly",
      "curate-transcriptomics"
    ],
    "resources/valid-projects.json": [
      "curate-genome-assembly",
      "curate-transcriptomics"
    ]
  }
}
```

### Developer Workflow

1. **Edit shared file:** `shared/scripts/check-repos.sh`
2. **Run sync:** `yarn sync-shared` (or let git hook do it automatically)
3. **Files updated:** Copies propagate to configured skills
4. **Commit:** Pre-commit hook ensures sync happened
5. **Result:** Single edit updates multiple skills, impossible to forget

### Git Hook (Automated Sync)

Install husky for git hooks:
```bash
yarn add -D husky
yarn husky install
yarn husky add .husky/pre-commit "yarn sync-shared"
```

**`.husky/pre-commit`:**
```bash
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"

# Sync shared files before commit
yarn sync-shared

# Stage synced files
git add skills/*/scripts/* skills/*/resources/*
```

This ensures shared files are always in sync across skills before committing.

## Skill Design Considerations

### 1. Model Invocation vs User Invocation

**Skills are model-invoked**: Claude decides when to activate them based on the user's request and the skill's description. This means:

- **Good skill descriptions are critical** - They need to clearly convey when the skill is relevant
- **Skills should be focused** - One dataset type per skill, not a mega-skill for all types
- **Skills compose well** - Multiple focused skills work better than one large skill

### 2. Progressive Disclosure

Skills should leverage progressive disclosure:

- **SKILL.md should be concise** (under 5,000 words) - Core instructions only
- **Detailed references go in resources/** - Claude loads them only when needed
- **Scripts are invoked explicitly** - Not loaded into context until execution

For dataset curation, this means:
- SKILL.md contains overview, workflow, and links to detailed steps
- Detailed step-by-step instructions → `resources/step-N-*.md` files
- Reference data (organism lists, project IDs, validation rules) → `resources/`
- Data processing scripts → `scripts/` (JavaScript, templates inlined)

### 3. Activation Conditions

Each skill's description should clearly indicate when it's relevant:

**Good**:
> "Process genome assembly datasets for VEuPathDB - fetch NCBI data, generate organism XML, update dataset configurations in ApiCommonDatasets"

**Too vague**:
> "Help with datasets"

**Too broad**:
> "Process any type of biological dataset including genomes, transcriptomes, proteomics, metabolomics, RNA-seq, ChIP-seq..."

### 4. Relationship Between SOPs and Skills

| Aspect | Traditional SOP | Skill (this repo) |
|--------|-----------------|-------------------|
| **Audience** | Humans (curators) | Claude AI + humans |
| **Format** | Plain markdown | SKILL.md with YAML frontmatter |
| **Structure** | Single file or informal | Directory with progressive disclosure |
| **Scripts** | Manual steps | Executable JavaScript (templates inlined) |
| **Distribution** | Documentation only | Self-contained, executable workflow |
| **Progressive Disclosure** | None | Markdown links to resources/ files |

### 5. JavaScript and Template Inlining

Skills use JavaScript exclusively (verified by reviewing [Anthropic's official skills repository](https://github.com/anthropics/skills/) which contains no `package.json` files):

- **Write scripts in JavaScript** - No compilation step needed
- **Inline templates as JavaScript functions** - Solves both dependency and path resolution issues
- **Use template literals** - Native JavaScript backtick strings for XML/text generation
- **No external dependencies** - Self-contained using native JavaScript features only

**Why inline templates?**
1. **No dependencies**: Eliminates need for template libraries (handlebars, etc.)
2. **Path resolution**: No external template files to locate at runtime
3. **Simplicity**: No runtime file loading, parsing, or template compilation
4. **Self-contained**: Everything needed is in the script

**Development approach:**
1. Create temporary template file (e.g., `tmp/template.xml`) during development
2. Use Claude Code to convert template to JavaScript template literal function
3. Delete temporary file before committing
4. Result: Self-contained script with inlined template

### 6. Skill Isolation and Zero Dependencies

Each skill is self-contained with **no npm dependencies**:

- **Inline templates** - Use template literals in JavaScript code, not external files
- **Native JavaScript only** - Use standard library features (no npm packages)
- **Document required veupathdb-repos/ repositories** in SKILL.md
- **Include checking scripts** - Synced from `shared/` or skill-specific
- **Reference documentation** in `resources/` (markdown, JSON, shell scripts only)

**Important**: Official Anthropic skills contain no `package.json` files. Skills must work without external npm dependencies.

**Shared files are duplicated, not linked:**
- Common scripts copied from `shared/` into each skill
- Each skill contains its own copy
- Self-contained: Can distribute individual skills independently
- No path resolution issues between skills

## Benefits of This Approach

### For Developers

1. **Single source of truth** - Skills in `skills/` are developed and distributed
2. **No build step** - JavaScript means no compilation needed
3. **Shared code management** - DRY via `shared/` directory with automatic sync
4. **Version control** - All changes tracked, git hooks enforce sync
5. **Iteration speed** - Edit skill directly, test immediately with Claude Code
6. **Yarn workflow** - Modern package manager optimized for developer experience

### For Skills

1. **Distribution-ready** - Skills in `./skills/` are:
   - Committed to git for team use
   - Shared via GitHub or direct copy
   - Tested in actual form (what you develop is what you ship)
2. **Self-contained** - Each skill has everything it needs (zero dependencies, all files included)
3. **Stable** - Skills change through normal git workflow (tracked, reviewable)
4. **Discoverable** - Clear descriptions help Claude choose the right skill
5. **Path-independent** - Inlined templates and local resources, no external file dependencies

### For Users (Curators)

1. **Automatic activation** - Claude invokes skills when relevant
2. **Consistent workflows** - Skills encode best practices
3. **Reduced errors** - Scripts handle complex transformations
4. **Project awareness** - Skills understand VEuPathDB-specific context

## Implementation Recommendations

### Phase 1: Migrate Developer Experience from npm to Yarn

Since end users no longer interact with this repository (they only use the published skills), we can optimize the developer experience by migrating from npm to yarn.

**Why Yarn?**
- Faster installs and more reliable dependency resolution
- Better workspace/monorepo support (useful if we expand later)
- Cleaner CLI output and better error messages
- Modern features like Plug'n'Play (optional)
- Constraint and protocol systems for better dependency management

**Migration Steps:**

1. **Enable Corepack** (built into Node.js 16.10+):
   ```bash
   corepack enable
   ```

2. **Initialize Yarn**:
   ```bash
   corepack prepare yarn@stable --activate
   ```

3. **Install dependencies**:
   ```bash
   yarn install
   ```

4. **Update package.json** to specify package manager:
   ```json
   {
     "packageManager": "yarn@4.0.0"
   }
   ```

5. **Commit Yarn files**:
   ```bash
   git add .yarn/ .yarnrc.yml yarn.lock
   git add package.json
   git commit -m "Migrate from npm to yarn for developer experience"
   ```

6. **Update documentation** (CLAUDE.md, README) to use `yarn` commands instead of `npm`

### Phase 2: Setup Shared File Infrastructure

1. Create `shared/` directory structure:
   ```
   shared/
   ├── scripts/
   │   └── check-repos.sh
   └── resources/
       └── valid-projects.json
   ```
2. Create `bin/sync-shared.js` script
3. Add sync configuration to `package.json`
4. Set up husky pre-commit hook
5. Test sync mechanism

### Phase 3: Convert Existing SOP to Skill

1. Create `skills/curate-genome-assembly/` directory
2. Write `SKILL.md` with YAML frontmatter and overview
3. Break detailed steps into `resources/step-*.md` files
4. Create JavaScript scripts with inlined templates
5. Add markdown links for progressive disclosure
6. Test skill with Claude Code during development
7. Iterate on skill description and structure

### Phase 4: Establish Development Workflow

1. Document skill development process:
   - How to structure SKILL.md
   - How to use progressive disclosure
   - How to inline templates
   - When to use shared/ vs skill-specific files
2. Create skill development checklist
3. Test complete workflow with curator
4. Document learnings

### Phase 5: Skill Ecosystem

1. Create skills for each dataset type:
   - `curate-genome-assembly`
   - `curate-transcriptomics` (future)
   - `curate-proteomics` (future)
   - etc.
2. Consider meta-skills:
   - `setup-curation-environment` - Checks veupathdb-repos/, creates branches
   - `validate-dataset-xml` - Validates generated XML
   - `create-curation-pr` - Prepares and creates pull requests

## Potential Challenges

### 1. Skill Activation Precision

**Challenge**: Claude might activate the wrong skill if descriptions are too similar.

**Mitigation**:
- Use very specific descriptions with VEuPathDB-specific terminology
- Include dataset type keywords (genome, assembly, BioProject, NCBI)
- Test activation with various user prompts

### 2. Context Window Management

**Challenge**: Skills add to context window, potentially limiting other content.

**Mitigation**:
- Keep SKILL.md under 5,000 words
- Use progressive disclosure for detailed references
- Scripts don't consume context until executed

### 3. Shared File Synchronization

**Challenge**: Keeping shared files in sync across multiple skills.

**Mitigation**:
- Automated sync script (`yarn sync-shared`)
- Git pre-commit hook enforces sync
- Clear configuration in `package.json`
- Impossible to forget (hook runs automatically)

### 4. Skill Updates and Distribution

**Challenge**: How do users get updated skills?

**Mitigation**:
- Skills committed to git (users git pull to update)
- Version skills in SKILL.md frontmatter if needed
- Git history shows exactly what changed
- Skills can be distributed via GitHub, direct copy, or git submodules

### 5. Dependency Management

**Challenge**: Skills may need functionality typically provided by npm packages (template engines, etc.).

**Mitigation** (based on official Anthropic skills having no `package.json` files):
- **Inline templates** as JavaScript functions instead of using template libraries
- **Use native JavaScript** features exclusively (no external dependencies)
- **Simplify requirements** to fit within standard library capabilities
- Path resolution is simplified when templates are inlined (works in both dev and deployed contexts)

## Example: Genome Assembly Skill

### SKILL.md Structure

```markdown
---
name: curate-genome-assembly
description: Process genome assembly datasets for VEuPathDB resources - fetch NCBI metadata, generate organism XML, update ApiCommonDatasets configurations for BioProject accessions
---

# Genome Assembly Dataset Curation

This skill guides processing of genome assembly datasets for VEuPathDB resources.

## Prerequisites Check

This workflow requires the following repositories in `veupathdb-repos/`:
- ApiCommonDatasets
- ApiCommonPresenters
- EbrcModelCommon

First, run the repository status check script (`scripts/check-repos.sh`) to verify
repositories are present and confirm branches with the user before proceeding.

## Workflow

### Step 1: Fetch NCBI Metadata
[Instructions for fetching assembly metadata...]

### Step 2: Generate Organism XML
See detailed instructions: [step-2-generate-xml.md](resources/step-2-generate-xml.md)

### Step 3: Update Dataset Files
See detailed instructions: [step-3-update-files.md](resources/step-3-update-files.md)

## Resources

- [step-1-fetch-ncbi.md](resources/step-1-fetch-ncbi.md) - Detailed step 1 instructions
- [step-2-generate-xml.md](resources/step-2-generate-xml.md) - Detailed step 2 instructions
- [step-3-update-files.md](resources/step-3-update-files.md) - Detailed step 3 instructions
- `resources/check-repos.sh` - Repository status checker (synced from shared/)
- `resources/valid-projects.json` - List of valid VEuPathDB projects (synced from shared/)

## Scripts

- `scripts/generate-organism-xml.js` - Generates organism XML from NCBI data (template inlined)
- `scripts/check-repos.sh` - Validates veupathdb-repos/ repository setup (synced from shared/)
```

### Progressive Disclosure in Action

The SKILL.md contains an overview and workflow with links to detailed step files. Claude loads these resources only when needed, keeping the initial context window small. Each step file can be as detailed as necessary without bloating the main SKILL.md.

### Self-Contained Scripts

The `scripts/generate-organism-xml.js` is pure JavaScript with the XML template inlined as a template literal function. No external dependencies, template files, or npm packages needed. The script can reference shared scripts like `check-repos.sh` which are copied into the skill directory.

## Questions for Further Consideration

1. **Skill naming convention**: Should skills follow a consistent prefix pattern?
   - `veupathdb-curate-genome-assembly`
   - `curate-genome-assembly-veupathdb`
   - `genome-assembly-curator`

2. **Version management**: How to version skills?
   - Semantic versioning in frontmatter?
   - Git tags on skill directories?
   - Version in skill name?

3. **Skill distribution**: Beyond git commits, how should skills be distributed?
   - GitHub releases?
   - Internal npm package?
   - Anthropic's skill repository?

4. **Testing strategy**: How to test skills before publishing?
   - Manual testing?
   - Automated validation?
   - Mock environments?

5. **Multi-repo complexity**: Skills need to work across veupathdb-repos/ - how to handle?
   - Skills check for repos as first step
   - Skills guide user through cloning if missing
   - Skills fail fast with clear error messages

## Conclusion

Creating Claude Skills for dataset curation SOPs offers significant benefits:

- **Automation**: Claude can autonomously guide curators through complex workflows
- **Consistency**: Skills encode institutional knowledge and best practices
- **Simplicity**: Direct development in `skills/` - what you build is what you ship
- **Maintainability**: Shared file sync for DRY, self-contained skills for distribution
- **Scalability**: Easy to add new dataset types as new skills
- **Discoverability**: Claude activates the right skill based on user intent
- **Zero Dependencies**: Pure JavaScript, no npm packages, works anywhere

The key to success is:
- **Direct development**: Skills in `skills/` are developed and distributed as-is
- **Progressive disclosure**: SKILL.md overview with detailed `resources/*.md` files
- **Shared code management**: `shared/` directory with automatic sync to skills
- **Self-containment**: Each skill duplicates what it needs, no external dependencies
- **JavaScript simplicity**: Inline templates, native features, no compilation

This approach enables rapid iteration on skills while ensuring they remain self-contained, distributable units that Claude Code and curators can use effectively together.
