# Shared Verify Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the verify flow ready for a second `verify-*` skill: types declare their validation workspace, the procedure is a shared resource, and `prepare-delivery` can deliver large files by path from a per-proposal preprocessing work area.

**Architecture:** Additive changes to `shared/scripts/lib/delivery.js`, `delivery-ops.js`, `verification-ops.js` and `dataset-types/validators.js`, plus two new small modules (`lib/file-hash.js`, `lib/preprocessed.js`). Text artifacts keep their current path; a new optional type hook `preprocessedFiles` adds file sources that are copied (reflink where possible) and hashed by streaming.

**Tech Stack:** Node 18 ES modules, `node:test`, no new dependencies.

Spec: `docs/superpowers/specs/2026-11-05-verify-core-design.md`.

## Conventions for every task

- Work only in `/home/jbrestel/workspaces/src/dataset-curator-verify-core` (branch `feature/verify-core`). Use `git -C <worktree>` and `yarn --cwd <worktree>`; never `cd` elsewhere.
- Run only the task's test file plus the import-graph test:
  `node --test --test-reporter=dot --test-global-setup=tests/globalSetup.js tests/<file>.test.js tests/import-graph.test.js` (from the worktree root). The full suite runs only in Task 9.
- No command substitution, no `;` chains. Stage files with `git add <paths>`, then commit in a separate call. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- The pre-commit hook runs `yarn sync-shared`, copying `shared/` into `skills/`; stage the `skills/` copies it changes.
- No large fixture files; build test inputs in temp dirs.
- Comments only where code is not self-explanatory, 2–3 lines max.

## File structure

| File | Responsibility |
|---|---|
| `shared/scripts/lib/file-hash.js` (new) | `sha256File(path)`: streamed, synchronous sha256 |
| `shared/scripts/lib/preprocessed.js` (new) | `collectPreprocessed(...)`: call a type's `preprocessedFiles` per location and check the results |
| `shared/scripts/lib/delivery.js` | `writeDeliveryTree` gains `sources`; `deliveryProblems` gains `sources`; record hashes streamed |
| `shared/scripts/lib/delivery-ops.js` | `prepareDelivery` wires the work area, sources and provenance; staging hash streamed |
| `shared/scripts/lib/validation-workspace.js` | `workAreaOf(typeDir, proposalId)` |
| `shared/scripts/lib/verification-ops.js` | `markReady` validates entries against the delivery's `against` ref |
| `shared/scripts/dataset-types/validators.js` | registry reads `validationWorkspace` from type modules |
| `shared/scripts/dataset-types/bulk-rnaseq/validators/index.js` (new) | bulk-rnaseq's validator list |
| `shared/scripts/dataset-types/{bulk-rnaseq,dnaseq,chipseq,genome-assembly}.js` | export `validationWorkspace` |
| `bin/sync-shared.js` | exported `syncShared`, `--check` |
| `shared/resources/verify-procedure.md` (new) | shared verification procedure |
| `skills/verify-bulk-rnaseq/SKILL.md` | rnaseq-only parts, links to the procedure |
| `docs/development.md` | hook table rows |

---

### Task 1: Streamed sha256

**Files:**
- Create: `shared/scripts/lib/file-hash.js`
- Modify: `shared/scripts/lib/delivery.js` (record hashes, line ~102), `shared/scripts/lib/delivery-ops.js` (`pullStaging`, line ~50)
- Test: `tests/file-hash.test.js`

- [ ] **Step 1: Write the failing test** — `tests/file-hash.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { sha256File } from '../shared/scripts/lib/file-hash.js';

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

test('sha256File equals an in-memory hash for empty, small and multi-chunk files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'file-hash-'));
  const big = Buffer.alloc((1 << 20) * 2 + 17);
  for (let i = 0; i < big.length; i++) big[i] = i % 251;
  for (const [name, content] of [['empty', Buffer.alloc(0)], ['small', Buffer.from('>c1\nACGT\n')], ['big', big]]) {
    writeFileSync(join(dir, name), content);
    assert.equal(sha256File(join(dir, name)), sha(content), name);
  }
});

test('sha256File throws for a missing file', () => {
  assert.throws(() => sha256File(join(tmpdir(), 'no-such-file-for-file-hash')), /ENOENT/);
});
```

- [ ] **Step 2: Run it; expect FAIL** (module not found).

- [ ] **Step 3: Implement** — `shared/scripts/lib/file-hash.js`:

```js
import { openSync, readSync, closeSync } from 'node:fs';
import { createHash } from 'node:crypto';

const CHUNK = 1 << 20;

/** sha256 hex of a file, read in 1 MB chunks so large files never sit in memory. */
export function sha256File(path) {
  const hash = createHash('sha256');
  const buf = Buffer.allocUnsafe(CHUNK);
  const fd = openSync(path, 'r');
  try {
    let n;
    while ((n = readSync(fd, buf, 0, CHUNK, null)) > 0) hash.update(buf.subarray(0, n));
  } finally {
    closeSync(fd);
  }
  return hash.digest('hex');
}
```

- [ ] **Step 4: Use it.** In `delivery.js`, replace
  `createHash('sha256').update(readFileSync(join(next, path))).digest('hex')` with `sha256File(join(next, path))`, import `sha256File` from `./file-hash.js`, and drop the now-unused `createHash` and `readFileSync` imports if nothing else uses them.
  In `delivery-ops.js` `pullStaging`, replace `createHash('sha256').update(readFileSync(local)).digest('hex')` with `sha256File(local)`; drop unused imports likewise.

- [ ] **Step 5: Run** `tests/file-hash.test.js tests/delivery.test.js tests/delivery-ops.test.js tests/import-graph.test.js`; expect PASS.

- [ ] **Step 6: Commit** — `Stream sha256 for delivery records and staging checks`.

---

### Task 2: Types declare their validation workspace

**Files:**
- Create: `shared/scripts/dataset-types/bulk-rnaseq/validators/index.js`
- Modify: `shared/scripts/dataset-types/validators.js`, `bulk-rnaseq.js`, `dnaseq.js`, `chipseq.js`, `genome-assembly.js` (all under `shared/scripts/dataset-types/`)
- Test: `tests/validation-workspace.test.js`

The type module cannot import its validators: `consistency.js` and `perl-parse.js` import `bulk-rnaseq.js`, and `tests/import-graph.test.js` forbids cycles.

- [ ] **Step 1: Write the failing test** — append to `tests/validation-workspace.test.js` (keep the existing assertions; they must still pass):

```js
import { DATASET_TYPES } from '../shared/scripts/dataset-types/index.js';

test('every dataset type declares its validation workspace', () => {
  for (const [name, type] of Object.entries(DATASET_TYPES)) {
    assert.equal(typeof type.validationWorkspace, 'string', name);
    assert.equal(validationWorkspaceFor(name), type.validationWorkspace);
  }
  assert.equal(validationWorkspaceFor('toString'), null);
});
```

(Put the import with the file's other imports.)

- [ ] **Step 2: Run** `tests/validation-workspace.test.js`; expect FAIL (`validationWorkspace` undefined; `toString` may also misbehave).

- [ ] **Step 3: Implement.**

Each type module gets one export next to `datasetClasses`:

```js
export const validationWorkspace = 'rnaseq-validation';          // bulk-rnaseq.js
export const validationWorkspace = 'dnaseq-validation';          // dnaseq.js
export const validationWorkspace = 'chipseq-validation';         // chipseq.js
export const validationWorkspace = 'annotated-genome-validation'; // genome-assembly.js
```

`shared/scripts/dataset-types/bulk-rnaseq/validators/index.js`:

```js
import { libraryType } from './library-type.js';
import { consistency } from './consistency.js';
import { perlParse } from './perl-parse.js';
import { stf } from './stf.js';

/** Run order matters: the report lists findings in this order. */
export const validators = [libraryType, consistency, perlParse, stf];
```

`shared/scripts/dataset-types/validators.js` becomes:

```js
import { DATASET_TYPES } from './index.js';
import { validators as bulkRnaseq } from './bulk-rnaseq/validators/index.js';

// A type with validators must have a current, non-failing report before mark-ready.
const VALIDATORS = { 'bulk-rnaseq': bulkRnaseq };

export const validatorsFor = (datasetType) => (Object.hasOwn(VALIDATORS, datasetType) ? VALIDATORS[datasetType] : []);
export const validationWorkspaceFor = (datasetType) => (Object.hasOwn(DATASET_TYPES, datasetType) ? DATASET_TYPES[datasetType].validationWorkspace : null);
export const validationWorkspaceNames = () => [...new Set(Object.values(DATASET_TYPES).map((t) => t.validationWorkspace))];
```

- [ ] **Step 4: Run** `tests/validation-workspace.test.js tests/validators-bulk-rnaseq.test.js tests/dataset-types-chipseq.test.js tests/import-graph.test.js`; expect PASS. If import-graph reports a cycle, do not work around it with dynamic imports: report it (status BLOCKED) with the cycle path.

- [ ] **Step 5: Commit** — `Dataset types declare their validation workspace; bulk-rnaseq validators get an index`.

---

### Task 3: Delivery tree takes source files

**Files:**
- Modify: `shared/scripts/lib/delivery.js` (`writeDeliveryTree`, `deliveryProblems`)
- Test: `tests/delivery.test.js`

- [ ] **Step 1: Write failing tests** — append to `tests/delivery.test.js` (add `createHash` from `node:crypto` and `statSync`/`rmSync` from `node:fs` to the imports as needed; `inputs()`, `F1`, `F2` already exist):

```js
test('writeDeliveryTree copies source files beside text files and hashes them in the record', () => {
  const i = inputs();
  const src = mkdtempSync(join(tmpdir(), 'sources-'));
  writeFileSync(join(src, 'genome.fasta'), '>c1\nACGT\n');
  writeFileSync(join(src, 'genome.gff3'), '##gff-version 3\n');
  const sources = { [`${F1}/genome.fasta`]: join(src, 'genome.fasta'), [`${F1}/sub/genome.gff3`]: join(src, 'genome.gff3') };
  const record = writeDeliveryTree({ ...i, sources, record: { schemaVersion: 1 } });
  assert.equal(readFileSync(join(i.dir, F1, 'genome.fasta'), 'utf-8'), '>c1\nACGT\n');
  assert.equal(readFileSync(join(i.dir, F1, 'sub/genome.gff3'), 'utf-8'), '##gff-version 3\n');
  assert.equal(readFileSync(join(i.dir, F1, 'samplesheet.csv'), 'utf-8'), 's1');
  const listed = Object.fromEntries(record.files.map((f) => [f.path, f.sha256]));
  assert.equal(listed[`${F1}/genome.fasta`], createHash('sha256').update('>c1\nACGT\n').digest('hex'));
  writeFileSync(join(src, 'genome.fasta'), 'edited later');
  assert.equal(readFileSync(join(i.dir, F1, 'genome.fasta'), 'utf-8'), '>c1\nACGT\n');
});

test('a source that cannot be copied leaves no .next and the existing tree untouched', () => {
  const i = inputs();
  writeDeliveryTree({ ...i, record: { schemaVersion: 1 } });
  assert.throws(() => writeDeliveryTree({ ...i, sources: { [`${F1}/gone.fasta`]: join(tmpdir(), 'no-such-source-file') }, record: { schemaVersion: 1 } }), /ENOENT/);
  assert.equal(existsSync(`${i.dir}.next`), false);
  assert.equal(readFileSync(join(i.dir, F1, 'samplesheet.csv'), 'utf-8'), 's1');
});

test('a path given both as text and as a source is refused before anything is written', () => {
  const i = inputs();
  const src = mkdtempSync(join(tmpdir(), 'sources-'));
  writeFileSync(join(src, 'x'), 'x');
  assert.throws(() => writeDeliveryTree({ ...i, sources: { [`${F1}/samplesheet.csv`]: join(src, 'x') }, record: { schemaVersion: 1 } }),
    /given both as text and as a source file: FungiDB\/a1\/rnaSeq\/N\/v\/final\/samplesheet\.csv/);
  assert.equal(existsSync(i.dir), false);
  assert.equal(existsSync(`${i.dir}.next`), false);
});

test('deliveryProblems counts a non-empty source file as present', () => {
  const src = mkdtempSync(join(tmpdir(), 'sources-'));
  writeFileSync(join(src, 'full'), 'g1\tkinase\n');
  writeFileSync(join(src, 'empty'), '');
  const dirEntry = { label: 'fasta_primary_genome_sequence GenBank (chromosome)', relative: 'P/o/genome/c/v/final', file: null };
  const fileEntry = { label: 'productNames GenBank', relative: 'P/o/function/p/v/final', file: 'products.txt' };
  assert.deepEqual(deliveryProblems([dirEntry, fileEntry], {}, {
    'P/o/genome/c/v/final/genome.fasta': join(src, 'full'),
    'P/o/function/p/v/final/products.txt': join(src, 'full')
  }), []);
  assert.deepEqual(deliveryProblems([fileEntry], {}, { 'P/o/function/p/v/final/products.txt': join(src, 'empty') }),
    ['productNames GenBank: P/o/function/p/v/final/products.txt is missing or empty']);
});
```

- [ ] **Step 2: Run** `tests/delivery.test.js`; expect the four new tests to FAIL.

- [ ] **Step 3: Implement** in `delivery.js`:

Imports: add `copyFileSync`, `constants`, `statSync` from `node:fs`.

`writeDeliveryTree({ dir, finals, files, sources = {}, proposalDir, proposalId, stagingDir, record })`. Update its doc comment: "sources maps delivery paths to absolute files, copied (reflinked where the filesystem allows)". At the top, before `assertDeliverable`:

```js
  const both = Object.keys(sources).filter((p) => Object.hasOwn(files, p));
  if (both.length) throw new Error(`Delivery paths given both as text and as a source file: ${both.join(', ')}`);
```

Inside the `try`, right after the loop writing `files`:

```js
    for (const [path, from] of Object.entries(sources)) {
      mkdirSync(dirname(join(next, path)), { recursive: true });
      copyFileSync(from, join(next, path), constants.COPYFILE_FICLONE);
    }
```

`deliveryProblems(locations, files, sources = {})`:

```js
export function deliveryProblems(locations, files, sources = {}) {
  const paths = [...Object.keys(files), ...Object.keys(sources)];
  const present = (p) => Boolean(files[p]) || (Object.hasOwn(sources, p) && existsSync(sources[p]) && statSync(sources[p]).size > 0);
  return locations.flatMap(({ label, relative: dir, file }) => {
    if (file) return present(join(dir, file)) ? [] : [`${label}: ${join(dir, file)} is missing or empty`];
    return paths.some((p) => p.startsWith(`${dir}/`)) ? [] : [`${label}: ${dir}/ is missing`];
  });
}
```

Update its doc comment to mention `sources` (delivery path to absolute file).

- [ ] **Step 4: Run** `tests/delivery.test.js tests/delivery-roundtrip.test.js tests/import-graph.test.js`; expect PASS.

- [ ] **Step 5: Commit** — `Delivery tree copies source files by path`.

---

### Task 4: Collect and check preprocessed files

**Files:**
- Create: `shared/scripts/lib/preprocessed.js`
- Modify: `shared/scripts/lib/validation-workspace.js` (add `workAreaOf`)
- Test: `tests/preprocessed.test.js`

- [ ] **Step 1: Write the failing test** — `tests/preprocessed.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectPreprocessed } from '../shared/scripts/lib/preprocessed.js';
import { workAreaOf } from '../shared/scripts/lib/validation-workspace.js';

const LOC = { label: 'productNames GenBank', organism: 'o1', relative: 'P/o1/function/p/v/final', file: 'products.txt', datasetName: 'o1_p_RSRC' };

function area() {
  const workArea = mkdtempSync(join(tmpdir(), 'preprocess-'));
  mkdirSync(join(workArea, 'final'));
  writeFileSync(join(workArea, 'final/products.txt'), 'g1\tkinase\n');
  return workArea;
}
const typeReturning = (result) => ({ preprocessedFiles: (proposalDir, location, { workArea }) => result(workArea, location) });
const collect = (workArea, result, extra = {}) =>
  collectPreprocessed({ datasetType: typeReturning(result), proposalDir: '/p', proposalId: 'GCA_1', locations: [LOC], workArea, ...extra });

test('workAreaOf is proposals/<id>/preprocess under the type directory', () => {
  assert.equal(workAreaOf('/root/annotated-genome-validation', 'GCA_1'), '/root/annotated-genome-validation/proposals/GCA_1/preprocess');
});

test('collectPreprocessed maps each file to its delivery path and keeps provenance by delivery directory', () => {
  const workArea = area();
  const { sources, provenance } = collect(workArea, (w) => ({ files: [{ path: 'products.txt', from: join(w, 'final/products.txt') }], problems: [], provenance: { build: 'abc' } }));
  assert.deepEqual(sources, { 'P/o1/function/p/v/final/products.txt': realpathSync(join(workArea, 'final/products.txt')) });
  assert.deepEqual(provenance, { 'P/o1/function/p/v/final': { build: 'abc' } });
});

test('a missing work area is refused, naming it', () => {
  assert.throws(() => collect(join(tmpdir(), 'no-such-work-area'), () => ({ files: [] })),
    /No preprocessing work area for GCA_1 at .*no-such-work-area; run preprocessing there first/);
});

test('the type\'s problems are refused under the entry label', () => {
  const workArea = area();
  assert.throws(() => collect(workArea, () => ({ files: [], problems: ['genome-build.json is stale; run genome-pipeline.js build'] })),
    /GCA_1: the preprocessing work area cannot be delivered:\n  - productNames GenBank: genome-build\.json is stale/);
});

test('bad paths and sources are each refused', () => {
  const workArea = area();
  const outside = mkdtempSync(join(tmpdir(), 'outside-'));
  writeFileSync(join(outside, 'x.txt'), 'x');
  symlinkSync(join(outside, 'x.txt'), join(workArea, 'final/link.txt'));
  const cases = [
    [{ path: '../escape.txt', from: join(workArea, 'final/products.txt') }, /\.\.\/escape\.txt is not a relative path inside the delivery directory/],
    [{ path: '/abs.txt', from: join(workArea, 'final/products.txt') }, /\/abs\.txt is not a relative path inside the delivery directory/],
    [{ path: 'x.txt', from: join(outside, 'x.txt') }, /is outside the work area/],
    [{ path: 'link.txt', from: join(workArea, 'final/link.txt') }, /is outside the work area/],
    [{ path: 'dir', from: join(workArea, 'final') }, /is not a regular file/],
    [{ path: 'none.txt', from: join(workArea, 'final/none.txt') }, /does not exist/]
  ];
  for (const [file, message] of cases) {
    assert.throws(() => collect(workArea, () => ({ files: [file] })), message, file.path);
  }
});

test('a delivery path given twice, or also rendered as text, is refused', () => {
  const workArea = area();
  const from = join(workArea, 'final/products.txt');
  assert.throws(() => collect(workArea, () => ({ files: [{ path: 'products.txt', from }, { path: 'products.txt', from }] })), /products\.txt is delivered twice/);
  assert.throws(() => collect(workArea, () => ({ files: [{ path: 'products.txt', from }] }), { rendered: { 'P/o1/function/p/v/final/products.txt': 'text' } }),
    /products\.txt is delivered twice/);
});
```

- [ ] **Step 2: Run** `tests/preprocessed.test.js`; expect FAIL (module not found).

- [ ] **Step 3: Implement.**

In `validation-workspace.js`, beside `openDeliveryDir`:

```js
/** Where preprocessing writes for a proposal; prepare-delivery copies a type's preprocessedFiles from here. */
export const workAreaOf = (typeDir, proposalId) => join(typeDir, 'proposals', proposalId, 'preprocess');
```

`shared/scripts/lib/preprocessed.js`:

```js
import { existsSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, normalize, sep } from 'node:path';

const isInside = (path, root) => path === root || path.startsWith(root + sep);

/**
 * Asks the type for each location's files from the work area and checks them: paths relative
 * to the delivery directory without '..', sources that are regular files inside the work area
 * once symlinks resolve, and no delivery path given twice or also rendered as text.
 * Returns { sources: { deliveryPath: realSource }, provenance: { deliveryDir: object } }.
 */
export function collectPreprocessed({ datasetType, proposalDir, proposalId, locations, workArea, rendered = {} }) {
  if (!existsSync(workArea)) throw new Error(`No preprocessing work area for ${proposalId} at ${workArea}; run preprocessing there first`);
  const root = realpathSync(workArea);
  const sources = {};
  const provenance = {};
  const problems = [];
  for (const location of locations) {
    const { files = [], problems: own = [], provenance: summary = null } = datasetType.preprocessedFiles(proposalDir, location, { workArea });
    problems.push(...own.map((p) => `${location.label}: ${p}`));
    if (summary !== null) provenance[location.relative] = summary;
    for (const { path, from } of files) {
      const where = `${location.label}: ${path}`;
      if (typeof path !== 'string' || !path || isAbsolute(path) || normalize(path).split(sep).includes('..')) {
        problems.push(`${where} is not a relative path inside the delivery directory`);
        continue;
      }
      let real;
      try { real = realpathSync(from); } catch { problems.push(`${where}: ${from} does not exist`); continue; }
      if (!isInside(real, root)) { problems.push(`${where}: ${from} is outside the work area ${workArea}`); continue; }
      if (!statSync(real).isFile()) { problems.push(`${where}: ${from} is not a regular file`); continue; }
      const at = join(location.relative, path);
      if (Object.hasOwn(sources, at) || Object.hasOwn(rendered, at)) { problems.push(`${where}: ${at} is delivered twice`); continue; }
      sources[at] = real;
    }
  }
  if (problems.length) throw new Error(`${proposalId}: the preprocessing work area cannot be delivered:\n  - ${problems.join('\n  - ')}`);
  return { sources, provenance };
}
```

- [ ] **Step 4: Run** `tests/preprocessed.test.js tests/validation-workspace.test.js tests/import-graph.test.js`; expect PASS.

- [ ] **Step 5: Commit** — `Collect and check a type's preprocessed files from the work area`.

---

### Task 5: prepare-delivery delivers from the work area

**Files:**
- Modify: `shared/scripts/lib/delivery-ops.js` (`prepareDelivery`)
- Test: `tests/delivery-ops.test.js`

- [ ] **Step 1: Write failing tests** — append to `tests/delivery-ops.test.js`. `setup`, `prepare`, `FINAL` exist; add `import * as bulkRnaseq from '../shared/scripts/dataset-types/bulk-rnaseq.js';`.

```js
/** bulk-rnaseq plus a preprocessedFiles hook; calls records each location it was asked about. */
function withHook(result) {
  const calls = [];
  const type = { ...bulkRnaseq, preprocessedFiles: (proposalDir, location, ctx) => { calls.push({ location, ctx }); return result(ctx.workArea, location); } };
  return { calls, loadType: async () => type };
}
const workArea = (s) => join(s.typeDir, 'proposals', s.proposalId, 'preprocess');

test('prepareDelivery refuses a type with preprocessedFiles when its work area is missing, writing nothing', async () => {
  const s = setup();
  const { loadType } = withHook(() => ({ files: [] }));
  await assert.rejects(prepare(s, { loadType }), /No preprocessing work area for PRJNA000002 at .*proposals\/PRJNA000002\/preprocess; run preprocessing there first/);
  assert.equal(existsSync(join(s.typeDir, 'delivery/PRJNA000002')), false);
});

test('prepareDelivery refuses the type\'s problems under the entry label', async () => {
  const s = setup();
  mkdirSync(workArea(s), { recursive: true });
  const { loadType } = withHook(() => ({ files: [], problems: ['build is stale'] }));
  await assert.rejects(prepare(s, { loadType }), /PRJNA000002: the preprocessing work area cannot be delivered:\n  - rnaSeqExperiment .*: build is stale/);
  assert.equal(existsSync(join(s.typeDir, 'delivery/PRJNA000002')), false);
});

test('prepareDelivery copies the work area files into final/ and records provenance by delivery directory', async () => {
  const s = setup();
  mkdirSync(workArea(s), { recursive: true });
  writeFileSync(join(workArea(s), 'reads.bam'), 'bam');
  const { loadType, calls } = withHook((w) => ({ files: [{ path: 'reads.bam', from: join(w, 'reads.bam') }], problems: [], provenance: { build: 'abc' } }));
  const { dir, record } = await prepare(s, { loadType });
  assert.equal(calls[0].ctx.workArea, workArea(s));
  assert.equal(calls[0].location.relative, FINAL);
  assert.equal(readFileSync(join(dir, FINAL, 'reads.bam'), 'utf-8'), 'bam');
  assert.ok(existsSync(join(dir, FINAL, 'samplesheet.csv')));
  assert.deepEqual(record.provenance, { [FINAL]: { build: 'abc' } });
  const listed = Object.fromEntries(record.files.map((f) => [f.path, f.sha256]));
  assert.equal(listed[join(FINAL, 'reads.bam')], createHash('sha256').update('bam').digest('hex'));
});

test('a type without preprocessedFiles writes no provenance key', async () => {
  const s = setup();
  const { record } = await prepare(s);
  assert.equal(Object.hasOwn(record, 'provenance'), false);
  assert.equal(JSON.parse(readFileSync(join(s.typeDir, 'delivery/PRJNA000002/delivery.json'), 'utf-8')).provenance, undefined);
});
```

The entry label of the PRJNA000002 fixture is `rnaSeqExperiment <name>`; if the regex `rnaSeqExperiment .*:` does not match the fixture's label, read the label from the error and tighten the regex to it.

- [ ] **Step 2: Run** `tests/delivery-ops.test.js`; expect the first three to FAIL (`loadType` ignored). The fourth may already pass.

- [ ] **Step 3: Implement** in `delivery-ops.js`:

- Import `collectPreprocessed` from `./preprocessed.js` and `workAreaOf` from `./validation-workspace.js` (extend the existing `openDeliveryDir` import).
- Signature: add `loadType = loadDatasetType` to the destructured options; replace `await loadDatasetType(manifest.datasetType)` with `await loadType(manifest.datasetType)`. Update the doc comment: "loadType is for tests; a type with preprocessedFiles also delivers files from <type>-validation/proposals/<id>/preprocess/, recording their provenance".
- Take `typeDir` from `openDeliveryDir`: `const { dir, typeDir, staging, manualDelivery } = openDeliveryDir(...)`.
- Inside `withSettledProposal`, after the loop that fills `files` from `corpusFiles` and before `deliveryProblems`:

```js
      const pre = datasetType.preprocessedFiles
        ? collectPreprocessed({ datasetType, proposalDir: d, proposalId, locations, workArea: workAreaOf(typeDir, proposalId), rendered: files })
        : null;
      const sources = pre?.sources ?? {};
      const missing = deliveryProblems(locations, files, sources);
```

  (replacing the existing `const missing = deliveryProblems(locations, files);`).
- In `record`, after `handoff`: `...(pre ? { provenance: pre.provenance } : {})`.
- Pass `sources` to `writeDeliveryTree({ dir, finals, files, sources, ... })`.

- [ ] **Step 4: Run** `tests/delivery-ops.test.js tests/delivery-roundtrip.test.js tests/delivery.test.js tests/import-graph.test.js`; expect PASS. The roundtrip tests prove rnaseq deliveries are unchanged.

- [ ] **Step 5: Commit** — `prepare-delivery delivers a type's preprocessed files from its work area`.

---

### Task 6: mark-ready validates entries against the delivery's ref

**Files:**
- Modify: `shared/scripts/lib/verification-ops.js` (`markReady`)
- Test: `tests/validation-ops.test.js`

- [ ] **Step 1: Change the stub and write failing tests.** `deliveryStub` (around line 157) hard-codes `against: 'origin/rebuild02'`, a ref `setupMerged` never creates. Give it an option, default `'origin/master'`:

```js
const deliveryStub = (git, { tree, none = false, against = 'origin/master' } = {}) => ({
  read: () => none ? null : { record: { proposalTree: tree ?? git.objectId('origin/master', 'Proposals/PRJNA000002'), against, settlement: [{ proposed: 'tfakST1', abbrev: 'tfakST1' }], build: '02', release: '2026-10', corpusStep: 'ssh yew x', handoff: 'Copy\n  rsync -a' }, sha: 'e'.repeat(64), dir: '/ws/delivery/PRJNA000002' }
});
```

Append (add `import { CLASSES_RELATIVE_PATH } from '../shared/scripts/lib/dataset-classes.js';`):

```js
test('markReady checks entries against the classes of the ref the delivery was prepared against', async () => {
  const { repo, git } = setupMerged();
  execFileSync('git', ['-C', repo, 'push', '-q', 'origin', 'HEAD:rebuild02']);
  execFileSync('git', ['-C', repo, 'rm', '-q', CLASSES_RELATIVE_PATH]);
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'classes gone from master']);
  execFileSync('git', ['-C', repo, 'push', '-q']);
  const ticket = stubTicket({ status: 'verifying', existingComments: [formatReportComment(reportFor(git, 'pass'))] });
  git.fetch();
  const result = await markReady({ git, ticket, proposalId: 'PRJNA000002', workspace: disposalStub(), delivery: deliveryStub(git, { against: 'origin/rebuild02' }) });
  assert.equal(result.status, 'ready');
});

test('markReady refuses a delivery prepared against a ref that no longer exists, before posting anything', async () => {
  const { git } = setupMerged();
  const ticket = stubTicket({ status: 'verifying', existingComments: [formatReportComment(reportFor(git, 'pass'))] });
  await assert.rejects(markReady({ git, ticket, proposalId: 'PRJNA000002', workspace: disposalStub(), delivery: deliveryStub(git, { against: 'origin/rebuild99' }) }),
    /The delivery of PRJNA000002 was prepared against origin\/rebuild99, which does not exist here; fetch it, or run prepare-delivery\.js again/);
  assert.equal(setsStatus(ticket), false);
  assert.equal(ticket.comments(), 0);
});
```

If `reportFor`'s `proposalTree` must match after the classes commit, it does: the commit leaves `Proposals/PRJNA000002` unchanged.

- [ ] **Step 2: Run** `tests/validation-ops.test.js`; expect the two new tests to FAIL (the first with a classes.xml read error on master, the second with a different message).

- [ ] **Step 3: Implement** in `markReady`, replacing the `const entries = assertValidEntries(...)` and `const prepared = ...` lines:

```js
  const relDir = proposalRelativePath(proposalId);
  const read = readerOnRef(git, 'origin/master');
  const hasEntries = datasetsOf(relDir, manifest, { read }).length > 0;
  const prepared = hasEntries ? await currentDelivery(git, ticket, ref, delivery, manifest.datasetType, proposalId) : null;
  // Classes come from the ref prepare-delivery checked them against, so the two can't disagree.
  const classRef = prepared?.record.against ?? 'origin/master';
  if (!git.refExists(classRef)) {
    throw new Error(`The delivery of ${proposalId} was prepared against ${classRef}, which does not exist here; fetch it, or run prepare-delivery.js again`);
  }
  assertValidEntries(relDir, manifest, await loadDatasetType(manifest.datasetType), {
    read, classOf: memoClassOf(null, (_, className) => readDatasetClassOnRef(git, classRef, className))
  });
```

Import `datasetsOf` from `../dataset-types/_common.js` (beside `assertValidEntries`, `readerOnRef`). Update `markReady`'s doc comment: "entries are checked against classes.xml on the delivery's against ref (origin/master when there is no delivery)".

Order change: the delivery is now checked before entry props. If an existing test (for example "markReady reads a datasets.json proposal: refuses a stray prop…" or "markReady refuses invalid dataset entries before posting anything") now fails because a stale or missing delivery is reported first, give that test a current `deliveryStub(git)` so it still reaches the entry check; do not weaken its assertion on the entry error.

- [ ] **Step 4: Run** `tests/validation-ops.test.js tests/import-graph.test.js`; expect PASS.

- [ ] **Step 5: Commit** — `mark-ready checks entries against the delivery's rebuild branch`.

---

### Task 7: sync-shared --check

**Files:**
- Modify: `bin/sync-shared.js`
- Test: `tests/sync-shared.test.js`

- [ ] **Step 1: Write the failing test** — `tests/sync-shared.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncShared } from '../bin/sync-shared.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const quiet = { log: () => {}, error: () => {} };

function tree() {
  const root = mkdtempSync(join(tmpdir(), 'sync-shared-'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ sharedFiles: { 'resources/a.md': ['s1', 's2'] } }));
  mkdirSync(join(root, 'shared/resources'), { recursive: true });
  writeFileSync(join(root, 'shared/resources/a.md'), 'A\n');
  return root;
}

test('sync then check finds nothing to report', () => {
  const root = tree();
  assert.equal(syncShared({ rootDir: root, ...quiet }).errors, 0);
  assert.deepEqual(syncShared({ rootDir: root, check: true, ...quiet }).problems, []);
});

test('check names a differing and a missing copy and writes nothing', () => {
  const root = tree();
  syncShared({ rootDir: root, ...quiet });
  writeFileSync(join(root, 'skills/s1/resources/a.md'), 'edited\n');
  rmSync(join(root, 'skills/s2/resources/a.md'));
  const { problems } = syncShared({ rootDir: root, check: true, ...quiet });
  assert.deepEqual(problems, ['skills/s1/resources/a.md differs from shared/resources/a.md', 'skills/s2/resources/a.md is missing']);
  assert.equal(readFileSync(join(root, 'skills/s1/resources/a.md'), 'utf-8'), 'edited\n');
});

test('every skills/ copy in this repository matches shared/', () => {
  assert.deepEqual(syncShared({ rootDir: repoRoot, check: true, ...quiet }).problems, []);
});
```

- [ ] **Step 2: Run** `tests/sync-shared.test.js`; expect FAIL (`syncShared` not exported).

- [ ] **Step 3: Implement** — rewrite `bin/sync-shared.js`:

```js
#!/usr/bin/env node
/**
 * sync-shared.js - Syncs shared files into skills, or with --check reports copies that differ.
 *
 * Usage: node bin/sync-shared.js [--check]
 *        yarn sync-shared
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Copies each package.json sharedFiles source into its skills, or with check compares them
 * byte for byte and writes nothing. Returns { synced, errors, problems }.
 */
export function syncShared({ rootDir, check = false, log = console.log, error = console.error }) {
  const sharedFiles = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf-8')).sharedFiles || {};
  let synced = 0;
  let errors = 0;
  const problems = [];
  for (const [sharedPath, targetSkills] of Object.entries(sharedFiles)) {
    const sourcePath = join(rootDir, 'shared', sharedPath);
    if (!existsSync(sourcePath)) {
      error(`✗ Source file not found: shared/${sharedPath}`);
      errors++;
      continue;
    }
    const content = readFileSync(sourcePath);
    for (const skill of targetSkills) {
      const rel = `skills/${skill}/${sharedPath}`;
      const targetPath = join(rootDir, rel);
      if (check) {
        if (!existsSync(targetPath)) problems.push(`${rel} is missing`);
        else if (!readFileSync(targetPath).equals(content)) problems.push(`${rel} differs from shared/${sharedPath}`);
        continue;
      }
      try {
        mkdirSync(dirname(targetPath), { recursive: true });
        writeFileSync(targetPath, content);
        log(`✓ Synced shared/${sharedPath} → ${rel}`);
        synced++;
      } catch (e) {
        error(`✗ Failed to sync to ${rel}: ${e.message}`);
        errors++;
      }
    }
  }
  return { synced, errors, problems };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
  if (!check) console.log('Syncing shared files into skills...\n');
  const { synced, errors, problems } = syncShared({ rootDir, check });
  for (const p of problems) console.error(`✗ ${p}`);
  if (check) console.log(problems.length || errors ? `\n${problems.length} out of sync, ${errors} errors` : 'All shared copies match.');
  else console.log(`\nSync complete: ${synced} files synced, ${errors} errors`);
  if (errors || problems.length) process.exit(1);
}
```

- [ ] **Step 4: Run** `tests/sync-shared.test.js`, then `node bin/sync-shared.js --check` (expect `All shared copies match.`, exit 0), then `node bin/sync-shared.js` (expect `Sync complete: … 0 errors`) and `git -C <worktree> status --short` (expect no changes under `skills/`).

- [ ] **Step 5: Commit** — `sync-shared --check reports skills/ copies that differ from shared/`.

---

### Task 8: Shared verify procedure

**Files:**
- Create: `shared/resources/verify-procedure.md`
- Modify: `skills/verify-bulk-rnaseq/SKILL.md`, `package.json` (`sharedFiles`), `docs/development.md` (type hook table near line 217)
- Test: `tests/sync-shared.test.js` (the repository drift test)

- [ ] **Step 1: Write `shared/resources/verify-procedure.md`:**

````markdown
# Verifying a proposal

The steps every `verify-*` skill shares, between merge (`Proposed`) and load
(`Ready to load`). The skill for the dataset type says what its validators
check, what its delivery holds and what to review with the user. See
[proposal workflow](proposal-workflow.md) for the statuses.

## Before you start

```bash
node scripts/check-workspace.js
git fetch
```

Run from the top of a VEuPathDatasets checkout. Validation reads the proposal
from `origin/master`, so the checked-out branch does not matter.

**Ask the data loader for the validation workspace root.** It holds one
directory per dataset type (`<type>-validation/`; the skill names it), each
with an `env.json` (repos with url and ref, executables, build commands), base
clones in `repos/`, and `proposals/<PROPOSAL>/`: a git worktree per repo on
branch `verify/<PROPOSAL>`, that proposal's `build/`, and, for types that
preprocess, its work area `preprocess/`. The scripts create and reuse these.
**Never guess the root, search for it, or reuse one from an earlier
conversation: ask the data loader.**

Run one validation at a time per dataset type: the base clones in `repos/` are
shared, so parallel runs collide.

## Pick and claim

```bash
node scripts/list-proposals.js --status proposed
node scripts/start-verification.js <PROPOSAL>
```

The first column of list-proposals.js is the proposal id (`<PROPOSAL>`); it is
the accession unless the study has proposals of several dataset types.

Claiming is optional; it assigns the issue to the user and sets
`Preprocessing`.

## Validate

```bash
node scripts/validate-proposal.js --workspace <root> <PROPOSAL>
```

The first run for a proposal fetches each repo and builds; later runs reuse
that code as is, so a fix made in a worktree survives. After editing code in
`proposals/<PROPOSAL>/<repo>/`, add `--rebuild`. To move to the latest code
on each repo's ref, add `--refresh` (refused while a worktree holds
uncommitted or unpushed work). The `Repos:` line and the posted report record
each repo's ref and commit.

Add `--against origin/rebuild<RR>` when the user names a rebuild branch, to
also run the load checks (organisms settle, names free, organism dataset
files present) without checking anything out. Organism stops come out as
warnings: a person settles them when preparing the delivery with `--settle`.
Use `--no-post` only for a trial run; mark-ready reads the posted report.

Verdicts: `pass`; `needs-review` (warnings: each needs the user's explicit
acceptance); `fail` (errors). Show the user every finding.

- `could not verify: ...` is a workspace problem, not a proposal problem:
  tell the data loader what is missing and re-run. Never mark ready around it.

## Prepare the delivery

```bash
node scripts/prepare-delivery.js --workspace <root> --against origin/rebuild<RR> <PROPOSAL>
```

Ask the data loader for the rebuild branch. This settles the organisms (a stop
is resolved here with `--settle <proposed>=<abbrev>`, never at load) and writes
the whole manual delivery to `<type>-validation/delivery/<PROPOSAL>/`:
`final/` per dataset entry, `fromProvider/` (the proposal from master plus the
files its manifest's `staging` lists from `dataStaging/<PROPOSAL>/`; nothing
else in the drop is pulled), an empty `workspace/` per organism, and whatever
else the type adds (the skill says what). It needs `staging` and
`manualDelivery` in the type's `env.json`.

For a type that preprocesses, `final/` also takes files from the work area
`proposals/<PROPOSAL>/preprocess/`. prepare-delivery refuses when the work area
is missing or the type finds it stale, and copies the files, so later edits in
the work area do not change a prepared delivery. `delivery.json` records each
file's sha256 and what produced it.

Re-running replaces everything except `workspace/`. If the proposal must
change (dataset class, props, version), update it through a proposal PR; once
merged, validate and prepare again.

## Decide

```bash
node scripts/mark-ready.js --workspace <root> <PROPOSAL> "<what was checked>"
node scripts/request-revision.js <PROPOSAL> "<what the curator must fix>"
```

mark-ready refuses without a report for the current version of the proposal,
or when the latest report failed. Its comment records the verdict, tool
versions and the warnings the user accepted. mark-ready also needs the
current delivery, checks the dataset entries against the rebuild branch the
delivery was prepared against, and posts the delivery record and the rsync on
the ticket; it never removes `delivery/`. A republished proposal returns to
`Proposed` (it stays at `Preprocessing` if published there) and needs
validating again.

`--workspace <root>` is required for a type with validators. mark-ready then
removes `proposals/<PROPOSAL>/`, including any `preprocess/` work area: keep
it until mark-ready, and preprocess again if a revision follows. It refuses
first, before touching the ticket, while a worktree has uncommitted changes or
commits on no remote branch, or while `verify/<PROPOSAL>` holds commits on no
remote: push them (`verify/<PROPOSAL>`) and open a PR on that repo, or, only
when the user says the changes are disposable, add `--discard-changes` (it
needs `--workspace`). If removal fails after the ticket is Ready, mark-ready
prints a `Warning:` and exits 0; the ticket is fine, so remove
`proposals/<PROPOSAL>/` and its `verify/<PROPOSAL>` branches by hand.
request-revision keeps the workspace for the next round.

If a pushed fix branch was squash-merged and deleted upstream, its commits
count as unpushed after a fetch: confirm the fix is merged, then use
`--discard-changes`.

Builds run with `GUS_HOME` pointed at the proposal's `build/`, never the
caller's.

## Rules

- Never pass a workspace the data loader did not name.
- Never run two validations of one dataset type at once.
- Never mark ready on a `fail` verdict, and never accept a warning on the
  user's behalf.
- Never copy to the server yourself; print the rsync for the data loader.
- Never push; these scripts change only the ticket and the validation workspace.
- Never push to tool repos on the user's behalf; tell them what is unpushed.
````

- [ ] **Step 2: Rewrite `skills/verify-bulk-rnaseq/SKILL.md`** (keep the frontmatter exactly as it is):

````markdown
# Verify a Bulk RNA-seq Proposal

Follow [the verification procedure](resources/verify-procedure.md) step by
step. This page adds what is specific to bulk RNA-seq. The automated parts are
`validate-proposal.js` and `prepare-delivery.js`; the judgment part is yours
and the user's.

## Workspace

This type's directory under the validation root is `rnaseq-validation/`.

## Validate

The validators check library type and depth, sample labels and runs across
the samplesheet, `analysisConfig` and STF, ApiCommonData's `analysisConfig`
parser, and study-wrangler STF validation.

Depth, library type and consistency errors go back to the curator.

## Prepare the delivery

Besides `final/`, `fromProvider/` and `workspace/`, the delivery holds the
STF corpus files. prepare-delivery needs a due date on the ticket's `Build NN`
milestone: it picks the STF release month. Preprocess in `workspace/`.

## Review with the user

- Every warning in the report (the text says what can go wrong).
- SRA runs still resolve and any server paths exist (the validators read a
  proposal-time snapshot).
- Sample annotations read sensibly.
- The curator's notes on the ticket.
- Presenter text: `Proposals/<PROPOSAL>/curated/presenter.json` on
  `origin/master` (display name, summary, description, contacts).

Then decide, as the procedure says.
````

- [ ] **Step 3: Register the resource.** In `package.json` `sharedFiles`, add `"resources/verify-procedure.md": ["verify-bulk-rnaseq"]`, after the existing `resources/proposal-workflow.md` entry. Run `node bin/sync-shared.js`; confirm `skills/verify-bulk-rnaseq/resources/verify-procedure.md` now exists.

- [ ] **Step 4: Document the hooks** — in `docs/development.md`'s type hook table (after the `renderArtifacts` row), add:

```markdown
| `validationWorkspace` | 2 | the type's directory under the validation root, such as `rnaseq-validation`. Validators are not exported here (a validator importing the type module would be a cycle): a type with validators lists them in `dataset-types/<type>/validators/index.js`, registered in `validators.js` |
| `preprocessedFiles(dir, location, { workArea })` | 2 | optional; `{ files: [{ path, from }], problems, provenance }` for one entry location: files under `<type>-validation/proposals/<id>/preprocess/` that `prepare-delivery.js` copies into the location's `final/` (`path` relative to it). `problems` refuse the delivery; `provenance` is recorded in `delivery.json` by delivery directory |
```

- [ ] **Step 5: Run** `tests/sync-shared.test.js tests/import-graph.test.js` and `node bin/sync-shared.js --check`; expect PASS and `All shared copies match.`

- [ ] **Step 6: Commit** — `Shared verify procedure; verify-bulk-rnaseq keeps only its own steps`. Stage `shared/resources/verify-procedure.md`, `skills/verify-bulk-rnaseq/resources/verify-procedure.md`, `skills/verify-bulk-rnaseq/SKILL.md`, `package.json`, `docs/development.md`.

---

### Task 9: Version and checkpoint

**Files:**
- Modify: `package.json` (`version`), `.claude-plugin/plugin.json` (`version`)

- [ ] **Step 1:** Set both versions to `3.4.0`.
- [ ] **Step 2: Full suite:** `yarn --cwd /home/jbrestel/workspaces/src/dataset-curator-verify-core test`. Expect 0 failures (skips from `VALIDATION_ROOT` are fine). Fix any failure in the task that caused it before continuing.
- [ ] **Step 3:** `node bin/sync-shared.js --check` → `All shared copies match.`
- [ ] **Step 4: Commit** — `Shared verify core (3.4.0)`.
