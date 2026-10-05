# Multi-organism RNA-seq Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One bulk RNA-seq proposal aligns a BioProject's samples to several reference genomes in different projects (host and parasite), with per-organism sample membership, per-organism loading artifacts and one multi-injector presenter.

**Architecture:** Manifest v4 moves `project` onto each organism. Sample annotations tag each sample with the organisms it aligns to. Curated artifacts live under `curated/<proposedOrganismAbbrev>/`. A multi-organism proposal renders one presenter named `${name}_rnaSeq_RSRC` with `datasetNamePattern` and one `<templateInjector>` per organism. Single-organism output stays byte-identical.

**Tech Stack:** Node 18 ESM, `node:test`, git-backed fixture repos (`tests/helpers.js`).

**Spec:** `docs/superpowers/specs/2026-10-05-multi-organism-rnaseq-design.md`

---

## Ground rules

- Work on branch `multi-organism-rnaseq-design` (already created, holds the spec). Never commit to `main`.
- Edit only `shared/` and `tests/` (and the skill docs in Task 9). `skills/*/scripts` are copies; the husky pre-commit hook runs `yarn sync-shared`, which refreshes them. Stage the synced copies with each commit: `git add -A shared skills tests`.
- Run one file: `node --test tests/<file>.test.js`. Run all: `yarn test` (about 40 s; baseline is 480 pass, 1 skipped).
- Match the codebase style: short functions, a one-line `/** */` doc on exported or non-obvious functions, no other comments, error messages that tell the reader what to do.
- Each commit message ends with:
  `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`

## File map

| File | Responsibility | Tasks |
|---|---|---|
| `shared/scripts/lib/manifest.js` | v4 schema; `projectOf`, `proposedAbbrevOf`, `homeProject`, `projectsOf` | 1 |
| `shared/scripts/lib/organisms.js` | project per organism in cross-check, claims, settlement | 2, 3 |
| `shared/scripts/lib/dataset-classes.js` | `identityValues` uses the organism's project | 2 |
| `shared/scripts/lib/proposal-ops.js` | builds v4 organisms; per-organism name check; nested artifact paths; one presenter preview; ticket title | 2, 3, 5, 7 |
| `shared/scripts/lib/load-ops.js` | presenter into the home file, datasets into each organism's project; one presenter | 2, 7 |
| `shared/scripts/dataset-types/_common.js` | presenter `organisms` overrides and validation | 6 |
| `shared/scripts/dataset-types/genome-assembly.js` | `projectName` from the home project | 2 |
| `shared/scripts/dataset-types/bulk-rnaseq.js` | membership, per-organism artifacts, multi-injector presenter | 2, 4, 5, 6, 7 |
| `shared/scripts/render-proposal.js`, `list-proposals.js`, `load-proposal.js`, `write-proposal.js` | CLI wording and single presenter render | 2, 7 |
| `tests/helpers.js` | `loaded` carries a project; `alignTo` re-aims a fixture | 2, 5 |
| `tests/fixtures/proposals/*` | v4 manifests; artifacts under `curated/tfakST1/` | 2, 5 |
| `skills/propose-bulk-rnaseq/…`, `skills/load-proposals/SKILL.md` | curator and loader docs | 9 |

---

### Task 1: Manifest v4 schema and project helpers

**Files:**
- Modify: `shared/scripts/lib/manifest.js`
- Test: `tests/manifest.test.js`

This task leaves the rest of the suite red (fixtures are still v3). Task 2 makes it green; commit at the end of Task 2.

- [ ] **Step 1: Move the manifest tests to v4 and add the new ones**

In `tests/manifest.test.js`:

1. Import the new helpers:
```js
import { validate, read, write, organismsOf, organismRuleOf, parseExternalIds, idsOf, projectOf, proposedAbbrevOf, homeProject, projectsOf } from '../shared/scripts/lib/manifest.js';
```
2. `valid()` becomes:
```js
function valid() {
  return {
    schemaVersion: 4,
    accession: 'PRJNA123456',
    datasetType: 'bulk-rnaseq',
    organisms: [{ proposedOrganismAbbrev: 'afumAf293', source: 'loaded', project: 'FungiDB' }],
    contacts: { primary: 'jane.doe', additional: ['ravi.kumar'] },
    curator: 'someone@apidb.org',
    createdAt: '2026-09-18T14:00:00.000Z',
    skill: { name: 'propose-bulk-rnaseq', version: '2.0.0' }
  };
}
```
3. In `genome()`, add `project: 'FungiDB'` to the organism literal (before `...organism`).
4. Every other organism literal in this file that a test expects to be valid (the `organisms: [{ ... }]` literals in the tests from "a proposed abbreviation must have the abbreviation shape" through "organismsOf lists settled abbreviations") gets `project: 'FungiDB'`. Literals a test expects to be refused for another reason may keep or drop it; add it so each test still fails only for the reason it names.
5. Replace the test `project must be a valid VEuPathDB project` with:
```js
test('a root project is a schemaVersion 3 field', () => {
  assert.ok(validate({ ...valid(), project: 'FungiDB' }).includes('project is a schemaVersion 3 field; each organism names its project. Re-run write-proposal.js'));
});

test('each organism names a valid VEuPathDB project', () => {
  const m = valid();
  m.organisms[0].project = 'fungidb';
  assert.ok(validate(m).some(e => /organisms\[0\]\.project "fungidb" is not valid; expected one of AmoebaDB/.test(e)));
  delete m.organisms[0].project;
  assert.ok(validate(m).some(e => /organisms\[0\]\.project "undefined" is not valid/.test(e)));
});
```
6. Replace `schemaVersion 3 is the only version` with:
```js
test('schemaVersion 4 is the only version', () => {
  assert.ok(validate({ ...valid(), schemaVersion: 3 }).includes('schemaVersion must be one of 4'));
});
```
7. In `write refuses an invalid manifest`, replace `{ ...valid(), project: 'Nope' }` with `{ ...valid(), organisms: [{ ...valid().organisms[0], project: 'Nope' }] }`.
8. Add:
```js
test('projectOf, proposedAbbrevOf, homeProject and projectsOf read the organisms, settled names first', () => {
  const m = { ...valid(), organisms: [
    { proposedOrganismAbbrev: 'pfal3D7', source: 'loaded', project: 'PlasmoDB', organismAbbrev: 'pfal3D7' },
    { proposedOrganismAbbrev: 'hsapX', source: 'loaded', project: 'HostDB', organismAbbrev: 'hsapREF' },
    { proposedOrganismAbbrev: 'pberANKA', source: 'loaded', project: 'PlasmoDB' }
  ] };
  assert.equal(projectOf(m, 'hsapREF'), 'HostDB');
  assert.equal(projectOf(m, 'hsapX'), 'HostDB');
  assert.equal(proposedAbbrevOf(m, 'hsapREF'), 'hsapX');
  assert.equal(proposedAbbrevOf(m, 'pberANKA'), 'pberANKA');
  assert.equal(homeProject(m), 'PlasmoDB');
  assert.deepEqual(projectsOf(m), ['PlasmoDB', 'HostDB']);
  assert.throws(() => projectOf(m, 'nope'), /nope is not an organism of PRJNA123456/);
});
```

- [ ] **Step 2: Run the manifest tests and watch them fail**

Run: `node --test tests/manifest.test.js`
Expected: FAIL. `projectOf` is not exported, and v4 manifests are refused with `schemaVersion must be one of 3`.

- [ ] **Step 3: Implement v4 in `shared/scripts/lib/manifest.js`**

1. `export const SUPPORTED_SCHEMA_VERSIONS = [4];`
2. In `validate`, replace the `VALID_PROJECTS.includes(m.project)` block with:
```js
  if (m.project !== undefined) push('project is a schemaVersion 3 field; each organism names its project. Re-run write-proposal.js');
```
3. `const ENTRY_KEYS = ['proposedOrganismAbbrev', 'source', 'organismAbbrev', 'project'];`
4. In `organismEntryErrors`, right after the `if (o.organismAbbrev !== undefined && !settled)` line, add:
```js
  if (!VALID_PROJECTS.includes(o.project)) errors.push(`${at}.project "${o.project}" is not valid; expected one of ${VALID_PROJECTS.join(', ')}`);
```
5. Replace `organismsOf` and add the helpers below it:
```js
const abbrevOf = (o) => o.organismAbbrev ?? o.proposedOrganismAbbrev;

/** The organisms a proposal touches, primary first: settled abbreviations where Phase 2 has set them. */
export const organismsOf = (m) => m.organisms.map(abbrevOf);

/** The organism entry a settled or proposed abbreviation names; settled names win. */
function organismEntry(m, organism) {
  const o = m.organisms.find((x) => abbrevOf(x) === organism) ?? m.organisms.find((x) => x.proposedOrganismAbbrev === organism);
  if (!o) throw new Error(`${organism} is not an organism of ${m.accession}`);
  return o;
}

export const projectOf = (m, organism) => organismEntry(m, organism).project;
export const proposedAbbrevOf = (m, organism) => organismEntry(m, organism).proposedOrganismAbbrev;
/** The project whose presenter file holds the proposal's presenter: the first organism's. */
export const homeProject = (m) => m.organisms[0].project;
/** Every project the proposal touches, once each, home first. */
export const projectsOf = (m) => [...new Set(m.organisms.map((o) => o.project))];
```

- [ ] **Step 4: Run the manifest tests and watch them pass**

Run: `node --test tests/manifest.test.js`
Expected: PASS. Do not commit yet.

---

### Task 2: Move fixtures and every `m.project` consumer to v4

**Files:**
- Modify: `tests/fixtures/proposals/{GCA_000001.1,PRJNA000002,PRJNA000003}/manifest.json`
- Modify: `tests/helpers.js`, `tests/organisms.test.js`, `tests/proposal-ops.test.js`, `tests/load-ops.test.js`, `tests/dataset-classes.test.js`
- Modify: `shared/scripts/lib/organisms.js`, `lib/dataset-classes.js`, `lib/proposal-ops.js`, `lib/load-ops.js`, `dataset-types/genome-assembly.js`, `dataset-types/bulk-rnaseq.js`, `list-proposals.js`, `load-proposal.js`

Behaviour stays the same: every organism still gets the `--project` the curator gave. Only the shape changes.

- [ ] **Step 1: Fixture manifests**

In each of the three fixture `manifest.json` files, set `"schemaVersion": 4`, delete the `"project": "FungiDB",` line, and add the project to the organism. For example, PRJNA000002:
```json
  "organisms": [{ "proposedOrganismAbbrev": "tfakST1", "source": "loaded", "project": "FungiDB" }],
```
GCA_000001.1's organism is `source: "new"`. Add `"project": "FungiDB"` right after its `"source"`.

- [ ] **Step 2: Test helpers**

In `tests/helpers.js`, replace `loaded` with:
```js
/** A v4 organisms array of loaded organisms in project. */
export const loadedIn = (project, ...abbrevs) => abbrevs.map((proposedOrganismAbbrev) => ({ proposedOrganismAbbrev, source: 'loaded', project }));

/** A v4 organisms array of loaded FungiDB organisms. */
export const loaded = (...abbrevs) => loadedIn('FungiDB', ...abbrevs);
```

- [ ] **Step 3: Tests that build manifests by hand**

- `tests/organisms.test.js`:
  - `genomeManifest`: `schemaVersion: 4`. Move `project: 'FungiDB'` from the root into the organism literal.
  - `newOrganism`: add `project: 'FungiDB'` after `source: 'new'`.
  - `genomeDraft`, `genomeManifestV3`, `rnaManifest`: drop the root `project`.
  - `rnaDraft`: drop the root `project` and give each organism one: `abbrevs.map((p) => ({ proposedOrganismAbbrev: p, source: 'loaded', project: 'FungiDB' }))`.
  - Drafts at the former lines 298 and 308: drop the root `project`. `dottedGenome` must add `project: 'FungiDB'` if it does not spread `newOrganism`.
  - Expected outputs that list a loaded organism, e.g. in `a loaded organism in the project is settled as loaded`, become `{ proposedOrganismAbbrev: 'tfakST1', source: 'loaded', project: 'FungiDB' }`. A linked one, from `an organism only a pending genome proposes`, becomes `{ proposedOrganismAbbrev: 'tfakST-1', source: { proposal: 'GCA_1.1' }, project: 'FungiDB' }`.
  - Any `rnaManifest(...)` organism literal gets `project: 'FungiDB'`.
- `tests/proposal-ops.test.js`:
  - `plantedManifest`: `schemaVersion: 4`, drop the root `project`, add `project: 'FungiDB'` to its organism.
  - In `readOnRef rejects an invalid manifest on the ref`, plant `{ ...plantedManifest, organisms: [{ ...plantedManifest.organisms[0], project: 'NotADB' }] }` and expect `/organisms\[0\]\.project "NotADB" is not valid/`.
  - `manifestInput` and `rnaManifestInput` keep `project`: that is CLI input, not a manifest.
- `tests/load-ops.test.js`, in `listProposals reports a bad manifest…`: replace `setManifestFields(repo, 'PRJNA000002', { project: 'NotADB' })` with `setManifestFields(repo, 'PRJNA000002', { organisms: loadedIn('NotADB', 'tfakST1') })`. Expect `/organisms\[0\]\.project "NotADB" is not valid/`. Import `loadedIn` from `./helpers.js`.
- `tests/dataset-classes.test.js`, in `the rnaseq presenter name is the class loader datasetName`:
```js
  const manifest = { accession: 'PRJNA000002', organisms: [{ proposedOrganismAbbrev: 'tfakST1', source: 'loaded', project: 'FungiDB' }], name: 'Doe_heat_shock_2024', version: '2024-05-01' };
```

- [ ] **Step 4: Run the suite and watch it fail in production code**

Run: `yarn test 2>&1 | grep -E "^not ok|# (pass|fail)"`
Expected: failures that come from production code still reading `m.project`, such as `project "undefined" is not valid`, `organisms[0].project "undefined"` from `writeProposal`, or a presenter `projectName="undefined"`.

- [ ] **Step 5: `organisms.js`**

1. `pendingGenomeProposals`: claims carry the organism's project and tolerate a v3 manifest still on master:
```js
      if (organism) found.set(accession, { accession, project: organism.project ?? m.project, organism });
```
2. `crossCheckOrganisms`, loaded and linked branches: use `o.project` wherever the code used `m.project`, and keep `project` on what it returns:
```js
    if (index.some((e) => e.abbrev === p && e.project === o.project)) return { proposedOrganismAbbrev: p, source: 'loaded', project: o.project };
    const elsewhere = index.find((e) => e.abbrev === p);
    if (elsewhere) {
      errors.push(`${p} is a ${elsewhere.project} organism on ${rebuild}, not ${o.project}`);
      return o;
    }
    const genome = claims.find((c) => c.project === o.project && claimedAbbrev(c) === p);
    if (genome) {
      warnings.push(`${p} is not loaded: genome proposal ${genome.accession} proposes it, so it is not settled. This dataset loads in the same build as that genome or later.`);
      return { proposedOrganismAbbrev: p, source: { proposal: genome.accession }, project: o.project };
    }
```
3. `settleLinked(o, chosen, m, …)`: replace every `m.project` with `o.project`. The four uses are `recordsGenome`, two `loadedProblem` calls and the `index.find`.
4. `settleOrganisms`, loaded branch: `loadedProblem(candidate, o.project, index)`.

- [ ] **Step 6: `dataset-classes.js`**

```js
import { projectOf } from './manifest.js';
…
/** The identity values the class patterns use, for one of the proposal's organisms. */
export const identityValues = (m, organism) => ({
  projectName: projectOf(m, organism), organismAbbrev: organism, name: m.name, version: m.version
});
```

- [ ] **Step 7: `proposal-ops.js`**

1. Import `projectsOf` from `./manifest.js`.
2. `MANIFEST_ORDER`: remove `'project'`.
3. `assertNameIsFree`: `datasetFileRelativePath(o.project, o.proposedOrganismAbbrev)`.
4. `organismsFrom` gives every organism the input project (Task 3 refines additional organisms). The destructuring adds `project`:
```js
function organismsFrom(typeModule, { accession, datasetType, project, organism, additionalOrganisms = [] }, inputs, organismOverrides, warn) {
  …
  return [organism, ...additionalOrganisms].map((proposedOrganismAbbrev, i) => {
    if (!rule.new) return { proposedOrganismAbbrev, source: 'loaded', project };
    …
    return { proposedOrganismAbbrev, source: 'new', project, ...derived };
  });
}
```
5. `writeProposal` manifest literal: delete `project: manifestInput.project,`.
6. `publishProposal`:
```js
  const projects = projectsOf(manifest).join(', ');
  const title = `[${projects}] ${manifest.datasetType} ${accession}`;
```
   In the summary, use `` `Project: ${projects}` ``. In the commit, use ``git.commit(`Propose ${accession} (${manifest.datasetType}, ${projects})`)``.

- [ ] **Step 8: `load-ops.js`**

1. Import `homeProject, projectOf, projectsOf` from `./manifest.js`.
2. `checkLoadPreconditions`: `presenterFilePath(repoPath, homeProject(manifest))`, and in the "Presenter file missing" message `presenterFileRelativePath(homeProject(manifest))`.
3. `renderAndCheck`, "already exists" message: `presenterFileRelativePath(homeProject(m))`.
4. `renderDatasetParts`: inside the organism map, `const project = projectOf(manifest, organism);`. Use `project` in place of `manifest.project` for `relFile`, `datasetFilePath` and the "Is ${organism} a ${project} organism" message.
5. `loadProposal`: the presenter write uses `presenterFileRelativePath(homeProject(manifest))`. The commit is ``…to ${homeProject(manifest)}${alsoDataset}…``. The title is ``Load ${accession} (${manifest.datasetType}, ${projectsOf(manifest).join(', ')}) into build ${build}``. The PR body's presenter line uses `presenterFileRelativePath(homeProject(manifest))`.

- [ ] **Step 9: Dataset types and CLIs**

- `genome-assembly.js`: import `homeProject` from `../lib/manifest.js`. Then `<templateInjector projectName="${homeProject(m)}" …`.
- `bulk-rnaseq.js`: import `projectOf` with `organismsOf` from `../lib/manifest.js`. In `renderPresenter`:
```js
  const organism = organismOf(m, chosen);
  return `  <datasetPresenter name="${escapeXml(nameFor(m, organism))}"
                    projectName="${projectOf(m, organism)}">
```
  Rename the destructured option to `{ build, organism: chosen } = {}`, and keep the rest of the template unchanged.
- `list-proposals.js`: import `projectsOf` from `./lib/manifest.js`. The row uses `projectsOf(p).join(',')` in place of `p.project`.
- `load-proposal.js`: import `homeProject` from `./lib/manifest.js`. The dry-run line becomes ``…to ${homeProject(result.manifest)} and remove…``.

- [ ] **Step 10: No `m.project` left**

Run: `grep -rnE "(manifest|\bm|\bp)\.project\b" shared/scripts`
Expected: only `organisms.js` (`organism.project ?? m.project`, the v3 tolerance for claims). The `ticket/github.js` `cfg.project` is a different thing.

- [ ] **Step 11: Run the suite and watch it pass**

Run: `yarn test 2>&1 | tail -8`
Expected: `# fail 0`, with the pass count at 480 plus the Task 1 tests.

- [ ] **Step 12: Commit**

```bash
git add -A shared skills tests
git commit -m "Manifest v4: project belongs to each organism

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Each organism's project comes from the rebuild branch

**Files:**
- Modify: `shared/scripts/lib/organisms.js` (`crossCheckOrganisms`)
- Modify: `shared/scripts/lib/proposal-ops.js` (`organismsFrom`, `writeProposal` order)
- Modify: `shared/scripts/write-proposal.js` (usage text)
- Test: `tests/organisms.test.js`

`--project` names the home organism's project. An `--also-organism` takes its project from where the rebuild branch (or a pending genome claim) has it.

- [ ] **Step 1: Write the failing tests**

Append to `tests/organisms.test.js`:
```js
const unplaced = (p) => ({ proposedOrganismAbbrev: p, source: 'loaded' });

test('an additional organism takes its project from the rebuild branch', () => {
  const m = { accession: 'PRJNA1', organisms: [...rnaDraft('tfakST1').organisms, unplaced('tgonME49')] };
  assert.deepEqual(check(m), {
    organisms: [
      { proposedOrganismAbbrev: 'tfakST1', source: 'loaded', project: 'FungiDB' },
      { proposedOrganismAbbrev: 'tgonME49', source: 'loaded', project: 'ToxoDB' }
    ],
    errors: [], warnings: []
  });
});

test('an additional organism only a pending genome proposes takes the genome\'s project', () => {
  const m = { accession: 'PRJNA1', organisms: [...rnaDraft('tfakST1').organisms, unplaced('tfakST-1')] };
  const result = check(m, [claim('GCA_1.1')]);
  assert.deepEqual(result.organisms[1], { proposedOrganismAbbrev: 'tfakST-1', source: { proposal: 'GCA_1.1' }, project: 'FungiDB' });
  assert.deepEqual(result.errors, []);
});

test('an additional organism nothing knows is refused', () => {
  const m = { accession: 'PRJNA1', organisms: [...rnaDraft('tfakST1').organisms, unplaced('nope1')] };
  assert.deepEqual(check(m).errors, ['nope1 is not an organism on rebuild02 and no genome proposal on master proposes it']);
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `node --test tests/organisms.test.js`
Expected: FAIL. `tgonME49` is refused as `a ToxoDB organism on rebuild02, not undefined`.

- [ ] **Step 3: Resolve the project in `crossCheckOrganisms`**

Replace the loaded/linked part of the `m.organisms.map` callback, after the `source === 'new'` branch, with:
```js
    const placed = o.project !== undefined;
    const here = index.find((e) => e.abbrev === p && (!placed || e.project === o.project)) ?? index.find((e) => e.abbrev === p);
    if (here) {
      if (placed && here.project !== o.project) {
        errors.push(`${p} is a ${here.project} organism on ${rebuild}, not ${o.project}`);
        return o;
      }
      return { proposedOrganismAbbrev: p, source: 'loaded', project: here.project };
    }
    const genome = claims.find((c) => (!placed || c.project === o.project) && claimedAbbrev(c) === p);
    if (genome) {
      warnings.push(`${p} is not loaded: genome proposal ${genome.accession} proposes it, so it is not settled. This dataset loads in the same build as that genome or later.`);
      return { proposedOrganismAbbrev: p, source: { proposal: genome.accession }, project: genome.project };
    }
    errors.push(`${p} is not an organism on ${rebuild} and no genome proposal on master proposes it`);
    return o;
```
Update the function's doc comment: "…and records where each loaded-type organism comes from and its project; an organism without a project takes the one it is found in."

- [ ] **Step 4: `organismsFrom` places only the home organism; cross-check before validate**

In `proposal-ops.js`, `organismsFrom`:
```js
    if (!rule.new) return i === 0 ? { proposedOrganismAbbrev, source: 'loaded', project } : { proposedOrganismAbbrev, source: 'loaded' };
```
In `writeProposal`, move the `crossCheckOrganisms` block (from `const crossCheck = …` through `manifest.organisms = crossCheck.organisms;`) above the `const errors = validate(manifest, …)` block. The cross-check only reads `accession` and `organisms`. Validation then sees every organism with a project. Delete the comment `// The cross-checked organisms are validated again when the manifest is written.`, which no longer describes the order.

- [ ] **Step 5: CLI usage text**

In `shared/scripts/write-proposal.js`, add one usage line after the example:
```
 * --project names the first organism's project; each --also-organism takes the
 * project the rebuild branch (or a pending genome proposal) has it in.
```

- [ ] **Step 6: Run the suite**

Run: `yarn test 2>&1 | tail -8`
Expected: `# fail 0`.

- [ ] **Step 7: Commit**

```bash
git add -A shared skills tests
git commit -m "An additional organism takes its project from the rebuild branch

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Sample membership

**Files:**
- Modify: `shared/scripts/dataset-types/bulk-rnaseq.js`
- Test: `tests/dataset-types.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `tests/dataset-types.test.js`:
```js
const twoOrganisms = { accession: 'PRJNA9', organisms: [...loaded('tfakST1'), ...loaded('hfakH1')] };
const tagged = (...tags) => ({ samples: tags.map((organisms, i) => ({ sampleId: `S${i + 1}`, ...(organisms ? { organisms } : {}) })) });

test('membershipErrors accepts each way samples can map to organisms', () => {
  assert.deepEqual(rnaseq.membershipErrors(tagged(['tfakST1', 'hfakH1'], ['tfakST1', 'hfakH1']), twoOrganisms), []);
  assert.deepEqual(rnaseq.membershipErrors(tagged(['hfakH1'], ['tfakST1', 'hfakH1']), twoOrganisms), []);
  assert.deepEqual(rnaseq.membershipErrors(tagged(['tfakST1'], ['hfakH1']), twoOrganisms), []);
});

test('membershipErrors needs every sample tagged when there are two organisms, and every organism used', () => {
  assert.deepEqual(rnaseq.membershipErrors(tagged(['tfakST1'], undefined), twoOrganisms), [
    'Sample S2: list the organisms it aligns to under "organisms"; PRJNA9 aligns to tfakST1, hfakH1'
  ]);
  assert.deepEqual(rnaseq.membershipErrors(tagged(['tfakST1'], ['tfakST1']), twoOrganisms), ['No sample aligns to hfakH1']);
  assert.deepEqual(rnaseq.membershipErrors(tagged([], ['tfakST1', 'nope1']), twoOrganisms), [
    'Sample S1: organisms must be a non-empty array of organism abbreviations',
    'Sample S2: nope1 is not an organism of PRJNA9; use one of tfakST1, hfakH1',
    'No sample aligns to hfakH1'
  ]);
});

test('membershipErrors lets one organism go untagged', () => {
  const one = { accession: 'PRJNA9', organisms: loaded('tfakST1') };
  assert.deepEqual(rnaseq.membershipErrors(tagged(undefined, undefined), one), []);
  assert.deepEqual(rnaseq.membershipErrors(tagged(['hfakH1']), one), ['Sample S1: hfakH1 is not an organism of PRJNA9; use one of tfakST1', 'No sample aligns to tfakST1']);
});

test('samplesFor filters by tag; untagged samples belong to every organism', () => {
  const ids = (a, p) => rnaseq.samplesFor(a, twoOrganisms, p).map((s) => s.sampleId);
  assert.deepEqual(ids(tagged(['hfakH1'], ['tfakST1', 'hfakH1']), 'tfakST1'), ['S2']);
  assert.deepEqual(ids(tagged(['hfakH1'], ['tfakST1', 'hfakH1']), 'hfakH1'), ['S1', 'S2']);
  assert.deepEqual(ids(tagged(undefined), 'hfakH1'), ['S1']);
});

test('normalizeCurated refuses annotations whose membership does not cover the organisms', (t) => {
  const dir = copyOf(t, rnaDir);
  const path = join(dir, 'manifest.json');
  writeFileSync(path, JSON.stringify({ ...readJson(path), organisms: [...loaded('tfakST1'), ...loaded('tfakST2')] }));
  assert.throws(() => rnaseq.normalizeCurated(dir), /Sample organisms of PRJNA000002 do not match its organisms:\n  - Sample SAMN1: list the organisms/);
});

test('membershipErrors refuses non-array tags without coercing them, and they do not count as alignment', () => {
  const notArray = 'must be a non-empty array of organism abbreviations';
  assert.deepEqual(rnaseq.membershipErrors(tagged('tfakST1', ['hfakH1']), twoOrganisms), [`Sample S1: organisms ${notArray}`, 'No sample aligns to tfakST1']);
  assert.deepEqual(rnaseq.membershipErrors(tagged(5, ['tfakST1', 'hfakH1']), twoOrganisms), [`Sample S1: organisms ${notArray}`]);
  assert.deepEqual(rnaseq.samplesFor(tagged('tfakST1'), twoOrganisms, 'tfakST1'), []);
});

test('membershipErrors needs a samples array', () => {
  assert.deepEqual(rnaseq.membershipErrors({}, twoOrganisms), ['PRJNA9_sample_annotations.json has no "samples" array']);
});

test('membershipErrors flags a duplicate tag', () => {
  assert.deepEqual(rnaseq.membershipErrors(tagged(['tfakST1', 'tfakST1'], ['hfakH1']), twoOrganisms), ['Sample S1: lists tfakST1 twice']);
});

test('membershipErrors names a sample without an id by position', () => {
  assert.deepEqual(rnaseq.membershipErrors({ samples: [{ organisms: ['nope1'] }] }, { accession: 'PRJNA9', organisms: loaded('tfakST1') }), [
    'Sample sample #1: nope1 is not an organism of PRJNA9; use one of tfakST1',
    'No sample aligns to tfakST1'
  ]);
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `node --test tests/dataset-types.test.js`
Expected: FAIL with `rnaseq.membershipErrors is not a function`.

- [ ] **Step 3: Implement membership in `bulk-rnaseq.js`**

Add after `annotationsFile`:
```js
const proposedOf = (m) => m.organisms.map((o) => o.proposedOrganismAbbrev);
const tagsOf = (s, m) => (s.organisms === undefined ? proposedOf(m) : Array.isArray(s.organisms) ? s.organisms : []);

/** The samples aligned to one organism, by proposed abbreviation; an untagged sample aligns to every organism. */
export const samplesFor = (annotations, m, proposed) =>
  annotations.samples.filter((s) => tagsOf(s, m).includes(proposed));

/**
 * Errors when the samples' organisms tags do not map onto the manifest's
 * organisms: with two or more, every sample must say which it aligns to, and
 * every organism needs a sample.
 */
export function membershipErrors(annotations, m) {
  if (!Array.isArray(annotations.samples)) return [`${annotationsFile(m)} has no "samples" array`];
  const proposed = proposedOf(m);
  const errors = [];
  annotations.samples.forEach((s, i) => {
    const who = s.sampleId ?? s.label ?? `sample #${i + 1}`;
    if (s.organisms === undefined) {
      if (proposed.length > 1) errors.push(`Sample ${who}: list the organisms it aligns to under "organisms"; ${m.accession} aligns to ${proposed.join(', ')}`);
      return;
    }
    if (!Array.isArray(s.organisms) || !s.organisms.length) {
      errors.push(`Sample ${who}: organisms must be a non-empty array of organism abbreviations`);
      return;
    }
    s.organisms.forEach((o, j) => {
      if (!proposed.includes(o)) errors.push(`Sample ${who}: ${o} is not an organism of ${m.accession}; use one of ${proposed.join(', ')}`);
      else if (s.organisms.indexOf(o) !== j) errors.push(`Sample ${who}: lists ${o} twice`);
    });
  });
  for (const p of proposed) if (!samplesFor(annotations, m, p).length) errors.push(`No sample aligns to ${p}`);
  return errors;
}

function assertMembership(annotations, m) {
  const errors = membershipErrors(annotations, m);
  if (errors.length) throw new Error(`Sample organisms of ${m.accession} do not match its organisms:\n  - ${errors.join('\n  - ')}\nFix the "organisms" tags in ${annotationsFile(m)}.`);
}
```
In `normalizeCurated`, before `writeFileSync`, add `assertMembership(normalized, m);`.

`samplesFor` never coerces: a sample whose `organisms` is not an array aligns to nothing, and `membershipErrors` reports it.

- [ ] **Step 4: Run the suite**

Run: `yarn test 2>&1 | tail -8`
Expected: one failure, `tests/proposal-ops.test.js` near line 522, the test expecting `FungiDB/tfakST2.xml on origin/rebuild02 already has a rnaSeqExperiment named "Doe_cold_shock_2024"`. `normalizeCurated` runs before `assertNameIsFree` in `writeProposal`, so the untagged annotations now stop it first. Give that test tagged annotations: write a copy of the cold-shock annotations in which every sample has `"organisms": ["tfakST1", "tfakST2"]`, and pass it in place of the original in `curated`. Then it reaches the name check again. Any other multi-organism test that reaches `normalizeCurated` gets the same treatment. Never weaken the check.

- [ ] **Step 5: Commit**

```bash
git add -A shared skills tests
git commit -m "RNA-seq samples say which organisms they align to

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Per-organism curated artifacts

**Files:**
- Modify: `shared/scripts/dataset-types/bulk-rnaseq.js` (`analysisConfig`, `deriveArtifacts`, `checkCurated`, `renderArtifacts`)
- Modify: `shared/scripts/lib/proposal-ops.js` (`writeProposal` writes nested paths)
- Move: `tests/fixtures/proposals/PRJNA00000{2,3}/curated/{samplesheet.csv,analysisConfig.xml,entity-sample.tsv,entity-sample.yaml}` → `curated/tfakST1/`
- Modify: `tests/helpers.js` (`alignTo`), `tests/artifacts.test.js`, `tests/dataset-types.test.js`, `tests/proposal-ops.test.js`, `tests/load-ops.test.js`

- [ ] **Step 1: Move the fixture artifacts**

```bash
for acc in PRJNA000002 PRJNA000003; do
  d=tests/fixtures/proposals/$acc/curated
  mkdir -p $d/tfakST1
  git mv $d/samplesheet.csv $d/analysisConfig.xml $d/entity-sample.tsv $d/entity-sample.yaml $d/tfakST1/
done
```

- [ ] **Step 2: Add the `alignTo` helper**

In `tests/helpers.js`, extend the `node:fs` import with `readFileSync, writeFileSync, rmSync` and the `node:path` import with `dirname`. Then add:
```js
import { deriveArtifacts } from '../shared/scripts/dataset-types/bulk-rnaseq.js';

/**
 * Re-aims an RNA-seq proposal directory at organisms ([{ abbrev, project }]),
 * tags each sample with membership[sampleId], and re-derives its curated artifacts.
 */
export function alignTo(proposalDir, organisms, membership) {
  const manifestPath = join(proposalDir, 'manifest.json');
  const m = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  const entries = organisms.map(({ abbrev, project = 'FungiDB' }) => ({ proposedOrganismAbbrev: abbrev, source: 'loaded', project }));
  writeFileSync(manifestPath, JSON.stringify({ ...m, organisms: entries }, null, 2) + '\n');
  const annotationsPath = join(proposalDir, 'curated', `${m.accession}_sample_annotations.json`);
  const a = JSON.parse(readFileSync(annotationsPath, 'utf-8'));
  writeFileSync(annotationsPath, JSON.stringify({ ...a, samples: a.samples.map((s) => ({ ...s, organisms: membership[s.sampleId] })) }, null, 2) + '\n');
  for (const o of m.organisms) rmSync(join(proposalDir, 'curated', o.proposedOrganismAbbrev), { recursive: true, force: true });
  for (const [f, text] of Object.entries(deriveArtifacts(proposalDir))) {
    mkdirSync(dirname(join(proposalDir, 'curated', f)), { recursive: true });
    writeFileSync(join(proposalDir, 'curated', f), text);
  }
}
```

- [ ] **Step 3: Write the failing tests**

Append to `tests/artifacts.test.js` (import `alignTo` from `./helpers.js`):
```js
test('deriveArtifacts writes each organism its own artifacts from its own samples', (t) => {
  const dir = copyOf(t, rnaDir);
  alignTo(dir, [{ abbrev: 'tfakST1' }, { abbrev: 'hfakH1', project: 'HostDB' }], { SAMN1: ['hfakH1'], SAMN2: ['tfakST1', 'hfakH1'] });
  const files = rnaseq.deriveArtifacts(dir);
  assert.deepEqual(Object.keys(files).sort(), ['hfakH1', 'tfakST1'].flatMap((o) => rnaseq.derivedCuratedFiles.map((f) => `${o}/${f}`)).sort());
  assert.equal(files['tfakST1/samplesheet.csv'], 'sample,fastq_1,fastq_2,strandedness\nSAMN2,SRR2,,stranded\n');
  assert.equal(files['hfakH1/samplesheet.csv'], 'sample,fastq_1,fastq_2,strandedness\nSAMN1,SRR1,,stranded\nSAMN2,SRR2,,stranded\n');
  assert.match(files['tfakST1/analysisConfig.xml'], /<property name="profileSetName" value="tfakST1 Testus fakeus stress &amp; recovery"\/>/);
  assert.match(files['hfakH1/analysisConfig.xml'], /value="hfakH1 Testus fakeus stress &amp; recovery"/);
  assert.doesNotMatch(files['tfakST1/entity-sample.tsv'], /SAMN1/);
  assert.deepEqual(rnaseq.checkCurated(dir), []);
});

test('checkCurated holds each organism to its own samples and names the organism', (t) => {
  const dir = copyOf(t, rnaDir);
  alignTo(dir, [{ abbrev: 'tfakST1' }, { abbrev: 'hfakH1', project: 'HostDB' }], { SAMN1: ['hfakH1'], SAMN2: ['tfakST1', 'hfakH1'] });
  const sheet = join(dir, 'curated', 'tfakST1', 'samplesheet.csv');
  writeFileSync(sheet, readFileSync(sheet, 'utf-8') + 'SAMN1,SRR1,,stranded\n');
  const errors = rnaseq.checkCurated(dir).join('\n');
  assert.match(errors, /^tfakST1: samplesheet\.csv and entity-sample\.tsv disagree: only in samplesheet\.csv: SAMN1/m);
  assert.match(errors, /^tfakST1: samplesheet\.csv and the samples tagged for tfakST1 disagree: only in samplesheet\.csv: SAMN1/m);
});

test('renderArtifacts delivers an organism its own samples and filtered annotations', (t) => {
  const dir = copyOf(t, rnaDir);
  alignTo(dir, [{ abbrev: 'tfakST1' }, { abbrev: 'hfakH1', project: 'HostDB' }], { SAMN1: ['hfakH1'], SAMN2: ['tfakST1', 'hfakH1'] });
  const { files } = rnaseq.renderArtifacts(dir, 'tfakST1');
  assert.deepEqual(JSON.parse(files['sampleAnnotations.json']).samples.map((s) => s.sampleId), ['SAMN2']);
  assert.ok('sample-annotations-stf/tfakST1_Doe_heat_shock_2024_rnaSeq_RSRC/entity-sample.tsv' in files);
});
```

- [ ] **Step 4: Run them and watch them fail**

Run: `node --test tests/artifacts.test.js`
Expected: FAIL. `deriveArtifacts` still returns flat keys.

- [ ] **Step 5: Implement per-organism artifacts in `bulk-rnaseq.js`**

1. Import `proposedAbbrevOf` from `../lib/manifest.js`.
2. `derivedCuratedFiles` keeps its four base names; update its doc comment:
```js
/**
 * Derived per organism into curated/<proposed abbreviation>/ by
 * write-proposal.js, which never overwrites a hand edit without the curator's
 * choice; checked again at publish and load.
 */
```
3. `analysisConfig` takes a prefix:
```js
function analysisConfig(annotations, m, isStrandSpecific, prefix) {
  const base = annotations.profileSetName || `${m.name} RNA-Seq`;
  const profileSetName = prefix ? `${prefix} ${base}` : base;
```
   (The rest is unchanged.)
4. `deriveArtifacts`:
```js
/** Phase 1: each organism's loading artifacts, keyed <proposed abbreviation>/<file>. */
export function deriveArtifacts(proposalDir) {
  const m = loadManifest(proposalDir);
  requireIdentity(m, datasetClass);
  const { props, source = DEFAULT_SOURCE } = readDataset(proposalDir);
  const annotations = readCuratedJson(proposalDir, annotationsFile(m));
  const stranded = props.isStrandSpecific === 'true';
  const multi = m.organisms.length > 1;
  return Object.fromEntries(proposedOf(m).flatMap((p) => {
    const own = { ...annotations, samples: samplesFor(annotations, m, p) };
    const { tsv, yaml } = sampleAnnotationsToStf(own, { sra: source.type === 'sra' });
    return [
      [`${p}/samplesheet.csv`, samplesheet(own, stranded)],
      [`${p}/analysisConfig.xml`, analysisConfig(own, m, stranded, multi ? p : null)],
      [`${p}/entity-sample.tsv`, tsv],
      [`${p}/entity-sample.yaml`, yaml]
    ];
  }));
}
```
5. `checkCurated`: split it into a per-organism check plus the membership and annotation checks. Replace the whole function with:
```js
/** Errors when the curated artifacts, the sample annotations or the samples' organisms disagree. */
export function checkCurated(proposalDir) {
  const m = loadManifest(proposalDir);
  const annotationsName = annotationsFile(m);
  const annotationsPath = join(proposalDir, 'curated', annotationsName);
  if (!existsSync(annotationsPath)) {
    return [...proposedOf(m).flatMap((p) => missingArtifacts(proposalDir, p)), `curated/${annotationsName} is missing`];
  }
  let annotations;
  try { annotations = JSON.parse(readFileSync(annotationsPath, 'utf-8')); }
  catch (e) { return [`${annotationsName} is not valid JSON: ${e.message}`]; }
  const membership = membershipErrors(annotations, m);
  if (membership.length) return membership;
  const multi = m.organisms.length > 1;
  return proposedOf(m).flatMap((p) => checkOrganism(proposalDir, m, p, annotations, annotationsName)
    .map((e) => (multi ? `${p}: ${e}` : e)));
}

const missingArtifacts = (proposalDir, p) => derivedCuratedFiles
  .filter((f) => !existsSync(join(proposalDir, 'curated', p, f)))
  .map((f) => `curated/${p}/${f} is missing; re-run write-proposal.js`);

/** One organism's artifacts against each other, dataset.json and the samples tagged for it. */
function checkOrganism(proposalDir, m, p, annotations, annotationsName) {
  const missing = missingArtifacts(proposalDir, p);
  if (missing.length) return missing;
  const files = Object.fromEntries(derivedCuratedFiles.map((f) => [f, readFileSync(join(proposalDir, 'curated', p, f), 'utf-8')]));
  // …from here, the body of the old checkCurated, from `const { props, source = DEFAULT_SOURCE } = readDataset(proposalDir);`
  //   down to the isStrandSpecific check, unchanged, except the annotations comparison:
  const tagged = new Set(samplesFor(annotations, m, p).map((s) => s.sampleId));
  const versus = m.organisms.length > 1 ? `the samples tagged for ${p}` : annotationsName;
  errors.push(...differ(sheetIds, 'samplesheet.csv', tagged, versus));
  // …then `return errors;`
}
```
   Copy the old body in for real; the two `// …` lines above mark where. The old code's `let annotations; try { JSON.parse(files[annotationsName]) }` block and its `differ(… annotationsName)` line are replaced by the three `tagged` lines. All other messages keep their exact text, so single-organism messages do not change.
6. `renderArtifacts`:
```js
export function renderArtifacts(proposalDir, organism) {
  const m = loadManifest(proposalDir);
  requireIdentity(m, datasetClass);
  assertCuratedAgree(proposalDir);
  const settled = organismOf(m, organism);
  const p = proposedAbbrevOf(m, settled);
  const text = (f) => readFileSync(join(proposalDir, 'curated', p, f), 'utf-8');
  const stfDir = `sample-annotations-stf/${nameFor(m, settled)}`;
  return {
    files: {
      'analysisConfig.xml': text('analysisConfig.xml'),
      'samplesheet.csv': text('samplesheet.csv'),
      'sampleAnnotations.json': annotationsFor(proposalDir, m, p),
      [`${stfDir}/entity-sample.tsv`]: text('entity-sample.tsv'),
      [`${stfDir}/entity-sample.yaml`]: text('entity-sample.yaml')
    }
  };
}

/** The curated annotations as written when every sample aligns to p; otherwise only p's samples. */
function annotationsFor(proposalDir, m, p) {
  const raw = readFileSync(join(proposalDir, 'curated', annotationsFile(m)), 'utf-8');
  const annotations = JSON.parse(raw);
  const own = samplesFor(annotations, m, p);
  return own.length === annotations.samples.length ? raw : JSON.stringify({ ...annotations, samples: own }, null, 2) + '\n';
}
```

- [ ] **Step 6: `writeProposal` writes nested artifact paths**

In `proposal-ops.js`, import `dirname` from `node:path`. In `writeProposal`, replace the `artifactsToWrite(…)` call and the loop after it with:
```js
        const derived = datasetType.deriveArtifacts(staged);
        const artifacts = artifactsToWrite(dir, derived, Object.keys(derived), curatedEdits);
        for (const [f, text] of Object.entries(artifacts)) {
          mkdirSync(dirname(join(staged, 'curated', f)), { recursive: true });
          writeFileSync(join(staged, 'curated', f), text);
        }
```
The clash check (`derivedNames … basename(f)`) keeps using `derivedCuratedFiles` as base names. A curator file named `samplesheet.csv` is still refused.

- [ ] **Step 7: Move the existing tests to the nested layout**

Run `node --test tests/artifacts.test.js tests/dataset-types.test.js tests/proposal-ops.test.js tests/load-ops.test.js` and fix each failure by these rules only:

- A path `curated/<artifact>` (via `join(dir, 'curated', '<artifact>')`, `'curated/<artifact>'`, or a `rewrite`/`handEdit`/`curatedText` helper that builds one) becomes `curated/tfakST1/<artifact>`. Change the helpers once, e.g. `const rewrite = (dir, f, edit) => { const p = join(dir, 'curated', 'tfakST1', f); … }`, rather than each call.
- `deriveArtifacts(dir)['samplesheet.csv']` becomes `deriveArtifacts(dir)['tfakST1/samplesheet.csv']`. Likewise for other keys.
- In `deriveArtifacts produces the derivedCuratedFiles…`, compare against `rnaseq.derivedCuratedFiles.map((f) => \`tfakST1/${f}\`)`.
- Missing-file messages become `curated/tfakST1/entity-sample.yaml is missing; re-run write-proposal.js`.
- Hand-edit choices and messages name `tfakST1/analysisConfig.xml`, for example `curatedEdits: { keep: ['tfakST1/analysisConfig.xml'], replace: ['tfakST1/samplesheet.csv'] }`, and `curated/tfakST1/analysisConfig.xml differs from what write-proposal would derive`. The `notes.txt` case stays `curated/notes.txt is not a curated artifact that differs`.
- Tests that set `organisms: loaded('tfakST1', 'tfakST2')` on a copy and then render artifacts call `alignTo(dir, [{ abbrev: 'tfakST1' }, { abbrev: 'tfakST2' }], { SAMN1: ['tfakST1', 'tfakST2'], SAMN2: ['tfakST1', 'tfakST2'] })` instead. In `load-ops.test.js`, `rnaForTwoOrganisms` does this on `join(setup.repo, 'Proposals/PRJNA000002')` before `commitAll`. In `artifacts.test.js`, `render-proposal --artifacts writes one delivery per organism…` does it on `join(repo, 'Proposals/PRJNA000002')`.
- `proposal-ops.test.js` line ~663 loops over the four artifacts in the written proposal: look under `curated/tfakST1/`.

Single-organism error messages and expected-artifacts goldens must not change. If one does, the implementation is wrong, not the test.

- [ ] **Step 8: Run the suite**

Run: `yarn test 2>&1 | tail -8`
Expected: `# fail 0`.

- [ ] **Step 9: Commit**

```bash
git add -A shared skills tests
git commit -m "Curated RNA-seq artifacts per organism, from each organism's samples

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Per-organism injector props in presenter.json

**Files:**
- Modify: `shared/scripts/dataset-types/_common.js`
- Test: `tests/dataset-types.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `tests/dataset-types.test.js`:
```js
test('presenter overrides may set injector props per organism', (t) => {
  const path = overridesFile(t, JSON.stringify({ presenter: { organisms: { hfakH1: { injectorProps: { isDESeq: 'false' } } } } }));
  const { presenter } = readOverrides(path);
  const p = rnaseq.derivePresenter(rnaDir, { ...presenterOverridesFor('PRJNA000002'), ...presenter });
  assert.deepEqual(p.organisms, { hfakH1: { injectorProps: { isDESeq: 'false' } } });
  assert.equal('organisms' in rnaseq.derivePresenter(rnaDir, presenterOverridesFor('PRJNA000002')), false);
});

test('validatePresenter holds per-organism injector props to the same rules', () => {
  const p = readJson(join(rnaDir, 'curated', 'presenter.json'));
  const opts = { requiredInjectorProps: rnaseq.requiredInjectorProps };
  assert.deepEqual(validatePresenter({ ...p, organisms: { hfakH1: { injectorProps: { isDESeq: 'false' } } } }, opts), []);
  assert.deepEqual(validatePresenter({ ...p, organisms: [] }, opts), ['organisms must be an object of { injectorProps } by organism']);
  assert.deepEqual(validatePresenter({ ...p, organisms: { hfakH1: { color: 'x' } } }, opts), ['organisms.hfakH1 may hold only injectorProps']);
  assert.deepEqual(validatePresenter({ ...p, organisms: { hfakH1: { injectorProps: { 'bad name': 'x', isDESeq: 1 } } } }, opts),
    ['organisms.hfakH1.injectorProps must be an object of string values']);
  assert.deepEqual(validatePresenter({ ...p, organisms: { hfakH1: { injectorProps: { graphXAxisSamplesDescription: ' ' } } } }, opts),
    ['organisms.hfakH1.injectorProps.graphXAxisSamplesDescription is required and is empty']);
});
```
(`overridesFile` already exists in this file; check its name with `grep -n "function overridesFile" tests/dataset-types.test.js`.)

- [ ] **Step 2: Run them and watch them fail**

Run: `node --test tests/dataset-types.test.js`
Expected: FAIL. `readOverrides` refuses the `presenter organisms` key.

- [ ] **Step 3: Implement in `_common.js`**

1. `export const PRESENTER_OVERRIDE_KEYS = [...TEXT_FIELDS, 'pubmedIds', 'injectorProps', 'organisms'];`
2. `applyOverrides`:
```js
/** Derived values first, curator overrides on top; injectorProps merge by name, per-organism overrides come whole. */
export function applyOverrides(derived, overrides = {}) {
  const { injectorProps, organisms, ...rest } = overrides;
  return { ...derived, ...rest, injectorProps: { ...derived.injectorProps, ...injectorProps }, ...(organisms === undefined ? {} : { organisms }) };
}
```
3. Factor the string-map check out of `validatePresenter` and add the `organisms` check:
```js
const stringMapErrors = (v, where) => {
  if (!isObject(v) || !Object.values(v).every((x) => typeof x === 'string')) return [`${where} must be an object of string values`];
  return Object.keys(v).filter((name) => !XML_NAME.test(name)).map((name) => `${where} has an invalid name "${name}"`);
};

function presenterOrganismErrors(organisms, requiredInjectorProps) {
  if (organisms === undefined) return [];
  if (!isObject(organisms)) return ['organisms must be an object of { injectorProps } by organism'];
  return Object.entries(organisms).flatMap(([abbrev, o]) => {
    const at = `organisms.${abbrev}`;
    if (!isObject(o) || Object.keys(o).some((k) => k !== 'injectorProps')) return [`${at} may hold only injectorProps`];
    const errors = stringMapErrors(o.injectorProps ?? {}, `${at}.injectorProps`);
    if (errors.length) return errors;
    return requiredInjectorProps
      .filter((k) => k in (o.injectorProps ?? {}) && o.injectorProps[k].trim() === '')
      .map((k) => `${at}.injectorProps.${k} is required and is empty`);
  });
}
```
   In `validatePresenter`, replace the `for (const key of ['history', 'injectorProps'])` loop with `for (const key of ['history', 'injectorProps']) errors.push(...stringMapErrors(p[key], key));`. Before `return errors;`, add `errors.push(...presenterOrganismErrors(p.organisms, requiredInjectorProps));`.

   `stringMapErrors` returns the same messages the old loop did, so the existing `validatePresenter rejects bad pubmed ids, links and prop names` test still passes. `isObject` already exists in `_common.js`.

- [ ] **Step 4: Run the suite**

Run: `yarn test 2>&1 | tail -8`
Expected: `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add -A shared skills tests
git commit -m "presenter.json may override injector props per organism

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: One presenter per proposal, with an injector per organism

**Files:**
- Modify: `shared/scripts/dataset-types/bulk-rnaseq.js` (`presenterNames`, `renderPresenter`)
- Modify: `shared/scripts/dataset-types/genome-assembly.js` (doc comment only)
- Modify: `shared/scripts/lib/proposal-ops.js`, `shared/scripts/lib/load-ops.js`, `shared/scripts/render-proposal.js`
- Test: `tests/dataset-types.test.js`, `tests/load-ops.test.js`, `tests/render-proposal.test.js`

- [ ] **Step 1: Write the failing tests**

In `tests/dataset-types.test.js`, import `alignTo` from `./helpers.js`. Replace the test `rnaseq names one presenter per organism, reference first` with:
```js
test('a multi-organism rnaseq proposal has one presenter with an injector per organism', (t) => {
  const dir = copyOf(t, rnaDir);
  alignTo(dir, [{ abbrev: 'tfakST1' }, { abbrev: 'hfakH1', project: 'HostDB' }], { SAMN1: ['hfakH1'], SAMN2: ['tfakST1', 'hfakH1'] });
  editPresenter(dir, (p) => ({ ...p, organisms: { hfakH1: { injectorProps: { isDESeq: 'true', switchStrandsProfiles: 'true' } } } }));
  assert.deepEqual(rnaseq.presenterNames(dir), ['Doe_heat_shock_2024_rnaSeq_RSRC']);
  const xml = rnaseq.renderPresenter(dir, { build: '02' });
  assert.match(xml, /^  <datasetPresenter name="Doe_heat_shock_2024_rnaSeq_RSRC"\n\s+datasetNamePattern="%_Doe_heat_shock_2024_rnaSeq_RSRC">/);
  assert.doesNotMatch(xml.split('\n')[0] + xml.split('\n')[1], /projectName=/);
  const injectors = [...xml.matchAll(/<templateInjector ([^>]*)>([\s\S]*?)<\/templateInjector>/g)];
  assert.deepEqual(injectors.map((i) => i[1]), [
    'projectName="FungiDB" datasourceName="tfakST1_Doe_heat_shock_2024_rnaSeq_RSRC" className="org.apidb.apicommon.model.datasetInjector.RNASeq"',
    'projectName="HostDB" datasourceName="hfakH1_Doe_heat_shock_2024_rnaSeq_RSRC" className="org.apidb.apicommon.model.datasetInjector.RNASeq"'
  ]);
  assert.match(injectors[0][2], /<prop name="isDESeq">false<\/prop>/);
  assert.match(injectors[0][2], /<prop name="graphType">line<\/prop>/);
  assert.match(injectors[1][2], /<prop name="isDESeq">true<\/prop>/);
  assert.match(injectors[1][2], /<prop name="switchStrandsProfiles">true<\/prop>/);
  assert.match(injectors[1][2], /<prop name="graphType">line<\/prop>/);
});

test('rnaseq refuses per-organism injector props for an organism the proposal does not have', (t) => {
  const dir = copyOf(t, rnaDir);
  editPresenter(dir, (p) => ({ ...p, organisms: { hfakH1: { injectorProps: { isDESeq: 'true' } } } }));
  assert.throws(() => rnaseq.renderPresenter(dir, { build: '02' }), /presenter\.json organisms names hfakH1, which is not an organism of PRJNA000002/);
});

test('a multi-organism presenter uses settled abbreviations in datasourceName', (t) => {
  const dir = copyOf(t, rnaDir);
  alignTo(dir, [{ abbrev: 'tfakST1' }, { abbrev: 'hfakH1', project: 'HostDB' }], { SAMN1: ['hfakH1'], SAMN2: ['tfakST1', 'hfakH1'] });
  const path = join(dir, 'manifest.json');
  const m = readJson(path);
  writeFileSync(path, JSON.stringify({ ...m, organisms: m.organisms.map((o, i) => ({ ...o, organismAbbrev: i ? 'hfakREF' : o.proposedOrganismAbbrev })) }));
  assert.match(rnaseq.renderPresenter(dir, { build: '02' }), /datasourceName="hfakREF_Doe_heat_shock_2024_rnaSeq_RSRC"/);
});
```
Single-organism goldens (`render(PRJNA000002) matches its golden expected.xml`) must keep passing unchanged.

In `tests/load-ops.test.js`, change the two-organism tests' expectations to the one presenter:
```js
const BOTH_PRESENTERS = ['Doe_heat_shock_2024_rnaSeq_RSRC'];
```
In `an rnaseq load with an additional organism…`, assert the one presenter instead of looping `name=` per organism:
```js
  assert.match(presenters, /name="Doe_heat_shock_2024_rnaSeq_RSRC"\n\s+datasetNamePattern="%_Doe_heat_shock_2024_rnaSeq_RSRC"/);
  assert.equal(presenters.match(/<templateInjector /g).length, 2);
```
Expect the commit subject `'Load PRJNA000002: add Doe_heat_shock_2024_rnaSeq_RSRC to FungiDB, Doe_heat_shock_2024 to tfakST1 tfakST2, remove proposal'`.

In `tests/render-proposal.test.js` (line ~32, the two-organism case), expect one presenter named `Doe_heat_shock_2024_rnaSeq_RSRC`. Re-aim with `alignTo` as in Task 5 Step 7.

- [ ] **Step 2: Run them and watch them fail**

Run: `node --test tests/dataset-types.test.js tests/load-ops.test.js tests/render-proposal.test.js`
Expected: FAIL. `presenterNames` returns two names.

- [ ] **Step 3: Implement in `bulk-rnaseq.js`**

Replace `presenterNames`, `renderPresenter` and `organismOf`'s use in it with:
```js
const RNASEQ_INJECTOR = 'org.apidb.apicommon.model.datasetInjector.RNASeq';
/** The presenter of a multi-organism proposal; its datasetNamePattern matches every organism's dataset. */
const sharedNameFor = (m) => `${m.name}_rnaSeq_RSRC`;

export function presenterNames(proposalDir) {
  const m = loadManifest(proposalDir);
  requireIdentity(m, datasetClass);
  return [m.organisms.length > 1 ? sharedNameFor(m) : nameFor(m, organismsOf(m)[0])];
}

function assertPresenterOrganisms(p, m) {
  const proposed = m.organisms.map((o) => o.proposedOrganismAbbrev);
  const stray = Object.keys(p.organisms ?? {}).filter((k) => !proposed.includes(k));
  if (stray.length) throw new Error(`presenter.json organisms names ${stray.join(', ')}, which ${stray.length === 1 ? 'is' : 'are'} not an organism of ${m.accession}`);
}

/** Shared props, then the organism's own on top. */
const propsFor = (p, o) => injectorProps(injectorDefaults, { ...p.injectorProps, ...p.organisms?.[o.proposedOrganismAbbrev]?.injectorProps });

/**
 * Phase 2: the proposal's one presenter, from the manifest and the presenter
 * record only. One organism names it and carries projectName on the
 * presenter; several share it through datasetNamePattern, each with its own
 * injector naming its project and dataset.
 */
export function renderPresenter(proposalDir, { build } = {}) {
  requireBuild(build);
  const m = loadManifest(proposalDir);
  requireIdentity(m, datasetClass);
  const p = readPresenter(proposalDir, { requiredFields, requiredInjectorProps });
  assertPresenterOrganisms(p, m);
  const contacts = contactElements(m.contacts.additional);
  const pubmeds = pubmedElements(p.pubmedIds);
  const abbrevs = organismsOf(m);
  const single = m.organisms.length === 1;
  const opening = single
    ? `  <datasetPresenter name="${escapeXml(nameFor(m, abbrevs[0]))}"
                    projectName="${m.organisms[0].project}">`
    : `  <datasetPresenter name="${escapeXml(sharedNameFor(m))}"
                    datasetNamePattern="%_${escapeXml(sharedNameFor(m))}">`;
  const injectors = single
    ? `    <templateInjector className="${RNASEQ_INJECTOR}">\n${propsFor(p, m.organisms[0])}\n    </templateInjector>`
    : m.organisms.map((o, i) => `    <templateInjector projectName="${o.project}" datasourceName="${escapeXml(nameFor(m, abbrevs[i]))}" className="${RNASEQ_INJECTOR}">\n${propsFor(p, o)}\n    </templateInjector>`).join('\n');

  return `${opening}
    <displayName><![CDATA[${escapeForCDATA(p.displayName)}]]></displayName>
    …the existing lines from <shortDisplayName> through the pubmeds line, unchanged…
${pubmeds ? pubmeds + '\n' : ''}${injectors}
  </datasetPresenter>`;
}
```
Copy the body lines for real; the `…` line marks the unchanged section between `<displayName>` and the pubmed line. Before this task the single-organism template ended `<templateInjector className="org.apidb.apicommon.model.datasetInjector.RNASeq">\n${injectorProps(…)}\n    </templateInjector>\n  </datasetPresenter>`. Keep that exact text for one organism, so `expected.xml` still matches. Delete `organismOf` if `renderArtifacts` is now its only user, keeping it there. Remove the now-unused `projectOf` import if nothing else uses it.

- [ ] **Step 4: Callers render once**

- `genome-assembly.js`: change `renderPresenter`'s doc comment to "Phase 2: XML from the manifest and the presenter record only." It already ignores `organism`.
- `proposal-ops.js`, `writeProposal`: replace the `for (const organism of organismsOf(full)) datasetType.renderPresenter(…)` line with `datasetType.renderPresenter(staged, { build: PREVIEW_BUILD });`. Drop the `organismsOf` import if it is unused.
- `load-ops.js`, `renderAndCheck`:
```js
    const xml = datasetType.renderPresenter(dir, { build });
    const presenters = [{ xml, name: extractPresenterName(xml) }];
```
- `load-ops.js`, `assertSettledAsCommitted`:
```js
      (d) => [extractPresenterName(datasetType.renderPresenter(d, { build }))]));
```
- `render-proposal.js`: replace the `xmls` map with `process.stdout.write(datasetType.renderPresenter(proposalDir, { build }) + '\n');`. Update the usage comment: "(default) the presenter XML, from curated/presenter.json". The unknown-props warning also checks per-organism props:
```js
    const { injectorProps, organisms = {} } = readPresenter(…);
    const unknown = [...new Set([injectorProps, ...Object.values(organisms).map((o) => o.injectorProps ?? {})]
      .flatMap((chosen) => unknownInjectorProps(datasetType.injectorDefaults, chosen)))];
```

- [ ] **Step 5: Run the suite**

Run: `yarn test 2>&1 | tail -8`
Expected: `# fail 0`. If `render(PRJNA000002) matches its golden expected.xml` fails, diff the output against `tests/fixtures/proposals/PRJNA000002/expected.xml`. The single-organism template must match byte for byte; never edit the golden.

- [ ] **Step 6: Commit**

```bash
git add -A shared skills tests
git commit -m "One RNA-seq presenter per proposal, an injector per organism

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Host and parasite end to end

**Files:**
- Test: `tests/proposal-ops.test.js`, `tests/load-ops.test.js`

These tests should pass without production changes. If one fails, fix the production code, then add a regression test for the cause.

- [ ] **Step 1: Phase 1 across projects**

Append to `tests/proposal-ops.test.js` (reuse `rnaFiles`, `coldShock`, `rnaManifestInput`; read their definitions first with `grep -n "const rnaFiles\|const coldShock\|const rnaManifestInput" tests/proposal-ops.test.js`):
```js
/** HostDB/hfakH1.xml on master and on the rebuild branch. */
function addHostOrganism(repo) {
  mkdirSync(join(repo, 'Datasets/lib/xml/datasets/HostDB'), { recursive: true });
  writeFileSync(join(repo, 'Datasets/lib/xml/datasets/HostDB/hfakH1.xml'),
    readFileSync(join(fixtures, 'tfakST1.xml'), 'utf-8').replace(/tfakST1/g, 'hfakH1').replace('value="FungiDB"', 'value="HostDB"'));
  execFileSync('git', ['-C', repo, 'add', '.']);
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'hfakH1']);
  execFileSync('git', ['-C', repo, 'push', '-q']);
  refreshRebuild(repo);
}

test('writeProposal aligns to a host in another project, each organism with its own samples', async () => {
  const { repo, root } = setupRepo();
  addHostOrganism(repo);
  const git = createGit(repo);
  await startProposal({ git, ticket: stubTicket(), accession: 'PRJNA000003' });
  const files = rnaFiles(root, coldShock);
  const annotationsPath = files.curated.find((f) => f.endsWith('_sample_annotations.json'));
  const a = JSON.parse(readFileSync(annotationsPath, 'utf-8'));
  writeFileSync(annotationsPath, JSON.stringify({ ...a, samples: a.samples.map((s, i) => ({ ...s, organisms: i === 0 ? ['hfakH1'] : ['tfakST1', 'hfakH1'] })) }));

  const { dir, manifest } = await writeProposal({
    rebuildBranch: REBUILD, git, repoPath: repo, curator: 'someone@apidb.org', ...files,
    manifestInput: { ...rnaManifestInput, additionalOrganisms: ['hfakH1'] }
  });
  assert.deepEqual(manifest.organisms, [...loaded('tfakST1'), ...loadedIn('HostDB', 'hfakH1')]);
  const sheet = (o) => readFileSync(join(dir, 'curated', o, 'samplesheet.csv'), 'utf-8').trim().split('\n').length - 1;
  assert.equal(sheet('hfakH1'), a.samples.length);
  assert.equal(sheet('tfakST1'), a.samples.length - 1);
});

test('writeProposal refuses a host alignment whose samples are not tagged', async () => {
  const { repo, root } = setupRepo();
  addHostOrganism(repo);
  const git = createGit(repo);
  await startProposal({ git, ticket: stubTicket(), accession: 'PRJNA000003' });
  await assert.rejects(writeProposal({
    rebuildBranch: REBUILD, git, repoPath: repo, curator: 'someone@apidb.org', ...rnaFiles(root, coldShock),
    manifestInput: { ...rnaManifestInput, additionalOrganisms: ['hfakH1'] }
  }), /Sample organisms of PRJNA000003 do not match its organisms:\n  - Sample \S+: list the organisms it aligns to/);
});
```
Import `loadedIn` from `./helpers.js`. If `rnaFiles` returns a different shape than `{ inputs, curated, overrides }`, adapt `annotationsPath` to it. Do not change `rnaFiles`.

- [ ] **Step 2: Phase 2 across projects**

Append to `tests/load-ops.test.js` (import `alignTo` from `./helpers.js`):
```js
test('a host and parasite load puts one presenter in the home project and each dataset in its own project', async (t) => {
  const { repo, deliveryBase } = rnaOnRebuild(t);
  mkdirSync(join(repo, 'Datasets/lib/xml/datasets/HostDB'), { recursive: true });
  writeFileSync(join(repo, 'Datasets/lib/xml/datasets/HostDB/hfakH1.xml'),
    readFileSync(join(fixtures, 'tfakST1.xml'), 'utf-8').replace(/tfakST1/g, 'hfakH1').replace('value="FungiDB"', 'value="HostDB"'));
  alignTo(join(repo, 'Proposals/PRJNA000002'), [{ abbrev: 'tfakST1' }, { abbrev: 'hfakH1', project: 'HostDB' }], { SAMN1: ['hfakH1'], SAMN2: ['tfakST1', 'hfakH1'] });
  commitAll(repo, 'host and parasite');

  const git = createGit(repo, { exec: ghStub({ url: 'https://github.com/x/y/pull/31' }).exec });
  const result = await loadProposal({ git, ticket: tickets(), repoPath: repo, accession: 'PRJNA000002', deliveryBase });

  const ref = 'origin/load/PRJNA000002';
  const presenters = git.showFile(ref, 'Model/lib/xml/datasetPresenters/FungiDB.xml');
  assert.match(presenters, /<templateInjector projectName="HostDB" datasourceName="hfakH1_Doe_heat_shock_2024_rnaSeq_RSRC"/);
  assert.equal(git.fileExistsOnRef(ref, 'Model/lib/xml/datasetPresenters/HostDB.xml'), false);
  assert.match(git.showFile(ref, 'Datasets/lib/xml/datasets/HostDB/hfakH1.xml'), /<prop name="name">Doe_heat_shock_2024<\/prop>/);
  const sheet = (path) => readFileSync(join(deliveryBase, path, 'samplesheet.csv'), 'utf-8');
  assert.equal(sheet('FungiDB/tfakST1/rnaSeq/Doe_heat_shock_2024/2024-05-01/final'), 'sample,fastq_1,fastq_2,strandedness\nSAMN2,SRR2,,stranded\n');
  assert.equal(sheet('HostDB/hfakH1/rnaSeq/Doe_heat_shock_2024/2024-05-01/final'), 'sample,fastq_1,fastq_2,strandedness\nSAMN1,SRR1,,stranded\nSAMN2,SRR2,,stranded\n');
  assert.match(result.prUrl, /pull\/31$/);
  assert.equal(git.headSubject(), 'Load PRJNA000002: add Doe_heat_shock_2024_rnaSeq_RSRC to FungiDB, Doe_heat_shock_2024 to tfakST1 hfakH1, remove proposal');
});
```

- [ ] **Step 3: Run the suite**

Run: `yarn test 2>&1 | tail -8`
Expected: `# fail 0`.

- [ ] **Step 4: Commit**

```bash
git add -A shared skills tests
git commit -m "Test host and parasite proposals end to end

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Curator and loader docs

**Files:**
- Modify: `skills/propose-bulk-rnaseq/resources/step-2-analyze-samples.md`
- Modify: `skills/propose-bulk-rnaseq/resources/step-4-write-proposal.md`
- Modify: `skills/propose-bulk-rnaseq/SKILL.md`
- Modify: `skills/load-proposals/SKILL.md`

- [ ] **Step 1: Step 2, after `#### Technical Replicate Grouping`, before `### 3. Determine Strand Specificity`**

```markdown
#### Organisms (more than one reference genome)

When the curator aligns the experiment to more than one organism (a host and
its parasite, or several species in one BioProject), ask which samples go to
which organism. Never guess. The usual cases:

- **All to all:** every sample aligns to every organism.
- **Controls to the host only:** uninfected or control samples align to the
  host; infected samples align to host and parasite.
- **Split:** each sample aligns to its own organism.

Record the answer on each sample as `"organisms": ["<abbrev>", ...]`, using the
abbreviations passed to `--organism` and `--also-organism`. With two or more
organisms every sample needs the list, and every organism needs a sample;
`write-proposal.js` refuses otherwise. Drop a sample that aligns to no organism.
With one organism, leave `organisms` out.
```

- [ ] **Step 2: Step 4, organisms**

Replace the `organisms` JSON example and the sentence "Each organism gets its own presenter and its own `<dataset>` entry." with:
````markdown
`--project` names the first organism's project. Each `--also-organism` takes
the project the rebuild branch, or the pending genome proposal, has it in, so a
host in HostDB can join a PlasmoDB proposal. The manifest records them in
`organisms` (schemaVersion 4):

```json
"organisms": [
  { "proposedOrganismAbbrev": "<abbrev>", "source": "loaded", "project": "PlasmoDB" },
  { "proposedOrganismAbbrev": "<abbrev>", "source": "loaded", "project": "HostDB" }
]
```

List the parasite first: the first organism's project holds the presenter.
Each organism gets its own `<dataset>` entry in its own project, and its own
loading artifacts under `curated/<abbrev>/`, built from the samples tagged for
it. A proposal with two or more organisms has one presenter, named
`<name>_rnaSeq_RSRC`, with one injector per organism. Injector props that
differ by organism go under `"presenter": { "organisms": { "<abbrev>": { "injectorProps": { ... } } } }`
in the overrides; shared ones stay under `"presenter": { "injectorProps": { ... } }`.
With two or more organisms each analysisConfig's `profileSetName` starts with
its organism's abbreviation.
````
In the `## The loading artifacts` and `## Presenter name` sections, change paths `curated/samplesheet.csv` (and the other three) to `curated/<abbrev>/samplesheet.csv`. Add one sentence under `## Presenter name`: "With two or more organisms the presenter is `<name>_rnaSeq_RSRC` with `datasetNamePattern=\"%_<name>_rnaSeq_RSRC\"`."

- [ ] **Step 3: SKILL.md, Step 4 text**

Replace "the loading artifacts in `curated/` (`samplesheet.csv`, …)" with "the loading artifacts in `curated/<abbrev>/` for each organism (`samplesheet.csv`, …)". Replace "An organism of a different project, or an unknown one, is refused." with "An additional organism may be in another project (a host in HostDB); an unknown one is refused."

- [ ] **Step 4: load-proposals SKILL.md**

In the intro paragraph that says it "renders the presenter and, for dataset types with a … presenter, a `<dataset>` and a delivery directory per organism", add: "A proposal aligned to several organisms has one presenter, written to the first organism's project file, and a `<dataset>` and delivery directory per organism in each organism's own project."

- [ ] **Step 5: Check the docs agree with the code**

Run: `grep -rn "schemaVersion 3\|curated/samplesheet\|one presenter per organism\|own presenter" skills/*/SKILL.md skills/*/resources/*.md shared/resources/*.md`
Expected: no hits.

- [ ] **Step 6: Commit**

```bash
git add -A skills shared
git commit -m "Docs: host and parasite RNA-seq proposals

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Final verification

- [ ] **Step 1: Full suite**

Run: `yarn test 2>&1 | tail -8`
Expected: `# fail 0`.

- [ ] **Step 2: Synced copies match shared**

Run: `yarn -s sync-shared >/dev/null && git status --porcelain`
Expected: empty output.

- [ ] **Step 3: Spec coverage spot check**

Run: `grep -rn "m\.project\|manifest\.project" shared/scripts`
Expected: only the v3 claim tolerance in `organisms.js`.

- [ ] **Step 4: Hand off**

Use superpowers:finishing-a-development-branch. The demo checkout (`~/dataset-curation-demo`, PRJNA749283) still has a v3 manifest on master. Re-running `write-proposal.js` there migrates it; tell John before doing so.
