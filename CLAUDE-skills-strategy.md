# Claude Skills Strategy for Dataset Curation

## Overview

This document outlines a strategy for creating standalone Claude Skills for each dataset curation type/SOP, while maintaining TypeScript-based development in this repository.

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

1. **Develop in TypeScript** (this repo)
   - SOPs remain as markdown in `SOPs/`
   - Scripts remain in `bin/` as TypeScript
   - Templates in `lib/templates/`
   - All development, testing, and maintenance happens here

2. **Publish as Skills** (via command/skill)
   - A `publish-as-claude-skill` command/skill packages SOPs into publishable skills
   - Compiles TypeScript to JavaScript for skill scripts
   - Outputs to `./skills/` directory (committed to git)
   - Each skill is self-contained and ready for distribution

### Directory Structure

```
dataset-curator/
├── SOPs/                                # Source SOPs (TypeScript-based development)
│   └── genome-assembly.md
├── bin/                                 # TypeScript scripts (source)
│   └── generate-dataset-organism-xml.ts
├── lib/
│   └── templates/
│       └── dataset-organism.xml
├── skills/                              # Published skills (committed to git)
│   └── curate-genome-assembly/          # Generated skill
│       ├── SKILL.md                     # Transformed from SOP
│       ├── scripts/                     # Compiled JavaScript
│       │   └── generate-dataset-organism-xml.js
│       └── resources/                   # Templates and references
│           └── dataset-organism.xml
├── .claude/
│   └── commands/
│       └── publish-skill.md             # Command to publish skills
└── project_home/                        # Local repo checkouts (gitignored)
```

## Skill Publishing Process

### The `publish-as-claude-skill` Command/Skill

This would be a local skill or slash command that:

1. **Reads an SOP** (e.g., `SOPs/genome-assembly.md`)
2. **Generates SKILL.md** with appropriate frontmatter:
   ```yaml
   ---
   name: curate-genome-assembly
   description: Process genome assembly datasets for VEuPathDB - fetch NCBI data, generate organism XML, update dataset configurations
   ---
   ```
3. **Compiles TypeScript scripts** referenced in the SOP to JavaScript
4. **Copies templates** to the skill's resources directory
5. **Creates skill directory** in `./skills/`
6. **Validates** the skill structure

### Example Invocation

```bash
# As a slash command
/publish-skill genome-assembly

# Or as part of development workflow
npx tsx bin/publish-skill.ts genome-assembly
```

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
- SKILL.md contains the workflow and key instructions
- Detailed organism lists, project IDs, validation rules → `resources/`
- Data processing scripts → `scripts/` (compiled from TypeScript)

### 3. Activation Conditions

Each skill's description should clearly indicate when it's relevant:

**Good**:
> "Process genome assembly datasets for VEuPathDB - fetch NCBI data, generate organism XML, update dataset configurations in ApiCommonDatasets"

**Too vague**:
> "Help with datasets"

**Too broad**:
> "Process any type of biological dataset including genomes, transcriptomes, proteomics, metabolomics, RNA-seq, ChIP-seq..."

### 4. Relationship Between SOPs and Skills

| Aspect | SOP (this repo) | Skill (published) |
|--------|-----------------|-------------------|
| **Audience** | Internal developers | Claude AI |
| **Format** | Human-readable markdown | SKILL.md with frontmatter |
| **Scripts** | TypeScript (editable) | JavaScript (compiled) |
| **Maintenance** | Primary source of truth | Generated artifact |
| **Version Control** | Active development | Snapshot for distribution |
| **Context** | Assumes repo structure | Self-contained with resources |

### 5. TypeScript → JavaScript Compilation

Skills may be limited to JavaScript (based on ecosystem trends), so:

- **Use `tsx` or `tsc` to compile** TypeScript to JavaScript during publishing
- **Include necessary dependencies** in a skill-specific `package.json` if needed
- **Consider bundling** with `esbuild` or similar for single-file scripts
- **Test compiled scripts** as part of the publishing process

Example compilation:
```bash
# In publish-skill script
npx tsc bin/generate-dataset-organism-xml.ts \
  --outDir skills/curate-genome-assembly/scripts \
  --module es2020 \
  --target es2020
```

### 6. Skill Isolation and Dependencies

Each skill should be self-contained:

- **Include required templates** in `resources/`
- **Bundle or vendor dependencies** if script execution needs them
- **Document required project_home repos** in SKILL.md
- **Provide repo checking scripts** as part of the skill

Claude can install packages from npm/PyPI when loading skills, but:
- Prefer minimal dependencies
- Document all required packages clearly
- Consider bundling for reliability

## Benefits of This Approach

### For Developers

1. **Single source of truth** - SOPs in this repo are the canonical version
2. **TypeScript benefits** - Type safety, better tooling, easier refactoring
3. **Version control** - All changes tracked in this repo
4. **Testing** - Can test TypeScript directly without skill packaging
5. **Iteration speed** - No need to republish skill for every small change during development

### For Skills

1. **Distribution-ready** - Skills in `./skills/` can be:
   - Committed to git for team use
   - Shared via GitHub
   - Distributed to enterprise users
2. **Self-contained** - Each skill has everything it needs
3. **Stable** - Published skills don't change unless explicitly republished
4. **Discoverable** - Clear descriptions help Claude choose the right skill

### For Users (Curators)

1. **Automatic activation** - Claude invokes skills when relevant
2. **Consistent workflows** - Skills encode best practices
3. **Reduced errors** - Scripts handle complex transformations
4. **Project awareness** - Skills understand VEuPathDB-specific context

## Implementation Recommendations

### Phase 1: Manual Proof of Concept

1. Manually create `skills/curate-genome-assembly/` from `SOPs/genome-assembly.md`
2. Manually compile TypeScript to JavaScript
3. Test the skill in a real curation scenario
4. Iterate on skill description and structure
5. Document learnings

### Phase 2: Automate Publishing

1. Create `bin/publish-skill.ts` that:
   - Parses SOP markdown
   - Generates SKILL.md with frontmatter
   - Compiles TypeScript scripts
   - Copies templates
   - Validates output
2. Create `/publish-skill` slash command or local skill
3. Test on multiple SOPs

### Phase 3: Maintenance Workflow

1. When SOP changes:
   - Edit TypeScript/markdown in this repo
   - Test locally
   - Run publish-skill
   - Commit updated skill to `./skills/`
   - Users get updated skill on next pull

### Phase 4: Skill Ecosystem

1. Create skills for each dataset type:
   - `curate-genome-assembly`
   - `curate-transcriptomics` (future)
   - `curate-proteomics` (future)
   - etc.
2. Consider meta-skills:
   - `setup-curation-environment` - Checks project_home, creates branches
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

### 3. TypeScript Compilation Complexity

**Challenge**: TypeScript → JavaScript compilation may introduce bugs or compatibility issues.

**Mitigation**:
- Use simple, portable TypeScript
- Target modern but widely-supported ES2020
- Test compiled JavaScript, not just TypeScript
- Consider bundling with esbuild for single-file output

### 4. Skill Version Synchronization

**Challenge**: Skills in user environments may become stale as SOPs evolve.

**Mitigation**:
- Commit skills to git (users pull to update)
- Version skills in SKILL.md frontmatter
- Document update process clearly
- Consider automated checks for skill freshness

### 5. Dependency Management

**Challenge**: Skills may need external packages (handlebars, etc.).

**Mitigation**:
- Bundle dependencies with esbuild if possible
- Document required npm packages in SKILL.md
- Leverage Claude's ability to install packages from npm
- Prefer standard library functions where possible

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

This workflow requires the following repositories in `project_home/`:
- ApiCommonDatasets
- ApiCommonPresenters
- EbrcModelCommon

First, run the repository status check script (see resources/check-repos.sh) to verify
repositories are present and confirm branches with the user before proceeding.

## Workflow

### Step 1: Fetch NCBI Metadata
[Instructions for fetching assembly metadata...]

### Step 2: Generate Organism XML
[Instructions for running generate-dataset-organism-xml script...]

### Step 3: Update Dataset Files
[Instructions for inserting XML into project_home files...]

## Resources

- `resources/dataset-organism.xml` - XML template
- `resources/check-repos.sh` - Repository status checker
- `resources/valid-projects.json` - List of valid VEuPathDB projects

## Scripts

- `scripts/generate-dataset-organism-xml.js` - Generates organism XML from NCBI data
```

### Compiled Scripts

The `scripts/generate-dataset-organism-xml.js` would be the compiled JavaScript version of the current TypeScript script, bundled with handlebars dependency if needed.

### Resources

- `resources/dataset-organism.xml` - Copy of template
- `resources/check-repos.sh` - Bash script to check project_home repos
- `resources/valid-projects.json` - JSON list of valid project IDs

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

5. **Multi-repo complexity**: Skills need to work across project_home repos - how to handle?
   - Skills check for repos as first step
   - Skills guide user through cloning if missing
   - Skills fail fast with clear error messages

## Conclusion

Creating Claude Skills for dataset curation SOPs offers significant benefits:

- **Automation**: Claude can autonomously guide curators through complex workflows
- **Consistency**: Skills encode institutional knowledge and best practices
- **Maintainability**: TypeScript development in this repo with compiled skill distribution
- **Scalability**: Easy to add new dataset types as new skills
- **Discoverability**: Claude activates the right skill based on user intent

The key to success is maintaining a clear separation between:
- **Development** (TypeScript in this repo, human-focused SOPs)
- **Distribution** (JavaScript skills in `./skills/`, AI-focused SKILL.md)

With a robust `publish-as-claude-skill` workflow, this approach enables rapid iteration on SOPs while providing stable, reliable skills for curators and Claude to collaborate effectively.
