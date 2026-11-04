# Dataset Entries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A proposal holds 0..N dataset entries in `curated/datasets.json`, the only source of dataset identity. Every consumer reads them through `datasetsOf`, genome and functional classes parse and deliver, single-entry types render byte-identically, and old proposals (manifest identity plus `curated/dataset.json`) still read as one entry. Version 3.0.0.

**Architecture:** The entry schema, its one reader (`datasetsOf`), constant resolution (`resolveEntry`) and class-aware validation (`assertValidEntries`) live in `dataset-types/_common.js`, beside the presenter and dataset record schemas. `parseDatasetClass` returns `delivery: { dir, file }` for all three `classes.xml` delivery shapes, and `artifacts.deliveryLocation` expands it from one resolved entry. An entry's identity is its resolved `datasetName` (`artifacts.datasetNameOf`, the class's `datasetNamePattern`), not `(datasetClass, name)`, which only labels it. Each dataset type declares `datasetClasses` (and `singleEntry` for the three SRA types) in place of the single `datasetClass`. Consumers move one area at a time: type internals, `renderDataset`, clash checks, load, delivery and mark-ready, render, publish, then write. The legacy identity APIs go last.

**Tech Stack:** Node 18 ES modules, `node:test`, yarn. Spec: `docs/superpowers/specs/2026-11-04-dataset-entries-design.md`. Background: `docs/superpowers/research/2026-11-03-genome-dataset-class-formats.md`.

**Conventions:** Edit only under `shared/` (never `skills/*/scripts` or `skills/*/resources` copies of shared files; the pre-commit hook syncs them). Skill-owned docs (`skills/*/SKILL.md`, `skills/*/resources/step-*.md`) are not synced and are edited in place. Run a single test file with `node --test tests/<file>.test.js`; the whole suite with `yarn test`. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Work on branch `feature/dataset-entries`.

---

## Key design points

Signatures used by every task below. "Entry" always means `{ datasetClass, name, version, props, source }`.

`shared/scripts/lib/dataset-classes.js`

| Export | Signature / shape |
|---|---|
| `parseDatasetClass(xml, className)` | `→ { className, props, datasetNamePattern, delivery: { dir, file } }`. `dir` is relative to `@@manualDeliveryDir@@`, has no trailing slash and ends in `final`; `file` is `null` for a directory delivery. `deliveryPath` is gone |
| `readDatasetClass(repoPath, className)`, `readDatasetClassOnRef(git, ref, className)` | unchanged; return the shape above |
| `expandPattern(pattern, values)` | unchanged |
| `sameDatasetName(classDef, a, b)` | `→ boolean`: whether two entries (or `<dataset>`s read as `{ name, version, props }`) of `classDef`'s class get one `datasetName` in one organism, comparing the values its `datasetNamePattern` uses other than `projectName`/`organismAbbrev`, as written (Task 9) |
| `identityValues` | removed (Task 16) |

`shared/scripts/lib/artifacts.js`

| Export | Signature |
|---|---|
| `deliveryLocation(manifest, classDef, organism, entry)` | `entry` is resolved. `→ { target: '@@manualDeliveryDir@@/<dir>/', relative: '<dir>', file }`. Placeholders come from `entry.props`, then `projectName`, `organismAbbrev`, `entry.name`, `entry.version`. An unfilled `${x}` throws `No value for ${x} in "<pattern>"`; callers add the entry's label (Task 6b; before it, the message began with the resolved `<datasetClass> <name>: `) |
| `datasetNameOf(manifest, classDef, organism, entry)` | `entry` is resolved. `→` `classDef.datasetNamePattern` expanded from the same values as `deliveryLocation`: the entry's identity (Task 6b) |

`shared/scripts/dataset-types/_common.js` (new unless marked)

| Export | Signature |
|---|---|
| `DATASETS_FILENAME`, `DATASETS_SCHEMA_VERSION` | `'datasets.json'`, `2` |
| `DATASET_FILENAME`, `DATASET_SCHEMA_VERSION` | kept: the legacy file and its version, read only by `datasetsOf` and checked by `validateDataset` |
| `ORGANISM_RECORD_FILENAME` | `'organism.json'` (moved here from `genome-assembly.js`, which re-exports it) |
| `ORGANISM_FILE_CONSTANTS` | `['projectName', 'organismAbbrev', 'strainAbbrev', 'ncbiTaxonId', 'speciesNcbiTaxonId']` |
| `isDate(v)` | `YYYY-MM-DD` that parses |
| `entryLabel(entry)` | `` `${datasetClass} ${name}` `` |
| `entriesLabel(entries)` | the one name, else `` `${n} datasets` `` (load commit subject) |
| `readerOnRef(git, ref)` | `→ (path) => text \| null`, for `datasetsOf`/`constantsOf`/`assertValidEntries` on a ref |
| `entryIdentityErrors(entry, { accession })` | `→ string[]` for the present `datasetClass`, `name`, `version` |
| `entriesErrors(entries, manifest)` | `→ string[]`: each entry's shape. Identity is not shape: from Task 6b `(datasetClass, name)` may repeat, and `assertValidEntries` checks `datasetName`s |
| `datasetsOf(proposalDir, manifest, { read } = {})` | `→ entries`. The only reader of `datasets.json`, `dataset.json` and manifest identity. Throws `Invalid dataset entries of <accession>:\n  - …` |
| `onlyEntry(proposalDir, manifest)` | `→ entry`; throws unless exactly one |
| `resolveEntry(entry, constants)` | `→ entry` with every `$$x$$` in `name`, `version`, `props` replaced; throws on an unknown constant or a resolved version that is not a date |
| `constantsFor(manifest, organism, constants = {}, datasetType = {})` | `→ { [name]: value }`: `ORGANISM_FILE_CONSTANTS` and the type's `requiredOrganismConstants` keys as `$$name$$` references, then `constants`, then the organism's `projectName` and `organismAbbrev` |
| `constantsOf(proposalDir, { read } = {})` | `→ curated/organism.json` `constants`, or `{}` |
| `entryPropErrors(entry, classDef)` | `→ string[]`: props must be exactly the class's props minus `IDENTITY_PROPS`, as strings (empty allowed) |
| `entryTypeErrors(entries, { manifest, datasetType, classOf, constants = {} })` | named `entryErrors` in Task 6, renamed in Task 6b. `→ string[]`: class allowed and in `classes.xml`, entry count, props (an entry with prop errors gets no others), constants, version date, placeholders, shared `datasetName` per organism, shared delivery directory. Every message starts with the unresolved `entryLabel`. Throws `TypeError` unless `classOf` is a function |
| `entryForOrganism(manifest, entry, classDef, organism, { constants, datasetType } = {})` | `→ { resolved, datasetName, target, relative, file }`; resolution errors come from `resolveEntry`, placeholder errors are prefixed with `entryLabel(entry)` (Task 6b) |
| `assertValidEntries(proposalDir, manifest, datasetType, { classOf, read } = {})` | `→ entries`, or throws `Invalid dataset entries of <accession>:\n  - …` |
| `entryDeliveries(manifest, entries, { classOf, constants = {}, datasetType = {} })` | `→ [{ entry, label, organism, datasetName, target, relative, file }]`, organism-major, entries in order (`datasetName` from Task 6b) |
| `datasetRecordOf(entry)` | `→ { schemaVersion: DATASET_SCHEMA_VERSION, props, source }`, what `validateDataset` checks |
| `datasetElement(entry, classDef)` | changed from `(m, classDef, props)` |
| `renderEntry(entry, classDef)` | the `<dataset>` element of a type with no `renderDataset` |
| `renderDatasets(proposalDir, manifest, datasetType, classOf)` | every entry's element, in order, joined by `'\n\n'` |
| `requireIdentity`, `readDataset`, `datasetPath` | removed (Task 16) |

Dataset type modules

| Export | Value |
|---|---|
| `datasetClasses` | `['rnaSeqExperiment']`, `['dnaseqExperiment']`, `['chipSeqExperiment']`; genome: the 14 sequence, feature and functional classes |
| `singleEntry` | `true` on bulk-rnaseq, dnaseq, chipseq; absent on genome |
| `renderDataset(proposalDir, entry, classDef)` | changed from `(proposalDir, classDef)`; optional (genome has none, so `renderEntry` is used) |
| `deriveDataset(proposalDir, classDef, overrides)` | unchanged: returns `{ schemaVersion: 1, props, source }`; `writeProposal` builds the entry from it |
| `datasetClass` | removed (Task 16) |

Other

| Module | Export | Signature |
|---|---|---|
| `lib/load-ops.js` | `loadConstants(datasetType, proposalConstants, given = {})` | `→ { required, given }` for `withOrganismConstants` |
| `lib/delivery.js` | `deliveryProblems(locations, files)` | `→ string[]` for entry directories with no file and required files missing or empty |
| `lib/dataset-file.js` | `entryDatasetExists(fileContent, classDef, entry)` | `→ boolean`: the organism file has a `<dataset>` of the entry's class with the same `datasetName` (`sameDatasetName`), commented-out ones included (Task 9). `datasetNameExists(fileContent, className, name)` stays for `datasetsMatching` |
| `lib/manifest.js` | `IDENTITY_FIELDS` | removed (Task 16) |

---

## File map

| File | Change |
|---|---|
| `shared/scripts/lib/dataset-classes.js` | `delivery: { dir, file }` for the three shapes; `sameDatasetName`; `identityValues` removed |
| `shared/scripts/lib/artifacts.js` | `deliveryLocation(manifest, classDef, organism, entry)`; `datasetNameOf` |
| `shared/scripts/lib/dataset-file.js` | `entryDatasetExists` |
| `shared/scripts/dataset-types/_common.js` | entries: schema, `datasetsOf`, `resolveEntry`, constants, `assertValidEntries`, `entryDeliveries`, `renderDatasets`; `datasetElement(entry, …)`; legacy readers removed |
| `shared/scripts/dataset-types/_sra-experiment.js` | presenter names from the entry; no `datasetClass` parameter |
| `shared/scripts/dataset-types/bulk-rnaseq.js`, `dnaseq.js`, `chipseq.js` | `datasetClasses`, `singleEntry`; names, props and source from `onlyEntry`; `renderDataset(dir, entry, classDef)` |
| `shared/scripts/dataset-types/bulk-rnaseq/validators/library-type.js`, `consistency.js` | source from `onlyEntry` |
| `shared/scripts/dataset-types/genome-assembly.js` | `datasetClasses`; re-exports `ORGANISM_RECORD_FILENAME` |
| `shared/scripts/lib/proposal-ops.js` | clash checks per entry (incl. siblings); `writeProposal` writes `datasets.json`, drops `dataset.json` and manifest identity; publish validates and lists entries |
| `shared/scripts/lib/build-fitness.js` | per-entry name checks; delivery by entries |
| `shared/scripts/lib/load-ops.js` | entries for delivery record, validation, XML, names, constants, commit and PR text; `loadConstants` |
| `shared/scripts/load-proposal.js` | dry-run line names `entriesLabel` |
| `shared/scripts/lib/delivery-ops.js` | per-entry locations and checks; optional type hooks |
| `shared/scripts/lib/delivery.js` | `deliveryProblems` |
| `shared/scripts/lib/verification-ops.js` | mark-ready validates entries; delivery when entries exist |
| `shared/scripts/render-proposal.js` | validates entries; `--dataset` via `renderDatasets`; `--artifacts` via `entryDeliveries` |
| `shared/scripts/write-proposal.js` | doc comment |
| `shared/scripts/lib/manifest.js` | `IDENTITY_FIELDS` and identity validation removed |
| `tests/fixtures/classes.xml` | 14 genome and functional class blocks, plus `noDelivery` and `notFinal` |
| `tests/regression-goldens.test.js` (new) | dnaseq/chipseq CLI goldens; v1 vs v2 equivalence |
| `tests/dataset-entries.test.js` (new) | `datasetsOf`, `resolveEntry`, constants, validation errors, deliveries |
| `tests/genome-entries.test.js` (new) | the synthetic genome proposal |
| `tests/dataset-classes.test.js`, `dataset-file.test.js`, `artifacts.test.js`, `dataset-types.test.js`, `dataset-types-dnaseq.test.js`, `dataset-types-chipseq.test.js`, `proposal-ops.test.js`, `build-fitness.test.js`, `load-ops.test.js`, `delivery-ops.test.js`, `delivery.test.js`, `validation-ops.test.js`, `render-proposal.test.js`, `manifest.test.js` | updated and new tests |
| `docs/development.md`, `shared/resources/proposal-workflow.md`, `skills/propose-{bulk-rnaseq,dnaseq,chipseq}/SKILL.md`, `skills/propose-{bulk-rnaseq,dnaseq,chipseq}/resources/step-4-write-proposal.md` | docs |
| `package.json`, `.claude-plugin/plugin.json` | 3.0.0 |

### Inventory of identity readers

From `grep -rnE "datasetClass|IDENTITY_FIELDS|readDataset|requireIdentity|DATASET_FILENAME|datasetPath|identityValues|deliveryPath|\bm\.name\b|manifest\.name\b|\bm\.version\b|manifest\.version\b" shared/scripts tests`. Hits for `datasetFile*` (organism-file paths in `lib/dataset-file.js`, `load-ops.js`) and for `lib/xml/datasetClass` paths are not identity and are not listed.

| Location | Reads | Task |
|---|---|---|
| `lib/dataset-classes.js:6-7,24-27` | `deliveryPath` | 2 |
| `lib/dataset-classes.js:50-52` | `identityValues` | 16 |
| `lib/artifacts.js:3,12` | `identityValues`, `deliveryPath` | 2, 5 |
| `dataset-types/_common.js:8` | `DATASET_FILENAME` | kept; legacy reader (3), `derivedNames` (14) |
| `dataset-types/_common.js:95-99` | `requireIdentity` | 16 |
| `dataset-types/_common.js:259,311-315` | `datasetPath`, `readDataset` | 16 |
| `dataset-types/_common.js:299` | "comes from the manifest" message | 6 |
| `dataset-types/_common.js:318-322` | `datasetElement(m, …)` with `m.name`, `m.version` | 8 |
| `dataset-types/_sra-experiment.js:4,27,31,32,48,86` | `requireIdentity`, `m.name`, `datasetClass` | 7 |
| `dataset-types/dnaseq.js:4,12,26,47,71,73,84` | `requireIdentity`, `m.name`, `datasetClass` | 7, 16 |
| `dataset-types/dnaseq.js:98-101` | `renderDataset` via `readDataset` | 8 |
| `dataset-types/chipseq.js:3,11,32,77,87,117,120,121,134` | `datasetPath`, `readDataset`, `requireIdentity`, `m.name`, `datasetClass` | 7, 16 |
| `dataset-types/chipseq.js:155-160` | `renderDataset` via `readDataset` | 8 |
| `dataset-types/bulk-rnaseq.js:4-5,40,87,139,174,180,202,213,346,388,409-410,451,512,538` | `requireIdentity`, `readDataset`, `m.name`, `datasetClass` | 7, 16 |
| `dataset-types/bulk-rnaseq.js:369-374` | `renderDataset` via `readDataset` | 8 |
| `bulk-rnaseq/validators/library-type.js:3,73`, `consistency.js:4,48` | `readDataset` | 7 |
| `lib/proposal-ops.js:12,15,401,431-436` | `datasetPath`, `DATASET_FILENAME`, `datasetType.datasetClass`, `renderDataset` | 8 (436), 14 |
| `lib/proposal-ops.js:166-210` | `assertNameIsFree`, `patternMatchWith` on `m.name`, `theirs.datasetClass/name` | 9 |
| `lib/proposal-ops.js:6,155,216-235,413` | `IDENTITY_FIELDS`, `identityFor` | 9 (413), 14 |
| `lib/proposal-ops.js:506` | `Name:`/`Version:` lines | 13 |
| `lib/build-fitness.js:19,30,35,37` | `datasetType.datasetClass`, `manifest.datasetClass/name` | 9 |
| `lib/load-ops.js:16,382-383` | `readDatasetClass(datasetType.datasetClass)`, `renderDataset` | 8 |
| `lib/load-ops.js:369,393-394` | `namePatternClash`/`datasetNameExists` on `m.name` | 9 |
| `lib/load-ops.js:213-214,332,381,462,473` | `datasetClass` gates, `manifest.name` in commit, resume, PR | 10 |
| `load-proposal.js:61` | `result.manifest.name` | 10 |
| `lib/delivery-ops.js:9,75,84,97-98` | `datasetType.datasetClass`, `m.name`, `deliveryLocation` | 5 (interim), 11 |
| `lib/verification-ops.js:157-158` | `datasetType.datasetClass` | 11 |
| `render-proposal.js:9,18,20,41-42,52,222` | `datasetClass`, `readDataset`, `deliveryLocation` | 5 (interim), 8, 12 |
| `write-proposal.js:16` | doc comment | 14 |
| `lib/manifest.js:21-22,246-263` | `IDENTITY_FIELDS`, identity validation | 16 |
| `bin/dropSamplesheetStrandednessColumn.js` (outside `shared/`) | `dataset.json` | none: a one-off migration over legacy proposals, which still carry `dataset.json` |
| `tests/dataset-classes.test.js:8,27,33,59` | `deliveryPath`, `identityValues` | 2, 16 |
| `tests/artifacts.test.js:206` | `deliveryLocation(…, organism)` | 2, 5 |
| `tests/dataset-types.test.js:396-402` | `requireIdentity` message | 7 |
| `tests/dataset-types.test.js:517,523,525,577` | `renderDataset(dir, classDef)` | 8 |
| `tests/dataset-types.test.js:570` | "comes from the manifest" | 6 |
| `tests/dataset-types-dnaseq.test.js:7,40,41,79` | `identityValues`, `m.name`, `presenterNames(src)`, `renderDataset` | 7, 8, 16 |
| `tests/dataset-types-chipseq.test.js:10,49,50,88,133` | same | 7, 8, 16 |
| `tests/proposal-ops.test.js:42-49` | planted manifests with identity | 9 |
| `tests/proposal-ops.test.js:569-589,615-625,2206-2209` | `manifest.datasetClass/name/version`, `dataset` result | 14 |
| `tests/build-fitness.test.js:53-58` | genome manifest spread over rnaseq identity | 9 |
| `tests/manifest.test.js:302-313` | identity validation | 16 |
| `tests/sra-experiment.test.js:13,24` | passes `datasetClass` to `sraExperimentType` | none: the extra key is ignored |

### Regression coverage (byte-identical render, load and delivery)

Already pinned, and left unchanged by this plan except for call-signature edits:

| Output | Test |
|---|---|
| bulk-rnaseq presenter XML | `tests/dataset-types.test.js` "render(…) matches its golden expected.xml" |
| bulk-rnaseq `<dataset>` XML | `tests/dataset-types.test.js` "renderDataset(…) matches its golden expected-dataset.xml"; `tests/render-proposal.test.js` "--dataset prints …" |
| dnaseq, chipseq presenter and `<dataset>` XML | `tests/dataset-types-dnaseq.test.js` "dnaseq renders an IsolatesHTS presenter…"; `tests/dataset-types-chipseq.test.js` "histonemod renders hasCalledPeaks true…" |
| load: organism file and commit subject, PR body | `tests/load-ops.test.js` lines ~569-577, 747, 765, 839, 1062, 1210 |
| bulk-rnaseq artifacts and delivery path | `tests/artifacts.test.js` "renderArtifacts matches the golden files", "the delivery location…", "render-proposal --artifacts …" |
| bulk-rnaseq delivery tree | `tests/delivery-ops.test.js` (`FINAL`, `CORPUS`), `tests/delivery-roundtrip.test.js` |

Gaps closed here: dnaseq and chipseq delivery paths and the `render-proposal` CLI output for them (Task 1, before any refactor, through the CLI so the test needs no edit later), and the same rnaseq output from the `datasets.json` shape (Task 15).

---

### Task 1: Pin dnaseq and chipseq render and delivery output

**Files:**
- Create: `tests/regression-goldens.test.js`

- [ ] **Step 1: Write the characterization test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, cpSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import * as dnaseq from '../shared/scripts/dataset-types/dnaseq.js';
import * as chipseq from '../shared/scripts/dataset-types/chipseq.js';
import { readDatasetClass, CLASSES_RELATIVE_PATH } from '../shared/scripts/lib/dataset-classes.js';
import { fixtures } from './helpers.js';

const cli = new URL('../shared/scripts/render-proposal.js', import.meta.url).pathname;

const CASES = [
  {
    mod: dnaseq, accession: 'PRJNA000010', className: 'dnaseqExperiment', dataset: {},
    presenter: { shortDisplayName: 'Tfak WGS', shortAttribution: 'Doe 2025' },
    final: 'FungiDB/tfakST1/SNP/Doe_isolates_2025/2025-03-01/final'
  },
  {
    mod: chipseq, accession: 'PRJNA000011', className: 'chipSeqExperiment', dataset: { props: { experimentType: 'histonemod' } },
    presenter: { shortDisplayName: 'Tfak histone', shortAttribution: 'Doe 2025' },
    final: 'FungiDB/tfakST1/chipSeq/Doe_histone_2025/2025-04-01/final'
  }
];

/** A throwaway checkout holding the fixture proposal curated as write-proposal leaves it. */
function checkoutWith(t, { mod, accession, className, dataset, presenter }) {
  const repo = mkdtempSync(join(tmpdir(), 'regression-'));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q', repo]);
  mkdirSync(join(repo, 'Model/lib/xml/datasetPresenters'), { recursive: true });
  mkdirSync(join(repo, 'Model/lib/xml/datasetClass'), { recursive: true });
  cpSync(join(fixtures, 'classes.xml'), join(repo, CLASSES_RELATIVE_PATH));
  const dir = join(repo, 'Proposals', accession);
  cpSync(join(fixtures, 'proposals', accession), dir, { recursive: true, filter: (p) => !/expected/.test(p) });
  mod.normalizeCurated(dir, dataset);
  writeFileSync(join(dir, 'curated', 'presenter.json'), JSON.stringify(mod.derivePresenter(dir, presenter), null, 2) + '\n');
  writeFileSync(join(dir, 'curated', 'dataset.json'), JSON.stringify(mod.deriveDataset(dir, readDatasetClass(repo, className), dataset), null, 2) + '\n');
  for (const [f, text] of Object.entries(mod.deriveArtifacts(dir))) {
    mkdirSync(dirname(join(dir, 'curated', f)), { recursive: true });
    writeFileSync(join(dir, 'curated', f), text);
  }
  return { repo, dir };
}

for (const c of CASES) {
  test(`${c.accession}: render-proposal --dataset prints its golden dataset entry`, (t) => {
    const { dir } = checkoutWith(t, c);
    const r = spawnSync('node', [cli, '--dataset', dir], { encoding: 'utf-8' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, readFileSync(join(fixtures, 'proposals', c.accession, 'expected-dataset.xml'), 'utf-8'));
  });

  test(`${c.accession}: render-proposal --artifacts delivers to the class path`, (t) => {
    const { repo, dir } = checkoutWith(t, c);
    const out = join(repo, '.curation', 'delivery');
    const r = spawnSync('node', [cli, '--artifacts', out, dir], { encoding: 'utf-8' });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.stdout.split('\n').includes(`${join(out, c.final)} → @@manualDeliveryDir@@/${c.final}/`), r.stdout);
    assert.ok(existsSync(join(out, c.final, 'samplesheet.csv')));
  });
}
```

- [ ] **Step 2: Run it**

Run: `node --test tests/regression-goldens.test.js`
Expected: PASS (4 tests). It pins today's output, so it passes before the refactor and must keep passing, unedited, through every later task.

- [ ] **Step 3: Commit**

```bash
git add tests/regression-goldens.test.js
git commit -m "Pin dnaseq and chipseq render and delivery output

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `parseDatasetClass` understands every delivery shape

**Files:**
- Modify: `tests/fixtures/classes.xml` (append blocks before `</datasetClasses>`)
- Modify: `shared/scripts/lib/dataset-classes.js` (`parseDatasetClass`)
- Modify: `shared/scripts/lib/artifacts.js` (`deliveryLocation` reads `classDef.delivery`)
- Test: `tests/dataset-classes.test.js`, `tests/artifacts.test.js`

- [ ] **Step 1: Add the fixture classes**

Insert this immediately before the final `</datasetClasses>` line of `tests/fixtures/classes.xml`. The blocks are cut from `VEuPathDatasets/Model/lib/xml/datasetClass/classes.xml` (CX:604-908, 1665-1827, 2800-2822, 3162-3220, 3278-3300, 5214-5237), keeping the prop lines, the loader's `datasetName` and the delivery lines. Descriptions and plugin args are dropped. `noDelivery` and `notFinal` are made-up error cases.

```xml
  <datasetClass class="fasta_primary_genome_sequence" category="" datasetFileHint="organism">
    <prop name="projectName">&projectName;</prop>
    <prop name="organismAbbrev">&organismAbbrev;</prop>
    <prop name="ncbiTaxonId">&ncbiTaxonId;</prop>
    <prop name="name">&name;</prop>
    <prop name="version">&version;</prop>
    <prop name="table">Ignore this property. You can leave it blank.</prop>
    <prop name="soTerm">[chromosome, supercontig, contig] &soTerm;</prop>
    <prop name="sourceIdRegex">&sourceIdRegex;</prop>
    <prop name="releaseDate">version of the data, in date format 2012-11-29</prop>
    <datasetLoader datasetName="${organismAbbrev}_primary_genome_RSRC" version="${version}"
              plugin="GUS::Supported::Plugin::LoadFastaSequences"
              scope="organism"
              organismAbbrev="${organismAbbrev}">
      <manualGet fileOrDir="${projectName}/${organismAbbrev}/genome/${soTerm}_${name}_fasta/${version}/final/">
      </manualGet>
    </datasetLoader>
  </datasetClass>
  <datasetClass class="fasta_secondary_genome" category="genome" datasetFileHint="">
    <prop name="projectName">&projectName;</prop>
    <prop name="organismAbbrev">&organismAbbrev;</prop>
    <prop name="ncbiTaxonId">&ncbiTaxonId;</prop>
    <prop name="name">&name;</prop>
    <prop name="version">&version;</prop>
    <prop name="table">Ignore this property.</prop>
    <prop name="soTerm">[supercontig, contig, random_sequence] &soTerm;</prop>
    <prop name="sourceIdRegex">&sourceIdRegex;</prop>
    <datasetLoader datasetName="${organismAbbrev}_${soTerm}_${name}_RSRC" version="${version}"
              plugin="GUS::Supported::Plugin::LoadFastaSequences"
              parentDatasetName="${organismAbbrev}_primary_genome_RSRC"
              scope="organism"
              organismAbbrev="${organismAbbrev}">
      <manualGet fileOrDir="${projectName}/${organismAbbrev}/genome/${soTerm}_${name}_fasta/${version}/final/">
      </manualGet>
    </datasetLoader>
  </datasetClass>
  <datasetClass class="fasta_organelle_genome" category="genome" datasetFileHint="">
    <prop name="projectName">&projectName;</prop>
    <prop name="organismAbbrev">&organismAbbrev;</prop>
    <prop name="ncbiTaxonId">&ncbiTaxonId;</prop>
    <prop name="name">&name;</prop>
    <prop name="version">&version;</prop>
    <prop name="table">Ignore this property.</prop>
    <prop name="soTerm">[mitochondrial_chromosome, apicoplast_chromosome] &soTerm;</prop>
    <prop name="sourceIdRegex">&sourceIdRegex;</prop>
    <prop name="organelle"/>
    <datasetLoader datasetName="${organismAbbrev}_${soTerm}_${name}_RSRC" version="${version}"
              plugin="GUS::Supported::Plugin::LoadFastaSequences"
              parentDatasetName="${organismAbbrev}_primary_genome_RSRC"
              scope="organism"
              organismAbbrev="${organismAbbrev}">
      <manualGet fileOrDir="${projectName}/${organismAbbrev}/genome/${soTerm}_${name}_fasta/${version}/final/genome.fasta">
      </manualGet>
    </datasetLoader>
  </datasetClass>
  <datasetClass class="NoPreprocess_primary_genome_features" category="genome" datasetFileHint="">
    <prop name="projectName">&projectName;</prop>
    <prop name="organismAbbrev">&organismAbbrev;</prop>
    <prop name="ncbiTaxonId">&ncbiTaxonId;</prop>
    <prop name="version">&version;</prop>
    <prop name="soTerm">[chromosome, supercontig, contig] &soTerm;</prop>
    <prop name="source">The source where the annotation file get from</prop>
    <prop name="mapFile">The map file used to load the annotation</prop>
    <datasetLoader datasetName="${organismAbbrev}_primary_genome_features_RSRC"
              version="${version}"
              parentDatasetName="${organismAbbrev}_primary_genome_RSRC"
              plugin="GUS::Supported::Plugin::InsertSequenceFeatures"
              scope="organism"
              organismAbbrev="${organismAbbrev}">
      <manualGet fileOrDir="${projectName}/${organismAbbrev}/genome/${soTerm}_${source}_gff3/${version}/final/">
      </manualGet>
    </datasetLoader>
  </datasetClass>
  <datasetClass class="NoPreprocess_secondary_genome_features" category="genome" datasetFileHint="">
    <prop name="projectName">&projectName;</prop>
    <prop name="organismAbbrev">&organismAbbrev;</prop>
    <prop name="ncbiTaxonId">&ncbiTaxonId;</prop>
    <prop name="version">&version;</prop>
    <prop name="soTerm">[supercontig, contig, random_sequence] &soTerm;</prop>
    <prop name="name">The source where the annotation file get from</prop>
    <prop name="mapFile">The map file used to load the annotation</prop>
    <datasetLoader datasetName="${organismAbbrev}_${soTerm}_genome_features_RSRC"
              version="${version}"
              parentDatasetName="${organismAbbrev}_primary_genome_RSRC"
              plugin="GUS::Supported::Plugin::InsertSequenceFeatures"
              scope="organism"
              organismAbbrev="${organismAbbrev}">
    <manualGet fileOrDir="${projectName}/${organismAbbrev}/genome/${soTerm}_${name}_gff3/${version}/final/">
    </manualGet>
    </datasetLoader>
  </datasetClass>
  <datasetClass class="NoPreprocess_organelle_genome_features" category="genome" datasetFileHint="">
    <prop name="projectName">&projectName;</prop>
    <prop name="organismAbbrev">&organismAbbrev;</prop>
    <prop name="ncbiTaxonId">&ncbiTaxonId;</prop>
    <prop name="version">&version;</prop>
    <prop name="soTerm">[mitochondrial_chromosome, apicoplast_chromosome] &soTerm;</prop>
    <prop name="name">The source where the annotation file get from</prop>
    <prop name="mapFile">The map file used to load the annotation</prop>
    <datasetLoader datasetName="${organismAbbrev}_${soTerm}_${name}_features_RSRC"
              version="${version}"
              parentDatasetName="${organismAbbrev}_primary_genome_RSRC"
              plugin="GUS::Supported::Plugin::InsertSequenceFeatures"
              scope="organism"
              organismAbbrev="${organismAbbrev}">
      <manualGet fileOrDir="${projectName}/${organismAbbrev}/genome/${soTerm}_${name}_gff3/${version}/final/">
      </manualGet>
    </datasetLoader>
  </datasetClass>
  <datasetClass class="productNames" category="" datasetFileHint="">
    <prop name="projectName">&projectName;</prop>
    <prop name="organismAbbrev">&organismAbbrev;</prop>
    <prop name="name">&name;</prop>
    <prop name="version">&version;</prop>
    <datasetLoader datasetName="${organismAbbrev}_function_${name}_product_names_RSRC" version="${version}"
              plugin="ApiCommonData::Load::Plugin::InsertProductFromTabFile"
              scope="organism"
              organismAbbrev="${organismAbbrev}">
      <manualGet fileOrDir="${projectName}/${organismAbbrev}/function/${name}_product_names/${version}/final/products.txt">
      </manualGet>
      <unpack> processProductAddPreferred.pl --inputFile "@@dataDir@@/products.txt" --outputFile "@@dataDir@@/processed_products.txt" --assignedBy ${name}</unpack>
    </datasetLoader>
  </datasetClass>
  <datasetClass class="GeneOntologyAssociations" category="gene_annotation" datasetFileHint="">
    <prop name="projectName">&projectName;</prop>
    <prop name="organismAbbrev">&organismAbbrev;</prop>
    <prop name="version">&version;</prop>
    <prop name="name">&name;</prop>
    <datasetLoader
              datasetName="${organismAbbrev}_${name}_GOAssociations_RSRC"
              version="${version}"
              plugin="ApiCommonData::Load::Plugin::InsertGOAssociationsSimple"
              scope="organism"
              organismAbbrev="${organismAbbrev}">
      <manualGet fileOrDir="${projectName}/${organismAbbrev}/function/${name}_GOAssociations/${version}/final/associations.gas">
      </manualGet>
    </datasetLoader>
  </datasetClass>
  <datasetClass class="EnzymeCommissionAssociations" category="gene_annotation" datasetFileHint="">
    <prop name="projectName">&projectName;</prop>
    <prop name="organismAbbrev">&organismAbbrev;</prop>
    <prop name="version">&version;</prop>
    <prop name="name">&name;</prop>
    <datasetLoader
              datasetName="${organismAbbrev}_${name}_ECAssociations_RSRC"
              version="${version}"
              plugin="GUS::Community::Plugin::InsertECMapping"
              scope="organism"
              organismAbbrev="${organismAbbrev}">
      <manualGet fileOrDir="${projectName}/${organismAbbrev}/function/${name}_ECAssociations/${version}/final/ec.txt">
      </manualGet>
    </datasetLoader>
  </datasetClass>
  <datasetClass class="geneName" category="" datasetFileHint="">
    <prop name="projectName">&projectName;</prop>
    <prop name="organismAbbrev">&organismAbbrev;</prop>
    <prop name="name">&name;</prop>
    <prop name="version">&version;</prop>
    <prop name="genomeVersion"/>
    <datasetLoader datasetName="${organismAbbrev}_gene_name_${name}_RSRC" version="${version}"
              plugin="ApiCommonData::Load::Plugin::InsertGeneNamesFromTabFile"
              scope="organism"
              organismAbbrev="${organismAbbrev}">
      <manualGet fileOrDir="${projectName}/${organismAbbrev}/function/${name}_gene_names/${version}/final/geneName.txt">
      </manualGet>
    </datasetLoader>
  </datasetClass>
  <datasetClass class="dbxref_synonym" category="" datasetFileHint="">
    <prop name="organismAbbrev">&organismAbbrev;</prop>
    <prop name="projectName">&projectName;</prop>
    <prop name="version">&version;</prop>
    <prop name="name">&name;</prop>
    <datasetLoader datasetName="${organismAbbrev}_dbxref_${name}_synonym_RSRC"
              version="${version}"
              plugin="ApiCommonData::Load::Plugin::InsertDBxRefs"
              scope="organism"
              organismAbbrev="${organismAbbrev}">
      <manualGet fileOrDir="${projectName}/${organismAbbrev}/function/synonym/${name}/${version}/final/synonyms.txt">
      </manualGet>
    </datasetLoader>
  </datasetClass>
  <datasetClass class="comments" category="" datasetFileHint="">
    <prop name="projectName">&projectName;</prop>
    <prop name="organismAbbrev">&organismAbbrev;</prop>
    <prop name="name">&name;</prop>
    <prop name="version">&version;</prop>
    <datasetLoader datasetName="${organismAbbrev}_${name}_comments_RSRC" version="${version}"
              plugin="ApiCommonData::Load::Plugin::InsertNaFeatCommentFromTabFile"
              scope="organism"
              organismAbbrev="${organismAbbrev}">
      <manualGet fileOrDir="${projectName}/${organismAbbrev}/comment/${name}/${version}/final/comments.txt">
      </manualGet>
    </datasetLoader>
  </datasetClass>
  <datasetClass class="aliases" category="" datasetFileHint="">
    <prop name="projectName">&projectName;</prop>
    <prop name="organismAbbrev">&organismAbbrev;</prop>
    <prop name="version">&version;</prop>
    <prop name="name">&name;</prop>
    <prop name="columnSpec"/>
    <prop name="url"/>
    <prop name="urlUsesSecondaryId"/>  <!-- true or false -->
    <prop name="target"/>  <!-- NASequence, AAFeature, NAFeature -->
    <prop name="idType"/>
    <prop name="viewName"/>
    <datasetLoader datasetName="${organismAbbrev}_${name}_${target}_aliases_RSRC"
              version="${version}"
              plugin="ApiCommonData::Load::Plugin::InsertDBxRefs"
              scope="organism"
              organismAbbrev="${organismAbbrev}">
      <manualGet fileOrDir="${projectName}/${organismAbbrev}/alias/${name}/${version}/final/aliases.txt">
      </manualGet>
    </datasetLoader>
  </datasetClass>
  <datasetClass class="dbxref_simple" category="" datasetFileHint="">
    <prop name="projectName">&projectName;</prop>
    <prop name="organismAbbrev">&organismAbbrev;</prop>
    <prop name="name">&name;</prop>
    <prop name="version">&version;</prop>
    <prop name="columnSpec"/>
    <prop name="target"/>  <!-- NASequence, AAFeature, NAFeature -->
    <prop name="url"/>  <!-- must use CDATA -->
    <prop name="urlUsesSecondaryId"/>  <!-- true or false -->
    <prop name="genomeVersion"/>
    <prop name="viewName"/>
    <datasetLoader datasetName="${organismAbbrev}_dbxref_${name}_RSRC"
              version="${version}"
              plugin="ApiCommonData::Load::Plugin::InsertDBxRefs"
              scope="organism"
              organismAbbrev="${organismAbbrev}">
      <manualGet fileOrDir="${projectName}/${organismAbbrev}/dbxref/${name}/${version}/final/mapping.txt">
      </manualGet>
    </datasetLoader>
  </datasetClass>
  <datasetClass class="noDelivery" category="" datasetFileHint="">
    <prop name="projectName">&projectName;</prop>
    <datasetLoader datasetName="${organismAbbrev}_noDelivery_RSRC" version="${version}" plugin="ApiCommonData::Load::Plugin::LoadNothing" scope="organism" organismAbbrev="${organismAbbrev}">
      <manualGet fileOrDir="common/empty"/>
    </datasetLoader>
  </datasetClass>
  <datasetClass class="notFinal" category="" datasetFileHint="">
    <prop name="projectName">&projectName;</prop>
    <datasetLoader datasetName="${organismAbbrev}_notFinal_RSRC" version="${version}" plugin="ApiCommonData::Load::Plugin::LoadNothing" scope="organism" organismAbbrev="${organismAbbrev}">
      <manualGet fileOrDir="${projectName}/${organismAbbrev}/data/"/>
    </datasetLoader>
  </datasetClass>
```

- [ ] **Step 2: Write the failing tests**

In `tests/dataset-classes.test.js`, replace the assertion on line 27

```js
  assert.equal(c.deliveryPath, '@@manualDeliveryDir@@/${projectName}/${organismAbbrev}/rnaSeq/${name}/${version}/final/');
```

with

```js
  assert.deepEqual(c.delivery, { dir: '${projectName}/${organismAbbrev}/rnaSeq/${name}/${version}/final', file: null });
```

and make the same replacement for the identical assertion on line 59. Append:

```js
const DELIVERIES = {
  rnaSeqExperiment: ['rnaSeq/${name}/${version}/final', null],
  dnaseqExperiment: ['SNP/${name}/${version}/final', null],
  chipSeqExperiment: ['chipSeq/${name}/${version}/final', null],
  fasta_primary_genome_sequence: ['genome/${soTerm}_${name}_fasta/${version}/final', null],
  fasta_secondary_genome: ['genome/${soTerm}_${name}_fasta/${version}/final', null],
  fasta_organelle_genome: ['genome/${soTerm}_${name}_fasta/${version}/final', 'genome.fasta'],
  NoPreprocess_primary_genome_features: ['genome/${soTerm}_${source}_gff3/${version}/final', null],
  NoPreprocess_secondary_genome_features: ['genome/${soTerm}_${name}_gff3/${version}/final', null],
  NoPreprocess_organelle_genome_features: ['genome/${soTerm}_${name}_gff3/${version}/final', null],
  productNames: ['function/${name}_product_names/${version}/final', 'products.txt'],
  GeneOntologyAssociations: ['function/${name}_GOAssociations/${version}/final', 'associations.gas'],
  EnzymeCommissionAssociations: ['function/${name}_ECAssociations/${version}/final', 'ec.txt'],
  geneName: ['function/${name}_gene_names/${version}/final', 'geneName.txt'],
  dbxref_synonym: ['function/synonym/${name}/${version}/final', 'synonyms.txt'],
  comments: ['comment/${name}/${version}/final', 'comments.txt'],
  aliases: ['alias/${name}/${version}/final', 'aliases.txt'],
  dbxref_simple: ['dbxref/${name}/${version}/final', 'mapping.txt']
};

for (const [className, [path, file]] of Object.entries(DELIVERIES)) {
  test(`${className} delivers from ${path}${file ? `/${file}` : '/'}`, () => {
    assert.deepEqual(readDatasetClass(repoWithClasses(), className).delivery, { dir: `\${projectName}/\${organismAbbrev}/${path}`, file });
  });
  test(`${className} reads as the local VEuPathDatasets checkout has it`,
    { skip: !existsSync(join(demo, CLASSES_RELATIVE_PATH)) && 'no local checkout' }, () => {
      const fixture = readDatasetClass(repoWithClasses(), className);
      const real = readDatasetClass(demo, className);
      assert.deepEqual([real.delivery, real.datasetNamePattern, real.props], [fixture.delivery, fixture.datasetNamePattern, fixture.props]);
    });
}

test('a class without a name prop keeps its own props; a datasetName on the next line still reads', () => {
  assert.deepEqual(readDatasetClass(repoWithClasses(), 'NoPreprocess_primary_genome_features').props,
    ['projectName', 'organismAbbrev', 'ncbiTaxonId', 'version', 'soTerm', 'source', 'mapFile']);
  assert.equal(readDatasetClass(repoWithClasses(), 'GeneOntologyAssociations').datasetNamePattern, '${organismAbbrev}_${name}_GOAssociations_RSRC');
});

test('a class matching no delivery shape, or delivering outside final/, is refused by name', () => {
  const repo = repoWithClasses();
  assert.throws(() => readDatasetClass(repo, 'noDelivery'), /Dataset class "noDelivery" declares no manual delivery/);
  assert.throws(() => readDatasetClass(repo, 'notFinal'),
    /Dataset class "notFinal" delivers from "\$\{projectName\}\/\$\{organismAbbrev\}\/data\/", which is not a final\/ directory or a file in one/);
});
```

(`demo` is declared at line 49, above the tests that use it; move the `const demo = join(homedir(), 'dataset-curation-demo');` line to just below the `fixtures` constant at the top so the appended tests can use it.)

In `tests/artifacts.test.js`, in the test `'the delivery location comes from the class unpack path'`, add `file: null` to the expected object:

```js
    target: '@@manualDeliveryDir@@/FungiDB/tfakST1/rnaSeq/Doe_heat_shock_2024/2024-05-01/final/',
    relative: 'FungiDB/tfakST1/rnaSeq/Doe_heat_shock_2024/2024-05-01/final',
    file: null
```

- [ ] **Step 3: Run to verify they fail**

Run: `node --test tests/dataset-classes.test.js tests/artifacts.test.js`
Expected: FAIL. `c.delivery` is undefined, and every genome and functional class throws `has no "<unpack>ln -s @@manualDeliveryDir@@/..." line`.

- [ ] **Step 4: Implement**

In `shared/scripts/lib/dataset-classes.js`, change the path import to `import { join, posix } from 'node:path';` and replace the docblock and body of `parseDatasetClass` with:

```js
const EMPTY_GET = 'common/empty';

/**
 * Where a class loads from, relative to @@manualDeliveryDir@@: { dir, file }, file null for a whole directory.
 * manualGet common/empty defers to its "ln -s @@manualDeliveryDir@@/..." unpack; any other manualGet names the path.
 * Other unpack steps run at load and are not read here.
 */
function deliveryOf(block, className) {
  const fileOrDir = block.match(/<manualGet\s+fileOrDir="([^"]+)"/)?.[1];
  const linked = block.match(/<unpack>\s*ln\s+-s\s+@@manualDeliveryDir@@\/(\S+)/)?.[1];
  const path = fileOrDir === undefined || fileOrDir === EMPTY_GET ? linked : fileOrDir;
  if (!path) {
    throw new Error(`Dataset class "${className}" declares no manual delivery: neither <manualGet fileOrDir="..."> nor manualGet ${EMPTY_GET} with "<unpack>ln -s @@manualDeliveryDir@@/..." in ${CLASSES_RELATIVE_PATH}`);
  }
  const trimmed = path.replace(/\/+$/, '');
  const [dir, file] = posix.basename(trimmed) === 'final' ? [trimmed, null] : [posix.dirname(trimmed), posix.basename(trimmed)];
  if (posix.basename(dir) !== 'final') throw new Error(`Dataset class "${className}" delivers from "${path}", which is not a final/ directory or a file in one`);
  return { dir, file };
}

/**
 * One class from classes.xml: its <prop> names, the datasetLoader datasetName
 * pattern, and where its manual delivery is (see deliveryOf).
 * Regex scan rather than an XML parser: the file is large, flat and uses
 * DTD entities a parser would need resolving.
 */
export function parseDatasetClass(xml, className) {
  const blocks = [...xml.matchAll(/<datasetClass\s+class="([^"]+)"[^>]*>([\s\S]*?)<\/datasetClass>/g)];
  const block = blocks.find(([, name]) => name === className)?.[2];
  if (block === undefined) throw new Error(`Dataset class "${className}" not found in ${CLASSES_RELATIVE_PATH}`);

  // Props of nested elements (datasetLoader and below) are not class props.
  const head = block.split(/<datasetLoader\b/)[0];
  const props = [...head.matchAll(/<prop\s+name="([^"]+)"/g)].map(m => m[1]);
  const datasetNamePattern = block.match(/<datasetLoader\b[^>]*\bdatasetName="([^"]+)"/)?.[1];
  if (!datasetNamePattern) throw new Error(`Dataset class "${className}" has no datasetLoader datasetName in ${CLASSES_RELATIVE_PATH}`);
  return { className, props, datasetNamePattern, delivery: deliveryOf(block, className) };
}
```

Also change the `IDENTITY_PROPS` doc comment to `/** Props a <dataset> element takes from its entry and organism, never from the entry's props. */`.

In `shared/scripts/lib/artifacts.js`, replace `deliveryLocation` and its doc comment with:

```js
/**
 * Where the class loads from, per classes.xml: the @@manualDeliveryDir@@
 * target directory, the same directory relative to that root for a local
 * copy, and the one file the class reads from it (null for the whole directory).
 */
export function deliveryLocation(manifest, classDef, organism) {
  const relative = expandPattern(classDef.delivery.dir, identityValues(manifest, organism));
  return { target: `${ROOT}${relative}/`, relative, file: classDef.delivery.file };
}
```

- [ ] **Step 5: Run to verify they pass**

Run: `node --test tests/dataset-classes.test.js tests/artifacts.test.js tests/regression-goldens.test.js`
Expected: PASS

Run: `yarn test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add tests/fixtures/classes.xml tests/dataset-classes.test.js tests/artifacts.test.js shared/scripts/lib/dataset-classes.js shared/scripts/lib/artifacts.js
git commit -m "parseDatasetClass reads manualGet file and directory deliveries

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `datasetsOf`, the one reader of dataset identity

**Files:**
- Modify: `shared/scripts/dataset-types/_common.js` (new section after `readDataset`)
- Create: `tests/dataset-entries.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/dataset-entries.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { datasetsOf, onlyEntry, entriesLabel, readerOnRef } from '../shared/scripts/dataset-types/_common.js';
import { fixtures } from './helpers.js';

const rnaDir = join(fixtures, 'proposals', 'PRJNA000002');
const genomeDir = join(fixtures, 'proposals', 'GCA_000001.1');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf-8'));
const manifestOf = (dir) => readJson(join(dir, 'manifest.json'));
const LEGACY = { datasetClass: 'rnaSeqExperiment', name: 'Doe_heat_shock_2024', version: '2024-05-01' };

/** A scratch copy of a fixture proposal. */
function copyOf(t, accession = 'PRJNA000002') {
  const dir = join(mkdtempSync(join(tmpdir(), 'entries-')), accession);
  t.after(() => rmSync(join(dir, '..'), { recursive: true, force: true }));
  cpSync(join(fixtures, 'proposals', accession), dir, { recursive: true });
  return dir;
}

/** A copy of PRJNA000002 in the datasets.json shape, holding datasets or its own one entry. */
function asV2(t, datasets) {
  const dir = copyOf(t);
  const manifestPath = join(dir, 'manifest.json');
  const { datasetClass, name, version, ...rest } = readJson(manifestPath);
  const { props, source } = readJson(join(dir, 'curated', 'dataset.json'));
  writeFileSync(manifestPath, JSON.stringify(rest, null, 2) + '\n');
  rmSync(join(dir, 'curated', 'dataset.json'));
  writeFileSync(join(dir, 'curated', 'datasets.json'),
    JSON.stringify({ schemaVersion: 2, datasets: datasets ?? [{ datasetClass, name, version, props, source }] }, null, 2) + '\n');
  return dir;
}

/** The "  - " lines of a thrown validation message, or [] when fn returns. */
function problemsOf(fn) {
  try { fn(); return []; } catch (e) { return e.message.split('\n  - ').slice(1); }
}

test('datasetsOf reads curated/datasets.json and the old manifest-plus-dataset.json shape alike', (t) => {
  const v1 = datasetsOf(rnaDir, manifestOf(rnaDir));
  assert.deepEqual(v1, [{ ...LEGACY, props: readJson(join(rnaDir, 'curated', 'dataset.json')).props, source: { type: 'sra' } }]);
  const dir = asV2(t);
  assert.deepEqual(datasetsOf(dir, manifestOf(dir)), v1);
});

test('datasetsOf reads an old dataset.json without a source as SRA', (t) => {
  const dir = copyOf(t);
  const path = join(dir, 'curated', 'dataset.json');
  const { source, ...d } = readJson(path);
  writeFileSync(path, JSON.stringify(d));
  assert.deepEqual(datasetsOf(dir, manifestOf(dir))[0].source, { type: 'sra' });
});

test('a proposal with neither file and no manifest identity has no entries', () => {
  assert.deepEqual(datasetsOf(genomeDir, manifestOf(genomeDir)), []);
});

test('datasetsOf refuses dataset.json beside datasets.json, and manifest identity beside datasets.json', (t) => {
  const both = asV2(t);
  cpSync(join(rnaDir, 'curated', 'dataset.json'), join(both, 'curated', 'dataset.json'));
  assert.throws(() => datasetsOf(both, manifestOf(both)),
    /Invalid dataset entries of PRJNA000002:\n  - curated\/dataset\.json and curated\/datasets\.json are both present/);
  const identity = asV2(t);
  assert.throws(() => datasetsOf(identity, { ...manifestOf(identity), ...LEGACY }),
    /the manifest's datasetClass, name, version and curated\/datasets\.json both give dataset identity/);
});

test('datasetsOf refuses half of the old shape', (t) => {
  const dir = copyOf(t);
  rmSync(join(dir, 'curated', 'dataset.json'));
  assert.throws(() => datasetsOf(dir, manifestOf(dir)), /the manifest's datasetClass, name, version need curated\/dataset\.json/);
  const { datasetClass, name, version, ...bare } = manifestOf(rnaDir);
  assert.throws(() => datasetsOf(rnaDir, bare), /curated\/dataset\.json has no identity/);
});

test('datasetsOf checks each entry\'s shape', (t) => {
  const [entry] = datasetsOf(rnaDir, manifestOf(rnaDir));
  const errorsFor = (datasets) => { const dir = asV2(t, datasets); return problemsOf(() => datasetsOf(dir, manifestOf(dir))); };
  assert.deepEqual(errorsFor([{ ...entry, name: 'Doe heat' }]),
    ['rnaSeqExperiment Doe heat: name may contain only letters, digits and underscores, and must start with a letter, or be one $$constant$$']);
  assert.deepEqual(errorsFor([{ ...entry, name: 'Doe_PRJNA000002' }]),
    ['rnaSeqExperiment Doe_PRJNA000002: name "Doe_PRJNA000002" must be readable, not built from the accession']);
  assert.deepEqual(errorsFor([{ ...entry, version: '24 July 2021' }]),
    ['rnaSeqExperiment Doe_heat_shock_2024: version must be a date, YYYY-MM-DD, or one $$constant$$']);
  assert.deepEqual(errorsFor([{ ...entry, version: '$$a$$_$$b$$' }]),
    ['rnaSeqExperiment Doe_heat_shock_2024: version must be a date, YYYY-MM-DD, or one $$constant$$']);
  const { props, ...noProps } = entry;
  assert.deepEqual(errorsFor([{ ...noProps, colour: 'red' }]),
    ['rnaSeqExperiment Doe_heat_shock_2024: props is required', 'rnaSeqExperiment Doe_heat_shock_2024: colour is not an entry field']);
  assert.deepEqual(errorsFor([{ ...entry, props: { limitNU: 30 } }]),
    ['rnaSeqExperiment Doe_heat_shock_2024: props must be an object of string values']);
  assert.deepEqual(errorsFor([{ ...entry, source: { type: 'ftp' } }]),
    ['rnaSeqExperiment Doe_heat_shock_2024: source.type must be one of sra, server, url']);
  assert.deepEqual(errorsFor(['x']), ['datasets[0] must be an object { datasetClass, name, version, props, source }']);
  assert.deepEqual(errorsFor([{ ...entry, datasetClass: 'fasta_primary_genome_sequence', name: '$$genomeSource$$', version: '$$genomeVersion$$' }]), []);
});

test('datasetsOf refuses a (datasetClass, name) listed twice', (t) => {
  const [entry] = datasetsOf(rnaDir, manifestOf(rnaDir));
  const twice = asV2(t, [entry, { ...entry, version: '2025-01-01' }]);
  assert.deepEqual(problemsOf(() => datasetsOf(twice, manifestOf(twice))),
    ['rnaSeqExperiment Doe_heat_shock_2024 is listed more than once; datasetClass and name identify an entry']);
  const fine = asV2(t, [entry, { ...entry, datasetClass: 'chipSeqExperiment' }]);
  assert.equal(datasetsOf(fine, manifestOf(fine)).length, 2);
});

test('datasetsOf reads a proposal on a ref through readerOnRef; onlyEntry insists on one entry', () => {
  const files = { 'Proposals/PRJNA000002/curated/dataset.json': readFileSync(join(rnaDir, 'curated', 'dataset.json'), 'utf-8') };
  const git = { fileExistsOnRef: (ref, p) => ref === 'origin/master' && p in files, showFile: (ref, p) => files[p] };
  assert.deepEqual(datasetsOf('Proposals/PRJNA000002', manifestOf(rnaDir), { read: readerOnRef(git, 'origin/master') }),
    datasetsOf(rnaDir, manifestOf(rnaDir)));
  assert.equal(onlyEntry(rnaDir, manifestOf(rnaDir)).name, 'Doe_heat_shock_2024');
  assert.throws(() => onlyEntry(genomeDir, manifestOf(genomeDir)), /Proposal GCA_000001\.1 needs exactly one dataset entry; it has 0/);
  assert.equal(entriesLabel([{ name: 'Doe_2024' }]), 'Doe_2024');
  assert.equal(entriesLabel([{ name: 'a' }, { name: 'b' }]), '2 datasets');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/dataset-entries.test.js`
Expected: FAIL with `SyntaxError: The requested module '../shared/scripts/dataset-types/_common.js' does not provide an export named 'datasetsOf'`.

- [ ] **Step 3: Implement**

Append to `shared/scripts/dataset-types/_common.js`, after `readDataset` and before `datasetElement`:

```js
// --- dataset entries (curated/datasets.json) ---------------------------------

export const DATASETS_FILENAME = 'datasets.json';
export const DATASETS_SCHEMA_VERSION = 2;
const LEGACY_IDENTITY = ['datasetClass', 'name', 'version'];
const ENTRY_KEYS = ['datasetClass', 'name', 'version', 'props', 'source'];
const CLASS_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;
const LITERAL_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;
const ONE_CONSTANT = /^\$\$\w+\$\$$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const isDate = (v) => typeof v === 'string' && DATE.test(v) && !Number.isNaN(Date.parse(v));
export const entryLabel = (e) => `${e.datasetClass} ${e.name}`;
/** How a load commit names a proposal's datasets: the one name, or a count. */
export const entriesLabel = (entries) => (entries.length === 1 ? entries[0].name : `${entries.length} datasets`);

const readLocal = (path) => (existsSync(path) ? readFileSync(path, 'utf-8') : null);
/** A reader for datasetsOf and constantsOf of a proposal as ref has it; paths are repository-relative. */
export const readerOnRef = (git, ref) => (path) => (git.fileExistsOnRef(ref, path) ? git.showFile(ref, path) : null);

/** Problems with the identity fields an entry has; a literal name may not be built from the accession. */
export function entryIdentityErrors(e, { accession } = {}) {
  const errors = [];
  if (e.datasetClass !== undefined && (typeof e.datasetClass !== 'string' || !CLASS_NAME.test(e.datasetClass))) {
    errors.push('datasetClass must be a classes.xml class name');
  }
  if (e.name !== undefined) {
    if (typeof e.name !== 'string' || !(LITERAL_NAME.test(e.name) || ONE_CONSTANT.test(e.name))) {
      errors.push('name may contain only letters, digits and underscores, and must start with a letter, or be one $$constant$$');
    } else if (accession && e.name.toLowerCase().includes(accession.toLowerCase())) {
      errors.push(`name "${e.name}" must be readable, not built from the accession`);
    }
  }
  if (e.version !== undefined && !(isDate(e.version) || (typeof e.version === 'string' && ONE_CONSTANT.test(e.version)))) {
    errors.push('version must be a date, YYYY-MM-DD, or one $$constant$$');
  }
  return errors;
}

/** Each entry's shape, before any class or constant is consulted, then any (datasetClass, name) listed twice. */
export function entriesErrors(entries, manifest) {
  const errors = [];
  entries.forEach((e, i) => {
    if (!isObject(e)) {
      errors.push(`datasets[${i}] must be an object { ${ENTRY_KEYS.join(', ')} }`);
      return;
    }
    const at = typeof e.datasetClass === 'string' && typeof e.name === 'string' ? entryLabel(e) : `datasets[${i}]`;
    const stringProps = isObject(e.props) && Object.values(e.props).every((v) => typeof v === 'string');
    const problems = [
      ...ENTRY_KEYS.filter((k) => e[k] === undefined).map((k) => `${k} is required`),
      ...Object.keys(e).filter((k) => !ENTRY_KEYS.includes(k)).map((k) => `${k} is not an entry field`),
      ...entryIdentityErrors(e, manifest),
      ...(e.props === undefined || stringProps ? [] : ['props must be an object of string values']),
      ...(e.source === undefined ? [] : validateSource(e.source))
    ];
    errors.push(...problems.map((p) => `${at}: ${p}`));
  });
  const seen = new Set();
  for (const e of entries.filter((x) => isObject(x) && typeof x.datasetClass === 'string' && typeof x.name === 'string')) {
    if (seen.has(entryLabel(e))) errors.push(`${entryLabel(e)} is listed more than once; datasetClass and name identify an entry`);
    seen.add(entryLabel(e));
  }
  return errors;
}

/**
 * The proposal's dataset entries [{ datasetClass, name, version, props, source }]: the one reader of
 * curated/datasets.json, and of the shape before it (manifest datasetClass, name and version with a
 * schemaVersion 1 curated/dataset.json), which reads as one entry. Shape only; assertValidEntries checks
 * classes, constants and delivery paths. read(path) returns a file's text or null.
 */
export function datasetsOf(proposalDir, manifest, { read = readLocal } = {}) {
  const json = (f) => {
    const path = join(proposalDir, 'curated', f);
    const text = read(path);
    if (text === null) return null;
    try { return JSON.parse(text); } catch (e) { throw new Error(`${path} is not valid JSON: ${e.message}`); }
  };
  const v2 = json(DATASETS_FILENAME);
  const v1 = json(DATASET_FILENAME);
  const legacy = LEGACY_IDENTITY.filter((k) => manifest[k] !== undefined);
  const problems = [];
  let entries = [];
  if (v2 !== null && v1 !== null) {
    problems.push(`curated/${DATASET_FILENAME} and curated/${DATASETS_FILENAME} are both present; re-run write-proposal.js, which keeps only ${DATASETS_FILENAME}`);
  } else if (v2 !== null) {
    if (legacy.length) problems.push(`the manifest's ${legacy.join(', ')} and curated/${DATASETS_FILENAME} both give dataset identity; re-run write-proposal.js`);
    if (!isObject(v2) || v2.schemaVersion !== DATASETS_SCHEMA_VERSION || !Array.isArray(v2.datasets)) {
      problems.push(`curated/${DATASETS_FILENAME} must be { "schemaVersion": ${DATASETS_SCHEMA_VERSION}, "datasets": [...] }`);
    } else {
      entries = v2.datasets;
    }
  } else if (legacy.length) {
    if (v1 === null) problems.push(`the manifest's ${legacy.join(', ')} need curated/${DATASET_FILENAME}; re-run write-proposal.js`);
    else if (!isObject(v1) || v1.schemaVersion !== DATASET_SCHEMA_VERSION) problems.push(`curated/${DATASET_FILENAME} must be a schemaVersion ${DATASET_SCHEMA_VERSION} object`);
    // Old dataset.json files may predate "source"; every type that wrote them read from SRA by default.
    else entries = [{ datasetClass: manifest.datasetClass, name: manifest.name, version: manifest.version, props: v1.props, source: v1.source ?? { type: 'sra' } }];
  } else if (v1 !== null) {
    problems.push(`curated/${DATASET_FILENAME} has no identity: the manifest has no datasetClass, name and version; re-run write-proposal.js`);
  }
  if (!problems.length) problems.push(...entriesErrors(entries, manifest));
  if (problems.length) throw new Error(`Invalid dataset entries of ${manifest.accession}:\n  - ${problems.join('\n  - ')}`);
  return entries;
}

/** The one entry of a single-entry type's proposal. */
export function onlyEntry(proposalDir, m) {
  const entries = datasetsOf(proposalDir, m);
  if (entries.length !== 1) throw new Error(`Proposal ${m.accession} needs exactly one dataset entry; it has ${entries.length}. Re-run write-proposal.js`);
  return entries[0];
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/dataset-entries.test.js`
Expected: PASS

Run: `yarn test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add shared/scripts/dataset-types/_common.js tests/dataset-entries.test.js
git commit -m "datasetsOf: dataset entries from datasets.json, or the old shape as one entry

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `resolveEntry` and `organism.json` `constants`

**Files:**
- Modify: `shared/scripts/dataset-types/_common.js` (after `onlyEntry`; manifest import)
- Modify: `shared/scripts/dataset-types/genome-assembly.js:45` (`ORGANISM_RECORD_FILENAME` comes from `_common.js`)
- Test: `tests/dataset-entries.test.js`

- [ ] **Step 1: Write the failing tests**

In `tests/dataset-entries.test.js` replace the `_common.js` import with:

```js
import {
  datasetsOf, onlyEntry, entriesLabel, readerOnRef, resolveEntry, constantsFor, constantsOf
} from '../shared/scripts/dataset-types/_common.js';
```

Append:

```js
const GENOME_CONSTANTS = { genomeSource: 'GenBank', genomeVersion: '2017-03-09', soTerm: 'chromosome', functAnnotVersion: '2017-03-09', source: 'GenBank' };
const SERVER = { type: 'server', paths: ['/data/tfakST-1'] };
const PRIMARY = {
  datasetClass: 'fasta_primary_genome_sequence', name: '$$genomeSource$$', version: '$$genomeVersion$$',
  props: { ncbiTaxonId: '$$ncbiTaxonId$$', table: 'DoTS::ExternalNASequence', soTerm: '$$soTerm$$', sourceIdRegex: '^>(\\S+)', releaseDate: '' },
  source: SERVER
};
const genomeManifest = manifestOf(genomeDir);

test('resolveEntry fills $$constants$$ in name, version and props; organism-file constants stay references', () => {
  const c = constantsFor(genomeManifest, 'tfakST-1', GENOME_CONSTANTS);
  assert.deepEqual(resolveEntry(PRIMARY, c), {
    ...PRIMARY, name: 'GenBank', version: '2017-03-09',
    props: { ncbiTaxonId: '$$ncbiTaxonId$$', table: 'DoTS::ExternalNASequence', soTerm: 'chromosome', sourceIdRegex: '^>(\\S+)', releaseDate: '' }
  });
  assert.deepEqual([c.projectName, c.organismAbbrev, c.strainAbbrev], ['FungiDB', 'tfakST-1', '$$strainAbbrev$$']);
  assert.equal(constantsFor(genomeManifest, 'tfakST-1', {}, { requiredOrganismConstants: { ploidy: /^\d+$/ } }).ploidy, '$$ploidy$$');
});

test('resolveEntry refuses an unresolved constant and a version that resolves to no date', () => {
  const c = constantsFor(genomeManifest, 'tfakST-1', GENOME_CONSTANTS);
  assert.throws(() => resolveEntry({ ...PRIMARY, name: '$$annotationSource$$' }, c),
    /fasta_primary_genome_sequence \$\$annotationSource\$\$: \$\$annotationSource\$\$ is not a known constant \(curated\/organism\.json, projectName, organismAbbrev, strainAbbrev, ncbiTaxonId, speciesNcbiTaxonId, or one the dataset type requires\)/);
  assert.throws(() => resolveEntry({ ...PRIMARY, version: '$$soTerm$$' }, c),
    /fasta_primary_genome_sequence \$\$genomeSource\$\$: version \$\$soTerm\$\$ resolves to "chromosome", not a date YYYY-MM-DD/);
  assert.throws(() => resolveEntry({ ...PRIMARY, version: '$$strainAbbrev$$' }, c), /resolves to "\$\$strainAbbrev\$\$", not a date/);
});

test('constantsOf reads curated/organism.json constants, and {} without them', (t) => {
  const dir = copyOf(t, 'GCA_000001.1');
  const record = join(dir, 'curated', 'organism.json');
  assert.deepEqual(constantsOf(dir), {});
  writeFileSync(record, JSON.stringify({ schemaVersion: 1 }));
  assert.deepEqual(constantsOf(dir), {});
  writeFileSync(record, JSON.stringify({ schemaVersion: 1, constants: GENOME_CONSTANTS }));
  assert.deepEqual(constantsOf(dir), GENOME_CONSTANTS);
  writeFileSync(record, JSON.stringify({ constants: { soTerm: 1 } }));
  assert.throws(() => constantsOf(dir), /constants must be an object of string values/);
  writeFileSync(record, JSON.stringify({ constants: { 'so term': 'x' } }));
  assert.throws(() => constantsOf(dir), /constants has an invalid name "so term"/);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/dataset-entries.test.js`
Expected: FAIL with `does not provide an export named 'constantsFor'` (or `constantsOf`/`resolveEntry`).

- [ ] **Step 3: Implement**

In `shared/scripts/dataset-types/_common.js` change the manifest import to:

```js
import { read as readManifest, projectOf, organismsOf } from '../lib/manifest.js';
```

and append after `onlyEntry`:

```js
export const ORGANISM_RECORD_FILENAME = 'organism.json';
/** Constants every organism file defines, so any entry may reference them. */
export const ORGANISM_FILE_CONSTANTS = ['projectName', 'organismAbbrev', 'strainAbbrev', 'ncbiTaxonId', 'speciesNcbiTaxonId'];
const CONSTANT_REF = /\$\$(\w+)\$\$/g;

/**
 * The entry with every $$constant$$ in name, version and props replaced from constants. Throws naming
 * the entry and the constant when one is unknown, or when the version does not resolve to a date.
 */
export function resolveEntry(entry, constants) {
  const fill = (value) => value.replace(CONSTANT_REF, (whole, key) => {
    if (!Object.hasOwn(constants, key)) {
      throw new Error(`${entryLabel(entry)}: ${whole} is not a known constant (curated/${ORGANISM_RECORD_FILENAME}, ${ORGANISM_FILE_CONSTANTS.join(', ')}, or one the dataset type requires)`);
    }
    return constants[key];
  });
  const resolved = {
    ...entry,
    name: fill(entry.name),
    version: fill(entry.version),
    props: Object.fromEntries(Object.entries(entry.props).map(([k, v]) => [k, fill(v)]))
  };
  if (!isDate(resolved.version)) throw new Error(`${entryLabel(entry)}: version ${entry.version} resolves to "${resolved.version}", not a date YYYY-MM-DD`);
  return resolved;
}

/**
 * What an entry's $$constants$$ resolve to for one organism: the proposal's own constants and the
 * organism's project and abbreviation. Constants every organism file defines, and those the type
 * requires at load, stay $$references$$: only the organism file knows them.
 */
export function constantsFor(manifest, organism, constants = {}, datasetType = {}) {
  const atLoad = [...ORGANISM_FILE_CONSTANTS, ...Object.keys(datasetType.requiredOrganismConstants ?? {})];
  return {
    ...Object.fromEntries(atLoad.map((k) => [k, `$$${k}$$`])),
    ...constants,
    projectName: projectOf(manifest, organism),
    organismAbbrev: organism
  };
}

/** The organism constants the proposal introduces: curated/organism.json "constants", or {}. */
export function constantsOf(proposalDir, { read = readLocal } = {}) {
  const path = join(proposalDir, 'curated', ORGANISM_RECORD_FILENAME);
  const text = read(path);
  if (text === null) return {};
  let record;
  try { record = JSON.parse(text); } catch (e) { throw new Error(`${path} is not valid JSON: ${e.message}`); }
  if (record?.constants === undefined) return {};
  const errors = stringMapErrors(record.constants, 'constants');
  if (errors.length) throw new Error(`Invalid ${path}:\n  - ${errors.join('\n  - ')}`);
  return record.constants;
}
```

In `shared/scripts/dataset-types/genome-assembly.js` add `ORGANISM_RECORD_FILENAME` to the `./_common.js` import list (after `ORGANISM_RECORD_KEYS`) and replace line 45

```js
export const ORGANISM_RECORD_FILENAME = 'organism.json';
```

with

```js
export { ORGANISM_RECORD_FILENAME };
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/dataset-entries.test.js tests/dataset-types.test.js tests/import-graph.test.js`
Expected: PASS

Run: `yarn test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add shared/scripts/dataset-types/_common.js shared/scripts/dataset-types/genome-assembly.js tests/dataset-entries.test.js
git commit -m "resolveEntry and organism.json constants

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Delivery locations from resolved entries

**Files:**
- Modify: `shared/scripts/lib/artifacts.js` (`deliveryLocation`)
- Modify: `shared/scripts/dataset-types/_common.js` (`entryDeliveries`; import `deliveryLocation`)
- Modify (interim, replaced in Tasks 11 and 12): `shared/scripts/lib/delivery-ops.js:96-99`, `shared/scripts/render-proposal.js:222`
- Test: `tests/dataset-entries.test.js`, `tests/artifacts.test.js`

- [ ] **Step 1: Write the failing tests**

In `tests/dataset-entries.test.js` replace the `_common.js` import with the one below and add the two imports after it:

```js
import {
  datasetsOf, onlyEntry, entriesLabel, readerOnRef, resolveEntry, constantsFor, constantsOf, entryDeliveries
} from '../shared/scripts/dataset-types/_common.js';
import { deliveryLocation } from '../shared/scripts/lib/artifacts.js';
import { readDatasetClass, CLASSES_RELATIVE_PATH } from '../shared/scripts/lib/dataset-classes.js';
```

Append:

```js
/** classOf over a scratch checkout holding the fixture classes.xml. */
function classesRepo(t) {
  const repo = mkdtempSync(join(tmpdir(), 'entries-classes-'));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  mkdirSync(join(repo, 'Model/lib/xml/datasetClass'), { recursive: true });
  cpSync(join(fixtures, 'classes.xml'), join(repo, CLASSES_RELATIVE_PATH));
  return (className) => readDatasetClass(repo, className);
}

test('deliveryLocation expands the class path from the organism and the resolved entry, and names an unfilled placeholder', (t) => {
  const classOf = classesRepo(t);
  const entry = resolveEntry(PRIMARY, constantsFor(genomeManifest, 'tfakST-1', GENOME_CONSTANTS));
  assert.deepEqual(deliveryLocation(genomeManifest, classOf('fasta_primary_genome_sequence'), 'tfakST-1', entry), {
    target: '@@manualDeliveryDir@@/FungiDB/tfakST-1/genome/chromosome_GenBank_fasta/2017-03-09/final/',
    relative: 'FungiDB/tfakST-1/genome/chromosome_GenBank_fasta/2017-03-09/final',
    file: null
  });
  const features = {
    datasetClass: 'NoPreprocess_primary_genome_features', name: 'GenBank', version: '2017-03-09',
    props: { ncbiTaxonId: '1', soTerm: 'chromosome', mapFile: 'x.xml' }, source: SERVER
  };
  assert.throws(() => deliveryLocation(genomeManifest, classOf('NoPreprocess_primary_genome_features'), 'tfakST-1', features),
    /NoPreprocess_primary_genome_features GenBank: No value for \$\{source\} in/);
});

test('entryDeliveries gives each organism every entry, in entry order', (t) => {
  const classOf = classesRepo(t);
  const products = { datasetClass: 'productNames', name: 'GenBank', version: '$$functAnnotVersion$$', props: {}, source: SERVER };
  const where = entryDeliveries(genomeManifest, [PRIMARY, products], { classOf, constants: GENOME_CONSTANTS });
  assert.deepEqual(where.map((w) => [w.label, w.organism, w.relative, w.file]), [
    ['fasta_primary_genome_sequence $$genomeSource$$', 'tfakST-1', 'FungiDB/tfakST-1/genome/chromosome_GenBank_fasta/2017-03-09/final', null],
    ['productNames GenBank', 'tfakST-1', 'FungiDB/tfakST-1/function/GenBank_product_names/2017-03-09/final', 'products.txt']
  ]);
  assert.equal(where[0].entry, PRIMARY);
});
```

In `tests/artifacts.test.js` add `import { onlyEntry } from '../shared/scripts/dataset-types/_common.js';` to the imports, and in `'the delivery location comes from the class unpack path'` change the call to:

```js
  const manifest = readJson(join(rnaDir, 'manifest.json'));
  assert.deepEqual(deliveryLocation(manifest, classDef, 'tfakST1', onlyEntry(rnaDir, manifest)), {
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/dataset-entries.test.js tests/artifacts.test.js`
Expected: FAIL. `entryDeliveries` is not exported, and the genome `deliveryLocation` throws `No value for ${soTerm}`: today's version fills placeholders from manifest identity only.

- [ ] **Step 3: Implement**

In `shared/scripts/lib/artifacts.js` replace the first three lines' imports with:

```js
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { expandPattern } from './dataset-classes.js';
import { projectOf } from './manifest.js';
```

and `deliveryLocation` with:

```js
/**
 * Where one resolved entry loads from for one organism, per classes.xml: the
 * @@manualDeliveryDir@@ target directory, the same directory relative to that
 * root for a local copy, and the one file the class reads from it (null for
 * the whole directory). Placeholders come from the entry and the organism.
 */
export function deliveryLocation(manifest, classDef, organism, entry) {
  const values = { ...entry.props, projectName: projectOf(manifest, organism), organismAbbrev: organism, name: entry.name, version: entry.version };
  let relative;
  try { relative = expandPattern(classDef.delivery.dir, values); }
  catch (e) { throw new Error(`${entry.datasetClass} ${entry.name}: ${e.message}`); }
  return { target: `${ROOT}${relative}/`, relative, file: classDef.delivery.file };
}
```

In `shared/scripts/dataset-types/_common.js` add `import { deliveryLocation } from '../lib/artifacts.js';` below the existing imports and append after `constantsOf`:

```js
/** Where every entry loads from for every organism: [{ entry, label, organism, target, relative, file }], organism by organism. */
export function entryDeliveries(manifest, entries, { classOf, constants = {}, datasetType = {} }) {
  return organismsOf(manifest).flatMap((organism) => entries.map((entry) => ({
    entry,
    label: entryLabel(entry),
    organism,
    ...deliveryLocation(manifest, classOf(entry.datasetClass), organism, resolveEntry(entry, constantsFor(manifest, organism, constants, datasetType)))
  })));
}
```

Interim callers (single-entry types only; Tasks 11 and 12 replace both):

In `shared/scripts/lib/delivery-ops.js` add `import { onlyEntry } from '../dataset-types/_common.js';` and replace

```js
      const parts = organismsOf(m).map((abbrev) => {
        const datasetName = datasetType.datasetNameFor(abbrev, m.name);
        return { abbrev, project: projectOf(m, abbrev), datasetName, delivery: deliveryLocation(m, classDef, abbrev) };
      });
```

with

```js
      const entry = onlyEntry(d, m);
      const parts = organismsOf(m).map((abbrev) => {
        const datasetName = datasetType.datasetNameFor(abbrev, entry.name);
        return { abbrev, project: projectOf(m, abbrev), datasetName, delivery: deliveryLocation(m, classDef, abbrev, entry) };
      });
```

In `shared/scripts/render-proposal.js` add `onlyEntry` to the `./dataset-types/_common.js` import and change

```js
      const { target, relative } = deliveryLocation(manifest, classDef, organism);
```

to

```js
      const { target, relative } = deliveryLocation(manifest, classDef, organism, onlyEntry(proposalDir, manifest));
```

(Single-entry entries have literal names and no constants, so passing them unresolved is exact here.)

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/dataset-entries.test.js tests/artifacts.test.js tests/delivery-ops.test.js tests/regression-goldens.test.js tests/import-graph.test.js`
Expected: PASS

Run: `yarn test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add shared/scripts/lib/artifacts.js shared/scripts/dataset-types/_common.js shared/scripts/lib/delivery-ops.js shared/scripts/render-proposal.js tests/dataset-entries.test.js tests/artifacts.test.js
git commit -m "Delivery locations from resolved dataset entries

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Types declare `datasetClasses`; `assertValidEntries`

**Files:**
- Modify: `shared/scripts/dataset-types/bulk-rnaseq.js:40`, `dnaseq.js:12`, `chipseq.js:11`, `genome-assembly.js` (after `requiredFields`)
- Modify: `shared/scripts/dataset-types/_common.js` (`validateDataset` message; `entryPropErrors`, `entryErrors`, `assertValidEntries`)
- Test: `tests/dataset-entries.test.js`, `tests/dataset-types.test.js:570`

- [ ] **Step 1: Write the failing tests**

In `tests/dataset-entries.test.js` replace the `_common.js` import with the one below and add the index import:

```js
import {
  datasetsOf, onlyEntry, entriesLabel, readerOnRef, resolveEntry, constantsFor, constantsOf, entryDeliveries, assertValidEntries
} from '../shared/scripts/dataset-types/_common.js';
import { DATASET_TYPES } from '../shared/scripts/dataset-types/index.js';
```

Append:

```js
const genome = DATASET_TYPES['genome-assembly'];
const rnaseq = DATASET_TYPES['bulk-rnaseq'];

/** A copy of genome GCA_000001.1 holding datasets, with constants in curated/organism.json. */
function genomeWith(t, datasets, constants = GENOME_CONSTANTS) {
  const dir = copyOf(t, 'GCA_000001.1');
  writeFileSync(join(dir, 'curated', 'datasets.json'), JSON.stringify({ schemaVersion: 2, datasets }, null, 2) + '\n');
  writeFileSync(join(dir, 'curated', 'organism.json'), JSON.stringify({ constants }, null, 2) + '\n');
  return dir;
}

test('every dataset type declares the classes its entries may hold', () => {
  assert.deepEqual(DATASET_TYPES['bulk-rnaseq'].datasetClasses, ['rnaSeqExperiment']);
  assert.deepEqual(DATASET_TYPES.dnaseq.datasetClasses, ['dnaseqExperiment']);
  assert.deepEqual(DATASET_TYPES.chipseq.datasetClasses, ['chipSeqExperiment']);
  for (const type of ['bulk-rnaseq', 'dnaseq', 'chipseq']) assert.equal(DATASET_TYPES[type].singleEntry, true, type);
  assert.equal(genome.singleEntry, undefined);
  assert.deepEqual(genome.datasetClasses, [
    'fasta_primary_genome_sequence', 'fasta_secondary_genome', 'fasta_organelle_genome',
    'NoPreprocess_primary_genome_features', 'NoPreprocess_secondary_genome_features', 'NoPreprocess_organelle_genome_features',
    'productNames', 'GeneOntologyAssociations', 'EnzymeCommissionAssociations', 'geneName', 'dbxref_synonym', 'comments', 'aliases', 'dbxref_simple'
  ]);
});

test('assertValidEntries returns valid entries', (t) => {
  const classOf = classesRepo(t);
  assert.deepEqual(assertValidEntries(genomeWith(t, [PRIMARY]), genomeManifest, genome, { classOf }), [PRIMARY]);
  assert.deepEqual(assertValidEntries(rnaDir, manifestOf(rnaDir), rnaseq, { classOf }), datasetsOf(rnaDir, manifestOf(rnaDir)));
  assert.deepEqual(assertValidEntries(genomeDir, genomeManifest, genome, { classOf }), []);
});

test('assertValidEntries refuses a class the type does not hold, and the wrong count for a single-entry type', (t) => {
  const classOf = classesRepo(t);
  const [rna] = datasetsOf(rnaDir, manifestOf(rnaDir));
  assert.deepEqual(problemsOf(() => assertValidEntries(genomeWith(t, [rna]), genomeManifest, genome, { classOf })),
    [`rnaSeqExperiment Doe_heat_shock_2024: genome-assembly proposals hold ${genome.datasetClasses.join(', ')}, not rnaSeqExperiment`]);
  const two = asV2(t, [rna, { ...rna, name: 'Doe_cold_shock_2024' }]);
  assert.deepEqual(problemsOf(() => assertValidEntries(two, manifestOf(two), rnaseq, { classOf })),
    ['bulk-rnaseq proposals hold exactly one dataset entry; this one has 2']);
  const none = asV2(t, []);
  assert.deepEqual(problemsOf(() => assertValidEntries(none, manifestOf(none), rnaseq, { classOf })),
    ['bulk-rnaseq proposals hold exactly one dataset entry; this one has 0']);
});

test('assertValidEntries refuses missing and extra props', (t) => {
  const classOf = classesRepo(t);
  const { sourceIdRegex, ...props } = PRIMARY.props;
  const dir = genomeWith(t, [{ ...PRIMARY, props: { ...props, colour: 'red', name: 'x' } }]);
  assert.deepEqual(problemsOf(() => assertValidEntries(dir, genomeManifest, genome, { classOf })), [
    'fasta_primary_genome_sequence $$genomeSource$$: props.sourceIdRegex is required by class fasta_primary_genome_sequence',
    'fasta_primary_genome_sequence $$genomeSource$$: props.colour is not a prop of class fasta_primary_genome_sequence',
    'fasta_primary_genome_sequence $$genomeSource$$: props.name comes from the entry and its organism and must not be set here'
  ]);
});

test('assertValidEntries refuses an unresolved constant and a version that resolves to no date', (t) => {
  const classOf = classesRepo(t);
  assert.deepEqual(problemsOf(() => assertValidEntries(genomeWith(t, [{ ...PRIMARY, name: '$$annotationSource$$' }]), genomeManifest, genome, { classOf })),
    ['fasta_primary_genome_sequence $$annotationSource$$: $$annotationSource$$ is not a known constant (curated/organism.json, projectName, organismAbbrev, strainAbbrev, ncbiTaxonId, speciesNcbiTaxonId, or one the dataset type requires)']);
  assert.deepEqual(problemsOf(() => assertValidEntries(genomeWith(t, [{ ...PRIMARY, version: '$$soTerm$$' }]), genomeManifest, genome, { classOf })),
    ['fasta_primary_genome_sequence $$genomeSource$$: version $$soTerm$$ resolves to "chromosome", not a date YYYY-MM-DD']);
});

test('assertValidEntries refuses an unfilled delivery placeholder and two entries delivering to one directory', (t) => {
  const classOf = classesRepo(t);
  const features = {
    datasetClass: 'NoPreprocess_primary_genome_features', name: '$$genomeSource$$', version: '$$genomeVersion$$',
    props: { ncbiTaxonId: '$$ncbiTaxonId$$', soTerm: '$$soTerm$$', mapFile: 'genemRNAExonCDS2Gus.xml' }, source: SERVER
  };
  const unfilled = problemsOf(() => assertValidEntries(genomeWith(t, [features]), genomeManifest, genome, { classOf }));
  assert.ok(unfilled.includes('NoPreprocess_primary_genome_features GenBank: No value for ${source} in "${projectName}/${organismAbbrev}/genome/${soTerm}_${source}_gff3/${version}/final"'), unfilled.join('\n'));
  const secondary = {
    datasetClass: 'fasta_secondary_genome', name: '$$genomeSource$$', version: '$$genomeVersion$$',
    props: { ncbiTaxonId: '$$ncbiTaxonId$$', table: 'DoTS::ExternalNASequence', soTerm: 'supercontig', sourceIdRegex: '^>(\\S+)' }, source: SERVER
  };
  assert.deepEqual(problemsOf(() => assertValidEntries(genomeWith(t, [secondary, { ...secondary, name: 'GenBank' }]), genomeManifest, genome, { classOf })),
    ['fasta_secondary_genome $$genomeSource$$ and fasta_secondary_genome GenBank both deliver to FungiDB/tfakST-1/genome/supercontig_GenBank_fasta/2017-03-09/final']);
});
```

In `tests/dataset-types.test.js` line 570 change the expected message to `['props.name comes from the entry and its organism and must not be set here']`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/dataset-entries.test.js tests/dataset-types.test.js`
Expected: FAIL. `assertValidEntries` is not exported, `datasetClasses` is undefined, and `validateDataset` still says "comes from the manifest".

- [ ] **Step 3: Implement**

`shared/scripts/dataset-types/bulk-rnaseq.js`, after line 40 (`export const datasetClass = 'rnaSeqExperiment';`):

```js
export const datasetClasses = [datasetClass];
export const singleEntry = true;
```

Same two lines after `export const datasetClass = …` in `dnaseq.js` (line 12) and `chipseq.js` (line 11).

`shared/scripts/dataset-types/genome-assembly.js`, after `export const requiredFields = [];`:

```js
/** The sequence, feature and functional classes a genome proposal's entries may hold; preprocessing writes them. */
export const datasetClasses = [
  'fasta_primary_genome_sequence', 'fasta_secondary_genome', 'fasta_organelle_genome',
  'NoPreprocess_primary_genome_features', 'NoPreprocess_secondary_genome_features', 'NoPreprocess_organelle_genome_features',
  'productNames', 'GeneOntologyAssociations', 'EnzymeCommissionAssociations', 'geneName', 'dbxref_synonym', 'comments', 'aliases', 'dbxref_simple'
];
```

`shared/scripts/dataset-types/_common.js`: in `validateDataset` change

```js
      if (IDENTITY_PROPS.includes(p)) errors.push(`props.${p} comes from the manifest and must not be set here`);
```

to

```js
      if (IDENTITY_PROPS.includes(p)) errors.push(identityPropError(p));
```

add above `validateDataset`:

```js
const identityPropError = (p) => `props.${p} comes from the entry and its organism and must not be set here`;
```

and append after `entryDeliveries`:

```js
/** An entry's props against its class: exactly the class's props but the identity ones, as strings, empty allowed. */
export function entryPropErrors(entry, classDef) {
  const expected = classDef.props.filter((p) => !IDENTITY_PROPS.includes(p));
  return [
    ...expected.filter((p) => typeof entry.props?.[p] !== 'string').map((p) => `props.${p} is required by class ${classDef.className}`),
    ...Object.keys(entry.props ?? {}).filter((p) => !expected.includes(p))
      .map((p) => (IDENTITY_PROPS.includes(p) ? identityPropError(p) : `props.${p} is not a prop of class ${classDef.className}`))
  ];
}

/**
 * Problems with well-shaped entries against the type, classes.xml and the constants: a class the type
 * does not hold, the wrong count for a single-entry type, props, constants, the resolved version, delivery
 * placeholders, and two entries delivering to one directory.
 */
export function entryErrors(entries, { manifest, datasetType, classOf, constants = {} }) {
  const allowed = datasetType.datasetClasses ?? [];
  const errors = [];
  if (datasetType.singleEntry && entries.length !== 1) {
    errors.push(`${manifest.datasetType} proposals hold exactly one dataset entry; this one has ${entries.length}`);
  }
  const deliveredBy = new Map();
  for (const e of entries) {
    const at = entryLabel(e);
    if (!allowed.includes(e.datasetClass)) {
      errors.push(`${at}: ${manifest.datasetType} proposals hold ${allowed.join(', ') || 'no dataset entries'}, not ${e.datasetClass}`);
      continue;
    }
    let classDef;
    try { classDef = classOf(e.datasetClass); } catch (err) { errors.push(`${at}: ${err.message}`); continue; }
    errors.push(...entryPropErrors(e, classDef).map((p) => `${at}: ${p}`));
    for (const organism of organismsOf(manifest)) {
      try {
        const { relative } = deliveryLocation(manifest, classDef, organism, resolveEntry(e, constantsFor(manifest, organism, constants, datasetType)));
        if (deliveredBy.has(relative)) errors.push(`${deliveredBy.get(relative)} and ${at} both deliver to ${relative}`);
        else deliveredBy.set(relative, at);
      } catch (err) {
        errors.push(err.message);
      }
    }
  }
  return [...new Set(errors)];
}

/**
 * The proposal's entries once valid in shape (datasetsOf) and against the type, classes.xml
 * (classOf(className) → classDef) and curated/organism.json constants; throws listing every problem.
 * Write, publish, load, mark-ready and prepare-delivery run it before changing anything.
 */
export function assertValidEntries(proposalDir, manifest, datasetType, { classOf, read = readLocal } = {}) {
  const entries = datasetsOf(proposalDir, manifest, { read });
  const errors = entryErrors(entries, { manifest, datasetType, classOf, constants: constantsOf(proposalDir, { read }) });
  if (errors.length) throw new Error(`Invalid dataset entries of ${manifest.accession}:\n  - ${errors.join('\n  - ')}`);
  return entries;
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/dataset-entries.test.js tests/dataset-types.test.js`
Expected: PASS

Run: `yarn test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add shared/scripts/dataset-types tests/dataset-entries.test.js tests/dataset-types.test.js
git commit -m "Types declare datasetClasses; assertValidEntries checks entries against them

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6b: Entry identity is the resolved datasetName

`(datasetClass, name)` does not identify an entry: a genome's supercontig and contig `fasta_secondary_genome` (and `NoPreprocess_secondary_genome_features`) entries are all named `$$genomeSource$$` and differ by `soTerm`. The loader's identity is the class's `datasetLoader datasetName` template, which `parseDatasetClass` already returns as `datasetNamePattern`. This task moves the duplicate check out of the shape-only `entriesErrors` into `assertValidEntries`, keyed on the resolved `datasetName` per organism, and folds in the Task 6 review follow-ups.

Labels: every `assertValidEntries` message names the entry by its unresolved `entryLabel` (`<datasetClass> <name>` as written). It exists for class and constant errors, which come before any `datasetName` can; it does not vary by organism; it is the text a curator finds in `datasets.json`; and `resolveEntry` and `renderEntry` already use it. The `datasetName` and delivery-directory messages add the resolved name or path. Before this task the placeholder message was the one exception: `deliveryLocation` labelled it with the resolved name (`… GenBank`).

**Files:**
- Modify: `shared/scripts/lib/artifacts.js` (`deliveryLocation`; new `datasetNameOf`)
- Modify: `shared/scripts/dataset-types/_common.js` (artifacts import; `entriesErrors`; new `entryForOrganism`; `entryDeliveries`; `entryErrors` → `entryTypeErrors`; `assertValidEntries`)
- Test: `tests/dataset-entries.test.js` (`tests/dataset-types.test.js` has no duplicate-name assertion)

- [ ] **Step 1: Write the failing tests**

In `tests/dataset-entries.test.js` change the artifacts import to

```js
import { deliveryLocation, datasetNameOf } from '../shared/scripts/lib/artifacts.js';
```

Replace the test `'datasetsOf refuses a (datasetClass, name) listed twice'` with

```js
test('datasetsOf leaves identity to assertValidEntries: a (datasetClass, name) may repeat', (t) => {
  const [entry] = datasetsOf(rnaDir, manifestOf(rnaDir));
  const twice = asV2(t, [entry, { ...entry, version: '2025-01-01' }]);
  assert.equal(datasetsOf(twice, manifestOf(twice)).length, 2);
});
```

In `'deliveryLocation expands the class path from the organism and the resolved entry, and names an unfilled placeholder'`, rename it `'deliveryLocation and datasetNameOf expand the class patterns from the organism and the resolved entry'`, add after the first `deepEqual`

```js
  assert.equal(datasetNameOf(genomeManifest, classOf('fasta_primary_genome_sequence'), 'tfakST-1', entry), 'tfakST-1_primary_genome_RSRC');
  assert.equal(datasetNameOf(genomeManifest, classOf('fasta_secondary_genome'), 'tfakST-1', { ...entry, props: { ...entry.props, soTerm: 'contig' } }),
    'tfakST-1_contig_GenBank_RSRC');
```

and change its last assertion's pattern to `/^No value for \$\{source\} in "/` (callers now add the label).

In `'entryDeliveries gives each organism every entry, in entry order'` append

```js
  assert.deepEqual(where.map((w) => w.datasetName), ['tfakST-1_primary_genome_RSRC', 'tfakST-1_function_GenBank_product_names_RSRC']);
```

Replace the test `'assertValidEntries refuses an unfilled delivery placeholder and two entries delivering to one directory'` with

```js
const secondary = (soTerm, name = '$$genomeSource$$') => ({
  datasetClass: 'fasta_secondary_genome', name, version: '$$genomeVersion$$',
  props: { ncbiTaxonId: '$$ncbiTaxonId$$', table: 'DoTS::ExternalNASequence', soTerm, sourceIdRegex: '^>(\\S+)' }, source: SERVER
});
const secondaryFeatures = (soTerm, name = '$$genomeSource$$') => ({
  datasetClass: 'NoPreprocess_secondary_genome_features', name, version: '$$genomeVersion$$',
  props: { ncbiTaxonId: '$$ncbiTaxonId$$', soTerm, mapFile: 'genemRNAExonCDS2Gus.xml' }, source: SERVER
});

test('assertValidEntries reports a missing prop once, without the placeholder errors it would cause', (t) => {
  const classOf = classesRepo(t);
  const features = {
    datasetClass: 'NoPreprocess_primary_genome_features', name: '$$genomeSource$$', version: '$$genomeVersion$$',
    props: { ncbiTaxonId: '$$ncbiTaxonId$$', soTerm: '$$soTerm$$', mapFile: 'genemRNAExonCDS2Gus.xml' }, source: SERVER
  };
  assert.deepEqual(problemsOf(() => assertValidEntries(genomeWith(t, [features]), genomeManifest, genome, { classOf })),
    ['NoPreprocess_primary_genome_features $$genomeSource$$: props.source is required by class NoPreprocess_primary_genome_features']);
});

test('assertValidEntries names an unfilled class placeholder by the entry as written', (t) => {
  const real = classesRepo(t);
  const classOf = (className) => ({ ...real(className), delivery: { dir: '${projectName}/${nope}/final', file: null } });
  assert.deepEqual(problemsOf(() => assertValidEntries(genomeWith(t, [PRIMARY]), genomeManifest, genome, { classOf })),
    ['fasta_primary_genome_sequence $$genomeSource$$: No value for ${nope} in "${projectName}/${nope}/final"']);
});

test('assertValidEntries names a class the type allows but classes.xml lacks', (t) => {
  const classOf = (className) => { throw new Error(`Dataset class "${className}" not found in ${CLASSES_RELATIVE_PATH}`); };
  assert.deepEqual(problemsOf(() => assertValidEntries(genomeWith(t, [PRIMARY]), genomeManifest, genome, { classOf })),
    ['fasta_primary_genome_sequence $$genomeSource$$: Dataset class "fasta_primary_genome_sequence" not found in Model/lib/xml/datasetClass/classes.xml']);
});

test('assertValidEntries needs classOf', (t) => {
  assert.throws(() => assertValidEntries(genomeWith(t, [PRIMARY]), genomeManifest, genome), { name: 'TypeError', message: /classOf/ });
});

test('entries named alike are distinct when their datasetNames differ: a supercontig and a contig secondary', (t) => {
  const classOf = classesRepo(t);
  const entries = [secondary('supercontig'), secondary('contig'), secondaryFeatures('supercontig'), secondaryFeatures('contig')];
  assert.deepEqual(assertValidEntries(genomeWith(t, entries), genomeManifest, genome, { classOf }), entries);
  assert.deepEqual(entryDeliveries(genomeManifest, entries, { classOf, constants: GENOME_CONSTANTS, datasetType: genome }).map((w) => w.datasetName), [
    'tfakST-1_supercontig_GenBank_RSRC', 'tfakST-1_contig_GenBank_RSRC', 'tfakST-1_supercontig_genome_features_RSRC', 'tfakST-1_contig_genome_features_RSRC'
  ]);
});

test('assertValidEntries refuses two entries resolving to one datasetName', (t) => {
  const classOf = classesRepo(t);
  const features = genomeWith(t, [secondaryFeatures('supercontig', 'GenBank'), secondaryFeatures('supercontig', 'RefSeq')]);
  assert.deepEqual(problemsOf(() => assertValidEntries(features, genomeManifest, genome, { classOf })),
    ['NoPreprocess_secondary_genome_features GenBank and NoPreprocess_secondary_genome_features RefSeq both load as tfakST-1_supercontig_genome_features_RSRC']);
  const sequences = genomeWith(t, [secondary('supercontig'), secondary('supercontig', 'GenBank')]);
  assert.deepEqual(problemsOf(() => assertValidEntries(sequences, genomeManifest, genome, { classOf })), [
    'fasta_secondary_genome $$genomeSource$$ and fasta_secondary_genome GenBank both load as tfakST-1_supercontig_GenBank_RSRC',
    'fasta_secondary_genome $$genomeSource$$ and fasta_secondary_genome GenBank both deliver to FungiDB/tfakST-1/genome/supercontig_GenBank_fasta/2017-03-09/final'
  ]);
});

test('assertValidEntries refuses two entries delivering to one directory under distinct datasetNames', (t) => {
  const classOf = classesRepo(t);
  const alias = (name, target) => ({
    datasetClass: 'aliases', name, version: '$$genomeVersion$$',
    props: { columnSpec: 'primary_identifier', url: '', urlUsesSecondaryId: 'false', target, idType: 'alias', viewName: 'Transcript' }, source: SERVER
  });
  assert.deepEqual(problemsOf(() => assertValidEntries(genomeWith(t, [alias('$$genomeSource$$', 'NAFeature'), alias('GenBank', 'AAFeature')]), genomeManifest, genome, { classOf })),
    ['aliases $$genomeSource$$ and aliases GenBank both deliver to FungiDB/tfakST-1/alias/GenBank/2017-03-09/final']);
});

test('every registered dataset type declares a non-empty datasetClasses array', () => {
  for (const [type, mod] of Object.entries(DATASET_TYPES)) {
    assert.ok(Array.isArray(mod.datasetClasses) && mod.datasetClasses.length > 0, type);
  }
});
```

(The `NoPreprocess_secondary_genome_features` template, `${organismAbbrev}_${soTerm}_genome_features_RSRC`, has no `name`, so the first pair differs only in name and delivery directory and is refused on `datasetName` alone.)

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/dataset-entries.test.js`
Expected: FAIL. `datasetNameOf` is not exported; `datasetsOf` still refuses the repeated `(datasetClass, name)`, so the supercontig/contig pair is refused too; the missing `source` prop also yields the placeholder error, labelled `… GenBank`; nothing refuses a shared `datasetName` when the delivery directories differ; a missing `classOf` gives a plain `TypeError` from calling `undefined`, not one naming `classOf`.

- [ ] **Step 3: Implement**

`shared/scripts/lib/artifacts.js`: replace `deliveryLocation` with

```js
/** What a class's patterns take from one organism and one resolved entry. */
const patternValues = (manifest, organism, entry) => ({
  ...entry.props, projectName: projectOf(manifest, organism), organismAbbrev: organism, name: entry.name, version: entry.version
});

/**
 * Where one resolved entry loads from for one organism, per classes.xml: the
 * @@manualDeliveryDir@@ target directory, the same directory relative to that
 * root for a local copy, and the one file the class reads from it (null for
 * the whole directory). An unfilled placeholder throws; callers name the entry.
 */
export function deliveryLocation(manifest, classDef, organism, entry) {
  const relative = expandPattern(classDef.delivery.dir, patternValues(manifest, organism, entry));
  return { target: `${ROOT}${relative}/`, relative, file: classDef.delivery.file };
}

/** The datasetLoader datasetName one resolved entry loads as for one organism: the entry's identity. */
export function datasetNameOf(manifest, classDef, organism, entry) {
  return expandPattern(classDef.datasetNamePattern, patternValues(manifest, organism, entry));
}
```

The interim callers in `render-proposal.js` and `delivery-ops.js` (replaced in Tasks 11 and 12) now get the bare `No value for …` message; no test pins it.

`shared/scripts/dataset-types/_common.js`:
- import: `import { deliveryLocation, datasetNameOf } from '../lib/artifacts.js';`
- `entriesErrors`: doc comment `/** Each entry's shape, before any class or constant is consulted. Identity (the resolved datasetName) needs classes.xml; assertValidEntries checks it. */`, and delete the `const seen = new Set();` loop after `entries.forEach(…)`.
- replace `entryDeliveries` with

```js
/**
 * One entry for one organism: resolved, with its datasetName (its identity) and delivery location.
 * resolveEntry names the entry in its own errors; an unfilled class placeholder is named here.
 */
export function entryForOrganism(manifest, entry, classDef, organism, { constants = {}, datasetType = {} } = {}) {
  const resolved = resolveEntry(entry, constantsFor(manifest, organism, constants, datasetType));
  try {
    return { resolved, datasetName: datasetNameOf(manifest, classDef, organism, resolved), ...deliveryLocation(manifest, classDef, organism, resolved) };
  } catch (err) {
    throw new Error(`${entryLabel(entry)}: ${err.message}`);
  }
}

/** Every entry for every organism: [{ entry, label, organism, datasetName, target, relative, file }], organism by organism. */
export function entryDeliveries(manifest, entries, { classOf, constants = {}, datasetType = {} }) {
  return organismsOf(manifest).flatMap((organism) => entries.map((entry) => {
    const { resolved, ...placed } = entryForOrganism(manifest, entry, classOf(entry.datasetClass), organism, { constants, datasetType });
    return { entry, label: entryLabel(entry), organism, ...placed };
  }));
}
```

- replace `entryErrors` (and its doc comment) with

```js
/**
 * Problems with well-shaped entries against the type, classes.xml and the constants: a class the type does
 * not hold or classes.xml lacks, the wrong count for a single-entry type, props; then, for an entry whose
 * props are right, constants, the resolved version, placeholders, and per organism two entries with one
 * datasetName or one delivery directory. Each message starts with the entry as written (entryLabel).
 */
export function entryTypeErrors(entries, { manifest, datasetType, classOf, constants = {} }) {
  if (typeof classOf !== 'function') throw new TypeError('entryTypeErrors needs classOf(className) → classDef');
  const errors = [];
  if (datasetType.singleEntry && entries.length !== 1) {
    errors.push(`${manifest.datasetType} proposals hold exactly one dataset entry; this one has ${entries.length}`);
  }
  const namedBy = new Map();
  const deliveredBy = new Map();
  for (const e of entries) {
    const at = entryLabel(e);
    if (!datasetType.datasetClasses.includes(e.datasetClass)) {
      errors.push(`${at}: ${manifest.datasetType} proposals hold ${datasetType.datasetClasses.join(', ')}, not ${e.datasetClass}`);
      continue;
    }
    let classDef;
    try { classDef = classOf(e.datasetClass); } catch (err) { errors.push(`${at}: ${err.message}`); continue; }
    const propErrors = entryPropErrors(e, classDef);
    if (propErrors.length) {
      errors.push(...propErrors.map((p) => `${at}: ${p}`));
      continue;
    }
    for (const organism of organismsOf(manifest)) {
      let placed;
      try { placed = entryForOrganism(manifest, e, classDef, organism, { constants, datasetType }); } catch (err) { errors.push(err.message); continue; }
      const { datasetName, relative } = placed;
      const named = `${organism} ${datasetName}`;
      if (namedBy.has(named)) errors.push(`${namedBy.get(named)} and ${at} both load as ${datasetName}`);
      else namedBy.set(named, at);
      if (deliveredBy.has(relative)) errors.push(`${deliveredBy.get(relative)} and ${at} both deliver to ${relative}`);
      else deliveredBy.set(relative, at);
    }
  }
  // A constant or placeholder error repeats for every organism.
  return [...new Set(errors)];
}
```

- in `assertValidEntries` call `entryTypeErrors` in place of `entryErrors`.

The `?? []` and `|| 'no dataset entries'` fallbacks go: the registry test pins that every type declares a non-empty `datasetClasses`.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/dataset-entries.test.js tests/artifacts.test.js tests/render-proposal.test.js tests/delivery-ops.test.js`
Expected: PASS

Run: `grep -rn "entryErrors\b" shared/scripts tests`
Expected: no output.

Run: `yarn test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add shared/scripts/lib/artifacts.js shared/scripts/dataset-types/_common.js tests/dataset-entries.test.js
git commit -m "Entry identity is the resolved datasetName; entryTypeErrors names entries as written

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Presenter names and type internals read the one entry

**Files:**
- Modify: `shared/scripts/dataset-types/_sra-experiment.js`, `dnaseq.js`, `chipseq.js`, `bulk-rnaseq.js` (all but `renderDataset`)
- Modify: `shared/scripts/dataset-types/bulk-rnaseq/validators/library-type.js:3,73`, `consistency.js:4,48`
- Test: `tests/dataset-types.test.js`, `tests/dataset-types-dnaseq.test.js:38-42`, `tests/dataset-types-chipseq.test.js:47-51`

- [ ] **Step 1: Write the failing tests**

In `tests/dataset-types.test.js` replace the test `'rnaseq refuses a manifest without identity'` with:

```js
test('rnaseq refuses a proposal without its one dataset entry', (t) => {
  const dir = copyOf(t, rnaDir);
  const manifestPath = join(dir, 'manifest.json');
  const { datasetClass, name, version, ...rest } = readJson(manifestPath);
  writeFileSync(manifestPath, JSON.stringify(rest));
  rmSync(join(dir, 'curated', 'dataset.json'));
  assert.throws(() => rnaseq.renderPresenter(dir, { build: '02' }), /Proposal PRJNA000002 needs exactly one dataset entry; it has 0/);
});

test('rnaseq names its presenter and its profile set from its dataset entry', (t) => {
  const dir = copyOf(t, rnaDir);
  const manifestPath = join(dir, 'manifest.json');
  const { datasetClass, name, version, ...rest } = readJson(manifestPath);
  const { props, source } = readJson(join(dir, 'curated', 'dataset.json'));
  writeFileSync(manifestPath, JSON.stringify(rest));
  rmSync(join(dir, 'curated', 'dataset.json'));
  writeFileSync(join(dir, 'curated', 'datasets.json'), JSON.stringify({ schemaVersion: 2, datasets: [{ datasetClass, name: 'Roe_heat_2024', version, props, source }] }));
  editJson(join(dir, 'curated', 'PRJNA000002_sample_annotations.json'), ({ profileSetName, ...a }) => a);
  assert.deepEqual(rnaseq.presenterNames(dir), ['tfakST1_Roe_heat_2024_rnaSeq_RSRC']);
  assert.match(rnaseq.renderPresenter(dir, { build: '02' }), /<datasetPresenter name="tfakST1_Roe_heat_2024_rnaSeq_RSRC"/);
  assert.match(rnaseq.deriveArtifacts(dir)['tfakST1/analysisConfig.xml'], /<property name="profileSetName" value="Roe_heat_2024 RNA-Seq"\/>/);
});
```

(`editJson` is defined at line ~507, below this test; function declarations hoist, so the reference works.)

In `tests/dataset-types-dnaseq.test.js` change the test `'dnaseq dataset name follows the classes.xml datasetLoader pattern'` to take `(t)` and its last line to:

```js
  assert.deepEqual(dnaseq.presenterNames(staged(t)), ['tfakST1_Doe_isolates_2025_dnaseqExperiment_RSRC']);
```

In `tests/dataset-types-chipseq.test.js` change `'chipseq dataset name follows the classes.xml datasetLoader pattern'` the same way:

```js
  assert.deepEqual(chipseq.presenterNames(staged(t)), ['tfakST1_Doe_histone_2025_chipSeq_RSRC']);
```

(The fixtures `PRJNA000010` and `PRJNA000011` carry manifest identity but no `curated/dataset.json`; `staged(t)` derives it, as write-proposal does.)

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/dataset-types.test.js`
Expected: FAIL. The no-entry test still gets `needs datasetClass "rnaSeqExperiment"`, and the presenter is still named from the manifest (`Doe_heat_shock_2024`).

- [ ] **Step 3: Implement**

`shared/scripts/dataset-types/_sra-experiment.js`:
- import line: `import { loadManifest, readInputJson, readCuratedJson, onlyEntry, assertCuratedAgreeWith } from './_common.js';`
- signature: `export function sraExperimentType({ type, datasetNameFor, extraColumns = [], stfAnnotations = (a) => a, extraChecks = () => [] }) {`
- `presenterNames`:

```js
  function presenterNames(proposalDir) {
    const m = loadManifest(proposalDir);
    return [datasetNameFor(organismOf(m), onlyEntry(proposalDir, m).name)];
  }
```

- delete the `requireIdentity(m, datasetClass);` lines in `deriveArtifacts` and `renderArtifacts`.

`shared/scripts/dataset-types/dnaseq.js`:
- import list: add `onlyEntry` after `readDataset,` (keep `requireIdentity` and `readDataset` until Task 8).
- `} = sraExperimentType({ type: 'dnaseq', datasetNameFor });`
- delete `requireIdentity(m, datasetClass);` in `derivePresenter` and `deriveDataset`.
- `renderPresenter`: replace `requireIdentity(m, datasetClass);` with `const { name } = onlyEntry(proposalDir, m);` and `datasetNameFor(organismOf(m), m.name)` with `datasetNameFor(organismOf(m), name)`.

`shared/scripts/dataset-types/chipseq.js`:
- delete line 1 (`import { existsSync } from 'node:fs';`).
- in the `./_common.js` import replace `datasetPath,` with `datasetsOf, onlyEntry,`.
- `const experimentTypeOf = (proposalDir) => datasetsOf(proposalDir, loadManifest(proposalDir))[0]?.props?.experimentType;`
- `type: 'chipseq', datasetNameFor, extraColumns: ['input'], stfAnnotations: withRole, extraChecks: pairingErrors` (drop `datasetClass,`).
- delete `requireIdentity(m, datasetClass);` in `derivePresenter` and `deriveDataset`.
- `renderPresenter`: replace `requireIdentity(m, datasetClass);` with `const entry = onlyEntry(proposalDir, m);`, the `hasCalledPeaks` line with `const hasCalledPeaks = String(PEAK_CALLING_TYPES.includes(entry.props.experimentType));`, and `datasetNameFor(organismOf(m), m.name)` with `datasetNameFor(organismOf(m), entry.name)`.

`shared/scripts/dataset-types/bulk-rnaseq.js`:
- in the `./_common.js` import add `onlyEntry,` after `readDataset,` (keep `requireIdentity`, `readDataset` until Task 8).
- line 87: `const nameFor = (name, organism) => datasetNameFor(organism, name);`
- `derivePresenter` and `deriveDataset`: delete `requireIdentity(m, datasetClass);`.
- line 174: ``const sharedNameFor = (name) => `${name}_rnaSeq_RSRC`;``
- `presenterNames`:

```js
export function presenterNames(proposalDir) {
  const m = loadManifest(proposalDir);
  const { name } = onlyEntry(proposalDir, m);
  return [m.organisms.length > 1 ? sharedNameFor(name) : nameFor(name, organismsOf(m)[0])];
}
```

- `renderPresenter`: replace `requireIdentity(m, datasetClass);` with `const { name } = onlyEntry(proposalDir, m);`; then `sharedNameFor(m)` → `sharedNameFor(name)`, `nameFor(m, settledNames[0])` → `nameFor(name, settledNames[0])`, `namePatternFor(m.name)` → `namePatternFor(name)`, `nameFor(m, settledNames[i])` → `nameFor(name, settledNames[i])`.
- `analysisConfig`: signature `function analysisConfig(annotations, name, isStrandSpecific, prefix) {` and ``const base = annotations.profileSetName || `${name} RNA-Seq`;``
- `deriveArtifacts`: replace the `requireIdentity` and `readDataset` lines with `const { name, props, source } = onlyEntry(proposalDir, m);` and the analysisConfig call with ``[`${p}/analysisConfig.xml`, analysisConfig(own, name, stranded, multi ? p : null)],``
- `checkCurated`: `const { props, source } = onlyEntry(proposalDir, m);`
- `renderArtifacts`: delete `requireIdentity(m, datasetClass);`.
- `stagingProblems`:

```js
export function stagingProblems(proposalDir) {
  const m = loadManifest(proposalDir);
  const { source } = onlyEntry(proposalDir, m);
  return source.type === 'server' && !m.staging?.length ? ['a server source needs its read files listed in manifest "staging"'] : [];
}
```

`shared/scripts/dataset-types/bulk-rnaseq/validators/library-type.js`: line 3 `import { readInputJson, onlyEntry } from '../../_common.js';`, line 73 `const { source } = onlyEntry(proposalDir, manifest);`

`shared/scripts/dataset-types/bulk-rnaseq/validators/consistency.js`: line 4 `import { readCuratedJson, onlyEntry } from '../../_common.js';`, line 48 `const sra = onlyEntry(proposalDir, manifest).source.type === 'sra';`

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/dataset-types.test.js tests/dataset-types-dnaseq.test.js tests/dataset-types-chipseq.test.js tests/sra-experiment.test.js tests/validators-bulk-rnaseq.test.js tests/artifacts.test.js tests/regression-goldens.test.js`
Expected: PASS

Run: `yarn test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add shared/scripts/dataset-types tests/dataset-types.test.js tests/dataset-types-dnaseq.test.js tests/dataset-types-chipseq.test.js
git commit -m "Presenter names, artifacts and sources read the one dataset entry

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: `renderDataset` per entry; `renderDatasets`

**Files:**
- Modify: `shared/scripts/dataset-types/_common.js` (`datasetElement`; `datasetRecordOf`, `renderEntry`, `renderDatasets`)
- Modify: `renderDataset` in `bulk-rnaseq.js`, `dnaseq.js`, `chipseq.js`
- Modify callers: `shared/scripts/lib/load-ops.js:382-383`, `shared/scripts/lib/proposal-ops.js:436`, `shared/scripts/render-proposal.js:216-218`
- Test: `tests/dataset-types.test.js:516-526,574-578`, `tests/dataset-types-dnaseq.test.js:79`, `tests/dataset-types-chipseq.test.js:88,133`, `tests/dataset-entries.test.js`

- [ ] **Step 1: Write the failing tests**

`tests/dataset-types.test.js`: add `onlyEntry` to the `_common.js` import on line 8, add below the `classDef` IIFE

```js
const entryOf = (dir) => onlyEntry(dir, readJson(join(dir, 'manifest.json')));
```

and change the four `renderDataset` calls:

```js
    assert.equal(rnaseq.renderDataset(proposal(acc), entryOf(proposal(acc)), classDef) + '\n', readFileSync(join(proposal(acc), 'expected-dataset.xml'), 'utf-8'));
```
```js
  const expected = rnaseq.renderDataset(dir, entryOf(dir), classDef);
  rmSync(join(dir, 'inputs'), { recursive: true });
  assert.equal(rnaseq.renderDataset(dir, entryOf(dir), classDef), expected);
```
```js
  assert.throws(() => rnaseq.renderDataset(dir, entryOf(dir), classDef), /props\.hasPairedEnds must be "true" or "false"\n  - props\.limitNU must be an integer from 1 to 30/);
```

`tests/dataset-types-dnaseq.test.js`: add `onlyEntry` to the `_common.js` import; line 79: `const dataset = dnaseq.renderDataset(dir, onlyEntry(dir, loadManifest(dir)), classDef);`

`tests/dataset-types-chipseq.test.js`: add `onlyEntry` to the `_common.js` import; line 88: `… chipseq.renderDataset(dir, onlyEntry(dir, loadManifest(dir)), classDef) + '\n');`; line 133: `assert.throws(() => chipseq.renderDataset(dir, onlyEntry(dir, loadManifest(dir)), classDef), …`

`tests/dataset-entries.test.js`: add `renderDatasets, renderEntry` to the `_common.js` import and append:

```js
test('renderDatasets renders every entry in order, and renderEntry checks a class without a type renderer', (t) => {
  const classOf = classesRepo(t);
  assert.equal(renderDatasets(rnaDir, manifestOf(rnaDir), rnaseq, classOf) + '\n', readFileSync(join(rnaDir, 'expected-dataset.xml'), 'utf-8'));
  const products = { datasetClass: 'productNames', name: 'GenBank', version: '$$functAnnotVersion$$', props: {}, source: SERVER };
  const dir = genomeWith(t, [products, { ...products, name: 'Sanger' }]);
  assert.equal(renderDatasets(dir, genomeManifest, genome, classOf), [
    '  <dataset class="productNames">',
    '    <prop name="projectName">$$projectName$$</prop>',
    '    <prop name="organismAbbrev">$$organismAbbrev$$</prop>',
    '    <prop name="name">GenBank</prop>',
    '    <prop name="version">$$functAnnotVersion$$</prop>',
    '  </dataset>',
    '',
    '  <dataset class="productNames">',
    '    <prop name="projectName">$$projectName$$</prop>',
    '    <prop name="organismAbbrev">$$organismAbbrev$$</prop>',
    '    <prop name="name">Sanger</prop>',
    '    <prop name="version">$$functAnnotVersion$$</prop>',
    '  </dataset>'
  ].join('\n'));
  assert.throws(() => renderEntry({ ...products, props: { colour: 'red' } }, classOf('productNames')),
    /Invalid dataset productNames GenBank:\n  - props\.colour is not a prop of class productNames/);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/dataset-types.test.js tests/dataset-types-dnaseq.test.js tests/dataset-types-chipseq.test.js tests/dataset-entries.test.js`
Expected: FAIL. The type `renderDataset` still reads `(proposalDir, classDef)` (the entry arrives as `classDef`, so `classDef.props` is undefined), and `renderDatasets` is not exported.

- [ ] **Step 3: Implement**

`shared/scripts/dataset-types/_common.js`: replace `datasetElement` with:

```js
/** What validateDataset checks: an entry's props and source, as dataset.json held them. */
export const datasetRecordOf = (entry) => ({ schemaVersion: DATASET_SCHEMA_VERSION, props: entry.props, source: entry.source });

/** A <dataset> element as organism files write them: the class's props in class order, project and organism as $$constants$$. */
export function datasetElement(entry, classDef) {
  const values = { projectName: '$$projectName$$', organismAbbrev: '$$organismAbbrev$$', name: entry.name, version: entry.version, ...entry.props };
  const lines = classDef.props.map((p) => `    <prop name="${escapeXml(p)}">${escapeXml(values[p])}</prop>`);
  return `  <dataset class="${escapeXml(classDef.className)}">\n${lines.join('\n')}\n  </dataset>`;
}

/** The <dataset> element of an entry whose type has no renderDataset of its own. */
export function renderEntry(entry, classDef) {
  const errors = entryPropErrors(entry, classDef);
  if (errors.length) throw new Error(`Invalid dataset ${entryLabel(entry)}:\n  - ${errors.join('\n  - ')}`);
  return datasetElement(entry, classDef);
}

/** Every entry's <dataset> element, in entry order, a blank line apart: what a load adds to each organism file. */
export function renderDatasets(proposalDir, manifest, datasetType, classOf) {
  const render = datasetType.renderDataset ?? ((dir, entry, classDef) => renderEntry(entry, classDef));
  return datasetsOf(proposalDir, manifest).map((entry) => render(proposalDir, entry, classOf(entry.datasetClass))).join('\n\n');
}
```

`bulk-rnaseq.js` — remove `requireIdentity,` and `readDataset,` from the `_common.js` import, add `datasetRecordOf, entryLabel,`, and replace `renderDataset` with:

```js
/** The <dataset> element for the organism file, from the entry only. */
export function renderDataset(proposalDir, entry, classDef) {
  const m = loadManifest(proposalDir);
  assertDataset(datasetRecordOf(entry), classDef, {}, `dataset ${entryLabel(entry)} of ${m.accession}`);
  return datasetElement(entry, classDef);
}
```

`dnaseq.js` — remove `requireIdentity, readDataset,` from the import, add `datasetRecordOf, entryLabel,`, and replace `renderDataset` with:

```js
export function renderDataset(proposalDir, entry, classDef) {
  const m = loadManifest(proposalDir);
  const where = `dataset ${entryLabel(entry)} of ${m.accession}`;
  if (entry.props?.ploidy !== '$$ploidy$$') throw new Error(`${where}: props.ploidy must be $$ploidy$$`);
  assertValidDataset(datasetRecordOf(entry), classDef, {}, where);
  return datasetElement(entry, classDef);
}
```

`chipseq.js` — remove `requireIdentity, readDataset,` from the import, add `datasetRecordOf, entryLabel,`, and replace `renderDataset` with:

```js
export function renderDataset(proposalDir, entry, classDef) {
  const m = loadManifest(proposalDir);
  const where = `dataset ${entryLabel(entry)} of ${m.accession}`;
  assertValidDataset(datasetRecordOf(entry), classDef, { optionalProps: OPTIONAL_PROPS }, where);
  if (!EXPERIMENT_TYPES.includes(entry.props.experimentType)) throw new Error(`${where}: experimentType must be one of ${EXPERIMENT_TYPES.join(', ')}`);
  for (const [k, v] of Object.entries(derivedProps(proposalDir, m))) {
    if (entry.props[k] !== v) throw new Error(`${where}: props.${k} must be ${v} (it is derived; re-run write-proposal.js)`);
  }
  return datasetElement(entry, classDef);
}
```

Callers:
- `shared/scripts/lib/load-ops.js`: add `import { renderDatasets } from '../dataset-types/_common.js';`; replace line 383 `const xml = datasetType.renderDataset(proposalDir, classDef);` with `const xml = renderDatasets(proposalDir, manifest, datasetType, (className) => readDatasetClass(repoPath, className));` (keep line 382's `classDef` until Task 10).
- `shared/scripts/lib/proposal-ops.js`: add `renderDatasets` to the `_common.js` import; replace line 436 `datasetType.renderDataset(staged, classDef);` with `renderDatasets(staged, full, datasetType, (className) => readDatasetClass(repoPath, className));`
- `shared/scripts/render-proposal.js`: add `renderDatasets` to the `_common.js` import; replace `process.stdout.write(datasetType.renderDataset(proposalDir, classDef) + '\n');` with `process.stdout.write(renderDatasets(proposalDir, manifest, datasetType, (className) => readDatasetClass(findRepoRoot(proposalDir), className)) + '\n');`

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/dataset-types.test.js tests/dataset-types-dnaseq.test.js tests/dataset-types-chipseq.test.js tests/dataset-entries.test.js tests/render-proposal.test.js tests/load-ops.test.js tests/regression-goldens.test.js`
Expected: PASS (all `expected-dataset.xml` comparisons unchanged)

Run: `yarn test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add shared/scripts tests/dataset-types.test.js tests/dataset-types-dnaseq.test.js tests/dataset-types-chipseq.test.js tests/dataset-entries.test.js
git commit -m "renderDataset renders one entry; renderDatasets renders them all

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Clash checks per entry, sibling proposals included

An entry clashes with a dataset already in an organism file, or with a sibling proposal's entry, when they share a `datasetName` (Task 6b), not merely a `(datasetClass, name)`. The other side's `$$constants$$` cannot be resolved here, so `sameDatasetName` compares the values the class's `datasetNamePattern` uses, as written. For the single-entry types that is `name` alone, so their checks and messages do not change; a genome's supercontig entry no longer clashes with a contig one of the same name.

**Files:**
- Modify: `shared/scripts/lib/dataset-classes.js` (new `sameDatasetName`)
- Modify: `shared/scripts/lib/dataset-file.js` (new `entryDatasetExists`)
- Modify: `shared/scripts/lib/proposal-ops.js` (`patternMatchWith`, `assertNameIsFree` → `assertNamesAreFree`, the `writeProposal` call site)
- Modify: `shared/scripts/lib/build-fitness.js`
- Modify: `shared/scripts/lib/load-ops.js` (`renderAndCheck`, the name check in `renderDatasetParts`)
- Test: `tests/dataset-file.test.js`, `tests/proposal-ops.test.js`, `tests/build-fitness.test.js`

- [ ] **Step 1: Write the failing tests**

`tests/dataset-file.test.js`: add `entryDatasetExists` to the `dataset-file.js` import, add `import { parseDatasetClass } from '../shared/scripts/lib/dataset-classes.js';`, and append

```js
test('entryDatasetExists compares the values the class datasetName uses, as written, not (class, name)', () => {
  const classes = readFileSync(new URL('./fixtures/classes.xml', import.meta.url), 'utf-8');
  const secondary = parseDatasetClass(classes, 'fasta_secondary_genome');
  const file = '<datasets>\n  <dataset class="fasta_secondary_genome">\n    <prop name="name">$$genomeSource$$</prop>\n    <prop name="soTerm">contig</prop>\n  </dataset>\n</datasets>\n';
  const entry = (soTerm) => ({ datasetClass: 'fasta_secondary_genome', name: '$$genomeSource$$', version: '$$genomeVersion$$', props: { soTerm } });
  assert.equal(entryDatasetExists(file, secondary, entry('contig')), true);
  assert.equal(entryDatasetExists(file, secondary, entry('supercontig')), false);
  const rna = parseDatasetClass(classes, 'rnaSeqExperiment');
  assert.equal(entryDatasetExists(organismFile, rna, { name: 'Existing_2020', props: {} }), true);
  assert.equal(entryDatasetExists(organismFile, rna, { name: 'Existing_2021', props: {} }), false);
});
```

`tests/proposal-ops.test.js`: replace `plantProposalOnMaster` with

```js
/**
 * Commits a proposal for accession onto master in `repo` and pushes it. The manifest's datasetClass,
 * name and version become its one entry in curated/datasets.json, unless datasets gives its entries.
 */
function plantProposalOnMaster(repo, manifest, accession = manifest.accession, datasets) {
  const { datasetClass, name, version, ...rest } = manifest;
  const dir = join(repo, 'Proposals', accession);
  mkdirSync(join(dir, 'curated'), { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(rest, null, 2) + '\n');
  const entries = datasets ?? (datasetClass ? [{ datasetClass, name, version, props: {}, source: { type: 'sra' } }] : null);
  if (entries) writeFileSync(join(dir, 'curated', 'datasets.json'), JSON.stringify({ schemaVersion: 2, datasets: entries }, null, 2) + '\n');
  execFileSync('git', ['-C', repo, 'add', '.']);
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', `plant ${accession}`]);
  execFileSync('git', ['-C', repo, 'push', '-q']);
}
```

and append after `'writeProposal refuses a name another proposal on master uses for one of its additional organisms'`:

```js
test('writeProposal refuses a name a proposal on master in the old shape uses', async () => {
  const { repo, root } = setupRepo();
  const dir = join(repo, 'Proposals', 'PRJNA000009');
  mkdirSync(join(dir, 'curated'), { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ ...plantedManifest, accession: 'PRJNA000009', datasetType: 'bulk-rnaseq', organisms: loaded('tfakST1'),
    datasetClass: 'rnaSeqExperiment', name: 'Doe_cold_shock_2024', version: '2024-05-01' }, null, 2) + '\n');
  cpSync(join(fixtures, 'proposals/PRJNA000002/curated/dataset.json'), join(dir, 'curated', 'dataset.json'));
  execFileSync('git', ['-C', repo, 'add', '.']);
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'plant PRJNA000009 in the old shape']);
  execFileSync('git', ['-C', repo, 'push', '-q']);
  const git = createGit(repo);
  await startProposal({ git, ticket: stubTicket(), accession: 'PRJNA000003', datasetType: 'bulk-rnaseq' });
  await assert.rejects(writeProposal({
    rebuildBranch: REBUILD, git, repoPath: repo, manifestInput: rnaManifestInput, curator: 'someone@apidb.org', ...rnaFiles(root, coldShock)
  }), /Proposal PRJNA000009 on master already uses the name "Doe_cold_shock_2024" for tfakST1/);
});

test('writeProposal checks every entry of a proposal on master', async () => {
  const { repo, root } = setupRepo();
  const entry = (datasetClass) => ({ datasetClass, name: 'Doe_cold_shock_2024', version: '2024-05-01', props: {}, source: { type: 'sra' } });
  plantProposalOnMaster(repo, { ...plantedManifest, accession: 'PRJNA000009', datasetType: 'bulk-rnaseq', organisms: loaded('tfakST1') }, 'PRJNA000009',
    [entry('chipSeqExperiment'), entry('rnaSeqExperiment')]);
  const git = createGit(repo);
  await startProposal({ git, ticket: stubTicket(), accession: 'PRJNA000003', datasetType: 'bulk-rnaseq' });
  await assert.rejects(writeProposal({
    rebuildBranch: REBUILD, git, repoPath: repo, manifestInput: rnaManifestInput, curator: 'someone@apidb.org', ...rnaFiles(root, coldShock)
  }), /Proposal PRJNA000009 on master already uses the name "Doe_cold_shock_2024" for tfakST1/);
});
```

`tests/build-fitness.test.js`: add `rmSync` to the `node:fs` import. Replace the test `'buildFitness sends a genome organism stop to --settle at load'` with

```js
test('buildFitness sends a genome organism stop to --settle at load', async () => {
  const ctx = setup();
  const { datasetClass, name, version, ...rest } = ctx.manifest;
  rmSync(join(ctx.proposalDir, 'curated', 'dataset.json'));
  ctx.manifest = { ...rest, datasetType: 'genome-assembly', organisms: [{ proposedOrganismAbbrev: 'nobody1', source: 'loaded', project: 'FungiDB' }] };
  const findings = await buildFitness({ ...ctx, against: 'origin/rebuild02' });
  assert.match(findings[0].message, /needs a person's --settle at load\)$/);
});
```

and append

```js
test('buildFitness reports an entry name the organism file already has', async () => {
  const ctx = setup();
  const { datasetClass, name, version, ...manifest } = ctx.manifest;
  const { props, source } = JSON.parse(readFileSync(join(ctx.proposalDir, 'curated', 'dataset.json'), 'utf-8'));
  rmSync(join(ctx.proposalDir, 'curated', 'dataset.json'));
  writeFileSync(join(ctx.proposalDir, 'curated', 'datasets.json'),
    JSON.stringify({ schemaVersion: 2, datasets: [{ datasetClass, name: 'Existing_2020', version, props, source }] }));
  writeFileSync(join(ctx.proposalDir, 'manifest.json'), JSON.stringify(manifest));
  const findings = await buildFitness({ ...ctx, manifest, against: 'origin/rebuild02' });
  assert.deepEqual(findings.map((f) => f.message),
    ['Datasets/lib/xml/datasets/FungiDB/tfakST1.xml on origin/rebuild02 already has a rnaSeqExperiment named "Existing_2020"']);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/dataset-file.test.js tests/proposal-ops.test.js tests/build-fitness.test.js`
Expected: FAIL. `entryDatasetExists` is not exported. Siblings are still compared by manifest `datasetClass`/`name`, so v2 siblings (every planted one now) are invisible. `buildFitness` still reads `manifest.name`, which is undefined for the v2 proposal, and the genome test now gets `prepare-delivery` because the bulk-rnaseq `datasetClass` gate does not look at entries.

- [ ] **Step 3: Implement**

`shared/scripts/lib/dataset-classes.js`, append:

```js
const ORGANISM_PLACEHOLDERS = ['projectName', 'organismAbbrev'];

/**
 * Whether two entries of classDef's class get one datasetName in one organism. Each is { name, version, props },
 * an entry or an organism file's <dataset>; the values its datasetNamePattern uses are compared as written.
 */
export function sameDatasetName(classDef, a, b) {
  const valueOf = (e, p) => (p === 'name' || p === 'version' ? e[p] : e.props?.[p]);
  return [...classDef.datasetNamePattern.matchAll(/\$\{(\w+)\}/g)].map((m) => m[1])
    .filter((p) => !ORGANISM_PLACEHOLDERS.includes(p))
    .every((p) => valueOf(a, p) === valueOf(b, p));
}
```

`shared/scripts/lib/dataset-file.js`: add `import { sameDatasetName } from './dataset-classes.js';` and, after `datasetNameExists` (which `datasetsMatching` keeps using), add:

```js
/**
 * Whether the organism file already has a dataset with the entry's datasetName: one of classDef's class
 * whose props match the entry's on the values the datasetName uses. Regex scan, so commented-out datasets count.
 */
export function entryDatasetExists(fileContent, classDef, entry) {
  for (const [, cls, body] of fileContent.matchAll(/<dataset\s+class="([^"]+)"[^>]*>([\s\S]*?)<\/dataset>/g)) {
    if (cls !== classDef.className) continue;
    const props = Object.fromEntries([...body.matchAll(/<prop\s+name="([^"]+)">\s*([^<]*?)\s*<\/prop>/g)].map(([, k, v]) => [k, v]));
    if (sameDatasetName(classDef, { name: props.name, version: props.version, props }, entry)) return true;
  }
  return false;
}
```

`shared/scripts/lib/proposal-ops.js`: add `datasetsOf, readerOnRef` to the `_common.js` import, `entryDatasetExists` to the `./dataset-file.js` import (drop `datasetNameExists` if nothing else uses it), and `sameDatasetName` to the `./dataset-classes.js` import, then replace `patternMatchWith` and `assertNameIsFree` with:

```js
/** Another proposal's entries on ref; [] when they cannot be read, as other proposals are not validated here. */
function entriesOn(git, ref, proposalId, manifest) {
  try { return datasetsOf(proposalRelativePath(proposalId), manifest, { read: readerOnRef(git, ref) }); }
  catch { return []; }
}

/** How one dataset's multi-organism datasetNamePattern would match the other's datasets, or null. Each side is { name, organisms }. */
function patternMatchWith(type, ours, theirs) {
  const datasets = ({ organisms, name }) => organisms.map((o) => type.datasetNameFor(o, name));
  if (ours.organisms.length > 1) {
    const pattern = type.namePatternFor(ours.name);
    const hit = datasets(theirs).find((d) => likeToRegExp(pattern).test(d));
    if (hit) return `names a dataset ${hit}, which this proposal's datasetNamePattern "${pattern}" would also match`;
  }
  if (theirs.organisms.length > 1) {
    const pattern = type.namePatternFor(theirs.name);
    const hit = datasets(ours).find((d) => likeToRegExp(pattern).test(d));
    if (hit) return `is multi-organism, and its datasetNamePattern "${pattern}" would also match this proposal's dataset ${hit}`;
  }
  return null;
}

/**
 * Each entry's datasetName must be new for each loaded organism, in its file on the rebuild branch, and
 * not used by an entry of the same class in another proposal on master that shares an organism
 * (sameDatasetName; classOf(className) → classDef). For a type whose multi-organism presenter claims
 * datasets by datasetNamePattern (usesNamePattern), no pattern on either side may match the other's datasets.
 */
function assertNamesAreFree(git, rebuildRef, m, entries, type, proposalId, classOf) {
  const organisms = organismsOf(m);
  for (const e of entries) {
    const classDef = classOf(e.datasetClass);
    for (const o of m.organisms.filter((x) => x.source === 'loaded')) {
      const relFile = datasetFileRelativePath(o.project, o.proposedOrganismAbbrev);
      if (entryDatasetExists(git.showFile(rebuildRef, relFile), classDef, e)) {
        throw new Error(`${relFile} on ${rebuildRef} already has a ${e.datasetClass} named "${e.name}"; ${CHOOSE_NAME}`);
      }
    }
    const clash = namePatternClash(git, rebuildRef, type, { className: e.datasetClass, name: e.name, organisms });
    if (clash) throw new Error(`${clash}; ${CHOOSE_NAME}`);
  }
  for (const other of git.listDir('origin/master', PROPOSALS_DIR)) {
    if (other === proposalId) continue;
    const theirs = manifestOn(git, 'origin/master', other);
    if (!theirs) continue;
    const theirOrganisms = organismsIn(theirs);
    for (const t of entriesOn(git, 'origin/master', other, theirs)) {
      for (const e of entries.filter((x) => x.datasetClass === t.datasetClass)) {
        const shared = sameDatasetName(classOf(e.datasetClass), e, t) && organisms.find((organism) => theirOrganisms.includes(organism));
        if (shared) throw new Error(`Proposal ${other} on master already uses the name "${e.name}" for ${shared}; ${CHOOSE_NAME}`);
        const across = usesNamePattern(type) && patternMatchWith(type, { name: e.name, organisms }, { name: t.name, organisms: theirOrganisms });
        if (across) throw new Error(`Proposal ${other} on master ${across}; ${CHOOSE_NAME}`);
      }
    }
  }
}
```

In `writeProposal`, replace

```js
    const full = inManifestOrder({ ...manifest, ...identityFor(datasetType, staged, manifest, overrideValues, repoPath) });
```

with

```js
    const identity = identityFor(datasetType, staged, manifest, overrideValues, repoPath);
    const full = inManifestOrder({ ...manifest, ...identity });
```

and `assertNameIsFree(git, rebuildRef, full, datasetType, proposalId);` with `assertNamesAreFree(git, rebuildRef, full, [identity], datasetType, proposalId, (className) => readDatasetClass(repoPath, className));`. `identity` has no `props` yet; the single-entry templates use only `organismAbbrev` and `name`, so `sameDatasetName` needs none.

The messages keep naming the entry as `a <datasetClass> named "<name>"`, so the existing tests keep their exact text. For a genome entry that clashed on, say, `soTerm` too, the message names the class and name; the clash is on the full `datasetName`.

`shared/scripts/lib/build-fitness.js`: add `import { datasetsOf } from '../dataset-types/_common.js';` and `import { readDatasetClassOnRef } from './dataset-classes.js';`, replace `datasetNameExists` with `entryDatasetExists` in the `./dataset-file.js` import, and replace the body of `buildFitness` from `const where = …` to the end of the `if` block with:

```js
  const entries = datasetsOf(proposalDir, manifest);
  const where = entries.length ? 'prepare-delivery' : 'load';
  stops.forEach((stop) => findings.push({ validator: NAME, severity: 'warning', message: `${stop} (needs a person's --settle at ${where})` }));
  if (stops.length) return findings;

  const names = await withSettledProposal(proposalDir, manifest, organisms, async (dir) => datasetType.presenterNames(dir));
  const presenters = presenterFileRelativePath(homeProject(manifest));
  if (!git.fileExistsOnRef(against, presenters)) error(`${presenters} is missing on ${against}`);
  else {
    const file = git.showFile(against, presenters);
    for (const name of names) if (presenterNameExists(file, name)) error(`Presenter "${name}" already exists in ${presenters} on ${against}`);
  }
  if (entries.length) {
    const abbrevs = organisms.map((o) => o.abbrev);
    manifest.organisms.forEach((o, i) => {
      const rel = datasetFileRelativePath(o.project, abbrevs[i]);
      if (!git.fileExistsOnRef(against, rel)) { error(`${rel} is missing on ${against}`); return; }
      const file = git.showFile(against, rel);
      for (const e of entries) {
        if (entryDatasetExists(file, readDatasetClassOnRef(git, against, e.datasetClass), e)) error(`${rel} on ${against} already has a ${e.datasetClass} named "${e.name}"`);
      }
    });
    for (const e of entries) {
      const clash = namePatternClash(git, against, datasetType, { className: e.datasetClass, name: e.name, organisms: abbrevs });
      if (clash) error(clash);
    }
  }
  return findings;
```

Update its doc comment: "…the presenter name and every dataset entry's name are free, and each organism's dataset file exists…".

`shared/scripts/lib/load-ops.js`: add `datasetsOf` to the `_common.js` import and `entryDatasetExists` to the `./dataset-file.js` import. In `renderAndCheck` replace

```js
    const clash = namePatternClash(git, 'HEAD', datasetType, { className: m.datasetClass, name: m.name, organisms: organismsOf(m) });
    if (clash) throw new Error(`${clash}. Request a revision so the curator chooses another "name" in --overrides.`);
```

with

```js
    for (const e of datasetsOf(dir, m)) {
      const clash = namePatternClash(git, 'HEAD', datasetType, { className: e.datasetClass, name: e.name, organisms: organismsOf(m) });
      if (clash) throw new Error(`${clash}. Request a revision so the curator chooses another "name" in --overrides.`);
    }
```

and in `renderDatasetParts` replace

```js
      if (datasetNameExists(datasetFile, classDef.className, manifest.name)) {
        throw new Error(`${relFile} already has a ${classDef.className} named "${manifest.name}". It may already be loaded; ask before continuing.`);
      }
```

with

```js
      const taken = datasetsOf(proposalDir, manifest).find((e) => entryDatasetExists(datasetFile, readDatasetClass(repoPath, e.datasetClass), e));
      if (taken) throw new Error(`${relFile} already has a ${taken.datasetClass} named "${taken.name}". It may already be loaded; ask before continuing.`);
```

(`datasetNameExists` stays imported in `load-ops.js` only if something else there still uses it.)

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/dataset-file.test.js tests/proposal-ops.test.js tests/build-fitness.test.js tests/load-ops.test.js`
Expected: PASS (the existing sibling, pattern and organism-file clash tests keep their exact messages)

Run: `yarn test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add shared/scripts/lib/dataset-classes.js shared/scripts/lib/dataset-file.js shared/scripts/lib/proposal-ops.js shared/scripts/lib/build-fitness.js shared/scripts/lib/load-ops.js tests/dataset-file.test.js tests/proposal-ops.test.js tests/build-fitness.test.js
git commit -m "Name clash checks per dataset entry by datasetName, sibling proposals included

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Load renders and commits every entry

**Files:**
- Modify: `shared/scripts/lib/load-ops.js` (`recordedDelivery`, `checkLoadPreconditions`, `datasetOrganismsFromCommit`, `assertSettledAsCommitted`, `renderDatasetParts`, `loadProposal`; new `loadConstants`)
- Modify: `shared/scripts/load-proposal.js:61`
- Test: `tests/load-ops.test.js`

- [ ] **Step 1: Write the failing tests**

In `tests/load-ops.test.js` add `loadConstants` to the `load-ops.js` import and append:

```js
test('loadConstants requires and gives the proposal\'s constants, the type\'s required ones and a loader\'s values on top', () => {
  const { required, given } = loadConstants({ requiredOrganismConstants: { ploidy: /^[1-9]\d*$/ } }, { genomeVersion: '2017-03-09' }, { ploidy: '1' });
  assert.deepEqual(Object.keys(required), ['ploidy', 'genomeVersion']);
  assert.equal(required.genomeVersion.test('2017-03-09'), true);
  assert.equal(required.genomeVersion.test('a"b'), false);
  assert.deepEqual(given, { genomeVersion: '2017-03-09', ploidy: '1' });
  assert.deepEqual(loadConstants({}, {}), { required: {}, given: {} });
});

test('a load refuses invalid dataset entries before content validation or any change', async () => {
  const { repo } = rnaOnRebuild();
  editOnMaster(repo, () => {
    const path = join(repo, 'Proposals/PRJNA000002/curated/dataset.json');
    const d = JSON.parse(readFileSync(path, 'utf-8'));
    writeFileSync(path, JSON.stringify({ ...d, props: { ...d.props, colour: 'red' } }, null, 2) + '\n');
  }, 'PRJNA000002 with a stray prop');
  let validated = false;
  const git = createGit(repo);
  await assert.rejects(loadProposal({
    git, ticket: recorded(repo), repoPath: repo, rebuildBranch: REBUILD, proposalId: 'PRJNA000002', dryRun: true,
    validate: async () => { validated = true; return []; }
  }), /Invalid dataset entries of PRJNA000002:\n  - rnaSeqExperiment Doe_heat_shock_2024: props\.colour is not a prop of class rnaSeqExperiment/);
  assert.equal(validated, false);
  assert.equal(git.branchExists('load/PRJNA000002'), false);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/load-ops.test.js`
Expected: FAIL. `loadConstants` is not exported, and the stray prop is first caught by `renderDataset` after `validate` has run, with an `Invalid dataset rnaSeqExperiment …` message.

- [ ] **Step 3: Implement**

In `shared/scripts/lib/load-ops.js` extend the `_common.js` import to

```js
import { renderDatasets, datasetsOf, readerOnRef, constantsOf, assertValidEntries, entriesLabel } from '../dataset-types/_common.js';
```

`recordedDelivery`: replace its first two lines with

```js
  if (!datasetsOf(relDir, manifest, { read: readerOnRef(git, 'origin/master') }).length) return null;
```

and in its doc comment and in `checkLoadPreconditions`'s and `settledAsRecorded`'s doc comments replace "a type with a dataset class" with "a proposal with dataset entries" and "a type without one" / "a type with no dataset class" with "one without".

`checkLoadPreconditions`: replace the `withProposalFromRef` call with

```js
  const rendered = await withProposalFromRef(git, 'origin/master', relDir, async (dir) => {
    const datasetType = await loadDatasetType(manifest.datasetType);
    assertValidEntries(dir, manifest, datasetType, { classOf: (className) => readDatasetClass(repoPath, className) });
    await assertValidContent(validate, dir, manifest, proposalId);
    return renderAndCheck(git, manifest, dir, presenterPath, repoPath, build, settled, organismConstants);
  });
```

Replace `datasetOrganismsFromCommit` with

```js
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The organisms the load commit added the dataset entries to, or null; label is entriesLabel of the entries. */
function datasetOrganismsFromCommit(subject, label) {
  return new RegExp(`, ${escapeRegExp(label)} to (.+)$`).exec(subject)?.[1].split(' ') ?? null;
}
```

and in `assertSettledAsCommitted` replace `const committedOrganisms = datasetOrganismsFromCommit(subject, manifest.name);` with

```js
  const label = entriesLabel(datasetsOf(relDir, manifest, { read: readerOnRef(git, 'origin/master') }));
  const committedOrganisms = datasetOrganismsFromCommit(subject, label);
```

Replace `renderDatasetParts` and its doc comment with

```js
/**
 * Every entry's <dataset> element (the same for every organism) and each organism's file. check refuses
 * a missing organism file or a datasetName it already has, and adds the constants the entries reference.
 */
async function renderDatasetParts(manifest, proposalDir, repoPath, { check, organismConstants = {} }) {
  const datasetType = await loadDatasetType(manifest.datasetType);
  const entries = datasetsOf(proposalDir, manifest);
  if (!entries.length) return { dataset: null };
  const classOf = (className) => readDatasetClass(repoPath, className);
  const xml = renderDatasets(proposalDir, manifest, datasetType, classOf);
  const proposalConstants = constantsOf(proposalDir);
  const organisms = organismsOf(manifest).map((organism) => {
    const project = projectOf(manifest, organism);
    const relFile = datasetFileRelativePath(project, organism);
    let datasetFile = null;
    let constantsAdded = [];
    if (check) {
      const path = datasetFilePath(repoPath, project, organism);
      if (!existsSync(path)) throw new Error(`Dataset file missing: ${relFile}. Is ${organism} a ${project} organism on this build?`);
      datasetFile = readFileSync(path, 'utf-8');
      const taken = entries.find((e) => entryDatasetExists(datasetFile, classOf(e.datasetClass), e));
      if (taken) throw new Error(`${relFile} already has a ${taken.datasetClass} named "${taken.name}". It may already be loaded; ask before continuing.`);
      const { required, given } = loadConstants(datasetType, proposalConstants, organismConstants[organism]);
      const constants = withOrganismConstants(datasetFile, required, given, organism);
      datasetFile = constants.content;
      constantsAdded = constants.added;
    }
    return { organism, relFile, datasetFile, constantsAdded };
  });
  return { dataset: { xml, entries, organisms } };
}

/** Any non-empty value an XML attribute holds, which a proposal's own constants need. */
const CONSTANT_VALUE = /^[^"<>&\r\n]+$/;

/**
 * What withOrganismConstants checks and adds for one organism: the type's required constants and each
 * constant the proposal introduces in curated/organism.json, given by the proposal; a data loader's given values win.
 */
export function loadConstants(datasetType, proposalConstants, given = {}) {
  return {
    required: { ...datasetType.requiredOrganismConstants, ...Object.fromEntries(Object.keys(proposalConstants).map((k) => [k, CONSTANT_VALUE])) },
    given: { ...proposalConstants, ...given }
  };
}
```

In `loadProposal` replace

```js
      const alsoDataset = dataset ? `, ${manifest.name} to ${dataset.organisms.map((o) => o.organism).join(' ')}` : '';
```

with

```js
      const alsoDataset = dataset ? `, ${entriesLabel(dataset.entries)} to ${dataset.organisms.map((o) => o.organism).join(' ')}` : '';
```

and

```js
      ...(dataset ? [`Dataset: \`${manifest.name}\` (${manifest.datasetClass}) in ${dataset.organisms.map((o) => `\`${o.relFile}\``).join(', ')}`] : []),
```

with

```js
      ...(dataset?.entries ?? []).map((e) => `Dataset: \`${e.name}\` (${e.datasetClass}) in ${dataset.organisms.map((o) => `\`${o.relFile}\``).join(', ')}`),
```

The commit subject and these PR lines label entries by name and class only; they key nothing. A resume parses only the organisms after `entriesLabel`, so a genome's supercontig and contig entries giving two alike `Dataset:` lines is cosmetic.

`shared/scripts/load-proposal.js`: add `import { entriesLabel } from './dataset-types/_common.js';` and change line 61 to

```js
      console.error(`Dry run: would add ${entriesLabel(result.dataset.entries)} to ${organisms.map((o) => o.relFile).join(', ')}`);
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/load-ops.test.js tests/delivery-roundtrip.test.js`
Expected: PASS. The pinned commit subjects (`…, Doe_heat_shock_2024 to tfakST1`) and `Dataset:` PR lines are unchanged.

Run: `yarn test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add shared/scripts/lib/load-ops.js shared/scripts/load-proposal.js tests/load-ops.test.js
git commit -m "Load validates, renders and commits every dataset entry

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Delivery and mark-ready per entry

**Files:**
- Modify: `shared/scripts/lib/delivery.js` (`deliveryProblems`)
- Modify: `shared/scripts/lib/delivery-ops.js` (`prepareDelivery`)
- Modify: `shared/scripts/lib/verification-ops.js` (`markReady`)
- Test: `tests/delivery.test.js`, `tests/delivery-ops.test.js`, `tests/validation-ops.test.js`

- [ ] **Step 1: Write the failing tests**

`tests/delivery.test.js`: add `deliveryProblems` to the `delivery.js` import and append

```js
test('deliveryProblems names each entry whose directory or file the planned delivery lacks', () => {
  const locations = [
    { label: 'fasta_primary_genome_sequence GenBank', relative: 'P/o/genome/chromosome_GenBank_fasta/2017-03-09/final', file: null },
    { label: 'productNames GenBank', relative: 'P/o/function/GenBank_product_names/2017-03-09/final', file: 'products.txt' }
  ];
  assert.deepEqual(deliveryProblems(locations, {}), [
    'fasta_primary_genome_sequence GenBank: P/o/genome/chromosome_GenBank_fasta/2017-03-09/final/ is missing',
    'productNames GenBank: P/o/function/GenBank_product_names/2017-03-09/final/products.txt is missing or empty'
  ]);
  assert.deepEqual(deliveryProblems(locations, {
    'P/o/genome/chromosome_GenBank_fasta/2017-03-09/final/genome.fasta': '>c1\nACGT\n',
    'P/o/function/GenBank_product_names/2017-03-09/final/products.txt': 'g1\tkinase\n'
  }), []);
  assert.deepEqual(deliveryProblems([locations[1]], { 'P/o/function/GenBank_product_names/2017-03-09/final/products.txt': '' }),
    ['productNames GenBank: P/o/function/GenBank_product_names/2017-03-09/final/products.txt is missing or empty']);
});
```

`tests/delivery-ops.test.js`: add `rmSync` to the `node:fs` import and append

```js
test('prepareDelivery refuses invalid dataset entries before reading the report or settling', async () => {
  const s = setup();
  const dir = join(s.repo, 'Proposals', s.proposalId);
  const { datasetClass, name, version, ...m } = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf-8'));
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(m, null, 2) + '\n');
  rmSync(join(dir, 'curated', 'dataset.json'));
  execFileSync('git', ['-C', s.repo, 'commit', '-qam', 'no entries']);
  execFileSync('git', ['-C', s.repo, 'push', '-q']);
  s.git.fetch();
  await assert.rejects(prepare(s), /Invalid dataset entries of PRJNA000002:\n  - bulk-rnaseq proposals hold exactly one dataset entry; this one has 0/);
});
```

`tests/validation-ops.test.js`: append

```js
test('markReady refuses invalid dataset entries before posting anything', async () => {
  const { repo, git } = setupMerged();
  const path = join(repo, 'Proposals/PRJNA000002/curated/dataset.json');
  const d = JSON.parse(readFileSync(path, 'utf-8'));
  writeFileSync(path, JSON.stringify({ ...d, props: { ...d.props, colour: 'red' } }, null, 2) + '\n');
  execFileSync('git', ['-C', repo, 'commit', '-qam', 'stray prop']);
  execFileSync('git', ['-C', repo, 'push', '-q']);
  git.fetch();
  const ticket = stubTicket({ status: 'verifying', existingComments: [formatReportComment(reportFor(git, 'pass'))] });
  await assert.rejects(markReady({ git, ticket, proposalId: 'PRJNA000002', note: 'n', workspace: disposalStub(), delivery: deliveryStub(git) }),
    /Invalid dataset entries of PRJNA000002:\n  - rnaSeqExperiment Doe_heat_shock_2024: props\.colour is not a prop of class rnaSeqExperiment/);
  assert.deepEqual(ticket.calls.filter((c) => c[0] === 'comment' || c[0] === 'setStatus'), []);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/delivery.test.js tests/delivery-ops.test.js tests/validation-ops.test.js`
Expected: FAIL. `deliveryProblems` is not exported; `prepareDelivery` reaches `onlyEntry` (`needs exactly one dataset entry`) only after the report check; `markReady` never validates entries, so it posts and sets `ready`.

- [ ] **Step 3: Implement**

`shared/scripts/lib/delivery.js`, append:

```js
/**
 * What the planned delivery lacks for its entries: each entry's directory must hold a file, and an entry
 * whose class reads one file needs it non-empty. locations come from entryDeliveries; files maps paths to text.
 */
export function deliveryProblems(locations, files) {
  const paths = Object.keys(files);
  return locations.flatMap(({ label, relative: dir, file }) => {
    if (file) return files[join(dir, file)] ? [] : [`${label}: ${join(dir, file)} is missing or empty`];
    return paths.some((p) => p.startsWith(`${dir}/`)) ? [] : [`${label}: ${dir}/ is missing`];
  });
}
```

`shared/scripts/lib/delivery-ops.js`:
- imports: replace `import { onlyEntry } from '../dataset-types/_common.js';` with `import { assertValidEntries, entryDeliveries, constantsOf, readerOnRef } from '../dataset-types/_common.js';`, remove the `deliveryLocation` import, and add `deliveryProblems` to the `./delivery.js` import.
- In `prepareDelivery`, replace

```js
  const datasetType = await loadDatasetType(manifest.datasetType);
  if (!datasetType.datasetClass) throw new Error(`${manifest.datasetType} has no dataset class yet, so it has no delivery`);
```

with

```js
  const datasetType = await loadDatasetType(manifest.datasetType);
  const relDir = proposalRelativePath(proposalId);
  const classOf = (className) => readDatasetClassOnRef(git, against, className);
  const entries = assertValidEntries(relDir, manifest, datasetType, { read: readerOnRef(git, 'origin/master'), classOf });
  if (!entries.length) throw new Error(`Proposal ${proposalId} has no dataset entries, so it has no delivery`);
```

- delete the later `const classDef = readDatasetClassOnRef(git, against, datasetType.datasetClass);` and `const relDir = proposalRelativePath(proposalId);` lines.
- `const problems = datasetType.stagingProblems?.(exported) ?? [];`
- replace the `withSettledProposal` callback body up to (not including) `const listed = manifest.staging ?? [];` with

```js
      const locations = entryDeliveries(m, entries, { classOf, constants: constantsOf(d), datasetType });
      const finals = [...new Set(locations.map((l) => l.relative))];
      assertDeliverable({ dir, finals });
      const parts = datasetType.corpus
        ? locations.map((l) => ({ abbrev: l.organism, project: projectOf(m, l.organism), datasetName: l.datasetName }))
        : [];
      if (parts.length) {
        const clashes = corpusClashes({ remote: createRemote(remoteOf(manualDelivery.host)), manualRoot: manualDelivery.root, corpus: datasetType.corpus, release, datasets: parts });
        if (clashes.length) throw new Error(`${proposalId} clashes with the STF corpus:\n  - ${clashes.join('\n  - ')}`);
      }
      const files = {};
      for (const l of locations) {
        const rendered = datasetType.renderArtifacts ? datasetType.renderArtifacts(d, l.organism).files : {};
        for (const [name, text] of Object.entries(rendered)) files[join(l.relative, name)] = text;
      }
      for (const p of parts) {
        for (const [name, text] of Object.entries(datasetType.corpusFiles(d, p.abbrev))) files[join(corpusDir(datasetType.corpus, release, p), name)] = text;
      }
      const missing = deliveryProblems(locations, files);
      if (missing.length) throw new Error(`${proposalId}: the delivery lacks what its dataset entries load:\n  - ${missing.join('\n  - ')}`);
```

- The STF corpus is keyed by each location's `datasetName` (Task 6b), the entry's identity, rather than `datasetNameFor(abbrev, entries[0].name)`. For bulk-rnaseq, the one corpus type, the class template and `datasetNameFor` agree (Task 15 asserts it), so `CORPUS` paths do not change.
- in the `record` literal: `corpusStep: datasetType.corpus ? corpusStep(datasetType.corpus, release, manualDelivery) : null,`

`shared/scripts/lib/verification-ops.js`:
- imports: add `import { assertValidEntries, readerOnRef } from '../dataset-types/_common.js';` and `import { readDatasetClassOnRef } from './dataset-classes.js';`
- in `markReady` replace

```js
  const { datasetClass } = await loadDatasetType(manifest.datasetType);
  const prepared = datasetClass ? await currentDelivery(git, ticket, ref, delivery, manifest.datasetType, proposalId) : null;
```

with

```js
  const entries = assertValidEntries(proposalRelativePath(proposalId), manifest, await loadDatasetType(manifest.datasetType), {
    read: readerOnRef(git, 'origin/master'), classOf: (className) => readDatasetClassOnRef(git, 'origin/master', className)
  });
  const prepared = entries.length ? await currentDelivery(git, ticket, ref, delivery, manifest.datasetType, proposalId) : null;
```

and in its doc comment "For a type with a dataset class" → "For a proposal with dataset entries".

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/delivery.test.js tests/delivery-ops.test.js tests/validation-ops.test.js tests/delivery-roundtrip.test.js tests/import-graph.test.js`
Expected: PASS (`FINAL` and `CORPUS` paths unchanged)

Run: `yarn test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add shared/scripts/lib/delivery.js shared/scripts/lib/delivery-ops.js shared/scripts/lib/verification-ops.js tests/delivery.test.js tests/delivery-ops.test.js tests/validation-ops.test.js
git commit -m "Delivery and mark-ready per dataset entry

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: `render-proposal` validates entries and previews each

**Files:**
- Modify: `shared/scripts/render-proposal.js`
- Test: `tests/render-proposal.test.js`

- [ ] **Step 1: Write the failing test**

Append to `tests/render-proposal.test.js`:

```js
test('--dataset refuses a proposal without dataset entries', () => {
  const { stderr, status } = run(['--dataset', fixtures + 'GCA_000001.1']);
  assert.equal(status, 1);
  assert.match(stderr, /Error: GCA_000001\.1 has no dataset entries, so there is no dataset entry or artifact to render/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/render-proposal.test.js`
Expected: FAIL; stderr is `genome-assembly proposals have no dataset entry or artifacts yet`.

- [ ] **Step 3: Implement**

In `shared/scripts/render-proposal.js`:
- usage comment lines for `--dataset`: `--dataset        every <dataset> element for the organism file, from curated/datasets.json` / `checked against classes.xml in the checkout holding the proposal`.
- imports: `import { writeArtifacts, handoffNote } from './lib/artifacts.js';` and `import { readPresenter, unknownInjectorProps, PREVIEW_BUILD, assertValidEntries, renderDatasets, entryDeliveries, constantsOf } from './dataset-types/_common.js';`
- replace the whole `if (values.dataset || values.artifacts !== undefined) { … }` block with:

```js
  if (values.dataset || values.artifacts !== undefined) {
    const classOf = (className) => readDatasetClass(findRepoRoot(proposalDir), className);
    const entries = assertValidEntries(proposalDir, manifest, datasetType, { classOf });
    if (!entries.length) throw new Error(`${manifest.accession} has no dataset entries, so there is no dataset entry or artifact to render`);
    if (values.dataset) {
      process.stdout.write(renderDatasets(proposalDir, manifest, datasetType, classOf) + '\n');
      return;
    }
    if (!datasetType.renderArtifacts) throw new Error(`${manifest.datasetType} proposals have no loading artifacts to preview`);
    const deliveries = entryDeliveries(manifest, entries, { classOf, constants: constantsOf(proposalDir), datasetType }).map(({ organism, target, relative }) => {
      const { files } = datasetType.renderArtifacts(proposalDir, organism);
      return { target, files, localDir: writeArtifacts(resolve(values.artifacts), relative, files) };
    });
    process.stdout.write(handoffNote({ deliveries, source: entries[0].source }) + '\n');
    return;
  }
```

(`organismsOf` is no longer used; drop it from the `./lib/manifest.js` import.)

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/render-proposal.test.js tests/artifacts.test.js tests/regression-goldens.test.js`
Expected: PASS

Run: `yarn test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add shared/scripts/render-proposal.js tests/render-proposal.test.js
git commit -m "render-proposal validates dataset entries and previews each

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Publish validates entries and lists them

**Files:**
- Modify: `shared/scripts/lib/proposal-ops.js` (`publishProposal`)
- Test: `tests/proposal-ops.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `tests/proposal-ops.test.js`:

```js
test('publishProposal lists each dataset entry as class, name and version', async () => {
  const { repo, root } = setupRepo();
  const git = createGit(repo, { exec: stubGh().exec });
  await startProposal({ git, ticket: stubTicket(), accession: 'PRJNA000003', datasetType: 'bulk-rnaseq' });
  await writeProposal({ rebuildBranch: REBUILD, git, repoPath: repo, manifestInput: rnaManifestInput, curator: 'someone@apidb.org', ...rnaFiles(root, coldShock) });
  const ticket = stubTicket();
  await publishProposal({ git, ticket, repoPath: repo, proposalId: 'PRJNA000003', build: '02' });
  const create = ticket.calls.find((c) => c[0] === 'create');
  assert.match(create[2], /^Dataset: rnaSeqExperiment Doe_cold_shock_2024 2024-05-01$/m);
  assert.doesNotMatch(create[2], /^(Name|Version): /m);
});

test('publishProposal refuses invalid dataset entries before any ticket or git change', async () => {
  const { repo, root } = setupRepo();
  const gh = stubGh();
  const git = createGit(repo, { exec: gh.exec });
  await startProposal({ git, ticket: stubTicket(), accession: 'PRJNA000003', datasetType: 'bulk-rnaseq' });
  const { dir } = await writeProposal({ rebuildBranch: REBUILD, git, repoPath: repo, manifestInput: rnaManifestInput, curator: 'someone@apidb.org', ...rnaFiles(root, coldShock) });
  writeFileSync(join(dir, 'curated', 'datasets.json'), '{}');
  const ticket = stubTicket();
  await assert.rejects(publishProposal({ git, ticket, repoPath: repo, proposalId: 'PRJNA000003', build: '02' }), /Invalid dataset entries of PRJNA000003/);
  assert.deepEqual(ticket.calls, []);
  assert.equal(gh.creates(), 0);
});
```

(The second test holds before and after Task 14: today `datasets.json` beside `dataset.json` is refused; after Task 14 a `{}` `datasets.json` is.)

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/proposal-ops.test.js`
Expected: FAIL. The summary still has `Name:`/`Version:` lines, and the invalid entries reach ticket creation.

- [ ] **Step 3: Implement**

In `shared/scripts/lib/proposal-ops.js` add `assertValidEntries` to the `_common.js` import. In `publishProposal` replace

```js
  const datasetType = await loadDatasetType(manifest.datasetType);
  datasetType.assertCuratedAgree?.(dir);
```

with

```js
  const datasetType = await loadDatasetType(manifest.datasetType);
  const entries = assertValidEntries(dir, manifest, datasetType, { classOf: (className) => readDatasetClass(repoPath, className) });
  datasetType.assertCuratedAgree?.(dir);
```

and in `summary` replace

```js
    ...(manifest.name ? [`Name: ${manifest.name}`, `Version: ${manifest.version}`] : []),
```

with

```js
    ...entries.map((e) => `Dataset: ${e.datasetClass} ${e.name} ${e.version}`),
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/proposal-ops.test.js`
Expected: PASS

Run: `yarn test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add shared/scripts/lib/proposal-ops.js tests/proposal-ops.test.js
git commit -m "Publish validates dataset entries and lists each on the ticket

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: `writeProposal` writes `datasets.json`

**Files:**
- Modify: `shared/scripts/lib/proposal-ops.js` (imports, `MANIFEST_ORDER`, `identityFor` → `entryIdentityFor`, `writeProposal`)
- Modify: `shared/scripts/write-proposal.js:16-17` (doc comment)
- Test: `tests/proposal-ops.test.js` (lines ~569-589, ~615-625, ~2206-2209, plus new tests)

- [ ] **Step 1: Write the failing tests**

Replace `'writeProposal records identity: derived name and version unless overridden'` with

```js
test('writeProposal records the dataset entry: derived name and version unless overridden; the manifest has no identity', async () => {
  const { repo, root } = setupRepo();
  const git = createGit(repo);
  await startProposal({ git, ticket: stubTicket(), accession: 'PRJNA000003', datasetType: 'bulk-rnaseq' });
  const presenter = { shortDisplayName: 'Cold shock', shortAttribution: 'Roe et al.' };
  const derived = await writeProposal({
    rebuildBranch: REBUILD, git, repoPath: repo, manifestInput: rnaManifestInput, curator: 'someone@apidb.org', ...rnaFiles(root, { presenter })
  });
  assert.deepEqual(derived.datasets.map((e) => [e.datasetClass, e.name, e.version]), [['rnaSeqExperiment', 'Doe_2024', '2024-05-01']]);
  assert.deepEqual(Object.keys(derived.manifest), ['schemaVersion', 'accession', 'datasetType', 'organisms', 'contacts', 'curator', 'createdAt', 'skill']);

  const chosen = await writeProposal({
    rebuildBranch: REBUILD, git, repoPath: repo, manifestInput: rnaManifestInput, curator: 'someone@apidb.org',
    ...rnaFiles(root, { name: 'Doe_cold_shock_2024', version: '2024-06-02', presenter })
  });
  const onDisk = JSON.parse(readFileSync(join(chosen.dir, 'curated', 'datasets.json'), 'utf-8'));
  assert.deepEqual(onDisk.datasets.map((e) => [e.name, e.version]), [['Doe_cold_shock_2024', '2024-06-02']]);
});
```

Replace `'writeProposal derives curated/dataset.json for a type with a dataset class'` with

```js
test('writeProposal derives curated/datasets.json with the one entry of a single-entry type', async () => {
  const { repo, root } = setupRepo();
  const git = createGit(repo);
  await startProposal({ git, ticket: stubTicket(), accession: 'PRJNA000003', datasetType: 'bulk-rnaseq' });
  const { dir, datasets } = await writeProposal({
    rebuildBranch: REBUILD, git, repoPath: repo, manifestInput: rnaManifestInput, curator: 'someone@apidb.org', ...rnaFiles(root, coldShock)
  });
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'curated/datasets.json'), 'utf-8')), { schemaVersion: 2, datasets });
  assert.equal(existsSync(join(dir, 'curated/dataset.json')), false);
  assert.deepEqual(datasets[0].source, { type: 'sra' });
  assert.equal(datasets[0].props.isStrandSpecific, 'true');
});

test('re-writing a proposal in the old shape writes datasets.json and drops dataset.json and the manifest identity', async () => {
  const { repo, root } = setupRepo();
  const git = createGit(repo);
  await startProposal({ git, ticket: stubTicket(), accession: 'PRJNA000003', datasetType: 'bulk-rnaseq' });
  const write = () => writeProposal({ rebuildBranch: REBUILD, git, repoPath: repo, manifestInput: rnaManifestInput, curator: 'someone@apidb.org', ...rnaFiles(root, coldShock) });
  const { dir, datasets: [entry] } = await write();
  const manifestPath = join(dir, 'manifest.json');
  const { datasetClass, name, version, props, source } = entry;
  writeFileSync(manifestPath, JSON.stringify({ ...JSON.parse(readFileSync(manifestPath, 'utf-8')), datasetClass, name, version }, null, 2) + '\n');
  writeFileSync(join(dir, 'curated', 'dataset.json'), JSON.stringify({ schemaVersion: 1, props, source }, null, 2) + '\n');
  rmSync(join(dir, 'curated', 'datasets.json'));
  const again = await write();
  assert.deepEqual(again.datasets, [entry]);
  assert.equal(existsSync(join(dir, 'curated', 'dataset.json')), false);
  const onDisk = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  assert.deepEqual(['datasetClass', 'name', 'version'].filter((k) => k in onDisk), []);
});

test('a genome proposal writes no dataset entries and takes no name or version', async () => {
  const { repo, root } = setupRepo();
  const git = createGit(repo);
  await startProposal({ git, ticket: stubTicket(), accession: 'GCA_000001.1', datasetType: 'genome-assembly' });
  const write = (extra = {}) => writeProposal({ rebuildBranch: REBUILD, git, repoPath: repo, manifestInput, curator: 'someone@apidb.org', inputs: genomeInputs(root), curated: [], warn: () => {}, ...extra });
  const { dir, datasets } = await write();
  assert.deepEqual(datasets, []);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'curated', 'datasets.json'), 'utf-8')), { schemaVersion: 2, datasets: [] });
  const overrides = join(root, 'overrides.json');
  writeFileSync(overrides, JSON.stringify({ name: 'GenBank' }));
  await assert.rejects(write({ overrides }), /genome-assembly proposals take no name or version; their dataset entries come from preprocessing/);
});

const PRODUCTS = { datasetClass: 'productNames', name: 'GenBank', version: '$$functAnnotVersion$$', props: {}, source: { type: 'server', paths: ['/staging/products.txt'] } };
const KEPT_CONSTANTS = { functAnnotVersion: '2017-03-09' };

/** Amends a written genome proposal the way preprocessing does: one entry and its constants. */
function amendAsPreprocessing(dir) {
  writeFileSync(join(dir, 'curated', 'datasets.json'), JSON.stringify({ schemaVersion: 2, datasets: [PRODUCTS] }, null, 2) + '\n');
  const record = join(dir, 'curated', 'organism.json');
  writeFileSync(record, JSON.stringify({ ...JSON.parse(readFileSync(record, 'utf-8')), constants: KEPT_CONSTANTS }, null, 2) + '\n');
}

test('re-writing a genome proposal keeps the entries and constants preprocessing added to the working tree', async () => {
  const { repo, root } = setupRepo();
  const git = createGit(repo);
  await startProposal({ git, ticket: stubTicket(), accession: 'GCA_000001.1', datasetType: 'genome-assembly' });
  const write = () => writeProposal({ rebuildBranch: REBUILD, git, repoPath: repo, manifestInput, curator: 'someone@apidb.org', inputs: genomeInputs(root), curated: [], warn: () => {} });
  const { dir } = await write();
  amendAsPreprocessing(dir);
  const again = await write();
  assert.deepEqual(again.datasets, [PRODUCTS]);
  assert.deepEqual(again.organism.constants, KEPT_CONSTANTS);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'curated', 'organism.json'), 'utf-8')).constants, KEPT_CONSTANTS);
});

test('re-writing a genome proposal with no working copy keeps the entries and constants on master', async () => {
  const { repo, root } = setupRepo();
  const git = createGit(repo);
  await startProposal({ git, ticket: stubTicket(), accession: 'GCA_000001.1', datasetType: 'genome-assembly' });
  const write = () => writeProposal({ rebuildBranch: REBUILD, git, repoPath: repo, manifestInput, curator: 'someone@apidb.org', inputs: genomeInputs(root), curated: [], warn: () => {} });
  const { dir } = await write();
  amendAsPreprocessing(dir);
  execFileSync('git', ['-C', repo, 'add', '.']);
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'preprocessing amends GCA_000001.1']);
  execFileSync('git', ['-C', repo, 'push', '-q', 'origin', 'HEAD:master']);
  rmSync(dir, { recursive: true });
  const again = await write();
  assert.deepEqual(again.datasets, [PRODUCTS]);
  assert.deepEqual(again.organism.constants, KEPT_CONSTANTS);
});
```

If `execFileSync` or `rmSync` is not yet imported in `tests/proposal-ops.test.js`, add them to the existing `node:child_process` / `node:fs` imports.

In `'writeProposal accepts an experiment name only master has'` change `const { manifest } = await writeProposal({` to `const { datasets } = await writeProposal({` and the assertion to `assert.equal(datasets[0].name, 'Doe_cold_shock_2024');`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/proposal-ops.test.js`
Expected: FAIL. `writeProposal` still returns `dataset` (not `datasets`), writes `curated/dataset.json` and manifest identity, the genome message is `do not take a name or version yet`, and a genome re-write drops the entries and constants preprocessing added.

- [ ] **Step 3: Implement**

In `shared/scripts/lib/proposal-ops.js`:
- remove `IDENTITY_FIELDS,` from the `./manifest.js` import.
- `_common.js` import becomes:

```js
import {
  readOverrides, assertValidPresenter, presenterPath, PRESENTER_FILENAME, DATASET_FILENAME, DATASETS_FILENAME, DATASETS_SCHEMA_VERSION,
  PREVIEW_BUILD, renderDatasets, datasetsOf, readerOnRef, assertValidEntries, entryIdentityErrors
} from '../dataset-types/_common.js';
```

- `MANIFEST_ORDER`:

```js
const MANIFEST_ORDER = [
  'schemaVersion', 'accession', 'externalIds', 'datasetType', 'organisms', 'annotation',
  'contacts', 'curator', 'createdAt', 'skill', 'staging', 'ticket'
];
```

- replace `identityFor` and its doc comment with:

```js
/**
 * The identity of a single-entry type's one dataset: curator overrides first, then what the type
 * derives from the inputs. Other types' entries come from preprocessing, so they get null.
 */
function entryIdentityFor(datasetType, stagedDir, manifest, overrides, repoPath) {
  if (!datasetType.singleEntry) {
    if (overrides.name !== undefined || overrides.version !== undefined) {
      throw new Error(`${manifest.datasetType} proposals take no name or version; their dataset entries come from preprocessing`);
    }
    return null;
  }
  const derived = datasetType.deriveIdentity(stagedDir, {
    primaryContactName: readContactName(contactsPath(repoPath), manifest.contacts.primary)
  });
  const identity = { datasetClass: datasetType.datasetClasses[0], name: overrides.name ?? derived.name, version: overrides.version ?? derived.version };
  const missing = ['name', 'version'].filter((k) => !identity[k]);
  if (missing.length) {
    throw new Error(`No ${missing.join(' or ')} could be derived for ${manifest.accession}; set ${missing.map((k) => `"${k}"`).join(' and ')} in the --overrides file`);
  }
  const errors = entryIdentityErrors(identity, manifest);
  if (errors.length) throw new Error(`Invalid dataset identity for ${manifest.accession}:\n  - ${errors.join('\n  - ')}`);
  return identity;
}
```

- add below `entryIdentityFor`:

```js
/**
 * What preprocessing added to a proposal whose entries do not come from write-proposal: its entries and
 * curated/organism.json constants, from the working tree's copy when present, else master's, else none.
 */
function keptFromPreprocessing(git, repoPath, proposalId, manifest) {
  const rel = join(PROPOSALS_DIR, proposalId);
  if (existsSync(join(repoPath, rel, MANIFEST_FILENAME))) {
    const dir = join(repoPath, rel);
    return { entries: datasetsOf(dir, manifest), constants: constantsOf(dir) };
  }
  if (!git.fileExistsOnRef('origin/master', join(rel, MANIFEST_FILENAME))) return { entries: [], constants: {} };
  const read = readerOnRef(git, 'origin/master');
  return { entries: datasetsOf(rel, manifest, { read }), constants: constantsOf(rel, { read }) };
}
```

  and add `constantsOf` to the `_common.js` import above.

- in `writeProposal`:
  - `const derivedNames = [PRESENTER_FILENAME, DATASETS_FILENAME, DATASET_FILENAME, ...[datasetType.ORGANISM_RECORD_FILENAME ?? []].flat(), ...(datasetType.derivedCuratedFiles ?? [])];`
  - replace the two lines `const identity = identityFor(…); const full = inManifestOrder({ ...manifest, ...identity });` with

```js
    const identity = entryIdentityFor(datasetType, staged, manifest, overrideValues, repoPath);
    const full = inManifestOrder(manifest);
    // Read before the proposal directory is replaced; a single-entry type re-derives its entry instead.
    const kept = identity ? null : keptFromPreprocessing(git, repoPath, proposalId, full);
```

  - in the organism record block, replace the `organism = datasetType.deriveOrganismRecord(…)` line's result handling so the written record carries the kept constants:

```js
      organism = datasetType.deriveOrganismRecord(staged, { projectOrganisms, claims, checkedAgainst: rebuildRef }, overrideValues.organism, warn);
      if (Object.keys(kept?.constants ?? {}).length) organism = { ...organism, constants: kept.constants };
      writeFileSync(join(staged, 'curated', datasetType.ORGANISM_RECORD_FILENAME), JSON.stringify(organism, null, 2) + '\n');
```

  - replace the whole block from `let dataset;` through the closing `}` of `else if (overrideValues.dataset) { … }` with

```js
    const classOf = (className) => readDatasetClass(repoPath, className);
    let entries = [];
    if (identity) {
      assertNamesAreFree(git, rebuildRef, full, [identity], datasetType, proposalId, classOf);
      const { props, source } = datasetType.deriveDataset(staged, classOf(identity.datasetClass), overrideValues.dataset);
      entries = [{ ...identity, props, source }];
    } else if (overrideValues.dataset) {
      throw new Error(`${manifest.datasetType} proposals take no dataset overrides; their dataset entries come from preprocessing`);
    } else {
      entries = kept.entries;
    }
    writeFileSync(join(staged, 'curated', DATASETS_FILENAME), JSON.stringify({ schemaVersion: DATASETS_SCHEMA_VERSION, datasets: entries }, null, 2) + '\n');
    assertValidEntries(staged, full, datasetType, { classOf });
    renderDatasets(staged, full, datasetType, classOf);
    if (datasetType.deriveArtifacts) {
      const derived = datasetType.deriveArtifacts(staged);
      const listed = [...Object.keys(derived), ...artifactsOnDisk(dir, datasetType.derivedCuratedFiles ?? [])];
      const artifacts = artifactsToWrite(dir, derived, listed, curatedEdits, { organisms: full.organisms.map((o) => o.proposedOrganismAbbrev) });
      for (const [f, text] of Object.entries(artifacts)) {
        mkdirSync(dirname(join(staged, 'curated', f)), { recursive: true });
        writeFileSync(join(staged, 'curated', f), text);
      }
      datasetType.assertCuratedAgree?.(staged);
      for (const w of datasetType.curatedWarnings?.(staged) ?? []) warn(`Warning: ${w}`);
    }
```

  - return `{ dir, presenter, datasets: entries, organism, manifest: full }`, and in the doc comment: "Writes Proposals/<proposalId>/ with inputs/, curated/ (the derived presenter.json and datasets.json, which holds a single-entry type's one entry and no entries for a genome) and manifest.json, replacing any existing directory, so an old curated/dataset.json and manifest identity are dropped." and "Returns { dir, presenter, datasets, organism, manifest }."
  - `datasetsOf` and `readerOnRef` are used by `entriesOn` (Task 9); `datasetPath` is gone from the import.

In `shared/scripts/write-proposal.js` replace the doc lines

```
 * Derives curated/presenter.json, curated/dataset.json (for types with a
 * dataset class) and, for RNA-seq, the curated loading artifacts, and prints
```

with

```
 * Derives curated/presenter.json, curated/datasets.json (one entry for a
 * single-entry type, none for a genome, whose entries come from preprocessing)
 * and the curated loading artifacts, and prints
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/proposal-ops.test.js tests/load-ops.test.js tests/delivery-roundtrip.test.js`
Expected: PASS

Run: `yarn test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add shared/scripts/lib/proposal-ops.js shared/scripts/write-proposal.js tests/proposal-ops.test.js
git commit -m "writeProposal writes datasets.json; manifest identity and dataset.json go

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Shape equivalence and the synthetic genome proposal

**Files:**
- Modify: `tests/regression-goldens.test.js` (append)
- Create: `tests/genome-entries.test.js`

- [ ] **Step 1: Write the tests**

Append to `tests/regression-goldens.test.js` (and add the imports to its import block):

```js
import * as rnaseq from '../shared/scripts/dataset-types/bulk-rnaseq.js';
import { renderDatasets, onlyEntry, entryDeliveries } from '../shared/scripts/dataset-types/_common.js';
```

```js
test('PRJNA000002 in the datasets.json shape renders and delivers exactly as in the old shape', (t) => {
  const repo = mkdtempSync(join(tmpdir(), 'regression-v2-'));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  mkdirSync(join(repo, 'Model/lib/xml/datasetClass'), { recursive: true });
  cpSync(join(fixtures, 'classes.xml'), join(repo, CLASSES_RELATIVE_PATH));
  const golden = join(fixtures, 'proposals', 'PRJNA000002');
  const dir = join(repo, 'PRJNA000002');
  cpSync(golden, dir, { recursive: true });
  const manifestPath = join(dir, 'manifest.json');
  const { datasetClass, name, version, ...m } = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  const { props, source } = JSON.parse(readFileSync(join(dir, 'curated', 'dataset.json'), 'utf-8'));
  writeFileSync(manifestPath, JSON.stringify(m, null, 2) + '\n');
  rmSync(join(dir, 'curated', 'dataset.json'));
  writeFileSync(join(dir, 'curated', 'datasets.json'), JSON.stringify({ schemaVersion: 2, datasets: [{ datasetClass, name, version, props, source }] }, null, 2) + '\n');
  const classOf = (className) => readDatasetClass(repo, className);

  assert.equal(rnaseq.renderPresenter(dir, { build: '02' }) + '\n', readFileSync(join(golden, 'expected.xml'), 'utf-8'));
  assert.equal(renderDatasets(dir, m, rnaseq, classOf) + '\n', readFileSync(join(golden, 'expected-dataset.xml'), 'utf-8'));
  for (const [file, text] of Object.entries(rnaseq.renderArtifacts(dir, 'tfakST1').files)) {
    assert.equal(text, readFileSync(join(golden, 'expected-artifacts', file), 'utf-8'), file);
  }
  const [delivery] = entryDeliveries(m, [onlyEntry(dir, m)], { classOf });
  assert.equal(delivery.target, '@@manualDeliveryDir@@/FungiDB/tfakST1/rnaSeq/Doe_heat_shock_2024/2024-05-01/final/');
  assert.deepEqual([delivery.datasetName], rnaseq.presenterNames(dir));
});
```

Create `tests/genome-entries.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as genome from '../shared/scripts/dataset-types/genome-assembly.js';
import { assertValidEntries, entryDeliveries, renderDatasets, constantsOf, datasetsOf } from '../shared/scripts/dataset-types/_common.js';
import { readDatasetClass, CLASSES_RELATIVE_PATH } from '../shared/scripts/lib/dataset-classes.js';
import { loadConstants } from '../shared/scripts/lib/load-ops.js';
import { withOrganismConstants } from '../shared/scripts/lib/organism-constants.js';
import { fixtures } from './helpers.js';

const CONSTANTS = { genomeSource: 'GenBank', genomeVersion: '2017-03-09', soTerm: 'chromosome', functAnnotVersion: '2017-03-09', source: 'GenBank' };
const SERVER = { type: 'server', paths: ['/data/tfakST-1'] };
const sequence = (datasetClass, soTerm, extra = {}) => ({
  datasetClass, name: '$$genomeSource$$', version: '$$genomeVersion$$',
  props: { ncbiTaxonId: '$$ncbiTaxonId$$', table: 'DoTS::ExternalNASequence', soTerm, sourceIdRegex: '^>(\\S+)', ...extra }, source: SERVER
});
const features = (datasetClass, soTerm, extra = {}) => ({
  datasetClass, name: '$$genomeSource$$', version: '$$genomeVersion$$',
  props: { ncbiTaxonId: '$$ncbiTaxonId$$', soTerm, mapFile: 'genemRNAExonCDS2Gus.xml', ...extra }, source: SERVER
});
const dbxref = (name, version, columnSpec, url) => ({
  datasetClass: 'dbxref_simple', name, version,
  props: { columnSpec, target: 'NAFeature', url, urlUsesSecondaryId: 'false', genomeVersion: '$$genomeVersion$$', viewName: 'Transcript' }, source: SERVER
});

/** Sequences, then features, then functional entries, as preprocessing writes them. Both secondary pairs share a name. */
const ENTRIES = [
  sequence('fasta_primary_genome_sequence', '$$soTerm$$', { releaseDate: '' }),
  sequence('fasta_secondary_genome', 'supercontig'),
  sequence('fasta_secondary_genome', 'contig'),
  sequence('fasta_organelle_genome', 'mitochondrial_chromosome', { organelle: 'mitochondrion' }),
  features('NoPreprocess_primary_genome_features', '$$soTerm$$', { source: '$$source$$' }),
  features('NoPreprocess_secondary_genome_features', 'supercontig'),
  features('NoPreprocess_secondary_genome_features', 'contig'),
  { datasetClass: 'productNames', name: 'GenBank', version: '$$functAnnotVersion$$', props: {}, source: SERVER },
  dbxref('EuPathDB_comment', '2022-09-01', 'primary_identifier', ''),
  dbxref('NCBI_Gene', '$$functAnnotVersion$$', 'primary_identifier,secondary_identifier', 'https://www.ncbi.nlm.nih.gov/gene/EXTERNAL_ID_HERE')
];

/** GCA_000001.1 amended as preprocessing would: its entries and constants, in a checkout with classes.xml. */
function syntheticGenome(t) {
  const repo = mkdtempSync(join(tmpdir(), 'genome-entries-'));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  mkdirSync(join(repo, 'Model/lib/xml/datasetClass'), { recursive: true });
  cpSync(join(fixtures, 'classes.xml'), join(repo, CLASSES_RELATIVE_PATH));
  const dir = join(repo, 'Proposals', 'GCA_000001.1');
  cpSync(join(fixtures, 'proposals', 'GCA_000001.1'), dir, { recursive: true });
  writeFileSync(join(dir, 'curated', 'datasets.json'), JSON.stringify({ schemaVersion: 2, datasets: ENTRIES }, null, 2) + '\n');
  writeFileSync(join(dir, 'curated', 'organism.json'), JSON.stringify({ constants: CONSTANTS }, null, 2) + '\n');
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf-8'));
  return { dir, manifest, classOf: (className) => readDatasetClass(repo, className) };
}

test('the synthetic genome proposal validates', (t) => {
  const { dir, manifest, classOf } = syntheticGenome(t);
  assert.deepEqual(assertValidEntries(dir, manifest, genome, { classOf }), ENTRIES);
});

test('each genome entry has its own datasetName and directory, and a file for organelle sequence, products and dbxrefs', (t) => {
  const { dir, manifest, classOf } = syntheticGenome(t);
  const where = entryDeliveries(manifest, datasetsOf(dir, manifest), { classOf, constants: constantsOf(dir), datasetType: genome });
  assert.deepEqual(where.map((l) => [l.datasetName, l.relative, l.file]), [
    ['tfakST-1_primary_genome_RSRC', 'FungiDB/tfakST-1/genome/chromosome_GenBank_fasta/2017-03-09/final', null],
    ['tfakST-1_supercontig_GenBank_RSRC', 'FungiDB/tfakST-1/genome/supercontig_GenBank_fasta/2017-03-09/final', null],
    ['tfakST-1_contig_GenBank_RSRC', 'FungiDB/tfakST-1/genome/contig_GenBank_fasta/2017-03-09/final', null],
    ['tfakST-1_mitochondrial_chromosome_GenBank_RSRC', 'FungiDB/tfakST-1/genome/mitochondrial_chromosome_GenBank_fasta/2017-03-09/final', 'genome.fasta'],
    ['tfakST-1_primary_genome_features_RSRC', 'FungiDB/tfakST-1/genome/chromosome_GenBank_gff3/2017-03-09/final', null],
    ['tfakST-1_supercontig_genome_features_RSRC', 'FungiDB/tfakST-1/genome/supercontig_GenBank_gff3/2017-03-09/final', null],
    ['tfakST-1_contig_genome_features_RSRC', 'FungiDB/tfakST-1/genome/contig_GenBank_gff3/2017-03-09/final', null],
    ['tfakST-1_function_GenBank_product_names_RSRC', 'FungiDB/tfakST-1/function/GenBank_product_names/2017-03-09/final', 'products.txt'],
    ['tfakST-1_dbxref_EuPathDB_comment_RSRC', 'FungiDB/tfakST-1/dbxref/EuPathDB_comment/2022-09-01/final', 'mapping.txt'],
    ['tfakST-1_dbxref_NCBI_Gene_RSRC', 'FungiDB/tfakST-1/dbxref/NCBI_Gene/2017-03-09/final', 'mapping.txt']
  ]);
});

test('the load XML holds one <dataset> per entry in entry order, constants left for the organism file', (t) => {
  const { dir, manifest, classOf } = syntheticGenome(t);
  const xml = renderDatasets(dir, manifest, genome, classOf);
  const blocks = xml.split('\n\n');
  assert.deepEqual(blocks.map((b) => /^  <dataset class="([^"]+)">/.exec(b)?.[1]), ENTRIES.map((e) => e.datasetClass));
  assert.equal(blocks[0], `  <dataset class="fasta_primary_genome_sequence">
    <prop name="projectName">$$projectName$$</prop>
    <prop name="organismAbbrev">$$organismAbbrev$$</prop>
    <prop name="ncbiTaxonId">$$ncbiTaxonId$$</prop>
    <prop name="name">$$genomeSource$$</prop>
    <prop name="version">$$genomeVersion$$</prop>
    <prop name="table">DoTS::ExternalNASequence</prop>
    <prop name="soTerm">$$soTerm$$</prop>
    <prop name="sourceIdRegex">^&gt;(\\S+)</prop>
    <prop name="releaseDate"></prop>
  </dataset>`);
  assert.doesNotMatch(blocks[4], /<prop name="name">/);
  assert.match(blocks[4], /<prop name="source">\$\$source\$\$<\/prop>/);
  assert.match(blocks[1], /<prop name="name">\$\$genomeSource\$\$<\/prop>[\s\S]*<prop name="soTerm">supercontig<\/prop>/);
  assert.match(blocks[2], /<prop name="name">\$\$genomeSource\$\$<\/prop>[\s\S]*<prop name="soTerm">contig<\/prop>/);
});

test('a load gives the proposal constants to the organism file and refuses a different value already there', (t) => {
  const { dir } = syntheticGenome(t);
  const { required, given } = loadConstants(genome, constantsOf(dir));
  const file = readFileSync(join(fixtures, 'tfakST1.xml'), 'utf-8');
  const { content, added } = withOrganismConstants(file, required, given, 'tfakST-1');
  assert.deepEqual(added, ['genomeSource=GenBank', 'genomeVersion=2017-03-09', 'soTerm=chromosome', 'functAnnotVersion=2017-03-09', 'source=GenBank']);
  assert.match(content, /<constant name="projectName" value="FungiDB"\/>\n  <constant name="genomeSource" value="GenBank"\/>/);
  assert.throws(() => withOrganismConstants(content.replace('value="GenBank"/>', 'value="RefSeq"/>'), required, given, 'tfakST-1'),
    /tfakST-1 already has genomeSource RefSeq; --genomeSource says GenBank/);
});
```

- [ ] **Step 2: Run them**

Run: `node --test tests/regression-goldens.test.js tests/genome-entries.test.js`
Expected: PASS. These exercise code from Tasks 2-10 end to end. If one fails, the defect is in that earlier task's code: fix it there and re-run, rather than adjusting the expectation.

Run: `yarn test`
Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add tests/regression-goldens.test.js tests/genome-entries.test.js
git commit -m "Tests: datasets.json renders as the old shape; a synthetic genome proposal end to end

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: Remove the legacy identity APIs

**Files:**
- Modify: `shared/scripts/lib/manifest.js` (lines 21-22; identity block in `validate`)
- Modify: `shared/scripts/dataset-types/_common.js` (`requireIdentity`, `datasetPath`, `readDataset`)
- Modify: `shared/scripts/lib/dataset-classes.js` (`identityValues`, `projectOf` import)
- Modify: `shared/scripts/dataset-types/bulk-rnaseq.js`, `dnaseq.js`, `chipseq.js` (`datasetClass`)
- Test: `tests/dataset-entries.test.js`, `tests/manifest.test.js:302-313`, `tests/dataset-classes.test.js:8,30-35`, `tests/dataset-types-dnaseq.test.js:7,40`, `tests/dataset-types-chipseq.test.js:10,49`

- [ ] **Step 1: Write the failing tests**

Append to `tests/dataset-entries.test.js`:

```js
test('dataset identity has one home: no manifest identity, no single datasetClass, no dataset.json reader', async () => {
  const manifest = await import('../shared/scripts/lib/manifest.js');
  const common = await import('../shared/scripts/dataset-types/_common.js');
  const classes = await import('../shared/scripts/lib/dataset-classes.js');
  assert.equal(manifest.IDENTITY_FIELDS, undefined);
  for (const k of ['requireIdentity', 'readDataset', 'datasetPath']) assert.equal(common[k], undefined, k);
  assert.equal(classes.identityValues, undefined);
  for (const [type, mod] of Object.entries(DATASET_TYPES)) assert.equal(mod.datasetClass, undefined, type);
});
```

In `tests/manifest.test.js` replace the `identity` constant and the test `'identity fields validate together and in form'` with

```js
test('validate leaves dataset identity to the dataset entries', () => {
  assert.deepEqual(validate({ ...valid(), datasetClass: 'rnaSeqExperiment', name: 'Doe heat shock', version: '24 July 2021' }), []);
});
```

In `tests/dataset-classes.test.js` drop `identityValues` from the import and change the assertion in `'the rnaseq presenter name is the class loader datasetName'` to

```js
  assert.equal(expandPattern(c.datasetNamePattern, { organismAbbrev: 'tfakST1', name: manifest.name }),
    presenterNames(join(fixtures, 'proposals', 'PRJNA000002'))[0]);
```

In `tests/dataset-types-dnaseq.test.js` and `tests/dataset-types-chipseq.test.js` drop `identityValues` from the `dataset-classes.js` import and change the first assertion of the "dataset name follows the classes.xml datasetLoader pattern" test to

```js
  assert.equal(dnaseq.datasetNameFor('tfakST1', m.name), expandPattern(classDef.datasetNamePattern, { organismAbbrev: 'tfakST1', name: m.name }));
```

(`chipseq.datasetNameFor` in the chipseq file.) `m.name` here reads the fixture manifest's legacy field as test data.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/dataset-entries.test.js tests/manifest.test.js`
Expected: FAIL. The legacy exports still exist, and `validate` still rejects the malformed identity fields.

- [ ] **Step 3: Implement**

- `shared/scripts/lib/manifest.js`: delete the two lines `/** Present for dataset types that produce a classes.xml dataset; all or none. */` and `export const IDENTITY_FIELDS = ['datasetClass', 'name', 'version'];`, and in `validate` delete everything from `const identity = IDENTITY_FIELDS.filter(…)` through the closing `}` of the `version must be a date, YYYY-MM-DD` check.
- `shared/scripts/dataset-types/_common.js`: delete `requireIdentity` (with its doc comment), `datasetPath`, and `readDataset`. Rename the section comment `// --- dataset record (curated/dataset.json) ---` to `// --- dataset record (an entry's props and source) ---`.
- `shared/scripts/lib/dataset-classes.js`: delete `identityValues` (with its doc comment) and the now-unused `import { projectOf } from './manifest.js';`.
- `bulk-rnaseq.js`: replace

```js
export const datasetClass = 'rnaSeqExperiment';
export const datasetClasses = [datasetClass];
```

with `export const datasetClasses = ['rnaSeqExperiment'];` and likewise `['dnaseqExperiment']` in `dnaseq.js` and `['chipSeqExperiment']` in `chipseq.js`.

Then confirm nothing reads the removed names:

Run: `grep -rnE "IDENTITY_FIELDS|requireIdentity|readDataset\b|datasetPath|identityValues|deliveryPath|datasetType\.datasetClass\b|\bm\.name\b|manifest\.name\b|\bm\.version\b|manifest\.version\b" shared/scripts`
Expected: no output.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/dataset-entries.test.js tests/manifest.test.js tests/dataset-classes.test.js tests/dataset-types-dnaseq.test.js tests/dataset-types-chipseq.test.js`
Expected: PASS

Run: `yarn test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add shared/scripts tests/dataset-entries.test.js tests/manifest.test.js tests/dataset-classes.test.js tests/dataset-types-dnaseq.test.js tests/dataset-types-chipseq.test.js
git commit -m "Remove manifest dataset identity and the single datasetClass

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 17: Docs

**Files:**
- Modify: `docs/development.md` (hook table ~lines 190-212; paragraph after it)
- Modify: `shared/resources/proposal-workflow.md` (~lines 65-75)
- Modify: `skills/propose-bulk-rnaseq/SKILL.md`, `skills/propose-dnaseq/SKILL.md`, `skills/propose-chipseq/SKILL.md`
- Modify: `skills/propose-bulk-rnaseq/resources/step-4-write-proposal.md`, `skills/propose-dnaseq/resources/step-4-write-proposal.md`, `skills/propose-chipseq/resources/step-4-write-proposal.md`

- [ ] **Step 1: `docs/development.md` hook table.** Replace these rows:

```markdown
| `presenterNames(dir)` | both | an array holding the proposal's one presenter name, derived from the manifest |
| `datasetClass` | both | the `classes.xml` class, or absent for types without a dataset entry yet |
| `deriveIdentity(dir, { primaryContactName })` | 1 | default `name` and `version`. A multi-organism name must be unique across all organisms |
| `deriveDataset(dir, classDef, overrides.dataset)` | 1 | the `curated/dataset.json` record, checked against the class |
| `renderDataset(dir, classDef)` | both | the `<dataset>` entry for each organism file |
```

with

```markdown
| `presenterNames(dir)` | both | an array holding the proposal's one presenter name, derived from the manifest and, for single-entry types, the entry's `name` |
| `datasetClasses` | both | the `classes.xml` classes the proposal's dataset entries may hold |
| `singleEntry` | both | optional; `true` for a type whose proposal holds exactly one entry, which `write-proposal.js` derives |
| `deriveIdentity(dir, { primaryContactName })` | 1 | single-entry types: default `name` and `version` of the one entry. A multi-organism name must be unique across all organisms |
| `deriveDataset(dir, classDef, overrides.dataset)` | 1 | single-entry types: the one entry's `{ props, source }` (returned as a schemaVersion 1 record), checked against the class |
| `renderDataset(dir, entry, classDef)` | both | optional; one entry's `<dataset>` element with the type's own checks. Without it, `renderEntry` checks the props against the class |
```

Below the paragraph that starts "Genome code reads the annotation source…", add:

```markdown
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
with one `datasetName` or one delivery directory, and names each entry as
written (`<datasetClass> <name>`); write, publish, load, mark-ready,
prepare-delivery and `render-proposal.js --dataset`/`--artifacts` run it before
changing anything. Clash checks against organism files and sibling proposals
compare `datasetName`s by their written values (`sameDatasetName`).
`parseDatasetClass` returns `delivery: { dir, file }` for the three
`classes.xml` shapes: `manualGet common/empty` with an `ln -s` unpack, a
`manualGet` directory, or a `manualGet` file.
```

- [ ] **Step 2: `shared/resources/proposal-workflow.md`.** Replace

```markdown
`write-proposal.js` derives (`presenter.json`, `dataset.json` and, for RNA-seq,
the loading artifacts), because they are reviewed and may be hand-edited.
```

with

```markdown
`write-proposal.js` derives (`presenter.json`, `datasets.json` and, for the
sequencing types, the loading artifacts), because they are reviewed and may be
hand-edited.
```

and the three table rows

```markdown
| Identity | `manifest.json`: `organisms` (proposed abbreviations, each with its project), `datasetClass`, `name`, `version`, ticket, contacts | shared by every layer below |
```
```markdown
| Dataset class | `curated/dataset.json`: the class's per-dataset props (checked against `classes.xml`) and where the reads come from | the `<dataset>` entry in `Datasets/lib/xml/datasets/<Project>/<organismAbbrev>.xml` |
```
```markdown
| Loading artifacts | `curated/<abbrev>/samplesheet.csv`, `analysisConfig.xml`, `entity-sample.tsv` and `.yaml` (per organism), derived from the sample annotations and `dataset.json`, checked to agree at write, publish and load | `final/` files and STF corpus files, written at preprocessing |
```

with

```markdown
| Proposal | `manifest.json`: accession, type, `organisms` (proposed abbreviations, each with its project), annotation, staging, contacts, curator, ticket | shared by every layer below |
| Dataset entries | `curated/datasets.json`: one `{ datasetClass, name, version, props, source }` per dataset the proposal loads, props checked against `classes.xml`. A sequencing proposal has one; a genome gets its entries in preprocessing. Organism constants they reference are in `curated/organism.json` `constants` | one `<dataset>` element per entry, in order, in `Datasets/lib/xml/datasets/<Project>/<organismAbbrev>.xml` |
| Loading artifacts | `curated/<abbrev>/samplesheet.csv`, `analysisConfig.xml`, `entity-sample.tsv` and `.yaml` (per organism), derived from the sample annotations and the dataset entry, checked to agree at write, publish and load | `final/` files and STF corpus files, written at preprocessing |
```

Add after the table: "A proposal written before 3.0 keeps `datasetClass`, `name` and `version` in its manifest and its props in `curated/dataset.json`; 3.x reads it as one entry, and the next `write-proposal.js` run rewrites it as `datasets.json`."

- [ ] **Step 3: Skill docs.** In the six skill files listed above:
- replace every `curated/dataset.json` with `curated/datasets.json`, and every other `` `dataset.json` `` with `` `datasets.json` ``;
- in the three `step-4-write-proposal.md` files replace "`name` and `version` identify the dataset in the manifest." with "`name` and `version` identify the proposal's one dataset entry in `curated/datasets.json`.";
- `skills/propose-dnaseq/resources/step-4-write-proposal.md`: "`curated/datasets.json` holds the `dnaseqExperiment` class props:" → "`curated/datasets.json` holds one entry; its `props` are the `dnaseqExperiment` class props:";
- `skills/propose-chipseq/resources/step-4-write-proposal.md`: the same for `chipSeqExperiment`;
- `skills/propose-bulk-rnaseq/resources/step-4-write-proposal.md`: "`write-proposal.js` also derives `curated/datasets.json`: the per-dataset props" → "`write-proposal.js` also derives `curated/datasets.json`: one entry whose `props` are the per-dataset props".

Then run: `grep -rn "dataset\.json\|identify the dataset in the manifest" skills/*/SKILL.md skills/*/resources/step-*.md shared/resources/proposal-workflow.md docs/development.md`
Expected: only the "written before 3.0" sentences in `proposal-workflow.md` and `development.md` name `dataset.json`.

- [ ] **Step 4: Sync and commit**

```bash
yarn sync-shared
git add -A skills shared docs
git commit -m "Docs: dataset entries in curated/datasets.json

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 18: Version 3.0.0 and the full suite

**Files:**
- Modify: `package.json`, `.claude-plugin/plugin.json`

- [ ] **Step 1:** Set `"version": "3.0.0"` in both files.

- [ ] **Step 2: Run the whole suite**

Run: `yarn test`
Expected: all tests pass, including `tests/regression-goldens.test.js` (unchanged since Task 1 apart from its Task 15 addition), `tests/skill-imports.test.js` and `tests/import-graph.test.js` (`_common.js` imports `lib/artifacts.js`, which imports no dataset type).

- [ ] **Step 3: Commit**

```bash
git add package.json .claude-plugin/plugin.json
git commit -m "Dataset entries (3.0.0)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Judgment calls

Places where the spec was silent or met the code, and the reading taken:

1. **Validation is split in two.** `datasetsOf` checks shape: both files present, keys, name and version form, props as strings, `source`. It needs no `classes.xml`. `assertValidEntries` adds everything that needs classes or constants, identity included (Task 6b: the resolved `datasetName`, which needs the class's template; Task 3 first put a `(datasetClass, name)` duplicate check in `datasetsOf`). The spec says `datasetsOf` "returns validated entries"; this reads that as shape-valid, since a reader on a ref (sibling checks, resume) has no classes to hand.
2. **No new module.** Entries live in `dataset-types/_common.js`, beside the presenter and dataset record schemas, which `docs/development.md` names as the schema home. This keeps `package.json` `sharedFiles` unchanged. `resolveEntry`'s location was unspecified.
3. **`datasetsOf` takes a `read` function** (`readerOnRef(git, ref)`), so sibling checks, load, mark-ready and prepare-delivery read proposals on `origin/master` through the same single reader rather than a second one.
4. **Manifest identity beside `datasets.json` is refused**, not ignored. The spec lists only "both files present".
5. **An old `dataset.json` without `source` reads as `{ type: 'sra' }`**, as every reader defaulted it before. An old `dataset.json` must still be schemaVersion 1.
6. **Generic entry props may be empty strings** (the spec's own example has `"releaseDate": ""`; real organism files leave `releaseDate` and `table` empty). Single-entry types keep their stricter non-empty rule through `validateDataset`.
7. **`$$constants$$` a type requires at load also resolve (now in the spec).** Besides `organism.json` keys and the five organism-file constants, dnaseq's entry carries `ploidy: $$ploidy$$`, which `load --ploidy` supplies. `constantsFor` therefore also leaves the type's `requiredOrganismConstants` as references. Without this every dnaseq proposal fails validation.
8. **Organism-file constants stay `$$references$$` when resolving** (only `projectName` and `organismAbbrev` get real values, from the manifest). A delivery path that used, say, `$$strainAbbrev$$` would expand to a literal reference and not be flagged. No class in scope does this.
9. **`NoPreprocess_primary_genome_features` has no `name` prop** in `classes.xml`, and its `datasetName` template (`${organismAbbrev}_primary_genome_features_RSRC`) has no `${name}`. The entry still needs `name`, which only labels it here (its delivery path uses `${source}`); it is not rendered. Its organism-file clash check (`entryDatasetExists`) matches any existing dataset of the class, which is right: an organism has one. Genome organism files are not clash-checked anywhere yet, since load creating them is out of scope.
10. **Ticket and commit text.** The publish summary (ticket body, PR body, update comment) replaces `Name:`/`Version:` with one `Dataset: <class> <name> <version>` line per entry. The load commit subject and load PR body keep today's single-entry text byte-for-byte: it is pinned by tests, and a resume parses the subject. With several entries the subject says `<N> datasets` and the PR body has one `Dataset:` line per entry.
11. **Per-entry delivery checks run on the planned files before writing.** `writeDeliveryTree` builds `final/` only from those files, so this is the same check without leaving a bad tree behind. `stagingProblems`, `renderArtifacts`, `corpus` and `corpusFiles` become optional in `prepareDelivery`. A genome with entries is refused there until preprocessing supplies its files (out of scope).
12. **Load constants.** Every `organism.json` constant becomes a required organism-file constant (any non-empty value safe in an attribute), and its value is given. A data loader's command-line value wins on a clash. A differing value already in the organism file stops the load, using today's message, which names a `--<constant>` flag that only exists for `ploidy`.
13. **Resolved (spec updated):** a re-write carries a genome's entries and `organism.json` `constants` forward from the working tree, else master (`keptFromPreprocessing`, Task 14), the same rule as `staging`. A new genome proposal starts with `datasets: []` and no `constants`.
14. **Sibling proposals whose entries cannot be read are skipped** by the name-clash check, as unreadable manifests were. The test helper `plantProposalOnMaster` now plants identity as `curated/datasets.json`, and one new test plants the old shape.
15. **`deriveDataset` keeps returning `{ schemaVersion: 1, props, source }`.** `writeProposal` builds the entry from it, and the type `renderDataset` checks `datasetRecordOf(entry)`. This leaves the existing derive tests and golden records untouched.
16. **`renderDataset` becomes `(proposalDir, entry, classDef)`**, so seven test call sites change (assertions and goldens do not).
17. **Fixtures stay in the old shape** on purpose: every existing test then exercises the legacy reader. Task 15 proves the `datasets.json` shape gives identical output.
18. **Test edits beyond call signatures:** the build-fitness genome-stop test strips the rnaseq identity it used to spread into a genome manifest; the dnaseq and chipseq presenter-name tests use `staged(t)` (their fixtures have identity but no `dataset.json`); the manifest identity-validation test becomes "validate ignores identity".
19. **`datasetClass` names may contain underscores** (`fasta_primary_genome_sequence`). The old manifest rule did not allow them.
20. **Genome `datasetClasses` are the 14 loader classes** from the research table (sequence, features, `productNames`, GO, EC, `geneName`, `dbxref_synonym`, `comments`, `aliases`, `dbxref_simple`). It excludes `validateOrganismInfo`, which belongs to how load creates the organism file (out of scope).
21. **`bin/dropSamplesheetStrandednessColumn.js` is left alone.** It is a one-off migration over legacy proposals, which still have `dataset.json`.
22. **Classes come from where each step already reads them:** the checkout at write, publish, load and render; `origin/master` at mark-ready; the `--against` ref at prepare-delivery.
23. **Identity is the resolved `datasetName` (Task 6b, decided by the project owner).** Within a proposal it is compared resolved, per organism; organism-file constants stay `$$references$$`, so `$$strainAbbrev$$` and a literal strain abbreviation compare unequal. Against organism files and siblings (Task 9) the other side's constants are out of reach, so `sameDatasetName` compares the template's values as written, same class only. Both are sufficient, not necessary, conditions for a real collision. `(datasetClass, name)` remains the label in every message, ticket and commit line, so two alike-named entries (supercontig and contig) read the same there; the `datasetName` and delivery messages carry the resolved name or path.
24. **The distinct-delivery-directory check stays** beside the `datasetName` check. It refuses entries with distinct `datasetName`s that share a directory, such as two `aliases` entries with one `name` and different `target`s (`alias/${name}/${version}/final`).
