# Plan 1 of 4: VEuPathDatasets Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Point every skill, script and document at the single VEuPathDatasets repository and retire the three archived repositories from the codebase.

**Architecture:** Path substitutions in skills and resources, a new `proposal-workflow.md` shared resource describing the master/rebuildXX branch model, and removal of `curator-branching.md`. No behaviour changes to scripts. Plans 2 to 4 build on this branch; the four plans merge together.

**Tech Stack:** Bash, sed, Node 18+ (existing `bin/sync-shared.js`).

**Spec:** `docs/superpowers/specs/2026-09-18-two-phase-proposals-design.md`

**Branch:** all work on `two-phase-proposals` (already exists). Never commit to main.

---

## File structure

| Path | Action | Responsibility |
|---|---|---|
| `shared/scripts/check-repos.sh` | Modify | Header and examples name VEuPathDatasets |
| `shared/resources/proposal-workflow.md` | Create | Branch model for curators and data loaders |
| `shared/resources/curator-branching.md` | Delete | Replaced |
| `skills/curate-genome-assembly/resources/curator-branching.md` | Delete | Synced copy |
| `package.json` | Modify | `sharedFiles` entry swap |
| `skills/*/SKILL.md`, `skills/*/resources/step-*.md` | Modify | Repo names and XML paths |
| `README.md`, `CLAUDE.md`, `docs/development.md`, `CLAUDE-skills-strategy.md` | Modify | Remove archived repo mentions |

---

### Task 1: check-repos.sh references VEuPathDatasets

**Files:**
- Modify: `shared/scripts/check-repos.sh:3-6, 26`

- [ ] **Step 1: Confirm the three synced copies are identical before editing**

Run:
```bash
cd /home/jbrestel/workspaces/misc/dataset-curator
md5sum shared/scripts/check-repos.sh skills/*/scripts/check-repos.sh
```
Expected: three identical hashes.

- [ ] **Step 2: Update examples in the canonical copy**

Run:
```bash
sed -i \
  -e 's|^# Example: check-repos.sh ApiCommonDatasets ApiCommonPresenters EbrcModelCommon|# Example: check-repos.sh VEuPathDatasets|' \
  -e 's|echo "Example: \$0 ApiCommonDatasets ApiCommonPresenters EbrcModelCommon"|echo "Example: $0 VEuPathDatasets"|' \
  shared/scripts/check-repos.sh
grep -n 'ApiCommon\|EbrcModel' shared/scripts/check-repos.sh
```
Expected: no output from grep.

- [ ] **Step 3: Sync and verify**

Run:
```bash
yarn sync-shared
md5sum shared/scripts/check-repos.sh skills/*/scripts/check-repos.sh
bash shared/scripts/check-repos.sh 2>&1 | head -3
```
Expected: three identical hashes; the script prints the usage error with `Example: ... VEuPathDatasets`.

- [ ] **Step 4: Commit**

```bash
git add shared/scripts/check-repos.sh skills/*/scripts/check-repos.sh
git commit -m "check-repos: example names VEuPathDatasets

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Replace curator-branching.md with proposal-workflow.md

**Files:**
- Create: `shared/resources/proposal-workflow.md`
- Delete: `shared/resources/curator-branching.md`, `skills/curate-genome-assembly/resources/curator-branching.md`
- Modify: `package.json:34-36`

- [ ] **Step 1: Write the new resource**

Create `shared/resources/proposal-workflow.md`:

````markdown
# Proposal Workflow

How dataset proposals move from a curator's machine into VEuPathDB builds.

## One repository

All configuration lives in **VEuPathDatasets**:

| Content | Path |
|---|---|
| Dataset proposals (pending) | `Proposals/<accession>/` |
| Presenters | `Model/lib/xml/datasetPresenters/<Project>.xml` |
| Contacts | `Model/lib/xml/datasetPresenters/contacts/allContacts.xml` |
| Dataset classes | `Model/lib/xml/datasetClass/classes.xml` |
| Dataset definitions | `Datasets/lib/xml/datasets/<Project>/<organismAbbrev>/` |

The skills expect it at `veupathdb-repos/VEuPathDatasets` relative to your
curation workspace directory. Either symlink your existing clone:

```bash
ln -s ~/Documents/GitHub veupathdb-repos
```

or clone fresh:

```bash
mkdir veupathdb-repos
git clone git@github.com:VEuPathDB/VEuPathDatasets.git veupathdb-repos/VEuPathDatasets
```

`veupathdb-repos/` is gitignored in dataset-curator.

## Branch model

```
master        proposals and contacts land here continuously, via PR
  |
  +-- rebuild02   cut from master when a build starts. Presenters are added and
  |               consumed proposals deleted here. Merged back to master when
  |               loading finishes.
  +-- rebuild03   next cycle
```

### Phase 1: proposing (curators)

1. A `propose-*` skill works on branch `proposal/<accession>` off `master`.
2. It fetches metadata, curates contacts into `allContacts.xml`, and writes
   `Proposals/<accession>/` containing `manifest.json`, `inputs/` and `curated/`.
3. It commits, pushes, opens a PR against `master`, and creates a ticket that
   links to the PR. The manifest records the ticket.
4. **You merge the PR.** That is the one manual git step, and it is deliberate.

Proposals do not carry rendered XML. They carry the data the renderer needs,
so template changes never make a proposal stale.

### Phase 2: loading (data loading team)

1. At build start, `rebuild<NN>` is cut from `master`. It already contains every
   proposal merged so far.
2. The `load-proposals` skill, run on `rebuild<NN>`, picks proposals whose
   `targetBuild` is `<NN>`. For each it creates `load/<accession>`, renders the
   presenter into the project file, deletes `Proposals/<accession>/`, commits,
   pushes, opens a PR against `rebuild<NN>`, and marks the ticket `loading`.
3. Rendering and deletion are one commit. Master never sees one without the
   other because `rebuild<NN>` is the only path back to master.

### Stragglers

A proposal for build NN that reaches master after `rebuild<NN>` was cut is not
on the rebuild branch. `load-proposals` detects this and prints the commit to
cherry-pick. A human performs the cherry-pick because rebuild branches are
protected:

```bash
git -C veupathdb-repos/VEuPathDatasets cherry-pick <commit>
```

### Two things to know

- While a build is in progress, `Proposals/` on master overstates the queue.
  Ticket status is the truth for in-progress work.
- Editing a proposal on master after Phase 2 consumed it causes a modify/delete
  conflict at merge-back. The `propose-*` skills refuse to update a proposal
  whose ticket is `loading` or `done`.

## Rules for Claude Code

- Never `cd` into `veupathdb-repos/`. Use `git -C veupathdb-repos/VEuPathDatasets ...`.
- Never push to `master` or a `rebuild*` branch. Skills push only to
  `proposal/*` and `load/*` branches and open PRs.
- Stop and report on any git error. Do not retry with `--force`.
````

- [ ] **Step 2: Swap the package.json sharedFiles entry**

Edit `package.json`, replacing:
```json
    "resources/curator-branching.md": [
      "curate-genome-assembly"
    ],
```
with:
```json
    "resources/proposal-workflow.md": [
      "curate-genome-assembly",
      "curate-bulk-rnaseq"
    ],
```

- [ ] **Step 3: Delete the old files and sync**

Run:
```bash
git rm -q shared/resources/curator-branching.md skills/curate-genome-assembly/resources/curator-branching.md
yarn sync-shared
ls skills/curate-genome-assembly/resources/proposal-workflow.md skills/curate-bulk-rnaseq/resources/proposal-workflow.md
```
Expected: both synced files listed; sync reports no errors.

- [ ] **Step 4: Repoint links in skills**

Run:
```bash
sed -i 's|resources/curator-branching.md|resources/proposal-workflow.md|; s|curator branching guidelines|proposal workflow|' skills/curate-genome-assembly/SKILL.md
grep -rn 'curator-branching' skills/ shared/ package.json
```
Expected: no output from grep.

- [ ] **Step 5: Commit**

```bash
git add -A shared/resources skills/*/resources package.json skills/curate-genome-assembly/SKILL.md
git commit -m "Replace curator-branching.md with proposal-workflow.md

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Skill prerequisites and XML paths

**Files:**
- Modify: `skills/curate-genome-assembly/SKILL.md:12-14, 21, 30-31, 42, 103, 118`
- Modify: `skills/curate-bulk-rnaseq/SKILL.md:12-14, 21, 30-31, 115, 137`
- Modify: `skills/*/resources/step-*.md` (paths only)

- [ ] **Step 1: Substitute XML paths everywhere under skills/**

Run:
```bash
grep -rl 'veupathdb-repos/ApiCommonPresenters\|veupathdb-repos/EbrcModelCommon' skills/ | xargs sed -i \
  -e 's|veupathdb-repos/ApiCommonPresenters/|veupathdb-repos/VEuPathDatasets/|g' \
  -e 's|veupathdb-repos/EbrcModelCommon/|veupathdb-repos/VEuPathDatasets/|g'
grep -rn 'ApiCommonPresenters\|EbrcModelCommon\|ApiCommonDatasets' skills/
```
Expected: remaining hits are only the prerequisite list lines and the
`check-repos.sh` arguments in the two SKILL.md files, plus a comment in
`skills/curate-genome-assembly/scripts/generate-presenter-xml.js:8`.

- [ ] **Step 2: Rewrite the prerequisite block in both SKILL.md files**

In each of `skills/curate-genome-assembly/SKILL.md` and
`skills/curate-bulk-rnaseq/SKILL.md`, replace:
```markdown
This workflow requires the following repositories in `veupathdb-repos/`:
- ApiCommonPresenters
- EbrcModelCommon
```
with:
```markdown
This workflow requires the **VEuPathDatasets** repository in `veupathdb-repos/`.
```
and replace:
```bash
bash scripts/check-repos.sh ApiCommonPresenters EbrcModelCommon
```
with:
```bash
bash scripts/check-repos.sh VEuPathDatasets
```

- [ ] **Step 3: Fix the generator comment**

Run:
```bash
sed -i 's| \* for ApiCommonPresenters\.| * for VEuPathDatasets.|' skills/curate-genome-assembly/scripts/generate-presenter-xml.js
grep -rn 'ApiCommonPresenters\|EbrcModelCommon\|ApiCommonDatasets' skills/
```
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add skills/
git commit -m "Skills reference VEuPathDatasets paths

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Repository documentation

**Files:**
- Modify: `README.md:61, 77, 94-100, 134, 206`
- Modify: `CLAUDE.md:36-42, 53-60`
- Modify: `docs/development.md:189-192, 233-239, 273-285`
- Modify: `CLAUDE-skills-strategy.md:182, 420, 429-432`

- [ ] **Step 1: README**

Replace line 61's paragraph with:
```markdown
**Note on the VEuPathDatasets Repository**: Skills need a checkout of `VEuPathDatasets`, which holds dataset definitions, presenters and contacts. If you already have it cloned via GitHub Desktop, you'll create a symlink to it from your curation workspace directory. If not, the skill will guide you through setting it up when you first run it.
```

Replace the paragraph at line 94 with:
```markdown
**Important**: Read the [proposal workflow](shared/resources/proposal-workflow.md) before starting. Skills work on `proposal/<accession>` branches and open pull requests for you to merge.
```

Replace the "What Happens During Curation" bullets (lines 96-100) with:
```markdown
- **Claude Code handles**: Fetching NCBI data, processing metadata, curating contacts, writing the proposal, committing to a `proposal/<accession>` branch, opening the pull request and creating the ticket
- **You handle**: Reviewing and merging the pull request

Nothing reaches `master` without your merge.
```

Replace line 134 with:
```markdown
- **curate-genome-assembly**: Process genome assembly datasets - fetch NCBI metadata, curate contacts, generate presenter XML in VEuPathDatasets
```

Line 206 stays; append `VEuPathDatasets` to its comment:
```
└── veupathdb-repos/            # Local checkout of VEuPathDatasets (gitignored)
```

- [ ] **Step 2: CLAUDE.md**

Replace lines 36-39 with:
```
├── veupathdb-repos/                        # Local checkout (gitignored)
│   └── VEuPathDatasets/                    # Dataset definitions, presenters, contacts, classes
```
Replace line 42 with:
```
│   └── proposal-workflow.md                # Branch model for proposals and builds
```
Replace the "Important: Git Workflow" section (lines 51-62) with:
```markdown
## Important: Git Workflow

**Skills perform git operations on their own branches only:**
- `proposal/<accession>` off master (Phase 1) and `load/<accession>` off `rebuild<NN>` (Phase 2)
- Commit, push and open a pull request
- Never push to `master` or `rebuild*`

**Humans merge pull requests.** See `shared/resources/proposal-workflow.md`.
```

- [ ] **Step 3: docs/development.md**

Replace line 191 with:
```markdown
[Proposal Workflow](proposal-workflow.md)  # Within resources/
```
Replace lines 233-239 with:
```markdown
Skills verify the VEuPathDatasets checkout:

```bash
bash scripts/check-repos.sh VEuPathDatasets
```

Add check-repos.sh to your skill via sharedFiles config.
```
Replace lines 273-285 ("Curator vs Developer Responsibilities") with:
```markdown
### Who Does What

**Skills** (via shared scripts) branch, commit, push and open pull requests
on `proposal/*` and `load/*` branches in `veupathdb-repos/VEuPathDatasets`.

**Humans** review and merge pull requests. Skills never push to `master` or
`rebuild*` branches.
```

- [ ] **Step 4: CLAUDE-skills-strategy.md**

Run:
```bash
sed -i \
  -e 's|update dataset configurations in ApiCommonDatasets|update dataset configurations in VEuPathDatasets|' \
  -e 's|update ApiCommonDatasets configurations|update VEuPathDatasets configurations|' \
  CLAUDE-skills-strategy.md
```
Then replace lines 429-432:
```markdown
This workflow requires the following repositories in `veupathdb-repos/`:
- ApiCommonDatasets
- ApiCommonPresenters
- EbrcModelCommon
```
with:
```markdown
This workflow requires the `VEuPathDatasets` repository in `veupathdb-repos/`.
```

- [ ] **Step 5: Verify nothing is left**

Run:
```bash
grep -rn 'ApiCommonPresenters\|EbrcModelCommon\|ApiCommonDatasets\|curator-branching' --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=docs/superpowers . | grep -v '^./docs/superpowers/'
```
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add README.md CLAUDE.md docs/development.md CLAUDE-skills-strategy.md
git commit -m "Docs: VEuPathDatasets replaces the three archived repositories

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Done when

- `grep -rn 'ApiCommon\|EbrcModel'` over the repo (excluding `docs/superpowers/`) returns nothing.
- `yarn sync-shared` reports zero errors.
- Both skills' SKILL.md name only VEuPathDatasets as a prerequisite.
