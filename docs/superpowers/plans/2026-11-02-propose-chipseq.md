# Propose ChIP-seq Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `propose-chipseq` skill and `chipseq` dataset type. Curators propose ChIP-seq (and MNase, FAIRE, DNase) experiments with input-control pairing. `load-proposals` renders them into the existing `chipSeqExperiment` class.

**Architecture:** First, the single-organism SRA plumbing in `dnaseq.js` moves into a factory, `dataset-types/_sra-experiment.js`. That's a pure refactor, and dnaseq's golden files prove nothing changed. `chipseq.js` then gets the shared parts from the factory and adds its own pieces:

- an `input` 4th samplesheet column
- pairing checks
- a derived `hasPairedEnds`
- `hasCalledPeaks` rendered from `experimentType`

It plugs into two generic hooks: optional samplesheet columns in `_sra-samples.js`, and an optional `curatedWarnings` dataset-type hook in `writeProposal`.

**Tech Stack:** Node 18 ESM, zero dependencies, `node:test`. Shared files are synced into skills by `bin/sync-shared.js`, configured in `package.json` `sharedFiles`.

**Spec:** `docs/superpowers/specs/2026-10-30-propose-chipseq-design.md`

---

## Ground rules for every task

- Work in the worktree from Task 0, on branch `propose-chipseq`. Never commit to `main`.
- Edit `shared/`. Never edit the copies under `skills/*/scripts`: the pre-commit hook runs `yarn sync-shared` and overwrites them. A new shared file needs a `package.json` `sharedFiles` entry, or `tests/skill-imports.test.js` fails.
- Run tests with `yarn test`; a single file is `node --test tests/<file>.test.js`. Baseline on `main` (6b4f129): **895 pass, 0 fail, 5 skipped**.
- Comments: only where the code is not self-describing, at most 2–3 lines. Match the JSDoc one-liners in `shared/scripts/dataset-types/dnaseq.js`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- `gh`: run `unset GITHUB_TOKEN` first.

## Facts the tasks rely on (verified 2026-11-02)

- The `chipSeqExperiment` class in VEuPathDatasets origin/master (a6a0b1eef):
  - props `projectName, organismAbbrev, name, version, hasPairedEnds, extraBowtieParams, experimentType, fromSRA, readsFileType`
  - loader `${organismAbbrev}_${name}_chipSeq_RSRC`
  - delivery `@@manualDeliveryDir@@/${projectName}/${organismAbbrev}/chipSeq/${name}/${version}/final/`
  - it unpacks `final/samplesheet.csv`
- bowtie-mapping-nextflow reads the samplesheet by position: `[id: row[0], ref: row[3]]`. The header is ignored.
- Peaks are gated only by `experimentType == 'histonemod'`, in both ApiCommonWorkflow and the Nextflow pipeline.
- `extraBowtieParams` is empty in nearly every existing entry. `validateDataset` currently requires every class prop to be non-empty, so Task 4 adds `optionalProps`.
- `prepare-delivery.js` does not run ngs-samples-nextflow, so it needs no `assayType`.

## File structure

| File | Responsibility |
|---|---|
| `shared/scripts/dataset-types/_sra-samples.js` (modify) | `samplesheet` / `parseSamplesheet` take an optional column list; extra columns come from the sample field of the same name |
| `shared/scripts/lib/library-checks.js` (modify) | `libraryProblems(runs, { used, strategies })`; strategies default to `['WGS']` |
| `shared/scripts/check-library.js` (modify) | `--type <datasetType>` picks that type's `libraryStrategies` |
| `shared/scripts/dataset-types/_sra-experiment.js` (create) | Factory for single-organism SRA types: normalize, artifacts, agreement check, render artifacts, corpus |
| `shared/scripts/dataset-types/dnaseq.js` (modify) | Uses the factory; keeps presenter, dataset and organism rules |
| `shared/scripts/dataset-types/_common.js` (modify) | `validateDataset` accepts `optionalProps` |
| `shared/scripts/lib/proposal-ops.js` (modify) | Calls the optional `datasetType.curatedWarnings(dir)` after the agreement check |
| `shared/scripts/dataset-types/chipseq.js` (create) | The `chipseq` type |
| `shared/scripts/dataset-types/index.js`, `validators.js` (modify) | Register `chipseq` and its validation workspace name |
| `shared/resources/curator.config.json` (modify) | `typeLabels.chipseq` |
| `tests/fixtures/classes.xml` (modify) | Add the `chipSeqExperiment` class |
| `tests/fixtures/proposals/PRJNA000011/` (create) | chipseq fixture |
| `tests/dataset-types-chipseq.test.js` (create) | chipseq tests |
| `skills/propose-chipseq/` (create) | Skill docs |
| `package.json`, `.claude-plugin/plugin.json` (modify) | `sharedFiles`, version 2.6.0 |

---

### Task 0: Worktree and branch

- [ ] **Step 1: Create the worktree and carry the spec and plan over**

The spec and this plan are untracked files in the main checkout.

```bash
cd /home/jbrestel/workspaces/src/dataset-curator
git fetch origin && git worktree add -b propose-chipseq ../dataset-curator-chipseq origin/main
mkdir -p ../dataset-curator-chipseq/docs/superpowers/specs ../dataset-curator-chipseq/docs/superpowers/plans
mv docs/superpowers/specs/2026-10-30-propose-chipseq-design.md ../dataset-curator-chipseq/docs/superpowers/specs/
mv docs/superpowers/plans/2026-11-02-propose-chipseq.md ../dataset-curator-chipseq/docs/superpowers/plans/
cd ../dataset-curator-chipseq && yarn install --frozen-lockfile && yarn test 2>&1 | tail -6
```

Expected: `pass 895`, `fail 0`.

- [ ] **Step 2: Commit the docs**

```bash
git add docs/superpowers
git commit -m "ChIP-seq proposal spec and plan

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

All later paths are relative to `/home/jbrestel/workspaces/src/dataset-curator-chipseq`.

---

### Task 1: Optional samplesheet columns

**Files:**
- Modify: `shared/scripts/dataset-types/_sra-samples.js` (`SAMPLESHEET_HEADER`, `samplesheet`, `parseSamplesheet`, near the end of the file)
- Test: `tests/sra-samples.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `tests/sra-samples.test.js`:

```js
const CHIP = [...sra.SAMPLESHEET_COLUMNS, 'input'];

test('samplesheet writes extra columns from the sample field of that name, empty when absent', () => {
  const text = sra.samplesheet([
    { sampleId: 'H3_ChIP', runs: ['SRR2'], input: 'H3_Input' },
    { sampleId: 'H3_Input', runs: ['SRR1'] }
  ], { columns: CHIP });
  assert.equal(text, 'sample,fastq_1,fastq_2,input\nH3_ChIP,SRR2,,H3_Input\nH3_Input,SRR1,,\n');
});

test('parseSamplesheet with extra columns checks the header and width and returns extra cells by name', () => {
  const sheet = sra.parseSamplesheet('sample,fastq_1,fastq_2,input\nH3_ChIP,SRR2,,H3_Input\nH3_Input,SRR1,,\n', { columns: CHIP });
  assert.deepEqual(sheet.errors, []);
  assert.deepEqual(sheet.rows.map((r) => [r.sample, r.extra.input]), [['H3_ChIP', 'H3_Input'], ['H3_Input', '']]);
  assert.deepEqual(sra.parseSamplesheet('sample,fastq_1,fastq_2\nA,SRR1,\n', { columns: CHIP }).errors, [
    'samplesheet.csv header must be sample,fastq_1,fastq_2,input',
    'samplesheet.csv line 2 has 3 columns; expected 4'
  ]);
});
```

In the existing test `parseSamplesheet returns rows with line numbers and refuses the old 4-column header`, change the expected row to include the new key:

```js
    errors: [], rows: [{ line: 2, sample: 'A', fastq1: 'SRR1', fastq2: '', extra: {} }]
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `node --test tests/sra-samples.test.js`
Expected: FAIL. `SAMPLESHEET_COLUMNS` is undefined, and the existing row has no `extra`.

- [ ] **Step 3: Implement**

In `shared/scripts/dataset-types/_sra-samples.js`, replace `SAMPLESHEET_HEADER`, `samplesheet` and `parseSamplesheet` with:

```js
export const SAMPLESHEET_COLUMNS = ['sample', 'fastq_1', 'fastq_2'];
export const SAMPLESHEET_HEADER = SAMPLESHEET_COLUMNS.join(',');

/**
 * One row per run or files entry. An SRA run appears once with fastq_2 empty;
 * downstream expands the run into its paired files. Columns past fastq_2 take
 * the sample's field of the same name, empty when absent.
 */
export function samplesheet(samples, { columns = SAMPLESHEET_COLUMNS } = {}) {
  const extra = (s) => columns.slice(SAMPLESHEET_COLUMNS.length).map((c) => s[c] ?? '');
  const rows = samples
    .flatMap((s) => (s.files
      ? s.files.map((f) => [s.sampleId, f.fastq_1, f.fastq_2 ?? '', ...extra(s)])
      : (s.runs || []).map((run) => [s.sampleId, run, '', ...extra(s)])))
    .sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
  return [columns.join(','), ...rows.map((r) => r.join(','))].join('\n') + '\n';
}

export function parseSamplesheet(text, { columns = SAMPLESHEET_COLUMNS } = {}) {
  const [header, ...lines] = text.split(/\r?\n/);
  const expected = columns.join(',');
  const errors = header.trim() === expected ? [] : [`samplesheet.csv header must be ${expected}`];
  const extraColumns = columns.slice(SAMPLESHEET_COLUMNS.length);
  const rows = lines
    .map((l, i) => ({ l: l.trim(), line: i + 2 }))
    .filter(({ l }) => l)
    .map(({ l, line }) => {
      const cells = l.split(',').map((c) => c.trim());
      const [sample, fastq1, fastq2] = cells;
      if (cells.length !== columns.length) errors.push(`samplesheet.csv line ${line} has ${cells.length} columns; expected ${columns.length}`);
      else if (!sample) errors.push(`samplesheet.csv line ${line} has no sample`);
      else if (!fastq1) errors.push(`samplesheet.csv line ${line} (${sample}) has no fastq_1`);
      const extra = Object.fromEntries(extraColumns.map((c, i) => [c, cells[SAMPLESHEET_COLUMNS.length + i] ?? '']));
      return { line, sample, fastq1, fastq2: fastq2 ?? '', extra };
    });
  return { errors, rows };
}
```

- [ ] **Step 4: Run the full suite**

Run: `yarn test 2>&1 | tail -6`
Expected: `fail 0`. The dnaseq and bulk-rnaseq samplesheets are byte-identical, so their golden tests still pass.

- [ ] **Step 5: Commit**

```bash
git add shared/scripts/dataset-types/_sra-samples.js tests/sra-samples.test.js
git commit -m "Samplesheet helpers take optional extra columns

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Library strategies per dataset type

**Files:**
- Modify: `shared/scripts/lib/library-checks.js` (`libraryProblems` signature, and the `library_strategy` warning)
- Modify: `shared/scripts/check-library.js`
- Modify: `shared/scripts/dataset-types/dnaseq.js` (export `libraryStrategies`)
- Test: `tests/library-checks.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `tests/library-checks.test.js`:

```js
test('strategies replace the WGS expectation, and the warning names them all', () => {
  assert.deepEqual(libraryProblems([run({ library_strategy: 'ChIP-Seq' })], { strategies: ['ChIP-Seq', 'WGS'] }).warnings, []);
  assert.deepEqual(libraryProblems([run({ library_strategy: 'RNA-Seq' })], { strategies: ['ChIP-Seq', 'WGS'] }).warnings, [
    'SRR1: library_strategy is RNA-Seq, not ChIP-Seq or WGS'
  ]);
});
```

Next, add a CLI test. Find the existing test in this file that runs `check-library.js` with `spawnSync` (it writes `.curation/tmp/<acc>_sra_metadata.json` in a temp directory). Copy it as a new test, changing the run to `library_strategy: 'ChIP-Seq'` and the arguments to `[script, 'PRJNA1', '--type', 'dnaseq']`. Assert exit status 0 and that stderr contains `library_strategy is ChIP-Seq, not WGS`. That proves `--type` resolves through the registry. Task 6 adds the chipseq case.

- [ ] **Step 2: Run them and confirm they fail**

Run: `node --test tests/library-checks.test.js`
Expected: FAIL. The ChIP-Seq run warns `not WGS`, and `--type` is treated as the accession.

- [ ] **Step 3: Implement `strategies`**

In `shared/scripts/lib/library-checks.js`, change the signature and the warning:

```js
export function libraryProblems(runs, { used, strategies = ['WGS'] } = {}) {
```

```js
    if (!strategies.includes(r.library_strategy)) warnings.push(`${id}: library_strategy is ${r.library_strategy || 'missing'}, not ${strategies.join(' or ')}`);
```

Update its JSDoc's first line to: `Quick checks that ENA runs are DNA sequencing with reads of an expected library strategy.`

- [ ] **Step 4: `dnaseq` declares its strategies**

In `shared/scripts/dataset-types/dnaseq.js`, add after `requiredOrganismConstants`:

```js
export const libraryStrategies = ['WGS'];
```

In `deriveDataset`, pass the strategies:

```js
  const { errors } = libraryProblems(runs, { used, strategies: libraryStrategies });
```

- [ ] **Step 5: `check-library.js --type`**

Replace the argument handling and the `libraryProblems` call in `shared/scripts/check-library.js`:

```js
import { DATASET_TYPES } from './dataset-types/index.js';

const args = process.argv.slice(2);
const typeAt = args.indexOf('--type');
const type = typeAt >= 0 ? args[typeAt + 1] : undefined;
const accession = args.find((a, i) => !a.startsWith('--') && (typeAt < 0 || i !== typeAt + 1));
const usage = `Usage: node check-library.js <accession> [--type ${Object.keys(DATASET_TYPES).join('|')}]`;
if (!accession || (typeAt >= 0 && !DATASET_TYPES[type]?.libraryStrategies)) { console.error(usage); process.exit(1); }
const strategies = type ? DATASET_TYPES[type].libraryStrategies : undefined;
```

```js
const { projectErrors, runErrors, warnings } = libraryProblems(JSON.parse(readFileSync(path, 'utf-8')).runs ?? [], { strategies });
```

Update the header comment's usage line to `Usage: node check-library.js <accession> [--type <datasetType>]`, and change "are DNA sequencing with reads" to "are DNA sequencing with reads of the type's library strategies (WGS by default)".

- [ ] **Step 6: Add `dataset-types/index.js` to `check-library.js`'s skills**

`check-library.js` now imports the registry. In `package.json` `sharedFiles`, confirm that every skill listed for `scripts/check-library.js` is also listed for `scripts/dataset-types/index.js`. Today that's only `propose-dnaseq`, and it already has the registry.

- [ ] **Step 7: Run, sync, commit**

```bash
yarn sync-shared && yarn test 2>&1 | tail -6
git add -A shared skills tests
git commit -m "Library checks take the dataset type's expected strategies

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: `fail 0`.

---

### Task 3: Extract `_sra-experiment.js` from `dnaseq.js` (pure refactor)

**Files:**
- Create: `shared/scripts/dataset-types/_sra-experiment.js`
- Modify: `shared/scripts/dataset-types/dnaseq.js`
- Modify: `package.json` (`sharedFiles`)
- Test: `tests/dataset-types-dnaseq.test.js` (unchanged; it is the regression test), `tests/sra-experiment.test.js` (create)

- [ ] **Step 1: Write a failing test for the factory's surface**

Create `tests/sra-experiment.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sraExperimentType } from '../shared/scripts/dataset-types/_sra-experiment.js';
import * as dnaseq from '../shared/scripts/dataset-types/dnaseq.js';

const SHARED = ['derivedCuratedFiles', 'presenterNames', 'normalizeCurated', 'deriveArtifacts', 'checkCurated', 'assertCuratedAgree', 'renderArtifacts', 'corpusFiles', 'stagingProblems'];

test('the factory returns every shared export, and dnaseq exports them', () => {
  const shared = sraExperimentType({ type: 't', datasetClass: 'c', datasetNameFor: (o, n) => `${o}_${n}` });
  assert.deepEqual(Object.keys(shared).sort(), [...SHARED].sort());
  for (const name of SHARED) assert.equal(typeof dnaseq[name], typeof shared[name], name);
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `node --test tests/sra-experiment.test.js`
Expected: FAIL with `Cannot find module .../_sra-experiment.js`.

- [ ] **Step 3: Create the factory**

Create `shared/scripts/dataset-types/_sra-experiment.js`:

```js
/** What single-organism SRA experiment types share: annotations, loading artifacts, the agreement check and the corpus. */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadManifest, readInputJson, readCuratedJson, requireIdentity, assertCuratedAgreeWith } from './_common.js';
import {
  DEFAULT_SOURCE, SAMPLESHEET_COLUMNS, normalizeSamples, samplesheet, parseSamplesheet, checkSamplesAgree, checkSampleRuns, checkSampleProvenance
} from './_sra-samples.js';
import { sampleAnnotationsToStf } from '../lib/stf.js';
import { organismsOf } from '../lib/manifest.js';

export const annotationsFile = (m) => `${m.accession}_sample_annotations.json`;
export const sraFile = (m) => `${m.accession}_sra_metadata.json`;
export const runsOf = (proposalDir, m) => readInputJson(proposalDir, sraFile(m)).runs || [];
export const organismOf = (m) => organismsOf(m)[0];
/** The run accessions the curated annotations keep. */
export const usedRuns = (proposalDir, m) => new Set((readCuratedJson(proposalDir, annotationsFile(m)).samples ?? []).flatMap((s) => s.runs ?? []));

const DERIVED_CURATED_FILES = ['samplesheet.csv', 'entity-sample.tsv', 'entity-sample.yaml'];
const abbrevOf = (m) => m.organisms[0].proposedOrganismAbbrev;
const curatedText = (proposalDir, abbrev, file) => readFileSync(join(proposalDir, 'curated', abbrev, file), 'utf-8');

/**
 * The shared exports of a single-organism, SRA-only type. columns is its samplesheet;
 * stfAnnotations adds type-specific STF columns; extraChecks({ proposalDir, annotations, sheet, versus }) adds agreement errors.
 */
export function sraExperimentType({ type, datasetClass, datasetNameFor, columns = SAMPLESHEET_COLUMNS, stfAnnotations = (a) => a, extraChecks = () => [] }) {
  function presenterNames(proposalDir) {
    const m = loadManifest(proposalDir);
    requireIdentity(m, datasetClass);
    return [datasetNameFor(organismOf(m), m.name)];
  }

  /** Phase 1: rewrites the staged annotations in normalized form; SRA only, one organism. */
  function normalizeCurated(proposalDir, datasetOverrides = {}) {
    const m = loadManifest(proposalDir);
    if (datasetOverrides?.source && datasetOverrides.source.type !== 'sra') throw new Error(`${type} reads from SRA only`);
    const annotations = readCuratedJson(proposalDir, annotationsFile(m));
    if (annotations.samples?.some((s) => s.organisms !== undefined)) throw new Error(`${type} proposals are single-organism; remove "organisms" from the samples in ${annotationsFile(m)}`);
    const normalized = normalizeSamples(annotations, runsOf(proposalDir, m), { source: DEFAULT_SOURCE });
    writeFileSync(join(proposalDir, 'curated', annotationsFile(m)), JSON.stringify(normalized, null, 2) + '\n');
  }

  /** Phase 1: the organism's loading artifacts, keyed <proposed abbreviation>/<file>. */
  function deriveArtifacts(proposalDir) {
    const m = loadManifest(proposalDir);
    requireIdentity(m, datasetClass);
    const annotations = readCuratedJson(proposalDir, annotationsFile(m));
    const p = abbrevOf(m);
    const { tsv, yaml } = sampleAnnotationsToStf(stfAnnotations(annotations), { sra: true });
    return { [`${p}/samplesheet.csv`]: samplesheet(annotations.samples, { columns }), [`${p}/entity-sample.tsv`]: tsv, [`${p}/entity-sample.yaml`]: yaml };
  }

  /** Errors when the curated artifacts and the sample annotations disagree. */
  function checkCurated(proposalDir) {
    const m = loadManifest(proposalDir);
    const p = abbrevOf(m);
    const name = annotationsFile(m);
    const missing = [name, ...DERIVED_CURATED_FILES.map((f) => `${p}/${f}`)].filter((f) => !existsSync(join(proposalDir, 'curated', f)));
    if (missing.length) return missing.map((f) => `curated/${f} is missing; re-run write-proposal.js`);
    let annotations;
    try { annotations = JSON.parse(readFileSync(join(proposalDir, 'curated', name), 'utf-8')); }
    catch (e) { return [`${name} is not valid JSON: ${e.message}`]; }
    if (annotations === null || typeof annotations !== 'object' || Array.isArray(annotations)) return [`${name} must be a JSON object`];
    if (!Array.isArray(annotations.samples)) return [`${name} has no "samples" array`];
    const text = curatedText(proposalDir, p, 'samplesheet.csv');
    const tsv = curatedText(proposalDir, p, 'entity-sample.tsv');
    const sheet = parseSamplesheet(text, { columns });
    return [
      ...sheet.errors,
      ...sheet.rows.filter((r) => r.fastq2).map((r) => `samplesheet.csv line ${r.line} (${r.sample}) has a fastq_2, but an SRA source lists each run once`),
      ...checkSamplesAgree({ samplesheet: text, tsv, sampleIds: annotations.samples.map((s) => s.sampleId), versus: name }),
      ...checkSampleRuns({ samplesheet: text, samples: annotations.samples, versus: name }),
      ...checkSampleProvenance({ tsv, samples: annotations.samples, versus: name }),
      ...extraChecks({ proposalDir, annotations, sheet, versus: name })
    ];
  }

  const assertCuratedAgree = assertCuratedAgreeWith(checkCurated);

  /** Phase 2 (and the Phase 1 preview): the curated artifacts laid out for the delivery directory. */
  function renderArtifacts(proposalDir) {
    const m = loadManifest(proposalDir);
    requireIdentity(m, datasetClass);
    assertCuratedAgree(proposalDir);
    return {
      files: {
        'samplesheet.csv': curatedText(proposalDir, abbrevOf(m), 'samplesheet.csv'),
        'sampleAnnotations.json': readFileSync(join(proposalDir, 'curated', annotationsFile(m)), 'utf-8')
      }
    };
  }

  function corpusFiles(proposalDir) {
    const p = abbrevOf(loadManifest(proposalDir));
    return { 'entity-sample.tsv': curatedText(proposalDir, p, 'entity-sample.tsv'), 'entity-sample.yaml': curatedText(proposalDir, p, 'entity-sample.yaml') };
  }

  return {
    derivedCuratedFiles: DERIVED_CURATED_FILES, presenterNames, normalizeCurated, deriveArtifacts, checkCurated, assertCuratedAgree, renderArtifacts, corpusFiles,
    stagingProblems: () => []
  };
}
```

`checkSamplesAgree` and `checkSampleRuns` parse the sheet with the default columns. They read only `sample` and `fastq_1`, which come first in every layout, so they don't need `columns`.

- [ ] **Step 4: Rewrite `dnaseq.js` on the factory**

Replace the top of `shared/scripts/dataset-types/dnaseq.js` (imports through `export const deriveIdentity`), then delete `presenterNames`, `normalizeCurated`, `deriveArtifacts`, `checkCurated`, `assertCuratedAgree`, `renderArtifacts`, `corpusFiles` and `stagingProblems` from the bottom. The result keeps `releasedOrganism`, `derivePresenter`, `renderPresenter`, `deriveDataset`, `renderDataset` and `corpus`:

```js
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  loadManifest, readInputJson, readPresenter, applyOverrides, requireIdentity, readDataset,
  assertValidDataset, datasetElement, PRESENTER_SCHEMA_VERSION, DATASET_SCHEMA_VERSION, escapeXml, injectorProps,
  requireBuild, presenterBodyXml
} from './_common.js';
import { DEFAULT_SOURCE, bioprojectLinks, methodologyFrom } from './_sra-samples.js';
import { sraExperimentType, annotationsFile, runsOf, usedRuns, organismOf } from './_sra-experiment.js';
import { libraryProblems } from '../lib/library-checks.js';

export const datasetClass = 'dnaseqExperiment';
export const injectorDefaults = { hasCNVData: 'false' };
export const requiredFields = ['shortDisplayName', 'shortAttribution'];
export const requiredInjectorProps = ['hasCNVData'];
/** Gene CNV needs orthomcl paralogs, so the organism must already be released. */
export const organismRule = { new: false, max: 1, pending: 'refuse' };
/** Organism-file constants the dataset entry references; load checks them and inserts any missing. */
export const requiredOrganismConstants = { ploidy: /^[1-9]\d*$/ };
export const libraryStrategies = ['WGS'];

const INJECTOR = 'org.apidb.apicommon.model.datasetInjector.IsolatesHTS';
export const datasetNameFor = (organism, name) => `${organism}_${name}_dnaseqExperiment_RSRC`;
export { annotationsFile };
const releasedFile = (m) => `${m.accession}_released_organism.json`;

export const {
  derivedCuratedFiles, presenterNames, normalizeCurated, deriveArtifacts, checkCurated, assertCuratedAgree, renderArtifacts, corpusFiles, stagingProblems
} = sraExperimentType({ type: 'dnaseq', datasetClass, datasetNameFor });

/** No GEO series dates a DNA-seq proposal, so the curator supplies name and version. */
export const deriveIdentity = () => ({ version: undefined, name: undefined });
```

In `deriveDataset`, replace the two lines that compute `runs` and `used` with:

```js
  const runs = runsOf(proposalDir, m);
  const used = usedRuns(proposalDir, m);
```

`derivePresenter` and `renderPresenter` keep their bodies. They already call `runsOf(proposalDir, m)` and `organismOf(m)`, which are now imported. Remove the old local `sraFile`, `runsOf` and `organismOf` definitions. `corpus` stays as it is.

- [ ] **Step 5: Share the factory**

In `package.json` `sharedFiles`, add an entry listing exactly the skills that `scripts/dataset-types/dnaseq.js` lists:

```json
"scripts/dataset-types/_sra-experiment.js": ["propose-genome-assembly", "propose-bulk-rnaseq", "propose-dnaseq", "load-proposals", "verify-bulk-rnaseq"],
```

(Copy the list from the `dnaseq.js` entry if it differs from this one.)

- [ ] **Step 6: Run everything**

```bash
yarn sync-shared && yarn test 2>&1 | tail -6
```

Expected: `fail 0`. `tests/dataset-types-dnaseq.test.js` passes unchanged, including both golden files. So do `load-ops.test.js` (PRJNA000010 load) and `skill-imports.test.js`. If a dnaseq test fails, the refactor changed behavior: fix the code, not the test.

- [ ] **Step 7: Commit**

```bash
git add -A shared skills tests package.json
git commit -m "Extract the single-organism SRA experiment factory from dnaseq

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Optional dataset props

**Files:**
- Modify: `shared/scripts/dataset-types/_common.js` (`validateDataset`)
- Test: `tests/dataset-types.test.js`

- [ ] **Step 1: Write the failing test**

Append to `tests/dataset-types.test.js` (it already imports from `_common.js`; add `validateDataset` and `DATASET_SCHEMA_VERSION` to that import if missing):

```js
test('validateDataset lets optionalProps be empty but still requires them as strings', () => {
  const classDef = { className: 'c', props: ['projectName', 'organismAbbrev', 'name', 'version', 'a', 'b'] };
  const record = (props) => ({ schemaVersion: DATASET_SCHEMA_VERSION, props, source: { type: 'sra' } });
  assert.deepEqual(validateDataset(record({ a: 'x', b: '' }), classDef, { optionalProps: ['b'] }), []);
  assert.deepEqual(validateDataset(record({ a: 'x', b: '' }), classDef, {}), ['props.b is required by class c']);
  assert.deepEqual(validateDataset(record({ a: 'x' }), classDef, { optionalProps: ['b'] }), ['props.b is required by class c']);
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `node --test tests/dataset-types.test.js`
Expected: FAIL on the first assertion: the empty `b` is reported as required.

- [ ] **Step 3: Implement**

In `validateDataset` in `shared/scripts/dataset-types/_common.js`:

```js
/**
 * The record against its classes.xml class: exactly the class's props other
 * than identity, as strings (empty only for optionalProps), plus a read source the data loaders can reach.
 */
export function validateDataset(d, classDef, opts = {}) {
  const optional = opts.optionalProps ?? [];
```

```js
    for (const p of expected) {
      const v = d.props[p];
      if (typeof v !== 'string' || (v === '' && !optional.includes(p))) errors.push(`props.${p} is required by class ${classDef.className}`);
    }
```

- [ ] **Step 4: Run and commit**

```bash
yarn test 2>&1 | tail -6
git add shared/scripts/dataset-types/_common.js tests/dataset-types.test.js
git commit -m "validateDataset: optional props may be empty

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: `fail 0`.

---

### Task 5: The `curatedWarnings` hook

**Files:**
- Modify: `shared/scripts/lib/proposal-ops.js` (the `if (datasetType.deriveArtifacts)` block in `writeProposal`, around line 370)
- Modify: `docs/development.md` (dataset-type contract table)

`writeProposal` runs inside staged temp directories and real dataset types, so a unit test would need a full proposal repository. This is a two-line, pure pass-through. It is verified by the chipseq unit tests (Task 6) and the end-to-end run (Task 9) instead.

- [ ] **Step 1: Call the hook**

After `datasetType.assertCuratedAgree?.(staged);`:

```js
        for (const w of datasetType.curatedWarnings?.(staged) ?? []) warn(`Warning: ${w}`);
```

- [ ] **Step 2: Document it**

In `docs/development.md`, add a row to the dataset-type contract table after `checkCurated(dir), assertCuratedAgree(dir)`:

```markdown
| `curatedWarnings(dir)` | 1 | optional; warnings about the curated records that `write-proposal.js` prints for the curator after the agreement check passes |
```

- [ ] **Step 3: Run and commit**

```bash
yarn test 2>&1 | tail -6
git add shared/scripts/lib/proposal-ops.js docs/development.md
git commit -m "writeProposal prints a dataset type's curatedWarnings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The `chipseq` dataset type

**Files:**
- Modify: `tests/fixtures/classes.xml`
- Create: `tests/fixtures/proposals/PRJNA000011/manifest.json`, `inputs/PRJNA000011_sra_metadata.json`, `curated/PRJNA000011_sample_annotations.json`, `expected.xml`, `expected-dataset.xml`
- Create: `shared/scripts/dataset-types/chipseq.js`
- Create: `tests/dataset-types-chipseq.test.js`

- [ ] **Step 1: Add the class to the fixture classes.xml**

In `tests/fixtures/classes.xml`, add this after the `dnaseqExperiment` class (the same text as VEuPathDatasets a6a0b1eef):

```xml
  <datasetClass class="chipSeqExperiment" category="" datasetFileHint="">
    <purpose></purpose>
    <prop name="projectName">&projectName;</prop>
    <prop name="organismAbbrev">&organismAbbrev;</prop>
    <prop name="name">&name;</prop>
    <prop name="version">&version;</prop>
    <prop name="hasPairedEnds"/>
    <prop name="extraBowtieParams"/>
    <prop name="experimentType">[histonemod, histonemod_noInput, tfbinding, mnase, faire, dnase] The type of experiment, controlled vocabulary. All samples in the same experiment MUST be of the same type (e.g. you cannot have some faire and some mnase samples in the same experiment). The experimentType can be set to histonemod only if it has input samples</prop>
    <prop name="fromSRA"/>
    <prop name="readsFileType">[fasta, fastq]</prop>

    <graphTemplateFile name="chipSeqExperiment.xml"/>
    <datasetLoader datasetName="${organismAbbrev}_${name}_chipSeq_RSRC" version="${version}"
	      plugin="ApiCommonData::Load::Plugin::LoadNothing"
              scope="organism"
              type="transcript_expression"
              subType="chipseq"
              organismAbbrev="${organismAbbrev}">
      <manualGet fileOrDir="common/empty">
        <dir name="final">
        </dir>
      </manualGet>
      <unpack>ln -s @@manualDeliveryDir@@/${projectName}/${organismAbbrev}/chipSeq/${name}/${version}/final/ @@dataDir@@/final</unpack>
      <getAndUnpackOutput dir="@@dataDir@@/final" />
      <getAndUnpackOutput file="@@dataDir@@/final/samplesheet.csv"/>
      <pluginArgs>--dbRefExternalDatabaseSpec "%DATASET_NAME%|%DATASET_VERSION%"</pluginArgs>
    </datasetLoader>
  </datasetClass>
```

- [ ] **Step 2: Create the fixture proposal**

`tests/fixtures/proposals/PRJNA000011/manifest.json`:

```json
{
  "schemaVersion": 4,
  "accession": "PRJNA000011",
  "externalIds": { "bioproject": "PRJNA000011" },
  "datasetType": "chipseq",
  "organisms": [{ "proposedOrganismAbbrev": "tfakST1", "source": "loaded", "project": "FungiDB" }],
  "datasetClass": "chipSeqExperiment",
  "name": "Doe_histone_2025",
  "version": "2025-04-01",
  "contacts": { "primary": "jane.doe", "additional": [] },
  "curator": "someone@apidb.org",
  "createdAt": "2026-11-02T12:00:00.000Z",
  "skill": { "name": "propose-chipseq", "version": "2.6.0" }
}
```

`tests/fixtures/proposals/PRJNA000011/inputs/PRJNA000011_sra_metadata.json`. Two inputs, two ChIPs, and one ChIP with two runs of one SRX:

```json
{
  "bioproject": "PRJNA000011",
  "runs": [
    { "run_accession": "SRR21", "sample_accession": "SAMN21", "experiment_accession": "SRX21", "sample_title": "BF H3 input", "scientific_name": "Testus fakeus", "library_source": "GENOMIC", "library_strategy": "ChIP-Seq", "library_selection": "ChIP", "library_layout": "SINGLE", "instrument_platform": "ILLUMINA", "instrument_model": "Illumina NovaSeq 6000", "read_count": "5000000", "base_count": "500000000", "experiment_title": "ChIP-seq of Testus fakeus histone marks" },
    { "run_accession": "SRR22", "sample_accession": "SAMN22", "experiment_accession": "SRX22", "sample_title": "BF H3 ChIP", "scientific_name": "Testus fakeus", "library_source": "GENOMIC", "library_strategy": "ChIP-Seq", "library_selection": "ChIP", "library_layout": "SINGLE", "instrument_platform": "ILLUMINA", "instrument_model": "Illumina NovaSeq 6000", "read_count": "5000000", "base_count": "500000000", "experiment_title": "ChIP-seq of Testus fakeus histone marks" },
    { "run_accession": "SRR23", "sample_accession": "SAMN23", "experiment_accession": "SRX23", "sample_title": "BF K125ac input", "scientific_name": "Testus fakeus", "library_source": "GENOMIC", "library_strategy": "ChIP-Seq", "library_selection": "ChIP", "library_layout": "SINGLE", "instrument_platform": "ILLUMINA", "instrument_model": "Illumina NovaSeq 6000", "read_count": "5000000", "base_count": "500000000", "experiment_title": "ChIP-seq of Testus fakeus histone marks" },
    { "run_accession": "SRR24", "sample_accession": "SAMN24", "experiment_accession": "SRX24", "sample_title": "BF K125ac ChIP", "scientific_name": "Testus fakeus", "library_source": "GENOMIC", "library_strategy": "ChIP-Seq", "library_selection": "ChIP", "library_layout": "SINGLE", "instrument_platform": "ILLUMINA", "instrument_model": "Illumina NovaSeq 6000", "read_count": "3000000", "base_count": "300000000", "experiment_title": "ChIP-seq of Testus fakeus histone marks" },
    { "run_accession": "SRR25", "sample_accession": "SAMN24", "experiment_accession": "SRX24", "sample_title": "BF K125ac ChIP", "scientific_name": "Testus fakeus", "library_source": "GENOMIC", "library_strategy": "ChIP-Seq", "library_selection": "ChIP", "library_layout": "SINGLE", "instrument_platform": "ILLUMINA", "instrument_model": "Illumina NovaSeq 6000", "read_count": "3000000", "base_count": "300000000", "experiment_title": "ChIP-seq of Testus fakeus histone marks" }
  ]
}
```

`tests/fixtures/proposals/PRJNA000011/curated/PRJNA000011_sample_annotations.json`:

```json
{
  "samples": [
    { "sampleId": "BF_H3_Input", "label": "BF H3 input", "role": "input", "runs": ["SRR21"], "factors": { "target": "H3", "life_stage": "bloodstream form" } },
    { "sampleId": "BF_H3_ChIP", "label": "BF H3", "role": "chip", "input": "BF_H3_Input", "runs": ["SRR22"], "factors": { "target": "H3", "life_stage": "bloodstream form" } },
    { "sampleId": "BF_K125ac_Input", "label": "BF H3K125ac input", "role": "input", "runs": ["SRR23"], "factors": { "target": "H3K125ac", "life_stage": "bloodstream form" } },
    { "sampleId": "BF_K125ac_ChIP", "label": "BF H3K125ac", "role": "chip", "input": "BF_K125ac_Input", "runs": ["SRR24", "SRR25"], "factors": { "target": "H3K125ac", "life_stage": "bloodstream form" } }
  ],
  "factors": { "target": { "displayName": "Target" }, "life_stage": { "displayName": "Life stage" } }
}
```

`tests/fixtures/proposals/PRJNA000011/expected-dataset.xml`:

```xml
  <dataset class="chipSeqExperiment">
    <prop name="projectName">$$projectName$$</prop>
    <prop name="organismAbbrev">$$organismAbbrev$$</prop>
    <prop name="name">Doe_histone_2025</prop>
    <prop name="version">2025-04-01</prop>
    <prop name="hasPairedEnds">false</prop>
    <prop name="extraBowtieParams"></prop>
    <prop name="experimentType">histonemod</prop>
    <prop name="fromSRA">true</prop>
    <prop name="readsFileType">fastq</prop>
  </dataset>
```

`expected.xml` (the presenter) is generated in Step 6.

- [ ] **Step 3: Write the failing tests**

Create `tests/dataset-types-chipseq.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, cpSync, rmSync, writeFileSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import * as chipseq from '../shared/scripts/dataset-types/chipseq.js';
import { readDatasetClass, expandPattern, identityValues, CLASSES_RELATIVE_PATH } from '../shared/scripts/lib/dataset-classes.js';
import { loadManifest, PREVIEW_BUILD } from '../shared/scripts/dataset-types/_common.js';

const fixtures = new URL('./fixtures/', import.meta.url).pathname;
const src = join(fixtures, 'proposals', 'PRJNA000011');
const classDef = (() => {
  const repo = mkdtempSync(join(tmpdir(), 'classes-'));
  mkdirSync(join(repo, 'Model/lib/xml/datasetClass'), { recursive: true });
  cpSync(join(fixtures, 'classes.xml'), join(repo, CLASSES_RELATIVE_PATH));
  return readDatasetClass(repo, 'chipSeqExperiment');
})();
const HISTONE = { props: { experimentType: 'histonemod' } };
const annotationsPath = (dir) => join(dir, 'curated', 'PRJNA000011_sample_annotations.json');
const editAnnotations = (dir, edit) => {
  const a = JSON.parse(readFileSync(annotationsPath(dir), 'utf-8'));
  edit(a);
  writeFileSync(annotationsPath(dir), JSON.stringify(a, null, 2));
};

/** The fixture as write-proposal leaves it; edit changes the source annotations before anything is derived. */
function staged(t, { dataset = HISTONE, presenter = {}, edit } = {}) {
  const tmp = mkdtempSync(join(tmpdir(), 'chipseq-'));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const dir = join(tmp, basename(src));
  cpSync(src, dir, { recursive: true, filter: (p) => !/expected/.test(p) });
  if (edit) editAnnotations(dir, edit);
  chipseq.normalizeCurated(dir, dataset);
  const p = chipseq.derivePresenter(dir, { shortDisplayName: 'Tfak histone', shortAttribution: 'Doe 2025', ...presenter });
  writeFileSync(join(dir, 'curated', 'presenter.json'), JSON.stringify(p, null, 2) + '\n');
  writeFileSync(join(dir, 'curated', 'dataset.json'), JSON.stringify(chipseq.deriveDataset(dir, classDef, dataset), null, 2) + '\n');
  for (const [f, text] of Object.entries(chipseq.deriveArtifacts(dir))) {
    mkdirSync(dirname(join(dir, 'curated', f)), { recursive: true });
    writeFileSync(join(dir, 'curated', f), text);
  }
  return dir;
}

test('chipseq dataset name follows the classes.xml datasetLoader pattern', () => {
  const m = loadManifest(src);
  assert.equal(chipseq.datasetNameFor('tfakST1', m.name), expandPattern(classDef.datasetNamePattern, identityValues(m, 'tfakST1')));
  assert.deepEqual(chipseq.presenterNames(src), ['tfakST1_Doe_histone_2025_chipSeq_RSRC']);
});

test('EXPERIMENT_TYPES is the class vocabulary', () => {
  const doc = readFileSync(join(fixtures, 'classes.xml'), 'utf-8').match(/name="experimentType">\[([^\]]+)\]/)[1];
  assert.deepEqual(chipseq.EXPERIMENT_TYPES, doc.split(',').map((s) => s.trim()));
});

test('chipseq samplesheet carries each ChIP sample\'s input in the fourth column', (t) => {
  const dir = staged(t);
  assert.equal(readFileSync(join(dir, 'curated', 'tfakST1', 'samplesheet.csv'), 'utf-8'), [
    'sample,fastq_1,fastq_2,input',
    'BF_H3_ChIP,SRR22,,BF_H3_Input',
    'BF_H3_Input,SRR21,,',
    'BF_K125ac_ChIP,SRR24,,BF_K125ac_Input',
    'BF_K125ac_ChIP,SRR25,,BF_K125ac_Input',
    'BF_K125ac_Input,SRR23,,'
  ].join('\n') + '\n');
  assert.deepEqual(chipseq.checkCurated(dir), []);
  assert.deepEqual(chipseq.curatedWarnings(dir), []);
});

test('the STF carries a ChIP role column', (t) => {
  const dir = staged(t);
  const [header, ...rows] = readFileSync(join(dir, 'curated', 'tfakST1', 'entity-sample.tsv'), 'utf-8').trim().split('\n');
  const at = header.split('\t').indexOf('role');
  assert.ok(at > 0, header);
  assert.deepEqual(rows.map((r) => r.split('\t')).map((c) => [c[0], c[at]]).sort(), [
    ['BF_H3_ChIP', 'ChIP'], ['BF_H3_Input', 'Input'], ['BF_K125ac_ChIP', 'ChIP'], ['BF_K125ac_Input', 'Input']
  ]);
});

test('histonemod renders hasCalledPeaks true; the dataset entry matches its golden file', (t) => {
  const dir = staged(t);
  const xml = chipseq.renderPresenter(dir, { build: PREVIEW_BUILD });
  assert.match(xml, /<datasetPresenter name="tfakST1_Doe_histone_2025_chipSeq_RSRC"\s+projectName="FungiDB">/);
  assert.match(xml, /className="org\.apidb\.apicommon\.model\.datasetInjector\.ChIPSeq">\n\s*<prop name="hasCalledPeaks">true<\/prop>/);
  assert.equal(readFileSync(join(src, 'expected.xml'), 'utf-8'), xml + '\n');
  assert.equal(readFileSync(join(src, 'expected-dataset.xml'), 'utf-8'), chipseq.renderDataset(dir, classDef) + '\n');
});

test('tfbinding keeps its input pairs but calls no peaks', (t) => {
  const dir = staged(t, { dataset: { props: { experimentType: 'tfbinding' } } });
  assert.match(chipseq.renderPresenter(dir, { build: PREVIEW_BUILD }), /<prop name="hasCalledPeaks">false<\/prop>/);
  assert.match(readFileSync(join(dir, 'curated', 'tfakST1', 'samplesheet.csv'), 'utf-8'), /BF_H3_ChIP,SRR22,,BF_H3_Input/);
});

test('hasCalledPeaks cannot be curated, in overrides or by hand', (t) => {
  const dir = staged(t);
  assert.throws(() => chipseq.derivePresenter(dir, { injectorProps: { hasCalledPeaks: 'true' } }), /follows dataset\.props\.experimentType/);
  const path = join(dir, 'curated', 'presenter.json');
  const p = JSON.parse(readFileSync(path, 'utf-8'));
  p.injectorProps.hasCalledPeaks = 'true';
  writeFileSync(path, JSON.stringify(p));
  assert.throws(() => chipseq.renderPresenter(dir, { build: PREVIEW_BUILD }), /follows dataset\.props\.experimentType/);
});

test('deriveDataset needs a valid experimentType and derives hasPairedEnds, readsFileType and fromSRA', (t) => {
  const dir = staged(t);
  assert.throws(() => chipseq.deriveDataset(dir, classDef, {}), /experimentType must be one of histonemod, /);
  assert.throws(() => chipseq.deriveDataset(dir, classDef, { props: { experimentType: 'histone' } }), /experimentType must be one of/);
  for (const k of ['hasPairedEnds', 'readsFileType', 'fromSRA']) {
    assert.throws(() => chipseq.deriveDataset(dir, classDef, { props: { experimentType: 'histonemod', [k]: 'x' } }), new RegExp(`props\\.${k} is derived`));
  }
  assert.deepEqual(chipseq.deriveDataset(dir, classDef, { props: { experimentType: 'histonemod', extraBowtieParams: '--very-sensitive' } }).props.extraBowtieParams, '--very-sensitive');
});

test('deriveDataset refuses used runs that mix library layouts', (t) => {
  const dir = staged(t);
  const sra = join(dir, 'inputs', 'PRJNA000011_sra_metadata.json');
  const meta = JSON.parse(readFileSync(sra, 'utf-8'));
  meta.runs[0].library_layout = 'PAIRED';
  writeFileSync(sra, JSON.stringify(meta));
  assert.throws(() => chipseq.deriveDataset(dir, classDef, HISTONE), /mix library layouts \(PAIRED, SINGLE\)/);
});

test('pairing errors: unknown input, input of an input, input that is a ChIP, a missing role', (t) => {
  const cases = [
    [(a) => { a.samples[1].input = 'Nope'; }, 'Sample BF_H3_ChIP: input Nope is not a sample of this experiment'],
    [(a) => { a.samples[0].input = 'BF_K125ac_Input'; }, 'Sample BF_H3_Input: an input sample names no input of its own'],
    [(a) => { a.samples[1].input = 'BF_K125ac_ChIP'; }, 'Sample BF_H3_ChIP: input BF_K125ac_ChIP has role chip, not input'],
    [(a) => { a.samples[1].input = 'BF_H3_ChIP'; }, 'Sample BF_H3_ChIP: input BF_H3_ChIP has role chip, not input'],
    [(a) => { delete a.samples[3].role; }, 'Sample BF_K125ac_ChIP: role must be chip or input']
  ];
  for (const [edit, message] of cases) assert.ok(chipseq.checkCurated(staged(t, { edit })).includes(message), message);
});

test('the samplesheet input column must agree with the annotations', (t) => {
  const dir = staged(t);
  const sheet = join(dir, 'curated', 'tfakST1', 'samplesheet.csv');
  writeFileSync(sheet, readFileSync(sheet, 'utf-8').replace('BF_H3_ChIP,SRR22,,BF_H3_Input', 'BF_H3_ChIP,SRR22,,BF_K125ac_Input'));
  assert.deepEqual(chipseq.checkCurated(dir), [
    'samplesheet.csv line 2 (BF_H3_ChIP) has input "BF_K125ac_Input" but PRJNA000011_sample_annotations.json has "BF_H3_Input"'
  ]);
});

test('histonemod needs inputs; histonemod_noInput may not have them', (t) => {
  const noInputs = (a) => {
    a.samples = a.samples.filter((s) => s.role === 'chip');
    for (const s of a.samples) delete s.input;
  };
  assert.ok(chipseq.checkCurated(staged(t, { edit: noInputs })).includes('experimentType histonemod needs input samples; use histonemod_noInput for an experiment without them'));
  assert.deepEqual(chipseq.checkCurated(staged(t, { edit: noInputs, dataset: { props: { experimentType: 'histonemod_noInput' } } })), []);
  assert.ok(chipseq.checkCurated(staged(t, { dataset: { props: { experimentType: 'histonemod_noInput' } } }))
    .includes('experimentType histonemod_noInput has input samples; use histonemod, or remove the inputs'));
});

test('warnings: an unused input, a ChIP without its input, a strategy the experiment type does not expect', (t) => {
  const dir = staged(t, {
    edit: (a) => { delete a.samples[3].input; }
  });
  assert.deepEqual(chipseq.curatedWarnings(dir), [
    'input BF_K125ac_Input is not the input of any ChIP sample',
    'ChIP sample BF_K125ac_ChIP has no input, so no peaks are called for it'
  ]);
  const mnase = staged(t, { dataset: { props: { experimentType: 'mnase' } } });
  assert.deepEqual(chipseq.curatedWarnings(mnase), ['SRR21, SRR22, SRR23, SRR24, SRR25: library_strategy ChIP-Seq, but experimentType mnase expects MNase-Seq']);
});

test('no inputs at all is not a warning', (t) => {
  const dir = staged(t, {
    dataset: { props: { experimentType: 'tfbinding' } },
    edit: (a) => { a.samples = a.samples.filter((s) => s.role === 'chip'); for (const s of a.samples) delete s.input; }
  });
  assert.deepEqual(chipseq.curatedWarnings(dir), []);
});

test('chipseq artifacts, corpus and organism rule', (t) => {
  const dir = staged(t);
  assert.deepEqual(Object.keys(chipseq.renderArtifacts(dir).files).sort(), ['sampleAnnotations.json', 'samplesheet.csv']);
  assert.deepEqual(chipseq.corpus, { root: 'common/chipSeq/sampleDetailsForEda', layout: 'per-organism' });
  assert.deepEqual(Object.keys(chipseq.corpusFiles(dir)).sort(), ['entity-sample.tsv', 'entity-sample.yaml']);
  assert.deepEqual(chipseq.organismRule, { new: false, max: 1 });
  assert.equal(chipseq.requiredOrganismConstants, undefined);
});
```

- [ ] **Step 4: Run them and confirm they fail**

Run: `node --test tests/dataset-types-chipseq.test.js`
Expected: FAIL with `Cannot find module .../chipseq.js`.

- [ ] **Step 5: Implement `chipseq.js`**

Create `shared/scripts/dataset-types/chipseq.js`:

```js
import { existsSync } from 'node:fs';
import {
  loadManifest, readCuratedJson, readPresenter, applyOverrides, requireIdentity, readDataset, datasetPath,
  assertValidDataset, datasetElement, PRESENTER_SCHEMA_VERSION, DATASET_SCHEMA_VERSION, escapeXml, injectorProps,
  requireBuild, presenterBodyXml
} from './_common.js';
import { DEFAULT_SOURCE, SAMPLESHEET_COLUMNS, bioprojectLinks, methodologyFrom } from './_sra-samples.js';
import { sraExperimentType, annotationsFile, runsOf, usedRuns, organismOf } from './_sra-experiment.js';
import { libraryProblems } from '../lib/library-checks.js';

export const datasetClass = 'chipSeqExperiment';
export const EXPERIMENT_TYPES = ['histonemod', 'histonemod_noInput', 'tfbinding', 'mnase', 'faire', 'dnase'];
/** The build calls peaks for these experiment types and no others. */
export const PEAK_CALLING_TYPES = ['histonemod'];
const STRATEGY_OF = {
  histonemod: 'ChIP-Seq', histonemod_noInput: 'ChIP-Seq', tfbinding: 'ChIP-Seq', mnase: 'MNase-Seq', faire: 'FAIRE-seq', dnase: 'DNase-Hypersensitivity'
};
/** Submitters often label input libraries WGS. */
export const libraryStrategies = [...new Set(Object.values(STRATEGY_OF)), 'WGS'];
export const injectorDefaults = { hasCalledPeaks: 'false', key: '', subTrackAttr: 'name' };
export const requiredFields = ['shortDisplayName', 'shortAttribution'];
export const organismRule = { new: false, max: 1 };

const INJECTOR = 'org.apidb.apicommon.model.datasetInjector.ChIPSeq';
const ROLE_LABELS = { chip: 'ChIP', input: 'Input' };
const DERIVED_PROPS = ['hasPairedEnds', 'readsFileType', 'fromSRA'];
const OPTIONAL_PROPS = ['extraBowtieParams'];
const PEAKS_DERIVED = 'hasCalledPeaks follows dataset.props.experimentType (peaks are called only for histonemod); remove it';
export const datasetNameFor = (organism, name) => `${organism}_${name}_chipSeq_RSRC`;
export const corpus = { root: 'common/chipSeq/sampleDetailsForEda', layout: 'per-organism' };
export { annotationsFile };

const experimentTypeOf = (proposalDir) => (existsSync(datasetPath(proposalDir)) ? readDataset(proposalDir).props?.experimentType : undefined);

/** The role column in the STF, ahead of the curator's factors. */
const withRole = (a) => ({
  ...a,
  factors: { role: { displayName: 'ChIP role' }, ...a.factors },
  samples: a.samples.map((s) => ({ ...s, factors: { role: ROLE_LABELS[s.role] ?? '', ...s.factors } }))
});

function pairingErrors({ proposalDir, annotations, sheet, versus }) {
  const errors = [];
  const byId = new Map(annotations.samples.map((s) => [s.sampleId, s]));
  for (const s of annotations.samples) {
    if (!ROLE_LABELS[s.role]) { errors.push(`Sample ${s.sampleId}: role must be chip or input`); continue; }
    if (s.input === undefined) continue;
    const target = byId.get(s.input);
    if (s.role === 'input') errors.push(`Sample ${s.sampleId}: an input sample names no input of its own`);
    else if (!target) errors.push(`Sample ${s.sampleId}: input ${s.input} is not a sample of this experiment`);
    else if (target.role !== 'input') errors.push(`Sample ${s.sampleId}: input ${s.input} has role ${target.role}, not input`);
  }
  for (const r of sheet.rows) {
    if (!byId.has(r.sample)) continue;
    const want = byId.get(r.sample).input ?? '';
    if (r.extra.input !== want) errors.push(`samplesheet.csv line ${r.line} (${r.sample}) has input "${r.extra.input}" but ${versus} has "${want}"`);
  }
  const type = experimentTypeOf(proposalDir);
  const hasInputs = annotations.samples.some((s) => s.role === 'input');
  if (type === 'histonemod' && !hasInputs) errors.push('experimentType histonemod needs input samples; use histonemod_noInput for an experiment without them');
  if (type === 'histonemod_noInput' && hasInputs) errors.push('experimentType histonemod_noInput has input samples; use histonemod, or remove the inputs');
  return errors;
}

export const {
  derivedCuratedFiles, presenterNames, normalizeCurated, deriveArtifacts, checkCurated, assertCuratedAgree, renderArtifacts, corpusFiles, stagingProblems
} = sraExperimentType({
  type: 'chipseq', datasetClass, datasetNameFor, columns: [...SAMPLESHEET_COLUMNS, 'input'], stfAnnotations: withRole, extraChecks: pairingErrors
});

/** No GEO series dates a ChIP-seq proposal, so the curator supplies name and version. */
export const deriveIdentity = () => ({ version: undefined, name: undefined });

/** Phase 1: the presenter record. The assay in the display name is the runs' commonest non-WGS strategy. */
export function derivePresenter(proposalDir, overrides = {}) {
  if (overrides.injectorProps?.hasCalledPeaks !== undefined) throw new Error(`presenter.injectorProps.${PEAKS_DERIVED}`);
  const m = loadManifest(proposalDir);
  requireIdentity(m, datasetClass);
  const runs = runsOf(proposalDir, m);
  const species = runs.map((r) => r.scientific_name).find(Boolean);
  if (!species) throw new Error(`No scientific_name in any run of ${m.accession}`);
  const counts = new Map();
  for (const r of runs) if (r.library_strategy && r.library_strategy !== 'WGS') counts.set(r.library_strategy, (counts.get(r.library_strategy) ?? 0) + 1);
  const assay = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'ChIP-Seq';
  return applyOverrides({
    schemaVersion: PRESENTER_SCHEMA_VERSION,
    displayName: `${assay} analysis of ${species}`,
    shortDisplayName: '',
    shortAttribution: '',
    summary: `${assay} analysis of <i>${species}</i>`,
    description: [...new Set(runs.map((r) => r.experiment_title).filter(Boolean))][0] || '',
    methodology: methodologyFrom(runs),
    protocol: '', caveat: '', acknowledgement: '', releasePolicy: '',
    pubmedIds: [],
    links: bioprojectLinks(m),
    history: {},
    injectorProps: {}
  }, overrides);
}

export function renderPresenter(proposalDir, { build } = {}) {
  requireBuild(build);
  const m = loadManifest(proposalDir);
  requireIdentity(m, datasetClass);
  const p = readPresenter(proposalDir, { requiredFields });
  if (p.injectorProps?.hasCalledPeaks !== undefined) throw new Error(`curated/presenter.json of ${m.accession}: injectorProps.${PEAKS_DERIVED}`);
  const hasCalledPeaks = String(PEAK_CALLING_TYPES.includes(readDataset(proposalDir).props?.experimentType));
  return `  <datasetPresenter name="${escapeXml(datasetNameFor(organismOf(m), m.name))}"
                    projectName="${escapeXml(m.organisms[0].project)}">
${presenterBodyXml(p, m, build)}    <templateInjector className="${INJECTOR}">
${injectorProps(injectorDefaults, { ...p.injectorProps, hasCalledPeaks })}
    </templateInjector>
  </datasetPresenter>`;
}

/** Phase 1: the chipSeqExperiment record. The curator picks experimentType; layout, file type and source are derived. */
export function deriveDataset(proposalDir, classDef, overrides = {}) {
  const m = loadManifest(proposalDir);
  requireIdentity(m, datasetClass);
  if (overrides.source && overrides.source.type !== 'sra') throw new Error('chipseq reads from SRA only');
  for (const k of DERIVED_PROPS) if (overrides.props?.[k] !== undefined) throw new Error(`dataset.props.${k} is derived; remove it from --overrides`);
  const experimentType = overrides.props?.experimentType;
  if (!EXPERIMENT_TYPES.includes(experimentType)) {
    throw new Error(`dataset.props.experimentType must be one of ${EXPERIMENT_TYPES.join(', ')}; set it under "dataset": { "props": { ... } } in --overrides`);
  }
  const runs = runsOf(proposalDir, m);
  const used = usedRuns(proposalDir, m);
  const { errors } = libraryProblems(runs, { used, strategies: libraryStrategies });
  if (errors.length) throw new Error(`Runs of ${m.accession} fail the library checks:\n  - ${errors.join('\n  - ')}`);
  const layouts = [...new Set(runs.filter((r) => used.has(r.run_accession)).map((r) => (r.library_layout || 'missing').toUpperCase()))].sort();
  if (layouts.length !== 1) throw new Error(`Runs of ${m.accession} mix library layouts (${layouts.join(', ')}); the mapper takes one layout per experiment`);
  const record = {
    schemaVersion: DATASET_SCHEMA_VERSION,
    props: { extraBowtieParams: '', ...overrides.props, hasPairedEnds: String(layouts[0] === 'PAIRED'), fromSRA: 'true', readsFileType: 'fastq' },
    source: DEFAULT_SOURCE
  };
  assertValidDataset(record, classDef, { runAccessions: runs.map((r) => r.run_accession), optionalProps: OPTIONAL_PROPS }, `dataset for ${m.accession} (set values under "dataset" in --overrides)`);
  return record;
}

export function renderDataset(proposalDir, classDef) {
  const m = loadManifest(proposalDir);
  requireIdentity(m, datasetClass);
  const d = readDataset(proposalDir);
  assertValidDataset(d, classDef, { optionalProps: OPTIONAL_PROPS }, `curated/dataset.json of ${m.accession}`);
  if (!EXPERIMENT_TYPES.includes(d.props.experimentType)) throw new Error(`curated/dataset.json of ${m.accession}: experimentType must be one of ${EXPERIMENT_TYPES.join(', ')}`);
  return datasetElement(m, classDef, d.props);
}

/** Phase 1: what write-proposal prints for the curator once the records agree. */
export function curatedWarnings(proposalDir) {
  const m = loadManifest(proposalDir);
  const { samples = [] } = readCuratedJson(proposalDir, annotationsFile(m));
  const type = experimentTypeOf(proposalDir);
  const inputs = samples.filter((s) => s.role === 'input');
  const named = new Set(samples.map((s) => s.input).filter(Boolean));
  const warnings = inputs.filter((s) => !named.has(s.sampleId)).map((s) => `input ${s.sampleId} is not the input of any ChIP sample`);
  if (inputs.length) {
    const peaks = PEAK_CALLING_TYPES.includes(type) ? ', so no peaks are called for it' : '';
    for (const s of samples.filter((x) => x.role === 'chip' && !x.input)) warnings.push(`ChIP sample ${s.sampleId} has no input${peaks}`);
  }
  const expected = STRATEGY_OF[type];
  const used = usedRuns(proposalDir, m);
  const off = new Map();
  for (const r of runsOf(proposalDir, m)) {
    if (!used.has(r.run_accession) || r.library_strategy === expected || r.library_strategy === 'WGS') continue;
    off.set(r.library_strategy, [...(off.get(r.library_strategy) ?? []), r.run_accession]);
  }
  for (const [strategy, ids] of off) warnings.push(`${ids.join(', ')}: library_strategy ${strategy || 'missing'}, but experimentType ${type} expects ${expected}`);
  return warnings;
}
```

If `datasetPath` is not exported from `_common.js`, it is: `export const datasetPath = ...` at about line 264.

- [ ] **Step 6: Generate the presenter golden file, then review it**

Don't hand-write `expected.xml`. Generate it from the staged test fixture: temporarily add `writeFileSync(join(src, 'expected.xml'), xml + '\n');` as the first line after `const xml = ...` in the `histonemod renders hasCalledPeaks true` test, run `node --test tests/dataset-types-chipseq.test.js`, then **delete that line**. Read `tests/fixtures/proposals/PRJNA000011/expected.xml` and check:

- `name="tfakST1_Doe_histone_2025_chipSeq_RSRC"`, `projectName="FungiDB"`
- `<displayName><![CDATA[ChIP-Seq analysis of Testus fakeus]]></displayName>`
- `<shortDisplayName>Tfak histone</shortDisplayName>`, and the NCBI Bioproject link to PRJNA000011
- the injector block is exactly:

```xml
    <templateInjector className="org.apidb.apicommon.model.datasetInjector.ChIPSeq">
      <prop name="hasCalledPeaks">true</prop>
      <prop name="key"></prop>
      <prop name="subTrackAttr">name</prop>
    </templateInjector>
```

- [ ] **Step 7: Run the tests**

Run: `node --test tests/dataset-types-chipseq.test.js`
Expected: PASS, all tests. If a message differs, fix the code to produce the message in the test. The tests are the spec's wording.

- [ ] **Step 8: Commit**

```bash
git add shared/scripts/dataset-types/chipseq.js tests/dataset-types-chipseq.test.js tests/fixtures
git commit -m "chipseq dataset type: input pairing, derived hasPairedEnds and hasCalledPeaks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Register the type and sync it into skills

**Files:**
- Modify: `shared/scripts/dataset-types/index.js`, `shared/scripts/dataset-types/validators.js`
- Modify: `shared/resources/curator.config.json`
- Modify: `package.json` (`sharedFiles`)
- Modify: `tests/config.test.js:40`, `tests/library-checks.test.js`, `tests/dataset-types-chipseq.test.js`

- [ ] **Step 1: Write failing tests**

Append to `tests/dataset-types-chipseq.test.js`:

```js
import { DATASET_TYPES } from '../shared/scripts/dataset-types/index.js';
import { organismRuleOf } from '../shared/scripts/lib/manifest.js';
import { validationWorkspaceFor } from '../shared/scripts/dataset-types/validators.js';

test('chipseq is registered, labelled "chipseq", with its own validation workspace', () => {
  assert.equal(DATASET_TYPES.chipseq, chipseq);
  assert.deepEqual(organismRuleOf('chipseq'), { new: false, max: 1 });
  const cfg = JSON.parse(readFileSync(new URL('../shared/resources/curator.config.json', import.meta.url), 'utf-8'));
  assert.equal(cfg.ticket.github.typeLabels.chipseq, 'chipseq');
  assert.equal(validationWorkspaceFor('chipseq'), 'chipseq-validation');
});
```

(Move the three new `import` lines to the top of the file with the others.)

In `tests/config.test.js:40`, add `chipseq: 'chipseq'` to the expected `typeLabels` object.

In `tests/library-checks.test.js`, copy the `--type dnaseq` CLI test from Task 2 Step 1 as a chipseq case: run `library_strategy: 'ChIP-Seq'` with `--type chipseq`, and assert stderr has no `Warning:`.

- [ ] **Step 2: Run them and confirm they fail**

Run: `node --test tests/dataset-types-chipseq.test.js tests/config.test.js tests/library-checks.test.js`
Expected: FAIL on registration, the label, the workspace and `--type chipseq`.

- [ ] **Step 3: Register**

`shared/scripts/dataset-types/index.js`:

```js
import * as chipseq from './chipseq.js';
```

```js
export const DATASET_TYPES = { 'genome-assembly': genomeAssembly, 'bulk-rnaseq': bulkRnaseq, dnaseq, chipseq };
```

`shared/scripts/dataset-types/validators.js`:

```js
const WORKSPACES = { 'bulk-rnaseq': 'rnaseq-validation', dnaseq: 'dnaseq-validation', chipseq: 'chipseq-validation', 'genome-assembly': 'annotated-genome-validation' };
```

`shared/resources/curator.config.json` `typeLabels`: add `"chipseq": "chipseq",` after `"bulk-rnaseq"`.

- [ ] **Step 4: `sharedFiles`**

In `package.json` `sharedFiles`:

- Add `"propose-chipseq"` to every entry that lists `"propose-dnaseq"`, **except** `scripts/lib/released-organisms.js` and `scripts/check-released-organism.js`. ChIP-seq doesn't need a released organism.
- Add a new entry with the same skill list as `scripts/dataset-types/dnaseq.js` (now including `propose-chipseq`):

```json
"scripts/dataset-types/chipseq.js": ["propose-genome-assembly", "propose-bulk-rnaseq", "propose-dnaseq", "propose-chipseq", "load-proposals", "verify-bulk-rnaseq"],
```

- Add `"propose-chipseq"` to `scripts/dataset-types/_sra-experiment.js` (from Task 3).

Check by hand that `"propose-chipseq"` appears for `scripts/check-workspace.js`, `scripts/fetch-sra-metadata.js`, `scripts/check-library.js`, `scripts/check-experiments.js`, `scripts/find-publications.js`, the lifecycle CLIs (`start-`, `write-`, `publish-`, `merge-proposal.js`, `render-proposal.js`) and the four `resources/*` entries.

- [ ] **Step 5: Sync and run all tests**

```bash
mkdir -p skills/propose-chipseq/scripts skills/propose-chipseq/resources
yarn sync-shared && yarn test 2>&1 | tail -6
diff <(ls skills/propose-dnaseq/scripts | grep -v released) <(ls skills/propose-chipseq/scripts)
```

Expected: `fail 0`, and the `diff` prints nothing. `propose-chipseq` has every DNA-seq script except `check-released-organism.js`.

- [ ] **Step 6: Commit**

```bash
git add -A shared skills package.json tests
git commit -m "Register chipseq; chipseq ticket label and validation workspace

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The `propose-chipseq` skill documents

**Files:**
- Create: `skills/propose-chipseq/SKILL.md`
- Create: `skills/propose-chipseq/resources/step-0-start-proposal.md` … `step-6-publish.md`
- Modify: `CLAUDE.md` (repository tree), `README.md` (Available Skills), `docs/development.md` (module table)

- [ ] **Step 1: Copy the DNA-seq step resources as the starting point**

```bash
cp skills/propose-dnaseq/resources/step-*.md skills/propose-chipseq/resources/
cp skills/propose-dnaseq/SKILL.md skills/propose-chipseq/SKILL.md
grep -n -i 'dnaseq\|dna-seq\|released\|ploidy\|cnv\|SNP\|isolate\|WGS\|IsolatesHTS' skills/propose-chipseq/SKILL.md skills/propose-chipseq/resources/*.md
```

Every line `grep` prints must be rewritten by the steps below. Re-run the grep at the end: the only hits left may be `WGS` in the library-check table (inputs may be WGS) and "released" in the organism paragraph's "not released yet".

- [ ] **Step 2: SKILL.md**

Frontmatter:

```markdown
---
name: propose-chipseq
description: Propose a ChIP-seq dataset (histone modification, TF binding, MNase, FAIRE or DNase) for VEuPathDB - check the SRA runs, pair ChIP samples with their input controls, choose the experiment type, curate contacts, write a proposal to VEuPathDatasets with samplesheet and STF, open the PR and ticket
---
```

Changes from the DNA-seq SKILL.md:

- **Title and intro:** "Propose a ChIP-seq Dataset". The opening says this skill covers every `chipSeqExperiment` experiment type: `histonemod`, `histonemod_noInput`, `tfbinding`, `mnase`, `faire`, `dnase`. Proposals are single-organism and read from SRA only.
- **Required Information:** drop the paragraph about the released site. The organism paragraph says the organism must already be loaded on the rebuild branch, or proposed by a genome proposal for the same build or an earlier one. `write-proposal.js` warns when only a genome proposal introduces it, and load waits for that genome.
- **Step 1:**
  - `node scripts/check-library.js <ACCESSION> --type chipseq`. The accepted strategies are ChIP-Seq, MNase-Seq, FAIRE-seq, DNase-Hypersensitivity, and WGS for inputs. Exit codes and relaying are unchanged from DNA-seq.
- **Step 2 summary**, replacing the isolate bullets:
  - Every sample has an explicit `sampleId`, because input pairing refers to it.
  - Every sample has `role`: `"chip"` or `"input"`. A ChIP sample with a control has `"input": "<sampleId of its input>"`. Several ChIP samples may share one input. A ChIP sample has at most one input. Inputs never name an input.
  - Identify inputs from sample titles, `library_name` and BioSample attributes (for example `input`, `IgG`, `mock`, `whole cell extract`). Pair them by matching the remaining title tokens (life stage, replicate, strain). Show the curator the proposed pairs as a table and confirm them. **Never guess a pairing.** An unclear pair is the curator's call.
  - Factors: `target` (the antibody, histone mark or TF, for example `H3K4me3`; `input` for inputs), plus whatever varies (life stage, strain, treatment, timepoint). Don't add a `role` factor: the STF gets a `role` column automatically.
  - No `strandedness` and no `organisms`.
- **Step 4:**
  - Delete the `check-released-organism.js` block and its exit-code bullets, and the `--input .curation/tmp/<ACCESSION>_released_organism.json` line.
  - Use `--type chipseq` and `--skill propose-chipseq`.
  - Overrides must also give `"dataset": { "props": { "experimentType": "<type>" } }`. Claude suggests the type: `histonemod` for histone marks with inputs; `histonemod_noInput` for histone marks without inputs; `tfbinding` for transcription factors and other chromatin proteins; `mnase`, `faire`, `dnase` from the library strategy. **The curator confirms it.**
  - `extraBowtieParams` may be set under `dataset.props`. It defaults to empty. Never set it unless the curator or the paper asks for specific bowtie2 options.
  - `hasPairedEnds`, `readsFileType` and `fromSRA` are derived. Runs that mix single- and paired-end layouts are refused: ask the curator which runs to drop.
  - **Peaks:** tell the curator that peaks are called only for `histonemod`, and only for ChIP samples that have an input. `hasCalledPeaks` follows `experimentType` and cannot be overridden.
  - Relay every `Warning:` line from `write-proposal.js` verbatim: unused inputs, ChIP samples without an input, and runs whose library strategy doesn't match the experiment type. Ask the curator about each.
  - Replace the `hasCNVData` and ploidy paragraphs with the peaks paragraph above. The default `displayName` is `<assay> analysis of <species>`, where the assay is the runs' most common non-WGS library strategy. Show it with the description and methodology defaults.
- **Step 5:** the preview path is `.curation/delivery/<Project>/<abbrev>/chipSeq/<name>/<version>/final/`. The samplesheet has four columns, `sample,fastq_1,fastq_2,input`.
- **Step 6:** the ticket label is `chipseq`.
- **Next Steps:** drop the ploidy sentence.
- **Scripts list:** drop `check-released-organism.js`. `check-library.js` "checks the runs' library source, depth and strategy (`--type chipseq`)".

- [ ] **Step 3: The step resources**

Apply the same changes to each resource:

- `step-0-start-proposal.md`: replace "DNA-seq" with "ChIP-seq".
- `step-1-fetch-metadata.md`:
  - In the `check-library.js` command and its explanation, add `--type chipseq`.
  - In the checks table, replace the row `library_strategy` not `WGS` with: `library_strategy` not ChIP-Seq, MNase-Seq, FAIRE-seq, DNase-Hypersensitivity or WGS | Warning.
  - In the attributes paragraph, replace "strain, isolate, host, geographic location, collection" with "strain, life stage, antibody/target, treatment, and any title tokens that distinguish ChIP from input".
- `step-2-analyze-samples.md`: rewrite the factor sections for ChIP-seq. Keep the SRX-grouping, split/merge and label rules verbatim. Replace the isolate factor table with this:

  | Factor | From | Definition |
  |---|---|---|
  | `target` | antibody, `chip_antibody`, `target`, title | `"Antibody target of the ChIP (histone mark or protein); input for input controls"` |
  | `life_stage` | `dev_stage`, `life_stage`, title | `"Life cycle stage of the organism"` |
  | `strain` | `strain` | `"Strain of the organism"` |
  | `treatment` | `treatment`, title | `"Treatment applied before chromatin collection"` |

  Add a section `## Input controls`. It holds the role/input rules from Step 2 above, and this example, which replaces the isolate example:

  ```json
  {
    "samples": [
      { "sampleId": "BF_H3_Input", "label": "BF H3 input", "role": "input", "runs": ["SRR13477527"], "factors": { "target": "input", "life_stage": "bloodstream form" } },
      { "sampleId": "BF_H3_ChIP", "label": "BF H3", "role": "chip", "input": "BF_H3_Input", "runs": ["SRR13477529"], "factors": { "target": "H3", "life_stage": "bloodstream form" } }
    ],
    "factors": {
      "target": { "displayName": "Target", "definition": "Antibody target of the ChIP (histone mark or protein); input for input controls" },
      "life_stage": { "displayName": "Life stage", "definition": "Life cycle stage of the organism" }
    }
  }
  ```

  Replace the checklist with:

  - [ ] Every sample has a `sampleId` and a `role`
  - [ ] Every ChIP sample with a control names it in `input`, and the curator confirmed the pairs
  - [ ] Labels name the target and condition clearly
  - [ ] `target` and every varying condition are captured as factors
- `step-3-curate-contacts.md`: replace "DNA-seq" with "ChIP-seq".
- `step-4-write-proposal.md`:
  - Title: `# Step 4: Write the Proposal and Preview`.
  - Delete the "organism must be released" section.
  - Apply the Step 4 changes from SKILL.md above. The presenter table's injector row becomes: `injectorProps.hasCalledPeaks` | `true` for `histonemod`, else `false`; rendered, never curated.
  - The dataset table lists the `chipSeqExperiment` props with their sources (curator: `experimentType`, optional `extraBowtieParams`; derived: `hasPairedEnds`, `readsFileType=fastq`, `fromSRA=true`).
  - Add this refusals list: `experimentType` missing or not in the vocabulary; a derived prop in overrides; `hasCalledPeaks` in overrides; mixed layouts; `histonemod` with no inputs; `histonemod_noInput` with inputs; an `input` that is not an input sample of this experiment.
- `step-5-preview-artifacts.md`: replace `SNP` with `chipSeq`, and describe the 4-column samplesheet.
- `step-6-publish.md`: replace "(`dnaseq` for DNA-seq; ...)" with "(`chipseq` for ChIP-seq; ...)".

- [ ] **Step 4: Repository docs**

- `CLAUDE.md` tree: add `│   ├── propose-chipseq/                    # Phase 1: ChIP-seq proposals` after `propose-dnaseq/`.
- `README.md`: add `propose-chipseq` to "Available Skills", next to `propose-dnaseq` and in the same format.
- `docs/development.md` module table:
  - Add a row: `` `dataset-types/_sra-experiment.js` `` | Factory for single-organism SRA types (`dnaseq`, `chipseq`): normalize, loading artifacts, agreement check, corpus.
  - Add a row: `` `dataset-types/chipseq.js` `` | The `chipseq` type: `chipSeqExperiment` with a 4-column samplesheet (`input`), pairing checks, `hasCalledPeaks` from `experimentType`.
  - In the `_sra-samples.js` row, change "the `sample,fastq_1,fastq_2` samplesheet" to "the `sample,fastq_1,fastq_2` samplesheet (plus type-specific columns)".
  - In the `lib/library-checks.js` row, add "with the type's expected `strategies`".

- [ ] **Step 5: Re-run the grep from Step 1, then sync, test and commit**

```bash
grep -n -i 'dnaseq\|dna-seq\|ploidy\|cnv\|SNP\|isolate\|IsolatesHTS\|check-released' skills/propose-chipseq/SKILL.md skills/propose-chipseq/resources/step-*.md
yarn sync-shared && yarn test 2>&1 | tail -6
git add -A skills CLAUDE.md README.md docs
git commit -m "propose-chipseq skill docs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: the grep prints nothing, and the tests show `fail 0`.

---

### Task 9: Version, end-to-end check, PR

- [ ] **Step 1: Bump to 2.6.0**

```bash
sed -i 's/"version": "2.5.0"/"version": "2.6.0"/' package.json .claude-plugin/plugin.json
grep -rn 'propose-dnaseq' .claude-plugin
```

If the `grep` shows an explicit skill list, add `propose-chipseq` beside `propose-dnaseq`.

- [ ] **Step 2: End-to-end check through Step 5 (no publish)**

Ask John which VEuPathDatasets checkout and rebuild branch to use, and which ChIP-seq BioProject to try. The curator example was the *T. brucei* H3/H3K125ac runs `SRR13477527`–`SRR13477540`; find their BioProject with:

```bash
curl -s "https://www.ebi.ac.uk/ena/portal/api/filereport?accession=SRR13477527&result=read_run&fields=study_accession&format=tsv"
```

In that checkout (clean, on master), using `../dataset-curator-chipseq/skills/propose-chipseq/scripts/`:

1. `check-workspace.js`, then `start-proposal.js <PRJ> --external-id bioproject=<PRJ>`.
2. `fetch-sra-metadata.js <PRJ> --no-geo`, then `check-library.js <PRJ> --type chipseq`. Expect exit 0 and no `library_strategy` warning for ChIP-Seq runs.
3. Annotations per Step 2, with explicit `sampleId`, `role` and `input`. Overrides: `name` `Test_chipseq_2026`, `version` `2026-11-02`, `presenter.shortDisplayName` `Tb histone test`, `presenter.shortAttribution` `Test 2026`, `dataset.props.experimentType` `histonemod`.
4. `write-proposal.js ... --type chipseq --skill propose-chipseq ...`. Confirm that any `Warning:` lines are the curatedWarnings you expect. For example, an input with no ChIP sample, as in John's pasted example (`PF1_K125ac_Input`).
5. `render-proposal.js Proposals/<PRJ>`, `--dataset`, and `--artifacts .curation/delivery`. Verify that:
   - the presenter has `hasCalledPeaks` `true`
   - the dataset has `experimentType` `histonemod`, `hasPairedEnds` matching the runs, and `readsFileType` `fastq`
   - the delivery path ends in `/chipSeq/Test_chipseq_2026/2026-11-02/final`
   - the samplesheet has the `input` column filled for the ChIP rows
6. Clean up: `git switch master && git branch -D proposal/<PRJ> && rm -rf Proposals/<PRJ> .curation/delivery`. Nothing is pushed.

Record the commands and the key output lines for the PR description.

- [ ] **Step 3: Full run, push, PR**

```bash
cd /home/jbrestel/workspaces/src/dataset-curator-chipseq
yarn sync-shared && yarn test 2>&1 | tail -6
git add -A && git commit -m "2.6.0: propose-chipseq

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
unset GITHUB_TOKEN
git push -u origin propose-chipseq
gh pr create --base main --title "propose-chipseq skill and chipseq dataset type (2.6.0)" --body "<summary; the _sra-experiment refactor is behavior-preserving (dnaseq golden files unchanged); curatedWarnings hook; end-to-end transcript highlights; follow-ups: publish-time build-order check for pending genomes, bowtie-mapping-nextflow fragLength \$ bug>

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

Ask John before pushing. The push and the PR are outward-facing.

---

## Self-review notes

- **Spec coverage:**
  - optional 4th column → T1
  - library strategies per type → T2, T7
  - shared factory before the second copy → T3
  - `extraBowtieParams` may be empty → T4
  - warnings to the curator → T5, T6
  - `chipSeqExperiment` props with derived `hasPairedEnds`/`readsFileType`/`fromSRA` → T6
  - `hasCalledPeaks` rendered from `experimentType` and refused as an override → T6
  - pairing errors, and the histonemod / noInput rules → T6
  - unused-input, partial-input and strategy warnings → T6
  - organism rule, same release or earlier → T6 (rule), T8 (docs); enforcement is the existing Phase 1 warning and Phase 2 stop
  - corpus root → T6
  - label and validation workspace → T7
  - skill → T8
  - version and e2e → T9
- **Deviations from the spec (the spec was updated to match):**
  - `experimentType` is validated against a constant pinned to the class doc by a test, not parsed at runtime.
  - `hasCalledPeaks` is `experimentType === 'histonemod'` alone, because histonemod without inputs is already an error.
  - `prepare-delivery.js` needs no `assayType`.
- **Not in this plan (follow-ups for the PR body):**
  - the publish-time build-order check for pending genome proposals (all functional types)
  - the bowtie-mapping-nextflow `fragLength` `$` bug
  - `verify-chipseq`
