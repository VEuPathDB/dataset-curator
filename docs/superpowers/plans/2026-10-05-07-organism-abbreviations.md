# Organism Abbreviation Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `docs/superpowers/specs/2026-10-05-organism-abbreviation-lifecycle-design.md`: Phase 1 proposes organism abbreviations and cross-checks them against a curator-named rebuild branch; Phase 2 settles them before rendering and stops for a person on every conflict.

**Architecture:** One new pure module, `shared/scripts/lib/organisms.js`, owns the abbreviation shape, the naming convention, the organism index read from a git ref, the Phase 1 cross-check and the Phase 2 settlement. It takes git refs and returns plain data; callers decide what to throw. The manifest moves to `schemaVersion: 3` with one `organisms` array for every dataset type. Phase 2 renders from a scratch copy of the proposal whose manifest carries the settled abbreviations, so the renderers stay unchanged.

**Tech Stack:** Node 18 ESM, zero dependencies, `node:test`, `gh` CLI (stubbed in tests), git fixture repos from `tests/helpers.js`.

**Working copy:** a worktree on branch `feature/organism-abbreviations` off `main`. Edit only `shared/`, `tests/`, `docs/`, `skills/*/SKILL.md`, `skills/*/resources/step-*.md`, `package.json`. The pre-commit hook (`yarn sync-shared`) copies `shared/` into `skills/`; a new shared file must also be listed in `package.json` `sharedFiles` (Task 9).

Run the suite with `npm test`. Baseline: 404 pass, 1 skipped.

---

## Decisions this plan rests on

These came out of design review on 2026-10-05 and are recorded in the spec's addendum.

- **No v2 dual-read.** One v2 proposal is in flight (PRJNA749283, the demo). It is re-written as v3 after merge (Task 11) instead of carrying v2 support.
- **Dependent datasets resolve by taxon and strain.** An RNA-seq organism linked to a genome proposal settles to the organism file on the rebuild branch whose `ncbiTaxonId` and `strainAbbrev` constants match the genome proposal's. All 840 organism files record `ncbiTaxonId`; 839 record `strainAbbrev`. A genome proposal without a taxon id falls back to an exact abbreviation match.
- **Genome loads do not yet write the organism file.** The genome renderer still produces only the presenter; the organism file (constants plus genome datasets) comes with the genome demo. Until then a dependent dataset stops in Phase 2 with "genome not loaded", which is the correct conservative answer.
- **A person settles with `--settle <proposed>=<abbrev>`.** It clears stops a person may decide (convention deviation, ambiguous match, mismatch with the genome's taxon/strain). It never clears an abbreviation that already exists, a rival claim, or a missing organism file.

## File map

| File | Change |
|---|---|
| `shared/scripts/lib/git-ops.js` | `listTree(ref, dir)`, `grepOnRef(ref, pattern, pathspec)` |
| `shared/scripts/lib/organisms.js` | **new**: shape, convention, index, claims, cross-check, settlement |
| `shared/scripts/lib/manifest.js` | schemaVersion 3; `organisms` array; drop per-type organism fields |
| `shared/scripts/dataset-types/genome-assembly.js` | `organismRule`; `deriveOrganism`; name from `organismsOf` |
| `shared/scripts/dataset-types/bulk-rnaseq.js` | `organismRule` |
| `shared/scripts/dataset-types/_common.js` | `organism` overrides section |
| `shared/scripts/lib/proposal-ops.js` | build `organisms`; cross-check on `--rebuild-branch`; name check from the ref |
| `shared/scripts/write-proposal.js` | `--rebuild-branch` |
| `shared/scripts/lib/load-ops.js` | settle before render; render from settled scratch copy; `checkOrganisms` |
| `shared/scripts/load-proposal.js` | `--settle` |
| `shared/scripts/check-organisms.js` | **new**: build-wide report |
| `package.json` | `sharedFiles` for the two new files |
| `tests/organisms.test.js` | **new** |
| `tests/fixtures/**` | v3 manifests; genome fixture becomes `tfakST-1`; organism constants |
| skill and workflow docs | Task 10 |

---

### Task 1: git reads a tree and greps on a ref

**Files:**
- Modify: `shared/scripts/lib/git-ops.js` (inside the returned object, after `listDir`)
- Test: `tests/git-ops.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `tests/git-ops.test.js`, adding `initRepo` to its `./helpers.js` import if it is not there:

```js
test('listTree lists every file under a directory on a ref, and nothing for a missing one', () => {
  const { repo } = initRepo();
  const git = createGit(repo);
  assert.deepEqual(git.listTree('HEAD', 'Datasets/lib/xml/datasets'), ['Datasets/lib/xml/datasets/FungiDB/tfakST1.xml']);
  assert.deepEqual(git.listTree('HEAD', 'Nowhere'), []);
});

test('grepOnRef returns matching lines with their paths, and nothing when none match', () => {
  const { repo } = initRepo();
  const git = createGit(repo);
  assert.deepEqual(git.grepOnRef('HEAD', '<constant name="organismAbbrev"', 'Datasets/lib/xml/datasets'),
    [{ path: 'Datasets/lib/xml/datasets/FungiDB/tfakST1.xml', text: '  <constant name="organismAbbrev" value="tfakST1"/>' }]);
  assert.deepEqual(git.grepOnRef('HEAD', 'no such text', 'Datasets'), []);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test tests/git-ops.test.js`
Expected: FAIL, `git.listTree is not a function`

- [ ] **Step 3: Implement**

In `shared/scripts/lib/git-ops.js`, after `listDir`:

```js
    /** Every file path under dir on ref, recursively; empty when dir is absent there. */
    listTree: (ref, dir) => {
      const out = git('ls-tree', '-r', '--name-only', ref, '--', `${dir}/`);
      return out ? out.split('\n') : [];
    },
    /** Lines matching extended regex pattern in files under pathspec on ref, as { path, text }. */
    grepOnRef: (ref, pattern, pathspec) => {
      let out;
      // git grep exits 1 when nothing matches.
      try { out = git('grep', '--no-color', '-E', '-e', pattern, ref, '--', pathspec); }
      catch (err) { if (err.status === 1) return []; throw err; }
      return out ? out.split('\n').map((line) => {
        const rest = line.slice(ref.length + 1);
        const at = rest.indexOf(':');
        return { path: rest.slice(0, at), text: rest.slice(at + 1) };
      }) : [];
    },
```

- [ ] **Step 4: Run them to see them pass**

Run: `node --test tests/git-ops.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add shared/scripts/lib/git-ops.js tests/git-ops.test.js
git commit -m "git-ops: list a tree and grep on a ref"
```

---

### Task 2: Abbreviation shape and naming convention

**Files:**
- Create: `shared/scripts/lib/organisms.js`
- Test: `tests/organisms.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/organisms.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ABBREV_SHAPE, strainAbbrevOf, conventionalAbbrev } from '../shared/scripts/lib/organisms.js';

test('the shape admits every abbreviation in use and refuses path and markup characters', () => {
  for (const ok of ['pfal3D7', 'bcinB05-10', 'acspSK_2022a', 'aellCBS707.79']) assert.ok(ABBREV_SHAPE.test(ok), ok);
  for (const bad of ['', '.hidden', '-flag', 'a/b', 'a b', 'a"b', 'a&b']) assert.ok(!ABBREV_SHAPE.test(bad), bad);
});

test('a strain abbreviation replaces "." with "-" and spaces with "_"', () => {
  assert.equal(strainAbbrevOf('B05.10'), 'B05-10');
  assert.equal(strainAbbrevOf(' Friedlin V1 '), 'Friedlin_V1');
  assert.equal(strainAbbrevOf('3D7'), '3D7');
});

test('the convention is genus initial, three species letters, then the strain abbreviation', () => {
  assert.equal(conventionalAbbrev({ species: 'Plasmodium falciparum', strain: '3D7' }), 'pfal3D7');
  assert.equal(conventionalAbbrev({ species: 'Botrytis cinerea', strain: 'B05.10' }), 'bcinB05-10');
  assert.equal(conventionalAbbrev({ species: 'Leishmania major', strain: 'Friedlin V1' }), 'lmajFriedlin_V1');
  assert.equal(conventionalAbbrev({ species: 'Testus fakeus', strain: '' }), 'tfak');
});

test('no convention applies without a genus and a lettered species epithet', () => {
  assert.equal(conventionalAbbrev({ species: 'Leishmania sp.', strain: 'X' }), null);
  assert.equal(conventionalAbbrev({ species: 'Plasmodium', strain: '3D7' }), null);
  assert.equal(conventionalAbbrev({ species: undefined, strain: '3D7' }), null);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test tests/organisms.test.js`
Expected: FAIL, cannot find module `organisms.js`

- [ ] **Step 3: Implement**

Create `shared/scripts/lib/organisms.js`:

```js
export const ABBREV_SHAPE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
export const SHAPE_RULE = 'letters, digits, ".", "_" or "-", starting with a letter or digit';

export const strainAbbrevOf = (strain) => strain.trim().replace(/\./g, '-').replace(/\s+/g, '_');

/** <g><sp><Strain>, or null when species is not a genus and a lettered epithet of three or more letters. */
export function conventionalAbbrev({ species, strain = '' }) {
  const [genus, epithet] = (species ?? '').trim().split(/\s+/);
  if (!/^[A-Za-z]/.test(genus ?? '') || !/^[A-Za-z]{3,}$/.test(epithet ?? '')) return null;
  return `${genus[0]}${epithet.slice(0, 3)}`.toLowerCase() + strainAbbrevOf(strain);
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `node --test tests/organisms.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add shared/scripts/lib/organisms.js tests/organisms.test.js
git commit -m "organisms: abbreviation shape and naming convention"
```

---

### Task 3: The organisms a ref holds, and the genomes proposals claim

**Files:**
- Modify: `shared/scripts/lib/organisms.js`
- Test: `tests/organisms.test.js`

`organisms.js` imports path constants from `manifest.js`, and Task 4 makes `manifest.js` import `ABBREV_SHAPE` from here. The cycle is safe because neither module reads the other's bindings at load time.

- [ ] **Step 1: Write the failing tests**

Append to `tests/organisms.test.js`, and extend its imports:

```js
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createGit } from '../shared/scripts/lib/git-ops.js';
import { readOrganismIndex, pendingGenomeProposals, genomeOrganismOf } from '../shared/scripts/lib/organisms.js';
import { initRepo } from './helpers.js';

/** Writes files (path -> text) into repo and commits them. */
function commitFiles(repo, files, message = 'files') {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), text);
  }
  execFileSync('git', ['-C', repo, 'add', '-A']);
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', message]);
}

const organismFile = (abbrev, taxon, strain) => `<?xml version="1.0"?>\n<datasets>\n  <constant name="organismAbbrev" value="${abbrev}"/>\n` +
  (taxon ? `  <constant name="ncbiTaxonId" value="${taxon}"/>\n` : '') +
  (strain ? `  <constant name="strainAbbrev" value="${strain}"/>\n` : '') + '</datasets>\n';

const genomeManifest = (accession, abbrev, extra = {}) => JSON.stringify({
  schemaVersion: 3, accession, datasetType: 'genome-assembly', project: 'FungiDB',
  organisms: [{ proposedOrganismAbbrev: abbrev, source: 'new', species: 'Testus fakeus', strain: 'ST 9', ncbiTaxonId: '999009', ...extra }]
});

test('the organism index lists every organism file with its taxon and strain constants', () => {
  const { repo } = initRepo();
  commitFiles(repo, {
    'Datasets/lib/xml/datasets/ToxoDB/tgonME49.xml': organismFile('tgonME49', '508771', 'ME49'),
    'Datasets/lib/xml/datasets/ToxoDB.xml': '<datasets/>\n',
    'Datasets/lib/xml/datasets/ToxoDB/tgonME49/extra.xml': organismFile('nested', '1', 'X')
  });
  const index = readOrganismIndex(createGit(repo), 'HEAD');
  assert.deepEqual(index.sort((a, b) => a.abbrev.localeCompare(b.abbrev)), [
    { abbrev: 'tfakST1', project: 'FungiDB', ncbiTaxonId: undefined, strainAbbrev: undefined },
    { abbrev: 'tgonME49', project: 'ToxoDB', ncbiTaxonId: '508771', strainAbbrev: 'ME49' }
  ]);
});

test('pending genome proposals are read from each ref, unvalidated, first ref winning', () => {
  const { repo } = initRepo();
  commitFiles(repo, {
    'Proposals/GCA_9.1/manifest.json': genomeManifest('GCA_9.1', 'tfakST_9'),
    'Proposals/PRJNA9/manifest.json': JSON.stringify({ accession: 'PRJNA9', organisms: [{ proposedOrganismAbbrev: 'tfakST1', source: 'loaded' }] }),
    'Proposals/BROKEN/manifest.json': '{ not json'
  });
  const claims = pendingGenomeProposals(createGit(repo), ['HEAD', 'HEAD']);
  assert.deepEqual(claims.map((c) => [c.accession, c.project, c.organism.proposedOrganismAbbrev]), [['GCA_9.1', 'FungiDB', 'tfakST_9']]);
});

test('a genome proposal deleted by its load is found in the history', () => {
  const { repo } = initRepo();
  commitFiles(repo, { 'Proposals/GCA_9.1/manifest.json': genomeManifest('GCA_9.1', 'tfakST_9') });
  execFileSync('git', ['-C', repo, 'rm', '-q', '-r', 'Proposals/GCA_9.1']);
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'load GCA_9.1']);
  const git = createGit(repo);
  assert.equal(genomeOrganismOf(git, 'HEAD', 'GCA_9.1').ncbiTaxonId, '999009');
  assert.equal(genomeOrganismOf(git, 'HEAD', 'GCA_NONE.1'), null);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test tests/organisms.test.js`
Expected: FAIL, `readOrganismIndex` is not exported

- [ ] **Step 3: Implement**

Add to `shared/scripts/lib/organisms.js`:

```js
import { PROPOSALS_DIR, MANIFEST_FILENAME, proposalRelativePath } from './manifest.js';

const DATASETS_DIR = 'Datasets/lib/xml/datasets';
const ORGANISM_FILE = /^Datasets\/lib\/xml\/datasets\/([^/]+)\/([^/]+)\.xml$/;
const CONSTANT = /<constant\s+name="(ncbiTaxonId|strainAbbrev)"\s+value="([^"]*)"/;

/** Every organism file on ref as { abbrev, project, ncbiTaxonId, strainAbbrev }; a constant the file lacks is undefined. */
export function readOrganismIndex(git, ref) {
  const byPath = new Map();
  for (const path of git.listTree(ref, DATASETS_DIR)) {
    const [, project, abbrev] = ORGANISM_FILE.exec(path) ?? [];
    if (abbrev) byPath.set(path, { abbrev, project, ncbiTaxonId: undefined, strainAbbrev: undefined });
  }
  for (const { path, text } of git.grepOnRef(ref, '<constant +name="(ncbiTaxonId|strainAbbrev)"', DATASETS_DIR)) {
    const [, name, value] = CONSTANT.exec(text) ?? [];
    const entry = byPath.get(path);
    if (entry && name) entry[name] = value;
  }
  return [...byPath.values()];
}

const newOrganismIn = (m) => (Array.isArray(m?.organisms) ? m.organisms.find((o) => o?.source === 'new') : undefined) ?? null;

const parseManifestOn = (git, ref, accession) => {
  try { return JSON.parse(git.showFile(ref, `${proposalRelativePath(accession)}/${MANIFEST_FILENAME}`)); }
  catch { return null; }
};

/** Genome proposals on refs, read unvalidated, as { accession, project, organism }; the first ref to hold an accession wins. */
export function pendingGenomeProposals(git, refs) {
  const found = new Map();
  for (const ref of refs) {
    for (const accession of git.listDir(ref, PROPOSALS_DIR)) {
      if (found.has(accession)) continue;
      const m = parseManifestOn(git, ref, accession);
      const organism = newOrganismIn(m);
      if (organism) found.set(accession, { accession, project: m.project, organism });
    }
  }
  return [...found.values()];
}

/** The new organism of genome proposal accession as ref, or the history behind it, last had it; null if never. */
export function genomeOrganismOf(git, ref, accession) {
  const path = `${proposalRelativePath(accession)}/${MANIFEST_FILENAME}`;
  if (git.fileExistsOnRef(ref, path)) return newOrganismIn(parseManifestOn(git, ref, accession));
  const deletion = git.commitsForPath(ref, path).pop();
  return deletion ? newOrganismIn(parseManifestOn(git, `${deletion}~1`, accession)) : null;
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `node --test tests/organisms.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add shared/scripts/lib/organisms.js tests/organisms.test.js
git commit -m "organisms: index a ref's organism files and find genome proposals"
```

---

### Task 4: Manifest schemaVersion 3

One `organisms` array replaces the per-type fields (`organismAbbrev`, `referenceOrganismAbbrev`, `additionalOrganismAbbrevs`). A dataset type declares `organismRule`: `{ new: true, max: 1 }` for a type that introduces its organism, `{ new: false }` for one that uses loaded organisms.

Entry shapes:

```json
{ "proposedOrganismAbbrev": "tfakST-1", "source": "new", "species": "Testus fakeus", "strain": "ST-1", "ncbiTaxonId": "999001" }
{ "proposedOrganismAbbrev": "tfakST1", "source": "loaded" }
{ "proposedOrganismAbbrev": "tfakST-1", "source": { "proposal": "GCA_000001.1" } }
```

`organismAbbrev` on an entry is the settled value. Only Phase 2's scratch copy carries it; Phase 1 never writes it.

The genome fixture moves to `tfakST-1`, the conventional abbreviation for *Testus fakeus* ST-1, because `tfakST1` is a loaded organism in every fixture repo and Phase 2 would rightly stop a genome that redefines it.

**Files:**
- Modify: `shared/scripts/lib/manifest.js`, `shared/scripts/dataset-types/genome-assembly.js`, `shared/scripts/dataset-types/bulk-rnaseq.js`, `shared/scripts/dataset-types/_common.js`, `shared/scripts/lib/proposal-ops.js`
- Modify fixtures: `tests/fixtures/proposals/{GCA_000001.1,PRJNA000002,PRJNA000003}/manifest.json`, `tests/fixtures/proposals/GCA_000001.1/expected.xml`, `tests/fixtures/proposals/GCA_000001.1/inputs/GCA_000001.1_dataset_report.json`
- Modify tests: `tests/manifest.test.js`, `tests/helpers.js`, and every test listed by `grep -ln "organismAbbrev\|referenceOrganismAbbrev\|additionalOrganismAbbrevs\|schemaVersion: 2\|tfakST1_primary_genome" tests/*.test.js`

- [ ] **Step 1: Rewrite the manifest organism tests**

In `tests/manifest.test.js`, change `valid()` to:

```js
function valid() {
  return {
    schemaVersion: 3,
    accession: 'PRJNA123456',
    datasetType: 'bulk-rnaseq',
    project: 'FungiDB',
    organisms: [{ proposedOrganismAbbrev: 'afumAf293', source: 'loaded' }],
    contacts: { primary: 'jane.doe', additional: ['ravi.kumar'] },
    curator: 'someone@apidb.org',
    createdAt: '2026-09-18T14:00:00.000Z',
    skill: { name: 'propose-bulk-rnaseq', version: '2.0.0' }
  };
}

const genome = (organism = {}) => ({
  ...valid(), accession: 'GCA_000001.1', datasetType: 'genome-assembly',
  organisms: [{ proposedOrganismAbbrev: 'tfakST-1', source: 'new', species: 'Testus fakeus', strain: 'ST-1', ncbiTaxonId: '999001', ...organism }]
});
```

Delete every existing test that names `referenceOrganismAbbrev`, `additionalOrganismAbbrevs` or `organismAbbrev`, and add:

```js
test('schemaVersion 3 is the only version', () => {
  assert.ok(validate({ ...valid(), schemaVersion: 2 }).includes('schemaVersion must be one of 3'));
});

test('v2 organism fields are refused with the way forward', () => {
  for (const k of ['organismAbbrev', 'referenceOrganismAbbrev', 'additionalOrganismAbbrevs']) {
    assert.ok(validate({ ...valid(), [k]: 'x' }).includes(`${k} is a schemaVersion 2 field; re-run write-proposal.js`), k);
  }
});

test('organisms must be a non-empty array of objects', () => {
  assert.ok(validate({ ...valid(), organisms: [] }).includes('organisms must be a non-empty array'));
  assert.ok(validate({ ...valid(), organisms: 'tfakST1' }).includes('organisms must be a non-empty array'));
  assert.ok(validate({ ...valid(), organisms: ['tfakST1'] }).includes('organisms[0] must be an object'));
});

test('a proposed abbreviation must have the abbreviation shape', () => {
  for (const ok of ['bcinB05-10', 'acspSK_2022a', 'aellCBS707.79']) {
    assert.deepEqual(validate({ ...valid(), organisms: [{ proposedOrganismAbbrev: ok, source: 'loaded' }] }), [], ok);
  }
  assert.ok(validate({ ...valid(), organisms: [{ proposedOrganismAbbrev: 'a/b', source: 'loaded' }] })
    .includes('organisms[0].proposedOrganismAbbrev must be letters, digits, ".", "_" or "-", starting with a letter or digit'));
});

test('an organism of a type using loaded organisms is loaded or links a genome proposal', () => {
  const link = { proposedOrganismAbbrev: 'tfakST-1', source: { proposal: 'GCA_000001.1' } };
  assert.deepEqual(validate({ ...valid(), organisms: [{ proposedOrganismAbbrev: 'tfakST1', source: 'loaded' }, link] }), []);
  assert.ok(validate({ ...valid(), organisms: [{ proposedOrganismAbbrev: 'tfakST1', source: 'new' }] })
    .includes('organisms[0].source must be "loaded" or { "proposal": "<genome accession>" }'));
  assert.ok(validate({ ...valid(), organisms: [{ proposedOrganismAbbrev: 'tfakST1', source: 'loaded', species: 'X y' }] })
    .includes('organisms[0].species belongs to genome proposals'));
});

test('a genome organism is new and names its species and strain; the taxon id is optional digits', () => {
  assert.deepEqual(validate(genome()), []);
  assert.deepEqual(validate(genome({ ncbiTaxonId: undefined })), []);
  assert.deepEqual(validate(genome({ strain: '' })), []);
  assert.ok(validate(genome({ source: 'loaded' })).includes('organisms[0].source must be "new" for genome-assembly'));
  assert.ok(validate(genome({ species: 'Testus' })).includes('organisms[0].species must name a genus and species'));
  assert.ok(validate(genome({ strain: undefined })).includes('organisms[0].strain must be a string, empty when the organism has none'));
  assert.ok(validate(genome({ ncbiTaxonId: 999001 })).includes('organisms[0].ncbiTaxonId must be a string of digits'));
});

test('a genome proposal has one organism; no proposal lists an organism twice', () => {
  const g = genome();
  assert.ok(validate({ ...g, organisms: [g.organisms[0], { ...g.organisms[0], proposedOrganismAbbrev: 'tfakST-2' }] })
    .includes('genome-assembly proposals have at most 1 organism'));
  const twice = { proposedOrganismAbbrev: 'tfakST1', source: 'loaded' };
  assert.ok(validate({ ...valid(), organisms: [twice, twice] }).includes('organisms lists tfakST1 twice'));
});

test('a settled abbreviation, when present, has the abbreviation shape', () => {
  const settled = { proposedOrganismAbbrev: 'tfakST1', source: 'loaded', organismAbbrev: 'tfakST1' };
  assert.deepEqual(validate({ ...valid(), organisms: [settled] }), []);
  assert.ok(validate({ ...valid(), organisms: [{ ...settled, organismAbbrev: 'a b' }] })
    .includes('organisms[0].organismAbbrev must be letters, digits, ".", "_" or "-", starting with a letter or digit'));
});

test('organismsOf lists settled abbreviations where present, proposed ones otherwise', () => {
  const m = { ...valid(), organisms: [{ proposedOrganismAbbrev: 'a1', source: 'loaded', organismAbbrev: 'b1' }, { proposedOrganismAbbrev: 'a2', source: 'loaded' }] };
  assert.deepEqual(organismsOf(m), ['b1', 'a2']);
});
```

Change every remaining `schemaVersion: 2` in the file to `schemaVersion: 3`.

- [ ] **Step 2: Run them to see them fail**

Run: `node --test tests/manifest.test.js`
Expected: FAIL on the new tests

- [ ] **Step 3: Implement the schema**

In `shared/scripts/lib/manifest.js`:

1. Add `import { ABBREV_SHAPE, SHAPE_RULE } from './organisms.js';` and delete `const ABBREV = ...`.
2. `export const SUPPORTED_SCHEMA_VERSIONS = [3];`
3. Replace `organismFieldsOf`, `organismKeys`, `organismsOf`, `organismsFor` and `organismErrors` with:

```js
const LEGACY_ORGANISM_KEYS = ['organismAbbrev', 'referenceOrganismAbbrev', 'additionalOrganismAbbrevs'];
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Whether a dataset type introduces its organism ({ new: true, max }) or uses loaded ones ({ new: false }). */
export function organismRuleOf(datasetType) {
  if (!datasetTypeExists(datasetType)) throw new Error(unknownDatasetType(datasetType));
  const rule = DATASET_TYPES[datasetType].organismRule;
  if (typeof rule?.new !== 'boolean') throw new Error(`dataset-types/${datasetType}.js must export organismRule with a boolean "new"`);
  return rule;
}

/** The organisms a proposal touches, primary first: settled abbreviations where Phase 2 has set them. */
export const organismsOf = (m) => m.organisms.map((o) => o.organismAbbrev ?? o.proposedOrganismAbbrev);

function organismEntryErrors(o, at, rule, datasetType) {
  if (!isObject(o)) return [`${at} must be an object`];
  const errors = [];
  for (const k of ['proposedOrganismAbbrev', 'organismAbbrev']) {
    if (k === 'organismAbbrev' && o[k] === undefined) continue;
    if (typeof o[k] !== 'string' || !ABBREV_SHAPE.test(o[k])) errors.push(`${at}.${k} must be ${SHAPE_RULE}`);
  }
  if (rule.new) {
    if (o.source !== 'new') errors.push(`${at}.source must be "new" for ${datasetType}`);
    if (typeof o.species !== 'string' || !/^\S+\s+\S+/.test(o.species.trim())) errors.push(`${at}.species must name a genus and species`);
    if (typeof o.strain !== 'string') errors.push(`${at}.strain must be a string, empty when the organism has none`);
    if (o.ncbiTaxonId !== undefined && (typeof o.ncbiTaxonId !== 'string' || !/^\d+$/.test(o.ncbiTaxonId))) {
      errors.push(`${at}.ncbiTaxonId must be a string of digits`);
    }
    return errors;
  }
  const linked = isObject(o.source) && typeof o.source.proposal === 'string' && /^[A-Za-z0-9_.]+$/.test(o.source.proposal);
  if (o.source !== 'loaded' && !linked) errors.push(`${at}.source must be "loaded" or { "proposal": "<genome accession>" }`);
  for (const k of ['species', 'strain', 'ncbiTaxonId']) {
    if (o[k] !== undefined) errors.push(`${at}.${k} belongs to genome proposals`);
  }
  return errors;
}

function organismErrors(m) {
  const errors = LEGACY_ORGANISM_KEYS.filter((k) => m[k] !== undefined)
    .map((k) => `${k} is a schemaVersion 2 field; re-run write-proposal.js`);
  if (!datasetTypeExists(m.datasetType)) return errors;
  const rule = organismRuleOf(m.datasetType);
  if (!Array.isArray(m.organisms) || m.organisms.length === 0) return [...errors, 'organisms must be a non-empty array'];
  if (rule.max && m.organisms.length > rule.max) {
    errors.push(`${m.datasetType} proposals have at most ${rule.max} organism${rule.max === 1 ? '' : 's'}`);
  }
  m.organisms.forEach((o, i) => errors.push(...organismEntryErrors(o, `organisms[${i}]`, rule, m.datasetType)));
  const proposed = m.organisms.map((o) => o?.proposedOrganismAbbrev).filter((p) => typeof p === 'string');
  for (const p of new Set(proposed.filter((p, i) => proposed.indexOf(p) !== i))) errors.push(`organisms lists ${p} twice`);
  return errors;
}
```

- [ ] **Step 4: Dataset types declare their rule; the genome derives its organism**

In `shared/scripts/dataset-types/bulk-rnaseq.js` replace the `organismFields` line with:

```js
export const organismRule = { new: false };
```

In `shared/scripts/dataset-types/genome-assembly.js`, replace the `node:path` import and add two more (the `manifest.js` cycle is the one `bulk-rnaseq.js` already has):

```js
import { readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { organismsOf } from '../lib/manifest.js';
```

Replace the `organismFields` line with:

```js
export const organismRule = { new: true, max: 1 };

/** Phase 1: species, strain and NCBI taxon id from the assembly report, curator overrides winning. */
export function deriveOrganism(inputs, accession, overrides = {}) {
  const reportFile = inputs.find((f) => basename(f) === `${accession}_dataset_report.json`);
  const organism = reportFile ? JSON.parse(readFileSync(reportFile, 'utf-8')).reports?.[0]?.organism : undefined;
  const taxId = overrides.ncbiTaxonId ?? (organism?.tax_id === undefined ? undefined : String(organism.tax_id));
  return {
    species: overrides.species ?? (organism?.organism_name ?? '').trim().split(/\s+/).slice(0, 2).join(' '),
    strain: overrides.strain ?? organism?.infraspecific_names?.strain ?? '',
    ...(taxId === undefined ? {} : { ncbiTaxonId: taxId })
  };
}
```

and change `nameFor` to:

```js
const nameFor = (m) => `${organismsOf(m)[0]}_primary_genome_RSRC`;
```

In `shared/scripts/dataset-types/_common.js`:

```js
export const OVERRIDE_SECTIONS = ['name', 'version', 'presenter', 'dataset', 'organism'];
const ORGANISM_OVERRIDE_KEYS = ['species', 'strain', 'ncbiTaxonId'];
```

and in `readOverrides` extend the section loop:

```js
  for (const [section, allowed] of [['presenter', PRESENTER_OVERRIDE_KEYS], ['dataset', DATASET_OVERRIDE_KEYS], ['organism', ORGANISM_OVERRIDE_KEYS]]) {
```

- [ ] **Step 5: writeProposal builds the organisms array**

In `shared/scripts/lib/proposal-ops.js`:

1. Import `organismsOf` and `organismRuleOf` from `./manifest.js`; drop `organismsFor` and `organismKeys`.
2. `manifestOrder`: replace `...organismKeys()` with `'organisms'`.
3. Replace `organismsIn`:

```js
/** Other proposals on master are read unvalidated. */
const organismsIn = (m) => (Array.isArray(m.organisms) ? m.organisms : [])
  .map((o) => o?.proposedOrganismAbbrev).filter((a) => typeof a === 'string' && a !== '');
```

4. In `writeProposal`, move `const overrideValues = readOverrides(overrides);` and `const datasetType = await loadDatasetType(manifestInput.datasetType);` above the manifest literal, and replace `...organismsFor(manifestInput),` with `organisms: organismsFrom(datasetType, manifestInput, inputs, overrideValues.organism),`. Add above `writeProposal`:

```js
/** The proposal's organisms as the curator named them: introduced by a genome, otherwise loaded. */
function organismsFrom(datasetType, { accession, datasetType: type, organism, additionalOrganisms = [] }, inputs, organismOverrides) {
  const rule = organismRuleOf(type);
  if (organismOverrides && !rule.new) throw new Error(`${type} proposals take no "organism" overrides; they apply to genome proposals`);
  if (rule.max && 1 + additionalOrganisms.length > rule.max) throw new Error(`${type} proposals align to one organism; --also-organism is not allowed`);
  return [organism, ...additionalOrganisms].map((proposedOrganismAbbrev) => (rule.new
    ? { proposedOrganismAbbrev, source: 'new', ...datasetType.deriveOrganism(inputs, accession, organismOverrides) }
    : { proposedOrganismAbbrev, source: 'loaded' }));
}
```

5. In the manifest literal, `schemaVersion: 2` becomes `schemaVersion: 3`. Remove the later duplicate `const datasetType = await loadDatasetType(...)` and `const overrideValues = ...`.

- [ ] **Step 6: Migrate fixtures and tests**

`tests/fixtures/proposals/GCA_000001.1/manifest.json`: `"schemaVersion": 3` and replace the `organismAbbrev` line with

```json
  "organisms": [{ "proposedOrganismAbbrev": "tfakST-1", "source": "new", "species": "Testus fakeus", "strain": "ST-1", "ncbiTaxonId": "999001" }],
```

`tests/fixtures/proposals/GCA_000001.1/inputs/GCA_000001.1_dataset_report.json`: the organism becomes `{ "organism_name": "Testus fakeus", "tax_id": 999001, "infraspecific_names": { "strain": "ST-1" } }`.

`tests/fixtures/proposals/GCA_000001.1/expected.xml`: `tfakST1_primary_genome_RSRC` becomes `tfakST-1_primary_genome_RSRC`.

`tests/fixtures/proposals/PRJNA00000{2,3}/manifest.json`: `"schemaVersion": 3`, and the two organism lines become

```json
  "organisms": [{ "proposedOrganismAbbrev": "tfakST1", "source": "loaded" }],
```

Add to `tests/helpers.js`:

```js
/** A v3 organisms array of loaded organisms. */
export const loaded = (...abbrevs) => abbrevs.map((proposedOrganismAbbrev) => ({ proposedOrganismAbbrev, source: 'loaded' }));
```

Then in each file from the `grep -ln` above:
- `schemaVersion: 2` becomes `schemaVersion: 3`.
- `referenceOrganismAbbrev: X, additionalOrganismAbbrevs: [Y, ...]` (or `setManifestFields(..., { additionalOrganismAbbrevs: [Y] })`) becomes `organisms: loaded(X, Y, ...)`, importing `loaded` from `./helpers.js`.
- A genome `organismAbbrev: 'tfakST1'` (for example `plantedManifest` in `tests/proposal-ops.test.js`) becomes `organisms: [{ proposedOrganismAbbrev: 'tfakST-1', source: 'new', species: 'Testus fakeus', strain: 'ST-1', ncbiTaxonId: '999001' }]`.
- `manifestInput.organism: 'tfakST1'` for the genome in `tests/proposal-ops.test.js` becomes `'tfakST-1'`.
- `tfakST1_primary_genome_RSRC` becomes `tfakST-1_primary_genome_RSRC`.
- A test asserting `organismFields`, `organismKeys` or `organismsFor` is rewritten against `organismRule` and the `organisms` array, or deleted when Step 1 already covers it.

- [ ] **Step 7: Run the suite**

Run: `npm test`
Expected: PASS. Fix any remaining v2 shape the failures name.

- [ ] **Step 8: Commit**

```bash
git add shared tests
git commit -m "Manifest schemaVersion 3: one organisms array with proposed abbreviations"
```

---

### Task 5: The Phase 1 cross-check

**Files:**
- Modify: `shared/scripts/lib/organisms.js`
- Test: `tests/organisms.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `tests/organisms.test.js`, extending the import with `crossCheckOrganisms`:

```js
const INDEX = [
  { abbrev: 'tfakST1', project: 'FungiDB', ncbiTaxonId: '999000', strainAbbrev: 'ST1' },
  { abbrev: 'tgonME49', project: 'ToxoDB', ncbiTaxonId: '508771', strainAbbrev: 'ME49' }
];
const newOrganism = (o = {}) => ({ proposedOrganismAbbrev: 'tfakST-1', source: 'new', species: 'Testus fakeus', strain: 'ST-1', ncbiTaxonId: '999001', ...o });
const genomeDraft = (o) => ({ accession: 'GCA_1.1', project: 'FungiDB', organisms: [newOrganism(o)] });
const rnaDraft = (...abbrevs) => ({ accession: 'PRJNA1', project: 'FungiDB', organisms: abbrevs.map((p) => ({ proposedOrganismAbbrev: p, source: 'loaded' })) });
const claim = (accession, o) => ({ accession, project: 'FungiDB', organism: newOrganism(o) });
const check = (m, claims = []) => crossCheckOrganisms(m, { index: INDEX, claims, rebuild: 'rebuild02' });

test('a new genome passes when nothing claims it and it follows the convention', () => {
  assert.deepEqual(check(genomeDraft()), { organisms: [newOrganism()], errors: [], warnings: [] });
});

test('a new genome whose abbreviation exists in any project is refused', () => {
  const { errors } = check(genomeDraft({ proposedOrganismAbbrev: 'tgonME49' }));
  assert.deepEqual(errors, ['tgonME49 already names ToxoDB/tgonME49.xml on rebuild02: the organism is redundant or the abbreviation is wrong']);
});

test('a new genome with a loaded taxon and strain is refused as redundant', () => {
  const { errors } = check(genomeDraft({ ncbiTaxonId: '999000', strain: 'ST1', proposedOrganismAbbrev: 'tfakST1x' }));
  assert.ok(errors.includes('taxon 999000 strain ST1 is already loaded as FungiDB/tfakST1 on rebuild02'));
});

test('a new genome claimed by another genome proposal is refused; its own claim is not a rival', () => {
  assert.deepEqual(check(genomeDraft(), [claim('GCA_2.1')]).errors, ['tfakST-1 is already proposed by genome proposal GCA_2.1']);
  assert.deepEqual(check(genomeDraft(), [claim('GCA_1.1')]).errors, []);
});

test('a new genome off the convention is a warning that Phase 2 will stop on', () => {
  assert.deepEqual(check(genomeDraft({ proposedOrganismAbbrev: 'tfakST1x' })).warnings,
    ['tfakST1x differs from the convention tfakST-1; Phase 2 will stop for a person to decide']);
  assert.deepEqual(check(genomeDraft({ species: 'Testus sp.' })).warnings,
    ['no conventional abbreviation can be derived from species "Testus sp."; Phase 2 will stop for a person to decide']);
});

test('a loaded organism in the project is settled as loaded', () => {
  assert.deepEqual(check(rnaDraft('tfakST1')), { organisms: [{ proposedOrganismAbbrev: 'tfakST1', source: 'loaded' }], errors: [], warnings: [] });
});

test('an organism of another project is refused', () => {
  assert.deepEqual(check(rnaDraft('tgonME49')).errors, ['tgonME49 is a ToxoDB organism on rebuild02, not FungiDB']);
});

test('an organism only a pending genome proposes is linked to it, with a warning', () => {
  const result = check(rnaDraft('tfakST-1'), [claim('GCA_1.1')]);
  assert.deepEqual(result.organisms, [{ proposedOrganismAbbrev: 'tfakST-1', source: { proposal: 'GCA_1.1' } }]);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, ['tfakST-1 is not loaded: genome proposal GCA_1.1 proposes it, so it is not settled. This dataset loads in the same build as that genome or later.']);
});

test('an organism nothing knows is refused', () => {
  assert.deepEqual(check(rnaDraft('nope1')).errors, ['nope1 is not an organism on rebuild02 and no genome proposal on master proposes it']);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test tests/organisms.test.js`
Expected: FAIL, `crossCheckOrganisms` is not exported

- [ ] **Step 3: Implement**

Add to `shared/scripts/lib/organisms.js`. `newOrganismConflicts` is shared with Task 7's settlement.

```js
const claimedAbbrev = (c) => c.organism.organismAbbrev ?? c.organism.proposedOrganismAbbrev;

/** Why abbrev cannot name the new organism o of proposal accession: it exists, its taxon and strain are loaded, or a rival claims it. */
function newOrganismConflicts(o, abbrev, accession, { index, claims }, where) {
  const conflicts = [];
  const existing = index.find((e) => e.abbrev === abbrev);
  if (existing) conflicts.push(`${abbrev} already names ${existing.project}/${abbrev}.xml on ${where}: the organism is redundant or the abbreviation is wrong`);
  const strainAbbrev = strainAbbrevOf(o.strain ?? '');
  const twin = o.ncbiTaxonId && index.find((e) => e.ncbiTaxonId === o.ncbiTaxonId && e.strainAbbrev === strainAbbrev);
  if (twin) conflicts.push(`taxon ${o.ncbiTaxonId} strain ${strainAbbrev} is already loaded as ${twin.project}/${twin.abbrev} on ${where}`);
  const rival = claims.find((c) => c.accession !== accession && claimedAbbrev(c) === abbrev);
  if (rival) conflicts.push(`${abbrev} is already proposed by genome proposal ${rival.accession}`);
  return conflicts;
}

/** Why abbrev departs from the convention for o, or null when it follows it. */
function conventionProblem(o, abbrev) {
  const conventional = conventionalAbbrev(o);
  if (conventional === null) return `no conventional abbreviation can be derived from species "${o.species}"`;
  return abbrev === conventional ? null : `${abbrev} differs from the convention ${conventional}`;
}

/**
 * Phase 1: checks a draft manifest's proposed organisms against the organisms
 * on the rebuild branch (index) and the genome proposals pending on master
 * (claims), and records where each loaded-type organism comes from.
 * Returns { organisms, errors, warnings }.
 */
export function crossCheckOrganisms(m, { index, claims, rebuild }) {
  const errors = [];
  const warnings = [];
  const organisms = m.organisms.map((o) => {
    const p = o.proposedOrganismAbbrev;
    if (o.source === 'new') {
      errors.push(...newOrganismConflicts(o, p, m.accession, { index, claims }, rebuild));
      const problem = conventionProblem(o, p);
      if (problem) warnings.push(`${problem}; Phase 2 will stop for a person to decide`);
      return o;
    }
    if (index.some((e) => e.abbrev === p && e.project === m.project)) return { proposedOrganismAbbrev: p, source: 'loaded' };
    const elsewhere = index.find((e) => e.abbrev === p);
    if (elsewhere) {
      errors.push(`${p} is a ${elsewhere.project} organism on ${rebuild}, not ${m.project}`);
      return o;
    }
    const genome = claims.find((c) => c.project === m.project && claimedAbbrev(c) === p);
    if (genome) {
      warnings.push(`${p} is not loaded: genome proposal ${genome.accession} proposes it, so it is not settled. This dataset loads in the same build as that genome or later.`);
      return { proposedOrganismAbbrev: p, source: { proposal: genome.accession } };
    }
    errors.push(`${p} is not an organism on ${rebuild} and no genome proposal on master proposes it`);
    return o;
  });
  return { organisms, errors, warnings };
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `node --test tests/organisms.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add shared/scripts/lib/organisms.js tests/organisms.test.js
git commit -m "organisms: Phase 1 cross-check against the rebuild branch and pending genomes"
```

---

### Task 6: write-proposal cross-checks on the named rebuild branch

**Files:**
- Modify: `shared/scripts/lib/proposal-ops.js`, `shared/scripts/write-proposal.js`
- Test: `tests/proposal-ops.test.js`

- [ ] **Step 1: Give every proposal test a rebuild branch**

In `tests/proposal-ops.test.js`:

```js
const REBUILD = 'rebuild02';
const setupRepo = () => {
  const setup = initRepo('proposal-ops-');
  execFileSync('git', ['-C', setup.repo, 'push', '-q', 'origin', `master:${REBUILD}`]);
  return setup;
};
```

Then make every `writeProposal({` call pass the branch:

```bash
sed -i 's/writeProposal({ /writeProposal({ rebuildBranch: REBUILD, /' tests/proposal-ops.test.js
grep -n "writeProposal({" tests/proposal-ops.test.js | grep -v rebuildBranch
```

The grep must print nothing; fix any multi-line call by hand.

Organisms now come from the rebuild branch, not the checkout. Add this helper and call it in every existing test right after it commits and pushes an organism file to master (for example the `tfakST2` copies for `--also-organism`):

```js
/** Moves origin/rebuild02 to master, so organisms added to master are on the rebuild branch too. */
const refreshRebuild = (repo) => execFileSync('git', ['-C', repo, 'push', '-q', '-f', 'origin', `master:${REBUILD}`]);
```

- [ ] **Step 2: Write the failing tests**

Append to `tests/proposal-ops.test.js`:

```js
// --- organisms against the rebuild branch ----------------------------------

const rnaInput = (organism, extra = {}) => ({
  accession: 'PRJNA000002', datasetType: 'bulk-rnaseq', project: 'FungiDB', organism,
  contacts: { primary: 'jane.doe', additional: [] }, skill: { name: 'propose-bulk-rnaseq', version: '2.0.0' }, ...extra
});

test('writeProposal refuses a rebuild branch that is not named or not on origin', async () => {
  const { root, repo } = setupRepo();
  const git = createGit(repo);
  git.createBranch('proposal/GCA_000001.1', 'master');
  const args = { git, repoPath: repo, manifestInput, curator: 'someone@apidb.org', inputs: genomeInputs(root), curated: [] };
  await assert.rejects(writeProposal({ ...args, rebuildBranch: undefined }), /--rebuild-branch must name the build's rebuild branch, e\.g\. rebuild73; got "undefined"/);
  await assert.rejects(writeProposal({ ...args, rebuildBranch: 'rebuild99' }), /origin\/rebuild99 does not exist; ask the curator which rebuild branch they mean/);
});

test('writeProposal refuses a genome whose abbreviation is already an organism on the rebuild branch', async () => {
  const { root, repo } = setupRepo();
  const git = createGit(repo);
  git.createBranch('proposal/GCA_000001.1', 'master');
  await assert.rejects(writeProposal({ rebuildBranch: REBUILD, git, repoPath: repo, manifestInput: { ...manifestInput, organism: 'tfakST1' },
    curator: 'someone@apidb.org', inputs: genomeInputs(root), curated: [] }),
  /Organisms do not check out against rebuild02:\n  - tfakST1 already names FungiDB\/tfakST1\.xml on rebuild02/);
});

test('writeProposal records the genome organism from the assembly report and warns off the convention', async () => {
  const { root, repo } = setupRepo();
  const git = createGit(repo);
  git.createBranch('proposal/GCA_000001.1', 'master');
  const warnings = [];
  const { manifest } = await writeProposal({ rebuildBranch: REBUILD, git, repoPath: repo, manifestInput: { ...manifestInput, organism: 'tfakX' },
    curator: 'someone@apidb.org', inputs: genomeInputs(root), curated: [], warn: (w) => warnings.push(w) });
  assert.deepEqual(manifest.organisms, [{ proposedOrganismAbbrev: 'tfakX', source: 'new', species: 'Testus fakeus', strain: 'ST-1', ncbiTaxonId: '999001' }]);
  assert.deepEqual(warnings, ['Warning: tfakX differs from the convention tfakST-1; Phase 2 will stop for a person to decide']);
});

test('writeProposal reads organisms from the rebuild branch, not the checkout', async () => {
  const { repo } = setupRepo();
  const git = createGit(repo);
  // On master only: an organism the rebuild branch does not have.
  cpSync(join(repo, 'Datasets/lib/xml/datasets/FungiDB/tfakST1.xml'), join(repo, 'Datasets/lib/xml/datasets/FungiDB/tfakOnlyMaster.xml'));
  execFileSync('git', ['-C', repo, 'add', '-A']);
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'master only']);
  execFileSync('git', ['-C', repo, 'push', '-q']);
  git.createBranch('proposal/PRJNA000002', 'master');
  await assert.rejects(writeProposal({ rebuildBranch: REBUILD, git, repoPath: repo, manifestInput: rnaInput('tfakOnlyMaster'),
    curator: 'someone@apidb.org', inputs: [], curated: [] }),
  /tfakOnlyMaster is not an organism on rebuild02 and no genome proposal on master proposes it/);
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `node --test tests/proposal-ops.test.js`
Expected: FAIL on the four new tests

- [ ] **Step 4: Implement**

In `shared/scripts/lib/proposal-ops.js`, import:

```js
import { readOrganismIndex, pendingGenomeProposals, crossCheckOrganisms } from './organisms.js';
```

Change the `writeProposal` signature to take `rebuildBranch`, and right after `assertOnProposalBranch(...)`:

```js
  if (!/^rebuild\d+$/.test(rebuildBranch ?? '')) {
    throw new Error(`--rebuild-branch must name the build's rebuild branch, e.g. rebuild73; got "${rebuildBranch}"`);
  }
  git.fetch();
  if (!git.remoteBranchExists(rebuildBranch)) {
    throw new Error(`origin/${rebuildBranch} does not exist; ask the curator which rebuild branch they mean`);
  }
  const rebuildRef = `origin/${rebuildBranch}`;
```

After the manifest literal and before `validate(...)`:

```js
  const crossCheck = crossCheckOrganisms(manifest, {
    index: readOrganismIndex(git, rebuildRef), claims: pendingGenomeProposals(git, ['origin/master']), rebuild: rebuildBranch
  });
  if (crossCheck.errors.length) {
    throw new Error(`Organisms do not check out against ${rebuildBranch}:\n  - ${crossCheck.errors.join('\n  - ')}`);
  }
  for (const w of crossCheck.warnings) warn(`Warning: ${w}`);
  manifest.organisms = crossCheck.organisms;
```

Replace `assertNameIsFree` so it reads organism files from the rebuild branch and skips organisms not loaded yet:

```js
/**
 * The experiment name must be new for each loaded organism, in its file on the
 * rebuild branch, and not claimed by another proposal already on master.
 */
function assertNameIsFree(git, rebuildRef, m) {
  for (const o of m.organisms.filter((x) => x.source === 'loaded')) {
    const relFile = datasetFileRelativePath(m.project, o.proposedOrganismAbbrev);
    if (datasetNameExists(git.showFile(rebuildRef, relFile), m.datasetClass, m.name)) {
      throw new Error(`${relFile} on ${rebuildRef} already has a ${m.datasetClass} named "${m.name}"; choose another "name" in --overrides`);
    }
  }
  const organisms = organismsOf(m);
  for (const other of git.listDir('origin/master', PROPOSALS_DIR)) {
    if (other === m.accession) continue;
    let theirs;
    try { theirs = JSON.parse(git.showFile('origin/master', `${proposalRelativePath(other)}/${MANIFEST_FILENAME}`)); }
    catch { continue; }
    if (theirs.name !== m.name) continue;
    const shared = organisms.find((organism) => organismsIn(theirs).includes(organism));
    if (shared) {
      throw new Error(`Proposal ${other} on master already uses the name "${m.name}" for ${shared}; choose another "name" in --overrides`);
    }
  }
}
```

and its call becomes `assertNameIsFree(git, rebuildRef, full);`. Drop the now-unused `datasetFilePath` import if nothing else uses it.

In `shared/scripts/write-proposal.js`: add `'rebuild-branch': { type: 'string' }` to the options, `'rebuild-branch'` to the required list, pass `rebuildBranch: values['rebuild-branch']` to `writeProposal`, and add `--rebuild-branch rebuildNN` to the usage comment.

- [ ] **Step 5: Run the suite**

Run: `npm test`
Expected: PASS. Existing tests asserting `does not exist; is X a FungiDB organism?` now see the cross-check message; change their regex to the new text.

- [ ] **Step 6: Commit**

```bash
git add shared tests
git commit -m "write-proposal cross-checks organisms on the curator-named rebuild branch"
```

---

### Task 7: Phase 2 settlement

**Files:**
- Modify: `shared/scripts/lib/organisms.js`
- Test: `tests/organisms.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `tests/organisms.test.js`, extending the import with `settleOrganisms` (reuses `INDEX`, `newOrganism`, `claim` from Task 5):

```js
const genomeManifestV3 = (o) => ({ accession: 'GCA_1.1', project: 'FungiDB', organisms: [newOrganism(o)] });
const rnaManifest = (...organisms) => ({ accession: 'PRJNA1', project: 'FungiDB', organisms });
const linked = (p, accession = 'GCA_1.1') => ({ proposedOrganismAbbrev: p, source: { proposal: accession } });
const settleWith = (m, { index = INDEX, claims = [], genomes = {}, settle } = {}) =>
  settleOrganisms(m, { index, claims, genomeOf: (a) => genomes[a] ?? null, settle });

test('a conventional new genome settles to its proposal', () => {
  assert.deepEqual(settleWith(genomeManifestV3()), { organisms: [{ proposed: 'tfakST-1', abbrev: 'tfakST-1', notes: [] }], stops: [] });
});

test('a new genome off the convention stops until a person settles it', () => {
  const m = genomeManifestV3({ proposedOrganismAbbrev: 'tfakX' });
  assert.deepEqual(settleWith(m).stops, ['tfakX: tfakX differs from the convention tfakST-1']);
  assert.deepEqual(settleWith(m, { settle: { tfakX: 'tfakX' } }),
    { organisms: [{ proposed: 'tfakX', abbrev: 'tfakX', notes: ['settled by the loader'] }], stops: [] });
  assert.deepEqual(settleWith(m, { settle: { tfakX: 'tfakST-1' } }).organisms,
    [{ proposed: 'tfakX', abbrev: 'tfakST-1', notes: ['settled by the loader'] }]);
});

test('no settlement clears an existing abbreviation, a loaded taxon and strain, or a rival claim', () => {
  const taken = genomeManifestV3({ proposedOrganismAbbrev: 'tgonME49' });
  assert.match(settleWith(taken, { settle: { tgonME49: 'tgonME49' } }).stops[0], /tgonME49 already names ToxoDB\/tgonME49\.xml on this branch/);
  const twin = genomeManifestV3({ ncbiTaxonId: '999000', strain: 'ST1', proposedOrganismAbbrev: 'tfakST1x' });
  assert.match(settleWith(twin, { settle: { tfakST1x: 'tfakST1x' } }).stops[0], /taxon 999000 strain ST1 is already loaded as FungiDB\/tfakST1/);
  assert.match(settleWith(genomeManifestV3(), { claims: [claim('GCA_2.1')] }).stops[0], /tfakST-1 is already proposed by genome proposal GCA_2.1/);
});

test('a loaded organism settles by exact match in the project', () => {
  const ok = settleWith(rnaManifest({ proposedOrganismAbbrev: 'tfakST1', source: 'loaded' }));
  assert.deepEqual(ok, { organisms: [{ proposed: 'tfakST1', abbrev: 'tfakST1', notes: [] }], stops: [] });
  assert.deepEqual(settleWith(rnaManifest({ proposedOrganismAbbrev: 'tgonME49', source: 'loaded' })).stops,
    ['tgonME49: tgonME49 is a ToxoDB organism, not FungiDB']);
  assert.deepEqual(settleWith(rnaManifest({ proposedOrganismAbbrev: 'gone1', source: 'loaded' })).stops,
    ['gone1: no organism file FungiDB/gone1.xml on this branch']);
});

test('a linked organism settles to the organism file matching its genome taxon and strain', () => {
  const index = [...INDEX, { abbrev: 'tfakST-1b', project: 'FungiDB', ncbiTaxonId: '999001', strainAbbrev: 'ST-1' }];
  const result = settleWith(rnaManifest(linked('tfakST-1')), { index, genomes: { 'GCA_1.1': newOrganism() } });
  assert.deepEqual(result, { organisms: [{ proposed: 'tfakST-1', abbrev: 'tfakST-1b', notes: ['genome GCA_1.1 loaded as tfakST-1b'] }], stops: [] });
});

test('a linked organism whose genome is not loaded, or cannot be found, stops', () => {
  assert.deepEqual(settleWith(rnaManifest(linked('tfakST-1')), { genomes: { 'GCA_1.1': newOrganism() } }).stops,
    ['tfakST-1: genome proposal GCA_1.1 (taxon 999001, strain ST-1) is not loaded on this branch; load it first, in this build or an earlier one']);
  assert.deepEqual(settleWith(rnaManifest(linked('tfakST-1'))).stops,
    ['tfakST-1: genome proposal GCA_1.1 cannot be found on this branch, on origin/master or in their history']);
});

test('two organism files with the genome taxon and strain stop until a person picks one', () => {
  const twins = [{ abbrev: 'a1', project: 'FungiDB', ncbiTaxonId: '999001', strainAbbrev: 'ST-1' }, { abbrev: 'a2', project: 'FungiDB', ncbiTaxonId: '999001', strainAbbrev: 'ST-1' }];
  const m = rnaManifest(linked('tfakST-1'));
  assert.deepEqual(settleWith(m, { index: twins, genomes: { 'GCA_1.1': newOrganism() } }).stops,
    ['tfakST-1: taxon 999001 strain ST-1 matches a1, a2']);
  assert.deepEqual(settleWith(m, { index: twins, genomes: { 'GCA_1.1': newOrganism() }, settle: { 'tfakST-1': 'a2' } }).organisms,
    [{ proposed: 'tfakST-1', abbrev: 'a2', notes: ['settled by the loader'] }]);
});

test('a genome without a taxon id falls back to the exact abbreviation, with a note', () => {
  const index = [...INDEX, { abbrev: 'tfakST-1', project: 'FungiDB', ncbiTaxonId: '1', strainAbbrev: 'X' }];
  const result = settleWith(rnaManifest(linked('tfakST-1')), { index, genomes: { 'GCA_1.1': newOrganism({ ncbiTaxonId: undefined }) } });
  assert.deepEqual(result.organisms, [{ proposed: 'tfakST-1', abbrev: 'tfakST-1', notes: ['matched by abbreviation only: genome proposal GCA_1.1 records no taxon id'] }]);
});

test('a loader settlement onto a file that disagrees with the genome is noted', () => {
  const result = settleWith(rnaManifest(linked('tfakST-1')), { genomes: { 'GCA_1.1': newOrganism() }, settle: { 'tfakST-1': 'tfakST1' } });
  assert.deepEqual(result.organisms[0].notes, ['settled by the loader', 'tfakST1 does not record genome GCA_1.1 taxon 999001 and strain ST-1']);
});

test('a settlement naming no organism of the proposal stops', () => {
  assert.deepEqual(settleWith(genomeManifestV3(), { settle: { typo: 'x' } }).stops, ['--settle names typo, which is not an organism of GCA_1.1']);
});

test('two organisms settling to one abbreviation stop', () => {
  const index = [...INDEX, { abbrev: 'tfakST-1b', project: 'FungiDB', ncbiTaxonId: '999001', strainAbbrev: 'ST-1' }];
  const m = rnaManifest({ proposedOrganismAbbrev: 'tfakST-1b', source: 'loaded' }, linked('tfakST-1'));
  assert.ok(settleWith(m, { index, genomes: { 'GCA_1.1': newOrganism() } }).stops.includes('tfakST-1b is settled for two organisms'));
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test tests/organisms.test.js`
Expected: FAIL, `settleOrganisms` is not exported

- [ ] **Step 3: Implement**

Add to `shared/scripts/lib/organisms.js`:

```js
/** Why abbrev is not a loaded organism of project on the index, or null when it is. */
function loadedProblem(abbrev, project, index) {
  if (index.some((e) => e.abbrev === abbrev && e.project === project)) return null;
  const elsewhere = index.find((e) => e.abbrev === abbrev);
  return elsewhere ? `${abbrev} is a ${elsewhere.project} organism, not ${project}` : `no organism file ${project}/${abbrev}.xml on this branch`;
}

function settleLinked(o, chosen, m, { index, genomeOf }, notes) {
  const accession = o.source.proposal;
  const genome = genomeOf(accession);
  if (!genome) return { stop: `genome proposal ${accession} cannot be found on this branch, on origin/master or in their history` };
  const strainAbbrev = strainAbbrevOf(genome.strain ?? '');
  const recordsGenome = (e) => e.project === m.project && e.ncbiTaxonId === genome.ncbiTaxonId && e.strainAbbrev === strainAbbrev;
  if (chosen !== undefined) {
    const problem = loadedProblem(chosen, m.project, index);
    if (problem) return { stop: problem };
    if (genome.ncbiTaxonId && !recordsGenome(index.find((e) => e.abbrev === chosen && e.project === m.project))) {
      notes.push(`${chosen} does not record genome ${accession} taxon ${genome.ncbiTaxonId} and strain ${strainAbbrev}`);
    }
    return { abbrev: chosen };
  }
  if (!genome.ncbiTaxonId) {
    const problem = loadedProblem(o.proposedOrganismAbbrev, m.project, index);
    if (problem) return { stop: `genome proposal ${accession} is not loaded: ${problem}` };
    notes.push(`matched by abbreviation only: genome proposal ${accession} records no taxon id`);
    return { abbrev: o.proposedOrganismAbbrev };
  }
  const matches = index.filter(recordsGenome);
  if (matches.length === 0) {
    return { stop: `genome proposal ${accession} (taxon ${genome.ncbiTaxonId}, strain ${strainAbbrev}) is not loaded on this branch; load it first, in this build or an earlier one` };
  }
  if (matches.length > 1) return { stop: `taxon ${genome.ncbiTaxonId} strain ${strainAbbrev} matches ${matches.map((e) => e.abbrev).join(', ')}` };
  if (matches[0].abbrev !== o.proposedOrganismAbbrev) notes.push(`genome ${accession} loaded as ${matches[0].abbrev}`);
  return { abbrev: matches[0].abbrev };
}

/**
 * Phase 2: the abbreviation each of the manifest's organisms loads under.
 * index is the rebuild branch's organism files; claims the genome proposals
 * pending anywhere; genomeOf(accession) a genome proposal's new organism or
 * null. settle ({ proposed: abbrev }) is a person's decision: it clears a
 * convention or matching stop, never an abbreviation that is taken or missing.
 * Returns { organisms: [{ proposed, abbrev, notes }], stops }.
 */
export function settleOrganisms(m, { index, claims, genomeOf, settle = {} }) {
  const stops = [];
  const proposedAll = m.organisms.map((o) => o.proposedOrganismAbbrev);
  for (const k of Object.keys(settle)) {
    if (!proposedAll.includes(k)) stops.push(`--settle names ${k}, which is not an organism of ${m.accession}`);
  }
  const organisms = m.organisms.map((o) => {
    const proposed = o.proposedOrganismAbbrev;
    const chosen = settle[proposed];
    const notes = chosen === undefined ? [] : ['settled by the loader'];
    const stop = (msg) => { stops.push(`${proposed}: ${msg}`); return { proposed, abbrev: null, notes }; };
    if (chosen !== undefined && !ABBREV_SHAPE.test(chosen)) return stop(`${chosen} must be ${SHAPE_RULE}`);
    if (o.source === 'new') {
      const abbrev = chosen ?? proposed;
      const conflicts = newOrganismConflicts(o, abbrev, m.accession, { index, claims }, 'this branch');
      if (conflicts.length) return stop(conflicts.join('; '));
      const problem = chosen === undefined && conventionProblem(o, abbrev);
      return problem ? stop(problem) : { proposed, abbrev, notes };
    }
    if (o.source === 'loaded') {
      const abbrev = chosen ?? proposed;
      const problem = loadedProblem(abbrev, m.project, index);
      return problem ? stop(problem) : { proposed, abbrev, notes };
    }
    const linked = settleLinked(o, chosen, m, { index, genomeOf }, notes);
    return linked.stop ? stop(linked.stop) : { proposed, abbrev: linked.abbrev, notes };
  });
  const settled = organisms.map((o) => o.abbrev).filter(Boolean);
  for (const a of new Set(settled.filter((a, i) => settled.indexOf(a) !== i))) stops.push(`${a} is settled for two organisms`);
  return { organisms, stops };
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `node --test tests/organisms.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add shared/scripts/lib/organisms.js tests/organisms.test.js
git commit -m "organisms: Phase 2 settlement with mandatory stops"
```

---

### Task 8: Loads settle first and render the settled abbreviations

**Files:**
- Modify: `shared/scripts/lib/load-ops.js`, `shared/scripts/load-proposal.js`
- Test: `tests/load-ops.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `tests/load-ops.test.js` (`setupRepo`, `setManifestFields`, `commitAll`, `tickets`, `ghStub` are already there):

```js
// --- organism settlement ---------------------------------------------------

test('a genome whose abbreviation is already an organism stops before any branch', async () => {
  const { repo } = setupRepo();
  cpSync(join(repo, 'Datasets/lib/xml/datasets/FungiDB/tfakST1.xml'), join(repo, 'Datasets/lib/xml/datasets/FungiDB/tfakST-1.xml'));
  commitAll(repo, 'tfakST-1 already loaded');
  const git = createGit(repo);
  await assert.rejects(checkLoadPreconditions({ git, ticket: tickets(), repoPath: repo, accession: 'GCA_000001.1' }),
    /Organism abbreviations need a person before GCA_000001\.1 loads:\n  - tfakST-1: tfakST-1 already names FungiDB\/tfakST-1\.xml on this branch/);
  assert.equal(git.branchExists('load/GCA_000001.1'), false);
});

test('a genome off the convention stops, and loads once a person settles it', async () => {
  const { repo } = setupRepo();
  const organisms = [{ proposedOrganismAbbrev: 'tfakX', source: 'new', species: 'Testus fakeus', strain: 'ST-1', ncbiTaxonId: '999001' }];
  setManifestFields(repo, 'GCA_000001.1', { organisms });
  commitAll(repo, 'off convention');
  await assert.rejects(checkLoadPreconditions({ git: createGit(repo), ticket: tickets(), repoPath: repo, accession: 'GCA_000001.1' }),
    /tfakX: tfakX differs from the convention tfakST-1\nResolve each, then re-run; a person may settle one with --settle <proposed>=<abbrev>\./);

  const gh = ghStub({ url: 'https://github.com/VEuPathDB/VEuPathDatasets/pull/12' });
  const git = createGit(repo, { exec: gh.exec });
  const result = await loadProposal({ git, ticket: tickets(), repoPath: repo, accession: 'GCA_000001.1', settle: { tfakX: 'tfakST-1' } });
  assert.deepEqual(result.presenterNames, ['tfakST-1_primary_genome_RSRC']);
  const prCreate = gh.calls.find(a => a[0] === 'pr' && a[1] === 'create');
  assert.match(prCreate[prCreate.indexOf('--body') + 1], /^Organism `tfakST-1` \(proposed `tfakX`\): settled by the loader$/m);
});

test('an rnaseq organism linked to a genome settles to the organism file with its taxon and strain', async (t) => {
  const { repo, deliveryBase } = rnaOnRebuild(t);
  writeFileSync(join(repo, 'Datasets/lib/xml/datasets/FungiDB/tfakST-1b.xml'), readFileSync(join(repo, 'Datasets/lib/xml/datasets/FungiDB/tfakST1.xml'), 'utf-8')
    .replace('<constant name="projectName" value="FungiDB"/>', '<constant name="projectName" value="FungiDB"/>\n  <constant name="ncbiTaxonId" value="999001"/>\n  <constant name="strainAbbrev" value="ST-1"/>'));
  setManifestFields(repo, 'PRJNA000002', { organisms: [{ proposedOrganismAbbrev: 'tfakST-1', source: { proposal: 'GCA_000001.1' } }] });
  commitAll(repo, 'genome loaded as tfakST-1b; rnaseq linked to it');

  const git = createGit(repo, { exec: ghStub({ url: 'https://github.com/x/y/pull/24' }).exec });
  const result = await loadProposal({ git, ticket: tickets(), repoPath: repo, accession: 'PRJNA000002', deliveryBase });
  assert.deepEqual(result.presenterNames, ['tfakST-1b_Doe_heat_shock_2024_rnaSeq_RSRC']);
  assert.match(git.showFile('origin/load/PRJNA000002', 'Datasets/lib/xml/datasets/FungiDB/tfakST-1b.xml'), /<prop name="name">Doe_heat_shock_2024<\/prop>/);
});

test('an rnaseq organism linked to a genome that is not loaded stops', async (t) => {
  const { repo } = rnaOnRebuild(t);
  setManifestFields(repo, 'PRJNA000002', { organisms: [{ proposedOrganismAbbrev: 'tfakST-1', source: { proposal: 'GCA_000001.1' } }] });
  commitAll(repo, 'linked to an unloaded genome');
  await assert.rejects(checkLoadPreconditions({ git: createGit(repo), ticket: tickets(), repoPath: repo, accession: 'PRJNA000002' }),
    /genome proposal GCA_000001\.1 \(taxon 999001, strain ST-1\) is not loaded on this branch; load it first/);
});
```

If `rnaOnRebuild` removes `Proposals/GCA_000001.1`, the last two tests need the genome manifest reachable: `genomeOrganismOf` also reads `origin/master` and history, so they hold as long as `setupRepo` committed it once.

Update the two existing tests that expect `Dataset file missing: ...tfakST1.xml` and the missing additional-organism file: settlement now stops first with `no organism file FungiDB/<abbrev>.xml on this branch`.

- [ ] **Step 2: Run them to see them fail**

Run: `node --test tests/load-ops.test.js`
Expected: FAIL on the new tests

- [ ] **Step 3: Implement settlement in load-ops**

In `shared/scripts/lib/load-ops.js`, import:

```js
import { cpSync } from 'node:fs';   // add to the existing node:fs import
import { write as writeManifest } from './manifest.js';   // add to the existing manifest import
import { readOrganismIndex, pendingGenomeProposals, genomeOrganismOf, settleOrganisms } from './organisms.js';
```

Add:

```js
/** Settlement of the manifest's organisms against HEAD's organism files and every pending genome proposal; never throws on a stop. */
export function settlementFor(git, manifest, settle = {}) {
  return settleOrganisms(manifest, {
    index: readOrganismIndex(git, 'HEAD'),
    claims: pendingGenomeProposals(git, ['HEAD', 'origin/master']),
    genomeOf: (accession) => genomeOrganismOf(git, 'HEAD', accession) ?? genomeOrganismOf(git, 'origin/master', accession),
    settle
  });
}

function settledOrStop(git, manifest, settle) {
  const { organisms, stops } = settlementFor(git, manifest, settle);
  if (stops.length) {
    throw new Error(`Organism abbreviations need a person before ${manifest.accession} loads:\n  - ${stops.join('\n  - ')}\nResolve each, then re-run; a person may settle one with --settle <proposed>=<abbrev>.`);
  }
  return organisms;
}

/** Runs fn on a scratch copy of the proposal whose manifest carries the settled abbreviations. */
async function withSettledProposal(proposalDir, manifest, settled, fn) {
  const scratch = mkdtempSync(join(tmpdir(), 'load-settled-'));
  try {
    const dir = join(scratch, manifest.accession);
    cpSync(proposalDir, dir, { recursive: true });
    const settledManifest = { ...manifest, organisms: manifest.organisms.map((o, i) => ({ ...o, organismAbbrev: settled[i].abbrev })) };
    writeManifest(dir, settledManifest);
    return await fn(dir, settledManifest);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
```

Thread `settle` through:

- `checkLoadPreconditions({ ..., settle = {} })`: after `assertOnBranch(git, base, ...)` and the up-to-date check, compute `const settled = settledOrStop(git, manifest, settle);` and include `settled` in every returned object. In the `resume` early return, compute it before returning (`settled: settledOrStop(git, manifest, settle)`).
- `renderAndCheck(manifest, proposalDir, presenterPath, repoPath, build, settled)` wraps its body:

```js
async function renderAndCheck(manifest, proposalDir, presenterPath, repoPath, build, settled) {
  return withSettledProposal(proposalDir, manifest, settled, async (dir, m) => {
    const datasetType = await loadDatasetType(m.datasetType);
    const presenterFile = readFileSync(presenterPath, 'utf-8');
    const presenters = organismsOf(m).map((organism) => {
      const xml = datasetType.renderPresenter(dir, { build, organism });
      return { xml, name: extractPresenterName(xml) };
    });
    const taken = presenters.find((p) => presenterNameExists(presenterFile, p.name));
    if (taken) throw new Error(`Presenter "${taken.name}" already exists in ${presenterFileRelativePath(m.project)}. It may already be loaded; ask before continuing.`);
    return { presenters, presenterFile, ...(await renderDatasetParts(m, dir, repoPath, { check: true })) };
  });
}
```

  Pass `settled` at all three call sites (non-straggler, straggler scratch export, after the cherry-pick).
- In `loadProposal`'s resume block, render from the settled copy too:

```js
      ({ dataset } = await withProposalFromRef(git, 'HEAD~1', relDir,
        (dir) => withSettledProposal(dir, manifest, pre.settled, (d, m) => renderDatasetParts(m, d, repoPath, { check: false }))));
```

- `loadProposal({ ..., settle = {} })` passes `settle` to `checkLoadPreconditions` and adds organism lines to the PR body, after the `Presenters:` line:

```js
      ...pre.settled.map((o) => `Organism \`${o.abbrev}\`${o.abbrev === o.proposed ? '' : ` (proposed \`${o.proposed}\`)`}${o.notes.length ? `: ${o.notes.join('; ')}` : ''}`),
```

- Return `settled: pre.settled` from both the dry-run and the full result.

- [ ] **Step 4: load-proposal.js takes --settle**

In `shared/scripts/load-proposal.js`:

```js
    options: { 'dry-run': { type: 'boolean', default: false }, settle: { type: 'string', multiple: true, default: [] } }, allowPositionals: true
```

```js
  const settle = {};
  for (const pair of values.settle) {
    const [proposed, abbrev, ...rest] = pair.split('=');
    if (!proposed || !abbrev || rest.length) { console.error(`--settle must be <proposed>=<abbrev>, got "${pair}"`); process.exit(1); }
    settle[proposed] = abbrev;
  }
```

pass `settle` to `loadProposal`, print `Organism: <abbrev> (proposed <p>): <notes>` for each `result.settled` entry in both the dry-run and full output, and update the usage line to `node load-proposal.js [--dry-run] [--settle <proposed>=<abbrev> ...] <accession>`.

- [ ] **Step 5: Run the suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add shared tests
git commit -m "Loads settle organism abbreviations first and render the settled names"
```

---

### Task 9: A build-wide organism report

**Files:**
- Modify: `shared/scripts/lib/load-ops.js`
- Create: `shared/scripts/check-organisms.js`
- Modify: `package.json`
- Test: `tests/load-ops.test.js`

- [ ] **Step 1: Write the failing test**

Append to `tests/load-ops.test.js`, adding `checkOrganisms` to the load-ops import:

```js
test('checkOrganisms reports every ready proposal of a build with its settlement and stops', async () => {
  const { repo } = setupRepo();
  cpSync(join(repo, 'Datasets/lib/xml/datasets/FungiDB/tfakST1.xml'), join(repo, 'Datasets/lib/xml/datasets/FungiDB/tfakST-1.xml'));
  commitAll(repo, 'tfakST-1 already loaded');
  const { results, errors } = await checkOrganisms({ git: createGit(repo), ticket: tickets(), repoPath: repo, build: '02' });
  assert.deepEqual(errors, []);
  assert.deepEqual(results.map((r) => [r.accession, r.stops.length]), [['GCA_000001.1', 1]]);
  assert.match(results[0].stops[0], /tfakST-1 already names FungiDB\/tfakST-1\.xml/);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test tests/load-ops.test.js`
Expected: FAIL, `checkOrganisms` is not exported

- [ ] **Step 3: Implement**

In `shared/scripts/lib/load-ops.js`:

```js
/**
 * Every Ready to load proposal of build on this branch with the abbreviation
 * each organism would load under and the stops a person must resolve first.
 * Stragglers still only on origin/master are checked when they load.
 * Returns { results: [{ accession, organisms, stops }], errors }.
 */
export async function checkOrganisms({ git, ticket, repoPath, build, settle = {} }) {
  const { proposals, errors } = await listProposals(repoPath, { ticket, build, status: 'ready' });
  const results = proposals.map(({ manifest }) => ({ accession: manifest.accession, ...settlementFor(git, manifest, settle[manifest.accession] ?? {}) }));
  return { results, errors };
}
```

Create `shared/scripts/check-organisms.js`:

```js
#!/usr/bin/env node
/**
 * check-organisms.js - For every Ready to load proposal of a build on this
 * rebuild branch, prints the abbreviation each organism would load under and
 * every stop a person must resolve before it loads. Exits 1 on any stop.
 *
 * Usage: node check-organisms.js --build NN
 */
import { parseArgs } from 'node:util';
import { openWorkspace } from './lib/config.js';
import { createGit } from './lib/git-ops.js';
import { createTicketClient } from './lib/ticket/index.js';
import { checkOrganisms } from './lib/load-ops.js';

async function main() {
  const { values } = parseArgs({ options: { build: { type: 'string' } } });
  if (!values.build) { console.error('Usage: node check-organisms.js --build NN'); process.exit(1); }
  const config = openWorkspace();
  const git = createGit(config.repoPath);
  git.fetch();
  const { results, errors } = await checkOrganisms({ git, ticket: createTicketClient(config), repoPath: config.repoPath, build: values.build });
  for (const r of results) {
    console.log(r.accession);
    for (const o of r.organisms) console.log(`  ${o.proposed} -> ${o.abbrev ?? '(stopped)'}${o.notes.length ? `  (${o.notes.join('; ')})` : ''}`);
    for (const s of r.stops) console.log(`  STOP ${s}`);
  }
  for (const e of errors) console.error(`Error: ${e.accession}: ${e.message}`);
  if (results.some((r) => r.stops.length) || errors.length) process.exit(1);
}

main().catch(err => { console.error(`Error: ${err.message}`); process.exit(1); });
```

In `package.json` `sharedFiles`, add:

```json
    "scripts/lib/organisms.js": ["propose-genome-assembly", "propose-bulk-rnaseq", "load-proposals"],
    "scripts/check-organisms.js": ["load-proposals"],
```

matching the formatting of the neighbouring entries.

- [ ] **Step 4: Run the suite and sync**

Run: `npm test && yarn sync-shared`
Expected: PASS; `skills/*/scripts/lib/organisms.js` and `skills/load-proposals/scripts/check-organisms.js` exist.

- [ ] **Step 5: Commit**

```bash
git add shared tests package.json skills
git commit -m "check-organisms: a build-wide report of organism settlement"
```

---

### Task 10: Documentation

**Files:**
- Modify: `skills/propose-genome-assembly/SKILL.md`, `skills/propose-genome-assembly/resources/step-5-write-proposal.md`, `skills/propose-bulk-rnaseq/SKILL.md`, `skills/propose-bulk-rnaseq/resources/step-4-write-proposal.md`, `skills/load-proposals/SKILL.md`, `shared/resources/proposal-workflow.md`, `docs/development.md`

- [ ] **Step 1: Propose skills**

In both propose skills:
- Every `write-proposal.js` invocation gains `--rebuild-branch <rebuildNN>`. Add a step before it: **ask the curator which rebuild branch to check against; never guess it.**
- `--organism` is described as the *proposed* abbreviation. State the convention: `<g><sp><Strain>`, genus initial plus the first three letters of the species in lowercase, then the strain with `.` replaced by `-` and spaces by `_` (*Plasmodium falciparum* 3D7 is `pfal3D7`; *Botrytis cinerea* B05.10 is `bcinB05-10`).
- Relay every `Warning:` line to the curator verbatim.

Genome skill only: species, strain and NCBI taxon id come from the assembly report; correct them with `"organism": { "species", "strain", "ncbiTaxonId" }` in the `--overrides` file. An abbreviation that already exists on the rebuild branch is a hard stop: the organism is redundant or the abbreviation is wrong; ask the curator which.

RNA-seq skill only: an organism that only a pending genome proposal introduces is accepted with a warning; tell the curator the dataset cannot load before that genome.

Replace the manifest field descriptions in `step-*-write-proposal.md` (`organismAbbrev`, `referenceOrganismAbbrev`, `additionalOrganismAbbrevs`) with the `organisms` array from Task 4.

- [ ] **Step 2: Load skill**

In `skills/load-proposals/SKILL.md`:
- Before loading a build, run `node scripts/check-organisms.js --build NN` and show the loader every `STOP`.
- A stop is resolved by a person. Never pass `--settle` without the loader choosing the abbreviation in this conversation.
- Load genome proposals before the datasets that link to them. A linked dataset loads only after its genome's load PR has merged into `rebuild<NN>`.
- The load PR lists each organism's settled abbreviation and any difference from the proposal.

- [ ] **Step 3: Workflow and development docs**

`shared/resources/proposal-workflow.md`: in "What a proposal holds", the identity row names `organisms` (proposed abbreviations); add a short "Organism abbreviations" subsection pointing at the spec: Phase 1 proposes and cross-checks against the named rebuild branch, Phase 2 settles and stops for a person.

`docs/development.md`: a dataset type exports `organismRule` (`{ new: true, max }` or `{ new: false }`) instead of `organismFields`, and a `new` type exports `deriveOrganism(inputs, accession, overrides)`.

- [ ] **Step 4: Sync and commit**

```bash
yarn sync-shared
git add shared skills docs
git commit -m "Docs: proposed organism abbreviations, rebuild branch cross-check, settlement"
```

---

### Task 11: Verify

- [ ] **Step 1: Full suite**

Run: `npm test`
Expected: all pass; the count is the baseline plus the new tests.

- [ ] **Step 2: Skill copies match shared**

Run: `yarn sync-shared && git status --porcelain skills`
Expected: no output.

- [ ] **Step 3: No v2 organism fields remain**

Run: `grep -rn "referenceOrganismAbbrev\|additionalOrganismAbbrevs\|organismFields\|organismKeys\|organismsFor" shared skills tests docs/development.md`
Expected: only the `LEGACY_ORGANISM_KEYS` line and its test.

- [ ] **Step 4: After merge, migrate the demo proposal**

PRJNA749283 in `~/dataset-curation-demo` is the one v2 proposal in flight. Re-run its `write-proposal.js` with `--rebuild-branch rebuild73` on its proposal branch, then publish, so master holds a v3 manifest before its load is retried. This is an operational step for John, not part of the PR.

---

## Self-review notes

- **Spec coverage:** shape check (Task 2, 4); convention with substitutions (Task 2); genome taxon/species/strain (Task 4); Phase 1 cross-check on the named rebuild branch with hard stop for an existing genome abbreviation and warning for unsettled dependents (Tasks 5, 6); uniqueness across projects (Task 5 `newOrganismConflicts` searches every project); Phase 2 settle before render and every mandatory stop (Tasks 7, 8); ordering, same build or later (Task 7 `settleLinked`, Task 10 load order); exact-match fallback (Task 7); source of truth stays the rebuild branch, never written back to master (Task 8 renders from a scratch copy).
- **Deferred, by decision:** the genome load writing the organism file; until then linked datasets stop in Phase 2.
- **Names used across tasks:** `ABBREV_SHAPE`, `SHAPE_RULE`, `strainAbbrevOf`, `conventionalAbbrev`, `readOrganismIndex`, `pendingGenomeProposals`, `genomeOrganismOf`, `crossCheckOrganisms`, `settleOrganisms`, `organismRuleOf`, `organismsOf`, `deriveOrganism`, `settlementFor`, `checkOrganisms`.
