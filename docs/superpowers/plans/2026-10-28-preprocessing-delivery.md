# Preprocessing Owns Manual Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move manual delivery (final/, fromProvider/, workspace/, STF corpus files) from load into a new preprocessing step, `prepare-delivery.js`, that settles organisms once; load renders XML only and enforces the recorded settlement.

**Architecture:** Small single-purpose modules: `remote.js` (read-only ssh/rsync), `corpus.js` (STF corpus paths, clash checks, corpus step), `delivery.js` (the local tree and its record), `delivery-ops.js` (prepare-delivery orchestration). The record travels from `delivery.json` to a marked ticket comment written by mark-ready, which load parses as it parses verification reports.

**Tech Stack:** Node 18 ESM, `node:test`, git, gh, ssh, rsync. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-28-preprocessing-delivery-design.md`

**Out of this plan:** `assemble-stf-corpus` (the dnaseq merge needs study-wrangler harmonization; separate spec). Load prints a by-hand step for dnaseq instead.

**Conventions:** Run all tests with `yarn test` (it is `node --test tests/*.test.js`). A single file: `node --test tests/<file>.test.js`. Edit only `shared/`; the pre-commit hook runs `yarn sync-shared` and copies into `skills/`. Comments: only where code is not self-explanatory, 1-3 lines, matching surrounding JSDoc style.

---

## File map

| File | Change |
|---|---|
| `shared/scripts/lib/load-ops.js` | `settlementOn(ref)`; load enforces delivery record; delivery code removed |
| `shared/scripts/lib/build-fitness.js` | uses `settlementOn` |
| `shared/scripts/lib/dataset-classes.js` | `parseDatasetClass`, `readDatasetClassOnRef` |
| `shared/scripts/lib/ticket/github.js`, `ticket/index.js` | `getRelease(ref)` from milestone due date |
| `shared/scripts/lib/validation-env.js` | optional `staging`, `manualDelivery` keys |
| `shared/scripts/lib/validation-workspace.js` | `openDeliveryDir`, `deliveryReader`, `removeDeliveries` |
| `shared/scripts/dataset-types/validators.js` | `dnaseq` workspace |
| `shared/scripts/lib/manifest.js` | `staging` field |
| `shared/scripts/dataset-types/bulk-rnaseq.js`, `dnaseq.js` | `renderArtifacts` without STF; `corpus`, `corpusFiles`, `stagingProblems` |
| `shared/scripts/lib/remote.js` | new: read-only ssh/rsync |
| `shared/scripts/lib/corpus.js` | new: corpus paths, clashes, step |
| `shared/scripts/lib/delivery.js` | new: tree writer, record, handoff |
| `shared/scripts/lib/artifacts.js` | `archiveProposal` removed; `handoffNote` loses `archive` |
| `shared/scripts/lib/delivery-ops.js` | new: `prepareDelivery` |
| `shared/scripts/prepare-delivery.js` | new CLI |
| `shared/scripts/lib/validation.js` | delivery comment format/parse |
| `shared/scripts/lib/verification-ops.js` | `currentReport` exported; markReady requires delivery |
| `shared/scripts/mark-ready.js`, `load-proposal.js`, `start-build.js` | CLI changes |
| `shared/scripts/lib/proposal-ops.js` | update at Preprocessing stays there |
| `shared/scripts/lib/build-start-ops.js` | clean-proposals removes deliveries |
| `package.json`, skills docs, `proposal-workflow.md`, plugin version | sharing, docs, 2.4.0 |

---

### Task 1: Settlement on any ref

**Files:**
- Modify: `shared/scripts/lib/load-ops.js` (`settlementFor`, ~line 165)
- Modify: `shared/scripts/lib/build-fitness.js:15-25`
- Test: `tests/load-ops.test.js`

- [ ] **Step 1: Write the failing test** (append to `tests/load-ops.test.js`; add `settlementOn` to the load-ops import and `readOnRef` from `../shared/scripts/lib/manifest.js`)

```js
test('settlementOn settles against a named ref without checking it out', () => {
  const { repo } = setupRepo();
  execFileSync('git', ['-C', repo, 'checkout', '-q', 'master']);
  const git = createGit(repo);
  const manifest = readOnRef(git, 'origin/master', 'PRJNA000002');
  const { organisms, stops } = settlementOn(git, manifest, 'origin/rebuild02');
  assert.deepEqual(stops, []);
  assert.deepEqual(organisms.map((o) => [o.proposed, o.abbrev]), [['tfakST1', 'tfakST1']]);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/load-ops.test.js`
Expected: FAIL, `settlementOn` is not exported.

- [ ] **Step 3: Implement**

In `load-ops.js` replace `settlementFor` with:

```js
/** Settlement of the manifest's organisms against ref's organism files and every pending genome proposal; never throws on a stop. */
export function settlementOn(git, manifest, ref, settle = {}) {
  return settleOrganisms(manifest, {
    index: readOrganismIndex(git, ref),
    claims: pendingGenomeProposals(git, ['origin/master']),
    // A rebuild branch holds the Proposals/ it was cut with, so master's copy comes first.
    genomeOf: (accession) => genomeOrganismOf(git, 'origin/master', accession) ?? genomeOrganismOf(git, ref, accession),
    settle
  });
}

export const settlementFor = (git, manifest, settle = {}) => settlementOn(git, manifest, 'HEAD', settle);
```

In `build-fitness.js` replace the `settleOrganisms(...)` call with `settlementOn(git, manifest, against)`, import `settlementOn` from `./load-ops.js` beside `withSettledProposal`, and drop the now-unused `organisms.js` imports.

- [ ] **Step 4: Run tests**

Run: `node --test tests/load-ops.test.js tests/build-fitness.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/scripts/lib/load-ops.js shared/scripts/lib/build-fitness.js tests/load-ops.test.js
git commit -m "Settle organisms against any ref"
```

---

### Task 2: Dataset class from a ref

**Files:**
- Modify: `shared/scripts/lib/dataset-classes.js`
- Test: `tests/dataset-classes.test.js`

- [ ] **Step 1: Failing test** (append; import `readDatasetClassOnRef`, `createGit` from `../shared/scripts/lib/git-ops.js`, `initRepo` from `./helpers.js`)

```js
test('readDatasetClassOnRef reads classes.xml from a ref, not the working tree', () => {
  const { repo } = initRepo('classes-on-ref-');
  rmSync(join(repo, CLASSES_RELATIVE_PATH));
  const c = readDatasetClassOnRef(createGit(repo), 'origin/master', 'rnaSeqExperiment');
  assert.equal(c.deliveryPath, '@@manualDeliveryDir@@/${projectName}/${organismAbbrev}/rnaSeq/${name}/${version}/final/');
  assert.throws(() => readDatasetClassOnRef(createGit(repo), 'origin/master', 'noSuchClass'), /Dataset class "noSuchClass" not found/);
});
```

- [ ] **Step 2: Run, expect FAIL** — `node --test tests/dataset-classes.test.js`

- [ ] **Step 3: Implement** — split `readDatasetClass`:

```js
export function readDatasetClass(repoPath, className) {
  const path = join(repoPath, CLASSES_RELATIVE_PATH);
  if (!existsSync(path)) throw new Error(`${CLASSES_RELATIVE_PATH} not found in ${repoPath}`);
  return parseDatasetClass(readFileSync(path, 'utf-8'), className);
}

export function readDatasetClassOnRef(git, ref, className) {
  if (!git.fileExistsOnRef(ref, CLASSES_RELATIVE_PATH)) throw new Error(`${CLASSES_RELATIVE_PATH} not found on ${ref}`);
  return parseDatasetClass(git.showFile(ref, CLASSES_RELATIVE_PATH), className);
}
```

Move the existing body after the `readFileSync` into `export function parseDatasetClass(xml, className)`, keeping its JSDoc there.

- [ ] **Step 4: Run, expect PASS** — `node --test tests/dataset-classes.test.js`

- [ ] **Step 5: Commit** — `git commit -am "Read a dataset class from a ref"`

---

### Task 3: Release month from the milestone due date

**Files:**
- Modify: `shared/scripts/lib/ticket/github.js` (beside `getBuild`), `shared/scripts/lib/ticket/index.js`, `tests/helpers.js` (`stubTicket`)
- Test: `tests/ticket.test.js`

- [ ] **Step 1: Confirm gh's field name** — run `unset GITHUB_TOKEN; gh issue view <any issue with a milestone> -R VEuPathDB/VEuPathDatasets --json milestone`. Expected: the milestone object carries `dueOn` (ISO timestamp or null). If the key differs, use that key below.

- [ ] **Step 2: Failing tests** (append after the getBuild tests)

```js
test('github getRelease is the YYYY-MM of the build milestone due date', async () => {
  const exec = () => JSON.stringify({ milestone: { title: 'Build 74', dueOn: '2026-10-31T00:00:00Z' } });
  assert.equal(await createTicketClient(githubCfg, { exec }).getRelease({ system: 'github', id: '76' }), '2026-10');
});

test('github getRelease refuses a milestone without a due date, and an issue without a build milestone', async () => {
  const undated = createTicketClient(githubCfg, { exec: () => JSON.stringify({ milestone: { title: 'Build 74', dueOn: null } }) });
  await assert.rejects(undated.getRelease({ system: 'github', id: '76' }), /Milestone "Build 74" has no due date; set one: it picks the STF release month/);
  const none = createTicketClient(githubCfg, { exec: () => JSON.stringify({ milestone: null }) });
  await assert.rejects(none.getRelease({ system: 'github', id: '76' }), /Issue #76 has no "Build \{build\}" milestone/);
});
```

- [ ] **Step 3: Run, expect FAIL** — `node --test tests/ticket.test.js`

- [ ] **Step 4: Implement** — in `github.js` returned object, after `getBuild`:

```js
    async getRelease(ref) {
      const { milestone } = JSON.parse(gh('issue', 'view', ref.id, '--json', 'milestone'));
      if (!milestone?.title?.match(buildPattern)) throw new Error(`Issue #${ref.id} has no "${cfg.milestone}" milestone; set one to choose the build`);
      if (!milestone.dueOn) throw new Error(`Milestone "${milestone.title}" has no due date; set one: it picks the STF release month`);
      return milestone.dueOn.slice(0, 7);
    },
```

In `index.js` add `getRelease` to the JSDoc list and `getRelease: async (ref) => { check(ref); return client.getRelease(ref); },` to `guarded`. In `stubTicket` add options `release = '2026-10', releases = {}` and:

```js
    async getRelease(ref) {
      calls.push(['getRelease', ref.id]);
      const r = ref.id in releases ? releases[ref.id] : release;
      if (r === null) throw new Error('Milestone "Build 02" has no due date; set one: it picks the STF release month');
      return r;
    },
```

- [ ] **Step 5: Run, expect PASS** — `yarn test`

- [ ] **Step 6: Commit** — `git commit -am "Read the STF release month from the build milestone due date"`

---

### Task 4: Delivery hosts in env.json and the delivery directory

**Files:**
- Modify: `shared/scripts/lib/validation-env.js` (`envProblem`)
- Modify: `shared/scripts/lib/validation-workspace.js`
- Modify: `shared/scripts/dataset-types/validators.js`
- Test: `tests/validation-env.test.js`, `tests/validation-workspace.test.js`

- [ ] **Step 1: Failing tests**

In `tests/validation-env.test.js` (follow the file's existing pattern of writing an env.json into a temp dir and calling `readEnvJson`):

```js
test('env.json staging and manualDelivery are optional, and must name a host and an absolute root', () => {
  const base = { schemaVersion: 2, repos: {}, executables: {} };
  const ok = { ...base, staging: { host: 'yew', root: '/veupath/dataStaging' }, manualDelivery: { host: 'yew', root: '/eupath/data/EuPathDB/manualDelivery' } };
  assert.ok(readEnvJson(typeDirWith(ok)).values);
  assert.ok(readEnvJson(typeDirWith(base)).values);
  assert.match(readEnvJson(typeDirWith({ ...base, staging: { host: 'yew', root: 'relative' } })).error, /"staging" must be \{ "host": "<ssh host>", "root": "<absolute path>" \}/);
  assert.match(readEnvJson(typeDirWith({ ...base, manualDelivery: { root: '/x' } })).error, /"manualDelivery" must be/);
});
```

If the file has no `typeDirWith` helper, add one: `const typeDirWith = (env) => { const d = mkdtempSync(join(tmpdir(), 'env-')); writeFileSync(join(d, 'env.json'), JSON.stringify(env)); return d; };`

In `tests/validation-workspace.test.js`:

```js
test('openDeliveryDir names delivery/<accession> and the hosts, refusing an env.json without them', () => {
  const { root, typeDir } = validationRoot({});
  assert.throws(() => openDeliveryDir({ root, datasetType: 'bulk-rnaseq', accession: 'PRJNA1' }), /env\.json has no "staging"; ask the data loader/);
  const env = JSON.parse(readFileSync(join(typeDir, 'env.json'), 'utf-8'));
  writeFileSync(join(typeDir, 'env.json'), JSON.stringify({ ...env, staging: { host: 'yew', root: '/s' }, manualDelivery: { host: 'yew', root: '/m' } }));
  const d = openDeliveryDir({ root, datasetType: 'bulk-rnaseq', accession: 'PRJNA1' });
  assert.equal(d.dir, join(typeDir, 'delivery', 'PRJNA1'));
  assert.deepEqual([d.staging.root, d.manualDelivery.root], ['/s', '/m']);
});

test('deliveryReader reads delivery.json with its sha256, or null; removeDeliveries removes it in every type', () => {
  const { root, typeDir } = validationRoot({});
  const dir = join(typeDir, 'delivery', 'PRJNA1');
  assert.equal(deliveryReader({ root, accession: 'PRJNA1' }).read('bulk-rnaseq'), null);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'delivery.json'), '{"proposalTree":"abc"}\n');
  const found = deliveryReader({ root, accession: 'PRJNA1' }).read('bulk-rnaseq');
  assert.equal(found.record.proposalTree, 'abc');
  assert.match(found.sha, /^[0-9a-f]{64}$/);
  assert.deepEqual(removeDeliveries({ root, accessions: ['PRJNA1', 'PRJNA9'] }), [dir]);
  assert.equal(existsSync(dir), false);
});
```

- [ ] **Step 2: Run, expect FAIL** — `node --test tests/validation-env.test.js tests/validation-workspace.test.js`

- [ ] **Step 3: Implement**

`validation-env.js`, at the end of `envProblem` before `return null`:

```js
  for (const key of ['staging', 'manualDelivery']) {
    const h = v[key];
    if (h !== undefined && !(isObject(h) && typeof h.host === 'string' && h.host && typeof h.root === 'string' && isAbsolute(h.root))) {
      return `"${key}" must be { "host": "<ssh host>", "root": "<absolute path>" }`;
    }
  }
```

`validators.js`: `const WORKSPACES = { 'bulk-rnaseq': 'rnaseq-validation', dnaseq: 'dnaseq-validation', 'genome-assembly': 'annotated-genome-validation' };`

`validation-workspace.js` (add `readFileSync` to the fs import and `import { createHash } from 'node:crypto';`):

```js
export const DELIVERY_RECORD = 'delivery.json';

/** <type dir>/delivery/<accession>/ and the env.json hosts prepare-delivery needs; throws naming what is missing. */
export function openDeliveryDir({ root, datasetType, accession }) {
  if (badAccession(accession)) throw new Error(`accession "${accession}" must be a plain directory name`);
  const t = openTypeDir(root, datasetType);
  if (t.error) throw new Error(t.error);
  for (const key of ['staging', 'manualDelivery']) {
    if (!t.env[key]) throw new Error(`${join(t.typeDir, 'env.json')} has no "${key}"; ${ASK} and what ${key} host and root to use`);
  }
  return { typeDir: t.typeDir, dir: join(t.typeDir, 'delivery', accession), staging: t.env.staging, manualDelivery: t.env.manualDelivery };
}

/** mark-ready's view of a delivery: read(datasetType) gives { record, sha, dir } or null. */
export function deliveryReader({ root, accession }) {
  return {
    read(datasetType) {
      const t = typeDirOf(root, datasetType);
      if (t.error) throw new Error(t.error);
      const dir = join(t.typeDir, 'delivery', accession);
      const path = join(dir, DELIVERY_RECORD);
      if (!existsSync(path)) return null;
      const text = readFileSync(path, 'utf-8');
      return { record: JSON.parse(text), sha: createHash('sha256').update(text).digest('hex'), dir };
    }
  };
}

/** Build start: removes delivery/<accession>/ of each accession in every type under root. Returns the directories removed. */
export function removeDeliveries({ root, accessions }) {
  if (!root) throw new Error(`No validation workspace given; ${ASK} and pass --workspace <root>`);
  const removed = [];
  for (const name of validationWorkspaceNames()) {
    for (const accession of accessions) {
      const dir = join(resolve(root), name, 'delivery', accession);
      if (!existsSync(dir)) continue;
      rmSync(dir, { recursive: true, force: true });
      removed.push(dir);
    }
  }
  return removed;
}
```

- [ ] **Step 4: Run, expect PASS** — `yarn test`

- [ ] **Step 5: Commit** — `git commit -am "Delivery directory and hosts in the validation workspace"`

---

### Task 5: Manifest `staging`

**Files:**
- Modify: `shared/scripts/lib/manifest.js` (`validate`, after the ticket check)
- Test: `tests/manifest.test.js`

- [ ] **Step 1: Failing test** (use the file's existing valid-manifest fixture builder; below it is called `valid()` — rename to match the file)

```js
test('staging lists relative paths with optional sha256', () => {
  assert.deepEqual(validate({ ...valid(), staging: [{ path: 'annotation.gff3' }, { path: 'reads/a.fq.gz', sha256: 'a'.repeat(64) }] }), []);
  const errors = validate({ ...valid(), staging: [{ path: '/abs' }, { path: '../up' }, { path: 'x', sha256: 'XYZ' }, { path: 'x', size: 1 }] });
  assert.deepEqual(errors, [
    'staging[0].path must be a relative path inside dataStaging/<accession>/',
    'staging[1].path must be a relative path inside dataStaging/<accession>/',
    'staging[2].sha256 must be 64 lowercase hex characters',
    'staging[3].size is not a staging field',
    'staging lists x twice'
  ]);
  assert.deepEqual(validate({ ...valid(), staging: {} }), ['staging must be an array of { path, sha256? }']);
});
```

- [ ] **Step 2: Run, expect FAIL** — `node --test tests/manifest.test.js`

- [ ] **Step 3: Implement**

```js
function stagingErrors(staging) {
  if (staging === undefined) return [];
  if (!Array.isArray(staging)) return ['staging must be an array of { path, sha256? }'];
  const errors = [];
  staging.forEach((s, i) => {
    const at = `staging[${i}]`;
    if (typeof s?.path !== 'string' || !s.path || s.path.startsWith('/') || s.path.split('/').includes('..')) {
      errors.push(`${at}.path must be a relative path inside dataStaging/<accession>/`);
    }
    if (s?.sha256 !== undefined && !/^[0-9a-f]{64}$/.test(s.sha256)) errors.push(`${at}.sha256 must be 64 lowercase hex characters`);
    for (const k of Object.keys(s ?? {}).filter((k) => k !== 'path' && k !== 'sha256')) errors.push(`${at}.${k} is not a staging field`);
  });
  const paths = staging.map((s) => s?.path).filter((p) => typeof p === 'string');
  for (const p of new Set(paths.filter((p, i) => paths.indexOf(p) !== i))) errors.push(`staging lists ${p} twice`);
  return errors;
}
```

In `validate`, after `if (m.ticket !== undefined) ...`: `errors.push(...stagingErrors(m.staging));`

- [ ] **Step 4: Run, expect PASS** — `yarn test`

- [ ] **Step 5: Commit** — `git commit -am "Manifest lists dataStaging files"`

---

### Task 6: Dataset types declare corpus and staging; final/ loses STF

**Files:**
- Modify: `shared/scripts/dataset-types/bulk-rnaseq.js` (`renderArtifacts` ~line 512)
- Modify: `shared/scripts/dataset-types/dnaseq.js` (`renderArtifacts` ~line 162)
- Test: `tests/dataset-types.test.js`, `tests/dataset-types-dnaseq.test.js`

- [ ] **Step 1: Update and add tests**

In `tests/dataset-types-dnaseq.test.js:110-115`, the expected `renderArtifacts` file list loses both `sample-annotations-stf/...` entries. Do the same for any bulk-rnaseq `renderArtifacts` expectation in `tests/dataset-types.test.js` (grep `sample-annotations-stf`). Then add, in each file, using the fixture proposal that file already renders:

```js
test('bulk-rnaseq corpus files are the organism STF, per dataset', () => {
  assert.deepEqual(rnaseq.corpus, { root: 'common/rnaSeq/sampleDetailsForEda', layout: 'per-dataset' });
  const files = rnaseq.corpusFiles(dir, 'tfakST1');
  assert.deepEqual(Object.keys(files).sort(), ['entity-sample.tsv', 'entity-sample.yaml']);
  assert.equal(files['entity-sample.tsv'], readFileSync(join(dir, 'curated/tfakST1/entity-sample.tsv'), 'utf-8'));
});

test('bulk-rnaseq needs staging files only for a server source', () => {
  assert.deepEqual(rnaseq.stagingProblems(dir), []);
  setDatasetSource(dir, { type: 'server', paths: ['/data/x'] });
  assert.deepEqual(rnaseq.stagingProblems(dir), ['a server source needs its read files listed in manifest "staging"']);
});
```

```js
test('dnaseq corpus files are the organism STF, per organism', () => {
  assert.deepEqual(dnaseq.corpus, { root: 'common/dnaSeq/sampleDetailsForEda', layout: 'per-organism' });
  assert.deepEqual(Object.keys(dnaseq.corpusFiles(dir, 'tfakST1')).sort(), ['entity-sample.tsv', 'entity-sample.yaml']);
  assert.deepEqual(dnaseq.stagingProblems(dir), []);
});
```

`setDatasetSource(dir, source)`: rewrite `curated/dataset.json` with `source` replaced (add as a local helper if the file has none). `dir` and `rnaseq` are whatever the surrounding tests in the file use for the fixture proposal directory and module import.

- [ ] **Step 2: Run, expect FAIL** — `node --test tests/dataset-types.test.js tests/dataset-types-dnaseq.test.js`

- [ ] **Step 3: Implement**

`bulk-rnaseq.js`: in `renderArtifacts` delete the `stfDir` line and the two STF entries. Add after it:

```js
export const corpus = { root: 'common/rnaSeq/sampleDetailsForEda', layout: 'per-dataset' };

/** The organism's STF for the corpus, under its settled abbreviation. */
export function corpusFiles(proposalDir, organism) {
  const m = loadManifest(proposalDir);
  const p = proposedAbbrevOf(m, organismOf(m, organism));
  const text = (f) => readFileSync(join(proposalDir, 'curated', p, f), 'utf-8');
  return { 'entity-sample.tsv': text('entity-sample.tsv'), 'entity-sample.yaml': text('entity-sample.yaml') };
}

/** Reads not in SRA arrive through dataStaging. */
export function stagingProblems(proposalDir) {
  const { source = DEFAULT_SOURCE } = readDataset(proposalDir);
  const m = loadManifest(proposalDir);
  return source.type === 'server' && !m.staging?.length ? ['a server source needs its read files listed in manifest "staging"'] : [];
}
```

`dnaseq.js`: in `renderArtifacts` delete `stfDir` and the STF entries. Add:

```js
export const corpus = { root: 'common/dnaSeq/sampleDetailsForEda', layout: 'per-organism' };

export function corpusFiles(proposalDir) {
  const m = loadManifest(proposalDir);
  const p = m.organisms[0].proposedOrganismAbbrev;
  const text = (f) => readFileSync(join(proposalDir, 'curated', p, f), 'utf-8');
  return { 'entity-sample.tsv': text('entity-sample.tsv'), 'entity-sample.yaml': text('entity-sample.yaml') };
}

// dnaseq reads from SRA only.
export const stagingProblems = () => [];
```

- [ ] **Step 4: Run, expect PASS** — `yarn test`. `tests/load-ops.test.js` golden artifact checks only compare `analysisConfig.xml` and `samplesheet.csv`, so they still pass; `render-proposal` tests that count files may need the two STF entries dropped from their expectations.

- [ ] **Step 5: Commit** — `git commit -am "STF leaves final/ for the corpus; types declare corpus and staging"`

---

### Task 7: Read-only remote access

**Files:**
- Create: `shared/scripts/lib/remote.js`
- Test: `tests/remote.test.js`

- [ ] **Step 1: Failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRemote } from '../shared/scripts/lib/remote.js';

test('a local remote lists, reads and pulls; missing paths are null', () => {
  const root = mkdtempSync(join(tmpdir(), 'remote-'));
  mkdirSync(join(root, 'd/sub'), { recursive: true });
  writeFileSync(join(root, 'd/b.txt'), 'b');
  writeFileSync(join(root, 'd/sub/a.txt'), 'a');
  const r = createRemote({ host: null });
  assert.deepEqual(r.list(join(root, 'd')), ['b.txt', 'sub']);
  assert.equal(r.list(join(root, 'nope')), null);
  assert.equal(r.readText(join(root, 'd/b.txt')), 'b');
  assert.equal(r.readText(join(root, 'd/none')), null);
  const dest = join(mkdtempSync(join(tmpdir(), 'pull-')), 'x');
  r.pull(join(root, 'd'), dest);
  assert.equal(readFileSync(join(dest, 'sub/a.txt'), 'utf-8'), 'a');
});

test('a host remote runs ssh with batch mode and no forwardings, and rsync over that ssh', () => {
  const calls = [];
  const exec = (cmd, args) => { calls.push([cmd, ...args]); return cmd === 'ssh' && args.at(-1).includes('[ -d') ? '+\nb\na\n' : ''; };
  const r = createRemote({ host: 'yew', exec });
  assert.deepEqual(r.list("/x/it's"), ['a', 'b']);
  assert.deepEqual(calls[0].slice(0, 6), ['ssh', '-o', 'BatchMode=yes', '-o', 'ClearAllForwardings=yes', 'yew']);
  assert.match(calls[0][6], /'\/x\/it'\\''s'/);
  r.pull('/s/PRJ1', '/tmp/dest');
  assert.deepEqual(calls[1], ['rsync', '-a', '-e', 'ssh -o BatchMode=yes -o ClearAllForwardings=yes', 'yew:/s/PRJ1/', '/tmp/dest/']);
});
```

- [ ] **Step 2: Run, expect FAIL** — `node --test tests/remote.test.js`

- [ ] **Step 3: Implement** `shared/scripts/lib/remote.js`:

```js
import { mkdirSync } from 'node:fs';
import { defaultExec } from './tools/exec.js';

const SSH_OPTIONS = ['-o', 'BatchMode=yes', '-o', 'ClearAllForwardings=yes'];
const quote = (s) => `'${s.replace(/'/g, `'\\''`)}'`;

/**
 * Read-only access to paths on host over ssh and rsync; host null reads the
 * local filesystem the same way. Output after a leading "+" line marks a path
 * that exists, so a missing path is null rather than an error.
 */
export function createRemote({ host, exec = defaultExec }) {
  const run = (script) => (host ? exec('ssh', [...SSH_OPTIONS, host, script]) : exec('sh', ['-c', script]));
  const present = (out) => (out.startsWith('+\n') ? out.slice(2) : null);
  const where = (path) => (host ? `${host}:${path}` : path);
  return {
    where,
    list(path) {
      const out = present(run(`[ -d ${quote(path)} ] || exit 0; echo +; ls -1A ${quote(path)}`));
      return out === null ? null : out.split('\n').filter(Boolean).sort();
    },
    readText(path) {
      return present(run(`[ -f ${quote(path)} ] || exit 0; echo +; cat ${quote(path)}`));
    },
    pull(path, localDir) {
      mkdirSync(localDir, { recursive: true });
      exec('rsync', ['-a', '-e', `ssh ${SSH_OPTIONS.join(' ')}`, `${where(path)}/`, `${localDir}/`]);
    }
  };
}
```

Note the test's fake exec returns `'+\nb\na\n'` for the list script; `list` sorts.

- [ ] **Step 4: Run, expect PASS** — `node --test tests/remote.test.js`

- [ ] **Step 5: Commit** — `git add shared/scripts/lib/remote.js tests/remote.test.js && git commit -m "Read-only remote access over ssh and rsync"`

---

### Task 8: STF corpus paths, clashes and the corpus step

**Files:**
- Create: `shared/scripts/lib/corpus.js`
- Test: `tests/corpus.test.js`

- [ ] **Step 1: Failing tests**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRemote } from '../shared/scripts/lib/remote.js';
import { corpusDir, corpusClashes, corpusStep, datasetIdOf } from '../shared/scripts/lib/corpus.js';

const RNA = { root: 'common/rnaSeq/sampleDetailsForEda', layout: 'per-dataset' };
const DNA = { root: 'common/dnaSeq/sampleDetailsForEda', layout: 'per-organism' };
const remote = createRemote({ host: null });

test('datasetIdOf is DS_ and the first 10 hex of sha1', () => {
  assert.match(datasetIdOf('tgonME49_x_dnaseqExperiment_RSRC'), /^DS_[0-9a-f]{10}$/);
});

test('corpusDir puts per-dataset under final/ and per-organism fragments under incoming/', () => {
  assert.equal(corpusDir(RNA, '2026-10', { datasetName: 'a_n_rnaSeq_RSRC', abbrev: 'a' }), 'common/rnaSeq/sampleDetailsForEda/2026-10/final/a_n_rnaSeq_RSRC');
  assert.equal(corpusDir(DNA, '2026-10', { datasetName: 'a_n_dnaseqExperiment_RSRC', abbrev: 'a' }), 'common/dnaSeq/sampleDetailsForEda/2026-10/incoming/a_n_dnaseqExperiment_RSRC/a');
});

test('per-dataset clashes: a name in an earlier release or retired; the target release and suffixed releases are ignored', () => {
  const m = mkdtempSync(join(tmpdir(), 'corpus-'));
  const c = join(m, RNA.root);
  for (const d of ['2026-07/final/old_rnaSeq_RSRC', '2026-08_v2/final/odd_rnaSeq_RSRC', '2026-10/final/mine_rnaSeq_RSRC']) mkdirSync(join(c, d), { recursive: true });
  writeFileSync(join(c, 'retired-datasets.tsv'), '# header\ngone_rnaSeq_RSRC\tnew_rnaSeq_RSRC\t2026-07-25\n');
  const clashes = corpusClashes({ remote, manualRoot: m, corpus: RNA, release: '2026-10', datasets: ['old', 'odd', 'mine', 'gone'].map((n) => ({ datasetName: `${n}_rnaSeq_RSRC` })) });
  assert.deepEqual(clashes, ['old_rnaSeq_RSRC is already in 2026-07/final', 'gone_rnaSeq_RSRC is retired (retired-datasets.tsv)']);
});

test('per-organism clashes: the dataset_id is a row of the organism in an earlier release', () => {
  const m = mkdtempSync(join(tmpdir(), 'corpus-'));
  const dir = join(m, DNA.root, '2026-08/final/ToxoDB/tgonME49');
  mkdirSync(dir, { recursive: true });
  const name = 'tgonME49_x_dnaseqExperiment_RSRC';
  writeFileSync(join(dir, 'entity-sample.tsv'), `sample_id \\\\ Descriptors\tdataset_id\nRH\t${datasetIdOf(name)}\n`);
  const datasets = [{ datasetName: name, abbrev: 'tgonME49', project: 'ToxoDB' }, { datasetName: 'tgonME49_y_dnaseqExperiment_RSRC', abbrev: 'tgonME49', project: 'ToxoDB' }];
  assert.deepEqual(corpusClashes({ remote, manualRoot: m, corpus: DNA, release: '2026-10', datasets }), [`${name} (${datasetIdOf(name)}) is already in 2026-08/final/ToxoDB/tgonME49`]);
});

test('corpusStep: make-cumulative-links for per-dataset, a by-hand note for per-organism', () => {
  const md = { host: 'yew', root: '/eupath/data/EuPathDB/manualDelivery' };
  assert.equal(corpusStep(RNA, '2026-10', md), "ssh yew '/eupath/data/EuPathDB/manualDelivery/common/rnaSeq/sampleDetailsForEda/make-cumulative-links.sh 2026-10'");
  assert.equal(corpusStep(DNA, '2026-10', md), 'Merge yew:/eupath/data/EuPathDB/manualDelivery/common/dnaSeq/sampleDetailsForEda/2026-10/incoming/ into its 2026-10/final/ by hand (study-wrangler harmonization; not automated yet)');
});
```

- [ ] **Step 2: Run, expect FAIL** — `node --test tests/corpus.test.js`

- [ ] **Step 3: Implement** `shared/scripts/lib/corpus.js`:

```js
import { createHash } from 'node:crypto';
import { join } from 'node:path';

// Releases are YYYY-MM; anything else in the corpus root (latest, _v2 copies, scripts) is not one.
const RELEASE = /^\d{4}-\d{2}$/;

export const datasetIdOf = (datasetName) => `DS_${createHash('sha1').update(datasetName).digest('hex').slice(0, 10)}`;

/** Where one organism's STF goes, relative to @@manualDeliveryDir@@. */
export function corpusDir(corpus, release, { datasetName, abbrev }) {
  return corpus.layout === 'per-dataset'
    ? join(corpus.root, release, 'final', datasetName)
    : join(corpus.root, release, 'incoming', datasetName, abbrev);
}

const earlierReleases = (remote, root, release) => (remote.list(root) ?? []).filter((r) => RELEASE.test(r) && r < release);

/**
 * Dataset names already published in a release before release (or retired),
 * read through remote under manualRoot. The target release is this build's,
 * so a re-delivery of the same dataset passes.
 */
export function corpusClashes({ remote, manualRoot, corpus, release, datasets }) {
  const root = join(manualRoot, corpus.root);
  const earlier = earlierReleases(remote, root, release);
  if (corpus.layout === 'per-dataset') {
    const published = earlier.map((r) => [r, new Set(remote.list(join(root, r, 'final')) ?? [])]);
    const retired = new Set((remote.readText(join(root, 'retired-datasets.tsv')) ?? '').split('\n')
      .filter((l) => l && !l.startsWith('#')).map((l) => l.split('\t')[0]));
    return datasets.flatMap(({ datasetName }) => [
      ...published.filter(([, names]) => names.has(datasetName)).map(([r]) => `${datasetName} is already in ${r}/final`),
      ...(retired.has(datasetName) ? [`${datasetName} is retired (retired-datasets.tsv)`] : [])
    ]);
  }
  return datasets.flatMap(({ datasetName, abbrev, project }) => {
    const id = datasetIdOf(datasetName);
    return earlier.flatMap((r) => {
      const where = `${r}/final/${project}/${abbrev}`;
      const tsv = remote.readText(join(root, where, 'entity-sample.tsv'));
      if (!tsv) return [];
      const [header, ...rows] = tsv.split('\n');
      const col = header.split('\t').indexOf('dataset_id');
      return col >= 0 && rows.some((row) => row.split('\t')[col] === id) ? [`${datasetName} (${id}) is already in ${where}`] : [];
    });
  });
}

/** What a person runs once the dataset's STF is on the server; re-runnable. */
export function corpusStep(corpus, release, manualDelivery) {
  const root = join(manualDelivery.root, corpus.root);
  return corpus.layout === 'per-dataset'
    ? `ssh ${manualDelivery.host} '${join(root, 'make-cumulative-links.sh')} ${release}'`
    : `Merge ${manualDelivery.host}:${root}/${release}/incoming/ into its ${release}/final/ by hand (study-wrangler harmonization; not automated yet)`;
}
```

- [ ] **Step 4: Run, expect PASS** — `node --test tests/corpus.test.js`

- [ ] **Step 5: Commit** — `git add shared/scripts/lib/corpus.js tests/corpus.test.js && git commit -m "STF corpus paths, clash checks and corpus step"`

---

### Task 9: The delivery tree

**Files:**
- Create: `shared/scripts/lib/delivery.js`
- Modify: `shared/scripts/lib/artifacts.js` (remove `archiveProposal`; `handoffNote` drops `archive`)
- Test: `tests/delivery.test.js`; `tests/artifacts.test.js` (delete the `archiveProposal` test at ~line 357-372 and the `archive` handoff test at ~line 376-380)

- [ ] **Step 1: Failing tests** `tests/delivery.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readlinkSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeDeliveryTree, deliveryHandoff } from '../shared/scripts/lib/delivery.js';

const F1 = 'FungiDB/a1/rnaSeq/N/v/final';
const F2 = 'HostDB/h1/rnaSeq/N/v/final';

function inputs() {
  const base = mkdtempSync(join(tmpdir(), 'delivery-'));
  const proposalDir = join(base, 'src/PRJNA1');
  mkdirSync(join(proposalDir, 'curated'), { recursive: true });
  writeFileSync(join(proposalDir, 'manifest.json'), '{}');
  const stagingDir = join(base, 'staging');
  mkdirSync(stagingDir);
  writeFileSync(join(stagingDir, 'big.gff3'), 'gff');
  const files = { [`${F1}/samplesheet.csv`]: 's1', [`${F2}/samplesheet.csv`]: 's2', 'common/rnaSeq/x/2026-10/final/a1_N_rnaSeq_RSRC/entity-sample.tsv': 't' };
  return { dir: join(base, 'delivery/PRJNA1'), finals: [F1, F2], files, proposalDir, accession: 'PRJNA1', stagingDir };
}

test('writeDeliveryTree lays out final/, fromProvider/ with the proposal and staging, links, workspace/ and the record', () => {
  const i = inputs();
  const record = writeDeliveryTree({ ...i, record: { accession: 'PRJNA1' } });
  assert.equal(readFileSync(join(i.dir, F1, 'samplesheet.csv'), 'utf-8'), 's1');
  const home = join(i.dir, 'FungiDB/a1/rnaSeq/N/v/fromProvider');
  assert.ok(existsSync(join(home, 'PRJNA1/manifest.json')));
  assert.equal(readFileSync(join(home, 'big.gff3'), 'utf-8'), 'gff');
  assert.equal(readlinkSync(join(i.dir, 'HostDB/h1/rnaSeq/N/v/fromProvider')), '../../../../../FungiDB/a1/rnaSeq/N/v/fromProvider');
  assert.ok(lstatSync(join(i.dir, 'HostDB/h1/rnaSeq/N/v/workspace')).isDirectory());
  const paths = record.files.map((f) => f.path);
  assert.ok(paths.includes(`${F1}/samplesheet.csv`) && paths.includes('FungiDB/a1/rnaSeq/N/v/fromProvider/big.gff3'));
  assert.ok(record.files.every((f) => /^[0-9a-f]{64}$/.test(f.sha256)));
  assert.deepEqual(JSON.parse(readFileSync(join(i.dir, 'delivery.json'), 'utf-8')), record);
});

test('a re-run replaces everything but workspace/', () => {
  const i = inputs();
  writeDeliveryTree({ ...i, record: {} });
  writeFileSync(join(i.dir, 'FungiDB/a1/rnaSeq/N/v/workspace/hours-of-work.bam'), 'bam');
  writeFileSync(join(i.dir, F1, 'stray.txt'), 'x');
  const record = writeDeliveryTree({ ...i, files: { ...i.files, [`${F1}/samplesheet.csv`]: 'new' }, record: {} });
  assert.equal(readFileSync(join(i.dir, 'FungiDB/a1/rnaSeq/N/v/workspace/hours-of-work.bam'), 'utf-8'), 'bam');
  assert.equal(existsSync(join(i.dir, F1, 'stray.txt')), false);
  assert.equal(readFileSync(join(i.dir, F1, 'samplesheet.csv'), 'utf-8'), 'new');
  assert.ok(!record.files.some((f) => f.path.includes('/workspace/')));
});

test('a delivery path not ending in final is refused before anything is written', () => {
  const i = inputs();
  assert.throws(() => writeDeliveryTree({ ...i, finals: ['FungiDB/a1/rnaSeq/N/v/data'], record: {} }), /must end in "final"/);
  assert.equal(existsSync(i.dir), false);
});

test('deliveryHandoff is one rsync that keeps links and leaves out the record', () => {
  assert.equal(deliveryHandoff({ dir: '/ws/delivery/PRJNA1', manualDelivery: { host: 'yew', root: '/m' } }),
    'Copy the delivery to the server; -a keeps the fromProvider links:\n  rsync -a --exclude delivery.json /ws/delivery/PRJNA1/ yew:/m/');
});
```

- [ ] **Step 2: Run, expect FAIL** — `node --test tests/delivery.test.js`

- [ ] **Step 3: Implement** `shared/scripts/lib/delivery.js`:

```js
import { mkdirSync, writeFileSync, cpSync, rmSync, renameSync, existsSync, readdirSync, readFileSync, symlinkSync, lstatSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { fromProviderOf } from './artifacts.js';
import { DELIVERY_RECORD } from './validation-workspace.js';

export const DELIVERY_SCHEMA_VERSION = 1;
const WORKSPACE = 'workspace';

const workspaceOf = (finalRelative) => join(dirname(finalRelative), WORKSPACE);

/** Every regular file under dir, relative, except the record and anything in a workspace/; symlinks are not followed. */
function filesUnder(dir, finals, at = '') {
  const skip = new Set([DELIVERY_RECORD, ...finals.map(workspaceOf)]);
  return readdirSync(join(dir, at)).sort().flatMap((name) => {
    const rel = join(at, name);
    if (skip.has(rel)) return [];
    const st = lstatSync(join(dir, rel));
    if (st.isDirectory()) return filesUnder(dir, finals, rel);
    return st.isFile() ? [rel] : [];
  });
}

/**
 * Builds the delivery tree beside dir and swaps it in, carrying over each
 * workspace/, so a failure leaves the previous tree whole. files maps paths
 * relative to @@manualDeliveryDir@@ to text. The first final's fromProvider
 * holds the proposal (as <accession>/) and the staging files; the others link
 * to it. Writes record plus the file list as delivery.json and returns it.
 */
export function writeDeliveryTree({ dir, finals, files, proposalDir, accession, stagingDir, record }) {
  const [home, ...others] = finals.map(fromProviderOf);
  const next = `${dir}.next`;
  rmSync(next, { recursive: true, force: true });
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(next, path)), { recursive: true });
    writeFileSync(join(next, path), text);
  }
  cpSync(proposalDir, join(next, home, accession), { recursive: true });
  if (stagingDir) cpSync(stagingDir, join(next, home), { recursive: true });
  for (const link of others) {
    mkdirSync(dirname(join(next, link)), { recursive: true });
    symlinkSync(relative(dirname(join(next, link)), join(next, home)), join(next, link));
  }
  for (const ws of finals.map(workspaceOf)) {
    if (existsSync(join(dir, ws))) renameSync(join(dir, ws), join(next, ws));
    else mkdirSync(join(next, ws), { recursive: true });
  }
  const full = {
    ...record,
    files: filesUnder(next, finals).map((path) => ({ path, sha256: createHash('sha256').update(readFileSync(join(next, path))).digest('hex') }))
  };
  writeFileSync(join(next, DELIVERY_RECORD), JSON.stringify(full, null, 2) + '\n');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dirname(dir), { recursive: true });
  renameSync(next, dir);
  return full;
}

/** The copy a person runs; prepare-delivery prints it and mark-ready posts it. */
export function deliveryHandoff({ dir, manualDelivery }) {
  return [
    'Copy the delivery to the server; -a keeps the fromProvider links:',
    `  rsync -a --exclude ${DELIVERY_RECORD} ${dir}/ ${manualDelivery.host}:${manualDelivery.root}/`
  ].join('\n');
}
```

`fromProviderOf` throws on a path not ending in `final`; it runs on the first line, before anything is written, which the refusal test relies on.

In `artifacts.js`: delete `archiveProposal` (and `cpSync`, `rmSync`, `symlinkSync`, `relative` imports if now unused), and make `handoffNote({ deliveries, source })`, deleting its `archive` line. `render-proposal.js` already calls it without `archive`.

- [ ] **Step 4: Run** — `node --test tests/delivery.test.js tests/artifacts.test.js`. Expected: PASS once the two archive tests in `artifacts.test.js` are deleted. `tests/load-ops.test.js` will now fail to import `archiveProposal` through load-ops; that is fixed in Task 12, so run only these two files here.

- [ ] **Step 5: Commit** — `git add -A shared/scripts/lib tests && git commit -m "Delivery tree with record and handoff"`

---

### Task 10: prepare-delivery

**Files:**
- Modify: `shared/scripts/lib/verification-ops.js` (export `currentReport`)
- Create: `shared/scripts/lib/delivery-ops.js`, `shared/scripts/prepare-delivery.js`
- Test: `tests/delivery-ops.test.js`

- [ ] **Step 1: Export `currentReport`** — in `verification-ops.js` change `async function currentReport(` to `export async function currentReport(`.

- [ ] **Step 2: Failing tests** `tests/delivery-ops.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createGit } from '../shared/scripts/lib/git-ops.js';
import { prepareDelivery } from '../shared/scripts/lib/delivery-ops.js';
import { formatReportComment } from '../shared/scripts/lib/validation.js';
import { fixtures, initRepo, stubTicket, stubGh, validationRoot } from './helpers.js';

const TICKET = { system: 'github', id: '43', url: 'https://r/issues/43' };
const FINAL = 'FungiDB/tfakST1/rnaSeq/Doe_heat_shock_2024/2024-05-01/final';
const CORPUS = 'common/rnaSeq/sampleDetailsForEda/2026-10/final/tfakST1_Doe_heat_shock_2024_rnaSeq_RSRC';

/** PRJNA000002 merged on master with a ticket, origin/rebuild02 cut before it, and a validation root whose hosts are local dirs. */
function setup({ staging } = {}) {
  const { repo } = initRepo('delivery-ops-');
  writeFileSync(join(repo, 'Model/lib/xml/datasetPresenters/FungiDB.xml'), '<?xml version="1.0"?>\n<datasetPresenters>\n</datasetPresenters>\n');
  execFileSync('git', ['-C', repo, 'add', '-A']);
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'presenters']);
  execFileSync('git', ['-C', repo, 'push', '-q', 'origin', 'HEAD:rebuild02']);
  const dir = join(repo, 'Proposals/PRJNA000002');
  cpSync(join(fixtures, 'proposals/PRJNA000002'), dir, { recursive: true });
  const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf-8'));
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ ...m, ticket: TICKET, ...(staging ? { staging } : {}) }, null, 2) + '\n');
  execFileSync('git', ['-C', repo, 'add', '-A']);
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'merge PRJNA000002']);
  execFileSync('git', ['-C', repo, 'push', '-q']);
  const git = createGit(repo, { exec: stubGh().exec });
  git.fetch();
  const hosts = mkdtempSync(join(tmpdir(), 'hosts-'));
  const { root, typeDir } = validationRoot({});
  const env = JSON.parse(readFileSync(join(typeDir, 'env.json'), 'utf-8'));
  writeFileSync(join(typeDir, 'env.json'), JSON.stringify({ ...env, staging: { host: 'local', root: join(hosts, 'dataStaging') }, manualDelivery: { host: 'local', root: join(hosts, 'manualDelivery') } }));
  const report = { schemaVersion: 1, accession: 'PRJNA000002', datasetType: 'bulk-rnaseq', proposalTree: git.objectId('origin/master', 'Proposals/PRJNA000002'), against: null, workspace: '/ws', tools: {}, findings: [], verdict: 'pass' };
  const ticket = stubTicket({ status: 'verifying', existingComments: [formatReportComment(report)] });
  return { repo, git, root, typeDir, hosts, ticket };
}

// Hosts named "local" read the local filesystem, as the deployed code reads yew.
const localRemote = () => (host) => (host === 'local' ? { host: null } : { host });
const prepare = (s, opts = {}) => prepareDelivery({ git: s.git, ticket: s.ticket, workspace: s.root, against: 'origin/rebuild02', accession: 'PRJNA000002', remoteOf: localRemote(), ...opts });

test('prepareDelivery writes final/, fromProvider/, workspace/, the corpus STF and a record', async () => {
  const s = setup();
  const { dir, record, handoff } = await prepare(s);
  assert.equal(dir, join(s.typeDir, 'delivery/PRJNA000002'));
  assert.ok(existsSync(join(dir, FINAL, 'samplesheet.csv')));
  assert.ok(existsSync(join(dir, FINAL, '../fromProvider/PRJNA000002/manifest.json')));
  assert.ok(existsSync(join(dir, FINAL, '../workspace')));
  assert.ok(existsSync(join(dir, CORPUS, 'entity-sample.tsv')));
  assert.equal(record.against, 'origin/rebuild02');
  assert.equal(record.release, '2026-10');
  assert.deepEqual(record.settlement, [{ proposed: 'tfakST1', abbrev: 'tfakST1' }]);
  assert.equal(record.proposalTree, s.git.objectId('origin/master', 'Proposals/PRJNA000002'));
  assert.match(record.corpusStep, /make-cumulative-links\.sh 2026-10'$/);
  assert.match(handoff, /^  rsync -a --exclude delivery\.json /m);
});

test('prepareDelivery copies listed staging files and stops on a missing or mismatched one', async () => {
  const sha = 'b'.repeat(64);
  const s = setup({ staging: [{ path: 'reads/a.fq.gz' }, { path: 'big.gff3', sha256: sha }] });
  await assert.rejects(prepare(s), /dataStaging\/PRJNA000002 is missing on local/);
  mkdirSync(join(s.hosts, 'dataStaging/PRJNA000002/reads'), { recursive: true });
  writeFileSync(join(s.hosts, 'dataStaging/PRJNA000002/reads/a.fq.gz'), 'fq');
  await assert.rejects(prepare(s), /dataStaging\/PRJNA000002 lacks big\.gff3/);
  writeFileSync(join(s.hosts, 'dataStaging/PRJNA000002/big.gff3'), 'gff');
  await assert.rejects(prepare(s), /big\.gff3 has sha256 [0-9a-f]{64}, not b{64}/);
});

test('prepareDelivery refusals: status, report, against, release, corpus clash', async () => {
  const s = setup();
  await assert.rejects(prepare(s, { against: 'rebuild02' }), /--against must be origin\/rebuild<RR>/);
  await assert.rejects(prepare({ ...s, ticket: stubTicket({ status: 'ready' }) }), /is at "Ready to load"; prepare the delivery while it is "Proposed" or "Preprocessing"/);
  await assert.rejects(prepare({ ...s, ticket: stubTicket({ status: 'verifying' }) }), /has no verification report/);
  await assert.rejects(prepare({ ...s, ticket: stubTicket({ status: 'verifying', existingComments: s.ticket.notes, release: null }) }), /has no due date/);
  mkdirSync(join(s.hosts, 'manualDelivery/common/rnaSeq/sampleDetailsForEda/2026-07/final/tfakST1_Doe_heat_shock_2024_rnaSeq_RSRC'), { recursive: true });
  await assert.rejects(prepare(s), /tfakST1_Doe_heat_shock_2024_rnaSeq_RSRC is already in 2026-07\/final/);
});

test('an organism stop is an error at prepare, and --settle resolves it', async () => {
  const s = setup();
  // tfakST2 has no organism file on rebuild02, so it cannot settle as proposed.
  await assert.rejects(prepare(s, { settle: { tfakST1: 'tfakST2' } }), /Organism abbreviations need a person/);
});
```

- [ ] **Step 3: Run, expect FAIL** — `node --test tests/delivery-ops.test.js`

- [ ] **Step 4: Implement** `shared/scripts/lib/delivery-ops.js`:

```js
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { proposalRelativePath, organismsOf, projectOf } from './manifest.js';
import { verifiableTicket, currentReport } from './verification-ops.js';
import { validatorsFor } from '../dataset-types/validators.js';
import { loadDatasetType } from '../dataset-types/_common.js';
import { readDatasetClassOnRef } from './dataset-classes.js';
import { settlementOn, withSettledProposal } from './load-ops.js';
import { deliveryLocation } from './artifacts.js';
import { openDeliveryDir } from './validation-workspace.js';
import { createRemote } from './remote.js';
import { corpusDir, corpusClashes, corpusStep } from './corpus.js';
import { writeDeliveryTree, deliveryHandoff, DELIVERY_SCHEMA_VERSION } from './delivery.js';

const AGAINST = /^origin\/rebuild\d+$/;
const PREPARABLE = ['proposed', 'verifying'];

/** Pulls dataStaging/<accession>/ into dest and checks every listed file; returns the staging summary for the record, or null. */
function pullStaging({ remote, staging, accession, listed, dest }) {
  if (!listed.length) return null;
  const path = join(staging.root, accession);
  const top = remote.list(path);
  if (top === null) throw new Error(`dataStaging/${accession} is missing on ${staging.host} (${path}); the data provider's files must be there first`);
  remote.pull(path, dest);
  for (const { path: rel, sha256 } of listed) {
    const local = join(dest, rel);
    if (!existsSync(local)) throw new Error(`dataStaging/${accession} lacks ${rel} on ${staging.host}`);
    if (sha256) {
      const got = createHash('sha256').update(readFileSync(local)).digest('hex');
      if (got !== sha256) throw new Error(`${rel} has sha256 ${got}, not ${sha256}`);
    }
  }
  return { host: staging.host, path, files: listed.map((s) => s.path) };
}

/**
 * Preprocessing: settles the proposal's organisms against `against`, and
 * writes its whole manual delivery (final/, fromProvider/ with the proposal and
 * staging files, workspace/, the STF corpus files) under the validation
 * workspace's delivery/<accession>/, with delivery.json. Every check runs
 * before anything is written. remoteOf(host) gives createRemote options.
 * Returns { dir, record, handoff }.
 */
export async function prepareDelivery({ git, ticket, workspace, against, accession, settle = {}, remoteOf = (host) => ({ host }) }) {
  if (!AGAINST.test(against ?? '')) throw new Error(`--against must be origin/rebuild<RR>; got "${against}"`);
  const { ticket: ref, manifest } = verifiableTicket(git, accession, 'its delivery is not prepared');
  if (!git.refExists(against)) throw new Error(`${against} does not exist; fetch it or name another rebuild branch`);
  const status = await ticket.getStatus(ref);
  if (!PREPARABLE.includes(status)) {
    throw new Error(`The ticket ${ref.url} is at "${ticket.statusOption(status)}"; prepare the delivery while it is "${ticket.statusOption('proposed')}" or "${ticket.statusOption('verifying')}"`);
  }
  const datasetType = await loadDatasetType(manifest.datasetType);
  if (!datasetType.datasetClass) throw new Error(`${manifest.datasetType} has no dataset class yet, so it has no delivery`);
  if (validatorsFor(manifest.datasetType).length) await currentReport(git, ticket, ref, accession);
  const { organisms: settled, stops } = settlementOn(git, manifest, against, settle);
  if (stops.length) {
    throw new Error(`Organism abbreviations need a person before ${accession} is delivered:\n  - ${stops.join('\n  - ')}\nResolve each with --settle <proposed>=<abbrev>, then re-run.`);
  }
  const build = await ticket.getBuild(ref);
  const release = await ticket.getRelease(ref);
  const { dir, staging, manualDelivery } = openDeliveryDir({ root: workspace, datasetType: manifest.datasetType, accession });
  const classDef = readDatasetClassOnRef(git, against, datasetType.datasetClass);
  const relDir = proposalRelativePath(accession);
  const proposalTree = git.objectId('origin/master', relDir);

  const scratch = mkdtempSync(join(tmpdir(), 'prepare-delivery-'));
  try {
    git.exportTree('origin/master', relDir, join(scratch, 'export'));
    const exported = join(scratch, 'export', relDir);
    const problems = datasetType.stagingProblems(exported);
    if (problems.length) throw new Error(`${accession}: ${problems.join('; ')}`);
    const stagingDir = join(scratch, 'staging');
    const stagingSummary = pullStaging({ remote: createRemote(remoteOf(staging.host)), staging, accession, listed: manifest.staging ?? [], dest: stagingDir });

    return await withSettledProposal(exported, manifest, settled, async (d, m) => {
      const parts = organismsOf(m).map((abbrev) => {
        const datasetName = datasetType.datasetNameFor(abbrev, m.name);
        return { abbrev, project: projectOf(m, abbrev), datasetName, delivery: deliveryLocation(m, classDef, abbrev) };
      });
      const clashes = corpusClashes({ remote: createRemote(remoteOf(manualDelivery.host)), manualRoot: manualDelivery.root, corpus: datasetType.corpus, release, datasets: parts });
      if (clashes.length) throw new Error(`${accession} clashes with the STF corpus:\n  - ${clashes.join('\n  - ')}`);
      const files = {};
      for (const p of parts) {
        for (const [name, text] of Object.entries(datasetType.renderArtifacts(d, p.abbrev).files)) files[join(p.delivery.relative, name)] = text;
        for (const [name, text] of Object.entries(datasetType.corpusFiles(d, p.abbrev))) files[join(corpusDir(datasetType.corpus, release, p), name)] = text;
      }
      const record = {
        schemaVersion: DELIVERY_SCHEMA_VERSION, accession, datasetType: manifest.datasetType, proposalTree, against, build, release,
        settlement: settled.map((o) => ({ proposed: o.proposed, abbrev: o.abbrev })),
        staging: stagingSummary,
        corpusStep: corpusStep(datasetType.corpus, release, manualDelivery),
        handoff: deliveryHandoff({ dir, manualDelivery })
      };
      const written = writeDeliveryTree({
        dir, finals: parts.map((p) => p.delivery.relative), files, proposalDir: exported, accession,
        stagingDir: stagingSummary ? stagingDir : null, record
      });
      return { dir, record: written, handoff: record.handoff };
    });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
```

Notes for the implementer:
- The proposal copied into `fromProvider/<accession>/` is `exported` (master's copy, proposed abbreviations), not the settled scratch copy: it is the provenance record.
- `datasetNameFor` exists on both rnaseq and dnaseq modules (`bulk-rnaseq.js:88`, `dnaseq.js:25`).
- If `verifiableTicket` throws "has no ticket" for the fixture, the fixture manifest needs the `ticket` field, which `setup()` adds.

`shared/scripts/prepare-delivery.js`:

```js
#!/usr/bin/env node
/**
 * prepare-delivery.js - Preprocessing: settles a merged proposal's organisms
 * against a rebuild branch and writes its whole manual delivery under the
 * validation workspace's delivery/<accession>/. Re-running replaces everything
 * but workspace/. Prints the rsync a person runs.
 *
 * Usage: node prepare-delivery.js --workspace <root> --against origin/rebuildRR [--settle <proposed>=<abbrev> ...] <accession>
 */
import { parseArgs } from 'node:util';
import { openWorkspace } from './lib/config.js';
import { createGit } from './lib/git-ops.js';
import { createTicketClient } from './lib/ticket/index.js';
import { prepareDelivery } from './lib/delivery-ops.js';
import { ASK } from './lib/validation-env.js';

const USAGE = 'Usage: node prepare-delivery.js --workspace <root> --against origin/rebuildRR [--settle <proposed>=<abbrev> ...] <accession>';

async function main() {
  const { values, positionals } = parseArgs({
    options: { workspace: { type: 'string' }, against: { type: 'string' }, settle: { type: 'string', multiple: true, default: [] } }, allowPositionals: true
  });
  const [accession] = positionals;
  if (!accession || positionals.length !== 1) { console.error(USAGE); process.exit(1); }
  if (!values.workspace) { console.error(`--workspace is required: ${ASK}.\n${USAGE}`); process.exit(1); }
  if (!values.against) { console.error(`--against origin/rebuildRR is required: ask the data loader which rebuild branch.\n${USAGE}`); process.exit(1); }
  const settle = {};
  for (const pair of values.settle) {
    const [proposed, abbrev, ...rest] = pair.split('=');
    if (!proposed || !abbrev || rest.length) { console.error(`--settle must be <proposed>=<abbrev>, got "${pair}"`); process.exit(1); }
    if (Object.hasOwn(settle, proposed)) { console.error(`--settle names ${proposed} twice`); process.exit(1); }
    settle[proposed] = abbrev;
  }
  const config = openWorkspace();
  const { dir, record, handoff } = await prepareDelivery({
    git: createGit(config.repoPath), ticket: createTicketClient(config), workspace: values.workspace, against: values.against, accession, settle
  });
  for (const s of record.settlement) console.log(`Organism: ${s.abbrev}${s.abbrev === s.proposed ? '' : ` (proposed ${s.proposed})`}`);
  console.log(`Release:  ${record.release} (build ${record.build})`);
  console.log(`Delivery: ${dir} (${record.files.length} files)`);
  console.log(`\n${handoff}`);
  console.log('\nPreprocess in each workspace/, then run mark-ready.js.');
}

main().catch(err => { console.error(`Error: ${err.message}`); process.exit(1); });
```

- [ ] **Step 5: Run, expect PASS** — `node --test tests/delivery-ops.test.js`. If the `--settle` test does not stop (the fixture may accept `tfakST2`), replace it with a settle the fixture's `organisms.js` rules reject: read `tests/organisms.test.js` for one that yields a stop.

- [ ] **Step 6: Commit** — `git add -A shared/scripts tests && git commit -m "prepare-delivery: preprocessing writes the manual delivery"`

---

### Task 11: The delivery record on the ticket, required by mark-ready

**Files:**
- Modify: `shared/scripts/lib/validation.js`
- Modify: `shared/scripts/lib/verification-ops.js` (`markReady`)
- Modify: `shared/scripts/mark-ready.js`
- Test: `tests/validation.test.js`, `tests/validation-ops.test.js`

- [ ] **Step 1: Failing tests**

`tests/validation.test.js`:

```js
test('a delivery comment round-trips its record, and the latest one wins', () => {
  const record = { proposalTree: 't1', against: 'origin/rebuild02', settlement: [{ proposed: 'a', abbrev: 'a' }], release: '2026-10', corpusStep: 'ssh yew x', handoff: 'Copy ...\n  rsync -a ...' };
  const body = formatDeliveryComment(record, 'f'.repeat(64));
  assert.ok(body.startsWith('<!-- dataset-curator delivery record -->'));
  assert.ok(body.includes('rsync -a'));
  assert.deepEqual(latestDeliveryRecord(['x', body]).record, {
    schemaVersion: 1, proposalTree: 't1', against: 'origin/rebuild02', settlement: [{ proposed: 'a', abbrev: 'a' }], release: '2026-10', corpusStep: 'ssh yew x', deliverySha: 'f'.repeat(64)
  });
  assert.equal(latestDeliveryRecord(['x']), null);
  assert.equal(latestDeliveryRecord([body, '<!-- dataset-curator delivery record -->\nbroken']).record, null);
});
```

`tests/validation-ops.test.js`: add a stub and tests; then pass `delivery: deliveryStub(git)` in every existing `markReady` call on PRJNA000002 that is expected to reach the ticket change (lines ~162-235; the refusal tests before the report check do not need it).

```js
const deliveryStub = (git, { tree, none = false } = {}) => ({
  read: () => none ? null : { record: { proposalTree: tree ?? git.objectId('origin/master', 'Proposals/PRJNA000002'), against: 'origin/rebuild02', settlement: [{ proposed: 'tfakST1', abbrev: 'tfakST1' }], release: '2026-10', corpusStep: 'ssh yew x', handoff: 'Copy\n  rsync -a' }, sha: 'e'.repeat(64), dir: '/ws/delivery/PRJNA000002' }
});

test('markReady refuses a type with a dataset class without a current delivery', async () => {
  const { git } = setupMerged();
  const ticket = stubTicket({ status: 'verifying', existingComments: [formatReportComment(reportFor(git, 'pass'))] });
  await assert.rejects(markReady({ git, ticket, accession: 'PRJNA000002', workspace: disposalStub(), delivery: deliveryStub(git, { none: true }) }),
    /No delivery for PRJNA000002; run prepare-delivery\.js --workspace <root> --against origin\/rebuild<RR> PRJNA000002 first/);
  await assert.rejects(markReady({ git, ticket, accession: 'PRJNA000002', workspace: disposalStub(), delivery: deliveryStub(git, { tree: 'old' }) }),
    /The delivery of PRJNA000002 is for an earlier version of it; run prepare-delivery\.js again/);
  assert.equal(setsStatus(ticket), false);
});

test('markReady posts the delivery record with the handoff before setting ready', async () => {
  const { git } = setupMerged();
  const ticket = stubTicket({ status: 'verifying', existingComments: [formatReportComment(reportFor(git, 'pass'))] });
  await markReady({ git, ticket, accession: 'PRJNA000002', workspace: disposalStub(), delivery: deliveryStub(git) });
  const posted = ticket.calls.filter((c) => c[0] === 'comment').map((c) => c[2]);
  const record = latestDeliveryRecord(posted).record;
  assert.equal(record.against, 'origin/rebuild02');
  assert.ok(posted.at(-1).includes('rsync -a'));
  assert.deepEqual(ticket.calls.at(-1), ['setStatus', '43', 'ready']);
});
```

Import `latestDeliveryRecord` from validation.js in that file.

- [ ] **Step 2: Run, expect FAIL** — `node --test tests/validation.test.js tests/validation-ops.test.js`

- [ ] **Step 3: Implement**

`validation.js` — generalize the marked-JSON parse and add the delivery comment:

```js
export const DELIVERY_MARKER = '<!-- dataset-curator delivery record -->';
export const DELIVERY_RECORD_SCHEMA_VERSION = 1;

const jsonBlockOf = (body) => /\n```json\n([\s\S]*)\n```$/.exec(body.replaceAll('\r\n', '\n').trimEnd())?.[1];

/** The ticket comment mark-ready posts: the handoff, then what load enforces as JSON. */
export function formatDeliveryComment(record, deliverySha) {
  const { proposalTree, against, settlement, release, corpusStep } = record;
  return [
    DELIVERY_MARKER,
    `**Delivery** prepared against ${against} for release ${release}: ${settlement.map((s) => s.abbrev).join(', ')}`,
    '',
    record.handoff,
    '',
    '```json',
    JSON.stringify({ schemaVersion: DELIVERY_RECORD_SCHEMA_VERSION, proposalTree, against, settlement, release, corpusStep, deliverySha }, null, 2),
    '```'
  ].join('\n');
}

/** The last delivery comment is authoritative: { record }, record null when unreadable; null when there is none. */
export function latestDeliveryRecord(bodies) {
  const last = bodies.filter((b) => typeof b === 'string' && b.startsWith(DELIVERY_MARKER)).at(-1);
  if (last === undefined) return null;
  try {
    const record = JSON.parse(jsonBlockOf(last) ?? '');
    return { record: record?.schemaVersion === DELIVERY_RECORD_SCHEMA_VERSION ? record : null };
  } catch { return { record: null }; }
}
```

Make `parseReportComment` use `jsonBlockOf` too.

`verification-ops.js` — in `markReady({ git, ticket, accession, note, workspace, delivery })`, after `disposal?.assertDisposable(...)` and before any comment:

```js
  const { datasetClass } = await loadDatasetType(manifest.datasetType);
  const prepared = datasetClass ? currentDelivery(git, delivery, manifest.datasetType, accession) : null;
```

and after `if (comment) await ticket.commentOnce(ref, comment);`:

```js
  if (prepared) await ticket.commentOnce(ref, formatDeliveryComment(prepared.record, prepared.sha));
```

with

```js
/** The delivery prepare-delivery wrote for the proposal as origin/master has it. */
function currentDelivery(git, delivery, datasetType, accession) {
  const again = `run prepare-delivery.js --workspace <root> --against origin/rebuild<RR> ${accession}`;
  if (!delivery) throw new Error(`--workspace is required for ${datasetType}: mark-ready reads the delivery under it (ask the data loader which one)`);
  const found = delivery.read(datasetType);
  if (!found) throw new Error(`No delivery for ${accession}; ${again} first`);
  if (found.record.proposalTree !== git.objectId('origin/master', proposalRelativePath(accession))) {
    throw new Error(`The delivery of ${accession} is for an earlier version of it; run prepare-delivery.js again`);
  }
  return found;
}
```

Imports: `loadDatasetType` from `../dataset-types/_common.js`, `formatDeliveryComment` from `./validation.js`, `proposalRelativePath` from `./manifest.js`. Update the `markReady` JSDoc: "For a type with a dataset class it also needs the current delivery (delivery.read) and posts its record."

`mark-ready.js` — import `deliveryReader` and pass `delivery: values.workspace ? deliveryReader({ root: values.workspace, accession }) : undefined`. Update the header comment: "…then posts the delivery record and removes the proposal's validation workspace (never its delivery/)."

- [ ] **Step 4: Run, expect PASS** — `yarn test` (load-ops still fails from Task 9 until Task 12; every other file passes).

- [ ] **Step 5: Commit** — `git commit -am "mark-ready requires and posts the delivery record"`

---

### Task 12: Load enforces the record and stops delivering

**Files:**
- Modify: `shared/scripts/lib/load-ops.js`, `shared/scripts/load-proposal.js`
- Test: `tests/load-ops.test.js`

- [ ] **Step 1: Rewrite the tests**

In `tests/load-ops.test.js`:
- Delete these tests (delivery moved to Task 10): "an rnaseq load archives the proposal in the first organism's fromProvider and links the second", "a load whose delivery path does not end in final is refused before any branch".
- In the remaining rnaseq tests, remove `deliveryBase` from every `loadProposal` call and from `rnaOnRebuild`/`rnaForTwoOrganisms`, delete assertions on `result.handoff`, `deliveryBase` files and `writeArtifacts` output, and assert the corpus step instead where the handoff was asserted (`assert.match(result.corpusStep, /make-cumulative-links/)`).
- Any test passing `settle` to `loadProposal`/`checkLoadPreconditions` now gets that settlement through the record: build its ticket with `recorded(repo, { settlement })`.
- Give every non-dry-run PRJNA000002 load a ticket carrying a record. Add near `tickets`:

```js
import { formatDeliveryComment } from '../shared/scripts/lib/validation.js';

/** A Ready ticket carrying the delivery record mark-ready posts for PRJNA000002 as origin/master has it. */
function recorded(repo, { against = 'origin/rebuild02', settlement = [{ proposed: 'tfakST1', abbrev: 'tfakST1' }], tree, ...opts } = {}) {
  execFileSync('git', ['-C', repo, 'fetch', '-q']);
  const proposalTree = tree ?? execFileSync('git', ['-C', repo, 'rev-parse', 'origin/master:Proposals/PRJNA000002'], { encoding: 'utf-8' }).trim();
  const record = { proposalTree, against, settlement, release: '2026-10', corpusStep: "ssh yew '/m/common/rnaSeq/sampleDetailsForEda/make-cumulative-links.sh 2026-10'", handoff: 'Copy\n  rsync -a' };
  return tickets({ existingComments: [formatDeliveryComment(record, 'e'.repeat(64))], ...opts });
}
```

For two-organism fixtures pass both organisms in `settlement`.

Add new tests:

```js
test('a load without a delivery record is refused before any branch; a dry run warns', async (t) => {
  const { repo } = rnaOnRebuild(t);
  const git = createGit(repo, { exec: ghStub().exec });
  await assert.rejects(loadProposal({ git, ticket: tickets(), repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, accession: 'PRJNA000002' }),
    /has no delivery record; run prepare-delivery\.js --against origin\/rebuild02 PRJNA000002, then mark-ready\.js again/);
  assert.equal(git.branchExists('load/PRJNA000002'), false);
  const dry = await loadProposal({ git, ticket: tickets(), repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, accession: 'PRJNA000002', dryRun: true });
  assert.ok(dry.warnings.some((w) => /No delivery record yet/.test(w)));
});

test('a load refuses a record for another rebuild branch, an earlier proposal, or a settlement that drifted', async (t) => {
  const { repo } = rnaOnRebuild(t);
  const git = createGit(repo, { exec: ghStub().exec });
  const run = (ticket) => loadProposal({ git, ticket, repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, accession: 'PRJNA000002' });
  await assert.rejects(run(recorded(repo, { against: 'origin/rebuild03' })), /was prepared against origin\/rebuild03, not origin\/rebuild02/);
  await assert.rejects(run(recorded(repo, { tree: '0'.repeat(40) })), /delivery record is for an earlier version of PRJNA000002/);
  await assert.rejects(run(recorded(repo, { settlement: [{ proposed: 'tfakST1', abbrev: 'tfakXX' }] })), /settles to tfakST1 here; the delivery recorded tfakXX/);
});

test('a load prints the recorded corpus step on the PR and the ticket', async (t) => {
  const { repo } = rnaOnRebuild(t);
  const gh = ghStub();
  const ticket = recorded(repo);
  const result = await loadProposal({ git: createGit(repo, { exec: gh.exec }), ticket, repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, accession: 'PRJNA000002' });
  assert.match(result.corpusStep, /make-cumulative-links\.sh 2026-10/);
  const prCreate = gh.calls.find((a) => a[0] === 'pr' && a[1] === 'create');
  assert.ok(prCreate[prCreate.indexOf('--body') + 1].includes(result.corpusStep));
  assert.ok(ticket.calls.filter((c) => c[0] === 'comment').some((c) => c[2].includes(result.corpusStep)));
});
```

Load now reads ticket comments for a type with a dataset class, so tests asserting the exact ticket calls of a PRJNA000002 dry run ("a dry run only reads the build and status from the ticket") gain `['listComments', '42']`; update the expectation and the test name ("…build, status and delivery record…").

The drift case passes a recorded abbreviation (`tfakXX`) that `settleOrganisms` will either stop on or settle differently. If it stops, the error must still name the record (see Step 3's message).

- [ ] **Step 2: Run, expect FAIL** — `node --test tests/load-ops.test.js`

- [ ] **Step 3: Implement in `load-ops.js`**

Imports: remove `writeArtifacts, handoffNote, fromProviderOf, archiveProposal, deliveryLocation` from `./artifacts.js` (drop the import line), and `excludeScratch, SCRATCH_DIR`. Add `import { latestDeliveryRecord } from './validation.js';` (next to `formatFinding`).

Add:

```js
/**
 * The delivery mark-ready recorded for a type with a dataset class:
 * { settle, record } for settleOrganisms and the PR, refusing a record for
 * another rebuild branch or an earlier proposal. A dry run without one returns
 * { missing: true } so verification can still dry-run.
 */
async function recordedDelivery(git, ticket, manifest, relDir, rebuildBranch, dryRun) {
  const { datasetClass } = await loadDatasetType(manifest.datasetType);
  if (!datasetClass) return { settle: {}, record: null };
  const again = `run prepare-delivery.js --against origin/${rebuildBranch} ${manifest.accession}, then mark-ready.js again`;
  const found = latestDeliveryRecord(await ticket.listComments(manifest.ticket));
  if (!found) {
    if (dryRun) return { settle: {}, record: null, missing: true };
    throw new Error(`The ticket ${manifest.ticket.url} has no delivery record; ${again}`);
  }
  const { record } = found;
  if (!record) throw new Error(`The latest delivery record on ${manifest.ticket.url} is unreadable; ${again}`);
  if (record.proposalTree !== git.objectId('origin/master', relDir)) throw new Error(`The delivery record is for an earlier version of ${manifest.accession}; ${again}`);
  if (record.against !== `origin/${rebuildBranch}`) throw new Error(`The delivery of ${manifest.accession} was prepared against ${record.against}, not origin/${rebuildBranch}; ${again}`);
  const settle = Object.fromEntries(record.settlement.filter((s) => s.abbrev !== s.proposed).map((s) => [s.proposed, s.abbrev]));
  return { settle, record };
}

/** Settles as the record says, or refuses: the delivery on the server is named by that settlement. */
function settledAsRecorded(git, manifest, recorded) {
  const settled = settledOrStop(git, manifest, recorded.settle);
  if (recorded.record) {
    const here = settled.map((o) => o.abbrev).join(' ');
    const then = recorded.record.settlement.map((s) => s.abbrev).join(' ');
    if (here !== then) throw new Error(`${manifest.accession} settles to ${here} here; the delivery recorded ${then}. Run prepare-delivery.js again, then mark-ready.js.`);
  }
  return settled;
}
```

`settledOrStop` must name the record when a recorded rename now stops: change its message tail from `Resolve each, then re-run.` to `Resolve each with prepare-delivery.js --settle, then mark-ready.js again.`

`checkLoadPreconditions`: drop the `settle = {}` parameter and its JSDoc lines ("settle ({ proposed: abbrev }) is a person's decision…", "A resumed load needs the same settle…"); replace with "Organisms settle as the delivery record on the ticket says (see recordedDelivery)." After `const build = await ticket.getBuild(manifest.ticket);` add `const recorded = await recordedDelivery(git, ticket, manifest, relDir, rebuildBranch, dryRun);`. Replace both `settledOrStop(git, manifest, settle)` calls with `settledAsRecorded(git, manifest, recorded)`. Add `recorded` to both returned objects.

`renderDatasetParts`: delete the `delivery` and `files` fields and the `fromProviderOf` line from each organism; delete `deliveryLocation` use.

`loadProposal`: drop `deliveryBase` and `settle` parameters. After `const warnings = [];` add `if (pre.recorded?.missing) warnings.push('No delivery record yet: this dry run settles organisms afresh; run prepare-delivery.js and mark-ready.js before loading.');`. Delete the `const delivered = await deliver(...)`/`dataset ??=`/`handoff =` lines; define `const corpusStep = pre.recorded?.record?.corpusStep ?? null;`. In the PR body replace `...(handoff ? ['', handoff] : [])` with `...(corpusStep ? ['', `STF corpus step, once the delivery is on the server: ${corpusStep}`] : [])` and change `Proposal: … (archived in delivery)` to `Proposal: \`${relDir}\` on master (archived in its delivery's fromProvider)`. Ticket comment: same replacement. Return `corpusStep` instead of `handoff`. Delete the `deliver()` function. Update the JSDoc: "…comments on and transitions the ticket. It writes nothing outside the repository: preprocessing wrote the delivery."

Resume path: `assertSettledAsCommitted` still runs, now with the recorded settlement.

`load-proposal.js`: drop `--settle` (option, usage, parsing), the dry-run "write N artifacts" line, and print `if (result.corpusStep) console.log(`\nSTF corpus step, once the delivery is on the server:\n  ${result.corpusStep}`);` instead of the handoff. Header comment: replace "loading artifacts written under .curation/delivery/…" with "Organisms settle as the delivery record mark-ready posted says."

- [ ] **Step 4: Run, expect PASS** — `yarn test` (the whole suite now passes).

- [ ] **Step 5: Commit** — `git commit -am "Load enforces the recorded delivery and writes no delivery"`

---

### Task 13: An update at Preprocessing stays at Preprocessing

**Files:**
- Modify: `shared/scripts/lib/proposal-ops.js:26-28`
- Test: `tests/proposal-ops.test.js`

- [ ] **Step 1: Failing test** — find the existing test asserting a republish at `verifying` returns to `proposed` (`grep -n "verifying" tests/proposal-ops.test.js`). Change its expectation so `verifying` keeps its status (no `setStatus` call), and keep `ready`/`revision` returning to `proposed`. Name it `'an update published at Preprocessing stays there; from Ready to load or Needs revision it returns to Proposed'`.

- [ ] **Step 2: Run, expect FAIL** — `node --test tests/proposal-ops.test.js`

- [ ] **Step 3: Implement**

```js
// An updated proposal needs review again; one updated during preprocessing is already being reviewed.
const REREVIEW_STATUSES = ['ready', 'revision'];
```

- [ ] **Step 4: Run, expect PASS** — `yarn test`

- [ ] **Step 5: Commit** — `git commit -am "A proposal updated during preprocessing stays in Preprocessing"`

---

### Task 14: clean-proposals removes local deliveries

**Files:**
- Modify: `shared/scripts/lib/build-start-ops.js` (`cleanProposals`), `shared/scripts/start-build.js`
- Test: `tests/build-start-ops.test.js`

- [ ] **Step 1: Failing test** — extend the existing "cleanProposals deletes earlier releases' loaded proposals only" test (line ~100): pass `removeDelivery: (accessions) => { removed.push(...accessions); return accessions.map((a) => `/ws/delivery/${a}`); }` and assert `removed` equals the result's `removed` list and `result.deliveries` equals the mapped paths; assert the PR body contains `fromProvider/<accession>`.

- [ ] **Step 2: Run, expect FAIL** — `node --test tests/build-start-ops.test.js`

- [ ] **Step 3: Implement** — `cleanProposals({ git, ticket, rebuildBranch, build, removeDelivery = () => [] })`; right after computing `removed` (before the early return):

```js
  const deliveries = removed.length ? removeDelivery(removed) : [];
```

Add `deliveries` to every returned object. PR body first line: `'Each is archived in its delivery\'s fromProvider/<accession>.'`. JSDoc: "…and removes their local deliveries through removeDelivery(accessions)."

`start-build.js`: for `clean-proposals`, require `--workspace` (`usage(`--workspace is required: ${ASK}.\n`)` when missing) and pass `removeDelivery: (accessions) => removeDeliveries({ root: values.workspace, accessions })`; print `Removed delivery ${d}` for each `r.deliveries`. Update USAGE/header: `node start-build.js --rebuild-branch rebuildRR --build NN --workspace <root> clean-proposals`.

- [ ] **Step 4: Run, expect PASS** — `yarn test`

- [ ] **Step 5: Commit** — `git commit -am "clean-proposals removes loaded proposals' local deliveries"`

---

### Task 15: Share, document, version

**Files:**
- Modify: `package.json` (`sharedFiles`, `version`), `.claude-plugin/plugin.json`, `shared/resources/curator.config.json` (if it carries the version, as #38 changed it)
- Modify: `skills/verify-bulk-rnaseq/SKILL.md`, `skills/load-proposals/SKILL.md`, `shared/resources/proposal-workflow.md`, `docs/development.md` (status table only if it lists scripts)

- [ ] **Step 1: sharedFiles** — add to `package.json` `sharedFiles`:

```json
"scripts/prepare-delivery.js": ["verify-bulk-rnaseq", "load-proposals"],
"scripts/lib/delivery-ops.js": ["verify-bulk-rnaseq", "load-proposals"],
"scripts/lib/delivery.js": ["verify-bulk-rnaseq", "load-proposals"],
"scripts/lib/corpus.js": ["verify-bulk-rnaseq", "load-proposals"],
"scripts/lib/remote.js": ["verify-bulk-rnaseq", "load-proposals"]
```

Add `verify-bulk-rnaseq` and `load-proposals` to any existing entry a new module imports that is not already shared there: `scripts/lib/load-ops.js` (already both), `scripts/lib/dataset-classes.js` (all), `scripts/lib/artifacts.js` (all). Run `yarn sync-shared` and `node --test tests/skill-imports.test.js`; it fails on any import a skill copy cannot resolve. Fix by adding the missing file to that skill's list.

- [ ] **Step 2: verify-bulk-rnaseq SKILL.md** — between Step 2 (Validate) and Step 3 (Review), add:

```markdown
## Step 3: Prepare the delivery

```bash
node scripts/prepare-delivery.js --workspace <root> --against origin/rebuild<RR> <ACCESSION>
```

Ask the data loader for the rebuild branch. This settles the organisms (a stop
is resolved here with `--settle <proposed>=<abbrev>`, never at load) and writes
the whole manual delivery to `<type>-validation/delivery/<ACCESSION>/`:
`final/`, `fromProvider/` (the proposal from master plus the files in
`dataStaging/<ACCESSION>/`), an empty `workspace/` per organism for
preprocessing, and the STF corpus files. It needs `staging` and
`manualDelivery` in the type's `env.json`, and a due date on the ticket's
`Build NN` milestone (it picks the STF release month).

Preprocess in `workspace/`. Re-running replaces everything except
`workspace/`. If the proposal must change (dataset class, props, version),
update it through a proposal PR; once merged, validate and prepare again.
```

Renumber later steps. In Step 4 (Decide), add: "mark-ready also needs the current delivery and posts its record and the rsync on the ticket; it never removes `delivery/`." In Rules add: "Never copy to the server yourself; print the rsync for the data loader."

- [ ] **Step 3: load-proposals SKILL.md** — remove every mention of `--settle` at load, `.curation/delivery/` and the handoff copy; state: "Load settles organisms as the delivery record says and refuses a record for another rebuild branch, an earlier proposal or a settlement that drifted: send it back through prepare-delivery and mark-ready. After the load PR, run the printed STF corpus step once the delivery is on the server." Add `--workspace <root>` to the `clean-proposals` invocation.

- [ ] **Step 4: proposal-workflow.md** — rewrite Phase 2 step 5 to: "Preprocessing (`prepare-delivery.js`) writes the loading artifacts and the proposal archive (`fromProvider/<ACCESSION>/`, the sibling of `final`) to the validation workspace's `delivery/<ACCESSION>/`, settles organisms, and mark-ready records that on the ticket. **The data loading team copies the tree to the server with the posted rsync, fetches or links the reads, and checks the result.** Load renders XML only." Change the Loading artifacts row's last column to "`final/` files and STF corpus files, written at preprocessing". Change the update rule: "Publishing the update returns the ticket to `Proposed` from `Ready to load` or `Needs revision`; at `Preprocessing` it stays there." Run `yarn sync-shared`.

- [ ] **Step 5: Version** — bump `2.3.1` → `2.4.0` everywhere #38 bumped it: `grep -rl '"2.3.1"' package.json .claude-plugin shared/resources skills/*/resources` and edit each (sync covers the skill copies of curator.config.json).

- [ ] **Step 6: Full check** — `yarn sync-shared && yarn test`. Expected: all pass.

- [ ] **Step 7: Commit** — `git add -A && git commit -m "prepare-delivery in the skills and workflow; 2.4.0"`

---

## Self-review notes

- Spec coverage: Decisions → Tasks 1, 10, 12, 13; Workspace/env.json → 4; prepare-delivery checks 1-7 → 10 (status, report, settlement, release, env, staging, clash); delivery.json/handoff → 9; Staging → 5, 6, 10; Dataset types → 6; STF corpus rnaseq/dnaseq → 8 (dnaseq assembly deferred by decision); mark-ready → 11; Load → 12; Build start → 14; Errors (temp-sibling swap) → 9; Testing → each task.
- Deviation from the spec: mark-ready posts the delivery record as its own marked comment, after the verified comment, instead of appending to it; load reads the latest marked comment, as for reports.
- Load prints the corpus step per invocation; `load-proposal.js` loads one accession, so "once per batch" holds per run.
