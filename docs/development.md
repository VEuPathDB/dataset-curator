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
| `dataset-types/organism-rules.js` | Every dataset type's organism rule; what the manifest schema checks types against |
| `lib/artifacts.js` | Delivery location from the class, writing artifacts, and the preview note `render-proposal.js --artifacts` prints for the Phase 1 curator preview |
| `lib/delivery-ops.js` | `prepareDelivery`: settles organisms and writes the manual delivery tree and its `delivery.json` record |
| `lib/delivery.js` | Delivery record, release month and the paths and hand-off text of a delivery |
| `lib/corpus.js` | Places STF files in a type's corpus, per dataset or per organism |
| `lib/remote.js` | Read-only `ssh` and `rsync` against the staging and manual-delivery hosts |
| `lib/stf.js` | Sample annotations to STF entity files (also behind the `sample-annotations-to-stf` skill) |
| `dataset-types/_sra-samples.js` | Sample handling shared by `bulk-rnaseq` and the SRA experiment types: normalizing annotations, the `sample,fastq_1,fastq_2` samplesheet (plus type-specific columns), `checkSamplesAgree` across samplesheet, STF and annotations, `checkSampleRuns` (each sample's runs against the samplesheet), and the BioProject link and run-derived methodology |
| `dataset-types/_sra-experiment.js` | Factory for single-organism SRA types (`dnaseq`, `chipseq`): normalize, loading artifacts, agreement check, corpus |
| `dataset-types/dnaseq.js` | The `dnaseq` type: `dnaseqExperiment` dataset with `$$ploidy$$`, IsolatesHTS presenter with `hasCNVData` |
| `dataset-types/chipseq.js` | The `chipseq` type: `chipSeqExperiment` with a 4-column samplesheet (`input`), pairing checks, `hasCalledPeaks` from `experimentType` |
| `lib/library-checks.js` | `libraryProblems(runs, { used, strategies })`: project and per-run hard stops and warnings that ENA runs are DNA sequencing with reads and the type's expected `strategies`; `used` limits the per-run checks to the runs a proposal keeps |
| `lib/released-organisms.js` | Released-site Genome Info and Stats query and the taxon or curator-pick match, with chromosome count |
| `lib/organism-constants.js` | Checks and inserts the organism-file constants a type needs at load (DNA-seq `ploidy`) |
| `render-proposal.js` | CLI over the dataset-type modules |
| `prepare-delivery.js` | Preprocessing: writes `<root>/<type>-validation/delivery/<PROPOSAL>/` (`final/`, `fromProvider/`, per-organism `workspace/`) and the STF corpus files; `mark-ready.js --workspace <root>` reads its record |
| lifecycle CLIs | `start-`, `write-`, `publish-proposal.js` (Phase 1); `list-proposals.js`, `load-proposal.js` (Phase 2) |

#### Dataset-type contract

`derive*` functions run in Phase 1, from `write-proposal.js`, and turn the
proposal's inputs plus curator overrides into curated records. `render*`
functions run in both phases and read only the manifest and those records;
`renderPresenter` and `renderDatasets` never open `inputs/`.

| Export | Phase | Purpose |
|---|---|---|
| (organism rule) | both | not an export: each type's entry in `dataset-types/organism-rules.js`. `{ new: true, max }` for a type that introduces organisms (at most `max`), or `{ new: false }` for one that uses organisms already loaded or proposed; `pending: 'refuse'` refuses an organism only a pending genome proposal introduces. Drives the manifest's `organisms` array and the Phase 1 cross-check |
| `requiredOrganismConstants` | 2 | optional; `{ name: RegExp }` of organism-file constants the dataset entry references. Load checks each and inserts a missing one only from a person-confirmed value (`load-proposal.js --ploidy <abbrev>=<N>`) |
| `libraryStrategies` | 1 | optional; the ENA `library_strategy` values the type accepts; `check-library.js --type <type>` uses them (default WGS) |
| `deriveOrganism(inputs, accession, overrides, warn)` | 1 | a `new` type only: species, strain and NCBI taxon id for the proposed organism, from the inputs and `overrides.organism`; calls `warn` for a fallback the curator should see |
| `deriveAnnotation(inputs, accession, chosen, warn)` | 1 | optional; genome only: manifest `annotation`, the curator's choice checked against the report, else the report's answer |
| `injectorDefaults`, `requiredFields`, `requiredInjectorProps` | both | site defaults applied at render; presenter fields, and injector props, that must not be empty (beyond `displayName`, `summary`, `description`) |
| `derivePresenter(dir, overrides.presenter)` | 1 | the `curated/presenter.json` record. For a multi-organism RNA-seq proposal it may carry `organisms.<abbrev>.injectorProps`: per-organism props (derived where they differ, such as `hasMultipleSamples` and `isDESeq`), with curator overrides merged per organism and prop on top of the shared `injectorProps` |
| `ticketLabelVariant(dir)` | 1 | optional; the key into a map-valued `typeLabels` entry for this proposal's ticket label, applied only when the ticket is created. Genome assembly: `annotated` or `unannotated`, from `annotationOf(dir)` |
| `presenterNames(dir)` | both | an array holding the proposal's one presenter name, derived from the manifest and, for single-entry types, the entry's `name` |
| `namePatternFor(name)` | both | optional; RNA-seq only. The `datasetNamePattern` of a multi-organism presenter, matching the experiment name in any organism. Used by the dataset-name uniqueness check |
| `renderPresenter(dir, { build })` | both | the proposal's one presenter XML. A single-organism proposal names it and sets `projectName`; a multi-organism one shares it through `datasetNamePattern`, with one injector per organism naming that organism's project and dataset |
| `datasetClasses` | both | the `classes.xml` classes the proposal's dataset entries may hold |
| `singleEntry` | both | optional; `true` for a type whose proposal holds exactly one entry, which `write-proposal.js` derives |
| `deriveIdentity(dir, { primaryContactName })` | 1 | single-entry types: default `name` and `version` of the one entry. A multi-organism name must be unique across all organisms |
| `deriveDataset(dir, classDef, overrides.dataset)` | 1 | single-entry types: the one entry's `{ props, source }` (returned as a schemaVersion 1 record), checked against the class |
| `entryProblems(dir, manifest, entry, classDef)` | both | optional; the type's own render-time rules for one entry, as a list of problems. `renderDatasets` checks every entry's props against the class, runs this when they pass, and renders the `<dataset>` element itself |
| `normalizeCurated(dir, datasetOverrides)` | 1 | types with loading artifacts: rewrites the staged sample annotations in normalized form (sample ids, labels) |
| `deriveArtifacts(dir)` | 1 | types with loading artifacts: `{ "<abbrev>/<file>": text }`, each organism's files derived from that organism's samples |
| `derivedCuratedFiles` | 1 | the base file names that `deriveArtifacts` rewrites on every write, under each `curated/<abbrev>/` |
| `checkCurated(dir)`, `assertCuratedAgree(dir)` | 1 and 2 | the agreement check: error strings, and the same as a thrown error (`assertCuratedAgreeWith(checkCurated)` from `_common.js`). Run at write, at publish and at load |
| `curatedWarnings(dir)` | 1 | optional; warnings about the curated records that `write-proposal.js` prints for the curator after the agreement check passes |
| `corpus` | 2 | optional; `{ root, layout }` for the type's STF corpus: `root` is under the manual-delivery root, `layout` is `per-dataset` or `per-organism` |
| `corpusFiles(dir, organism)` | 2 | optional; the STF files `prepare-delivery.js` places in the corpus for one organism |
| `stagingProblems(dir)` | 2 | optional; problems with what the data provider staged, checked by `prepare-delivery.js` |
| `renderArtifacts(dir, organism)` | both | `{ files }` for one organism's `final/` directory only (STF goes to the corpus, not `final/`), after the agreement check. `sampleAnnotations.json` is filtered to that organism's samples when it has only some of them |
| `validationWorkspace` | 2 | the type's directory under the validation root, such as `rnaseq-validation`. Validators are not exported here (a validator importing the type module would be a cycle): a type with validators lists them in `dataset-types/<type>/validators/index.js`, registered in `validators.js`. Each validator declares `kind`: `preprocess` (reads `ctx.workArea`, runs at verify only) or `content` (reads the proposal, also runs at load); it may add report fields through `ctx.extras`. |
| `preprocessedFiles(dir, location, { workArea, report, cache })` | 2 | optional; `{ files: [{ path, from }], problems, provenance }` for one entry location: files under `<type>-validation/proposals/<id>/preprocess/` that `prepare-delivery.js` copies into the location's `final/` (`path` relative to it). `problems` refuse the delivery; `provenance` is recorded in `delivery.json` by delivery directory. `report` is the current verification report (null for a type without validators). `cache` is one object per delivery, for what every location shares; a problem several locations report is named once. A symlinked work area is refused |
| `preprocessedAmendment({ workArea, proposalDir, manifest, given })` | 2 | optional; `{ entries, constants, organism, sources }` that `amend-proposal.js` writes into `curated/datasets.json` and `curated/organism.json` from the work area. Genome: `genome-assembly/amendment.js` |
| `newOrganismFiles({ proposalDir, manifest, organism, repoPath })` | 2 | optional; for a new organism at load: `{ organismFile, projectFile: { relFile, content, organism } }`, the organism file before its entries and the changed project file. Genome: `genome-assembly/organism-file.js` |

Genome code reads the annotation source through `annotationOf(dir)` in
`genome-assembly.js`, which falls back to `curated/organism.json`, then the
report, for proposals written before manifest `annotation`. Phase 2 render
reads manifest `annotation.source` only and defaults to `genbank`.
`writeProposal` keeps a provider annotation and `staging` on later re-writes
unless the overrides change them; `genbank` and `none` are re-derived from the
report each run.

A proposal's datasets are its entries in `curated/datasets.json`
(`{ "schemaVersion": 2, "datasets": [{ datasetClass, name, version, props, source }] }`),
the only source of dataset identity. Read them only through `datasetsOf(dir,
manifest)` in `_common.js`, which also reads a proposal written before 3.0
(manifest `datasetClass`, `name`, `version` plus `curated/dataset.json`) as one
entry. `name` and `version` are literals or one `$$constant$$`; props may
reference constants. `resolveEntry(entry, constants)` substitutes them, from
`curated/organism.json` `constants`, the organism's project and abbreviation,
and leaves the constants every organism file defines (and the type's
`requiredOrganismConstants`) as references. An entry's identity is its
resolved `datasetName` (the class's `datasetLoader datasetName` template,
`datasetNameOf`), not `(datasetClass, name)`: a genome's supercontig and contig
entries share a name and differ by `soTerm`. `assertValidEntries` checks the
entries against the type, `classes.xml` and the constants, refuses two entries
with one `datasetName` or one delivery directory (give one a distinct name,
such as a numeric suffix), and names each entry as written
(`<datasetClass> <name>`, plus `(<soTerm>)` when it has one); write, publish,
load, mark-ready, prepare-delivery and `render-proposal.js --dataset`/`--artifacts`
run it before changing anything. Clash checks against organism files and
sibling proposals compare `datasetName`s by their written values
(`sameDatasetName`). `memoClassOf(repoPath)` in `lib/dataset-classes.js` is the
class reader callers pass as `classOf`. `parseDatasetClass` returns
`delivery: { dir, file }` for the three `classes.xml` shapes: `manualGet
common/empty` with an `ln -s` unpack, a `manualGet` directory, or a `manualGet`
file.

Types are registered in `dataset-types/index.js`, which also holds
`loadDatasetType`. Only lifecycle code imports the registry; the manifest schema
reads `dataset-types/organism-rules.js` instead, so no type module can reach the
registry. `tests/import-graph.test.js` fails on any import cycle under
`shared/scripts`.

The per-type validation workspace's `env.json` may also carry `staging` and
`manualDelivery`, each `{ host, root }`. `prepare-delivery.js` requires both and
reads them over `ssh` and `rsync`, read-only. The STF release month is the UTC
`YYYY-MM` of the due date on the ticket's `Build NN` milestone, so set due dates
mid-month to be safe.

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
  `verifying` → `Preprocessing`, `revision` → `Needs revision`,
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
  `bulk-rnaseq` → `rnaseq`; `genome-assembly` → `genome & annotation` when
  annotated, else `genome sequence`). A value is a label name, or a map from
  the variant the type's `ticketLabelVariant` reports to a label name. `create`
  labels the issue with its dataset type, creating the label on first use, and
  refuses a dataset type (or variant) missing from the map before calling `gh`;
  `checkDatasetType` makes the same check offline, and publish runs it in
  its preflight, with the variant when it will file a new ticket, so updates
  are checked too. A new
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
3. Register the module in `dataset-types/index.js`, and add its organism rule to `dataset-types/organism-rules.js`.
4. Register the module in `package.json` `sharedFiles` for every skill.
5. Add the type to `ticket.github.typeLabels` in `shared/resources/curator.config.json`.
6. Create the `propose-<type>` skill.

### Genome pipeline (`shared/scripts/genome/`)

NCBI annotated genome in, ISF-ready partitions out
(spec: `docs/superpowers/specs/2026-11-04-gff-pipeline-design.md`). No skill
calls it yet, so nothing here is listed in `sharedFiles` or synced.

    node shared/scripts/genome/genome-pipeline.js fetch <GCA_/GCF_ accession> --workDir <dir>
    node shared/scripts/genome/genome-pipeline.js survey   --workDir <dir> --apiCommonData <checkout>
    node shared/scripts/genome/genome-pipeline.js build    --workDir <dir> --apiCommonData <checkout>
    node shared/scripts/genome/genome-pipeline.js finalize --workDir <dir> --apiCommonData <checkout> [--preprocessGFF3 <script>]
    node shared/scripts/genome/genome-pipeline.js functional --workDir <dir>
    node shared/scripts/genome/genome-pipeline.js trial    --workDir <dir> --image <name> --gusConfig <file> --taxonId <ncbi taxon id> [--keep]
    node shared/scripts/genome/genome-pipeline.js trial    --workDir <dir> --image <name> --gusConfig <file> --undo

`survey` writes `survey.json` with raw findings and a preview of its
`suggestedRecipe`; the curator copies that into `recipe.json`. The preview's
findings are taken before the suggested `stripAttributes`, so they still list
the attributes that recipe strips. `build` writes `ids.default.tsv`, `build/`
and `build/build.json`; `finalize` writes `final/<partition>/` and
`genome-build.json`. `ids.tsv` lines always name an input ID as NCBI wrote it
(the `old` column of `ids.default.tsv`) and apply in the ID pass, before the
transforms; IDs a transform creates follow from them.

Each command checks its predecessor's checksums and refuses stale input:
`finalize` refuses when `recipe.json`, `ids.tsv`, `partitions.tsv` or any
`build/` file changed since `build`. `build` and `finalize` stage into
`build.tmp/` and `final.tmp/` and swap only on success, so a refused or failed
run leaves the previous output. `genome-build.json` is written last and is
removed by every successful `build`: `final/` without it is not finalized.

**Record contract.** `build/build.json` and `genome-build.json` share one
shape, defined in `record.js`; readers (sub-project F) should never hard-code
a file name.

- Top level: `schemaVersion` (`SCHEMA_VERSION`; `finalize` refuses any other
  as "written by an older build"), `generator: { name, version }` (version from
  `package.json`), `source: 'ncbi'`, `accession`.
- `apiCommonData`: in `build.json`, `{ commit, dirty, isfMap: { path, sha256 } }`
  for the map `build` validated against. `finalize` refuses a checkout whose map
  hashes differently, and `genome-build.json` records finalize's own
  `{ commit, dirty, isfMap, preprocessGFF3: { sha256, override } }`.
- `partitions[]`: `{ role, soTerm, organelle, sequenceCount, dir, featureCount,
  gffLines, final, buildFiles }`. `featureCount` is the number of trees ISF
  loads; `gffLines` the GFF feature lines. `final` names the files `finalize`
  writes under `dir` (`gff` is null when `featureCount` is 0), and
  `buildFiles` holds the sha256s of the `build/` files.

#### `trial`: load `final/` into GUS and check it

`trial` loads each `final/<partition>/` into a GUS database inside the
`gus_isf` image, one `docker run` per GUS step: `InsertExternalDatabase`,
`InsertExternalDatabaseRls` and `LoadFastaSequences` for every partition, then
`InsertSequenceFeatures` twice where a partition has features. Run 1
(`PRINT_TRANSCRIPT_IDS`) never commits and its output is copied to
`final/<partition>/transcriptInfoAndIds`; run 2 (`SET_TRANSCRIPT_IDS`) commits.
QA SELECTs then compare what loaded with the build GFF3 and the file, and the
steps are profiled. Unless `--keep`, the rows are removed with GUS Undo.
`trial --undo` removes what an earlier `--keep` run (or a failed one) left. It
exits 1 when QA has an error finding, after Undo has run.

- **Image.** `--image` names a `gus_isf` image (docker-tools issue #4). Use
  `gus_isf:local`, built from docker-tools, until Jenkins publishes it. `trial`
  never pulls (`--pull never`) and refuses an image whose ISF map differs from
  the one `genome-build.json` was built against.
- **Model image.** GUS::Model is generated from the target schema, so `trial`
  builds `gus_isf-model:<database>-<fingerprint>` once per database and schema
  and reuses it. Its label also holds the `selectRows.pl` hash and the base
  image id, so a changed script or base image rebuilds it.
- **Database access.** `selectRows.pl` runs only SELECT or WITH statements in a
  read-only transaction, inside the image, through the `gus.config` that is
  bind-mounted read-only. The host never reads that file, so no credentials
  are needed there; Node only checks that it is a file.
- **`trial/trial.json`** is the hand-off, next to `genome-build.json`: image
  digest, database, release, per-step attempts (each with its
  `AlgInvocationId`, container name and log under `trial/logs/`), `outputs`
  (the sha256 of each partition's `transcriptInfoAndIds`, recorded when its
  copy succeeds), QA findings, profile, `kept`/`undone` and a derived `result`:
  `passed` when every step is done, QA ran and no finding is an error,
  `failed` on an error finding or a failed step, otherwise `incomplete`.
  `TRIAL_SCHEMA_VERSION` in `trial/record.js` (now 2) is its contract; a
  version 1 file is refused as written by an older trial.
  It is append-only per attempt; the last attempt of a key decides whether the
  step is done. A rerun after a successful Undo starts a new trial.
- **Resume.** A rerun resumes at the first step not done. It refuses when D's
  output or `--taxonId` changed, when `current_database()` differs from the
  trial's, or when the image id differs. The profile is whole-database
  statistics around each ISF run, not per plugin, and never aborts a trial.

Recovery, all by hand and none automatic:

- **Committed failure.** A step that ran with `--commit` and failed after its
  invocation existed, was cut off while `running`, or exited 0 without a
  parsable `AlgInvocationId`, may have left rows. `trial` refuses to resume and
  names `trial --undo`. `--undo` recovers IDs from `trial/logs/<key>.log` for
  attempts that never saved a result. When no ID could be parsed it cannot
  target the rows: it reports `trialRelease` rows left, and they have to be
  removed by hand, found by the release in `trial.json`.
- **Stale lock.** `trial` and `trial --undo` hold `trial/.lock` (pid and start
  time, `O_EXCL`) and remove it when they end. A run killed by SIGKILL leaves
  it behind. The refusal names the pid and start time and says when that
  process is gone; delete the file then. It is never deleted automatically.
- **Interrupts and containers.** Every `ga` runs as `docker run --init --name
  curator-trial-<pid>-<step>`, and the name is recorded on the attempt. Ctrl-C
  reaches the docker client in the terminal's process group; `trial` then
  removes the step's container, leaves its attempt `running`, releases the lock
  and exits 130. SIGTERM sent to the Node process alone is not handled (the
  blocking docker call would defer a handler until the step ended), and SIGKILL
  cannot be. Both leave the lock and possibly a running container. A resume or
  `--undo` first runs `docker ps --filter name=curator-trial-` and refuses,
  naming the container, while one of this trial's containers is running:
  wait for it or `docker rm -f` it.
- **Invocation rows.** A hard-killed run's `core.algorithminvocation` row keeps
  `row_alg_invocation_id` 1, so Undo cannot remove it. That table is checked
  apart from the blocking leftover check; such rows are a warning finding that
  gives the manual delete (`core.algorithmparam`, then
  `core.algorithminvocation`, where `algorithm_invocation_id` is the ID).
- **Leftover databases.** Preflight refuses when an
  `sres.externaldatabase` named `curatorTrial_<accession>_*` exists, because
  InsertExternalDatabase would reuse it and its Undo would delete nothing.
- **Sequences already loaded.** `dots.nasequenceimp.source_id` is unique across
  the database, so preflight looks up every final FASTA header ID and refuses,
  naming the external database that holds them, before anything is committed.
  A bridge database that already has this genome cannot take a trial of it.
- **Profiling source.** `pg_stat_statements` is queried by the schema its
  extension lives in, since a GUS login's `search_path` need not include it.
  When it fails, the profile falls back to `pg_stat_user_tables` and records
  why in `fallback` and in the `isfProfile` finding.

#### `functional`: the functional annotation files

`functional` (spec: `docs/superpowers/specs/2026-11-05-functional-extraction-design.md`)
reads each annotated partition's `build/<partition>/genome.gff3` after
`finalize` and writes the files of the functional dataset classes under
`final/function/<datasetClass>/<name>/`, then `functional.json`. It needs no
network, database or Docker and does not depend on `trial`. ISF ignores every
functional attribute, so this is how `product`, `Note`, `Dbxref`, `gene`,
`gene_synonym`, `protein_id`, `go_*` and `EC_number` reach the database.

- **Extraction table.** `functional/classes.js` lists each dataset: the
  attributes, the features they are read from, the ID level (gene, transcript,
  or protein `<transcript>-p1`, GusSkeletonMaker's rule) and the file.
  `<source>` is `GenBank` for `GCA_` and `RefSeq` for `GCF_`.
- **Dbxref datasets.** `functional/dbxref-urls.js` holds overrides for
  prefixes that already have a VEuPathDB `dbxref_simple` dataset
  (`UniProtKB/Swiss-Prot` and `UniProtKB/TrEMBL` → `uniprot_from_annotation`,
  `GOA`, `InterPro`, `PDB`, `PMID`), so loads reuse its name, view
  (`Transcript`, with transcript IDs) and URL; several prefixes may share one.
  Every other prefix gets `<prefix lower-cased, other characters as
  _>_from_annotation` at gene level (`GeneFeature`), with a URL template when
  the file has one, else `url` null and an `unknownDbxrefPrefix` warning. A
  sanitized name that collides with another prefix's or an override's is a
  `dbxrefNameClash` error. Add an override when a new prefix has an
  established dataset, a template otherwise.
- **Files.** Tab-separated, no header, LF, unique per (ID, value) and sorted by
  code unit, so a rerun writes the same bytes. `products.txt` carries an
  explicit `is_preferred`: the transcript's first product in GFF order. The GAF
  date is `genome-build.json` `finalizedAt` and the taxon is the assembly
  report's `# Taxid:`. A dataset with no rows gets no file and is named in the
  `emptyClass` info finding.
- **`functional.json`** (`FUNCTIONAL_SCHEMA_VERSION`, now 1, in
  `functional/record.js`) is the hand-off to F: `generator`,
  `genomeBuild.sha256`, `source`, `taxonId` (string or null), `gafDate` (GAF
  column 14), `findings`, and per dataset `{ datasetClass,
  name, file, rows, sha256, ids: { level, count }, props }`. Files are staged
  in `final/function.tmp` and swapped in; the old record is removed first and
  the new one written last. `finalize` replaces `final/` and with it
  `final/function/`, so run `functional` again after it.
  `checkFunctionalCurrent(record, workDir, genomeBuildSha256)` lists the
  problems that make a record stale: a `genomeBuild.sha256` that differs from
  `genome-build.json`, a missing dataset file, or a file whose sha256 differs.
- **Exit status.** An error finding (`unresolvedFeature`, `noProducts`,
  `dbxrefNameClash`) exits 1 after the files and the record are written, so
  they can be inspected.

| Module | Purpose |
|---|---|
| `genome-pipeline.js` | CLI: argument parsing and printing for the six commands |
| `commands/` | `fetch`, `survey`, `build`, `finalize`, `trial`, `functional` |
| `commands/trial.js` | Preflight, the lock, `runTrial`, QA, Undo and `runTrialUndo` |
| `commands/functional.js` | `runFunctional`: build GFF3s in, `final/function/` and `functional.json` out |
| `genome-build.js` | `readGenomeBuild` and `partitionName`, shared by `trial` and `functional` |
| `functional/ids.js` | Gene, transcript and protein IDs through `Parent` |
| `functional/classes.js` | The extraction table and the extraction |
| `functional/values.js` | Attribute values, `go_*`, `EC_number`, `Dbxref` and prefix names |
| `functional/dbxref-urls.js` | Dbxref overrides (established datasets) and URL templates; `dbxrefDataset` |
| `functional/record.js` | `functional.json` contract |
| `trial/gus.js` | The one Docker seam: `docker run` arguments, `ga` runs into a log, `selectRows`, image inspect |
| `trial/selectRows.pl` | Read-only SELECT runner inside the image |
| `trial/steps.js` | Step list from `genome-build.json` and the Undo plan |
| `trial/record.js` | `trial.json` contract, resume checks, invocation ID recovery |
| `trial/model-image.js` | Schema fingerprint and the per-database GUS::Model image |
| `trial/qa.js` | QA SELECTs, findings and profiling |
| `commands/inputs.js` | Loading fetched inputs, the ISF map, `ids.tsv` and `partitions.tsv` as `PipelineError`s |
| `plan-build.js` | `planBuild`: the in-memory build phases `survey` previews and `build` writes |
| `record.js` | Record contract: schema version, generator, file names |
| `workdir.js` | Work-area paths, `PipelineError`, atomic writes and directory swaps |
| `gff.js` | GFF3 ⇄ graph; all line-level GFF code |
| `feature-types.js` | Gene, transcript and protein levels |
| `fasta.js` | Streaming FASTA index and subset |
| `assembly-report.js`, `partitions.js` | Report ranks and the partition plan |
| `isf-map.js` | ISF map reader and the port of `genemRNAExonCDS2BioperlTree` |
| `ids.js` | ID policies and `ids.tsv` |
| `transforms/` | One pure transform per file and the registry (`kind`, `handFixCodes`) |
| `transforms/claim-ids.js` | Claims IDs a transform creates, throwing `ID_COLLISION` on a taken one |
| `checks.js` | Checks shared by `survey` and `build` |
| `preprocess-gff3.js` | `perl -c` precheck and running `preprocessGFF3` |

`preprocessGFF3` needs only core Perl once its unused `use Bio::SeqIO;` is
removed in ApiCommonData; until then pass a copy without it as
`--preprocessGFF3`. The golden test (`tests/genome-golden.test.js`) needs
`APICOMMONDATA_DIR` and `perl`, and skips without them. It pins the final GFF
as line count, per-type counts and a sha256 rather than the file; regenerate
with `UPDATE_GOLDEN=1` and review the diff of a local run. Set
`GOLDEN_WORKDIR=<dir>` to keep the E. cuniculi work area there instead of a
temporary directory; it is the input for manual `trial` and `functional` runs.
The golden test also runs `functional` and pins each dataset as rows, ID count
and sha256. Those pins (`ECUN_FUNCTIONAL_SHA256` and the rows table) are edited
by hand from a `GOLDEN_WORKDIR` run; `UPDATE_GOLDEN=1` does not touch them.

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
