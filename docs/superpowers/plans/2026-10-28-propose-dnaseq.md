# Propose DNA-seq Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `propose-dnaseq` skill and `dnaseq` dataset type (Phase 1 and Phase 2). It shares SRA sample handling with bulk RNA-seq through a new module, and drops the samplesheet `strandedness` column everywhere.

**Architecture:** Sample normalization, the 3-column samplesheet and the samplesheet↔STF id check move from `bulk-rnaseq.js` to `dataset-types/_sra-samples.js`, which both types use. Network checks (released site, library metadata) run in standalone scripts that write JSON inputs. That keeps dataset-type modules pure: they read files and never fetch. Load gains a generic "required organism constant" step, which dnaseq uses for `ploidy`.

**Tech Stack:** Node 18 ESM, zero dependencies, `node:test`. Shared files are synced into skills by `bin/sync-shared.js`, configured in `package.json` `sharedFiles`.

**Spec:** `docs/superpowers/specs/2026-10-28-propose-dnaseq-design.md`

---

## Ground rules for every task

- Work in a git worktree on the task's feature branch (below). Never commit to `main`.
- Edit `shared/`. Never edit the copies under `skills/*/scripts`: the pre-commit hook runs `yarn sync-shared` and overwrites them. A new shared file needs a `package.json` `sharedFiles` entry, or `tests/skill-imports.test.js` fails.
- Run tests with `yarn test`; a single file is `node --test tests/<file>.test.js`. Baseline on `main`: 681 pass, 0 fail, 5 skipped.
- Comments: only where the code is not self-describing, at most 2–3 lines. Match the JSDoc one-liners used in `shared/scripts/dataset-types/bulk-rnaseq.js`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Branches and PRs

| PR | Repo | Branch | Base | Tasks |
|---|---|---|---|---|
| 1 | dataset-curator | `sra-samples-module` | `propose-dnaseq-design` (holds spec + plan) | 1–5 |
| 2 | VEuPathDatasets (`~/dataset-curation-demo/VEuPathDatasets`) | `migrate/samplesheet-strandedness` | `master` | 6–7 |
| 3 | dataset-curator | `propose-dnaseq` | `sra-samples-module` | 8–17 |

PR 1 and PR 2 merge together: after PR 1, the loader refuses 4-column samplesheets.

## File structure

| File | Responsibility |
|---|---|
| `shared/scripts/dataset-types/_sra-samples.js` (new) | Normalize samples, samplesheet write/parse, STF id parse, `checkSamplesAgree` |
| `shared/scripts/dataset-types/bulk-rnaseq.js` | Imports the above; keeps analysisConfig, strandedness, multi-organism, file sources |
| `shared/scripts/dataset-types/_common.js` | Gains `presenterBodyXml` (presenter body shared by RNA-seq and DNA-seq) |
| `shared/scripts/dataset-types/dnaseq.js` (new) | The `dnaseqExperiment` type |
| `shared/scripts/lib/library-checks.js` (new) | Pure: hard stops and warnings over ENA runs |
| `shared/scripts/lib/released-organisms.js` (new) | GenomeDataTypes query and match; fetch is injectable |
| `shared/scripts/lib/organism-constants.js` (new) | Read, check and insert `<constant>`s in an organism file |
| `shared/scripts/check-library.js` (new) | CLI over library-checks |
| `shared/scripts/check-released-organism.js` (new) | CLI: query, match, write `_released_organism.json` |
| `shared/scripts/fetch-sra-metadata.js` (moved from `skills/propose-bulk-rnaseq/scripts/`) | Shared by both propose skills |
| `bin/dropSamplesheetStrandednessColumn.js` (new) | One-time migration over a VEuPathDatasets checkout |
| `skills/propose-dnaseq/` (new) | SKILL.md and step resources |

---

# PR 1: shared SRA-samples module and 3-column samplesheet

### Task 0: Worktree

- [ ] **Step 1: Create the worktree**

```bash
cd /home/jbrestel/workspaces/misc/dataset-curator
git worktree add ../dataset-curator-sra-samples -b sra-samples-module propose-dnaseq-design
cd ../dataset-curator-sra-samples && yarn install --frozen-lockfile && yarn test 2>&1 | tail -8
```

Expected: `pass 681`, `fail 0`.

### Task 1: Move sample normalization into `_sra-samples.js`

A pure move with no behaviour change. The existing `normalizeSamples` tests in `tests/dataset-types.test.js` call `rnaseq.normalizeSamples`, which stays as a re-export, so they must pass untouched. That is the proof.

**Files:**
- Create: `shared/scripts/dataset-types/_sra-samples.js`
- Modify: `shared/scripts/dataset-types/bulk-rnaseq.js` (delete the moved definitions at lines 261–275 and 318–393, and add an import)
- Modify: `package.json` (`sharedFiles`)
- Test: `tests/sra-samples.test.js` (new)

- [ ] **Step 1: Write the failing test**

`tests/sra-samples.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as sra from '../shared/scripts/dataset-types/_sra-samples.js';
import * as rnaseq from '../shared/scripts/dataset-types/bulk-rnaseq.js';

const runs = [
  { run_accession: 'SRR1', sample_accession: 'SAMN1', sample_title: 'WT rep1' },
  { run_accession: 'SRR2', sample_accession: 'SAMN1', sample_title: 'WT rep1' },
  { run_accession: 'SRR3', sample_accession: 'SAMN2', sample_title: 'WT rep2' }
];

test('normalizeSamples lives in _sra-samples and bulk-rnaseq re-exports the same function', () => {
  assert.equal(rnaseq.normalizeSamples, sra.normalizeSamples);
});

test('runs of one BioSample are one sample; BioSamples with one title share a label', () => {
  const { samples } = sra.normalizeSamples({ samples: [{ runs: ['SRR1', 'SRR2'] }, { runs: ['SRR3'] }] }, runs);
  assert.deepEqual(samples.map((s) => [s.sampleId, s.label, s.biosample]), [['WT_rep1', 'WT', 'SAMN1'], ['WT_rep2', 'WT', 'SAMN2']]);
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `node --test tests/sra-samples.test.js`
Expected: FAIL with `Cannot find module .../_sra-samples.js`.

- [ ] **Step 3: Create `_sra-samples.js` by moving code**

Move these verbatim from `bulk-rnaseq.js` into `shared/scripts/dataset-types/_sra-samples.js`: `DEFAULT_SOURCE`, `SAMPLE_ID`, `REPLICATE_SUFFIX`, `FILE_NAME`, `toSampleId`, `withoutPipes`, `curatorLabel`, `assertSampleIds`, `normalizeFileSamples`, `normalizeSamples`, with their JSDoc. Export `DEFAULT_SOURCE` and `normalizeSamples`; the rest stay private. Also move `differ` (lines 573–578) and export it. The file starts:

```js
/** Sample handling shared by dataset types whose reads come from SRA runs or curator-named files. */

export const DEFAULT_SOURCE = { type: 'sra' };
```

In `bulk-rnaseq.js`, delete the moved definitions and add:

```js
import { DEFAULT_SOURCE, normalizeSamples, differ } from './_sra-samples.js';

export { normalizeSamples };
```

Remove the now-unused `export function normalizeSamples` and `const DEFAULT_SOURCE` lines. Keep `readRuns`, `runsOf` and `sraFile` in bulk-rnaseq.

- [ ] **Step 4: Register the shared file**

In `package.json` `sharedFiles`, add an entry next to `"scripts/dataset-types/bulk-rnaseq.js"`, with the same skill list as that entry (copy it):

```json
"scripts/dataset-types/_sra-samples.js": ["propose-genome-assembly", "propose-bulk-rnaseq", "load-proposals", "verify-bulk-rnaseq"],
```

Run: `yarn sync-shared`

- [ ] **Step 5: Run all tests**

Run: `yarn test 2>&1 | tail -8`
Expected: `fail 0`, with pass = 683 (681 + 2 new).

- [ ] **Step 6: Commit**

```bash
git add shared/scripts/dataset-types/_sra-samples.js shared/scripts/dataset-types/bulk-rnaseq.js package.json skills tests/sra-samples.test.js
git commit -m "Move SRA sample normalization into dataset-types/_sra-samples.js

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: 3-column samplesheet in `_sra-samples.js`

**Files:**
- Modify: `shared/scripts/dataset-types/_sra-samples.js`
- Modify: `shared/scripts/dataset-types/bulk-rnaseq.js` (`SAMPLESHEET_HEADER`, `samplesheet()`, `deriveArtifacts`, the samplesheet part of `checkOrganism`)
- Modify fixtures: `tests/fixtures/proposals/{PRJNA000002,PRJNA000003,PRJNA525426}/curated/*/samplesheet.csv`, `tests/fixtures/proposals/PRJNA000002/expected-artifacts/samplesheet.csv`
- Test: `tests/sra-samples.test.js`, plus existing tests that assert strandedness rows

- [ ] **Step 1: Write the failing tests**

Append to `tests/sra-samples.test.js`:

```js
test('samplesheet has one row per run or files entry, sorted, with no strandedness column', () => {
  const text = sra.samplesheet([
    { sampleId: 'B', runs: ['SRR3'] },
    { sampleId: 'A', runs: ['SRR2', 'SRR1'] },
    { sampleId: 'C', files: [{ fastq_1: 'c_1.fq.gz', fastq_2: 'c_2.fq.gz' }] }
  ]);
  assert.equal(text, 'sample,fastq_1,fastq_2\nA,SRR1,\nA,SRR2,\nB,SRR3,\nC,c_1.fq.gz,c_2.fq.gz\n');
});

test('parseSamplesheet returns rows with line numbers and refuses the old 4-column header', () => {
  assert.deepEqual(sra.parseSamplesheet('sample,fastq_1,fastq_2\nA,SRR1,\n\n'), {
    errors: [], rows: [{ line: 2, sample: 'A', fastq1: 'SRR1', fastq2: '' }]
  });
  const old = sra.parseSamplesheet('sample,fastq_1,fastq_2,strandedness\nA,SRR1,,stranded\n');
  assert.deepEqual(old.errors, ['samplesheet.csv header must be sample,fastq_1,fastq_2']);
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `node --test tests/sra-samples.test.js`
Expected: FAIL, `sra.samplesheet is not a function`.

- [ ] **Step 3: Implement in `_sra-samples.js`**

```js
export const SAMPLESHEET_HEADER = 'sample,fastq_1,fastq_2';

/**
 * One row per run or files entry. An SRA run appears once with fastq_2 empty;
 * downstream expands the run into its paired files.
 */
export function samplesheet(samples) {
  const rows = samples
    .flatMap((s) => (s.files
      ? s.files.map((f) => [s.sampleId, f.fastq_1, f.fastq_2 ?? ''])
      : (s.runs || []).map((run) => [s.sampleId, run, ''])))
    .sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
  return [SAMPLESHEET_HEADER, ...rows.map((r) => r.join(','))].join('\n') + '\n';
}

export function parseSamplesheet(text) {
  const [header, ...lines] = text.split(/\r?\n/);
  const errors = header.trim() === SAMPLESHEET_HEADER ? [] : [`samplesheet.csv header must be ${SAMPLESHEET_HEADER}`];
  const rows = lines
    .map((l, i) => ({ l: l.trim(), line: i + 2 }))
    .filter(({ l }) => l)
    .map(({ l, line }) => {
      const [sample, fastq1, fastq2] = l.split(',').map((c) => c.trim());
      return { line, sample, fastq1, fastq2: fastq2 ?? '' };
    });
  return { errors, rows };
}
```

- [ ] **Step 4: Switch `bulk-rnaseq.js` to it**

- Delete `const SAMPLESHEET_HEADER = ...` and `function samplesheet(annotations, stranded)`. Import `samplesheet, parseSamplesheet` from `./_sra-samples.js`.
- In `deriveArtifacts`, replace `samplesheet(own, stranded)` with `samplesheet(own.samples)`.
- In `checkOrganism`, replace the header and row parsing block (from `const [header, ...lines] = files['samplesheet.csv']...` through the end of the `for (const r of rows)` loop) with the code below. The strandedness row check goes away; analysisConfig's `isStrandSpecific` check stays.

```js
  const sheet = parseSamplesheet(files['samplesheet.csv']);
  errors.push(...sheet.errors);
  const { rows } = sheet;
  const sheetIds = new Set(rows.map((r) => r.sample));
  for (const r of rows) {
    const row = `samplesheet.csv line ${r.line} (${r.sample})`;
    if (source.type === 'sra') {
      if (r.fastq2) errors.push(`${row} has a fastq_2, but an SRA source lists each run once`);
    } else if (Boolean(r.fastq2) !== paired) errors.push(`${row} ${paired ? 'has no fastq_2' : 'has a fastq_2'} but dataset.json says hasPairedEnds ${paired}`);
  }
```

- [ ] **Step 5: Update fixtures**

```bash
for f in tests/fixtures/proposals/*/curated/*/samplesheet.csv tests/fixtures/proposals/PRJNA000002/expected-artifacts/samplesheet.csv; do
  sed -i -E '1s/^sample,fastq_1,fastq_2,strandedness$/sample,fastq_1,fastq_2/; 2,$s/,[^,]*$//' "$f"
done
grep -rL '^sample,fastq_1,fastq_2$' tests/fixtures/proposals/*/curated/*/samplesheet.csv
```

Expected: the `grep -L` prints nothing.

- [ ] **Step 6: Run all tests and fix strandedness-row assertions**

Run: `yarn test 2>&1 | grep -E '^not ok|fail '`

Tests that wrote or asserted a 4th `stranded`/`unstranded` cell now fail. Candidates are in `tests/dataset-types.test.js`, `tests/proposal-ops.test.js`, `tests/load-ops.test.js`, `tests/artifacts.test.js` and `tests/validators-bulk-rnaseq.test.js`; find them with `grep -n "stranded'\|,stranded\|,unstranded\|strandedness" tests/*.test.js`. For each:
- A test that builds a samplesheet string: drop the 4th cell and use the 3-column header.
- A test asserting the error `says stranded but dataset.json says isStrandSpecific`: delete it. That check no longer exists, and analysisConfig's `isStrandSpecific` test still covers dataset-level strandedness.

Leave every assertion about `analysisConfig.xml` `isStrandSpecific` as it is.

Expected after the fixes: `fail 0`.

- [ ] **Step 7: Commit**

```bash
git add -A shared skills tests
git commit -m "Samplesheet drops the strandedness column; strandedness is dataset-wide

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3: `checkSamplesAgree`, the id check

**Files:**
- Modify: `shared/scripts/dataset-types/_sra-samples.js`
- Modify: `shared/scripts/dataset-types/bulk-rnaseq.js` (`checkOrganism`)
- Test: `tests/sra-samples.test.js`

- [ ] **Step 1: Write the failing tests**

```js
const tsvOf = (...ids) => ['sample.ID \\\\ Descriptors\tlabel', ...ids.map((id) => `${id}\tx`)].join('\n') + '\n';
const sheetOf = (...ids) => sra.samplesheet(ids.map((sampleId, i) => ({ sampleId, runs: [`SRR${i}`] })));

test('checkSamplesAgree passes when samplesheet, STF and annotations hold the same ids', () => {
  assert.deepEqual(sra.checkSamplesAgree({ samplesheet: sheetOf('A', 'B'), tsv: tsvOf('B', 'A'), sampleIds: ['A', 'B'], versus: 'annotations.json' }), []);
});

test('checkSamplesAgree names an id found only in the samplesheet, only in the STF, or only in the annotations', () => {
  const errors = sra.checkSamplesAgree({ samplesheet: sheetOf('A', 'S'), tsv: tsvOf('A', 'T'), sampleIds: ['A', 'S', 'N'], versus: 'annotations.json' });
  assert.deepEqual(errors, [
    'samplesheet.csv and entity-sample.tsv disagree: only in samplesheet.csv: S; only in entity-sample.tsv: T',
    'samplesheet.csv and annotations.json disagree: only in samplesheet.csv: none; only in annotations.json: N'
  ]);
});

test('checkSamplesAgree treats ids differing only in case as different', () => {
  const errors = sra.checkSamplesAgree({ samplesheet: sheetOf('abc'), tsv: tsvOf('ABC'), sampleIds: ['abc'], versus: 'annotations.json' });
  assert.deepEqual(errors, ['samplesheet.csv and entity-sample.tsv disagree: only in samplesheet.csv: abc; only in entity-sample.tsv: ABC']);
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `node --test tests/sra-samples.test.js`
Expected: FAIL, `sra.checkSamplesAgree is not a function`.

- [ ] **Step 3: Implement**

In `_sra-samples.js`:

```js
/** The sample ids in an entity-sample.tsv: column 1 of every row after the header. */
export const stfSampleIds = (tsv) => new Set(tsv.split(/\r?\n/).slice(1).filter((l) => l.trim()).map((l) => l.split('\t')[0].trim()));

/**
 * The check that matters most to loading: samplesheet sample names, STF ids and
 * the annotations' sampleIds are one set. versus names the annotations in messages.
 */
export function checkSamplesAgree({ samplesheet: text, tsv, sampleIds, versus }) {
  const sheetIds = new Set(parseSamplesheet(text).rows.map((r) => r.sample));
  return [
    ...differ(sheetIds, 'samplesheet.csv', stfSampleIds(tsv), 'entity-sample.tsv'),
    ...differ(sheetIds, 'samplesheet.csv', new Set(sampleIds), versus)
  ];
}
```

In `bulk-rnaseq.js` `checkOrganism`, replace the `stfIds` line, the two `differ(...)` calls that compare it, and the `tagged` comparison with:

```js
  const versus = multi ? `the samples tagged for ${p}` : annotationsName;
  errors.push(...checkSamplesAgree({ samplesheet: files['samplesheet.csv'], tsv: files['entity-sample.tsv'], sampleIds: samplesFor(annotations, m, p).map((s) => s.sampleId), versus }));
```

Keep the analysisConfig `differ(sheetIds, ...)` call, which still needs `sheetIds`. Import `checkSamplesAgree` from `./_sra-samples.js`.

- [ ] **Step 4: Run all tests**

Run: `yarn test 2>&1 | tail -8`
Expected: `fail 0`. Existing `checkCurated` tests in `tests/dataset-types.test.js` and `tests/proposal-ops.test.js` assert the same message strings, so the output must not change.

- [ ] **Step 5: Commit**

```bash
git add shared skills tests
git commit -m "checkSamplesAgree: one samplesheet/STF/annotation id check for every SRA-sample type

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4: Migration script

**Files:**
- Create: `bin/dropSamplesheetStrandednessColumn.js`
- Test: `tests/drop-samplesheet-strandedness.test.js`

- [ ] **Step 1: Write the failing tests**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { planMigration, applyMigration } from '../bin/dropSamplesheetStrandednessColumn.js';

function tree(t, files) {
  const root = mkdtempSync(join(tmpdir(), 'migrate-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(root, rel, '..'), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return root;
}

test('planMigration lists old-format samplesheets with before and after headers and row counts', (t) => {
  const root = tree(t, { 'Proposals/P1/curated/abc1/samplesheet.csv': 'sample,fastq_1,fastq_2,strandedness\nA,SRR1,,stranded\nB,SRR2,,stranded\n' });
  assert.deepEqual(planMigration(root), {
    refused: [],
    files: [{ path: 'Proposals/P1/curated/abc1/samplesheet.csv', before: 'sample,fastq_1,fastq_2,strandedness', after: 'sample,fastq_1,fastq_2', rows: 2 }]
  });
});

test('planMigration skips files already migrated and refuses any other header', (t) => {
  const root = tree(t, {
    'Proposals/P1/curated/a/samplesheet.csv': 'sample,fastq_1,fastq_2\nA,SRR1,\n',
    'Proposals/P2/curated/b/samplesheet.csv': 'sample,fastq_1,strandedness\nA,SRR1,stranded\n'
  });
  const plan = planMigration(root);
  assert.deepEqual(plan.files, []);
  assert.deepEqual(plan.refused, ['Proposals/P2/curated/b/samplesheet.csv: header "sample,fastq_1,strandedness"']);
});

test('applyMigration drops column 4 and keeps a trailing newline', (t) => {
  const rel = 'Proposals/P1/curated/abc1/samplesheet.csv';
  const root = tree(t, { [rel]: 'sample,fastq_1,fastq_2,strandedness\nA,SRR1,,stranded\nB,a.fq,b.fq,unstranded\n' });
  applyMigration(root, planMigration(root));
  assert.equal(readFileSync(join(root, rel), 'utf-8'), 'sample,fastq_1,fastq_2\nA,SRR1,\nB,a.fq,b.fq\n');
});

test('applyMigration refuses to run when any file was refused', (t) => {
  const root = tree(t, { 'Proposals/P2/curated/b/samplesheet.csv': 'x,y\n' });
  assert.throws(() => applyMigration(root, planMigration(root)), /Refusing to migrate/);
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `node --test tests/drop-samplesheet-strandedness.test.js`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`bin/dropSamplesheetStrandednessColumn.js`:

```js
#!/usr/bin/env node
/**
 * One-time migration: drops the strandedness column from every
 * Proposals/<acc>/curated/<abbrev>/samplesheet.csv in a VEuPathDatasets checkout,
 * then re-runs the curated-artifact check on each migrated proposal.
 *
 * Usage: node bin/dropSamplesheetStrandednessColumn.js [--dry-run] <VEuPathDatasets checkout>
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const OLD = 'sample,fastq_1,fastq_2,strandedness';
const NEW = 'sample,fastq_1,fastq_2';

function samplesheets(root) {
  const proposals = join(root, 'Proposals');
  if (!existsSync(proposals)) return [];
  return readdirSync(proposals).flatMap((acc) => {
    const curated = join(proposals, acc, 'curated');
    if (!existsSync(curated)) return [];
    return readdirSync(curated, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join(curated, d.name, 'samplesheet.csv')))
      .map((d) => `Proposals/${acc}/curated/${d.name}/samplesheet.csv`);
  });
}

export function planMigration(root) {
  const files = [];
  const refused = [];
  for (const path of samplesheets(root)) {
    const [header, ...lines] = readFileSync(join(root, path), 'utf-8').split(/\r?\n/);
    if (header === NEW) continue;
    if (header !== OLD) { refused.push(`${path}: header "${header}"`); continue; }
    files.push({ path, before: OLD, after: NEW, rows: lines.filter((l) => l.trim()).length });
  }
  return { files, refused };
}

export function applyMigration(root, plan) {
  if (plan.refused.length) throw new Error(`Refusing to migrate; unexpected headers:\n  - ${plan.refused.join('\n  - ')}`);
  for (const { path } of plan.files) {
    const [, ...lines] = readFileSync(join(root, path), 'utf-8').split(/\r?\n/);
    const rows = lines.filter((l) => l.trim()).map((l) => l.split(',').slice(0, 3).join(','));
    writeFileSync(join(root, path), [NEW, ...rows].join('\n') + '\n');
  }
}

async function main() {
  const { values, positionals: [root] } = parseArgs({ options: { 'dry-run': { type: 'boolean', default: false } }, allowPositionals: true });
  if (!root) { console.error('Usage: node bin/dropSamplesheetStrandednessColumn.js [--dry-run] <VEuPathDatasets checkout>'); process.exit(1); }
  const plan = planMigration(root);
  for (const f of plan.files) console.log(`${f.path}: "${f.before}" -> "${f.after}" (${f.rows} rows)`);
  for (const r of plan.refused) console.error(`Refused: ${r}`);
  if (values['dry-run']) return;
  applyMigration(root, plan);
  const { checkCurated } = await import('../shared/scripts/dataset-types/bulk-rnaseq.js');
  const proposals = [...new Set(plan.files.map((f) => f.path.split('/').slice(0, 2).join('/')))];
  let failed = false;
  for (const p of proposals) {
    const errors = checkCurated(join(root, p));
    if (errors.length) { failed = true; console.error(`${p}:\n  - ${errors.join('\n  - ')}`); }
  }
  if (failed) process.exit(1);
  console.log(`Migrated ${plan.files.length} samplesheets in ${proposals.length} proposals; checkCurated passes for each.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(`Error: ${e.message}`); process.exit(1); });
```

- [ ] **Step 4: Run the tests**

Run: `node --test tests/drop-samplesheet-strandedness.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add bin/dropSamplesheetStrandednessColumn.js tests/drop-samplesheet-strandedness.test.js
git commit -m "One-time migration script: drop the samplesheet strandedness column in proposals

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 5: Docs, version, PR 1

**Files:**
- Modify: any `shared/resources/*.md` or `skills/propose-bulk-rnaseq/resources/*.md` that shows the 4-column header. Find them with `grep -rn 'strandedness' skills/*/resources shared/resources skills/*/SKILL.md`.
- Modify: `.claude-plugin/plugin.json` and `package.json` version `2.2.0` → `2.2.1`

- [ ] **Step 1: Update the docs**

Wherever a samplesheet example or header appears, change it to `sample,fastq_1,fastq_2` and drop the 4th cell from example rows. Where text says strandedness is in the samplesheet, change it to: strandedness is `dataset.json` `isStrandSpecific` and analysisConfig's `isStrandSpecific`, and the samplesheet does not carry it.

- [ ] **Step 2: Bump the version, sync, test, commit**

```bash
sed -i 's/"version": "2.2.0"/"version": "2.2.1"/' package.json .claude-plugin/plugin.json
yarn sync-shared && yarn test 2>&1 | tail -8
git add -A && git commit -m "Docs: 3-column samplesheet; 2.2.1

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: `fail 0`.

- [ ] **Step 3: Push and open PR 1**

```bash
unset GITHUB_TOKEN
git push -u origin sra-samples-module
gh pr create --base main --title "Shared SRA-samples module; samplesheet drops strandedness (2.2.1)" --body "$(cat <<'EOF'
Moves sample normalization, the samplesheet and the samplesheet/STF/annotation id check out of bulk-rnaseq into dataset-types/_sra-samples.js, ahead of propose-dnaseq.

The samplesheet is now `sample,fastq_1,fastq_2`: strandedness is a property of the whole dataset (`isStrandSpecific`), and the workflow ignores the column.

**Merge with the VEuPathDatasets migration PR**: after this, load refuses 4-column samplesheets.

Includes the design spec and implementation plan for propose-dnaseq.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Note that this PR's base is `main` but the branch was cut from `propose-dnaseq-design`, so the spec and plan commits ship with it.

---

# PR 2: VEuPathDatasets migration

Runs in `~/dataset-curation-demo/VEuPathDatasets` (SSH remote). Uses the script from Task 4 in the PR 1 worktree, `../dataset-curator-sra-samples`.

### Task 6: Migrate master

- [ ] **Step 1: Branch off a current master**

```bash
cd ~/dataset-curation-demo/VEuPathDatasets
git status --porcelain   # must print nothing; stop and report if it does
git fetch origin && git switch -c migrate/samplesheet-strandedness origin/master
```

- [ ] **Step 2: Dry run**

```bash
node /home/jbrestel/workspaces/misc/dataset-curator-sra-samples/bin/dropSamplesheetStrandednessColumn.js --dry-run .
```

Expected: 10 lines, one per samplesheet: PRJNA1068590, PRJNA1248451, PRJNA1305407 ×2, PRJNA286180, PRJNA311604, PRJNA525426, PRJNA557765, PRJNA565800, PRJNA749283. No `Refused:` lines. If the list differs, stop and report it.

- [ ] **Step 3: Run, commit, push, open the PR**

```bash
node /home/jbrestel/workspaces/misc/dataset-curator-sra-samples/bin/dropSamplesheetStrandednessColumn.js .
git add Proposals && git commit -m "Proposals: drop the samplesheet strandedness column

Strandedness is dataset-wide (dataset.json isStrandSpecific). Merge together with dataset-curator 2.2.1.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
unset GITHUB_TOKEN
git push -u origin migrate/samplesheet-strandedness
gh pr create --base master --title "Proposals: drop the samplesheet strandedness column" --body "$(cat <<'EOF'
Drops column 4 (`strandedness`) from the curated `samplesheet.csv` of every RNA-seq proposal. Strandedness is a property of the whole dataset (`dataset.json` `isStrandSpecific` and analysisConfig).

Generated by `bin/dropSamplesheetStrandednessColumn.js` in dataset-curator; `checkCurated` passes for every migrated proposal.

**Merge together with** the dataset-curator PR "Shared SRA-samples module; samplesheet drops strandedness (2.2.1)".

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: the last line of the script output is `Migrated 10 samplesheets in 9 proposals; checkCurated passes for each.`

### Task 7: Migrate `proposal/PRJDB6658` (PR #115, Initial draft)

- [ ] **Step 1: Check out the branch and migrate**

```bash
cd ~/dataset-curation-demo/VEuPathDatasets
git switch -c proposal/PRJDB6658 --track origin/proposal/PRJDB6658 2>/dev/null || git switch proposal/PRJDB6658
git pull --ff-only
node /home/jbrestel/workspaces/misc/dataset-curator-sra-samples/bin/dropSamplesheetStrandednessColumn.js --dry-run .
```

Expected: the dry run lists `Proposals/PRJDB6658/...` plus whatever master proposals the branch carries. That's fine, because those files are identical to master's and git merges them cleanly.

- [ ] **Step 2: Run, commit, push**

```bash
node /home/jbrestel/workspaces/misc/dataset-curator-sra-samples/bin/dropSamplesheetStrandednessColumn.js .
git add Proposals && git commit -m "Drop the samplesheet strandedness column

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin proposal/PRJDB6658
git switch master
```

---

# PR 3: propose-dnaseq

### Task 8: Worktree

- [ ] **Step 1: Create the worktree**

```bash
cd /home/jbrestel/workspaces/misc/dataset-curator
git worktree add ../dataset-curator-dnaseq -b propose-dnaseq sra-samples-module
cd ../dataset-curator-dnaseq && yarn install --frozen-lockfile && yarn test 2>&1 | tail -4
```

Expected: `fail 0`.

### Task 9: Library checks

**Files:**
- Create: `shared/scripts/lib/library-checks.js`
- Create: `shared/scripts/check-library.js`
- Test: `tests/library-checks.test.js`

- [ ] **Step 1: Write the failing tests**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { libraryProblems } from '../shared/scripts/lib/library-checks.js';

const run = (over) => ({
  run_accession: 'SRR1', sample_accession: 'SAMN1', library_source: 'GENOMIC', library_strategy: 'WGS',
  library_selection: 'RANDOM', library_layout: 'PAIRED', instrument_platform: 'ILLUMINA',
  instrument_model: 'Illumina NovaSeq 6000', read_count: '5000000', base_count: '1500000000', ...over
});

test('a clean WGS run has no problems', () => {
  assert.deepEqual(libraryProblems([run()]), { errors: [], warnings: [] });
});

test('no runs, zero reads and non-GENOMIC sources are hard stops', () => {
  assert.deepEqual(libraryProblems([]).errors, ['No runs: the BioProject has no reads in SRA']);
  assert.deepEqual(libraryProblems([run({ read_count: '0' }), run({ run_accession: 'SRR2', base_count: '' })]).errors, [
    'SRR1: read_count is 0 or missing', 'SRR2: base_count is 0 or missing'
  ]);
  assert.deepEqual(libraryProblems([run({ library_source: 'TRANSCRIPTOMIC' })]).errors, ['SRR1: library_source is TRANSCRIPTOMIC, not GENOMIC']);
});

test('PRJNA1086165-shaped runs give every warning and no hard stop', () => {
  const shaped = [
    run({ run_accession: 'SRR28314583', sample_accession: 'SAMN40370510', library_strategy: 'WXS', library_selection: 'PolyA', library_layout: 'SINGLE', read_count: '40230', base_count: '64924939' }),
    run({ run_accession: 'SRR28314585', sample_accession: 'SAMN40370508', library_selection: 'PolyA', library_layout: 'SINGLE', read_count: '4935', base_count: '42393258' })
  ];
  const { errors, warnings } = libraryProblems(shaped);
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, [
    'SRR28314583: library_strategy is WXS, not WGS',
    'SRR28314583: library_selection PolyA is an RNA selection',
    'SRR28314583: mean read length 1614 bp is implausible for Illumina NovaSeq 6000 (over 300)',
    'SRR28314585: library_selection PolyA is an RNA selection',
    'SRR28314585: mean read length 8590 bp is implausible for Illumina NovaSeq 6000 (over 300)',
    'SAMN40370510: 40230 reads, under 1000000',
    'SAMN40370508: 4935 reads, under 1000000'
  ]);
});

test('paired-end read length is per mate', () => {
  assert.deepEqual(libraryProblems([run({ read_count: '5000000', base_count: '2500000000' })]).warnings, []);
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `node --test tests/library-checks.test.js`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `shared/scripts/lib/library-checks.js`**

```js
/** Quick checks that ENA runs are DNA sequencing with reads. Pure: runs in, messages out. */

export const MIN_SAMPLE_READS = 1_000_000;
export const MAX_ILLUMINA_READ_LENGTH = 300;
const RNA_SELECTIONS = new Set(['PolyA', 'cDNA', 'Oligo-dT', 'cDNA_randomPriming', 'cDNA_oligo_dT']);

const count = (v) => (/^\d+$/.test(String(v ?? '')) ? Number(v) : 0);
const isIllumina = (r) => (r.instrument_platform || '').toUpperCase() === 'ILLUMINA' || /illumina|novaseq|hiseq|nextseq|miseq/i.test(r.instrument_model || '');

/** { errors, warnings }: errors are hard stops; warnings are for the curator to accept or act on. */
export function libraryProblems(runs) {
  if (!runs.length) return { errors: ['No runs: the BioProject has no reads in SRA'], warnings: [] };
  const errors = [];
  const warnings = [];
  for (const r of runs) {
    const id = r.run_accession;
    for (const k of ['read_count', 'base_count']) if (!count(r[k])) errors.push(`${id}: ${k} is 0 or missing`);
    if (r.library_source !== 'GENOMIC') errors.push(`${id}: library_source is ${r.library_source || 'missing'}, not GENOMIC`);
  }
  for (const r of runs) {
    const id = r.run_accession;
    if (r.library_strategy !== 'WGS') warnings.push(`${id}: library_strategy is ${r.library_strategy || 'missing'}, not WGS`);
    if (RNA_SELECTIONS.has(r.library_selection)) warnings.push(`${id}: library_selection ${r.library_selection} is an RNA selection`);
    const reads = count(r.read_count);
    const mates = (r.library_layout || '').toUpperCase() === 'PAIRED' ? 2 : 1;
    const length = reads ? Math.round(count(r.base_count) / reads / mates) : 0;
    if (isIllumina(r) && length > MAX_ILLUMINA_READ_LENGTH) {
      warnings.push(`${id}: mean read length ${length} bp is implausible for ${r.instrument_model || 'Illumina'} (over ${MAX_ILLUMINA_READ_LENGTH})`);
    }
  }
  const bySample = new Map();
  for (const r of runs) bySample.set(r.sample_accession, (bySample.get(r.sample_accession) ?? 0) + count(r.read_count));
  for (const [sample, reads] of bySample) if (reads < MIN_SAMPLE_READS) warnings.push(`${sample}: ${reads} reads, under ${MIN_SAMPLE_READS}`);
  return { errors, warnings };
}
```

- [ ] **Step 4: Run the tests**

Run: `node --test tests/library-checks.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Implement `shared/scripts/check-library.js`**

```js
#!/usr/bin/env node
/**
 * check-library.js - Checks that a proposal's SRA runs are DNA sequencing with reads.
 * Reads .curation/tmp/<accession>_sra_metadata.json; exits 1 on any hard stop.
 *
 * Usage: node check-library.js <accession>
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { libraryProblems } from './lib/library-checks.js';

const [accession] = process.argv.slice(2);
if (!accession) { console.error('Usage: node check-library.js <accession>'); process.exit(1); }
const path = resolve(`.curation/tmp/${accession}_sra_metadata.json`);
if (!existsSync(path)) { console.error(`Error: no ${path}; run fetch-sra-metadata.js ${accession} first`); process.exit(1); }
const { errors, warnings } = libraryProblems(JSON.parse(readFileSync(path, 'utf-8')).runs ?? []);
for (const w of warnings) console.error(`Warning: ${w}`);
for (const e of errors) console.error(`Error: ${e}`);
console.log(JSON.stringify({ errors, warnings }, null, 2));
process.exit(errors.length ? 1 : 0);
```

- [ ] **Step 6: Commit**

```bash
git add shared/scripts/lib/library-checks.js shared/scripts/check-library.js tests/library-checks.test.js
git commit -m "library-checks: hard stops and warnings for DNA-seq SRA runs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 10: Released-organism lookup

**Files:**
- Create: `shared/scripts/lib/released-organisms.js`
- Create: `shared/scripts/check-released-organism.js`
- Create: `tests/fixtures/genome-data-types.json`
- Test: `tests/released-organisms.test.js`

- [ ] **Step 1: Create the recorded-response fixture**

`tests/fixtures/genome-data-types.json` is a trimmed real response shape:

```json
{"records":[
  {"attributes":{"source_id":"NCBITAXON_332648","organism_name":"Botrytis cinerea B05.10","strain":"B05.10","project_id":"FungiDB","chromosomeCount":"18"}},
  {"attributes":{"source_id":"NCBITAXON_999001","organism_name":"Botrytis cinerea T4","strain":"T4","project_id":"FungiDB","chromosomeCount":"0"}},
  {"attributes":{"source_id":"NCBITAXON_1003232","organism_name":"Edhazardia aedis USNM 41457","strain":"USNM 41457","project_id":"MicrosporidiaDB","chromosomeCount":"0"}}
]}
```

- [ ] **Step 2: Write the failing tests**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fetchReleasedOrganisms, matchReleased, GENOME_INFO_URL } from '../shared/scripts/lib/released-organisms.js';

const body = readFileSync(new URL('./fixtures/genome-data-types.json', import.meta.url), 'utf-8');
const okFetch = async (url, init) => ({ ok: true, status: 200, text: async () => body, url, init });

test('fetchReleasedOrganisms posts the GenomeDataTypes report and parses the records', async () => {
  let seen;
  const records = await fetchReleasedOrganisms(async (url, init) => { seen = { url, init }; return okFetch(url, init); });
  assert.equal(seen.url, GENOME_INFO_URL);
  assert.equal(seen.init.method, 'POST');
  assert.deepEqual(JSON.parse(seen.init.body).reportConfig.attributes, ['organism_name', 'strain', 'project_id', 'chromosomeCount']);
  assert.deepEqual(records[0], { sourceId: 'NCBITAXON_332648', organismName: 'Botrytis cinerea B05.10', strain: 'B05.10', project: 'FungiDB', chromosomeCount: 18 });
});

test('fetchReleasedOrganisms refuses a failed query with no fallback', async () => {
  await assert.rejects(fetchReleasedOrganisms(async () => ({ ok: false, status: 503, text: async () => 'down' })), /veupathdb\.org.*HTTP 503/);
  await assert.rejects(fetchReleasedOrganisms(async () => ({ ok: true, status: 200, text: async () => '<html>' })), /not JSON/);
  await assert.rejects(fetchReleasedOrganisms(async () => { throw new Error('ENOTFOUND'); }), /ENOTFOUND/);
});

test('matchReleased matches on taxon id and project', async () => {
  const records = await fetchReleasedOrganisms(okFetch);
  assert.deepEqual(matchReleased(records, { ncbiTaxonId: '332648', project: 'FungiDB', species: 'Botrytis cinerea' }), {
    matched: true, record: records[0], by: 'taxon'
  });
});

test('matchReleased lists same-species candidates when nothing matches', async () => {
  const records = await fetchReleasedOrganisms(okFetch);
  const r = matchReleased(records, { ncbiTaxonId: '5', project: 'FungiDB', species: 'Botrytis cinerea' });
  assert.equal(r.matched, false);
  assert.deepEqual(r.candidates.map((c) => c.sourceId), ['NCBITAXON_332648', 'NCBITAXON_999001']);
});

test('matchReleased takes a curator pick and refuses an unknown or other-project pick', async () => {
  const records = await fetchReleasedOrganisms(okFetch);
  assert.deepEqual(matchReleased(records, { ncbiTaxonId: '5', project: 'FungiDB', species: 'Botrytis cinerea', pick: 'NCBITAXON_999001' }), {
    matched: true, record: records[1], by: 'curator'
  });
  assert.throws(() => matchReleased(records, { project: 'FungiDB', pick: 'NCBITAXON_1' }), /NCBITAXON_1 is not a released organism/);
  assert.throws(() => matchReleased(records, { project: 'FungiDB', pick: 'NCBITAXON_1003232' }), /MicrosporidiaDB organism, not FungiDB/);
});
```

- [ ] **Step 3: Run them and confirm they fail**

Run: `node --test tests/released-organisms.test.js`
Expected: FAIL, module not found.

- [ ] **Step 4: Implement `shared/scripts/lib/released-organisms.js`**

```js
/** Organisms on the released VEuPathDB site, from the Genome Info and Stats search. No API key is needed. */

export const GENOME_INFO_URL = 'https://veupathdb.org/veupathdb/service/record-types/organism/searches/GenomeDataTypes/reports/standard';
const REQUEST = {
  searchConfig: { parameters: {} },
  reportConfig: { attributes: ['organism_name', 'strain', 'project_id', 'chromosomeCount'], pagination: { offset: 0, numRecords: 5000 } }
};

/** Every released organism as { sourceId, organismName, strain, project, chromosomeCount }; any failure throws. */
export async function fetchReleasedOrganisms(fetchImpl = fetch) {
  const res = await fetchImpl(GENOME_INFO_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(REQUEST) });
  const text = await res.text();
  if (!res.ok) throw new Error(`veupathdb.org Genome Info and Stats query failed: HTTP ${res.status}`);
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error('veupathdb.org Genome Info and Stats response is not JSON'); }
  if (!Array.isArray(parsed.records)) throw new Error('veupathdb.org Genome Info and Stats response has no records');
  return parsed.records.map(({ attributes: a }) => ({
    sourceId: a.source_id, organismName: a.organism_name, strain: a.strain, project: a.project_id, chromosomeCount: Number(a.chromosomeCount) || 0
  }));
}

const genusSpecies = (name) => (name || '').trim().split(/\s+/).slice(0, 2).join(' ').toLowerCase();

/**
 * The released record for an organism: by the curator's pick (a source_id), else
 * by NCBITAXON_<ncbiTaxonId> in the project. Unmatched returns same-species candidates.
 */
export function matchReleased(records, { ncbiTaxonId, project, species, pick }) {
  if (pick !== undefined) {
    const record = records.find((r) => r.sourceId === pick);
    if (!record) throw new Error(`${pick} is not a released organism on veupathdb.org`);
    if (record.project !== project) throw new Error(`${pick} is a ${record.project} organism, not ${project}`);
    return { matched: true, record, by: 'curator' };
  }
  const record = ncbiTaxonId && records.find((r) => r.sourceId === `NCBITAXON_${ncbiTaxonId}` && r.project === project);
  if (record) return { matched: true, record, by: 'taxon' };
  const want = genusSpecies(species);
  return { matched: false, candidates: want ? records.filter((r) => genusSpecies(r.organismName) === want) : [] };
}
```

- [ ] **Step 5: Run the tests**

Run: `node --test tests/released-organisms.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 6: Implement `shared/scripts/check-released-organism.js`**

```js
#!/usr/bin/env node
/**
 * check-released-organism.js - Confirms a DNA-seq proposal's organism is on the
 * released site (gene CNV needs its orthomcl paralogs) and records its chromosome
 * count. Writes .curation/tmp/<accession>_released_organism.json for write-proposal.js.
 * Exits 2 with candidates when no record matches: the curator picks one with
 * --released-organism <source_id>, or confirms it is not released (a hard stop).
 *
 * Usage: node check-released-organism.js <accession> --organism <abbrev> --project <Project> --rebuild-branch rebuildRR [--released-organism <source_id>]
 */
import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { openWorkspace } from './lib/config.js';
import { createGit } from './lib/git-ops.js';
import { readOrganismIndex } from './lib/organisms.js';
import { fetchReleasedOrganisms, matchReleased, GENOME_INFO_URL } from './lib/released-organisms.js';

async function main() {
  const { values, positionals: [accession] } = parseArgs({
    options: { organism: { type: 'string' }, project: { type: 'string' }, 'rebuild-branch': { type: 'string' }, 'released-organism': { type: 'string' } },
    allowPositionals: true
  });
  if (!accession || !values.organism || !values.project || !values['rebuild-branch']) {
    console.error('Usage: node check-released-organism.js <accession> --organism <abbrev> --project <Project> --rebuild-branch rebuildRR [--released-organism <source_id>]');
    process.exit(1);
  }
  const config = openWorkspace();
  const git = createGit(config.repoPath);
  git.fetch();
  const ref = `origin/${values['rebuild-branch']}`;
  const entry = readOrganismIndex(git, ref).find((e) => e.abbrev === values.organism && e.project === values.project);
  if (!entry) throw new Error(`${values.organism} is not a ${values.project} organism on ${ref}`);
  const sraPath = resolve(`.curation/tmp/${accession}_sra_metadata.json`);
  const species = existsSync(sraPath) ? JSON.parse(readFileSync(sraPath, 'utf-8')).runs?.find((r) => r.scientific_name)?.scientific_name : undefined;

  const result = matchReleased(await fetchReleasedOrganisms(), { ncbiTaxonId: entry.ncbiTaxonId, project: values.project, species, pick: values['released-organism'] });
  if (!result.matched) {
    console.error(`No released ${values.project} organism has taxon ${entry.ncbiTaxonId ?? '(none in the organism file)'}. Ask the curator which candidate is ${values.organism}, or whether it is not released yet (then it cannot be proposed: gene CNV needs its orthomcl paralogs).`);
    console.log(JSON.stringify({ candidates: result.candidates }, null, 2));
    process.exit(2);
  }
  const out = {
    organism: values.organism, project: values.project, ncbiTaxonId: entry.ncbiTaxonId ?? null,
    released: { sourceId: result.record.sourceId, organismName: result.record.organismName, strain: result.record.strain, chromosomeCount: result.record.chromosomeCount },
    matchedBy: result.by, service: GENOME_INFO_URL, queriedAt: new Date().toISOString()
  };
  const path = resolve(`.curation/tmp/${accession}_released_organism.json`);
  writeFileSync(path, JSON.stringify(out, null, 2) + '\n');
  console.log(path);
}

main().catch((err) => { console.error(`Error: ${err.message}`); process.exit(1); });
```

- [ ] **Step 7: Commit**

```bash
git add shared/scripts/lib/released-organisms.js shared/scripts/check-released-organism.js tests/released-organisms.test.js tests/fixtures/genome-data-types.json
git commit -m "released-organisms: GenomeDataTypes lookup by taxon id, curator pick when unmatched

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 11: The organism rule refuses pending genomes

**Files:**
- Modify: `shared/scripts/lib/organisms.js` (`crossCheckOrganisms`, around the `const genome = claims.find(...)` branch)
- Test: `tests/organisms.test.js`

- [ ] **Step 1: Write the failing test**

Read the existing `crossCheckOrganisms` tests in `tests/organisms.test.js` for the `index`/`claims` fixture shapes, and reuse that file's helpers. Then add:

```js
test('crossCheckOrganisms refuses an organism only a pending genome introduces when the rule says pending: refuse', () => {
  const m = { accession: 'PRJNA9', organisms: [{ proposedOrganismAbbrev: 'tnewST1', source: 'loaded', project: 'FungiDB' }] };
  const claims = [{ accession: 'GCA_9.1', project: 'FungiDB', organism: { proposedOrganismAbbrev: 'tnewST1' } }];
  const warned = crossCheckOrganisms(m, { index: [], claims, rebuild: 'origin/rebuild02' });
  assert.equal(warned.errors.length, 0);
  const refused = crossCheckOrganisms(m, { index: [], claims, rebuild: 'origin/rebuild02', rule: { new: false, pending: 'refuse' } });
  assert.deepEqual(refused.errors, ['tnewST1 is not released: genome proposal GCA_9.1 proposes it, and this dataset type needs a released organism']);
  assert.deepEqual(refused.warnings, []);
});
```

If `claimedAbbrev(c)` reads a different field than `organism.proposedOrganismAbbrev`, match the claim shape the neighbouring tests use.

- [ ] **Step 2: Run it and confirm it fails**

Run: `node --test tests/organisms.test.js`
Expected: FAIL, because `refused.errors` is empty.

- [ ] **Step 3: Implement**

In `crossCheckOrganisms(m, { index, claims, rebuild, rule })`, inside the `if (genome) {` branch after the project check, add:

```js
      if (rule?.pending === 'refuse') {
        errors.push(`${p} is not released: genome proposal ${genome.accession} proposes it, and this dataset type needs a released organism`);
        return o;
      }
```

In `shared/scripts/lib/proposal-ops.js` `writeProposal`, pass the rule:

```js
  const crossCheck = crossCheckOrganisms(manifest, { index: readOrganismIndex(git, rebuildRef), claims, rebuild: rebuildRef, rule: organismRuleOf(manifest.datasetType) });
```

- [ ] **Step 4: Run all tests and commit**

```bash
yarn test 2>&1 | tail -4
git add shared tests && git commit -m "Organism rule: a type can refuse organisms only a pending genome introduces

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: `fail 0`.

### Task 12: Shared presenter body

DNA-seq renders the same presenter body as RNA-seq. Extract it instead of copying it.

**Files:**
- Modify: `shared/scripts/dataset-types/_common.js` (add `presenterBodyXml`)
- Modify: `shared/scripts/dataset-types/bulk-rnaseq.js` (`renderPresenter`, lines 230–248)

- [ ] **Step 1: Add `presenterBodyXml` to `_common.js`**

```js
/** The presenter elements between the opening tag and the injectors, as RNA-seq and DNA-seq render them. */
export function presenterBodyXml(p, m, build) {
  const contacts = contactElements(m.contacts.additional);
  const pubmeds = pubmedElements(p.pubmedIds);
  return `    <displayName><![CDATA[${escapeForCDATA(p.displayName)}]]></displayName>
    <shortDisplayName>${escapeXml(p.shortDisplayName)}</shortDisplayName>
    <shortAttribution>${escapeXml(p.shortAttribution)}</shortAttribution>
    <summary><![CDATA[${escapeForCDATA(p.summary)}]]></summary>
    <description><![CDATA[

<b>General Description:</b> ${escapeForCDATA(p.description)}
<br><br><b>Methodology used:</b> ${escapeForCDATA(p.methodology)}

                  ]]></description>
    <protocol>${escapeXml(p.protocol)}</protocol>
    <caveat>${escapeXml(p.caveat)}</caveat>
    <acknowledgement>${escapeXml(p.acknowledgement)}</acknowledgement>
    <releasePolicy>${escapeXml(p.releasePolicy)}</releasePolicy>
    <history buildNumber="${escapeXml(build)}"/>
    <primaryContactId>${escapeXml(m.contacts.primary)}</primaryContactId>
${contacts ? contacts + '\n' : ''}${linkElements(p.links)}
${pubmeds ? pubmeds + '\n' : ''}`;
}
```

- [ ] **Step 2: Use it in `bulk-rnaseq.js` `renderPresenter`**

Replace the return statement and the now-unused `contacts`/`pubmeds` locals:

```js
  return `${opening}
${presenterBodyXml(p, m, build)}${injectors}
  </datasetPresenter>`;
```

Import `presenterBodyXml` from `./_common.js`, and drop any imports that become unused.

- [ ] **Step 3: Golden tests prove it is byte-identical**

Run: `yarn test 2>&1 | tail -4`
Expected: `fail 0`. The `expected.xml` golden comparisons in `tests/dataset-types.test.js` and `tests/render-proposal.test.js` catch any difference.

- [ ] **Step 4: Commit**

```bash
git add shared skills && git commit -m "presenterBodyXml: one presenter body for sequencing experiment types

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 13: The `dnaseq` dataset type

**Files:**
- Create: `shared/scripts/dataset-types/dnaseq.js`
- Modify: `tests/fixtures/classes.xml` (add the `dnaseqExperiment` class)
- Create fixture: `tests/fixtures/proposals/PRJNA000010/` (manifest, inputs, curated annotations, expected outputs)
- Test: `tests/dataset-types-dnaseq.test.js`

- [ ] **Step 1: Add the class to the fixture `classes.xml`**

Insert before the closing root tag of `tests/fixtures/classes.xml`. This copy matches `Model/lib/xml/datasetClass/classes.xml:7118` in VEuPathDatasets:

```xml
  <datasetClass class="dnaseqExperiment" category="" datasetFileHint="">
    <purpose></purpose>
    <prop name="projectName">&projectName;</prop>
    <prop name="organismAbbrev">&organismAbbrev;</prop>
    <prop name="name">&name;</prop>
    <prop name="version">&version;</prop>
    <prop name="fromSRA"></prop>
    <prop name="ploidy"></prop>
    <graphTemplateFile name="dnaseq.xml"/>
    <datasetLoader datasetName="${organismAbbrev}_${name}_dnaseqExperiment_RSRC" version="${version}"
          plugin="ApiCommonData::Load::Plugin::LoadNothing"
              scope="organism"
              type="isolates"
              subType="Dna_Seq"
              organismAbbrev="${organismAbbrev}">
      <manualGet fileOrDir="common/empty">
        <dir name="final">
        </dir>
      </manualGet>
      <unpack>ln -s @@manualDeliveryDir@@/${projectName}/${organismAbbrev}/SNP/${name}/${version}/final/ @@dataDir@@/final</unpack>
      <getAndUnpackOutput dir="@@dataDir@@/final"/>
      <getAndUnpackOutput file="@@dataDir@@/final/samplesheet.csv"/>
      <pluginArgs>--dbRefExternalDatabaseSpec "%DATASET_NAME%|%DATASET_VERSION%"</pluginArgs>
    </datasetLoader>
  </datasetClass>
```

If the fixture's entities (`&projectName;` and the rest) are not declared, copy how the existing `rnaSeqExperiment` fixture block writes its identity props.

- [ ] **Step 2: Create the fixture proposal `tests/fixtures/proposals/PRJNA000010/`**

`manifest.json`:

```json
{
  "schemaVersion": 4,
  "accession": "PRJNA000010",
  "externalIds": { "bioproject": "PRJNA000010" },
  "datasetType": "dnaseq",
  "organisms": [{ "proposedOrganismAbbrev": "tfakST1", "source": "loaded", "project": "FungiDB" }],
  "datasetClass": "dnaseqExperiment",
  "name": "Doe_isolates_2025",
  "version": "2025-03-01",
  "contacts": { "primary": "jane.doe", "additional": [] },
  "curator": "someone@apidb.org",
  "createdAt": "2026-10-28T12:00:00.000Z",
  "skill": { "name": "propose-dnaseq", "version": "2.3.0" }
}
```

`inputs/PRJNA000010_sra_metadata.json`:

```json
{
  "bioproject": "PRJNA000010",
  "runs": [
    { "run_accession": "SRR11", "sample_accession": "SAMN11", "sample_title": "isolate A", "scientific_name": "Testus fakeus", "library_source": "GENOMIC", "library_strategy": "WGS", "library_selection": "RANDOM", "library_layout": "PAIRED", "instrument_platform": "ILLUMINA", "instrument_model": "Illumina NovaSeq 6000", "read_count": "5000000", "base_count": "1500000000", "experiment_title": "WGS of Testus fakeus isolates" },
    { "run_accession": "SRR12", "sample_accession": "SAMN11", "sample_title": "isolate A", "scientific_name": "Testus fakeus", "library_source": "GENOMIC", "library_strategy": "WGS", "library_selection": "RANDOM", "library_layout": "PAIRED", "instrument_platform": "ILLUMINA", "instrument_model": "Illumina NovaSeq 6000", "read_count": "5000000", "base_count": "1500000000", "experiment_title": "WGS of Testus fakeus isolates" },
    { "run_accession": "SRR13", "sample_accession": "SAMN12", "sample_title": "isolate B", "scientific_name": "Testus fakeus", "library_source": "GENOMIC", "library_strategy": "WGS", "library_selection": "RANDOM", "library_layout": "PAIRED", "instrument_platform": "ILLUMINA", "instrument_model": "Illumina NovaSeq 6000", "read_count": "6000000", "base_count": "1800000000", "experiment_title": "WGS of Testus fakeus isolates" }
  ]
}
```

`inputs/PRJNA000010_released_organism.json`:

```json
{
  "organism": "tfakST1", "project": "FungiDB", "ncbiTaxonId": "1",
  "released": { "sourceId": "NCBITAXON_1", "organismName": "Testus fakeus ST-1", "strain": "ST-1", "chromosomeCount": 7 },
  "matchedBy": "taxon", "service": "https://veupathdb.org/veupathdb/service/record-types/organism/searches/GenomeDataTypes/reports/standard",
  "queriedAt": "2026-10-28T12:00:00.000Z"
}
```

`curated/PRJNA000010_sample_annotations.json`:

```json
{
  "samples": [
    { "runs": ["SRR11", "SRR12"], "factors": { "strain": "A", "host": "soil" } },
    { "runs": ["SRR13"], "factors": { "strain": "B", "host": "leaf" } }
  ],
  "factors": { "strain": { "displayName": "Strain" }, "host": { "displayName": "Host" } }
}
```

The expected outputs (`expected.xml`, `expected-dataset.xml`, `expected-artifacts/`) are generated in Step 6, then reviewed by eye.

- [ ] **Step 3: Write the failing tests**

`tests/dataset-types-dnaseq.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, cpSync, rmSync, writeFileSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import * as dnaseq from '../shared/scripts/dataset-types/dnaseq.js';
import { readDatasetClass, expandPattern, identityValues, CLASSES_RELATIVE_PATH } from '../shared/scripts/lib/dataset-classes.js';
import { loadManifest, PREVIEW_BUILD } from '../shared/scripts/dataset-types/_common.js';

const fixtures = new URL('./fixtures/', import.meta.url).pathname;
const src = join(fixtures, 'proposals', 'PRJNA000010');
const classDef = (() => {
  const repo = mkdtempSync(join(tmpdir(), 'classes-'));
  mkdirSync(join(repo, 'Model/lib/xml/datasetClass'), { recursive: true });
  cpSync(join(fixtures, 'classes.xml'), join(repo, CLASSES_RELATIVE_PATH));
  return readDatasetClass(repo, 'dnaseqExperiment');
})();

function staged(t, { overrides = {} } = {}) {
  const tmp = mkdtempSync(join(tmpdir(), 'dnaseq-'));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const dir = join(tmp, basename(src));
  cpSync(src, dir, { recursive: true, filter: (p) => !/expected/.test(p) });
  dnaseq.normalizeCurated(dir, overrides.dataset);
  const presenter = dnaseq.derivePresenter(dir, { shortDisplayName: 'Tfak WGS', shortAttribution: 'Doe 2025', ...overrides.presenter });
  writeFileSync(join(dir, 'curated', 'presenter.json'), JSON.stringify(presenter, null, 2) + '\n');
  writeFileSync(join(dir, 'curated', 'dataset.json'), JSON.stringify(dnaseq.deriveDataset(dir, classDef, overrides.dataset ?? {}), null, 2) + '\n');
  for (const [f, text] of Object.entries(dnaseq.deriveArtifacts(dir))) {
    const path = join(dir, 'curated', f);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
  return dir;
}
```

Then add the tests:

```js
test('dnaseq dataset name follows the classes.xml datasetLoader pattern', () => {
  const m = loadManifest(src);
  assert.equal(dnaseq.datasetNameFor('tfakST1', m.name), expandPattern(classDef.datasetNamePattern, identityValues(m, 'tfakST1')));
  assert.deepEqual(dnaseq.presenterNames(src), ['tfakST1_Doe_isolates_2025_dnaseqExperiment_RSRC']);
});

test('dnaseq presenter defaults hasCNVData from the released chromosome count', (t) => {
  const dir = staged(t);
  assert.equal(JSON.parse(readFileSync(join(dir, 'curated', 'presenter.json'), 'utf-8')).injectorProps.hasCNVData, 'true');
  const contigs = join(dir, 'inputs', 'PRJNA000010_released_organism.json');
  const r = JSON.parse(readFileSync(contigs, 'utf-8')); r.released.chromosomeCount = 0; writeFileSync(contigs, JSON.stringify(r));
  assert.equal(dnaseq.derivePresenter(dir, {}).injectorProps.hasCNVData, 'false');
  assert.equal(dnaseq.derivePresenter(dir, { injectorProps: { hasCNVData: 'true' } }).injectorProps.hasCNVData, 'true');
});

test('dnaseq derivePresenter refuses a proposal without the released-organism input', (t) => {
  const dir = staged(t);
  rmSync(join(dir, 'inputs', 'PRJNA000010_released_organism.json'));
  assert.throws(() => dnaseq.derivePresenter(dir, {}), /check-released-organism\.js/);
});

test('dnaseq renders an IsolatesHTS presenter and a dataset entry with $$ploidy$$', (t) => {
  const dir = staged(t);
  const xml = dnaseq.renderPresenter(dir, { build: PREVIEW_BUILD });
  assert.match(xml, /<datasetPresenter name="tfakST1_Doe_isolates_2025_dnaseqExperiment_RSRC"\s+projectName="FungiDB">/);
  assert.match(xml, /className="org\.apidb\.apicommon\.model\.datasetInjector\.IsolatesHTS">\n\s*<prop name="hasCNVData">true<\/prop>/);
  assert.equal(readFileSync(join(src, 'expected.xml'), 'utf-8'), xml + '\n');
  const dataset = dnaseq.renderDataset(dir, classDef);
  assert.match(dataset, /<prop name="ploidy">\$\$ploidy\$\$<\/prop>/);
  assert.match(dataset, /<prop name="fromSRA">true<\/prop>/);
  assert.equal(readFileSync(join(src, 'expected-dataset.xml'), 'utf-8'), dataset + '\n');
});

test('dnaseq refuses a ploidy override, a non-SRA source and a library hard stop', (t) => {
  const dir = staged(t);
  assert.throws(() => dnaseq.deriveDataset(dir, classDef, { props: { ploidy: '2' } }), /ploidy comes from the organism file/);
  assert.throws(() => dnaseq.deriveDataset(dir, classDef, { source: { type: 'server', paths: ['/x'] } }), /reads from SRA only/);
  const sra = join(dir, 'inputs', 'PRJNA000010_sra_metadata.json');
  const d = JSON.parse(readFileSync(sra, 'utf-8')); d.runs[2].library_source = 'TRANSCRIPTOMIC'; writeFileSync(sra, JSON.stringify(d));
  assert.throws(() => dnaseq.deriveDataset(dir, classDef, {}), /SRR13: library_source is TRANSCRIPTOMIC/);
});

test('dnaseq artifacts: technical replicate runs share a sample, ids agree, and the layout is per organism', (t) => {
  const dir = staged(t);
  assert.equal(readFileSync(join(dir, 'curated', 'tfakST1', 'samplesheet.csv'), 'utf-8'), 'sample,fastq_1,fastq_2\nisolate_A,SRR11,\nisolate_A,SRR12,\nisolate_B,SRR13,\n');
  assert.deepEqual(dnaseq.checkCurated(dir), []);
  const { files } = dnaseq.renderArtifacts(dir, 'tfakST1');
  assert.deepEqual(Object.keys(files).sort(), [
    'sample-annotations-stf/tfakST1_Doe_isolates_2025_dnaseqExperiment_RSRC/entity-sample.tsv',
    'sample-annotations-stf/tfakST1_Doe_isolates_2025_dnaseqExperiment_RSRC/entity-sample.yaml',
    'sampleAnnotations.json', 'samplesheet.csv'
  ]);
});

test('dnaseq checkCurated names samplesheet ids missing from the STF', (t) => {
  const dir = staged(t);
  const tsv = join(dir, 'curated', 'tfakST1', 'entity-sample.tsv');
  writeFileSync(tsv, readFileSync(tsv, 'utf-8').replace('isolate_B', 'isolate_b'));
  assert.deepEqual(dnaseq.checkCurated(dir), ['samplesheet.csv and entity-sample.tsv disagree: only in samplesheet.csv: isolate_B; only in entity-sample.tsv: isolate_b']);
  assert.throws(() => dnaseq.assertCuratedAgree(dir), /isolate_B/);
});

test('dnaseq refuses organisms tags and files: it is single-organism and SRA-only', (t) => {
  const dir = staged(t);
  const path = join(dir, 'curated', 'PRJNA000010_sample_annotations.json');
  const a = JSON.parse(readFileSync(path, 'utf-8')); a.samples[0].organisms = ['tfakST1']; writeFileSync(path, JSON.stringify(a));
  assert.throws(() => dnaseq.normalizeCurated(dir), /single-organism/);
});
```

- [ ] **Step 4: Run them and confirm they fail**

Run: `node --test tests/dataset-types-dnaseq.test.js`
Expected: FAIL, `Cannot find module .../dnaseq.js`.

- [ ] **Step 5: Implement `shared/scripts/dataset-types/dnaseq.js`**

```js
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  loadManifest, readInputJson, readCuratedJson, readPresenter, applyOverrides, requireIdentity, readDataset,
  assertValidDataset, datasetElement, PRESENTER_SCHEMA_VERSION, DATASET_SCHEMA_VERSION, escapeXml, injectorProps,
  requireBuild, presenterBodyXml
} from './_common.js';
import { DEFAULT_SOURCE, normalizeSamples, samplesheet, parseSamplesheet, checkSamplesAgree } from './_sra-samples.js';
import { sampleAnnotationsToStf } from '../lib/stf.js';
import { libraryProblems } from '../lib/library-checks.js';
import { organismsOf, externalIdKindOf } from '../lib/manifest.js';

export const datasetClass = 'dnaseqExperiment';
export const injectorDefaults = { hasCNVData: 'false' };
export const requiredFields = ['shortDisplayName', 'shortAttribution'];
export const requiredInjectorProps = ['hasCNVData'];
/** Gene CNV needs orthomcl paralogs, so the organism must already be released. */
export const organismRule = { new: false, max: 1, pending: 'refuse' };
/** Organism-file constants the dataset entry references; load checks them and inserts any missing. */
export const requiredOrganismConstants = { ploidy: /^[1-9]\d*$/ };

const INJECTOR = 'org.apidb.apicommon.model.datasetInjector.IsolatesHTS';
export const datasetNameFor = (organism, name) => `${organism}_${name}_dnaseqExperiment_RSRC`;
export const annotationsFile = (m) => `${m.accession}_sample_annotations.json`;
const sraFile = (m) => `${m.accession}_sra_metadata.json`;
const releasedFile = (m) => `${m.accession}_released_organism.json`;
const runsOf = (dir, m) => readInputJson(dir, sraFile(m)).runs || [];
const organismOf = (m) => organismsOf(m)[0];

export const derivedCuratedFiles = ['samplesheet.csv', 'entity-sample.tsv', 'entity-sample.yaml'];

/** No GEO series dates a DNA-seq proposal, so the curator supplies name and version. */
export const deriveIdentity = () => ({ version: undefined, name: undefined });

export function presenterNames(proposalDir) {
  const m = loadManifest(proposalDir);
  requireIdentity(m, datasetClass);
  return [datasetNameFor(organismOf(m), m.name)];
}

function releasedOrganism(proposalDir, m) {
  if (!existsSync(join(proposalDir, 'inputs', releasedFile(m)))) {
    throw new Error(`${m.accession} needs inputs/${releasedFile(m)}; run check-released-organism.js and pass --input .curation/tmp/${releasedFile(m)}`);
  }
  return readInputJson(proposalDir, releasedFile(m));
}

function linksFor(m) {
  const ids = { ...(externalIdKindOf(m.accession) ? { [externalIdKindOf(m.accession)]: m.accession } : {}), ...m.externalIds };
  return ids.bioproject ? [{ text: 'NCBI Bioproject', url: `https://www.ncbi.nlm.nih.gov/bioproject/${ids.bioproject}` }] : [];
}

function methodologyFrom(runs) {
  const uniq = (key) => [...new Set(runs.map((r) => r[key]).filter(Boolean))];
  return [['Library strategy', 'library_strategy'], ['Layout', 'library_layout'], ['Sequencing', 'instrument_model']]
    .map(([label, key]) => [label, uniq(key)]).filter(([, v]) => v.length).map(([label, v]) => `${label}: ${v.join(', ')}`).join('. ');
}

/** Phase 1: the presenter record. hasCNVData defaults from the released assembly having chromosomes. */
export function derivePresenter(proposalDir, overrides = {}) {
  const m = loadManifest(proposalDir);
  requireIdentity(m, datasetClass);
  const runs = runsOf(proposalDir, m);
  const { released } = releasedOrganism(proposalDir, m);
  const species = runs.map((r) => r.scientific_name).find(Boolean);
  if (!species) throw new Error(`No scientific_name in any run of ${m.accession}`);
  return applyOverrides({
    schemaVersion: PRESENTER_SCHEMA_VERSION,
    displayName: `DNA-Seq analysis of ${species}`,
    shortDisplayName: '',
    shortAttribution: '',
    summary: `DNA-Seq analysis of <i>${species}</i>`,
    description: [...new Set(runs.map((r) => r.experiment_title).filter(Boolean))][0] || '',
    methodology: methodologyFrom(runs),
    protocol: '', caveat: '', acknowledgement: '', releasePolicy: '',
    pubmedIds: [],
    links: linksFor(m),
    history: {},
    injectorProps: { hasCNVData: String(released.chromosomeCount > 0) }
  }, overrides);
}

export function renderPresenter(proposalDir, { build } = {}) {
  requireBuild(build);
  const m = loadManifest(proposalDir);
  requireIdentity(m, datasetClass);
  const p = readPresenter(proposalDir, { requiredFields, requiredInjectorProps });
  return `  <datasetPresenter name="${escapeXml(datasetNameFor(organismOf(m), m.name))}"
                    projectName="${escapeXml(m.organisms[0].project)}">
${presenterBodyXml(p, m, build)}    <templateInjector className="${INJECTOR}">
${injectorProps(injectorDefaults, p.injectorProps)}
    </templateInjector>
  </datasetPresenter>`;
}

/** Phase 1: rewrites the staged annotations in normalized form; SRA only, one organism. */
export function normalizeCurated(proposalDir, datasetOverrides = {}) {
  const m = loadManifest(proposalDir);
  if (datasetOverrides?.source && datasetOverrides.source.type !== 'sra') throw new Error('dnaseq reads from SRA only');
  const annotations = readCuratedJson(proposalDir, annotationsFile(m));
  if (annotations.samples?.some((s) => s.organisms !== undefined)) throw new Error(`dnaseq proposals are single-organism; remove "organisms" from the samples in ${annotationsFile(m)}`);
  const normalized = normalizeSamples(annotations, runsOf(proposalDir, m), { source: DEFAULT_SOURCE });
  writeFileSync(join(proposalDir, 'curated', annotationsFile(m)), JSON.stringify(normalized, null, 2) + '\n');
}

/** Phase 1: the dnaseqExperiment record. ploidy is the organism file's constant, never a value. */
export function deriveDataset(proposalDir, classDef, overrides = {}) {
  const m = loadManifest(proposalDir);
  requireIdentity(m, datasetClass);
  if (overrides.props?.ploidy !== undefined) throw new Error('dataset.props.ploidy comes from the organism file ($$ploidy$$); set it at load with --ploidy');
  if (overrides.source && overrides.source.type !== 'sra') throw new Error('dnaseq reads from SRA only');
  const runs = runsOf(proposalDir, m);
  const { errors } = libraryProblems(runs);
  if (errors.length) throw new Error(`Runs of ${m.accession} fail the library checks:\n  - ${errors.join('\n  - ')}`);
  const record = { schemaVersion: DATASET_SCHEMA_VERSION, props: { fromSRA: 'true', ...overrides.props, ploidy: '$$ploidy$$' }, source: DEFAULT_SOURCE };
  assertValidDataset(record, classDef, { runAccessions: runs.map((r) => r.run_accession) }, `dataset for ${m.accession} (set values under "dataset" in --overrides)`);
  return record;
}

export function renderDataset(proposalDir, classDef) {
  const m = loadManifest(proposalDir);
  requireIdentity(m, datasetClass);
  const d = readDataset(proposalDir);
  if (d.props?.ploidy !== '$$ploidy$$') throw new Error(`curated/dataset.json of ${m.accession}: props.ploidy must be $$ploidy$$`);
  assertValidDataset(d, classDef, {}, `curated/dataset.json of ${m.accession}`);
  return datasetElement(m, classDef, d.props);
}

/** Phase 1: the organism's loading artifacts, keyed <proposed abbreviation>/<file>. */
export function deriveArtifacts(proposalDir) {
  const m = loadManifest(proposalDir);
  requireIdentity(m, datasetClass);
  const annotations = readCuratedJson(proposalDir, annotationsFile(m));
  const p = m.organisms[0].proposedOrganismAbbrev;
  const { tsv, yaml } = sampleAnnotationsToStf(annotations, { sra: true });
  return { [`${p}/samplesheet.csv`]: samplesheet(annotations.samples), [`${p}/entity-sample.tsv`]: tsv, [`${p}/entity-sample.yaml`]: yaml };
}

/** Errors when the curated artifacts and the sample annotations disagree. */
export function checkCurated(proposalDir) {
  const m = loadManifest(proposalDir);
  const p = m.organisms[0].proposedOrganismAbbrev;
  const missing = [annotationsFile(m), ...derivedCuratedFiles.map((f) => `${p}/${f}`)].filter((f) => !existsSync(join(proposalDir, 'curated', f)));
  if (missing.length) return missing.map((f) => `curated/${f} is missing; re-run write-proposal.js`);
  const text = (f) => readFileSync(join(proposalDir, 'curated', p, f), 'utf-8');
  let annotations;
  try { annotations = JSON.parse(readFileSync(join(proposalDir, 'curated', annotationsFile(m)), 'utf-8')); }
  catch (e) { return [`${annotationsFile(m)} is not valid JSON: ${e.message}`]; }
  const sheet = parseSamplesheet(text('samplesheet.csv'));
  return [
    ...sheet.errors,
    ...sheet.rows.filter((r) => r.fastq2).map((r) => `samplesheet.csv line ${r.line} (${r.sample}) has a fastq_2, but an SRA source lists each run once`),
    ...checkSamplesAgree({ samplesheet: text('samplesheet.csv'), tsv: text('entity-sample.tsv'), sampleIds: (annotations.samples ?? []).map((s) => s.sampleId), versus: annotationsFile(m) })
  ];
}

export function assertCuratedAgree(proposalDir) {
  const errors = checkCurated(proposalDir);
  if (errors.length) throw new Error(`Curated artifacts of ${loadManifest(proposalDir).accession} disagree:\n  - ${errors.join('\n  - ')}`);
}

/** Phase 2 (and the Phase 1 preview): the curated artifacts laid out for the delivery directory. */
export function renderArtifacts(proposalDir, organism) {
  const m = loadManifest(proposalDir);
  requireIdentity(m, datasetClass);
  assertCuratedAgree(proposalDir);
  const settled = organism ?? organismOf(m);
  const p = m.organisms[0].proposedOrganismAbbrev;
  const text = (f) => readFileSync(join(proposalDir, 'curated', p, f), 'utf-8');
  const stfDir = `sample-annotations-stf/${datasetNameFor(settled, m.name)}`;
  return {
    files: {
      'samplesheet.csv': text('samplesheet.csv'),
      'sampleAnnotations.json': readFileSync(join(proposalDir, 'curated', annotationsFile(m)), 'utf-8'),
      [`${stfDir}/entity-sample.tsv`]: text('entity-sample.tsv'),
      [`${stfDir}/entity-sample.yaml`]: text('entity-sample.yaml')
    }
  };
}
```

Two things to verify before running:
- Confirm `loadManifest` is exported from `_common.js`, as `bulk-rnaseq.js` imports it. Remove any unused imports.
- Confirm `injectorProps(defaults, chosen)` returns lines indented the way the RNA-seq injector renders. The golden file fixes the exact whitespace.

- [ ] **Step 6: Generate the golden files once, review them, then rerun**

Write a throwaway scratch script, `generateDnaseqGoldens.mjs` in the session scratchpad and not committed. It runs the `staged()` steps and writes `renderPresenter(dir, { build: 'NN' }) + '\n'` to `tests/fixtures/proposals/PRJNA000010/expected.xml` and `renderDataset(dir, classDef) + '\n'` to `expected-dataset.xml`. Show both files to the reviewer. They must contain:
- `expected.xml`: `name="tfakST1_Doe_isolates_2025_dnaseqExperiment_RSRC"`, `projectName="FungiDB"`, the IsolatesHTS injector with `<prop name="hasCNVData">true</prop>`, `<history buildNumber="NN"/>`, and the Bioproject link.
- `expected-dataset.xml`: props in class order `projectName, organismAbbrev, name, version, fromSRA, ploidy`, with values `$$projectName$$`, `$$organismAbbrev$$`, `Doe_isolates_2025`, `2025-03-01`, `true`, `$$ploidy$$`.

Run: `node --test tests/dataset-types-dnaseq.test.js`
Expected: PASS, 8 tests.

- [ ] **Step 7: Commit**

```bash
git add shared/scripts/dataset-types/dnaseq.js tests/dataset-types-dnaseq.test.js tests/fixtures
git commit -m "dnaseq dataset type: IsolatesHTS presenter, \$\$ploidy\$\$ dataset, samplesheet and STF

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 14: Register the type and sync it into skills

**Files:**
- Modify: `shared/scripts/dataset-types/index.js`
- Modify: `shared/resources/curator.config.json` (`typeLabels`)
- Modify: `package.json` (`sharedFiles`)
- Move: `skills/propose-bulk-rnaseq/scripts/fetch-sra-metadata.js` → `shared/scripts/fetch-sra-metadata.js`
- Test: `tests/skill-imports.test.js` (existing), plus a registry test

- [ ] **Step 1: Write a failing registry test**

Append to `tests/dataset-types-dnaseq.test.js`:

```js
import { DATASET_TYPES } from '../shared/scripts/dataset-types/index.js';
import { organismRuleOf } from '../shared/scripts/lib/manifest.js';

test('dnaseq is registered with a single-organism, released-only rule', () => {
  assert.equal(DATASET_TYPES.dnaseq, dnaseq);
  assert.deepEqual(organismRuleOf('dnaseq'), { new: false, max: 1, pending: 'refuse' });
});

test('the shipped ticket config labels dnaseq tickets "snp"', () => {
  const cfg = JSON.parse(readFileSync(new URL('../shared/resources/curator.config.json', import.meta.url), 'utf-8'));
  assert.equal(cfg.ticket.github.typeLabels.dnaseq, 'snp');
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `node --test tests/dataset-types-dnaseq.test.js`
Expected: FAIL on both.

- [ ] **Step 3: Register**

`shared/scripts/dataset-types/index.js`:

```js
import * as genomeAssembly from './genome-assembly.js';
import * as bulkRnaseq from './bulk-rnaseq.js';
import * as dnaseq from './dnaseq.js';

/** Every dataset type, by the datasetType a manifest names. */
export const DATASET_TYPES = { 'genome-assembly': genomeAssembly, 'bulk-rnaseq': bulkRnaseq, dnaseq };
```

In `shared/resources/curator.config.json` `typeLabels`, add `"dnaseq": "snp"`. That label already exists on VEuPathDatasets.

- [ ] **Step 4: Move fetch-sra-metadata.js into shared/**

```bash
git mv skills/propose-bulk-rnaseq/scripts/fetch-sra-metadata.js shared/scripts/fetch-sra-metadata.js
```

In `shared/scripts/fetch-sra-metadata.js`, add a `--no-geo` flag so a DNA-seq run doesn't warn about a missing GEO cross-reference. Parse it alongside the positional accession in `main()`:

```js
  const noGeo = args.includes('--no-geo');
  const accession = args.find((a) => !a.startsWith('--'));
```

Then guard the existing warning:

```js
  if (!xref && !noGeo) console.error(`  Warning: no ${accession}_xref.json, so GEO was not cross-checked; run resolve-accessions.js first`);
```

Read the existing argument handling (around line 162 of the original) and adapt it in place, keeping its usage text and adding `[--no-geo]` to it.

- [ ] **Step 5: Add `sharedFiles` entries**

In `package.json` `sharedFiles`:
- Add `"propose-dnaseq"` to the skill list of every entry that lists `"propose-bulk-rnaseq"`, except `scripts/lib/geo-xref.js`. Check each by hand: an entry that exists only for GEO handling stays RNA-seq only.
- Add `"load-proposals"` to `_sra-samples.js` if it's missing.
- Add new entries:

```json
"scripts/dataset-types/dnaseq.js": ["propose-genome-assembly", "propose-bulk-rnaseq", "propose-dnaseq", "load-proposals", "verify-bulk-rnaseq"],
"scripts/lib/library-checks.js": ["propose-genome-assembly", "propose-bulk-rnaseq", "propose-dnaseq", "load-proposals", "verify-bulk-rnaseq"],
"scripts/lib/released-organisms.js": ["propose-dnaseq"],
"scripts/lib/organism-constants.js": ["load-proposals"],
"scripts/check-library.js": ["propose-dnaseq"],
"scripts/check-released-organism.js": ["propose-dnaseq"],
"scripts/fetch-sra-metadata.js": ["propose-bulk-rnaseq", "propose-dnaseq"]
```

`dnaseq.js` goes everywhere `index.js` goes, because `index.js` imports it, and `library-checks.js` goes wherever `dnaseq.js` goes. `organism-constants.js` is created in Task 15; its entry can land here or there, but `yarn sync-shared` fails until the file exists. If so, add it in Task 15.

- [ ] **Step 6: Sync and run all tests**

```bash
mkdir -p skills/propose-dnaseq/scripts skills/propose-dnaseq/resources
yarn sync-shared && yarn test 2>&1 | tail -4
```

Expected: `fail 0`. `skill-imports.test.js` proves every relative import resolves inside each skill.

- [ ] **Step 7: Commit**

```bash
git add -A shared skills package.json tests
git commit -m "Register dnaseq; share fetch-sra-metadata.js; snp ticket label

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 15: Load checks and inserts the ploidy constant

**Files:**
- Create: `shared/scripts/lib/organism-constants.js`
- Modify: `shared/scripts/lib/load-ops.js` (`checkLoadPreconditions`, `renderDatasetParts`, the `loadProposal` PR body)
- Modify: `shared/scripts/load-proposal.js` (`--ploidy`)
- Test: `tests/organism-constants.test.js`, `tests/load-ops.test.js`

- [ ] **Step 1: Write the failing unit tests**

`tests/organism-constants.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withOrganismConstants } from '../shared/scripts/lib/organism-constants.js';

const file = `<?xml version="1.0"?>\n<datasets>\n  <constant name="organismAbbrev" value="tfakST1"/>\n  <constant name="projectName" value="FungiDB"/>\n\n  <dataset class="x">\n  </dataset>\n</datasets>\n`;
const required = { ploidy: /^[1-9]\d*$/ };

test('a constant already present is left alone, and a matching value is accepted', () => {
  const withPloidy = file.replace('value="FungiDB"/>', 'value="FungiDB"/>\n  <constant name="ploidy" value="1"/>');
  assert.deepEqual(withOrganismConstants(withPloidy, required, {}, 'tfakST1'), { content: withPloidy, added: [] });
  assert.deepEqual(withOrganismConstants(withPloidy, required, { ploidy: '1' }, 'tfakST1'), { content: withPloidy, added: [] });
});

test('a given value that differs from the file is a hard stop', () => {
  const withPloidy = file.replace('value="FungiDB"/>', 'value="FungiDB"/>\n  <constant name="ploidy" value="1"/>');
  assert.throws(() => withOrganismConstants(withPloidy, required, { ploidy: '2' }, 'tfakST1'), /tfakST1 already has ploidy 1; --ploidy says 2/);
});

test('a missing constant without a value stops and names the organism and the flag', () => {
  assert.throws(() => withOrganismConstants(file, required, {}, 'tfakST1'), /tfakST1 has no ploidy constant; confirm the value with the data loader, then pass --ploidy tfakST1=<N>/);
});

test('a missing constant with a valid value is inserted after the last top-level constant', () => {
  const { content, added } = withOrganismConstants(file, required, { ploidy: '2' }, 'tfakST1');
  assert.deepEqual(added, ['ploidy=2']);
  assert.match(content, /<constant name="projectName" value="FungiDB"\/>\n  <constant name="ploidy" value="2"\/>\n\n  <dataset/);
});

test('an invalid value is refused', () => {
  assert.throws(() => withOrganismConstants(file, required, { ploidy: '0' }, 'tfakST1'), /ploidy "0" for tfakST1 is not valid/);
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `node --test tests/organism-constants.test.js`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `shared/scripts/lib/organism-constants.js`**

```js
/** Top-level <constant> elements an organism file must define for a dataset type, checked and inserted at load. */

const constantRe = (name) => new RegExp(`<constant\\s+name="${name}"\\s+value="([^"]*)"\\s*/>`);

/**
 * Returns { content, added }. A constant already in the file wins and a differing
 * given value stops; a missing one needs a given value, which a person confirmed.
 */
export function withOrganismConstants(fileContent, required = {}, given = {}, organism) {
  let content = fileContent;
  const added = [];
  for (const [name, valid] of Object.entries(required)) {
    const present = constantRe(name).exec(content)?.[1];
    const value = given[name];
    if (value !== undefined && !valid.test(value)) throw new Error(`${name} "${value}" for ${organism} is not valid`);
    if (present !== undefined) {
      if (value !== undefined && value !== present) throw new Error(`${organism} already has ${name} ${present}; --${name} says ${value}`);
      continue;
    }
    if (value === undefined) throw new Error(`${organism} has no ${name} constant; confirm the value with the data loader, then pass --${name} ${organism}=<N>`);
    const constants = [...content.matchAll(/^([ \t]*)<constant\b[^>]*\/>[ \t]*$/gm)];
    const last = constants.at(-1);
    if (!last) throw new Error(`${organism}'s organism file has no <constant> to place ${name} after`);
    const at = last.index + last[0].length;
    content = `${content.slice(0, at)}\n${last[1]}<constant name="${name}" value="${value}"/>${content.slice(at)}`;
    added.push(`${name}=${value}`);
  }
  return { content, added };
}
```

- [ ] **Step 4: Run the unit tests**

Run: `node --test tests/organism-constants.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 5: Wire it into load-ops**

In `shared/scripts/lib/load-ops.js`:
- Add `organismConstants = {}` to the parameters of `checkLoadPreconditions` and `loadProposal`, and pass it from `loadProposal` to `checkLoadPreconditions`. Thread it to the `renderDatasetParts(m, dir, repoPath, { check: true })` call as `{ check: true, organismConstants }`.
- In `renderDatasetParts`, inside `if (check) { ... }` after the `datasetNameExists` check:

```js
      const constants = withOrganismConstants(datasetFile, datasetType.requiredOrganismConstants, organismConstants[organism] ?? {}, organism);
      datasetFile = constants.content;
      constantsAdded = constants.added;
```

  Declare `let constantsAdded = [];` next to `let datasetFile = null;`, and include `constantsAdded` in the returned organism object. Import `withOrganismConstants` from `./organism-constants.js`.
- In the `loadProposal` PR body, after the `Dataset:` line, add:

```js
      ...(dataset?.organisms ?? []).filter((o) => o.constantsAdded?.length).map((o) => `Organism constants added to \`${o.relFile}\`: ${o.constantsAdded.join(', ')} (confirmed by the data loader)`),
```

- [ ] **Step 6: Add `--ploidy` to `load-proposal.js`**

Add `ploidy: { type: 'string', multiple: true, default: [] }` to `options` and `[--ploidy <abbrev>=<N> ...]` to both usage strings. Parse it like `--settle`:

```js
  const organismConstants = {};
  for (const pair of values.ploidy) {
    const [abbrev, n, ...rest] = pair.split('=');
    if (!abbrev || !n || rest.length) { console.error(`--ploidy must be <abbrev>=<N>, got "${pair}"`); process.exit(1); }
    organismConstants[abbrev] = { ...organismConstants[abbrev], ploidy: n };
  }
```

Pass `organismConstants` to `loadProposal`. In the dry-run output, when an organism has `constantsAdded`, print `Dry run: would add constants ${o.constantsAdded.join(', ')} to ${o.relFile}`.

- [ ] **Step 7: Write the load-ops integration tests**

In `tests/load-ops.test.js`, copy the setup of an existing dry-run load test for a bulk-rnaseq proposal. Find one with `grep -n "dryRun: true" tests/load-ops.test.js`, then make the copy load the `PRJNA000010` fixture onto a rebuild branch whose `Datasets/lib/xml/datasets/FungiDB/tfakST1.xml` comes from `tests/fixtures/tfakST1.xml`, which has no ploidy constant. Assert:

```js
  await assert.rejects(loadProposal({ ...args, dryRun: true }), /tfakST1 has no ploidy constant; confirm the value with the data loader, then pass --ploidy tfakST1=<N>/);
  const result = await loadProposal({ ...args, dryRun: true, organismConstants: { tfakST1: { ploidy: '1' } } });
  assert.deepEqual(result.dataset.organisms[0].constantsAdded, ['ploidy=1']);
```

Add one non-dry-run test, modelled on the existing full-load test, that reads the committed `tfakST1.xml` on the load branch and asserts it contains `<constant name="ploidy" value="1"/>` and the new `dnaseqExperiment` dataset.

- [ ] **Step 8: Run all tests and commit**

```bash
yarn sync-shared && yarn test 2>&1 | tail -4
git add -A shared skills package.json tests
git commit -m "Load checks organism constants a type needs; dnaseq inserts ploidy after the loader confirms it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: `fail 0`.

### Task 16: The skill documents

**Files:**
- Create: `skills/propose-dnaseq/SKILL.md`
- Create: `skills/propose-dnaseq/resources/step-0-start-proposal.md` … `step-6-publish.md`
- Modify: `skills/load-proposals/SKILL.md` (ploidy section)
- Modify: `CLAUDE.md` (repository structure), `docs/development.md` (module table, if it lists dataset types or lib modules)
- Modify: `package.json` (`sharedFiles` for `resources/*` shared docs into `propose-dnaseq`: `valid-projects.json`, `curator.config.json`, `proposal-workflow.md`, `editing-large-xml.md`)

- [ ] **Step 1: Write SKILL.md**

Base it on `skills/propose-bulk-rnaseq/SKILL.md`, using the same section order and tone. The frontmatter:

```markdown
---
name: propose-dnaseq
description: Propose a DNA-seq (isolate WGS) dataset for VEuPathDB - check the SRA runs are DNA with reads, confirm the organism is released, analyze isolates, curate contacts, write a proposal to VEuPathDatasets with samplesheet and STF, open the PR and ticket
---
```

Content that differs from the RNA-seq skill, stated as instructions to Claude:
- **Required information:** VEuPathDB project; BioProject accession. If given a BioSample (SAMN…), look up its BioProject with `curl -s "https://www.ebi.ac.uk/ena/portal/api/filereport?accession=<SAMN>&result=read_run&fields=study_accession&format=tsv"` and confirm it with the curator. Also the organism abbreviation (same convention text as RNA-seq), and the rebuild branch (always ask, never guess). There is no "additional organisms" option and no GEO.
- **Step 0:** `start-proposal.js <PRJ> --external-id bioproject=<PRJ>`; no `resolve-accessions.js`.
- **Step 1:** `node scripts/fetch-sra-metadata.js <PRJ> --no-geo`, then `node scripts/check-library.js <PRJ>`. Exit 1 is a hard stop: report the errors and stop. Relay every `Warning:` line verbatim. For each warned run, ask the curator to drop it (leave it out of the annotations) or accept it.
- **Step 2:** write `.curation/tmp/<PRJ>_sample_annotations.json` as `{ samples: [{ runs: [...], factors: {...} }], factors: { key: { displayName, definition?, unit? } } }`. Use one sample per BioSample, and put all of a BioSample's runs in that sample (technical replicates). Factors are isolate characteristics from BioSample attributes: strain, isolate, host, geographic location, collection date. Never `strandedness`, never `organisms`. When several BioSamples share strain, sample name and every factor value, show the curator and ask. They stay separate samples and may share a label; never merge them.
- **Step 3:** contacts, the same as RNA-seq; link to that skill's step-3 resource copied into this skill.
- **Step 4:** first `node scripts/check-released-organism.js <PRJ> --organism <abbrev> --project <P> --rebuild-branch rebuild<RR>`.
  - Exit 2 prints candidates. Show them to the curator and ask which is the organism, or whether it isn't released yet. A pick re-runs with `--released-organism <source_id>`. "Not released" means stop: gene CNV needs orthomcl paralogs, so the organism must be released first. Never pick for the curator.
  - Exit 1 (query failed) is a hard stop: report it.
  - Then run:

    ```bash
    node scripts/write-proposal.js --accession <PRJ> --external-id bioproject=<PRJ> --type dnaseq --project <P> --organism <abbrev> --rebuild-branch rebuild<RR> --primary-contact <ID> [--contact <ID> ...] --skill propose-dnaseq --input .curation/tmp/<PRJ>_sra_metadata.json --input .curation/tmp/<PRJ>_released_organism.json --curated .curation/tmp/<PRJ>_sample_annotations.json --overrides .curation/tmp/overrides.json
    ```

    The overrides must give `name`, `version` (YYYY-MM-DD) and `presenter.shortDisplayName`/`shortAttribution`. `hasCNVData` is derived from the released chromosome count; tell the curator its value and that they or reviewers can change it under `presenter.injectorProps`. `ploidy` is never set here: load sets it.
  - Keep the keep/replace-edits paragraph verbatim from RNA-seq, and the render-proposal preview commands.
- **Step 5:** `render-proposal.js --artifacts .curation/delivery Proposals/<PRJ>`. The delivery is `<Project>/<abbrev>/SNP/<name>/<version>/final/`.
- **Step 6:** publish, the same as RNA-seq.
- **Merging the proposal PR:** the same paragraph as RNA-seq.

Each step resource file holds the detailed version of its step above. For steps 3 and 6, copy the RNA-seq resource and remove the RNA-specific lines.

- [ ] **Step 2: load-proposals SKILL.md**

Add a section "DNA-seq: the organism's ploidy". When `load-proposal.js` stops with `<abbrev> has no ploidy constant`:
- Claude proposes a value with a one-line biological rationale (for example, *Candida albicans* SC5314: 2, an obligate diploid; most filamentous fungi and apicomplexan blood stages: 1, haploid).
- The data loader confirms or corrects it.
- Claude re-runs with `--ploidy <abbrev>=<N>`.

Claude never passes `--ploidy` without the loader's confirmation. A differing value in an organism file that already has ploidy is a hard stop: report it, and don't edit the file.

- [ ] **Step 3: Repository docs**

`CLAUDE.md` structure block: add `propose-dnaseq/   # Phase 1: DNA-seq (isolate WGS) proposals` under `skills/`. In `docs/development.md`, add the new lib modules to its module table if it has one.

- [ ] **Step 4: Sync, test, commit**

```bash
yarn sync-shared && yarn test 2>&1 | tail -4
git add -A skills CLAUDE.md docs package.json
git commit -m "propose-dnaseq skill docs; load-proposals ploidy step

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 17: Version, end-to-end check, PR 3

- [ ] **Step 1: Bump the version to 2.3.0**

```bash
sed -i 's/"version": "2.2.1"/"version": "2.3.0"/' package.json .claude-plugin/plugin.json
```

If `.claude-plugin/plugin.json` or a marketplace file lists skills explicitly, add `propose-dnaseq` there. Check with `grep -rn propose-bulk-rnaseq .claude-plugin`.

- [ ] **Step 2: End-to-end check through Step 5 in the demo checkout (no publish)**

In `~/dataset-curation-demo/VEuPathDatasets` (clean, on master), using the scripts in `../dataset-curator-dnaseq/skills/propose-dnaseq/scripts/`:
1. `git ls-remote --heads origin 'rebuild*'`. If exactly one rebuild branch exists, use it; if there are several, stop and report them for John to choose.
2. `check-workspace.js`, then `start-proposal.js PRJNA1086165 --external-id bioproject=PRJNA1086165`.
3. `fetch-sra-metadata.js PRJNA1086165 --no-geo`, then `check-library.js PRJNA1086165`. Expect exit 0 and these warnings: WXS on SRR28314583, PolyA on all four runs, implausible read length on all four, low depth on all four BioSamples.
4. `check-released-organism.js PRJNA1086165 --organism bcinB05-10 --project FungiDB --rebuild-branch <RR>`. Expect a taxon match on NCBITAXON_332648 with chromosomeCount 18.
5. Annotations: four samples, one per BioSample. Overrides: `name` `Test_dnaseq_2024`, `version` `2024-03-14`, `presenter.shortDisplayName` `Bcin WGS test`, `presenter.shortAttribution` `Test 2024`. Primary contact: any id from `allContacts.xml`.
6. `write-proposal.js ... --type dnaseq ...`, then `render-proposal.js Proposals/PRJNA1086165`, `render-proposal.js --dataset Proposals/PRJNA1086165` and `render-proposal.js --artifacts .curation/delivery Proposals/PRJNA1086165`.
7. Verify that `hasCNVData` is `true`, the dataset has `$$ploidy$$`, the delivery path ends in `FungiDB/bcinB05-10/SNP/Test_dnaseq_2024/2024-03-14/final`, and the samplesheet ids equal the `entity-sample.tsv` ids.
8. Clean up: `git switch master && git branch -D proposal/PRJNA1086165 && rm -rf Proposals/PRJNA1086165 .curation/delivery`. Nothing is pushed.

Record the commands and the key output lines for the PR description.

- [ ] **Step 3: Full test run, then push and open PR 3**

```bash
cd /home/jbrestel/workspaces/misc/dataset-curator-dnaseq
yarn sync-shared && yarn test 2>&1 | tail -8
git add -A && git commit -m "2.3.0: propose-dnaseq

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
unset GITHUB_TOKEN
git push -u origin propose-dnaseq
gh pr create --base sra-samples-module --title "propose-dnaseq skill and dnaseq dataset type (2.3.0)" --body "<summary, the end-to-end transcript highlights, and: stacked on #<PR1>; retarget to main after it merges>

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

---

## Self-review notes

- Spec coverage: library checks → T9; released site and curator pick → T10, T16; pending genome refusal → T11; presenter body like RNA-seq plus IsolatesHTS → T12, T13; `$$ploidy$$` → T13; load ploidy with the loader confirming → T15, T16; id check at write, publish and load → T3, T13 (`assertCuratedAgree` is called by write, publish and `renderArtifacts` at load); 3-column samplesheet and migration including PRJDB6658 → T2, T4, T6, T7; skill docs → T16; version → T5, T17.
- One deviation from the spec, made on purpose: the curator's `--released-organism` pick is recorded in `inputs/<ACC>_released_organism.json` (`matchedBy: "curator"`) rather than in the manifest. It is still inside the proposal and reviewable, and it keeps network data out of the manifest schema. The spec was updated to match when this plan was written.
- Ticket label `snp` for dnaseq is a choice John hasn't confirmed: the label already exists on VEuPathDatasets, and the delivery directory is `SNP/`.
