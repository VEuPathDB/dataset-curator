# Functional Annotation Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `functional-update` dataset type: a curator proposes a tab file of functional annotation (one class) for a released organism; data loaders convert it to the class's loader file at verify; load bumps the existing entry's version (or adds a new entry) and appends a history row to the genome presenter.

**Architecture:** A single-entry type module with no presenter of its own (`amendsPresenters`). Phase 1 writes `curated/update.json` plus one dataset entry and uploads the file to dataStaging. Verify fetches the released GFF, maps IDs, converts through E's shared writers into a work area, and delivers through B's `preprocessedFiles` seam. Load gains a generic, declarative seam: types return edit operations (`appendHistory`, `setEntryVersion`) that `lib/load-edits.js` applies through pure, idempotent appliers.

**Tech Stack:** Node.js 18 ESM, zero dependencies, `node:test`. Spec: `docs/superpowers/specs/2026-11-11-functional-update-design.md`.

**Worktree:** `/home/jbrestel/workspaces/src/dataset-curator-functional-update` (branch `feature/functional-update`). Every path below is relative to it. Every command runs with `--cwd`/`-C` on it; never `cd`.

**Rules for implementers**
- Simple shell only: no `$(...)`, backticks or `;`/`&&` chains. One command per call.
- Use Edit/Write for files. Separate `git add` and `git commit` calls.
- The worktree has no husky hook: before any commit that touches `shared/`, run `yarn --cwd /home/jbrestel/workspaces/src/dataset-curator-functional-update sync-shared` and add the synced `skills/` copies too.
- Targeted tests per task: the task's test file plus `tests/import-graph.test.js`. Full `yarn test` only at the checkpoints (after Tasks 4, 9, 12, and at the end).
- No large committed fixtures: pin outputs as row counts and sha256; build GFF and tab inputs inside tests.
- Comments only where non-obvious, at most 2-3 lines.

---

## Spec deviations

Recorded here instead of silently changing the spec:

1. **`curated/update.json` replaces `curated/history.json`, and `mode` lives there.** `datasets.json` entries are strict (`ENTRY_KEYS` in `_common.js`), so `mode` cannot sit on the entry. `update.json` = `{ schemaVersion, datasetClass, mode, name, previousVersion, history: { functionalAnnotationSource, text } }`. `functionalAnnotationVersion` is not stored: it is the entry's `version`, formatted at load (`Nov 03, 2026`).
2. **No `inputs/<file>.sha256`.** The manifest's `staging: [{ path, sha256 }]` already carries the digest, and `prepare-delivery` checks it when it pulls staging. The raw file is copied into `inputs/` only when at most 1 MiB (skill rule).
3. **Entry `source` is `{ type: "server", paths: ["<staging root>/<id>/<file>"] }`**, an existing source type, not a new `staging` type.
4. **Phase 1 reads the organism file through a new fetch step**, `check-functional-entries.js`, which writes `.curation/tmp/<id>_organism_entries.json` (existing entries of the class, the organism's constants, pending genome proposals naming it). Type `derive*` functions stay pure (inputs and overrides only), as the contract requires. Phase 1 does not query the released-site service; the organism must exist on the rebuild branch, and verify's GFF fetch proves it is released.
5. **`amendsEntries(dir)` is a new optional export** beside `loadEdits` and `amendsPresenters`: the entries a proposal re-versions instead of inserting. Write, build fitness and load use it to require those entries to exist rather than be absent.
6. **`requiredOrganismConstants = { genomeVersion }`.** `geneName` entries reference `$$genomeVersion$$`; requiring it lets entries keep the reference. Every annotated organism file defines it.
7. **The "genome proposal in the same build" refusal** is checked at Phase 1 (`check-functional-entries.js`) and at verify (`gff.json` `pendingGenomes`, reported by the `converted` validator), not at load: content validators at load have no git.
8. **GO aspect** is an optional column. Without it the GAF aspect column is empty and a `goAspectMissing` warning is raised. Settled: `InsertGOAssociationsSimple` never reads the aspect (it uses object id, GO id, evidence, reference, with, data source, NOT), so an empty aspect loads fine; the warning only flags a less complete download file.
9. **`validateProposal` passes `ctx.build`** (the ticket's build when `--against` is given) so build fitness can dry-run `appendHistory`. A missing carried history value is a build-fitness *warning* (load takes `--history`).
10. **Load commit subject for edit loads:** `Load <id>: edit <label>; <label>[, add <entries> to <organisms>]`. Resume parses it and compares the labels.
11. **`appendHistory` inserts after the last history row in document order**, while the carried genome and annotation values come from the row with the highest `buildNumber`. Appliers ignore XML comments (`maskComments`) and parse history dates with the explicit `parseHistoryDate` (`Mon D, YYYY`), not `Date.parse`.
12. **No re-export shim in `classes.js`:** Task 3 does not re-export `fileText` and `uniqueSorted`; `commands/functional.js` and the tests import them from `functional/writers.js`.

13. **`sharedFiles` entries come with the module.** Any new module the registered type imports gets its `sharedFiles` entry (same skills as `dataset-types/index.js`) in the task that creates it, so synced registries never import a missing file.
14. **The pending-genome check refuses any genome proposal on master that names the organism**, stricter than the spec; accepted.
15. **`writeProposal` order changed:** the `update` override refusal comes after `loadDatasetType`, and `writeManifest` runs before `entryIdentityFor` (the type's `deriveUpdate` reads the staged manifest). A bump whose current version is not a date is a `checkCurated` problem, and `CARRIED_CONSTANTS` is derived in `functional-update.js` and passed to `entryProps`.
16. **`stageFile` is hardened** (review of Task 6): rsync copies with `-rt --copy-links --chmod=F644 --ignore-existing` and `--` before the local path; the same sha256 check runs before and after the upload (a missing or different remote file after upload throws); the staging root must already exist (never created) and only the proposal directory is made; proposal id and file name must both be plain names; an ssh failure names the passwordless-ssh requirement; the CLI builds the override JSON with `JSON.stringify` and creates `.curation/tmp` before writing (as does `check-functional-entries.js`).

---

## File structure

| File | Responsibility |
|---|---|
| `shared/scripts/lib/presenter-file.js` (modify) | + `appendHistory`, `HISTORY_CARRIED` |
| `shared/scripts/lib/dataset-file.js` (modify) | + `datasetsOfClass`, `organismFileConstants`, `setEntryVersion` |
| `shared/scripts/lib/load-edits.js` (new) | edit op registry: `editTarget`, `editLabel`, `applyEdits` |
| `shared/scripts/genome/functional/writers.js` (new) | `compare`, `uniqueSorted`, `productRows`, `gafLine`, `fileText` moved from `classes.js` |
| `shared/scripts/dataset-types/functional-update.js` (new) | the type module |
| `shared/scripts/dataset-types/functional-update/update.js` (new) | Phase 1: `deriveUpdate`, `entryProps`, `checkUpdate`, `historyDate` |
| `shared/scripts/dataset-types/functional-update/record.js` (new) | work-area paths, `convert.json` contract, `checkConvertCurrent`, `readConverted` |
| `shared/scripts/dataset-types/functional-update/delivery.js` (new) | `preprocessedFiles` |
| `shared/scripts/dataset-types/functional-update/gff-ids.js` (new) | released-GFF ID index, `levelOfId`, `mapId` |
| `shared/scripts/dataset-types/functional-update/gff-source.js` (new) | released GFF URL and download |
| `shared/scripts/dataset-types/functional-update/converters.js` (new) | per-class converters |
| `shared/scripts/dataset-types/functional-update/commands.js` (new) | `runFetch`, `inferColumns`, `writeColumns`, `runConvert` |
| `shared/scripts/dataset-types/functional-update/validators/{index,converted,update-record}.js` (new) | validators |
| `shared/scripts/lib/staging-upload.js` (new) | `stageFile` (the one remote write) |
| `shared/scripts/check-functional-entries.js`, `stage-file.js`, `functional-update.js` (new) | CLIs |
| `shared/scripts/lib/proposal-ops.js`, `load-ops.js`, `build-fitness.js`, `validation-ops.js`, `dataset-types/_common.js`, `index.js`, `organism-rules.js`, `validators.js`, `load-proposal.js`, `render-proposal.js`, `lib/remote.js` (modify) | lifecycle wiring |
| `skills/propose-functional-update/`, `skills/verify-functional-update/` (new) | skills |
| `tests/load-edits.test.js`, `tests/functional-update*.test.js`, `tests/load-ops-functional-update.test.js`, `tests/staging-upload.test.js` (new) | tests |
| `tests/fixtures/proposals/tfakST1_productNames_20261111/` (new) | small fixture proposal |

---

### Task 0: Worktree setup

**Files:** Modify `package.json`

- [ ] **Step 1: Install dependencies (installs the husky hook in this worktree too)**

Run: `yarn --cwd /home/jbrestel/workspaces/src/dataset-curator-functional-update install`
Expected: completes; `tmp/` exists.

- [ ] **Step 2: Add a single-file test script**

In `package.json` `scripts`, after `"test"`, add:

```json
    "test:one": "node --test --test-global-setup=tests/globalSetup.js"
```

Targeted runs are then: `yarn --cwd /home/jbrestel/workspaces/src/dataset-curator-functional-update test:one tests/<file>.test.js tests/import-graph.test.js`

- [ ] **Step 3: Confirm the suite is green before changing anything**

Run: `yarn --cwd /home/jbrestel/workspaces/src/dataset-curator-functional-update test`
Expected: all pass (record the count).

- [ ] **Step 4: Commit**

```
git -C /home/jbrestel/workspaces/src/dataset-curator-functional-update add package.json
git -C /home/jbrestel/workspaces/src/dataset-curator-functional-update commit -m "test:one script for targeted runs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 1: Appliers `appendHistory` and `setEntryVersion`

**Files:**
- Modify: `shared/scripts/lib/presenter-file.js`
- Modify: `shared/scripts/lib/dataset-file.js`
- Test: `tests/load-edits.test.js` (new)

- [ ] **Step 1: Write the failing tests**

Create `tests/load-edits.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendHistory } from '../shared/scripts/lib/presenter-file.js';
import { setEntryVersion, datasetsOfClass, organismFileConstants } from '../shared/scripts/lib/dataset-file.js';

const PRESENTERS = `<?xml version="1.0"?>
<datasetPresenters>
  <datasetPresenter name="tfakST1_primary_genome_RSRC"
                    >
    <displayName><![CDATA[Genome Sequence and Annotation]]></displayName>
    <history buildNumber="60"
            genomeSource="GenBank" genomeVersion="GCA_1.1"
            annotationSource="GenBank" annotationVersion="Sep 01, 2020"/>
    <history buildNumber="66"
            genomeSource="GenBank" genomeVersion="GCA_1.2"
            annotationSource="GeneDB" annotationVersion="Oct 01, 2022"
            functionalAnnotationSource="VEuPathDB" functionalAnnotationVersion="Oct 06, 2023">functional annotation updated</history>
    <primaryContactId>jane.doe</primaryContactId>
  </datasetPresenter>
  <datasetPresenter name="other_RSRC">
    <history buildNumber="51"/>
  </datasetPresenter>
</datasetPresenters>
`;

const op = (over = {}) => ({
  presenter: 'tfakST1_primary_genome_RSRC', build: '69',
  functional: { source: 'VEuPathDB', version: 'Nov 03, 2026' }, text: 'functional annotation updated', carry: {}, ...over
});

test('appendHistory adds a row after the last one, carrying genome and annotation values from the latest build', () => {
  const out = appendHistory(PRESENTERS, op());
  assert.match(out, /functionalAnnotationVersion="Oct 06, 2023">functional annotation updated<\/history>\n    <history buildNumber="69"\n            genomeSource="GenBank" genomeVersion="GCA_1\.2"\n            annotationSource="GeneDB" annotationVersion="Oct 01, 2022"\n            functionalAnnotationSource="VEuPathDB" functionalAnnotationVersion="Nov 03, 2026">functional annotation updated<\/history>\n    <primaryContactId>/);
});

test('appendHistory is idempotent', () => {
  const once = appendHistory(PRESENTERS, op());
  assert.equal(appendHistory(once, op()), once);
});

test('a second update in the same build only moves the functional version forward', () => {
  const first = appendHistory(PRESENTERS, op());
  const later = appendHistory(first, op({ functional: { source: 'VEuPathDB', version: 'Dec 01, 2026' } }));
  assert.equal(later.split('buildNumber="69"').length - 1, 1);
  assert.match(later, /functionalAnnotationVersion="Dec 01, 2026"/);
  assert.equal(appendHistory(later, op()), later);
});

test('carry overrides the latest row; a value neither gives is refused, naming --history', () => {
  const out = appendHistory(PRESENTERS, op({ carry: { annotationVersion: 'Jan 01, 2026' } }));
  assert.match(out, /annotationSource="GeneDB" annotationVersion="Jan 01, 2026"\n/);
  const bare = PRESENTERS.replace('tfakST1_primary_genome_RSRC', 'x').replace('other_RSRC', 'tfakST1_primary_genome_RSRC');
  assert.throws(() => appendHistory(bare, op()), /has no genomeSource, genomeVersion, annotationSource, annotationVersion; pass --history genomeSource=<value>/);
});

test('appendHistory refuses a missing or duplicated presenter and a non-numeric build', () => {
  assert.throws(() => appendHistory(PRESENTERS, op({ presenter: 'nope_RSRC' })), /no presenter is named nope_RSRC/);
  const twice = PRESENTERS.replace('other_RSRC', 'tfakST1_primary_genome_RSRC');
  assert.throws(() => appendHistory(twice, op()), /2 presenters are named tfakST1_primary_genome_RSRC/);
  assert.throws(() => appendHistory(PRESENTERS, op({ build: 'NN' })), /needs a build number/);
});

test('appendHistory escapes attribute values and keeps CRLF files CRLF', () => {
  const out = appendHistory(PRESENTERS.replace(/\n/g, '\r\n'), op({ functional: { source: 'A&B "x"', version: 'Nov 03, 2026' } }));
  assert.match(out, /functionalAnnotationSource="A&amp;B &quot;x&quot;"/);
  assert.ok(!/[^\r]\n/.test(out));
});

const ORGANISM = `<?xml version="1.0"?>
<datasets>
  <constant name="organismAbbrev" value="tfakST1"/>
  <constant name="functAnnotVersion" value="2020-01-01"/>
  <!-- <constant name="old" value="x"/> -->

  <dataset class="productNames">
    <prop name="name">VEuPathDB</prop>
    <prop name="version">2026-07-22</prop>
    <prop name="projectName">$$projectName$$</prop>
    <prop name="organismAbbrev">$$organismAbbrev$$</prop>
  </dataset>

  <dataset class="productNames">
    <prop name="name">GenBank</prop>
    <prop name="version">$$functAnnotVersion$$</prop>
  </dataset>
</datasets>
`;

const bump = (over = {}) => ({ datasetClass: 'productNames', name: 'VEuPathDB', version: '2026-11-03', ...over });

test('datasetsOfClass and organismFileConstants read the organism file', () => {
  assert.deepEqual(datasetsOfClass(ORGANISM, 'productNames').map((d) => [d.props.name, d.props.version]), [['VEuPathDB', '2026-07-22'], ['GenBank', '$$functAnnotVersion$$']]);
  assert.deepEqual(organismFileConstants(ORGANISM), { organismAbbrev: 'tfakST1', functAnnotVersion: '2020-01-01' });
});

test('setEntryVersion replaces an earlier literal version on the one named entry only', () => {
  const out = setEntryVersion(ORGANISM, bump());
  assert.match(out, /<prop name="name">VEuPathDB<\/prop>\n    <prop name="version">2026-11-03<\/prop>/);
  assert.match(out, /<prop name="version">\$\$functAnnotVersion\$\$<\/prop>/);
  assert.equal(setEntryVersion(out, bump()), out);
});

test('setEntryVersion turns $$functAnnotVersion$$ into the literal', () => {
  assert.match(setEntryVersion(ORGANISM, bump({ name: 'GenBank' })), /<prop name="name">GenBank<\/prop>\n    <prop name="version">2026-11-03<\/prop>/);
});

test('setEntryVersion refuses a later version, a missing entry and a non-date', () => {
  assert.throws(() => setEntryVersion(ORGANISM, bump({ version: '2026-01-01' })), /has version 2026-07-22; only an earlier date or \$\$functAnnotVersion\$\$ is replaced by 2026-01-01/);
  assert.throws(() => setEntryVersion(ORGANISM, bump({ name: 'Nope' })), /no productNames dataset is named Nope/);
  assert.throws(() => setEntryVersion(ORGANISM, bump({ version: 'soon' })), /version must be a date/);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `yarn --cwd /home/jbrestel/workspaces/src/dataset-curator-functional-update test:one tests/load-edits.test.js`
Expected: FAIL, `appendHistory` / `setEntryVersion` not exported.

- [ ] **Step 3: Implement `appendHistory`**

Append to `shared/scripts/lib/presenter-file.js`:

```js
/** The genome and annotation attributes a new history row copies from the presenter's latest row. */
export const HISTORY_CARRIED = ['genomeSource', 'genomeVersion', 'annotationSource', 'annotationVersion'];

const xmlEscape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const attrsOf = (text) => Object.fromEntries([...text.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)].map(([, k, v]) => [k, v]));

function presenterBlock(xml, name) {
  const re = new RegExp(`<datasetPresenter\\s+name\\s*=\\s*"${escapeRegExp(name)}"[\\s\\S]*?</datasetPresenter>`, 'g');
  const found = [...xml.matchAll(re)];
  if (found.length !== 1) throw new Error(found.length ? `${found.length} presenters are named ${name}` : `no presenter is named ${name}`);
  return { start: found[0].index, text: found[0][0] };
}

function indentAt(text, at) {
  const lead = text.slice(text.lastIndexOf('\n', at - 1) + 1, at);
  return /^[ \t]*$/.test(lead) ? lead : '    ';
}

function historyRows(block) {
  return [...block.matchAll(/<history\b([^>]*?)(?:\/>|>[\s\S]*?<\/history>)/g)].map((m) => ({
    index: m.index, end: m.index + m[0].length, raw: m[0], attrs: attrsOf(m[1]), indent: indentAt(block, m.index)
  }));
}

/** Sets an attribute on a row's start tag, adding it before the tag closes when absent. */
function setAttr(raw, key, value) {
  const re = new RegExp(`(\\s${key}\\s*=\\s*")[^"]*(")`);
  if (re.test(raw)) return raw.replace(re, (whole, open, close) => `${open}${xmlEscape(value)}${close}`);
  return raw.replace(/\s*(\/?>)/, (whole, end) => ` ${key}="${xmlEscape(value)}"${end}`);
}

/**
 * Adds a history row for op.build to presenter op.presenter, copying HISTORY_CARRIED from its latest row
 * (op.carry wins); a row already there for the build only moves functionalAnnotationVersion forward.
 * Idempotent. Refuses a missing or repeated presenter and a carried value nothing gives.
 */
export function appendHistory(xml, { presenter, build, functional, text, carry = {} }) {
  if (!/^\d+$/.test(String(build))) throw new Error(`appendHistory needs a build number; got "${build}"`);
  const { start, text: block } = presenterBlock(xml, presenter);
  const rows = historyRows(block);
  const replaceBlock = (next) => xml.slice(0, start) + next + xml.slice(start + block.length);
  const same = rows.filter((r) => r.attrs.buildNumber === String(build));
  if (same.length > 1) throw new Error(`${presenter} has ${same.length} history rows for build ${build}`);
  if (same.length) {
    const [row] = same;
    const had = row.attrs.functionalAnnotationVersion;
    if (had !== undefined) {
      if (Number.isNaN(Date.parse(had))) throw new Error(`${presenter} build ${build} has functionalAnnotationVersion "${had}", which is not a date`);
      if (!(Date.parse(functional.version) > Date.parse(had))) return xml;
    }
    const updated = setAttr(setAttr(row.raw, 'functionalAnnotationSource', functional.source), 'functionalAnnotationVersion', functional.version);
    return replaceBlock(block.slice(0, row.index) + updated + block.slice(row.end));
  }
  const latest = rows.reduce((best, r) => (best === null || Number(r.attrs.buildNumber) > Number(best.attrs.buildNumber) ? r : best), null);
  const values = Object.fromEntries(HISTORY_CARRIED.map((k) => [k, carry[k] ?? latest?.attrs[k] ?? '']));
  const missing = HISTORY_CARRIED.filter((k) => !values[k]);
  if (missing.length) {
    throw new Error(`${presenter}'s latest history row has no ${missing.join(', ')}; pass ${missing.map((k) => `--history ${k}=<value>`).join(' ')}`);
  }
  const nl = xml.includes('\r\n') ? '\r\n' : '\n';
  const last = rows.at(-1);
  const indent = last ? last.indent : '    ';
  const pad = `${indent}        `;
  const a = (k, v) => `${k}="${xmlEscape(v)}"`;
  const row = `<history ${a('buildNumber', build)}${nl}${pad}${a('genomeSource', values.genomeSource)} ${a('genomeVersion', values.genomeVersion)}`
    + `${nl}${pad}${a('annotationSource', values.annotationSource)} ${a('annotationVersion', values.annotationVersion)}`
    + `${nl}${pad}${a('functionalAnnotationSource', functional.source)} ${a('functionalAnnotationVersion', functional.version)}>${xmlEscape(text)}</history>`;
  if (last) return replaceBlock(`${block.slice(0, last.end)}${nl}${indent}${row}${block.slice(last.end)}`);
  const close = block.lastIndexOf('</datasetPresenter>');
  return replaceBlock(`${block.slice(0, close).replace(/[ \t]*$/, '')}${indent}${row}${nl}  ${block.slice(close)}`);
}
```

- [ ] **Step 4: Implement the dataset-file helpers**

Append to `shared/scripts/lib/dataset-file.js`:

```js
const DATASET_BLOCK = /<dataset\s+class="([^"]+)"[^>]*>([\s\S]*?)<\/dataset>/g;
const PROP = /<prop\s+name="([^"]+)">\s*([^<]*?)\s*<\/prop>/g;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const FUNCT_ANNOT_VERSION = '$$functAnnotVersion$$';

/** The organism file's datasets of className as { index, end, text, props }; regex scan, so commented-out datasets count. */
export function datasetsOfClass(fileContent, className) {
  return [...fileContent.matchAll(DATASET_BLOCK)].filter(([, cls]) => cls === className).map((m) => ({
    index: m.index, end: m.index + m[0].length, text: m[0],
    props: Object.fromEntries([...m[2].matchAll(PROP)].map(([, k, v]) => [k, v]))
  }));
}

/** The organism file's top-level <constant> values by name; commented-out ones are skipped. */
export function organismFileConstants(fileContent) {
  const live = fileContent.replace(/<!--[\s\S]*?-->/g, '');
  return Object.fromEntries([...live.matchAll(/<constant\s+name="([^"]+)"\s+value="([^"]*)"\s*\/>/g)].map(([, k, v]) => [k, v]));
}

/**
 * Sets the version of the one dataset of op.datasetClass named op.name. Its current version must be op.version
 * (unchanged), an earlier date, or $$functAnnotVersion$$ (replaced with the literal). Idempotent.
 */
export function setEntryVersion(fileContent, { datasetClass, name, version }) {
  if (!ISO_DATE.test(version)) throw new Error(`version must be a date, YYYY-MM-DD; got "${version}"`);
  const found = datasetsOfClass(fileContent, datasetClass).filter((d) => d.props.name === name);
  if (found.length !== 1) throw new Error(found.length ? `${found.length} ${datasetClass} datasets are named ${name}` : `no ${datasetClass} dataset is named ${name}`);
  const [d] = found;
  const current = d.props.version;
  if (current === undefined) throw new Error(`the ${datasetClass} dataset named ${name} has no version prop`);
  if (current === version) return fileContent;
  if (!(current === FUNCT_ANNOT_VERSION || (ISO_DATE.test(current) && current < version))) {
    throw new Error(`the ${datasetClass} dataset named ${name} has version ${current}; only an earlier date or ${FUNCT_ANNOT_VERSION} is replaced by ${version}`);
  }
  const text = d.text.replace(/(<prop\s+name="version">)\s*[^<]*?\s*(<\/prop>)/, (whole, open, close) => `${open}${version}${close}`);
  return fileContent.slice(0, d.index) + text + fileContent.slice(d.end);
}
```

- [ ] **Step 5: Run the tests**

Run: `yarn --cwd /home/jbrestel/workspaces/src/dataset-curator-functional-update test:one tests/load-edits.test.js tests/presenter-file.test.js tests/dataset-file.test.js tests/import-graph.test.js`
Expected: PASS.

- [ ] **Step 6: Sync and commit**

```
yarn --cwd /home/jbrestel/workspaces/src/dataset-curator-functional-update sync-shared
git -C /home/jbrestel/workspaces/src/dataset-curator-functional-update add shared/scripts/lib/presenter-file.js shared/scripts/lib/dataset-file.js skills tests/load-edits.test.js
git -C /home/jbrestel/workspaces/src/dataset-curator-functional-update commit -m "Appliers: appendHistory and setEntryVersion, pure and idempotent

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `lib/load-edits.js`

**Files:**
- Create: `shared/scripts/lib/load-edits.js`
- Test: `tests/load-edits.test.js` (append)

- [ ] **Step 1: Append the failing tests**

```js
import { applyEdits, editLabel, editTarget } from '../shared/scripts/lib/load-edits.js';

test('editTarget and editLabel name each op', () => {
  const h = { op: 'appendHistory', project: 'FungiDB', presenter: 'tfakST1_primary_genome_RSRC', build: '69', functional: { source: 'VEuPathDB', version: 'Nov 03, 2026' }, text: 't', carry: {} };
  const v = { op: 'setEntryVersion', project: 'FungiDB', organism: 'tfakST1', datasetClass: 'productNames', name: 'VEuPathDB', version: '2026-11-03' };
  assert.equal(editTarget(h), 'Model/lib/xml/datasetPresenters/FungiDB.xml');
  assert.equal(editTarget(v), 'Datasets/lib/xml/datasets/FungiDB/tfakST1.xml');
  assert.equal(editLabel(h), 'history tfakST1_primary_genome_RSRC build 69');
  assert.equal(editLabel(v), 'productNames VEuPathDB version 2026-11-03 in tfakST1');
  assert.throws(() => editLabel({ op: 'dropTable' }), /unknown load edit "dropTable"/);
});

test('applyEdits applies ops in order per file and names the file and op in a refusal', () => {
  const files = { 'Model/lib/xml/datasetPresenters/FungiDB.xml': PRESENTERS, 'Datasets/lib/xml/datasets/FungiDB/tfakST1.xml': ORGANISM };
  const ops = [
    { op: 'appendHistory', project: 'FungiDB', ...op() },
    { op: 'setEntryVersion', project: 'FungiDB', organism: 'tfakST1', ...bump() }
  ];
  const out = applyEdits(ops, (rel) => files[rel]);
  assert.deepEqual(out.map((f) => f.relFile), Object.keys(files));
  assert.match(out[0].content, /buildNumber="69"/);
  assert.match(out[1].content, /2026-11-03/);
  assert.throws(() => applyEdits([{ ...ops[1], name: 'Nope' }], (rel) => files[rel]),
    /^Datasets\/lib\/xml\/datasets\/FungiDB\/tfakST1\.xml: productNames Nope version 2026-11-03 in tfakST1: no productNames dataset is named Nope$/);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `yarn --cwd /home/jbrestel/workspaces/src/dataset-curator-functional-update test:one tests/load-edits.test.js`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

Create `shared/scripts/lib/load-edits.js`:

```js
import { appendHistory, presenterFileRelativePath } from './presenter-file.js';
import { setEntryVersion, datasetFileRelativePath } from './dataset-file.js';

/** Every edit a dataset type's loadEdits may return: the file it changes, how messages name it, and its applier. */
const OPS = {
  appendHistory: {
    target: (op) => presenterFileRelativePath(op.project),
    label: (op) => `history ${op.presenter} build ${op.build}`,
    apply: appendHistory
  },
  setEntryVersion: {
    target: (op) => datasetFileRelativePath(op.project, op.organism),
    label: (op) => `${op.datasetClass} ${op.name} version ${op.version} in ${op.organism}`,
    apply: setEntryVersion
  }
};

function opOf(op) {
  if (!Object.hasOwn(OPS, op?.op)) throw new Error(`unknown load edit ${JSON.stringify(op?.op)}`);
  return OPS[op.op];
}

export const editTarget = (op) => opOf(op).target(op);
export const editLabel = (op) => opOf(op).label(op);

/** Applies ops in order to the files read(relFile) gives, each file read once; returns [{ relFile, content }] in first-touched order. */
export function applyEdits(ops, read) {
  const files = new Map();
  for (const op of ops) {
    const { target, apply } = opOf(op);
    const relFile = target(op);
    const before = files.has(relFile) ? files.get(relFile) : read(relFile);
    try {
      files.set(relFile, apply(before, op));
    } catch (e) {
      throw new Error(`${relFile}: ${editLabel(op)}: ${e.message}`);
    }
  }
  return [...files].map(([relFile, content]) => ({ relFile, content }));
}
```

- [ ] **Step 4: Run the tests**

Run: `yarn --cwd /home/jbrestel/workspaces/src/dataset-curator-functional-update test:one tests/load-edits.test.js tests/import-graph.test.js`
Expected: PASS.

- [ ] **Step 5: Commit** (not synced yet; Task 13 lists it in `sharedFiles`)

```
git -C /home/jbrestel/workspaces/src/dataset-curator-functional-update add shared/scripts/lib/load-edits.js tests/load-edits.test.js
git -C /home/jbrestel/workspaces/src/dataset-curator-functional-update commit -m "load-edits: declarative edit ops for loads

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Extract `genome/functional/writers.js`

**Files:**
- Create: `shared/scripts/genome/functional/writers.js`
- Modify: `shared/scripts/genome/functional/classes.js`
- Test: `tests/genome-functional-writers.test.js` (new); guarded by `tests/genome-functional-classes.test.js`, `tests/genome-functional.test.js`, `tests/genome-golden.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/genome-functional-writers.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileText, gafLine, productRows, uniqueSorted } from '../shared/scripts/genome/functional/writers.js';

test('productRows marks each transcript\'s first product preferred, then sorts', () => {
  const { rows, byTranscript } = productRows([['t2', 'b'], ['t1', 'a'], ['t2', 'a'], ['t2', 'b']]);
  assert.deepEqual(rows, [['t1', 'a', '1'], ['t2', 'a', '0'], ['t2', 'b', '1']]);
  assert.deepEqual([...byTranscript], [['t2', ['b', 'a']], ['t1', ['a']]]);
});

test('gafLine and fileText write a GAF line per row', () => {
  const ctx = { source: 'VEuPathDB', taxonId: '5833', date: '20261103' };
  assert.equal(gafLine(['t1', 'GO:0005524', '', 'IEA', 'F'], ctx).join('\t'),
    'VEuPathDB\tt1\tt1\t\tGO:0005524\t\tIEA\t\tF\t\t\ttranscript\ttaxon:5833\t20261103\tVEuPathDB\t\t');
  assert.equal(fileText({ rows: [['a', 'x']], format: null }, ctx), 'a\tx\n');
  assert.deepEqual(uniqueSorted([['b'], ['a'], ['b']]), [['a'], ['b']]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `yarn --cwd /home/jbrestel/workspaces/src/dataset-curator-functional-update test:one tests/genome-functional-writers.test.js`
Expected: FAIL, module not found.

- [ ] **Step 3: Create `writers.js`, moving code verbatim from `classes.js`**

Create `shared/scripts/genome/functional/writers.js`:

```js
/** Row and file writing shared by GFF extraction (functional) and curator updates (functional-update convert). */

export const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Rows unique per (ID, value), sorted by ID, then value, by code unit, so a rerun writes the same bytes. */
export function uniqueSorted(rows) {
  const unique = new Map(rows.map((row) => [row.join('\t'), row]));
  const keyed = [...unique.values()].map((row) => [row, row.slice(1).join('\t')]);
  return keyed.sort(([a, aRest], [b, bRest]) => compare(a[0], b[0]) || compare(aRest, bRest)).map(([row]) => row);
}

/** [transcriptId, product] pairs in input order: rows with is_preferred 1 for each transcript's first product, and the products per transcript. */
export function productRows(pairs) {
  const byTranscript = new Map();
  for (const [id, product] of pairs) {
    const list = byTranscript.get(id) ?? [];
    if (!list.includes(product)) list.push(product);
    byTranscript.set(id, list);
  }
  const rows = [...byTranscript].flatMap(([id, list]) => list.map((product, i) => [id, product, i === 0 ? '1' : '0']));
  return { rows: uniqueSorted(rows), byTranscript };
}

export function gafLine([id, goId, reference, evidence, aspect], { source, taxonId, date }) {
  return [source, id, id, '', goId, reference, evidence, '', aspect, '', '', 'transcript', `taxon:${taxonId}`, date, source, '', ''];
}

/** A dataset's file: tab-separated lines, no header, LF. */
export function fileText(dataset, ctx) {
  return `${dataset.rows.map((row) => (dataset.format ? dataset.format(row, ctx) : row).join('\t')).join('\n')}\n`;
}
```

In `shared/scripts/genome/functional/classes.js`:
1. Delete the local `compare`, `uniqueSorted`, `gafLine` and `fileText` definitions.
2. Add at the top, after the existing imports:
```js
import { compare, fileText, gafLine, productRows, uniqueSorted } from './writers.js';

export { fileText, uniqueSorted };
```
3. Replace the body of `products(found, ctx, spec)` up to `return {` with:
```js
function products(found, ctx, spec) {
  const { rows, byTranscript } = productRows(found.map(({ id, cols: [product] }) => [id, product]));
  return {
    datasets: [{ name: spec.name(ctx.source), props: {}, rows }],
```
(keep its `findings` array unchanged; it already reads `byTranscript`).

- [ ] **Step 4: Run the writers test and the functional guards**

Run: `yarn --cwd /home/jbrestel/workspaces/src/dataset-curator-functional-update test:one tests/genome-functional-writers.test.js tests/genome-functional-classes.test.js tests/genome-functional.test.js tests/genome-golden.test.js tests/import-graph.test.js`
Expected: PASS (golden may skip without `APICOMMONDATA_DIR`; then also run it once with `APICOMMONDATA_DIR` set if available and note the result).

- [ ] **Step 5: Commit** (add writers.js to sharedFiles for verify-genome now, since classes.js needs it there)

In `package.json` `sharedFiles`, after `"scripts/genome/functional/values.js"`, add:

```json
    "scripts/genome/functional/writers.js": [
      "verify-genome"
    ],
```

```
yarn --cwd /home/jbrestel/workspaces/src/dataset-curator-functional-update sync-shared
git -C /home/jbrestel/workspaces/src/dataset-curator-functional-update add package.json shared/scripts/genome/functional skills tests/genome-functional-writers.test.js
git -C /home/jbrestel/workspaces/src/dataset-curator-functional-update commit -m "functional writers: share row and file writing with curator updates

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Type module skeleton, registry, organism rule, fixture

**Files:**
- Create: `shared/scripts/dataset-types/functional-update.js`
- Create: `shared/scripts/dataset-types/functional-update/update.js`
- Modify: `shared/scripts/dataset-types/index.js`, `shared/scripts/dataset-types/organism-rules.js`
- Create: `tests/fixtures/proposals/tfakST1_productNames_20261111/{manifest.json,curated/datasets.json,curated/update.json,inputs/tfakST1_productNames_20261111_organism_entries.json,inputs/tfakST1_productNames_20261111_staged.json,inputs/products_update.tsv}`
- Test: `tests/functional-update.test.js` (new); modify `tests/proposal-ops.test.js:75`

- [ ] **Step 1: Create the fixture**

`tests/fixtures/proposals/tfakST1_productNames_20261111/inputs/products_update.tsv`:

```
gene_id	product
TFAK_0010	kinase, putative
TFAK_0020	hypothetical protein
```

Run: `sha256sum /home/jbrestel/workspaces/src/dataset-curator-functional-update/tests/fixtures/proposals/tfakST1_productNames_20261111/inputs/products_update.tsv`
Use the hex digest as `<SHA>` below (in two files).

`manifest.json`:

```json
{
  "schemaVersion": 4,
  "accession": "tfakST1_productNames_20261111",
  "datasetType": "functional-update",
  "organisms": [{ "proposedOrganismAbbrev": "tfakST1", "source": "loaded", "project": "FungiDB" }],
  "contacts": { "primary": "jane.doe", "additional": [] },
  "curator": "someone@apidb.org",
  "createdAt": "2026-11-11T12:00:00.000Z",
  "skill": { "name": "propose-functional-update", "version": "4.1.0" },
  "staging": [{ "path": "products_update.tsv", "sha256": "<SHA>" }]
}
```

`curated/datasets.json`:

```json
{
  "schemaVersion": 2,
  "datasets": [
    {
      "datasetClass": "productNames",
      "name": "VEuPathDB",
      "version": "2026-11-03",
      "props": {},
      "source": { "type": "server", "paths": ["/veupathdb/dataStaging/tfakST1_productNames_20261111/products_update.tsv"] }
    }
  ]
}
```

`curated/update.json`:

```json
{
  "schemaVersion": 1,
  "datasetClass": "productNames",
  "mode": "bump",
  "name": "VEuPathDB",
  "previousVersion": "2026-07-22",
  "history": { "functionalAnnotationSource": "VEuPathDB", "text": "functional annotation updated" }
}
```

`inputs/tfakST1_productNames_20261111_organism_entries.json`:

```json
{
  "schemaVersion": 1,
  "organism": "tfakST1",
  "project": "FungiDB",
  "datasetClass": "productNames",
  "checkedAgainst": "origin/rebuild02",
  "constants": { "organismAbbrev": "tfakST1", "projectName": "FungiDB", "genomeVersion": "2020-01-01", "functAnnotVersion": "2020-01-01" },
  "entries": [{ "name": "VEuPathDB", "version": "2026-07-22", "props": {} }],
  "pendingGenomes": []
}
```

`inputs/tfakST1_productNames_20261111_staged.json`:

```json
{
  "schemaVersion": 1,
  "host": "yew",
  "path": "/veupathdb/dataStaging/tfakST1_productNames_20261111/products_update.tsv",
  "file": "products_update.tsv",
  "sha256": "<SHA>",
  "bytes": 66
}
```

(Set `bytes` to the file's real size: `wc -c` on it.)

- [ ] **Step 2: Write the failing test**

Create `tests/functional-update.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import * as fu from '../shared/scripts/dataset-types/functional-update.js';
import { DATASET_TYPES } from '../shared/scripts/dataset-types/index.js';
import { ORGANISM_RULES } from '../shared/scripts/dataset-types/organism-rules.js';
import { assertValidEntries, loadManifest } from '../shared/scripts/dataset-types/_common.js';
import { parseDatasetClass } from '../shared/scripts/lib/dataset-classes.js';
import { fixtures } from './helpers.js';

export const FU = join(fixtures, 'proposals/tfakST1_productNames_20261111');
export const fixtureClassOf = (className) => parseDatasetClass(readFileSync(join(fixtures, 'classes.xml'), 'utf-8'), className);

test('functional-update is registered, single-entry, amends presenters and needs a released organism', () => {
  assert.equal(DATASET_TYPES['functional-update'], fu);
  assert.deepEqual(ORGANISM_RULES['functional-update'], { new: false, max: 1, pending: 'refuse' });
  assert.equal(fu.singleEntry, true);
  assert.equal(fu.amendsPresenters, true);
  assert.deepEqual(fu.datasetClasses, ['productNames', 'GeneOntologyAssociations', 'EnzymeCommissionAssociations', 'geneName', 'comments', 'aliases']);
  assert.equal(fu.validationWorkspace, 'functional-update-validation');
});

test('presenterNames names the organism\'s genome presenter', () => {
  assert.deepEqual(fu.presenterNames(FU), ['tfakST1_primary_genome_RSRC']);
});

test('the fixture\'s entry is valid against the fixture classes', () => {
  const entries = assertValidEntries(FU, loadManifest(FU), fu, { classOf: fixtureClassOf });
  assert.equal(entries[0].name, 'VEuPathDB');
});
```

- [ ] **Step 3: Update the "known types" assertion**

`tests/proposal-ops.test.js:75` expects `known: bulk-rnaseq, chipseq, dnaseq, genome-assembly`. Change it to `known: bulk-rnaseq, chipseq, dnaseq, functional-update, genome-assembly`. Also run:

Run: `grep -rn "genome-assembly'\]\|dnaseq, genome-assembly\|validationWorkspaceNames" /home/jbrestel/workspaces/src/dataset-curator-functional-update/tests`

and update any other test that enumerates every type (add `functional-update` / `functional-update-validation` in sorted position).

- [ ] **Step 4: Run to verify failure**

Run: `yarn --cwd /home/jbrestel/workspaces/src/dataset-curator-functional-update test:one tests/functional-update.test.js`
Expected: FAIL, module not found.

- [ ] **Step 5: Implement the skeleton**

Create `shared/scripts/dataset-types/functional-update/update.js`:

```js
/** Phase 1 records of a functional-update proposal: curated/update.json and the one entry's props. */
export const UPDATE_FILENAME = 'update.json';
export const UPDATE_SCHEMA_VERSION = 1;
export const DEFAULT_HISTORY_TEXT = 'functional annotation updated';
export const MODES = ['bump', 'new'];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 2026-11-03 → "Nov 03, 2026", the form presenter history rows use. */
export function historyDate(isoDate) {
  const [y, m, d] = isoDate.split('-');
  return `${MONTHS[Number(m) - 1]} ${d}, ${y}`;
}
```

Create `shared/scripts/dataset-types/functional-update.js`:

```js
import { loadManifest, readCuratedJson } from './_common.js';
import { organismsOf } from '../lib/manifest.js';
import { UPDATE_FILENAME } from './functional-update/update.js';

export const datasetClasses = ['productNames', 'GeneOntologyAssociations', 'EnzymeCommissionAssociations', 'geneName', 'comments', 'aliases'];
export const validationWorkspace = 'functional-update-validation';
export const singleEntry = true;
/** The proposal adds a history row to the organism's genome presenter instead of rendering its own. */
export const amendsPresenters = true;
export const requiredOrganismConstants = { genomeVersion: /^\S+$/ };
export const injectorDefaults = {};
export const requiredFields = [];
export const requiredInjectorProps = [];
export const UPDATE_RECORD_FILENAME = UPDATE_FILENAME;
export const ownRecordFiles = [UPDATE_FILENAME];

export const presenterNames = (dir) => [`${organismsOf(loadManifest(dir))[0]}_primary_genome_RSRC`];

export const readUpdate = (dir) => readCuratedJson(dir, UPDATE_FILENAME);
```

In `shared/scripts/dataset-types/index.js`: add `import * as functionalUpdate from './functional-update.js';` and add `'functional-update': functionalUpdate` to `DATASET_TYPES`.

In `shared/scripts/dataset-types/organism-rules.js` add to `ORGANISM_RULES`:

```js
  // Updates amend an organism already on the site; a genome still in the queue has nothing to update.
  'functional-update': { new: false, max: 1, pending: 'refuse' }
```

- [ ] **Step 6: Run the tests**

Run: `yarn --cwd /home/jbrestel/workspaces/src/dataset-curator-functional-update test:one tests/functional-update.test.js tests/proposal-ops.test.js tests/manifest.test.js tests/import-graph.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```
git -C /home/jbrestel/workspaces/src/dataset-curator-functional-update add shared/scripts/dataset-types tests/functional-update.test.js tests/proposal-ops.test.js tests/fixtures/proposals/tfakST1_productNames_20261111
git -C /home/jbrestel/workspaces/src/dataset-curator-functional-update commit -m "functional-update: type skeleton, registry, organism rule, fixture

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(Husky runs sync-shared on commit, so the skills' `index.js` copies change here. `sharedFiles` entries for `functional-update.js` and `functional-update/update.js` are added in this task, for the same skills as `dataset-types/index.js`.)

---

### Task 5: Phase 1 derivation, write-proposal wiring, `check-functional-entries.js`

**Files:**
- Modify: `shared/scripts/dataset-types/functional-update/update.js`, `shared/scripts/dataset-types/functional-update.js`
- Modify: `shared/scripts/dataset-types/_common.js` (overrides `update` section; `isAmendedEntry`)
- Modify: `shared/scripts/lib/proposal-ops.js` (`writeProposal`, `entryIdentityFor`, `assertNamesAreFree`)
- Create: `shared/scripts/check-functional-entries.js`
- Test: `tests/functional-update.test.js` (append), `tests/functional-update-write.test.js` (new)

- [ ] **Step 1: Append failing unit tests for the derive functions**

Append to `tests/functional-update.test.js`:

```js
import { cpSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

/** A scratch copy of the fixture with curated/ cleared, and the entries input replaced by entries. */
function phase1Dir({ entries, pendingGenomes = [] } = {}) {
  const dir = join(mkdtempSync(join(tmpdir(), 'fu-')), 'tfakST1_productNames_20261111');
  cpSync(FU, dir, { recursive: true });
  rmSync(join(dir, 'curated'), { recursive: true });
  const input = join(dir, 'inputs', 'tfakST1_productNames_20261111_organism_entries.json');
  const found = JSON.parse(readFileSync(input, 'utf-8'));
  writeFileSync(input, JSON.stringify({ ...found, ...(entries ? { entries } : {}), pendingGenomes }));
  return dir;
}
const SOURCE = { datasetClass: 'productNames', functionalAnnotationSource: 'VEuPathDB' };

test('deriveUpdate bumps the one existing entry by default', () => {
  assert.deepEqual(fu.deriveUpdate(phase1Dir(), SOURCE), {
    schemaVersion: 1, datasetClass: 'productNames', mode: 'bump', name: 'VEuPathDB', previousVersion: '2026-07-22',
    history: { functionalAnnotationSource: 'VEuPathDB', text: 'functional annotation updated' }
  });
});

test('deriveUpdate resolves a $$constant$$ previous version from the organism\'s constants', () => {
  const dir = phase1Dir({ entries: [{ name: 'GenBank', version: '$$functAnnotVersion$$', props: {} }] });
  assert.equal(fu.deriveUpdate(dir, SOURCE).previousVersion, '2020-01-01');
});

test('deriveUpdate needs a name when the organism has several or no entries of the class, and newEntry for an unknown name', () => {
  const two = phase1Dir({ entries: [{ name: 'A', version: '2020-01-01', props: {} }, { name: 'B', version: '2020-01-01', props: {} }] });
  assert.throws(() => fu.deriveUpdate(two, SOURCE), /tfakST1 has 2 productNames entries \(A, B\); set "name" in --overrides/);
  assert.equal(fu.deriveUpdate(two, SOURCE, { name: 'B' }).mode, 'bump');
  assert.throws(() => fu.deriveUpdate(two, SOURCE, { name: 'C' }), /no productNames entry named C \(it has A, B\); set "update": \{ "newEntry": true \}/);
  const made = fu.deriveUpdate(two, { ...SOURCE, newEntry: true }, { name: 'C' });
  assert.deepEqual([made.mode, made.name, made.previousVersion], ['new', 'C', null]);
  assert.throws(() => fu.deriveUpdate(two, { ...SOURCE, newEntry: true }, { name: 'A' }), /A already exists; drop "newEntry" to update it/);
});

test('deriveUpdate refuses no source, an unknown class, another class\'s input and a pending genome', () => {
  assert.throws(() => fu.deriveUpdate(phase1Dir(), { datasetClass: 'productNames' }), /functionalAnnotationSource has no default/);
  assert.throws(() => fu.deriveUpdate(phase1Dir(), { ...SOURCE, datasetClass: 'dbxref_simple' }), /takes productNames, GeneOntologyAssociations/);
  assert.throws(() => fu.deriveUpdate(phase1Dir(), { ...SOURCE, datasetClass: 'geneName' }), /lists productNames entries, not geneName; re-run check-functional-entries\.js/);
  assert.throws(() => fu.deriveUpdate(phase1Dir({ pendingGenomes: ['GCA_9.1'] }), SOURCE), /genome proposal GCA_9\.1 on master names tfakST1/);
});

test('deriveIdentity and deriveDataset give the entry; a bump keeps the existing props, a new entry takes the class defaults', () => {
  const dir = phase1Dir();
  mkdirSync(join(dir, 'curated'));
  writeFileSync(join(dir, 'curated', 'update.json'), JSON.stringify(fu.deriveUpdate(dir, SOURCE)));
  assert.deepEqual(fu.deriveIdentity(dir), { datasetClass: 'productNames', name: 'VEuPathDB', version: undefined });
  assert.deepEqual(fu.deriveDataset(dir, fixtureClassOf('productNames')), {
    schemaVersion: 1, props: {}, source: { type: 'server', paths: ['/veupathdb/dataStaging/tfakST1_productNames_20261111/products_update.tsv'] }
  });
  assert.throws(() => fu.deriveDataset(dir, fixtureClassOf('productNames'), { props: { x: '1' } }), /take no "dataset" overrides/);

  const genes = phase1Dir({ entries: [{ name: 'GenBank', version: '2020-01-01', props: { genomeVersion: '$$genomeVersion$$' } }] });
  const input = join(genes, 'inputs', 'tfakST1_productNames_20261111_organism_entries.json');
  writeFileSync(input, readFileSync(input, 'utf-8').replace('"productNames"', '"geneName"'));
  mkdirSync(join(genes, 'curated'));
  writeFileSync(join(genes, 'curated', 'update.json'), JSON.stringify(fu.deriveUpdate(genes, { ...SOURCE, datasetClass: 'geneName', newEntry: true }, { name: 'VEuPathDB' })));
  assert.deepEqual(fu.deriveDataset(genes, fixtureClassOf('geneName')).props, { genomeVersion: '$$genomeVersion$$' });
});

test('a bump refuses existing props that reference a constant the update cannot carry', () => {
  const dir = phase1Dir({ entries: [{ name: 'VEuPathDB', version: '2026-07-22', props: { x: '$$odd$$' } }] });
  mkdirSync(join(dir, 'curated'));
  writeFileSync(join(dir, 'curated', 'update.json'), JSON.stringify(fu.deriveUpdate(dir, SOURCE)));
  assert.throws(() => fu.deriveDataset(dir, fixtureClassOf('productNames')), /props\.x references \$\$odd\$\$/);
});

test('checkCurated: version after the previous one, staging agrees with the staged upload', () => {
  assert.deepEqual(fu.checkCurated(FU), []);
  const dir = join(mkdtempSync(join(tmpdir(), 'fu-')), 'tfakST1_productNames_20261111');
  cpSync(FU, dir, { recursive: true });
  const datasets = join(dir, 'curated', 'datasets.json');
  writeFileSync(datasets, readFileSync(datasets, 'utf-8').replace('2026-11-03', '2026-07-01'));
  const manifest = join(dir, 'manifest.json');
  writeFileSync(manifest, readFileSync(manifest, 'utf-8').replace('"products_update.tsv"', '"other.tsv"'));
  assert.deepEqual(fu.checkCurated(dir), [
    'version 2026-07-01 must be later than the entry\'s current 2026-07-22',
    'manifest staging must list exactly the staged products_update.tsv with its sha256; re-run stage-file.js and pass its "staging" in --overrides'
  ]);
});
```

Add `mkdirSync` to the `node:fs` import.

- [ ] **Step 2: Run to verify failure**

Run: `yarn --cwd /home/jbrestel/workspaces/src/dataset-curator-functional-update test:one tests/functional-update.test.js`
Expected: FAIL, `deriveUpdate` is not a function.

- [ ] **Step 3: Implement the derivation in `update.js`**

Append to `shared/scripts/dataset-types/functional-update/update.js`:

```js
import { isDate } from '../_common.js';
import { FUNCTIONAL_DEFAULTS } from '../genome-assembly/entries.js';

const CONSTANT_REF = /\$\$(\w+)\$\$/g;
/** Constants an entry may reference: the ones every organism file defines, plus genomeVersion (requiredOrganismConstants). */
export const CARRIED_CONSTANTS = ['projectName', 'organismAbbrev', 'strainAbbrev', 'ncbiTaxonId', 'speciesNcbiTaxonId', 'genomeVersion'];
const IDENTITY = ['projectName', 'organismAbbrev', 'name', 'version'];
const RERUN = 're-run check-functional-entries.js';

export const entriesInputName = (accession) => `${accession}_organism_entries.json`;
export const stagedInputName = (accession) => `${accession}_staged.json`;

const resolved = (value, constants) => value.replace(CONSTANT_REF, (whole, key) => constants[key] ?? whole);

/**
 * curated/update.json from the organism-entries input and the curator's "update" overrides: bump the one existing
 * entry (or the named one), or add a new entry when the curator names a new one and sets newEntry.
 */
export function deriveUpdate({ manifest, found, datasetClasses }, over = {}, { name } = {}) {
  const organism = manifest.organisms[0].proposedOrganismAbbrev;
  const cls = over.datasetClass;
  if (!datasetClasses.includes(cls)) throw new Error(`functional-update takes ${datasetClasses.join(', ')}; set "update": { "datasetClass": ... } in --overrides (got ${JSON.stringify(cls)})`);
  if (found.organism !== organism) throw new Error(`the organism-entries input is for ${found.organism}, not ${organism}; ${RERUN}`);
  if (found.datasetClass !== cls) throw new Error(`the organism-entries input lists ${found.datasetClass} entries, not ${cls}; ${RERUN}`);
  if (found.pendingGenomes?.length) throw new Error(`genome proposal ${found.pendingGenomes.join(', ')} on master names ${organism}; update it after that genome loads`);
  if (typeof over.functionalAnnotationSource !== 'string' || !over.functionalAnnotationSource.trim()) {
    throw new Error('functionalAnnotationSource has no default; ask the curator and set "update": { "functionalAnnotationSource": ... } in --overrides');
  }
  const names = found.entries.map((e) => e.name);
  let chosen = null;
  if (name === undefined) {
    if (over.newEntry) throw new Error('a new entry needs a "name" in --overrides');
    if (found.entries.length !== 1) throw new Error(`${organism} has ${found.entries.length} ${cls} entries (${names.join(', ') || 'none'}); set "name" in --overrides`);
    [chosen] = found.entries;
  } else if (names.includes(name)) {
    if (over.newEntry) throw new Error(`${name} already exists; drop "newEntry" to update it`);
    chosen = found.entries.find((e) => e.name === name);
  } else if (!over.newEntry) {
    throw new Error(`${organism} has no ${cls} entry named ${name} (it has ${names.join(', ') || 'none'}); set "update": { "newEntry": true } to add one`);
  }
  return {
    schemaVersion: UPDATE_SCHEMA_VERSION,
    datasetClass: cls,
    mode: chosen ? 'bump' : 'new',
    name: chosen?.name ?? name,
    previousVersion: chosen ? resolved(chosen.version, found.constants) : null,
    history: { functionalAnnotationSource: over.functionalAnnotationSource.trim(), text: over.text ?? DEFAULT_HISTORY_TEXT }
  };
}

/** The entry's props: a bump keeps the existing entry's (refusing constants it cannot carry), a new entry takes the class defaults. */
export function entryProps(update, found) {
  if (update.mode === 'new') return { ...(FUNCTIONAL_DEFAULTS[update.datasetClass] ?? {}) };
  const existing = found.entries.find((e) => e.name === update.name);
  if (!existing) throw new Error(`the organism-entries input has no ${update.datasetClass} named ${update.name}; ${RERUN}`);
  const props = Object.fromEntries(Object.entries(existing.props).filter(([k]) => !IDENTITY.includes(k)));
  for (const [k, v] of Object.entries(props)) {
    for (const [, ref] of v.matchAll(CONSTANT_REF)) {
      if (!CARRIED_CONSTANTS.includes(ref)) throw new Error(`props.${k} references $$${ref}$$, which a functional update cannot carry; ask the data loaders`);
    }
  }
  return props;
}

/** Agreement problems between update.json, the entry, the manifest's staging and the staged upload. */
export function updateProblems({ update, entry, manifest, staged }) {
  const problems = [];
  if (update?.schemaVersion !== UPDATE_SCHEMA_VERSION) problems.push(`curated/${UPDATE_FILENAME} must be schemaVersion ${UPDATE_SCHEMA_VERSION}`);
  if (!MODES.includes(update?.mode)) problems.push(`curated/${UPDATE_FILENAME} mode must be ${MODES.join(' or ')}`);
  if (!update?.history?.functionalAnnotationSource) problems.push(`curated/${UPDATE_FILENAME} history.functionalAnnotationSource is required`);
  if (!update?.history?.text) problems.push(`curated/${UPDATE_FILENAME} history.text is required`);
  if (entry.datasetClass !== update?.datasetClass || entry.name !== update?.name) {
    problems.push(`the entry is ${entry.datasetClass} ${entry.name}, but curated/${UPDATE_FILENAME} says ${update?.datasetClass} ${update?.name}`);
  }
  if (!isDate(entry.version)) problems.push(`version ${entry.version} must be a date, YYYY-MM-DD`);
  else if (update?.previousVersion && !(entry.version > update.previousVersion)) problems.push(`version ${entry.version} must be later than the entry's current ${update.previousVersion}`);
  const listed = manifest.staging ?? [];
  if (listed.length !== 1 || listed[0].path !== staged.file || listed[0].sha256 !== staged.sha256) {
    problems.push(`manifest staging must list exactly the staged ${staged.file} with its sha256; re-run stage-file.js and pass its "staging" in --overrides`);
  }
  if (entry.source?.type !== 'server' || entry.source.paths?.[0] !== staged.path) problems.push(`the entry's source must be the staged ${staged.path}`);
  return problems;
}
```

- [ ] **Step 4: Wire the type exports**

Replace `shared/scripts/dataset-types/functional-update.js` with:

```js
import { loadManifest, readCuratedJson, readInputJson, onlyEntry, assertCuratedAgreeWith, DATASET_SCHEMA_VERSION } from './_common.js';
import { organismsOf } from '../lib/manifest.js';
import { UPDATE_FILENAME, deriveUpdate as derive, entryProps, updateProblems, entriesInputName, stagedInputName } from './functional-update/update.js';

export const datasetClasses = ['productNames', 'GeneOntologyAssociations', 'EnzymeCommissionAssociations', 'geneName', 'comments', 'aliases'];
export const validationWorkspace = 'functional-update-validation';
export const singleEntry = true;
/** The proposal adds a history row to the organism's genome presenter instead of rendering its own. */
export const amendsPresenters = true;
export const requiredOrganismConstants = { genomeVersion: /^\S+$/ };
export const injectorDefaults = {};
export const requiredFields = [];
export const requiredInjectorProps = [];
export const UPDATE_RECORD_FILENAME = UPDATE_FILENAME;
export const ownRecordFiles = [UPDATE_FILENAME];

export const presenterNames = (dir) => [`${organismsOf(loadManifest(dir))[0]}_primary_genome_RSRC`];
export const readUpdate = (dir) => readCuratedJson(dir, UPDATE_FILENAME);
const found = (dir, m) => readInputJson(dir, entriesInputName(m.accession));
const staged = (dir, m) => readInputJson(dir, stagedInputName(m.accession));

/** Phase 1: curated/update.json. */
export function deriveUpdate(dir, over = {}, { name } = {}) {
  const manifest = loadManifest(dir);
  return derive({ manifest, found: found(dir, manifest), datasetClasses }, over, { name });
}

/** The entry's class and name come from update.json; the version is the curator's curation date (--overrides "version"). */
export function deriveIdentity(dir) {
  const u = readUpdate(dir);
  return { datasetClass: u.datasetClass, name: u.name, version: undefined };
}

export function deriveDataset(dir, classDef, overrides = {}) {
  if (overrides.props !== undefined || overrides.source !== undefined) throw new Error('functional-update entries take no "dataset" overrides; their props come from the organism file');
  const m = loadManifest(dir);
  return { schemaVersion: DATASET_SCHEMA_VERSION, props: entryProps(readUpdate(dir), found(dir, m)), source: { type: 'server', paths: [staged(dir, m).path] } };
}

/** The entries this proposal re-versions rather than inserts: its one entry, in bump mode. */
export function amendsEntries(dir) {
  const u = readUpdate(dir);
  return u.mode === 'bump' ? [{ datasetClass: u.datasetClass, name: u.name }] : [];
}

export function checkCurated(dir) {
  const m = loadManifest(dir);
  return updateProblems({ update: readUpdate(dir), entry: onlyEntry(dir, m), manifest: m, staged: staged(dir, m) });
}
export const assertCuratedAgree = assertCuratedAgreeWith(checkCurated);
```

- [ ] **Step 5: Run the unit tests**

Run: `yarn --cwd /home/jbrestel/workspaces/src/dataset-curator-functional-update test:one tests/functional-update.test.js tests/import-graph.test.js`
Expected: PASS.

- [ ] **Step 6: Write the failing write-proposal integration test**

Create `tests/functional-update-write.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createGit } from '../shared/scripts/lib/git-ops.js';
import { writeProposal } from '../shared/scripts/lib/proposal-ops.js';
import { fixtures, initRepo } from './helpers.js';

const ID = 'tfakST1_productNames_20261111';
const FU = join(fixtures, 'proposals', ID);
const ORGANISM = 'Datasets/lib/xml/datasets/FungiDB/tfakST1.xml';
const PRODUCTS = `  <constant name="genomeVersion" value="2020-01-01"/>

  <dataset class="productNames">
    <prop name="projectName">$$projectName$$</prop>
    <prop name="organismAbbrev">$$organismAbbrev$$</prop>
    <prop name="name">VEuPathDB</prop>
    <prop name="version">2026-07-22</prop>
  </dataset>
</datasets>`;

/** origin/rebuild02 whose tfakST1 has a VEuPathDB productNames entry, the proposal branch checked out, and the Phase 1 inputs in tmp/. */
function setup() {
  const { root, repo } = initRepo('fu-write-');
  const path = join(repo, ORGANISM);
  writeFileSync(path, readFileSync(path, 'utf-8').replace('</datasets>', PRODUCTS));
  execFileSync('git', ['-C', repo, 'commit', '-q', '-am', 'productNames']);
  execFileSync('git', ['-C', repo, 'push', '-q', 'origin', 'master', 'master:rebuild02']);
  execFileSync('git', ['-C', repo, 'checkout', '-q', '-b', `proposal/${ID}`]);
  const tmp = join(root, 'tmp');
  mkdirSync(tmp);
  for (const f of [`${ID}_organism_entries.json`, `${ID}_staged.json`, 'products_update.tsv']) cpSync(join(FU, 'inputs', f), join(tmp, f));
  const manifest = JSON.parse(readFileSync(join(FU, 'manifest.json'), 'utf-8'));
  const overrides = join(tmp, 'overrides.json');
  writeFileSync(overrides, JSON.stringify({ version: '2026-11-03', update: { datasetClass: 'productNames', functionalAnnotationSource: 'VEuPathDB' }, staging: manifest.staging }));
  return { repo, tmp, overrides, inputs: [`${ID}_organism_entries.json`, `${ID}_staged.json`, 'products_update.tsv'].map((f) => join(tmp, f)) };
}

const write = ({ repo, inputs, overrides }) => writeProposal({
  git: createGit(repo), repoPath: repo, rebuildBranch: 'rebuild02', proposalId: ID, curator: 'someone@apidb.org', inputs, curated: [], overrides,
  manifestInput: { accession: ID, datasetType: 'functional-update', project: 'FungiDB', organism: 'tfakST1', contacts: { primary: 'jane.doe', additional: [] }, skill: { name: 'propose-functional-update', version: '4.1.0' } },
  warn: () => {}
});

test('writeProposal writes update.json and the bump entry, and no presenter.json', async () => {
  const s = setup();
  const { dir, presenter } = await write(s);
  assert.equal(presenter, null);
  assert.equal(existsSync(join(dir, 'curated', 'presenter.json')), false);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'curated', 'update.json'), 'utf-8')), JSON.parse(readFileSync(join(FU, 'curated', 'update.json'), 'utf-8')));
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'curated', 'datasets.json'), 'utf-8')), JSON.parse(readFileSync(join(FU, 'curated', 'datasets.json'), 'utf-8')));
});

test('writeProposal refuses a bump whose entry is not on the rebuild branch', async () => {
  const s = setup();
  const input = s.inputs[0];
  writeFileSync(input, readFileSync(input, 'utf-8').replace('"name": "VEuPathDB"', '"name": "Gone"'));
  writeFileSync(s.overrides, readFileSync(s.overrides, 'utf-8').replace('"version"', '"name":"Gone","version"'));
  await assert.rejects(write(s), /tfakST1\.xml on origin\/rebuild02 has no productNames named "Gone" to update; re-run check-functional-entries\.js/);
});

test('writeProposal refuses an "update" override for another type', async () => {
  const { readOverrides } = await import('../shared/scripts/dataset-types/_common.js');
  const s = setup();
  writeFileSync(s.overrides, JSON.stringify({ update: { bogus: 1 } }));
  assert.throws(() => readOverrides(s.overrides), /unknown update keys bogus; allowed: datasetClass, functionalAnnotationSource, newEntry, text/);
});
```

- [ ] **Step 7: Run to verify failure**

Run: `yarn --cwd /home/jbrestel/workspaces/src/dataset-curator-functional-update test:one tests/functional-update-write.test.js`
Expected: FAIL (`unknown keys update`, or derivePresenter not a function).

- [ ] **Step 8: Implement the `_common.js` changes**

In `shared/scripts/dataset-types/_common.js`:

```js
export const OVERRIDE_SECTIONS = ['name', 'version', 'presenter', 'dataset', 'organism', 'annotation', 'staging', 'update'];
const DATASET_OVERRIDE_KEYS = ['props', 'source'];
const UPDATE_OVERRIDE_KEYS = ['datasetClass', 'functionalAnnotationSource', 'newEntry', 'text'];
```

and in `readOverrides`, extend the loop list:

```js
  for (const [section, allowed] of [['presenter', PRESENTER_OVERRIDE_KEYS], ['dataset', DATASET_OVERRIDE_KEYS], ['organism', ORGANISM_OVERRIDE_KEYS], ['update', UPDATE_OVERRIDE_KEYS]]) {
```

Add after `entryNamed`:

```js
/** Whether amended (a type's amendsEntries) names entry: same class and name. */
export const isAmendedEntry = (amended, e) => amended.some((a) => a.datasetClass === e.datasetClass && a.name === e.name);
```

- [ ] **Step 9: Implement the `proposal-ops.js` changes**

1. Import `isAmendedEntry` from `../dataset-types/_common.js` (extend the existing import).
2. `entryIdentityFor`: change the `identity` line to

```js
  const identity = { datasetClass: derived.datasetClass ?? datasetType.datasetClasses[0], name: overrides.name ?? derived.name, version: overrides.version ?? derived.version };
```

3. `assertNamesAreFree(git, rebuildRef, m, entries, type, proposalId, classOf, amended = [])`: replace the inner `for (const { relFile, content } of files)` loop with

```js
    for (const { relFile, content } of files) {
      const exists = entryDatasetExists(content, classDef, e);
      if (isAmendedEntry(amended, e) && !exists) {
        throw new Error(`${relFile} on ${rebuildRef} has no ${entryNamed(e)} to update; re-run check-functional-entries.js`);
      }
      if (!isAmendedEntry(amended, e) && exists) {
        throw new Error(`${relFile} on ${rebuildRef} already has a ${entryNamed(e)}; ${advice}`);
      }
    }
```

4. In `writeProposal`, `derivedNames` gains the type's own records:

```js
  const derivedNames = [PRESENTER_FILENAME, DATASETS_FILENAME, DATASET_FILENAME, ...[datasetType.ORGANISM_RECORD_FILENAME ?? []].flat(), ...(datasetType.derivedCuratedFiles ?? []), ...(datasetType.ownRecordFiles ?? [])];
```

and right after it:

```js
  if (overrideValues.update !== undefined && !datasetType.deriveUpdate) throw new Error(`${manifestInput.datasetType} proposals take no "update" override`);
```

5. Replace lines from `const identity = entryIdentityFor(...)` through `datasetType.normalizeCurated?.(...)` with:

```js
    const full = inManifestOrder(manifest);
    writeManifest(staged, full, { contactIds });
    if (datasetType.deriveUpdate) {
      const update = datasetType.deriveUpdate(staged, overrideValues.update ?? {}, { name: overrideValues.name });
      writeFileSync(join(staged, 'curated', datasetType.UPDATE_RECORD_FILENAME), JSON.stringify(update, null, 2) + '\n');
    }
    const identity = entryIdentityFor(datasetType, staged, full, overrideValues, repoPath);
    // Read before the proposal directory is replaced; a single-entry type re-derives its entry instead.
    const kept = identity ? null : keptFromPreprocessing(git, repoPath, proposalId, full, workingManifest !== undefined);
    datasetType.normalizeCurated?.(staged, overrideValues.dataset);
```

6. Wrap the presenter block:

```js
    let presenter = null;
    if (!datasetType.amendsPresenters) {
      presenter = datasetType.derivePresenter(staged, overrideValues.presenter);
      assertValidPresenter(presenter, { requiredFields: datasetType.requiredFields, requiredInjectorProps: datasetType.requiredInjectorProps },
        `presenter for ${proposalId} (set missing fields under "presenter" in --overrides; injector props go under "presenter": { "injectorProps": { ... } })`);
      writeFileSync(presenterPath(staged), JSON.stringify(presenter, null, 2) + '\n');
    } else if (overrideValues.presenter !== undefined) {
      throw new Error(`${manifestInput.datasetType} proposals have no presenter of their own; drop "presenter" from --overrides`);
    }
```

7. Replace `assertNamesAreFree(git, rebuildRef, full, entries, datasetType, proposalId, classOf);` with:

```js
    if (datasetType.deriveUpdate) datasetType.assertCuratedAgree(staged);
    assertNamesAreFree(git, rebuildRef, full, entries, datasetType, proposalId, classOf, datasetType.amendsEntries?.(staged) ?? []);
```

8. Replace `datasetType.renderPresenter(staged, { build: PREVIEW_BUILD });` with:

```js
    if (!datasetType.amendsPresenters) datasetType.renderPresenter(staged, { build: PREVIEW_BUILD });
```

- [ ] **Step 10: Run the tests**

Run: `yarn --cwd /home/jbrestel/workspaces/src/dataset-curator-functional-update test:one tests/functional-update-write.test.js tests/functional-update.test.js tests/proposal-ops.test.js tests/dataset-types.test.js tests/import-graph.test.js`
Expected: PASS. If the bump-refusal message differs only in how `entryNamed` prints (`productNames named "Gone"`), fix the test's regex to the real message, not the code.

- [ ] **Step 11: Create `check-functional-entries.js`**

Create `shared/scripts/check-functional-entries.js` (mode 755):

```js
#!/usr/bin/env node
/**
 * check-functional-entries.js - Reads an organism's entries of one functional class, its constants, and any genome
 * proposal on master that names it, from origin/<rebuild branch>. Writes
 * .curation/tmp/<proposal>_organism_entries.json for write-proposal.js.
 *
 * Usage: node check-functional-entries.js <proposal> --organism <abbrev> --project <Project> --class <datasetClass> --rebuild-branch rebuildRR
 */
import { parseArgs } from 'node:util';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { openWorkspace } from './lib/config.js';
import { createGit } from './lib/git-ops.js';
import { pendingGenomeProposals } from './lib/organisms.js';
import { datasetFileRelativePath, datasetsOfClass, organismFileConstants } from './lib/dataset-file.js';
import { datasetClasses } from './dataset-types/functional-update.js';

async function main() {
  const { values, positionals: [proposalId] } = parseArgs({
    options: { organism: { type: 'string' }, project: { type: 'string' }, class: { type: 'string' }, 'rebuild-branch': { type: 'string' } },
    allowPositionals: true
  });
  if (!proposalId || !values.organism || !values.project || !values.class || !values['rebuild-branch']) {
    console.error('Usage: node check-functional-entries.js <proposal> --organism <abbrev> --project <Project> --class <datasetClass> --rebuild-branch rebuildRR');
    process.exit(1);
  }
  if (!datasetClasses.includes(values.class)) throw new Error(`--class must be one of ${datasetClasses.join(', ')}`);
  const config = openWorkspace();
  const git = createGit(config.repoPath);
  git.fetch();
  const ref = `origin/${values['rebuild-branch']}`;
  const rel = datasetFileRelativePath(values.project, values.organism);
  if (!git.fileExistsOnRef(ref, rel)) throw new Error(`${rel} is not on ${ref}: ${values.organism} is not a loaded ${values.project} organism`);
  const xml = git.showFile(ref, rel);
  const entries = datasetsOfClass(xml, values.class).map(({ props: { name, version, ...props } }) => ({ name, version, props }));
  const pendingGenomes = pendingGenomeProposals(git, ['origin/master'])
    .filter((g) => g.organism?.proposedOrganismAbbrev === values.organism).map((g) => g.accession);
  const out = {
    schemaVersion: 1, organism: values.organism, project: values.project, datasetClass: values.class, checkedAgainst: ref,
    constants: organismFileConstants(xml), entries, pendingGenomes
  };
  const path = resolve(`.curation/tmp/${proposalId}_organism_entries.json`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(out, null, 2) + '\n');
  console.error(`${values.organism} has ${entries.length} ${values.class} entr${entries.length === 1 ? 'y' : 'ies'}: ${entries.map((e) => `${e.name} ${e.version}`).join(', ') || 'none'}`);
  if (pendingGenomes.length) console.error(`Genome proposal ${pendingGenomes.join(', ')} on master names ${values.organism}: a functional update must wait for it`);
  console.log(path);
}

main().catch((err) => { console.error(`Error: ${err.message}`); process.exit(1); });
```

Run: `chmod +x /home/jbrestel/workspaces/src/dataset-curator-functional-update/shared/scripts/check-functional-entries.js`

- [ ] **Step 12: Checkpoint — full suite**

Run: `yarn --cwd /home/jbrestel/workspaces/src/dataset-curator-functional-update test`
Expected: all pass.

- [ ] **Step 13: Commit**

```
git -C /home/jbrestel/workspaces/src/dataset-curator-functional-update add shared/scripts tests/functional-update.test.js tests/functional-update-write.test.js
git -C /home/jbrestel/workspaces/src/dataset-curator-functional-update commit -m "functional-update Phase 1: update.json, bump or new entry, organism entries input

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Staging upload (`stage-file.js`)

**Files:**
- Modify: `shared/scripts/lib/remote.js` (export `SSH_OPTIONS`)
- Create: `shared/scripts/lib/staging-upload.js`, `shared/scripts/stage-file.js`
- Modify: `shared/resources/curator.config.json`
- Test: `tests/staging-upload.test.js` (new)

- [ ] **Step 1: Write the failing test**

Create `tests/staging-upload.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { stageFile } from '../shared/scripts/lib/staging-upload.js';

/** Local "host": sh runs for real, rsync copies the file into the target directory; every call is recorded. */
function localExec() {
  const calls = [];
  const exec = (cmd, args) => {
    calls.push([cmd, ...args]);
    if (cmd === 'rsync') {
      const [src, dest] = args.slice(-2);
      mkdirSync(dest, { recursive: true });
      copyFileSync(src, join(dest, basename(src)));
      return '';
    }
    return execFileSync(cmd, args, { encoding: 'utf-8' });
  };
  return { exec, calls };
}

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'stage-'));
  const file = join(root, 'products.tsv');
  writeFileSync(file, 'a\tb\n');
  mkdirSync(join(root, 'dataStaging'));
  return { root: join(root, 'dataStaging'), file };
}

test('stageFile copies the file into <root>/<proposal>/ and reports its digest', () => {
  const { root, file } = setup();
  const { exec, calls } = localExec();
  const out = stageFile({ host: null, root, proposalId: 'tfakST1_productNames_20261111', localPath: file, exec });
  assert.equal(readFileSync(join(root, 'tfakST1_productNames_20261111', 'products.tsv'), 'utf-8'), 'a\tb\n');
  assert.equal(out.file, 'products.tsv');
  assert.equal(out.path, join(root, 'tfakST1_productNames_20261111', 'products.tsv'));
  assert.match(out.sha256, /^[0-9a-f]{64}$/);
  assert.equal(out.alreadyStaged, false);
  assert.ok(calls.some((c) => c[0] === 'rsync'));
});

test('stageFile is a no-op for the same file and refuses a different one already there', () => {
  const { root, file } = setup();
  const { exec, calls } = localExec();
  stageFile({ host: null, root, proposalId: 'p1', localPath: file, exec });
  assert.equal(stageFile({ host: null, root, proposalId: 'p1', localPath: file, exec }).alreadyStaged, true);
  writeFileSync(file, 'changed\n');
  const before = calls.length;
  assert.throws(() => stageFile({ host: null, root, proposalId: 'p1', localPath: file, exec }), /already holds products\.tsv with a different sha256/);
  assert.equal(calls.slice(before).some((c) => c[0] === 'rsync'), false);
  assert.equal(readFileSync(join(root, 'p1', 'products.tsv'), 'utf-8'), 'a\tb\n');
});

test('stageFile refuses when the staging root does not exist and does not create it', () => {
  const { root, file } = setup();
  const missing = join(root, 'nope');
  assert.throws(() => stageFile({ host: null, root: missing, proposalId: 'p1', localPath: file, exec: localExec().exec }), /staging root .* does not exist on this machine/);
  assert.equal(existsSync(missing), false);
});

test('stageFile refuses a file name that is not plain', () => {
  const { root } = setup();
  const odd = join(root, 'my file.tsv');
  writeFileSync(odd, 'x\n');
  assert.throws(() => stageFile({ host: null, root, proposalId: 'p1', localPath: odd, exec: localExec().exec }), /plain file name/);
});

test('stageFile over a host runs ssh checks, then rsync with -- and --ignore-existing, then verifies', () => {
  const { root, file } = setup();
  const sha = createHash('sha256').update('a\tb\n').digest('hex');
  const dir = join(root, 'p1');
  const calls = [];
  let uploaded = false;
  const exec = (cmd, args) => {
    calls.push([cmd, ...args]);
    if (cmd === 'rsync') uploaded = true;
    return cmd === 'ssh' && uploaded && args.at(-1).includes('sha256sum') ? `__dataset-curator-present__\n${sha}  ${join(dir, 'products.tsv')}\n` : '';
  };
  const out = stageFile({ host: 'yew', root, proposalId: 'p1', localPath: file, exec });
  assert.equal(out.alreadyStaged, false);
  const sshOpts = ['-o', 'BatchMode=yes', '-o', 'ClearAllForwardings=yes'];
  assert.deepEqual(calls.map((c) => c[0]), ['ssh', 'ssh', 'rsync', 'ssh']);
  assert.deepEqual(calls[0].slice(0, 6), ['ssh', ...sshOpts, 'yew']);
  assert.match(calls[0][6], /\[ -d '.*dataStaging' \]/);
  assert.deepEqual(calls[1].slice(0, 6), ['ssh', ...sshOpts, 'yew']);
  assert.equal(calls[1][6], `mkdir -p '${dir}'`);
  assert.deepEqual(calls[2], ['rsync', '-rt', '--copy-links', '--chmod=F644', '--ignore-existing', '-e', `ssh ${sshOpts.join(' ')}`, '--', file, `yew:${dir}/`]);
});

test('stageFile throws when the file is missing or different after the upload', () => {
  const { root, file } = setup();
  assert.throws(() => stageFile({ host: null, root, proposalId: 'p1', localPath: file, exec: (cmd, args) => (cmd === 'rsync' ? '' : execFileSync(cmd, args, { encoding: 'utf-8' })) }), /lacks products\.tsv after upload/);
  const { exec } = localExec();
  const tampering = (cmd, args) => {
    const out = exec(cmd, args);
    if (cmd === 'rsync') writeFileSync(join(root, 'p2', 'products.tsv'), 'other\n');
    return out;
  };
  assert.throws(() => stageFile({ host: null, root, proposalId: 'p2', localPath: file, exec: tampering }), /after upload, expected/);
});

test('stageFile names the host and the ssh requirement when ssh fails', () => {
  const { root, file } = setup();
  const exec = () => { throw Object.assign(new Error('denied'), { stderr: 'Permission denied' }); };
  assert.throws(() => stageFile({ host: 'yew', root, proposalId: 'p1', localPath: file, exec }), /yew:.*Permission denied; needs passwordless ssh to yew; ask the data loaders/);
});

test('stageFile refuses a proposal id that is not a plain name', () => {
  const { root, file } = setup();
  assert.throws(() => stageFile({ host: null, root, proposalId: '../x', localPath: file, exec: localExec().exec }), /plain directory name/);
  assert.equal(existsSync(join(root, 'x')), false);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `yarn --cwd /home/jbrestel/workspaces/src/dataset-curator-functional-update test:one tests/staging-upload.test.js`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

In `shared/scripts/lib/remote.js` change `const SSH_OPTIONS` to `export const SSH_OPTIONS`.

Create `shared/scripts/lib/staging-upload.js`:

```js
import { basename, join } from 'node:path';
import { statSync } from 'node:fs';
import { defaultExec, failureOutput } from './tools/exec.js';
import { sha256File } from './file-hash.js';
import { PRESENT, SSH_OPTIONS, shellQuote } from './remote.js';

const PLAIN = /^[A-Za-z0-9_.-]+$/;
const plainName = (s) => PLAIN.test(s) && !s.startsWith('.');

/**
 * The curator tool's only remote write: copies localPath into <root>/<proposalId>/ on host (null: this machine).
 * The root must already exist. The same file already there is a no-op; a different file of that name is refused,
 * never overwritten, and the upload is re-checked by sha256 afterwards.
 * Returns { host, path, file, sha256, bytes, alreadyStaged }.
 */
export function stageFile({ host, root, proposalId, localPath, exec = defaultExec }) {
  if (!plainName(proposalId)) throw new Error(`proposal id "${proposalId}" must be a plain directory name`);
  const file = basename(localPath);
  if (!plainName(file)) throw new Error(`file name "${file}" must be a plain file name (letters, digits, _ . -)`);
  const sha256 = sha256File(localPath);
  const bytes = statSync(localPath).size;
  const dir = join(root, proposalId);
  const path = join(dir, file);
  const where = host ? `${host}:${dir}` : dir;
  const run = (script) => {
    try { return host ? exec('ssh', [...SSH_OPTIONS, host, script]) : exec('sh', ['-c', script]); }
    catch (e) {
      const hint = host ? `; needs passwordless ssh to ${host}; ask the data loaders` : '';
      throw new Error(`${where}: ${failureOutput(e)}${hint}`);
    }
  };
  const missingRoot = `staging root ${root} does not exist on ${host ?? 'this machine'}`;
  const remoteSha = () => {
    const out = run(`[ -d ${shellQuote(root)} ] || { echo ${shellQuote(missingRoot)} >&2; exit 3; }; [ -f ${shellQuote(path)} ] || exit 0; echo ${PRESENT}; sha256sum ${shellQuote(path)}`);
    const at = out.indexOf(`${PRESENT}\n`);
    return at < 0 ? null : out.slice(at + PRESENT.length + 1).split(/\s+/)[0];
  };
  const result = { host, path, file, sha256, bytes };
  const there = remoteSha();
  if (there === sha256) return { ...result, alreadyStaged: true };
  if (there !== null) throw new Error(`${where} already holds ${file} with a different sha256 (${there}); ask the data loaders before replacing it`);
  run(`mkdir -p ${shellQuote(dir)}`);
  const ssh = host ? ['-e', `ssh ${SSH_OPTIONS.join(' ')}`] : [];
  try { exec('rsync', ['-rt', '--copy-links', '--chmod=F644', '--ignore-existing', ...ssh, '--', localPath, `${where}/`]); }
  catch (e) { throw new Error(`${where}: ${failureOutput(e)}`); }
  const after = remoteSha();
  if (after !== sha256) throw new Error(`${where} ${after === null ? `lacks ${file}` : `holds ${file} with sha256 ${after}`} after upload, expected ${sha256}; ask the data loaders`);
  return { ...result, alreadyStaged: false };
}
```

Check `failureOutput` and `sha256File` exist with these names:

Run: `grep -n "export" /home/jbrestel/workspaces/src/dataset-curator-functional-update/shared/scripts/lib/tools/exec.js /home/jbrestel/workspaces/src/dataset-curator-functional-update/shared/scripts/lib/file-hash.js`

- [ ] **Step 4: Run the test**

Run: `yarn --cwd /home/jbrestel/workspaces/src/dataset-curator-functional-update test:one tests/staging-upload.test.js tests/remote.test.js tests/import-graph.test.js`
Expected: PASS.

- [ ] **Step 5: Config and CLI**

In `shared/resources/curator.config.json` add a top-level key after `"ticket"`:

```json
  "staging": { "host": "yew", "root": "/veupathdb/dataStaging" }
```

Create `shared/scripts/stage-file.js` (mode 755):

```js
#!/usr/bin/env node
/**
 * stage-file.js - Uploads the curator's file to dataStaging/<proposal>/ on the staging host (curator.config.json "staging"),
 * and writes .curation/tmp/<proposal>_staged.json for write-proposal.js. Prints the "staging" override to pass.
 *
 * Usage: node stage-file.js <proposal> <file>
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { openWorkspace } from './lib/config.js';
import { stageFile } from './lib/staging-upload.js';

function main() {
  const [proposalId, file] = process.argv.slice(2);
  if (!proposalId || !file) { console.error('Usage: node stage-file.js <proposal> <file>'); process.exit(1); }
  const config = openWorkspace();
  const { host, root } = config.staging ?? {};
  if (!host || !root) throw new Error(`${config.configPath} has no "staging": { "host", "root" }`);
  const staged = stageFile({ host, root, proposalId, localPath: resolve(file) });
  const path = resolve(`.curation/tmp/${proposalId}_staged.json`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ schemaVersion: 1, host: staged.host, path: staged.path, file: staged.file, sha256: staged.sha256, bytes: staged.bytes }, null, 2) + '\n');
  console.error(staged.alreadyStaged ? `${staged.file} was already staged at ${host}:${staged.path}` : `Staged ${staged.file} at ${host}:${staged.path}`);
  console.error(`Pass in --overrides: "staging": ${JSON.stringify([{ path: staged.file, sha256: staged.sha256 }])}`);
  console.log(path);
}

try { main(); } catch (err) { console.error(`Error: ${err.message}`); process.exit(1); }
```

Run: `chmod +x /home/jbrestel/workspaces/src/dataset-curator-functional-update/shared/scripts/stage-file.js`

Run: `yarn --cwd /home/jbrestel/workspaces/src/dataset-curator-functional-update test:one tests/config.test.js`
Expected: PASS (if a test pins the shipped config's keys, add `staging`).

- [ ] **Step 6: Commit**

```
yarn --cwd /home/jbrestel/workspaces/src/dataset-curator-functional-update sync-shared
git -C /home/jbrestel/workspaces/src/dataset-curator-functional-update add shared skills tests/staging-upload.test.js
git -C /home/jbrestel/workspaces/src/dataset-curator-functional-update commit -m "stage-file: upload the curator's file to dataStaging

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Released GFF source and ID index

**Files:**
- Create: `shared/scripts/dataset-types/functional-update/gff-source.js`, `gff-ids.js`
- Test: `tests/functional-update-gff.test.js` (new)

- [ ] **Step 1: Write the failing test**

Shared test data goes in a helper module (importing one test file from another would run its tests twice). Create `tests/functional-update-helpers.js`:

```js
const line = (type, attrs, start = 1, end = 90) => ['chr1', 'VEuPathDB', type, start, end, '.', '+', '.', attrs].join('\t');

/** A released-site GFF: a coding gene with two transcripts (one CDS has protein_source_id, one not) and an ncRNA gene. */
export const RELEASED_GFF = [
  '##gff-version 3',
  line('protein_coding_gene', 'ID=TFAK_0010;description=kinase'),
  line('mRNA', 'ID=TFAK_0010.1;Parent=TFAK_0010'),
  line('mRNA', 'ID=TFAK_0010.2;Parent=TFAK_0010'),
  line('exon', 'ID=exon_TFAK_0010.1-E1;Parent=TFAK_0010.1'),
  line('CDS', 'ID=TFAK_0010.1-p1-CDS1;Parent=TFAK_0010.1;protein_source_id=TFAK_0010.1-p1'),
  line('CDS', 'ID=TFAK_0010.2-CDS1;Parent=TFAK_0010.2'),
  line('ncRNA_gene', 'ID=TFAK_0020'),
  line('ncRNA', 'ID=TFAK_0020.1;Parent=TFAK_0020'),
  ''
].join('\n');
```

Create `tests/functional-update-gff.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gffDirectoryUrl, pickGff, releaseOf, fetchReleasedGff } from '../shared/scripts/dataset-types/functional-update/gff-source.js';
import { idIndex, levelOfId, mapId } from '../shared/scripts/dataset-types/functional-update/gff-ids.js';
import { RELEASED_GFF } from './functional-update-helpers.js';

test('gffDirectoryUrl, pickGff and releaseOf find the one release GFF', () => {
  assert.equal(gffDirectoryUrl('FungiDB', 'TfakeusST1'), 'https://fungidb.org/common/downloads/Current_Release/TfakeusST1/gff/data/');
  assert.equal(pickGff('<a href="FungiDB-68_TfakeusST1.gff">x</a><a href="../">up</a>', 'u'), 'FungiDB-68_TfakeusST1.gff');
  assert.throws(() => pickGff('<a href="a.gff"></a><a href="b.gff"></a>', 'u'), /u lists 2 \.gff files \(a\.gff, b\.gff\); expected one/);
  assert.equal(releaseOf('FungiDB-68_TfakeusST1.gff'), '68');
});

test('fetchReleasedGff lists the directory, then downloads the file', async () => {
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url);
    return { ok: true, status: 200, text: async () => (url.endsWith('/') ? '<a href="FungiDB-68_TfakeusST1.gff">' : RELEASED_GFF) };
  };
  const got = await fetchReleasedGff({ project: 'FungiDB', nameForFiles: 'TfakeusST1', fetchImpl });
  assert.equal(got.url, 'https://fungidb.org/common/downloads/Current_Release/TfakeusST1/gff/data/FungiDB-68_TfakeusST1.gff');
  assert.equal(got.release, '68');
  assert.equal(got.text, RELEASED_GFF);
  assert.equal(seen.length, 2);
  await assert.rejects(fetchReleasedGff({ project: 'FungiDB', nameForFiles: 'X', fetchImpl: async () => ({ ok: false, status: 404 }) }), /HTTP 404/);
});

test('idIndex maps genes, transcripts and proteins; protein IDs use protein_source_id, else <transcript>-p1', () => {
  const index = idIndex(RELEASED_GFF);
  assert.equal(levelOfId(index, 'TFAK_0010'), 'gene');
  assert.equal(levelOfId(index, 'TFAK_0010.2'), 'transcript');
  assert.equal(levelOfId(index, 'TFAK_0010.1-p1'), 'protein');
  assert.equal(levelOfId(index, 'TFAK_0010.2-p1'), 'protein');
  assert.equal(levelOfId(index, 'nope'), null);
  assert.deepEqual(mapId(index, 'TFAK_0010', 'gene', 'transcript'), ['TFAK_0010.1', 'TFAK_0010.2']);
  assert.deepEqual(mapId(index, 'TFAK_0010', 'gene', 'protein'), ['TFAK_0010.1-p1', 'TFAK_0010.2-p1']);
  assert.deepEqual(mapId(index, 'TFAK_0010.1-p1', 'protein', 'gene'), ['TFAK_0010']);
  assert.deepEqual(mapId(index, 'TFAK_0020', 'gene', 'protein'), []);
});

test('idIndex ignores an embedded FASTA section', () => {
  const index = idIndex(`${RELEASED_GFF}##FASTA\n>chr1\nACGT\n`);
  assert.equal(levelOfId(index, 'TFAK_0020.1'), 'transcript');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `yarn --cwd /home/jbrestel/workspaces/src/dataset-curator-functional-update test:one tests/functional-update-gff.test.js`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

Create `shared/scripts/dataset-types/functional-update/gff-source.js`:

```js
/** The released site's GFF for an organism: Current_Release/<organismNameForFiles>/gff/data/ on its project site. */
export const gffDirectoryUrl = (project, nameForFiles) => `https://${project.toLowerCase()}.org/common/downloads/Current_Release/${nameForFiles}/gff/data/`;

export function pickGff(html, dirUrl) {
  const names = [...new Set([...html.matchAll(/href="([^"/?#]+\.gff)"/g)].map((m) => m[1]))];
  if (names.length !== 1) throw new Error(`${dirUrl} lists ${names.length} .gff files (${names.join(', ') || 'none'}); expected one`);
  return names[0];
}

/** PlasmoDB-68_Pfalciparum3D7.gff → "68". */
export const releaseOf = (file) => /-(\d+)_/.exec(file)?.[1] ?? null;

export async function fetchReleasedGff({ project, nameForFiles, fetchImpl = fetch }) {
  const dir = gffDirectoryUrl(project, nameForFiles);
  const text = async (url) => {
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return res.text();
  };
  const file = pickGff(await text(dir), dir);
  return { url: `${dir}${file}`, file, release: releaseOf(file), text: await text(`${dir}${file}`) };
}
```

Create `shared/scripts/dataset-types/functional-update/gff-ids.js`:

```js
import { features, getAttr, idOf, parentsOf, parseGff } from '../../genome/gff.js';
import { GENE_TYPES } from '../../genome/feature-types.js';

export const LEVELS = ['gene', 'transcript', 'protein'];
const PARTS = new Set(['exon', 'CDS', 'five_prime_UTR', 'three_prime_UTR', 'intron', 'start_codon', 'stop_codon', 'polypeptide']);

/** Gene, transcript and protein IDs of a released GFF: transcripts are a gene's direct non-part children; proteins come from their CDSs. */
export function idIndex(text) {
  const fasta = text.indexOf('\n##FASTA');
  const all = features(parseGff(fasta < 0 ? text : text.slice(0, fasta + 1)));
  const genes = new Set(all.filter((f) => GENE_TYPES.has(f.type) && idOf(f)).map(idOf));
  const geneOf = new Map();
  const transcriptsOf = new Map();
  for (const f of all) {
    const id = idOf(f);
    if (!id || PARTS.has(f.type) || genes.has(id) || geneOf.has(id)) continue;
    const gene = parentsOf(f).find((p) => genes.has(p));
    if (!gene) continue;
    geneOf.set(id, gene);
    transcriptsOf.set(gene, [...(transcriptsOf.get(gene) ?? []), id]);
  }
  const proteinOf = new Map();
  const transcriptOf = new Map();
  for (const f of all.filter((x) => x.type === 'CDS')) {
    for (const t of parentsOf(f).filter((p) => geneOf.has(p) && !proteinOf.has(p))) {
      const protein = getAttr(f, 'protein_source_id') ?? `${t}-p1`;
      proteinOf.set(t, protein);
      transcriptOf.set(protein, t);
    }
  }
  return { genes, geneOf, transcriptsOf, proteinOf, transcriptOf };
}

export function levelOfId(index, id) {
  if (index.genes.has(id)) return 'gene';
  if (index.geneOf.has(id)) return 'transcript';
  if (index.transcriptOf.has(id)) return 'protein';
  return null;
}

/** The IDs at level `to` that id (at level `from`) stands for; [] when it has none. */
export function mapId(index, id, from, to) {
  if (from === to) return [id];
  const transcripts = from === 'gene' ? index.transcriptsOf.get(id) ?? []
    : from === 'transcript' ? [id] : [index.transcriptOf.get(id)].filter(Boolean);
  if (to === 'transcript') return transcripts;
  if (to === 'gene') return [...new Set(transcripts.map((t) => index.geneOf.get(t)))];
  return transcripts.map((t) => index.proteinOf.get(t)).filter(Boolean);
}
```

- [ ] **Step 4: Run the tests**

Run: `yarn --cwd /home/jbrestel/workspaces/src/dataset-curator-functional-update test:one tests/functional-update-gff.test.js tests/import-graph.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git -C /home/jbrestel/workspaces/src/dataset-curator-functional-update add shared/scripts/dataset-types/functional-update tests/functional-update-gff.test.js tests/functional-update-helpers.js
git -C /home/jbrestel/workspaces/src/dataset-curator-functional-update commit -m "functional-update: released GFF source and ID index

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Converters

**Files:**
- Create: `shared/scripts/dataset-types/functional-update/converters.js`
- Test: `tests/functional-update-convert.test.js` (new)

- [ ] **Step 1: Write the failing tests**

Create `tests/functional-update-convert.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { convert, columnsProblems, CONVERTERS } from '../shared/scripts/dataset-types/functional-update/converters.js';
import { idIndex } from '../shared/scripts/dataset-types/functional-update/gff-ids.js';
import { RELEASED_GFF } from './functional-update-helpers.js';

const index = idIndex(RELEASED_GFF);
const run = (datasetClass, text, columns) => convert({ datasetClass, name: 'VEuPathDB', version: '2026-11-03', text, columns, index, taxonId: '999001' });
const sha = (s) => createHash('sha256').update(s).digest('hex');
const checks = (r) => r.findings.map((f) => [f.severity, f.check, f.count]);

test('every v1 class has a converter', () => {
  assert.deepEqual(Object.keys(CONVERTERS), ['productNames', 'GeneOntologyAssociations', 'EnzymeCommissionAssociations', 'geneName', 'comments', 'aliases']);
});

test('productNames maps gene IDs to every transcript, first product preferred', () => {
  const r = run('productNames', 'gene\tproduct\nTFAK_0010\tkinase\nTFAK_0010\tputative kinase\nTFAK_0020\tncRNA\n', { header: true, id: { column: 1, level: 'gene' }, values: { product: 2 } });
  assert.equal(r.file, 'products.txt');
  assert.equal(r.text, 'TFAK_0010.1\tkinase\t1\nTFAK_0010.1\tputative kinase\t0\nTFAK_0010.2\tkinase\t1\nTFAK_0010.2\tputative kinase\t0\nTFAK_0020.1\tncRNA\t1\n');
  assert.deepEqual(r.ids, { level: 'transcript', count: 3 });
  assert.deepEqual(checks(r), []);
});

test('productNames honours a preferred column', () => {
  const r = run('productNames', 'TFAK_0010.1\ta\t0\nTFAK_0010.1\tb\ttrue\n', { header: false, id: { column: 1, level: 'transcript' }, values: { product: 2, preferred: 3 } });
  assert.equal(r.text, 'TFAK_0010.1\ta\t0\nTFAK_0010.1\tb\t1\n');
});

test('unmatched IDs are an error under 100 rows; blank values are skipped with a warning', () => {
  const r = run('productNames', 'TFAK_0010\tk\nNOPE\tx\nTFAK_0020\t\n', { header: false, id: { column: 1, level: 'gene' }, values: { product: 2 } });
  assert.deepEqual(checks(r), [['error', 'unmatchedIds', 1], ['warning', 'emptyValue', 1]]);
  assert.deepEqual(r.findings[0].sample, ['NOPE']);
});

test('GO writes GAF lines, normalizing IDs, defaulting evidence, and warning without an aspect', () => {
  const r = run('GeneOntologyAssociations', 'TFAK_0010.1\t5524\tIDA\nTFAK_0010.1\tGO:0006468\t\nTFAK_0010.1\tGO:bad\tIEA\n', { header: false, id: { column: 1, level: 'transcript' }, values: { goId: 2, evidence: 3 } });
  assert.equal(r.file, 'associations.gas');
  assert.equal(r.text.split('\n')[0], 'VEuPathDB\tTFAK_0010.1\tTFAK_0010.1\t\tGO:0005524\t\tIDA\t\t\t\t\ttranscript\ttaxon:999001\t20261103\tVEuPathDB\t\t');
  assert.deepEqual(checks(r), [['warning', 'badGo', 1], ['warning', 'goAspectMissing', 2]]);
});

test('EC maps to proteins and skips bad numbers', () => {
  const r = run('EnzymeCommissionAssociations', 'TFAK_0010\t2.7.11.1\nTFAK_0010\t2.7\n', { header: false, id: { column: 1, level: 'gene' }, values: { ec: 2 } });
  assert.equal(r.text, 'TFAK_0010.1-p1\t2.7.11.1\nTFAK_0010.2-p1\t2.7.11.1\n');
  assert.deepEqual(checks(r), [['warning', 'badEc', 1]]);
});

test('geneName keeps one name per gene, the first, warning on conflicts', () => {
  const r = run('geneName', 'TFAK_0010.1\ttfkA\nTFAK_0010\ttfkB\n', { header: false, id: { column: 1, level: 'transcript' }, values: { name: 2 } });
  assert.equal(r.text, 'TFAK_0010\ttfkA\n');
  assert.deepEqual(checks(r), [['warning', 'geneNameConflict', 1]]);
});

test('comments stay at the ID column\'s level; aliases go to transcripts', () => {
  assert.equal(run('comments', 'TFAK_0010\tnote\n', { header: false, id: { column: 1, level: 'gene' }, values: { comment: 2 } }).text, 'TFAK_0010\tnote\n');
  assert.equal(run('aliases', 'TFAK_0020\tX1\n', { header: false, id: { column: 1, level: 'gene' }, values: { alias: 2 } }).text, 'TFAK_0020.1\tX1\n');
});

test('no rows is an error; output is byte-stable', () => {
  const r = run('aliases', 'NOPE\tX\n', { header: false, id: { column: 1, level: 'gene' }, values: { alias: 2 } });
  assert.ok(checks(r).some(([s, c]) => s === 'error' && c === 'noRows'));
  const a = run('productNames', 'TFAK_0020\tz\nTFAK_0010\ta\n', { header: false, id: { column: 1, level: 'gene' }, values: { product: 2 } });
  assert.equal(sha(a.text), sha(run('productNames', 'TFAK_0010\ta\nTFAK_0020\tz\n', { header: false, id: { column: 1, level: 'gene' }, values: { product: 2 } }).text));
});

test('columnsProblems names missing value columns, bad numbers and levels', () => {
  assert.deepEqual(columnsProblems('productNames', { header: false, id: { column: 1, level: 'gene' }, values: { product: 2 } }), []);
  assert.deepEqual(columnsProblems('GeneOntologyAssociations', { header: false, id: { column: 0, level: 'exon' }, values: { x: 2 } }), [
    'id.column must be a column number from 1',
    'id.level must be gene, transcript or protein',
    'values.goId is required for GeneOntologyAssociations',
    'values.x is not a column GeneOntologyAssociations reads (goId, aspect, evidence, reference)'
  ]);
  assert.deepEqual(columnsProblems('comments', { header: false, id: { column: 1, level: 'protein' }, values: { comment: 2 } }), ['comments are loaded for gene or transcript IDs, not protein']);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `yarn --cwd /home/jbrestel/workspaces/src/dataset-curator-functional-update test:one tests/functional-update-convert.test.js`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

Create `shared/scripts/dataset-types/functional-update/converters.js`:

```js
import { fileText, gafLine, productRows, uniqueSorted } from '../../genome/functional/writers.js';
import { isEc } from '../../genome/functional/values.js';
import { LEVELS, levelOfId, mapId } from './gff-ids.js';

const SAMPLE = 20;
/** Same shape as genome/checks.js finding, without importing the genome pipeline's checks. */
const finding = (check, severity, ids, message) => ({ group: 'convert', check, severity, count: ids.length, sample: ids.slice(0, SAMPLE), message });

const GO_ID = /^(?:GO:)?(\d{1,7})$/;
const EVIDENCE = /^[A-Z]{2,3}$/;
const ASPECTS = { F: 'F', P: 'P', C: 'C', molecular_function: 'F', biological_process: 'P', cellular_component: 'C', function: 'F', process: 'P', component: 'C' };
const PREFERRED = /^(1|true|yes|y)$/i;

/** Per class: the ID level it loads at (null: the ID column's own level), its file, required and optional value columns. */
export const CONVERTERS = Object.freeze({
  productNames: { level: 'transcript', file: 'products.txt', values: ['product'], optional: ['preferred'] },
  GeneOntologyAssociations: { level: 'transcript', file: 'associations.gas', values: ['goId'], optional: ['aspect', 'evidence', 'reference'] },
  EnzymeCommissionAssociations: { level: 'protein', file: 'ec.txt', values: ['ec'], optional: [] },
  geneName: { level: 'gene', file: 'geneName.txt', values: ['name'], optional: [] },
  comments: { level: null, file: 'comments.txt', values: ['comment'], optional: [] },
  aliases: { level: 'transcript', file: 'aliases.txt', values: ['alias'], optional: [] }
});

export function readTab(text) {
  return text.split(/\r?\n/).filter((l) => l.trim() !== '' && !l.startsWith('#')).map((l) => l.split('\t').map((c) => c.trim()));
}

const isColumn = (n) => Number.isInteger(n) && n >= 1;

export function columnsProblems(datasetClass, columns) {
  const spec = CONVERTERS[datasetClass];
  if (!spec) return [`no converter for ${datasetClass}`];
  const problems = [];
  if (!isColumn(columns?.id?.column)) problems.push('id.column must be a column number from 1');
  if (!LEVELS.includes(columns?.id?.level)) problems.push('id.level must be gene, transcript or protein');
  const values = columns?.values ?? {};
  const known = [...spec.values, ...spec.optional];
  for (const k of spec.values) if (values[k] === undefined) problems.push(`values.${k} is required for ${datasetClass}`);
  for (const [k, n] of Object.entries(values)) {
    if (!known.includes(k)) problems.push(`values.${k} is not a column ${datasetClass} reads (${known.join(', ')})`);
    else if (!isColumn(n)) problems.push(`values.${k} must be a column number from 1`);
  }
  if (datasetClass === 'comments' && columns?.id?.level === 'protein') problems.push('comments are loaded for gene or transcript IDs, not protein');
  return problems;
}

const BUILD = {
  productNames(records) {
    if (records.every((r) => r.values.preferred === undefined)) return { rows: productRows(records.map((r) => [r.id, r.values.product])).rows, findings: [] };
    return { rows: uniqueSorted(records.map((r) => [r.id, r.values.product, PREFERRED.test(r.values.preferred ?? '') ? '1' : '0'])), findings: [] };
  },
  GeneOntologyAssociations(records) {
    const bad = [];
    const noAspect = [];
    const rows = [];
    for (const { id, values } of records) {
      const go = GO_ID.exec(values.goId);
      const evidence = values.evidence || 'IEA';
      if (!go || !EVIDENCE.test(evidence)) { bad.push(`${id}: ${values.goId} ${evidence}`); continue; }
      const aspect = ASPECTS[values.aspect ?? ''] ?? '';
      if (!aspect) noAspect.push(id);
      rows.push([id, `GO:${go[1].padStart(7, '0')}`, values.reference ?? '', evidence, aspect]);
    }
    return {
      rows: uniqueSorted(rows),
      findings: [
        finding('badGo', 'warning', bad, 'rows whose GO id or evidence code is not valid; they are skipped'),
        finding('goAspectMissing', 'warning', noAspect, 'associations with no aspect (F, P or C); the GAF aspect column is empty')
      ]
    };
  },
  EnzymeCommissionAssociations(records) {
    const bad = records.filter((r) => !isEc(r.values.ec)).map((r) => `${r.id}: ${r.values.ec}`);
    return { rows: uniqueSorted(records.filter((r) => isEc(r.values.ec)).map((r) => [r.id, r.values.ec])), findings: [finding('badEc', 'warning', bad, 'EC numbers that are not four dot-separated numbers or -; they are skipped')] };
  },
  geneName(records) {
    const byGene = new Map();
    for (const { id, values } of records) byGene.set(id, [...new Set([...(byGene.get(id) ?? []), values.name])]);
    const conflicts = [...byGene].filter(([, names]) => names.length > 1).map(([id]) => id);
    return {
      rows: uniqueSorted([...byGene].map(([id, names]) => [id, names[0]])),
      findings: [finding('geneNameConflict', 'warning', conflicts, 'genes given more than one name; the first in file order is kept')]
    };
  },
  comments: (records) => ({ rows: uniqueSorted(records.map((r) => [r.id, r.values.comment])), findings: [] }),
  aliases: (records) => ({ rows: uniqueSorted(records.map((r) => [r.id, r.values.alias])), findings: [] })
};

/**
 * The curator's tab text as the class's loader file. Each row's ID must be at columns.id.level in the released GFF;
 * it is mapped to the class's level. Returns { file, text, rows, ids: { level, count }, findings }.
 */
export function convert({ datasetClass, name, version, text, columns, index, taxonId }) {
  const spec = CONVERTERS[datasetClass];
  const lines = readTab(text).slice(columns.header ? 1 : 0);
  const at = (row, n) => (n ? row[n - 1] ?? '' : undefined);
  const level = spec.level ?? columns.id.level;
  const unmatched = [];
  const empty = [];
  const records = [];
  for (const row of lines) {
    const id = at(row, columns.id.column);
    const values = Object.fromEntries(Object.entries(columns.values).map(([k, n]) => [k, at(row, n)]));
    if (spec.values.some((k) => !values[k])) { empty.push(id || '(no id)'); continue; }
    const targets = levelOfId(index, id) === columns.id.level ? mapId(index, id, columns.id.level, level) : [];
    if (!targets.length) { unmatched.push(id); continue; }
    for (const target of targets) records.push({ id: target, values });
  }
  const made = BUILD[datasetClass](records);
  const inputIds = new Set(lines.map((row) => at(row, columns.id.column))).size;
  const missed = [...new Set(unmatched)];
  const tooMany = inputIds < 100 ? missed.length > 0 : missed.length > inputIds / 100;
  const ctx = { source: name, taxonId, date: version.replace(/-/g, '') };
  const findings = [
    finding('unmatchedIds', tooMany ? 'error' : 'warning', missed, `IDs not found at ${columns.id.level} level in the released GFF (or with nothing at ${level} level)`),
    finding('emptyValue', 'warning', empty, 'rows with an empty required value; they are skipped'),
    ...made.findings,
    finding('noRows', 'error', made.rows.length ? [] : [datasetClass], 'nothing to load')
  ].filter((f) => f.count);
  const format = datasetClass === 'GeneOntologyAssociations' ? gafLine : null;
  return {
    file: spec.file,
    text: made.rows.length ? fileText({ rows: made.rows, format }, ctx) : '',
    rows: made.rows.length,
    ids: { level, count: new Set(made.rows.map((r) => r[0])).size },
    findings
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `yarn --cwd /home/jbrestel/workspaces/src/dataset-curator-functional-update test:one tests/functional-update-convert.test.js tests/import-graph.test.js`
Expected: PASS. If a finding order differs, fix the order in `convert` to match the test (unmatched, empty, class findings, noRows); the test is the contract.

- [ ] **Step 5: Commit**

```
git -C /home/jbrestel/workspaces/src/dataset-curator-functional-update add shared/scripts/dataset-types/functional-update/converters.js tests/functional-update-convert.test.js
git -C /home/jbrestel/workspaces/src/dataset-curator-functional-update commit -m "functional-update: per-class converters through the shared writers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Work area: fetch, columns, convert, `convert.json`, CLI

**Files:**
- Create: `shared/scripts/dataset-types/functional-update/record.js`, `commands.js`
- Create: `shared/scripts/functional-update.js` (CLI)
- Test: `tests/functional-update-work-area.test.js` (new)

Work area layout (`<root>/functional-update-validation/proposals/<id>/preprocess/`):
`gff.json`, `gff/<release file>.gff`, `input/<curator file>`, `columns.json`, `final/<loader file>`, `convert.json`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/functional-update-helpers.js` (add the imports at its top):

```js
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { runFetch, inferColumns, writeColumns, runConvert } from '../shared/scripts/dataset-types/functional-update/commands.js';
import { workFiles } from '../shared/scripts/dataset-types/functional-update/record.js';

export const INPUT = 'gene_id\tproduct\nTFAK_0010\tkinase\nTFAK_0020\tncRNA\n';
export const sha = (s) => createHash('sha256').update(s).digest('hex');
/** The fixture proposal's entry. */
export const ENTRY = { datasetClass: 'productNames', name: 'VEuPathDB', version: '2026-11-03' };

/** A fetched work area: the staged file pulled by a local "remote", the GFF from a stub fetch. */
export async function fetched() {
  const root = mkdtempSync(join(tmpdir(), 'fu-work-'));
  const staging = join(root, 'staging', 'p1');
  mkdirSync(staging, { recursive: true });
  writeFileSync(join(staging, 'products.tsv'), INPUT);
  const workArea = join(root, 'preprocess');
  const remote = { pull: (path, dest, { files }) => { mkdirSync(dest, { recursive: true }); for (const f of files) writeFileSync(join(dest, f), readFileSync(join(path, f))); } };
  const fetchImpl = async (url) => ({ ok: true, status: 200, text: async () => (url.endsWith('/') ? '<a href="FungiDB-68_TfakeusST1.gff">' : RELEASED_GFF) });
  const record = await runFetch({
    workArea, proposalId: 'p1', staged: { path: 'products.tsv', sha256: sha(INPUT) }, stagingPath: staging, remote,
    organism: { abbrev: 'tfakST1', project: 'FungiDB', nameForFiles: 'TfakeusST1', ncbiTaxonId: '999001' }, pendingGenomes: [], fetchImpl
  });
  return { workArea, record };
}

/** A fetched, column-mapped and converted work area for ENTRY; pendingGenomes rewrites gff.json first. */
export async function convertedWorkArea({ pendingGenomes } = {}) {
  const { workArea } = await fetched();
  if (pendingGenomes) {
    const path = workFiles(workArea).gffJson;
    writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf-8')), pendingGenomes }, null, 2) + '\n');
  }
  writeColumns(workArea, 'productNames', inferColumns(workArea, 'productNames').columns);
  runConvert({ workArea, entry: ENTRY });
  return workArea;
}
```

Create `tests/functional-update-work-area.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inferColumns, writeColumns, runConvert } from '../shared/scripts/dataset-types/functional-update/commands.js';
import { checkConvertCurrent, readConverted, workFiles } from '../shared/scripts/dataset-types/functional-update/record.js';
import { RELEASED_GFF, INPUT, ENTRY, sha, fetched } from './functional-update-helpers.js';

test('runFetch writes gff.json, the GFF and the pulled input, checking the staged digest', async () => {
  const { workArea, record } = await fetched();
  assert.equal(record.gff.release, '68');
  assert.equal(record.gff.sha256, sha(RELEASED_GFF));
  assert.equal(record.input.sha256, sha(INPUT));
  assert.equal(readFileSync(join(workArea, 'input', 'products.tsv'), 'utf-8'), INPUT);
  assert.deepEqual(JSON.parse(readFileSync(workFiles(workArea).gffJson, 'utf-8')), record);
});

test('inferColumns finds the header, the ID column and its level, and the value column', async () => {
  const { workArea } = await fetched();
  assert.deepEqual(inferColumns(workArea, 'productNames').columns, { schemaVersion: 1, header: true, id: { column: 1, level: 'gene' }, values: { product: 2 } });
});

test('runConvert writes final/<file> and convert.json; checkConvertCurrent spots any change', async () => {
  const { workArea } = await fetched();
  writeColumns(workArea, 'productNames', inferColumns(workArea, 'productNames').columns);
  const record = runConvert({ workArea, entry: ENTRY });
  assert.equal(readFileSync(join(workArea, 'final', 'products.txt'), 'utf-8'), 'TFAK_0010.1\tkinase\t1\nTFAK_0010.2\tkinase\t1\nTFAK_0020.1\tncRNA\t1\n');
  assert.equal(record.rows, 3);
  assert.deepEqual(record.entry, ENTRY);
  assert.deepEqual(checkConvertCurrent(workArea, ENTRY), []);
  assert.equal(readConverted(workArea).record.sha256, record.sha256);

  assert.deepEqual(checkConvertCurrent(workArea, { ...ENTRY, version: '2026-12-01' }), ['convert.json is for productNames VEuPathDB 2026-11-03, not productNames VEuPathDB 2026-12-01; run functional-update.js convert again']);
  writeFileSync(join(workArea, 'final', 'products.txt'), 'x\n');
  assert.deepEqual(checkConvertCurrent(workArea, ENTRY), ['final/products.txt changed since convert; run functional-update.js convert again']);
});

test('writeColumns refuses a mapping the class cannot use', async () => {
  const { workArea } = await fetched();
  assert.throws(() => writeColumns(workArea, 'productNames', { header: true, id: { column: 1, level: 'gene' }, values: {} }), /values\.product is required/);
  assert.equal(existsSync(workFiles(workArea).columns), false);
});

test('checkConvertCurrent names what is missing', () => {
  const workArea = mkdtempSync(join(tmpdir(), 'fu-empty-'));
  assert.deepEqual(checkConvertCurrent(workArea, ENTRY), ['no convert.json in the work area; run functional-update.js fetch, columns and convert']);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `yarn --cwd /home/jbrestel/workspaces/src/dataset-curator-functional-update test:one tests/functional-update-work-area.test.js`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement `record.js`**

Create `shared/scripts/dataset-types/functional-update/record.js`:

```js
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sha256File } from '../../genome/workdir.js';

export const GFF_SCHEMA_VERSION = 1;
export const COLUMNS_SCHEMA_VERSION = 1;
export const CONVERT_SCHEMA_VERSION = 1;
const AGAIN = 'run functional-update.js convert again';

export const workFiles = (workArea) => ({
  gffJson: join(workArea, 'gff.json'), gffDir: join(workArea, 'gff'), inputDir: join(workArea, 'input'),
  columns: join(workArea, 'columns.json'), final: join(workArea, 'final'), convert: join(workArea, 'convert.json')
});

const readJson = (path) => JSON.parse(readFileSync(path, 'utf-8'));

/** convert.json and its own sha256 (what the verification report records). */
export function readConverted(workArea) {
  const path = workFiles(workArea).convert;
  return { record: readJson(path), sha256: sha256File(path) };
}

const label = (e) => `${e.datasetClass} ${e.name} ${e.version}`;

/** Why convert.json does not describe the work area for entry now; [] when it does. */
export function checkConvertCurrent(workArea, entry) {
  const files = workFiles(workArea);
  if (!existsSync(files.convert)) return ['no convert.json in the work area; run functional-update.js fetch, columns and convert'];
  const { record } = readConverted(workArea);
  if (record.schemaVersion !== CONVERT_SCHEMA_VERSION) return [`convert.json is schemaVersion ${record.schemaVersion}, not ${CONVERT_SCHEMA_VERSION}; ${AGAIN}`];
  const problems = [];
  if (label(record.entry) !== label(entry)) problems.push(`convert.json is for ${label(record.entry)}, not ${label(entry)}; ${AGAIN}`);
  const same = (path, sha, what) => {
    if (!existsSync(path)) problems.push(`${what} is missing; ${AGAIN}`);
    else if (sha256File(path) !== sha) problems.push(`${what} changed since convert; ${AGAIN}`);
  };
  same(files.gffJson, record.gffJson, 'gff.json');
  same(files.columns, record.columns, 'columns.json');
  same(join(files.inputDir, record.input.file), record.input.sha256, `input/${record.input.file}`);
  same(join(files.final, record.file), record.sha256, `final/${record.file}`);
  return problems;
}
```

- [ ] **Step 4: Implement `commands.js`**

Create `shared/scripts/dataset-types/functional-update/commands.js`:

```js
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { sha256, sha256File, writeFileAtomic, writeJsonAtomic } from '../../genome/workdir.js';
import { isEc } from '../../genome/functional/values.js';
import { fetchReleasedGff } from './gff-source.js';
import { idIndex, levelOfId, LEVELS } from './gff-ids.js';
import { CONVERTERS, columnsProblems, convert, readTab } from './converters.js';
import { COLUMNS_SCHEMA_VERSION, CONVERT_SCHEMA_VERSION, GFF_SCHEMA_VERSION, workFiles } from './record.js';

const readJson = (path) => JSON.parse(readFileSync(path, 'utf-8'));
const GENERATOR = 'dataset-curator functional-update';

/**
 * Pulls the staged curator file (checked against its manifest sha256) and the organism's released GFF into the work
 * area, and writes gff.json. remote.pull(path, dest, { files }) is lib/remote.js's; fetchImpl is fetch.
 */
export async function runFetch({ workArea, proposalId, staged, stagingPath, remote, organism, pendingGenomes, fetchImpl = fetch }) {
  const files = workFiles(workArea);
  mkdirSync(workArea, { recursive: true });
  remote.pull(stagingPath, files.inputDir, { files: [staged.path] });
  const input = join(files.inputDir, staged.path);
  if (!existsSync(input)) throw new Error(`dataStaging/${proposalId} lacks ${staged.path}`);
  const got = sha256File(input);
  if (staged.sha256 && got !== staged.sha256) throw new Error(`${staged.path} on staging has sha256 ${got}, not the ${staged.sha256} the proposal recorded`);
  const gff = await fetchReleasedGff({ project: organism.project, nameForFiles: organism.nameForFiles, fetchImpl });
  mkdirSync(files.gffDir, { recursive: true });
  writeFileAtomic(join(files.gffDir, gff.file), gff.text);
  const record = {
    schemaVersion: GFF_SCHEMA_VERSION, proposalId, organism, pendingGenomes,
    gff: { url: gff.url, file: gff.file, release: gff.release, sha256: sha256(gff.text) },
    input: { file: staged.path, sha256: got },
    fetchedAt: new Date().toISOString()
  };
  writeJsonAtomic(files.gffJson, record);
  return record;
}

function loaded(workArea) {
  const files = workFiles(workArea);
  if (!existsSync(files.gffJson)) throw new Error(`no gff.json in ${workArea}; run functional-update.js fetch first`);
  const gffRecord = readJson(files.gffJson);
  return {
    files, gffRecord,
    index: idIndex(readFileSync(join(files.gffDir, gffRecord.gff.file), 'utf-8')),
    text: readFileSync(join(files.inputDir, gffRecord.input.file), 'utf-8')
  };
}

const VALUE_PATTERNS = {
  goId: (v) => /^(GO:)?\d{7}$/.test(v), ec: isEc, evidence: (v) => /^[A-Z]{2,3}$/.test(v), aspect: (v) => /^[FPC]$/.test(v)
};
const TEXT_KEYS = ['product', 'name', 'comment', 'alias'];

/** A proposed columns.json for the data loader to confirm: the ID column and level that match the GFF best, and value columns by content. */
export function inferColumns(workArea, datasetClass) {
  const { index, text } = loaded(workArea);
  const rows = readTab(text);
  const width = Math.max(...rows.map((r) => r.length));
  const body = rows.slice(1, 201);
  let best = { column: 1, level: 'gene', hits: -1 };
  for (let c = 1; c <= width; c++) {
    for (const level of LEVELS) {
      const hits = body.filter((r) => levelOfId(index, r[c - 1]) === level).length;
      if (hits > best.hits) best = { column: c, level, hits };
    }
  }
  const header = rows.length > 0 && levelOfId(index, rows[0][best.column - 1]) === null;
  const spec = CONVERTERS[datasetClass];
  const values = {};
  const free = [...Array(width).keys()].map((i) => i + 1).filter((c) => c !== best.column);
  for (const key of [...spec.values, ...spec.optional]) {
    const test = VALUE_PATTERNS[key];
    const pick = test ? free.find((c) => body.length && body.every((r) => !r[c - 1] || test(r[c - 1])) && body.some((r) => r[c - 1]))
      : TEXT_KEYS.includes(key) ? free.find((c) => body.some((r) => r[c - 1])) : undefined;
    if (pick !== undefined) { values[key] = pick; free.splice(free.indexOf(pick), 1); }
  }
  return {
    columns: { schemaVersion: COLUMNS_SCHEMA_VERSION, header, id: { column: best.column, level: best.level }, values },
    matched: best.hits, sampled: body.length, sample: rows.slice(0, 6)
  };
}

/** Writes columns.json once the class can use it. */
export function writeColumns(workArea, datasetClass, columns) {
  const problems = columnsProblems(datasetClass, columns);
  if (problems.length) throw new Error(`columns for ${datasetClass}:\n  - ${problems.join('\n  - ')}`);
  writeJsonAtomic(workFiles(workArea).columns, { schemaVersion: COLUMNS_SCHEMA_VERSION, header: Boolean(columns.header), id: columns.id, values: columns.values });
}

/** Converts the input for entry ({ datasetClass, name, version }) into final/<file> and writes convert.json last. */
export function runConvert({ workArea, entry, generatorVersion = null }) {
  const { files, gffRecord, index, text } = loaded(workArea);
  if (!existsSync(files.columns)) throw new Error(`no columns.json in ${workArea}; run functional-update.js columns first`);
  const columns = readJson(files.columns);
  const problems = columnsProblems(entry.datasetClass, columns);
  if (problems.length) throw new Error(`columns.json cannot convert ${entry.datasetClass}:\n  - ${problems.join('\n  - ')}`);
  rmSync(files.convert, { force: true });
  const out = convert({ ...entry, text, columns, index, taxonId: gffRecord.organism.ncbiTaxonId });
  rmSync(files.final, { recursive: true, force: true });
  mkdirSync(files.final, { recursive: true });
  writeFileAtomic(join(files.final, out.file), out.text);
  const record = {
    schemaVersion: CONVERT_SCHEMA_VERSION, generator: { name: GENERATOR, version: generatorVersion }, entry,
    gffJson: sha256File(files.gffJson), columns: sha256File(files.columns),
    gff: gffRecord.gff, input: gffRecord.input, pendingGenomes: gffRecord.pendingGenomes,
    file: out.file, rows: out.rows, sha256: sha256(out.text), ids: out.ids, findings: out.findings
  };
  writeJsonAtomic(files.convert, record);
  return record;
}
```

Check the `genome/workdir.js` helpers exist as named (`sha256`, `sha256File`, `writeFileAtomic`, `writeJsonAtomic`): they are listed in its exports. Note `runConvert`'s record `sha256` is the final file's digest; `readConverted` returns the record and the digest of `convert.json` itself — the test compares `readConverted(...).record.sha256` with `record.sha256`, both the final file's.

- [ ] **Step 5: Run the tests**

Run: `yarn --cwd /home/jbrestel/workspaces/src/dataset-curator-functional-update test:one tests/functional-update-work-area.test.js tests/import-graph.test.js`
Expected: PASS. `inferColumns` on the two-row fixture: column 1 matches `gene` twice; row 0 (`gene_id`) does not match, so `header` is true; `product` is the first free text column, 2.

- [ ] **Step 6: The CLI**

Create `shared/scripts/functional-update.js` (mode 755):

```js
#!/usr/bin/env node
/**
 * functional-update.js - Preprocesses a functional-update proposal in its work area
 * (<workspace>/functional-update-validation/proposals/<proposal>/preprocess/).
 *
 *   fetch   <proposal> --workspace <root> --against origin/rebuildRR   pull the staged file and the released GFF
 *   columns <proposal> --workspace <root> [--write --header|--no-header --id <col>:<level> --value <key>=<col> ...]
 *           without --write: print the inferred mapping for the data loader to confirm
 *   convert <proposal> --workspace <root>                              write final/<file> and convert.json; exits 1 on an error finding
 */
import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { openWorkspace } from './lib/config.js';
import { createGit } from './lib/git-ops.js';
import { readOnRef, proposalRelativePath } from './lib/manifest.js';
import { createRemote } from './lib/remote.js';
import { openDeliveryDir, workAreaOf } from './lib/validation-workspace.js';
import { pendingGenomeProposals } from './lib/organisms.js';
import { datasetFileRelativePath, organismFileConstants } from './lib/dataset-file.js';
import { organismDatasetProps, projectFileRelativePath } from './lib/project-organisms.js';
import { datasetsOf, readerOnRef } from './dataset-types/_common.js';
import { runFetch, inferColumns, writeColumns, runConvert } from './dataset-types/functional-update/commands.js';

const TYPE = 'functional-update';
const version = () => JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf-8')).version;

async function main() {
  const { values, positionals: [command, proposalId] } = parseArgs({
    options: {
      workspace: { type: 'string' }, against: { type: 'string' }, write: { type: 'boolean', default: false },
      header: { type: 'boolean' }, 'no-header': { type: 'boolean' }, id: { type: 'string' }, value: { type: 'string', multiple: true, default: [] }
    },
    allowPositionals: true
  });
  if (!['fetch', 'columns', 'convert'].includes(command) || !proposalId || !values.workspace) {
    console.error('Usage: node functional-update.js fetch|columns|convert <proposal> --workspace <root> [--against origin/rebuildRR]');
    process.exit(1);
  }
  const config = openWorkspace();
  const git = createGit(config.repoPath);
  git.fetch();
  const manifest = readOnRef(git, 'origin/master', proposalId);
  if (!manifest) throw new Error(`No proposal ${proposalId} on origin/master`);
  if (manifest.datasetType !== TYPE) throw new Error(`${proposalId} is a ${manifest.datasetType} proposal, not ${TYPE}`);
  const { typeDir, staging } = openDeliveryDir({ root: values.workspace, datasetType: TYPE, proposalId });
  const workArea = workAreaOf(typeDir, proposalId);
  const [entry] = datasetsOf(proposalRelativePath(proposalId), manifest, { read: readerOnRef(git, 'origin/master') });

  if (command === 'fetch') {
    if (!/^origin\/rebuild\d+$/.test(values.against ?? '')) throw new Error('fetch needs --against origin/rebuildRR');
    const { proposedOrganismAbbrev: abbrev, project } = manifest.organisms[0];
    const props = organismDatasetProps(git.showFile(values.against, projectFileRelativePath(project))).find((p) => p.organismAbbrev === abbrev);
    if (!props?.organismNameForFiles) throw new Error(`${projectFileRelativePath(project)} on ${values.against} has no organism ${abbrev} with organismNameForFiles`);
    const constants = organismFileConstants(git.showFile(values.against, datasetFileRelativePath(project, abbrev)));
    const pendingGenomes = pendingGenomeProposals(git, ['origin/master']).filter((g) => g.organism?.proposedOrganismAbbrev === abbrev).map((g) => g.accession);
    const record = await runFetch({
      workArea, proposalId, staged: manifest.staging[0], stagingPath: `${staging.root}/${proposalId}`, remote: createRemote({ host: staging.host }),
      organism: { abbrev, project, nameForFiles: props.organismNameForFiles, ncbiTaxonId: constants.ncbiTaxonId ?? null }, pendingGenomes
    });
    console.error(`GFF: ${record.gff.url} (release ${record.gff.release})`);
    if (pendingGenomes.length) console.error(`Genome proposal ${pendingGenomes.join(', ')} names ${abbrev}: validation will fail until it loads`);
    console.log(workArea);
    return;
  }
  if (command === 'columns') {
    if (!values.write) {
      console.log(JSON.stringify(inferColumns(workArea, entry.datasetClass), null, 2));
      return;
    }
    const [column, level] = (values.id ?? '').split(':');
    const mapped = Object.fromEntries(values.value.map((pair) => { const [k, n] = pair.split('='); return [k, Number(n)]; }));
    writeColumns(workArea, entry.datasetClass, { header: Boolean(values.header) && !values['no-header'], id: { column: Number(column), level }, values: mapped });
    console.log(workArea);
    return;
  }
  const record = runConvert({ workArea, entry: { datasetClass: entry.datasetClass, name: entry.name, version: entry.version }, generatorVersion: version() });
  for (const f of record.findings) console.error(`${f.severity} ${f.check} (${f.count}): ${f.message}${f.sample.length ? ` [${f.sample.join(', ')}]` : ''}`);
  console.error(`${record.file}: ${record.rows} rows, ${record.ids.count} ${record.ids.level} IDs`);
  console.log(workArea);
  if (record.findings.some((f) => f.severity === 'error')) process.exit(1);
}

main().catch((err) => { console.error(`Error: ${err.message}`); process.exit(1); });
```

Run: `chmod +x /home/jbrestel/workspaces/src/dataset-curator-functional-update/shared/scripts/functional-update.js`

Run: `node --check /home/jbrestel/workspaces/src/dataset-curator-functional-update/shared/scripts/functional-update.js`
Expected: no output.

Note: `package.json` is two levels up from `shared/scripts/` but three from `skills/<name>/scripts/`. Mirror `write-proposal.js`'s `pluginVersion` (tries both `.claude-plugin/plugin.json` paths) instead of reading `package.json`: copy its function and use it here.

- [ ] **Step 7: Commit**

```
git -C /home/jbrestel/workspaces/src/dataset-curator-functional-update add shared/scripts tests/functional-update-work-area.test.js tests/functional-update-helpers.js
git -C /home/jbrestel/workspaces/src/dataset-curator-functional-update commit -m "functional-update: fetch, columns and convert in the work area

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Validators

**Files:**
- Create: `shared/scripts/dataset-types/functional-update/validators/{index,converted,update-record}.js`
- Modify: `shared/scripts/dataset-types/validators.js`
- Test: `tests/functional-update-validators.test.js` (new)

- [ ] **Step 1: Write the failing tests**

Create `tests/functional-update-validators.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { validatorsFor } from '../shared/scripts/dataset-types/validators.js';
import { loadManifest } from '../shared/scripts/dataset-types/_common.js';
import { fixtures } from './helpers.js';

const FU = join(fixtures, 'proposals/tfakST1_productNames_20261111');
const byName = Object.fromEntries(validatorsFor('functional-update').map((v) => [v.name, v]));

test('functional-update registers converted (preprocess) and updateRecord (content)', () => {
  assert.deepEqual(validatorsFor('functional-update').map((v) => [v.name, v.kind]), [['converted', 'preprocess'], ['updateRecord', 'content']]);
});

test('updateRecord passes the fixture', async () => {
  assert.deepEqual(await byName.updateRecord.run({ proposalDir: FU, manifest: loadManifest(FU) }), []);
});

test('converted reports an unconverted work area as an error', async () => {
  const workArea = mkdtempSync(join(tmpdir(), 'fu-v-'));
  const findings = await byName.converted.run({ proposalDir: FU, manifest: loadManifest(FU), workArea, extras: {} });
  assert.deepEqual(findings.map((f) => [f.severity, f.message]), [['error', 'no convert.json in the work area; run functional-update.js fetch, columns and convert']]);
});
```

Add `import { convertedWorkArea } from './functional-update-helpers.js';` and:

```js
test('converted passes a current conversion, records its digest, and fails a pending genome', async () => {
  const extras = {};
  const workArea = await convertedWorkArea();
  assert.deepEqual(await byName.converted.run({ proposalDir: FU, manifest: loadManifest(FU), workArea, extras }), []);
  assert.match(extras.preprocess.convert, /^[0-9a-f]{64}$/);
  const pending = await convertedWorkArea({ pendingGenomes: ['GCA_9.1'] });
  const findings = await byName.converted.run({ proposalDir: FU, manifest: loadManifest(FU), workArea: pending, extras: {} });
  assert.deepEqual(findings.map((f) => f.severity), ['error']);
  assert.match(findings[0].message, /genome proposal GCA_9\.1 on master names tfakST1/);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `yarn --cwd /home/jbrestel/workspaces/src/dataset-curator-functional-update test:one tests/functional-update-validators.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement**

`shared/scripts/dataset-types/functional-update/validators/converted.js`:

```js
import { onlyEntry } from '../../_common.js';
import { checkConvertCurrent, readConverted } from '../record.js';

const NAME = 'converted';
const format = (f) => `${f.check} (${f.count}): ${f.message}${f.sample.length ? ` [${f.sample.join(', ')}]` : ''}`;

export const converted = {
  name: NAME,
  kind: 'preprocess',
  tools: [],
  run: async ({ proposalDir, manifest, workArea, extras }) => {
    const entry = onlyEntry(proposalDir, manifest);
    const problems = checkConvertCurrent(workArea, entry);
    if (problems.length) return problems.map((message) => ({ validator: NAME, severity: 'error', message }));
    const { record, sha256 } = readConverted(workArea);
    if (extras) extras.preprocess = { convert: sha256 };
    const organism = manifest.organisms[0].proposedOrganismAbbrev;
    return [
      ...(record.pendingGenomes ?? []).map((g) => ({ validator: NAME, severity: 'error', message: `genome proposal ${g} on master names ${organism}; update it after that genome loads` })),
      ...record.findings.filter((f) => f.severity !== 'info').map((f) => ({ validator: NAME, severity: f.severity, message: format(f) }))
    ];
  }
};
```

`shared/scripts/dataset-types/functional-update/validators/update-record.js`:

```js
import { checkCurated } from '../../functional-update.js';

const NAME = 'updateRecord';

export const updateRecord = {
  name: NAME,
  kind: 'content',
  tools: [],
  run: async ({ proposalDir }) => checkCurated(proposalDir).map((message) => ({ validator: NAME, severity: 'error', message }))
};
```

`shared/scripts/dataset-types/functional-update/validators/index.js`:

```js
import { converted } from './converted.js';
import { updateRecord } from './update-record.js';

/** converted first, so the report's preprocess sha256 comes from it. */
export const validators = [converted, updateRecord];
```

In `shared/scripts/dataset-types/validators.js` add `import { validators as functionalUpdate } from './functional-update/validators/index.js';` and `'functional-update': functionalUpdate` to `VALIDATORS`.

- [ ] **Step 4: Run the tests**

Run: `yarn --cwd /home/jbrestel/workspaces/src/dataset-curator-functional-update test:one tests/functional-update-validators.test.js tests/validation.test.js tests/import-graph.test.js`
Expected: PASS. If `import-graph` reports a cycle through `update-record.js → functional-update.js`, import `updateProblems` etc. from `../update.js` and read the files there instead (the type module must not be reachable from itself).

- [ ] **Step 5: Checkpoint — full suite**

Run: `yarn --cwd /home/jbrestel/workspaces/src/dataset-curator-functional-update test`
Expected: all pass.

- [ ] **Step 6: Commit**

```
git -C /home/jbrestel/workspaces/src/dataset-curator-functional-update add shared/scripts/dataset-types tests/functional-update-validators.test.js
git -C /home/jbrestel/workspaces/src/dataset-curator-functional-update commit -m "functional-update: converted and updateRecord validators

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Delivery (`preprocessedFiles`)

**Files:**
- Create: `shared/scripts/dataset-types/functional-update/delivery.js`
- Modify: `shared/scripts/dataset-types/functional-update.js` (export)
- Test: `tests/functional-update-validators.test.js` (append; it already builds a converted work area)

- [ ] **Step 1: Append the failing tests**

```js
import { preprocessedFiles } from '../shared/scripts/dataset-types/functional-update.js';

const location = { label: 'productNames VEuPathDB', file: 'products.txt', relative: 'FungiDB/tfakST1/function/VEuPathDB_product_names/2026-11-03/final' };

test('preprocessedFiles delivers final/<file> once the report validated this conversion', async () => {
  const workArea = await convertedWorkArea();
  const { sha256 } = readConverted(workArea);
  const out = preprocessedFiles(FU, location, { workArea, report: { preprocess: { convert: sha256 } } });
  assert.deepEqual(out.problems, []);
  assert.deepEqual(out.files, [{ path: 'products.txt', from: join(workArea, 'final', 'products.txt') }]);
  assert.equal(out.provenance.convert, sha256);
  assert.deepEqual(preprocessedFiles(FU, location, { workArea, report: null }).problems, ['the verification report records no conversion; validate again']);
  assert.deepEqual(preprocessedFiles(FU, location, { workArea, report: { preprocess: { convert: 'f'.repeat(64) } } }).problems, ['the work area changed since validation; validate again']);
  assert.deepEqual(preprocessedFiles(FU, { ...location, file: 'other.txt' }, { workArea, report: { preprocess: { convert: sha256 } } }).problems, ['convert.json gives products.txt, but the class loads other.txt']);
});
```

(Import `readConverted` from `../shared/scripts/dataset-types/functional-update/record.js`.)

- [ ] **Step 2: Run to verify failure**

Run: `yarn --cwd /home/jbrestel/workspaces/src/dataset-curator-functional-update test:one tests/functional-update-validators.test.js`
Expected: FAIL, `preprocessedFiles` is not exported.

- [ ] **Step 3: Implement**

Create `shared/scripts/dataset-types/functional-update/delivery.js`:

```js
import { join } from 'node:path';
import { loadManifest, onlyEntry } from '../_common.js';
import { checkConvertCurrent, readConverted } from './record.js';

/** prepare-delivery: the converted file for the one entry location, once the current report validated that conversion. */
export function preprocessedFiles(proposalDir, location, { workArea, report = null }) {
  const entry = onlyEntry(proposalDir, loadManifest(proposalDir));
  const problems = checkConvertCurrent(workArea, entry);
  if (problems.length) return { files: [], problems, provenance: null };
  const { record, sha256 } = readConverted(workArea);
  if (!report?.preprocess?.convert) problems.push('the verification report records no conversion; validate again');
  else if (report.preprocess.convert !== sha256) problems.push('the work area changed since validation; validate again');
  if (record.file !== location.file) problems.push(`convert.json gives ${record.file}, but the class loads ${location.file}`);
  return {
    files: problems.length ? [] : [{ path: location.file, from: join(workArea, 'final', record.file) }],
    problems,
    provenance: { convert: sha256, gff: record.gff.url, gffSha256: record.gff.sha256, input: record.input.sha256 }
  };
}
```

In `shared/scripts/dataset-types/functional-update.js` add:

```js
export { preprocessedFiles } from './functional-update/delivery.js';
```

- [ ] **Step 4: Run the tests**

Run: `yarn --cwd /home/jbrestel/workspaces/src/dataset-curator-functional-update test:one tests/functional-update-validators.test.js tests/preprocessed.test.js tests/import-graph.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git -C /home/jbrestel/workspaces/src/dataset-curator-functional-update add shared/scripts/dataset-types tests/functional-update-validators.test.js
git -C /home/jbrestel/workspaces/src/dataset-curator-functional-update commit -m "functional-update: deliver the converted file through preprocessedFiles

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Load: `loadEdits`, `amendsPresenters`, `amendsEntries` in load-ops; `--history`

**Files:**
- Modify: `shared/scripts/dataset-types/functional-update.js` (`loadEdits`)
- Modify: `shared/scripts/dataset-types/_common.js` (`renderDatasets` skip)
- Modify: `shared/scripts/lib/load-ops.js`
- Modify: `shared/scripts/load-proposal.js`, `shared/scripts/render-proposal.js`
- Test: `tests/functional-update.test.js` (append), `tests/load-ops-functional-update.test.js` (new)

- [ ] **Step 1: Append failing unit tests for `loadEdits`**

Append to `tests/functional-update.test.js`:

```js
test('loadEdits: a history row for the build and, in bump mode, the version', () => {
  const m = loadManifest(FU);
  assert.deepEqual(fu.loadEdits(FU, { manifest: m, build: '69', given: { history: { genomeSource: 'INSDC' } } }), [
    { op: 'appendHistory', project: 'FungiDB', presenter: 'tfakST1_primary_genome_RSRC', build: '69',
      functional: { source: 'VEuPathDB', version: 'Nov 03, 2026' }, text: 'functional annotation updated', carry: { genomeSource: 'INSDC' } },
    { op: 'setEntryVersion', project: 'FungiDB', organism: 'tfakST1', datasetClass: 'productNames', name: 'VEuPathDB', version: '2026-11-03' }
  ]);
  assert.deepEqual(fu.amendsEntries(FU), [{ datasetClass: 'productNames', name: 'VEuPathDB' }]);
});
```

- [ ] **Step 2: Implement `loadEdits`**

In `shared/scripts/dataset-types/functional-update.js` add `projectOf` to the manifest import and `historyDate` to the update import, then:

```js
/** Phase 2: the history row on the genome presenter, and in bump mode the entry's new version. */
export function loadEdits(dir, { manifest, build, given = {} }) {
  const organism = organismsOf(manifest)[0];
  const project = projectOf(manifest, organism);
  const u = readUpdate(dir);
  const entry = onlyEntry(dir, manifest);
  return [
    {
      op: 'appendHistory', project, presenter: `${organism}_primary_genome_RSRC`, build,
      functional: { source: u.history.functionalAnnotationSource, version: historyDate(entry.version) }, text: u.history.text, carry: given.history ?? {}
    },
    ...(u.mode === 'bump' ? [{ op: 'setEntryVersion', project, organism, datasetClass: entry.datasetClass, name: entry.name, version: entry.version }] : [])
  ];
}
```

Run: `yarn --cwd /home/jbrestel/workspaces/src/dataset-curator-functional-update test:one tests/functional-update.test.js`
Expected: PASS.

- [ ] **Step 3: Write the failing load-ops integration tests**

Create `tests/load-ops-functional-update.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createGit } from '../shared/scripts/lib/git-ops.js';
import { loadProposal } from '../shared/scripts/lib/load-ops.js';
import { formatDeliveryComment } from '../shared/scripts/lib/validation.js';
import { fixtures, initRepo, stubTicket, stubGh } from './helpers.js';

const ID = 'tfakST1_productNames_20261111';
const REBUILD = 'rebuild02';
const ORGANISM = 'Datasets/lib/xml/datasets/FungiDB/tfakST1.xml';
const PRESENTERS = 'Model/lib/xml/datasetPresenters/FungiDB.xml';
const noFindings = async () => [];
const sh = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf-8' });

const GENOME_PRESENTER = `<?xml version="1.0"?>
<datasetPresenters>
  <datasetPresenter name="tfakST1_primary_genome_RSRC"
                    >
    <displayName><![CDATA[Genome Sequence and Annotation]]></displayName>
    <history buildNumber="01"
            genomeSource="INSDC" genomeVersion="GCA_000001.1"
            annotationSource="GenBank" annotationVersion="Jan 01, 2020"/>
    <primaryContactId>jane.doe</primaryContactId>
  </datasetPresenter>
</datasetPresenters>
`;

/** rebuild02 with the genome presenter and a VEuPathDB productNames entry; the fixture proposal on master with ticket 42. */
function setup({ presenters = GENOME_PRESENTER } = {}) {
  const { repo } = initRepo('load-fu-');
  writeFileSync(join(repo, PRESENTERS), presenters);
  const path = join(repo, ORGANISM);
  writeFileSync(path, readFileSync(path, 'utf-8').replace('</datasets>', `  <constant name="genomeVersion" value="2020-01-01"/>

  <dataset class="productNames">
    <prop name="projectName">$$projectName$$</prop>
    <prop name="organismAbbrev">$$organismAbbrev$$</prop>
    <prop name="name">VEuPathDB</prop>
    <prop name="version">2026-07-22</prop>
  </dataset>
</datasets>`));
  sh(repo, 'add', '-A');
  sh(repo, 'commit', '-q', '-m', 'genome presenter and products');
  sh(repo, 'push', '-q', 'origin', 'master');
  sh(repo, 'branch', REBUILD);
  sh(repo, 'push', '-q', '-u', 'origin', REBUILD);
  cpSync(join(fixtures, 'proposals', ID), join(repo, 'Proposals', ID), { recursive: true });
  const manifest = join(repo, 'Proposals', ID, 'manifest.json');
  writeFileSync(manifest, JSON.stringify({ ...JSON.parse(readFileSync(manifest, 'utf-8')), ticket: { system: 'github', id: '42', url: 'https://r/issues/42' } }, null, 2) + '\n');
  sh(repo, 'add', '-A');
  sh(repo, 'commit', '-q', '-m', 'proposal');
  sh(repo, 'push', '-q', 'origin', 'master');
  sh(repo, 'checkout', '-q', REBUILD);
  return repo;
}

function ready(repo) {
  sh(repo, 'fetch', '-q');
  const proposalTree = sh(repo, 'rev-parse', `origin/master:Proposals/${ID}`).trim();
  const record = { proposalTree, against: `origin/${REBUILD}`, settlement: [{ proposed: 'tfakST1', abbrev: 'tfakST1' }], build: '02', release: '2026-10', corpusStep: null, handoff: 'Copy' };
  return stubTicket({ status: 'ready', existingComments: [formatDeliveryComment(record, 'e'.repeat(64))] });
}

test('a bump load appends the history row and sets the version, in one commit, with no presenter or dataset added', async () => {
  const repo = setup();
  const gh = stubGh();
  const git = createGit(repo, { exec: gh.exec });
  await loadProposal({ git, ticket: ready(repo), repoPath: repo, rebuildBranch: REBUILD, proposalId: ID, validate: noFindings });
  const ref = `origin/load/${ID}`;
  assert.match(git.showFile(ref, PRESENTERS), /<history buildNumber="02"\n            genomeSource="INSDC" genomeVersion="GCA_000001\.1"\n            annotationSource="GenBank" annotationVersion="Jan 01, 2020"\n            functionalAnnotationSource="VEuPathDB" functionalAnnotationVersion="Nov 03, 2026">functional annotation updated<\/history>/);
  assert.match(git.showFile(ref, ORGANISM), /<prop name="name">VEuPathDB<\/prop>\n    <prop name="version">2026-11-03<\/prop>/);
  assert.equal(git.showFile(ref, ORGANISM).split('class="productNames"').length - 1, 1);
  assert.equal(git.headSubject(), `Load ${ID}: edit history tfakST1_primary_genome_RSRC build 02; productNames VEuPathDB version 2026-11-03 in tfakST1`);
  assert.equal(git.isClean(), true);
});

test('a dry run lists the edits and changes nothing', async () => {
  const repo = setup();
  const result = await loadProposal({ git: createGit(repo, { exec: stubGh().exec }), ticket: ready(repo), repoPath: repo, rebuildBranch: REBUILD, proposalId: ID, validate: noFindings, dryRun: true });
  assert.deepEqual(result.edits.map((e) => e.op), ['appendHistory', 'setEntryVersion']);
  assert.deepEqual(result.presenters, []);
  assert.equal(result.dataset, null);
});

test('a missing carried history value stops the load before any branch, naming --history; given, it loads', async () => {
  const repo = setup({ presenters: GENOME_PRESENTER.replace(' annotationVersion="Jan 01, 2020"', '') });
  const git = createGit(repo, { exec: stubGh().exec });
  await assert.rejects(loadProposal({ git, ticket: ready(repo), repoPath: repo, rebuildBranch: REBUILD, proposalId: ID, validate: noFindings }), /--history annotationVersion=<value>/);
  assert.equal(git.branchExists(`load/${ID}`), false);
  await loadProposal({ git, ticket: ready(repo), repoPath: repo, rebuildBranch: REBUILD, proposalId: ID, validate: noFindings, history: { annotationVersion: 'Feb 02, 2020' } });
  assert.match(git.showFile(`origin/load/${ID}`, PRESENTERS), /annotationVersion="Feb 02, 2020"/);
});

test('a load without the genome presenter is refused', async () => {
  const repo = setup({ presenters: '<?xml version="1.0"?>\n<datasetPresenters>\n</datasetPresenters>\n' });
  await assert.rejects(loadProposal({ git: createGit(repo, { exec: stubGh().exec }), ticket: ready(repo), repoPath: repo, rebuildBranch: REBUILD, proposalId: ID, validate: noFindings }),
    /Presenter tfakST1_primary_genome_RSRC is not in Model\/lib\/xml\/datasetPresenters\/FungiDB\.xml; functional-update amends an existing presenter/);
});

test('a load that failed after its commit resumes', async () => {
  const repo = setup();
  const failing = stubGh({ failCreates: 1 });
  const git = createGit(repo, { exec: failing.exec });
  await assert.rejects(loadProposal({ git, ticket: ready(repo), repoPath: repo, rebuildBranch: REBUILD, proposalId: ID, validate: noFindings }), /re-run the same command to resume/i);
  const result = await loadProposal({ git, ticket: ready(repo), repoPath: repo, rebuildBranch: REBUILD, proposalId: ID, validate: noFindings });
  assert.equal(result.resumed, true);
});
```

Check `stubGh`'s option names (`failCreates`) in `tests/helpers.js` and the resume message in `load-ops.js` (`Re-run the same command to resume.`); adjust the test to them, not the code.

- [ ] **Step 4: Run to verify failure**

Run: `yarn --cwd /home/jbrestel/workspaces/src/dataset-curator-functional-update test:one tests/load-ops-functional-update.test.js`
Expected: FAIL (renderPresenter is not a function).

- [ ] **Step 5: `renderDatasets` skip**

In `shared/scripts/dataset-types/_common.js`, change `renderDatasets`:

```js
export function renderDatasets(proposalDir, manifest, datasetType, classOf, { skip = [] } = {}) {
  return datasetsOf(proposalDir, manifest).filter((entry) => !isAmendedEntry(skip, entry)).map((entry) => {
```

(rest unchanged).

- [ ] **Step 6: load-ops changes**

In `shared/scripts/lib/load-ops.js`:

1. Imports: add `isAmendedEntry` to the `_common.js` import; add `import { applyEdits, editLabel, editTarget } from './load-edits.js';`.

2. `checkLoadPreconditions({ ..., validate, history = {} })`; pass `history` to `renderAndCheck` as a last argument `{ history }`, and to `assertSettledAsCommitted`'s options (`history`) on resume.

3. Replace `renderAndCheck` with:

```js
async function renderAndCheck(git, manifest, proposalDir, presenterPath, repoPath, build, settled, organismConstants, classOf, given = {}) {
  return withSettledProposal(proposalDir, manifest, settled, async (dir, m) => {
    const datasetType = await loadDatasetType(m.datasetType);
    const presenterFile = readFileSync(presenterPath, 'utf-8');
    const presenters = [];
    if (datasetType.amendsPresenters) {
      const missing = datasetType.presenterNames(dir).filter((n) => !presenterNameExists(presenterFile, n));
      if (missing.length) throw new Error(`Presenter ${missing.join(', ')} is not in ${presenterFileRelativePath(homeProject(m))}; ${m.datasetType} amends an existing presenter`);
    } else {
      const xml = datasetType.renderPresenter(dir, { build });
      presenters.push({ xml, name: extractPresenterName(xml) });
      const taken = presenters.find((p) => presenterNameExists(presenterFile, p.name));
      if (taken) throw new Error(`Presenter "${taken.name}" already exists in ${presenterFileRelativePath(homeProject(m))}. It may already be loaded; ask before continuing.`);
    }
    const amended = datasetType.amendsEntries?.(dir) ?? [];
    const parts = await renderDatasetParts(m, dir, repoPath, { check: true, organismConstants, classOf, amended });
    const edits = datasetType.loadEdits?.(dir, { manifest: m, build, given }) ?? [];
    // Applied once against the checkout so a refused edit stops the load before any branch exists.
    applyEdits(edits, (rel) => readFileSync(join(repoPath, rel), 'utf-8'));
    for (const e of datasetsOf(dir, m).filter((x) => !isAmendedEntry(amended, x))) {
      const clash = namePatternClash(git, 'HEAD', datasetType, { className: e.datasetClass, name: e.name, organisms: organismsOf(m) });
      if (clash) throw new Error(`${clash}. Request a revision so the curator can ${nameAdvice(datasetType)}.`);
    }
    return { presenters, presenterFile, edits, ...parts };
  });
}
```

4. `renderDatasetParts(manifest, proposalDir, repoPath, { check, organismConstants = {}, classOf = memoClassOf(repoPath), amended = [] })`: change its first lines to

```js
  const datasetType = await loadDatasetType(manifest.datasetType);
  const entries = datasetsOf(proposalDir, manifest).filter((e) => !isAmendedEntry(amended, e));
  if (!entries.length) return { dataset: null };
  const xml = renderDatasets(proposalDir, manifest, datasetType, classOf, { skip: amended });
```

5. Add beside `presenterNamesFromCommit`:

```js
/** The edit labels and, when it also inserted entries, the organisms of an edit load commit, or null. */
function editsFromCommit(subject) {
  const m = /^Load \S+: edit (.+?)(?:, add .+ to (\S+(?: \S+)*))?$/.exec(subject);
  return m ? { labels: m[1], organisms: m[2]?.split(' ') ?? null } : null;
}

/** The load commit subject: an edit load names its edits; any other names the presenters it adds. */
function loadSubject(proposalId, { presenterNames, project, dataset, edits }) {
  const added = dataset ? `${entriesLabel(dataset.entries)} to ${dataset.organisms.map((o) => o.organism).join(' ')}` : null;
  if (edits.length) return `Load ${proposalId}: edit ${edits.map(editLabel).join('; ')}${added ? `, add ${added}` : ''}`;
  return `Load ${proposalId}: add ${presenterNames.join(' ')} to ${project}${added ? `, ${added}` : ''}`;
}
```

6. In `assertSettledAsCommitted(git, manifest, { relDir, build, settled, repoPath, base, branch, byRecord, history = {} })`:

```js
  const committedEdits = editsFromCommit(subject);
  const committedPresenters = presenterNamesFromCommit(subject);
  const committedOrganisms = committedEdits ? committedEdits.organisms : datasetOrganismsFromCommit(subject);
  if (!committedPresenters && !committedOrganisms && !committedEdits) {
    throw new Error(`The load commit "${subject}" names neither presenters nor organisms, so this run cannot confirm it settles the same way. Start over: ${startOver}`);
  }
  if (committedEdits) {
    const now = await withProposalFromRef(git, 'origin/master', relDir, (dir) => withSettledProposal(dir, manifest, settled, async (d, m) => {
      const type = await loadDatasetType(m.datasetType);
      return (type.loadEdits?.(d, { manifest: m, build, given: { history } }) ?? []).map(editLabel).join('; ');
    }));
    if (now !== committedEdits.labels) throw new Error(`This load was committed with edits "${committedEdits.labels}"; the proposal now gives "${now}". Start over: ${startOver}`);
  }
```

and keep the existing presenter, organism and label checks below it (the label check reads `datasetsLabelFromCommit`, which is null for edit subjects).

7. `committedDataset`: pass `amended`:

```js
async function committedDataset(git, manifest, settled, repoPath, relDir) {
  return withProposalFromRef(git, 'origin/master', relDir, (exported) => withSettledProposal(exported, manifest, settled, async (d, m) => {
    const type = await loadDatasetType(m.datasetType);
    return (await renderDatasetParts(m, d, repoPath, { check: false, amended: type.amendsEntries?.(d) ?? [] })).dataset;
  }));
}
```

8. `loadProposal({ ..., validate, history = {} })`: pass `history` to `checkLoadPreconditions`. In the dry-run return add `edits: pre.edits ?? []`. Replace the `writes` construction and commit with:

```js
      const files = new Map();
      if (presenters.length) files.set(presenterFileRelativePath(homeProject(manifest)), presenters.reduce((c, p) => insertPresenter(c, p.xml), presenterFile));
      for (const o of dataset?.organisms ?? []) files.set(o.relFile, insertDataset(o.datasetFile, dataset.xml));
      for (const p of dataset?.projectFiles ?? []) files.set(p.relFile, p.content);
      for (const f of applyEdits(pre.edits ?? [], (rel) => files.get(rel) ?? readFileSync(join(repoPath, rel), 'utf-8'))) files.set(f.relFile, f.content);
      const writes = [...files].map(([relFile, content]) => ({ relFile, content }));
      for (const w of writes) {
        mkdirSync(dirname(join(repoPath, w.relFile)), { recursive: true });
        writeFileSync(join(repoPath, w.relFile), w.content);
      }
      git.add(writes.map((w) => w.relFile));
      // Stages nothing when the rebuild branch already has master's contacts.
      git.checkoutPath('origin/master', CONTACTS_RELATIVE_PATH);
      git.commit(loadSubject(proposalId, { presenterNames, project: homeProject(manifest), dataset, edits: pre.edits ?? [] }));
```

In the PR body, change the `Presenters:` line to

```js
      `Presenters: ${presenterNames?.length ? presenterNames.map((n) => `\`${n}\``).join(', ') : presenterNames ? 'none added' : 'see the commit on this branch'} in \`${presenterFileRelativePath(homeProject(manifest))}\``,
      ...(pre.edits ?? []).map((e) => `Edit: ${editLabel(e)} in \`${editTarget(e)}\``),
```

- [ ] **Step 7: CLI flags**

`shared/scripts/load-proposal.js`:
- add `history: { type: 'string', multiple: true, default: [] }` to the options, and to the usage strings `[--history <key>=<value> ...]`;
- parse:

```js
  const history = {};
  for (const pair of values.history) {
    const at = pair.indexOf('=');
    const key = pair.slice(0, at);
    if (at < 1 || !HISTORY_CARRIED.includes(key)) { console.error(`--history must be <key>=<value> with key one of ${HISTORY_CARRIED.join(', ')}; got "${pair}"`); process.exit(1); }
    history[key] = pair.slice(at + 1);
  }
```

  with `import { HISTORY_CARRIED } from './lib/presenter-file.js';` and `import { editLabel, editTarget } from './lib/load-edits.js';`;
- pass `history` to `loadProposal`;
- in the dry-run branch, before the presenter lines: `for (const e of result.edits ?? []) console.error(\`Dry run: would edit ${editTarget(e)}: ${editLabel(e)}\`);`, and print the "would add presenters" line only when `result.presenters?.length`.

`shared/scripts/render-proposal.js`: where it handles `--presenter`, refuse an `amendsPresenters` type: `if (datasetType.amendsPresenters) throw new Error(\`${manifest.datasetType} proposals have no presenter; they add a history row to ${datasetType.presenterNames(proposalDir).join(', ')} at load\`);` (read the file and place it where `datasetType` and the manifest are in scope).

- [ ] **Step 8: Run the tests**

Run: `yarn --cwd /home/jbrestel/workspaces/src/dataset-curator-functional-update test:one tests/load-ops-functional-update.test.js tests/load-ops.test.js tests/render-proposal.test.js tests/import-graph.test.js`
Expected: PASS, including every existing load-ops test (their subjects must be unchanged).

- [ ] **Step 9: Commit**

```
yarn --cwd /home/jbrestel/workspaces/src/dataset-curator-functional-update sync-shared
git -C /home/jbrestel/workspaces/src/dataset-curator-functional-update add shared skills tests/functional-update.test.js tests/load-ops-functional-update.test.js
git -C /home/jbrestel/workspaces/src/dataset-curator-functional-update commit -m "load: declarative edits, amended presenters and entries, --history

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Build fitness runs the appliers

**Files:**
- Modify: `shared/scripts/lib/build-fitness.js`, `shared/scripts/lib/validation-ops.js`
- Test: `tests/build-fitness.test.js` (append)

- [ ] **Step 1: Append failing tests**

```js
const FU_ID = 'tfakST1_productNames_20261111';
const PRODUCTS_ENTRY = `  <dataset class="productNames">
    <prop name="projectName">$$projectName$$</prop>
    <prop name="organismAbbrev">$$organismAbbrev$$</prop>
    <prop name="name">VEuPathDB</prop>
    <prop name="version">2026-07-22</prop>
  </dataset>
</datasets>`;

/** rebuild02 with the genome presenter (its history row optional) and tfakST1's VEuPathDB productNames entry (optional); the fixture proposal in a scratch dir. */
function fuSetup({ presenter = true, entry = true, carried = true } = {}) {
  const row = carried ? '\n    <history buildNumber="01" genomeSource="INSDC" genomeVersion="G" annotationSource="GenBank" annotationVersion="Jan 01, 2020"/>' : '\n    <history buildNumber="01"/>';
  const { repo } = initRepo('build-fitness-fu-');
  writeFileSync(join(repo, PRESENTERS), `<?xml version="1.0"?>\n<datasetPresenters>\n${presenter ? `  <datasetPresenter name="tfakST1_primary_genome_RSRC">${row}\n  </datasetPresenter>\n` : ''}</datasetPresenters>\n`);
  const organism = join(repo, 'Datasets/lib/xml/datasets/FungiDB/tfakST1.xml');
  if (entry) writeFileSync(organism, readFileSync(organism, 'utf-8').replace('</datasets>', PRODUCTS_ENTRY));
  execFileSync('git', ['-C', repo, 'add', '-A']);
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'genome presenter']);
  execFileSync('git', ['-C', repo, 'push', '-q', 'origin', 'HEAD:rebuild02']);
  execFileSync('git', ['-C', repo, 'fetch', '-q']);
  const proposalDir = join(mkdtempSync(join(tmpdir(), 'build-fitness-fu-p-')), FU_ID);
  cpSync(join(fixtures, 'proposals', FU_ID), proposalDir, { recursive: true });
  return { git: createGit(repo), proposalDir, manifest: JSON.parse(readFileSync(join(proposalDir, 'manifest.json'), 'utf-8')) };
}
```

Then:

```js
test('buildFitness: a functional update needs its presenter and entry, and dry-runs its edits', async () => {
  assert.deepEqual(await buildFitness({ ...fuSetup(), against: 'origin/rebuild02', build: '02' }), []);
  const noPresenter = await buildFitness({ ...fuSetup({ presenter: false }), against: 'origin/rebuild02', build: '02' });
  assert.ok(noPresenter.some((f) => f.severity === 'error' && /amends an existing presenter/.test(f.message)));
  const noEntry = await buildFitness({ ...fuSetup({ entry: false }), against: 'origin/rebuild02', build: '02' });
  assert.ok(noEntry.some((f) => f.severity === 'error' && /has no productNames named "VEuPathDB" to update/.test(f.message)));
  const noCarry = await buildFitness({ ...fuSetup({ carried: false }), against: 'origin/rebuild02', build: '02' });
  assert.deepEqual(noCarry.map((f) => f.severity), ['warning']);
  assert.match(noCarry[0].message, /--history genomeSource=<value>/);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `yarn --cwd /home/jbrestel/workspaces/src/dataset-curator-functional-update test:one tests/build-fitness.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement**

`shared/scripts/lib/build-fitness.js`:
- imports: `isAmendedEntry` from `_common.js`; `applyEdits` from `./load-edits.js`;
- signature `buildFitness({ git, manifest, proposalDir, against, build = null })`;
- replace the presenter loop with

```js
    for (const name of names) {
      const exists = presenterNameExists(file, name);
      if (datasetType.amendsPresenters && !exists) error(`Presenter "${name}" is not in ${presenters} on ${against}; ${manifest.datasetType} amends an existing presenter`);
      if (!datasetType.amendsPresenters && exists) error(`Presenter "${name}" already exists in ${presenters} on ${against}`);
    }
```

- before `if (entries.length)`: `const amended = await withSettledProposal(proposalDir, manifest, organisms, async (dir) => datasetType.amendsEntries?.(dir) ?? []);`
- replace the per-entry existence check with

```js
      for (const e of entries) {
        const exists = entryDatasetExists(file, classOf(e.datasetClass), e);
        if (isAmendedEntry(amended, e) && !exists) error(`${rel} on ${against} has no ${entryNamed(e)} to update`);
        if (!isAmendedEntry(amended, e) && exists) error(`${rel} on ${against} already has a ${entryNamed(e)}`);
      }
```

- after the entries block, before `return findings`:

```js
  if (datasetType.loadEdits && build) {
    const edits = await withSettledProposal(proposalDir, manifest, organisms, async (dir, m) => datasetType.loadEdits(dir, { manifest: m, build, given: {} }));
    try {
      applyEdits(edits, (rel) => git.showFile(against, rel));
    } catch (e) {
      // A carried history value the data loader gives at load (--history) is not a defect in the proposal.
      findings.push({ validator: NAME, severity: /--history /.test(e.message) ? 'warning' : 'error', message: e.message });
    }
  }
```

`shared/scripts/lib/validation-ops.js` `validateProposal`: before building `ctx`, add `const build = against ? await ticket.getBuild(ref) : null;` and put `build` in `ctx`.

- [ ] **Step 4: Run the tests**

Run: `yarn --cwd /home/jbrestel/workspaces/src/dataset-curator-functional-update test:one tests/build-fitness.test.js tests/validation-ops.test.js tests/import-graph.test.js`
Expected: PASS. If a `validation-ops` test's ticket stub lacks `getBuild`, `stubTicket` provides it; a hand-rolled stub needs `getBuild: async () => '02'`.

- [ ] **Step 5: Checkpoint — full suite**

Run: `yarn --cwd /home/jbrestel/workspaces/src/dataset-curator-functional-update test`
Expected: all pass.

- [ ] **Step 6: Commit**

```
yarn --cwd /home/jbrestel/workspaces/src/dataset-curator-functional-update sync-shared
git -C /home/jbrestel/workspaces/src/dataset-curator-functional-update add shared skills tests/build-fitness.test.js
git -C /home/jbrestel/workspaces/src/dataset-curator-functional-update commit -m "build fitness: amended presenters and entries, dry-run load edits

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Skills, sharedFiles, typeLabels, docs, 4.1.0

**Files:**
- Create: `skills/propose-functional-update/SKILL.md`, `skills/verify-functional-update/SKILL.md`
- Modify: `package.json` (`sharedFiles`, `version`), `.claude-plugin/plugin.json` (`version`), `shared/resources/curator.config.json` (`typeLabels`), `docs/development.md`, `README.md`, `CLAUDE.md`

- [ ] **Step 1: typeLabels**

In `shared/resources/curator.config.json` `ticket.github.typeLabels` add `"functional-update": "functional annotation"`.

- [ ] **Step 2: sharedFiles**

Write a scratch script with the Write tool at `/tmp/claude-1000/-home-jbrestel-workspaces-src-dataset-curator/aea7701b-3f63-471b-bd2d-c923316fe27e/scratchpad/addFunctionalUpdateSharedFilesToPackageJson.mjs` (show it to John before running):

```js
import { readFileSync, writeFileSync } from 'node:fs';

const path = process.argv[2];
const pkg = JSON.parse(readFileSync(path, 'utf-8'));
const shared = pkg.sharedFiles;
const SRA_ONLY = new Set(['scripts/lib/released-organisms.js', 'scripts/check-library.js', 'scripts/check-experiments.js', 'scripts/check-released-organism.js',
  'scripts/lib/sra-runinfo.js', 'scripts/fetch-sra-metadata.js', 'scripts/lib/publications.js', 'scripts/find-publications.js']);
const add = (file, skill) => { shared[file] ??= []; if (!shared[file].includes(skill)) shared[file].push(skill); };

// New skills take what their nearest siblings take.
for (const [file, skills] of Object.entries(shared)) {
  if (skills.includes('propose-dnaseq') && !SRA_ONLY.has(file)) add(file, 'propose-functional-update');
  if (skills.includes('verify-bulk-rnaseq')) add(file, 'verify-functional-update');
}
// Everything the type registry reaches goes wherever dataset-types/index.js goes.
const everywhere = shared['scripts/dataset-types/index.js'];
for (const file of ['scripts/dataset-types/functional-update/record.js', 'scripts/dataset-types/functional-update/delivery.js']) {
  for (const skill of everywhere) add(file, skill);
}
// Validators and load edits go wherever validators.js and load-ops.js go.
for (const file of ['scripts/dataset-types/functional-update/validators/index.js', 'scripts/dataset-types/functional-update/validators/converted.js',
  'scripts/dataset-types/functional-update/validators/update-record.js']) {
  for (const skill of shared['scripts/dataset-types/validators.js']) add(file, skill);
}
for (const skill of shared['scripts/lib/load-ops.js']) add('scripts/lib/load-edits.js', skill);
for (const file of ['scripts/lib/staging-upload.js', 'scripts/stage-file.js', 'scripts/check-functional-entries.js']) add(file, 'propose-functional-update');
for (const file of ['scripts/functional-update.js', 'scripts/dataset-types/functional-update/commands.js', 'scripts/dataset-types/functional-update/converters.js',
  'scripts/dataset-types/functional-update/gff-ids.js', 'scripts/dataset-types/functional-update/gff-source.js', 'scripts/genome/gff.js',
  'scripts/genome/feature-types.js', 'scripts/genome/functional/writers.js', 'scripts/genome/functional/values.js']) add(file, 'verify-functional-update');
writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
```

Run: `node /tmp/claude-1000/-home-jbrestel-workspaces-src-dataset-curator/aea7701b-3f63-471b-bd2d-c923316fe27e/scratchpad/addFunctionalUpdateSharedFilesToPackageJson.mjs /home/jbrestel/workspaces/src/dataset-curator-functional-update/package.json`

Then: `yarn --cwd /home/jbrestel/workspaces/src/dataset-curator-functional-update sync-shared`
Then: `yarn --cwd /home/jbrestel/workspaces/src/dataset-curator-functional-update test:one tests/skill-imports.test.js tests/sync-shared.test.js`
Expected: PASS. For each missing import it reports, add that file to the named skill in `sharedFiles`, sync, and re-run until it passes.

- [ ] **Step 3: `skills/propose-functional-update/SKILL.md`**

```markdown
---
name: propose-functional-update
description: Propose a functional annotation update (product names, GO terms, EC numbers, gene names, comments or aliases) for an organism already on VEuPathDB - stage the curator's tab file on dataStaging, choose the entry it updates, write the proposal to VEuPathDatasets, open the PR and draft ticket
---

# Propose a Functional Annotation Update

A curator has a tab-separated file of functional annotation for one organism that
is already loaded. This skill records it as a **proposal**: one dataset entry (the
organism's existing entry of that class, re-versioned, or a new one), the history
row's source, and the file on dataStaging. Conversion to the loader format happens
later, at verification. There is no presenter: load adds a history row to the
organism's genome presenter. See [proposal workflow](resources/proposal-workflow.md).

One class per proposal. Supported classes: `productNames`, `GeneOntologyAssociations`,
`EnzymeCommissionAssociations`, `geneName`, `comments`, `aliases`.

## Prerequisites

Run from the top of a VEuPathDatasets checkout:

    node scripts/check-workspace.js

All commands run from there. Never `cd`; never push to `master`.

## Required information (ask for all before starting)

- **The file** (a path the curator gives).
- **What it holds**: infer from the header and content (`GO:0005524` → GO,
  `2.7.11.1` → EC, free text → product names, ...), then confirm the class with
  the curator. Ask when unsure.
- **Organism** abbreviation (or a name you look up in the project's organism
  files on the rebuild branch) and its **project**.
- **functionalAnnotationSource** for the history row. No default: always ask.
- **Curation date** `YYYY-MM-DD`: the entry's new version and the history date.
- **Rebuild branch** (`rebuildRR`). Always ask; never guess.
- Optional **entry name**, only if the curator means a specific or new entry.

The proposal id is `<orgAbbrev>_<datasetClass>_<YYYYMMDD>`, today's date.

## Workflow

### Step 0: Start

    node scripts/start-proposal.js <PROPOSAL> --type functional-update

### Step 1: Read the organism's entries

    node scripts/check-functional-entries.js <PROPOSAL> --organism <abbrev> --project <Project> --class <datasetClass> --rebuild-branch rebuildRR

Show the curator the entries it prints. With one entry and no name given, that
entry is updated. With several, ask which. A name that does not exist is a **new**
entry: confirm that is meant, not a typo. A genome proposal naming the organism is
a hard stop.

### Step 2: Stage the file

    node scripts/stage-file.js <PROPOSAL> <file>

It uploads to `yew:/veupathdb/dataStaging/<PROPOSAL>/` and prints the `staging`
override. It refuses a different file of the same name already there: ask the
data loaders, never delete it yourself.

### Step 3: Write the proposal

Write `.curation/tmp/<PROPOSAL>_overrides.json`:

    {
      "version": "<curation date>",
      "update": { "datasetClass": "<class>", "functionalAnnotationSource": "<source>" },
      "staging": [{ "path": "<file name>", "sha256": "<from stage-file>" }]
    }

Add `"name": "<entry>"` when the curator named one, and `"newEntry": true` inside
`update` for a new entry. Then:

    node scripts/write-proposal.js --accession <PROPOSAL> --type functional-update --project <Project> --organism <abbrev> \
      --rebuild-branch rebuildRR --primary-contact <curator contact id> --skill propose-functional-update \
      --input .curation/tmp/<PROPOSAL>_organism_entries.json --input .curation/tmp/<PROPOSAL>_staged.json \
      [--input <file>]   # only when the file is at most 1 MiB, so reviewers can read it
      --overrides .curation/tmp/<PROPOSAL>_overrides.json

Refusals name the fix (version not later than the current one, staging mismatch,
unknown entry). Fix the input or override and re-run.

### Step 4: Publish

Ask the curator for the target build (`NN`), then:

    node scripts/publish-proposal.js <PROPOSAL> --build NN

It opens the pull request and the draft ticket (label `functional annotation`).
```

Copy the exact `start-proposal.js`, `publish-proposal.js` and contacts usage from `skills/propose-dnaseq/SKILL.md` and its `resources/step-*.md` (flags, contact curation) so this skill matches them; adjust only what differs above.

- [ ] **Step 4: `skills/verify-functional-update/SKILL.md`**

```markdown
---
name: verify-functional-update
description: Data loading team - verify a merged functional annotation update proposal before it loads. Claims it, fetches the staged curator file and the organism's released GFF into the work area, confirms the column mapping with the data loader, converts the file to the class's loader format (IDs mapped to the class's level), runs validate-proposal (conversion findings, update record, build fitness including the history row and entry version), prepares the manual delivery with prepare-delivery, then mark-ready or request-revision
---

# Verify a Functional Annotation Update

Follows the shared [verification procedure](resources/verify-procedure.md); the
steps below are this type's preprocessing. Ask the data loader for the validation
workspace root (`<ROOT>`) and the rebuild branch (`rebuildRR`).

1. **Claim**: `node scripts/start-verification.js <PROPOSAL>`
2. **Fetch**: `node scripts/functional-update.js fetch <PROPOSAL> --workspace <ROOT> --against origin/rebuildRR`
   Pulls the staged file (checked against the proposal's sha256) and the released
   GFF. A pending genome proposal for the organism is reported and fails validation.
3. **Columns**: `node scripts/functional-update.js columns <PROPOSAL> --workspace <ROOT>`
   prints the inferred mapping and sample rows. Show them to the data loader and
   confirm the ID column, its level (gene, transcript or protein), the value
   columns and whether row one is a header. Then write it:
   `node scripts/functional-update.js columns <PROPOSAL> --workspace <ROOT> --write [--header] --id <col>:<level> --value <key>=<col> ...`
   Keys: productNames `product` [`preferred`]; GO `goId` [`aspect`, `evidence`,
   `reference`]; EC `ec`; geneName `name`; comments `comment`; aliases `alias`.
4. **Convert**: `node scripts/functional-update.js convert <PROPOSAL> --workspace <ROOT>`
   Review the findings with the data loader. `unmatchedIds` is an error when more
   than 1% of IDs (any, under 100) are not in the released GFF: usually the wrong
   organism or ID column, else request a revision.
5. **Validate**: `node scripts/validate-proposal.js <PROPOSAL> --workspace <ROOT> --against origin/rebuildRR`
   A build-fitness warning naming `--history` means the genome presenter's latest
   history row lacks genome or annotation values: note them for the load
   (`load-proposal.js --history <key>=<value>`).
6. **Deliver**: `node scripts/prepare-delivery.js <PROPOSAL> --workspace <ROOT> --against origin/rebuildRR`
7. **Decide**: `mark-ready.js` or `request-revision.js`, as the procedure says.
```

Copy flag spellings from `skills/verify-genome/SKILL.md` for steps 1 and 5-7 so they match the real CLIs.

- [ ] **Step 5: Docs and version**

- `docs/development.md`:
  - Shared Library table: add `lib/load-edits.js` (edit ops for loads: `appendHistory`, `setEntryVersion`; `applyEdits`, `editLabel`, `editTarget`), `lib/staging-upload.js` (`stageFile`, the curator tool's one remote write), `dataset-types/functional-update.js` and its `functional-update/` modules (one line each), `genome/functional/writers.js`.
  - Dataset-type contract table: add rows for `amendsPresenters` (both; no presenter of its own, `presenterNames` names presenters it amends), `amendsEntries(dir)` (both; entries it re-versions, which must exist), `loadEdits(dir, { manifest, build, given })` (2; edit ops load applies through `lib/load-edits.js`; `given.history` from `load-proposal.js --history`), `deriveUpdate(dir, overrides.update, { name })` and `ownRecordFiles` (1; `curated/update.json`).
  - "GitHub issues backend" `typeLabels` sentence: add `functional-update` → `functional annotation`.
- `README.md` "Available Skills": add both skills, one line each.
- `CLAUDE.md` repository structure: add `propose-functional-update/` and `verify-functional-update/` lines.
- `package.json` `"version": "4.1.0"`; `.claude-plugin/plugin.json` `"version": "4.1.0"`.

- [ ] **Step 6: Full suite**

Run: `yarn --cwd /home/jbrestel/workspaces/src/dataset-curator-functional-update test`
Expected: all pass.

- [ ] **Step 7: Commit**

```
yarn --cwd /home/jbrestel/workspaces/src/dataset-curator-functional-update sync-shared
git -C /home/jbrestel/workspaces/src/dataset-curator-functional-update add package.json .claude-plugin shared skills docs README.md CLAUDE.md
git -C /home/jbrestel/workspaces/src/dataset-curator-functional-update commit -m "Functional annotation update: propose and verify skills (4.1.0)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Acceptance on a real organism

Run by John (or with a data loader). Nothing here is automated; record findings in the amendments block below and turn each into a fix task.

- [ ] **Step 1: Phase 1** in a VEuPathDatasets checkout, with a real curator file for an organism that has a `productNames` entry (e.g. `pfal3D7`, `VEuPathDB` 2026-07-22): `check-functional-entries.js`, `stage-file.js` (confirm the file lands on yew), `write-proposal.js`, `publish-proposal.js` against a test repo config (`.curation/curator.config.json`) or the real one with John's go-ahead.
- [ ] **Step 2: Verify**: fetch (confirm the GFF URL pattern holds for the project), columns, convert (`unmatchedIds` count), validate with `--against`, prepare-delivery; inspect `delivery/<id>/` paths against `classes.xml`.
- [ ] **Step 3: Load** on a scratch rebuild branch: `load-proposal.js --dry-run`, then a real load; diff the presenter history row and the organism file.
- [ ] **Step 4: GO** once, end to end, to confirm a GAF from `convert` loads.

#### Amendments

(Findings from acceptance go here, each with the task that fixes it.)

---

## Self-review against the spec

| Spec item | Task |
|---|---|
| One class per proposal, six v1 classes, singleEntry | 4 |
| Bump by default, new entry only when named and confirmed | 5 |
| Literal version on the one entry; constant → literal | 1, 12 |
| Id `<org>_<class>_<YYYYMMDD>`; version = curator date | 5, 14 (skill) |
| `functionalAnnotationSource` always asked | 5 |
| Organism released; pending genome refused | 4 (rule), 5, 9, 10 (deviation 7) |
| Phase 1 learns only the class | 5, 14 |
| Staging upload, refuse different file | 6 |
| Released GFF IDs | 7, 9 |
| Converters per class through shared writers; findings and thresholds | 3, 8 |
| `convert.json`, staleness | 9 |
| Validators (converted, update record, build fitness) | 10, 13 |
| Delivery through `preprocessedFiles` | 11 |
| Declarative edits, idempotent appliers, same-build merge, carry refusal / `--history` | 1, 2, 12 |
| `amendsPresenters` existence check | 12, 13 |
| Load commit records edits; resume compares them | 12 |
| Build fitness runs the appliers | 13 |
| Docs, typeLabels, sharedFiles, 4.1.0 | 14 |
| Tests: appliers, converters, type, load-ops, writers extraction | 1-13 |
