# Functional annotation update (`functional-update`)

## Problem

Curators periodically send a tab file of new functional annotation for an
organism already on the site: product names, GO terms, EC numbers, gene
names, comments or aliases. Today this is done by hand: the file is converted,
placed in manual delivery, the organism file's entry gets a new `version`, and
a `<history>` row is added to the genome presenter.

None of it fits the existing lifecycle:

- there is no archive accession to name the proposal by;
- the proposal has no presenter of its own; it amends the genome presenter's
  history;
- load only inserts new presenters and dataset entries; nothing edits an
  element already committed;
- the curator's file is not in the loader's format and its IDs may be at the
  wrong level (gene vs transcript vs protein).

Initial genome loads already produce these classes from the GFF (sub-project
E, `genome/functional/`); this type reuses E's file writers and the
genome-assembly entry conventions.

## Decisions

- **One class per proposal.** `singleEntry: true`. Classes in v1:
  `productNames`, `GeneOntologyAssociations`, `EnzymeCommissionAssociations`,
  `geneName`, `comments`, `aliases`. No `dbxref_simple` / `dbxref_synonym`.
- **Bump by default.** The update sets a new `version` on the organism's
  existing entry of that class and `name`. A curator-given `name` that does
  not exist is a new entry, and must be confirmed as such.
- **Bumps write a literal version on that one entry** and never change the
  `functAnnotVersion` constant (changing it would reload every functional
  dataset that references it). An entry still referencing
  `$$functAnnotVersion$$` becomes a literal.
- **Proposal id** `<orgAbbrev>_<datasetClass>_<YYYYMMDD>` (the proposing
  date). It is the manifest `accession`, the directory and the branch.
- **Version is the curator's curation date** (`YYYY-MM-DD`), independent of
  the id's date.
- **`functionalAnnotationSource` has no default**; the curator always gives it.
- **Organism must be released**, with no genome proposal for it in a pending
  build. Organism rule `{ new: false, max: 1, pending: 'refuse' }`.
- **Phase 1 learns only the class** (inferred from the file and confirmed, or
  asked). Column mapping and ID-level work happen at verify.
- **IDs come from the released site's GFF**, fetched at verify. Stale IDs
  surface as conversion findings.
- **Load edits are declarative.** A type returns edit operations as data;
  `load-ops` applies them through pure, idempotent appliers. This is the
  seam for every future update-style type.
- **History rows are keyed on build.** At most one row per (presenter,
  `buildNumber`); a second update in the same build only moves
  `functionalAnnotationVersion` forward.
- **Missing carried history values are asked, not omitted.** When the
  presenter's latest `<history>` lacks genome or annotation attributes, load
  refuses until the data loader gives them with `--history key=value`.

## Flow

```
Curator ──► propose-functional-update
              start-proposal → write-proposal → stage-file → publish-proposal (Draft ticket)
Human merges proposal PR (merge-proposal.js) ──► Proposed
Data loader ──► verify-functional-update
              start-verification → fetch GFF → map columns → convert
              → validate-proposal → prepare-delivery → mark-ready | request-revision
Data loader ──► load-proposals
              load-proposal: content validators, loadEdits applied, (new mode) dataset inserted
```

## 1. Phase 1: `propose-functional-update`

### Curator inputs

| Input | Required | Notes |
|---|---|---|
| file | yes | tab-separated; any column layout |
| class | yes | inferred from the file (header words, `GO:\d{7}`, EC patterns) and confirmed, or asked |
| organism | yes | name or abbreviation; matched with `lib/released-organisms.js` |
| `functionalAnnotationSource` | yes | no default |
| curation date | yes | `YYYY-MM-DD`; becomes the entry `version` and the history `functionalAnnotationVersion` |
| entry `name` | no | default: the one existing entry of the class (see below) |

### Proposal directory `Proposals/<orgAbbrev>_<datasetClass>_<YYYYMMDD>/`

| File | Contents |
|---|---|
| `manifest.json` | `datasetType: "functional-update"`, one organism `{ source: "loaded" }`, `staging: ["<file>"]` |
| `inputs/<file>` | the curator file, when at most 1 MiB |
| `inputs/<file>.sha256` | instead, when larger: `{ sha256, bytes, lines }` |
| `curated/datasets.json` | schemaVersion 2, one entry `{ datasetClass, name, version, props: {}, source: { type: "staging" }, mode }`, `mode` `bump` or `new` |
| `curated/history.json` | `{ schemaVersion: 1, functionalAnnotationSource, functionalAnnotationVersion, text }`; `text` defaults to `functional annotation updated` |

No `curated/presenter.json`.

### Entry name and mode

`write-proposal.js` (via the type's `deriveIdentity` / `deriveDataset`) reads
the organism file on `origin/master`
(`Datasets/lib/xml/datasets/<Project>/<orgAbbrev>.xml`) and lists its entries
of the class:

- no `name` given and exactly one entry → `bump` that entry;
- no `name` given and zero or several entries → refused, listing the names;
- `name` given and it exists → `bump`;
- `name` given and it does not exist → refused unless the curator confirms
  `--new-entry` → `new`.

`bump` also requires the new version to be later than the entry's current
version. When the entry's version is `$$functAnnotVersion$$`, the
comparison uses that constant's value in the organism file.

### Checks at write (`checkCurated`, `curatedWarnings`)

- organism released; no open genome proposal for it whose ticket is in a
  build not yet loaded (`pending: 'refuse'`);
- the mode check above;
- the file is tab-separated with a consistent column count (warning on
  ragged rows, error when no row has at least two columns);
- `curated/history.json` has every field.

### Staging and ticket

- New `stage-file.js <proposalId> <file>`: rsyncs the file to
  `<staging.root>/<proposalId>/` on the staging host
  (`yew:/veupathdb/dataStaging/`). Refuses when the target already holds a
  file of that name with a different sha256. Implemented as one function,
  `stageFile`, in a new `lib/staging-upload.js`; `lib/remote.js` stays
  read-only.
- `publish-proposal.js` unchanged: draft ticket, Status `Initial draft`.
  `typeLabels` gains `"functional-update": "functional annotation"`.

## 2. Verification: `verify-functional-update`

Uses B's shared verify core. Validation workspace
`functional-update-validation`; work area
`functional-update-validation/proposals/<id>/preprocess/`.

### Steps

1. **Claim** with `start-verification.js`.
2. **Fetch GFF** (`functional-update.js fetch --workDir <preprocess>`):
   the organism's `Current_Release/<nameForFiles>/gff/data/` directory on its
   project site; refuses unless exactly one `*.gff` is listed. Writes
   `gff.json` `{ url, sha256, release, fetchedAt }`. Also pulls the staged
   curator file from staging into `preprocess/input/` and checks its sha256
   against `inputs/`.
3. **Map columns.** The skill infers, then shows the data loader with sample
   rows and gets confirmation of: the ID column and its level (by matching
   values against the GFF's gene, transcript and protein IDs, protein IDs by
   GusSkeletonMaker's `<transcript>-p1` rule), the value columns the class
   needs, and whether row one is a header. Written to
   `preprocess/columns.json`.
4. **Convert** (`functional-update.js convert --workDir <preprocess>`): the
   class's converter maps each row's ID to the class's level and writes the
   loader file through the shared writers to `preprocess/final/<file>`, then
   `preprocess/convert.json`.
5. **Validate** with `validate-proposal.js` (validators below); report posted
   on the ticket.
6. **Deliver** with `prepare-delivery.js`: `preprocessedFiles` returns
   `final/<file>` for the entry's location, placed at the class's `manualGet`
   path.
7. **Mark ready** or **request revision**.

### Converters

Registry `dataset-types/functional-update/converters.js`, keyed by
`datasetClass`:

| Class | Value columns | Level | Output |
|---|---|---|---|
| `productNames` | product; optional preferred flag | transcript | `products.txt` (id, product, is_preferred) |
| `GeneOntologyAssociations` | GO id; optional evidence code (default `IEA`), reference | transcript | `associations.gas` (GAF, via E's `gafLine`; date = curation date, taxon from the organism) |
| `EnzymeCommissionAssociations` | EC | protein | `ec.txt` |
| `geneName` | name | gene | `geneName.txt` |
| `comments` | comment | the ID column's level, gene or transcript (protein IDs refused) | `comments.txt` |
| `aliases` | alias | transcript | `aliases.txt` |

ID mapping: gene → its transcripts (or its gene for gene-level classes);
transcript → itself or its gene; protein → its transcript. Without a
preferred flag, `is_preferred` is 1 for the first product per transcript in
file order.

### Shared writers

E's row logic moves from `genome/functional/classes.js` into
`genome/functional/writers.js`: `uniqueSorted`, the products
`is_preferred` rule, `gafLine`, `isEc`, the GO value checks. `classes.js`
keeps GFF attribute reading and imports the writers. E's golden digests pin
the refactor.

### `convert.json`

`{ schemaVersion: 1, generator, input: { file, sha256 }, gff: { url, sha256 },
columns: <columns.json sha256>, datasetClass, file, rows, sha256,
ids: { level, count }, findings }`. Findings use `finding()` from
`genome/checks.js`:

| Code | Severity |
|---|---|
| `unmatchedIds` | error when more than 1% of input IDs (or any, for under 100 rows), otherwise warning; lists them |
| `badGo`, `badEc` | warning; rows skipped |
| `emptyValue` | warning; rows skipped |
| `noRows` | error |

An error finding exits 1 after files and record are written.

### Validators (`dataset-types/functional-update/validators/index.js`)

| Validator | Kind | Checks |
|---|---|---|
| `converted` | preprocess | `convert.json` exists, its input, GFF and columns hashes match the work area, no error findings |
| `entryTarget` | content | the mode check of Phase 1, against the branch being validated (rebuild branch at load) |
| `historyRecord` | content | `curated/history.json` complete; the genome presenter exists; the edit list applies cleanly (dry run of the appliers) |
| `noPendingGenome` | content | no genome proposal for the organism in this build |

## 3. Load: declarative edits

### Contract additions

| Export | Phase | Purpose |
|---|---|---|
| `loadEdits(dir, { manifest, settled, build, given })` | 2 | optional; an array of edit operations (plain data) load applies to files already on the rebuild branch. `given` holds `--history` values |
| `amendsPresenters` | both | optional; `true` when `presenterNames` names presenters the proposal amends rather than creates: they must exist, and load renders no presenter |

### Operations

```js
{ op: 'appendHistory', project, presenter, build,
  functional: { source, version },      // version formatted "Mon DD, YYYY"
  text, carry }                         // carry: --history values, may be {}
{ op: 'setEntryVersion', project, organism, datasetClass, name, version }
```

`functional-update` returns `appendHistory` for
`<orgAbbrev>_primary_genome_RSRC`, plus `setEntryVersion` in `bump` mode. In
`new` mode the entry is rendered and inserted by the existing
`renderDatasets` / `insertDataset` path.

### Appliers (pure, `string → string`)

`appendHistory(presenterXml, op)` in `lib/presenter-file.js`:

- exactly one `<datasetPresenter name="…">`, else refused;
- reads the latest `<history>` (highest `buildNumber`);
- a row for `op.build` exists → raise its `functionalAnnotationVersion` when
  `op`'s is later; else unchanged;
- otherwise insert after the latest row, copying `genomeSource`,
  `genomeVersion`, `annotationSource`, `annotationVersion` from it, `carry`
  overriding; any of the four still empty → refused, naming
  `--history <key>=<value>`.

`setEntryVersion(datasetXml, op)` in `lib/dataset-file.js`:

- exactly one `<dataset class="…">` whose `name` prop is `op.name`, else
  refused;
- its `version` prop equal to `op.version` → unchanged; an earlier literal or
  `$$functAnnotVersion$$` → replaced with the literal; anything else refused.

Both are idempotent: applying an edit twice gives the same text.

### load-ops

- Collects edits once per load; `--dry-run` prints them.
- Applies them in `renderAndCheck` beside the inserts; a refused edit stops
  the load before any commit.
- Records the edit list in the load commit body; `assertSettledAsCommitted`
  compares it on resume.
- `load-proposal.js --history <key>=<value>` (repeatable) passes `given`.
- For `amendsPresenters` types, presenter-name uniqueness is replaced by an
  existence check.

Build fitness at verify runs the same appliers against the rebuild branch.

## 4. Errors, tests, version

- Refusals name the file, the target and the fix, in the existing style.
- Tests (Node's runner, no network):
  - appliers: idempotence, same-build merge, `carry` refusal, constant →
    literal, ambiguous targets, inline XML strings;
  - one converter test per class: a small tab file and small GFF built in the
    test, outputs pinned as rows and sha256;
  - type module: fixture under `tests/fixtures/proposals/` (bump and new);
  - load-ops: bump and new loads, resume, dry-run edit list;
  - E's golden test guards the `writers.js` extraction.
- Version 4.1.0: a new type and optional contract exports; existing types
  unchanged.
- Docs: `development.md` contract table and module table; README and
  `CLAUDE.md` skill lists; `curator.config.json` `typeLabels`;
  `package.json` `sharedFiles` for both new skills.

## Out of scope

- `dbxref_simple`, `dbxref_synonym`.
- Several classes in one proposal.
- IDs from the build database instead of the released GFF.
- Structural annotation updates.
