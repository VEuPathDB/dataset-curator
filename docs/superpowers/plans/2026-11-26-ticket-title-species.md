# Species Name in Ticket Titles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** New proposal tickets are titled `[<projects>] <proposalId> <G. species> <abbrev>[, ...]`, e.g. `[PlasmoDB] PXD084821 P. knowlesi pknoA1H1`.

**Architecture:** A pure `ticketTitle(manifest, speciesOf)` plus `shortSpecies(name)` in `shared/scripts/lib/proposal-ops.js`; `publishProposal` builds `speciesOf` from the manifest (`source: "new"`), the project XML's `organismFullName` on `origin/master` (`source: "loaded"`), or the pending genome proposal's manifest on `origin/master` (`source: { proposal }`). The species is resolved only when a new ticket is created.

**Tech Stack:** Node.js ESM, `node:test`, git via `createGit` test helpers.

**Spec:** `docs/superpowers/specs/2026-11-26-ticket-title-species-design.md`

## Global Constraints

- Edit `shared/scripts/...` only; copies under `skills/` come from `yarn sync-shared` (git hook), never hand-edited.
- `proposal-ops.js` already imports `organisms.js` and `project-organisms.js`: no `sharedFiles` change. `node bin/sync-shared.js --check` and `node bin/skill-closure.js` must report 0 unresolved, 0 unreachable.
- Existing tickets are never renamed; an update or resumed publish never computes a title.
- Bump `.claude-plugin/plugin.json` and `package.json` version 4.1.0 → 4.1.1.

## Review Focus

1. Bracketed genus `"[Candida] auris"` → `C. auris` (Task 1 test).
2. Extra words after the epithet (`"Plasmodium knowlesi strain A1H1"`, `"Aspergillus fumigatus Af293"`) are dropped → `P. knowlesi` (Task 1 test).
3. A loaded organism absent from the project XML, or present without `organismFullName`, stops publish before any ticket or git change, naming the abbrev and `Datasets/lib/xml/datasets/<Project>.xml on origin/master` (Task 2 test).
4. A republish of a proposal that already has a ticket succeeds even when no species can be found (Task 2 test).
5. Multi-organism, multi-project proposal lists each organism in manifest order (Task 1 test).

---

### Task 1: `shortSpecies` and `ticketTitle`

**Files:**
- Modify: `shared/scripts/lib/proposal-ops.js` (new exports near `publishProposal`)
- Test: `tests/ticket-title.test.js` (create)

**Interfaces:**
- Produces: `shortSpecies(name: string) => string | null` — null when the name has no genus and species words. `ticketTitle(proposalId: string, manifest, speciesOf: (organism) => string) => string`, using `projectsOf(manifest).join(', ')`; `speciesOf` returns the already-shortened name.

- [ ] **Step 1: Write the failing tests** in `tests/ticket-title.test.js`:

```js
test('shortSpecies abbreviates the genus and drops strain words', () => {
  assert.equal(shortSpecies('Aspergillus fumigatus'), 'A. fumigatus');
  assert.equal(shortSpecies('Plasmodium knowlesi strain A1H1'), 'P. knowlesi');
  assert.equal(shortSpecies('  Candida   albicans SC5314 '), 'C. albicans');
  assert.equal(shortSpecies('[Candida] auris'), 'C. auris');
  assert.equal(shortSpecies('Plasmodium'), null);
  assert.equal(shortSpecies(''), null);
  assert.equal(shortSpecies(undefined), null);
});

test('ticketTitle puts the species before each abbreviation', () => {
  const m = { organisms: [{ proposedOrganismAbbrev: 'pknoA1H1', project: 'PlasmoDB' }] };
  const seen = [];
  assert.equal(ticketTitle('PXD084821', m, (o) => { seen.push(o); return 'P. knowlesi'; }), '[PlasmoDB] PXD084821 P. knowlesi pknoA1H1');
  assert.equal(seen[0], m.organisms[0]);
});

test('ticketTitle lists several organisms in manifest order', () => {
  const m = { organisms: [{ proposedOrganismAbbrev: 'tgonME49', project: 'ToxoDB' }, { proposedOrganismAbbrev: 'pfal3D7', project: 'PlasmoDB' }] };
  const species = { tgonME49: 'T. gondii', pfal3D7: 'P. falciparum' };
  assert.equal(ticketTitle('PRJNA1', m, (o) => species[o.proposedOrganismAbbrev]), '[ToxoDB, PlasmoDB] PRJNA1 T. gondii tgonME49, P. falciparum pfal3D7');
});
```

- [ ] **Step 2: Run** `yarn test:one tests/ticket-title.test.js` — Expected: FAIL, `shortSpecies` is not exported.

- [ ] **Step 3: Implement** `shortSpecies(name)` and `ticketTitle(proposalId, manifest, speciesOf)` in `proposal-ops.js`. `shortSpecies`: strip `[` `]`, split on whitespace, need ≥2 words, return `` `${genus[0].toUpperCase()}. ${epithet}` ``. Reuse `namesGenusAndSpecies` only if it fits; do not add a dependency.

- [ ] **Step 4: Run** `yarn test:one tests/ticket-title.test.js` — Expected: PASS.

- [ ] **Step 5: Commit** — `git add tests/ticket-title.test.js shared/scripts/lib/proposal-ops.js skills/*/scripts/lib/proposal-ops.js && git commit -m "Add shortSpecies and ticketTitle"`

### Task 2: Resolve species at publish and use the new title

**Files:**
- Modify: `shared/scripts/lib/proposal-ops.js` (`publishProposal`, title line ~570)
- Modify: `tests/fixtures/FungiDB.xml` (add `<prop name="organismFullName">Testus fakeus strain ST1</prop>` to the `tfakST1` organism)
- Test: `tests/proposal-ops.test.js` (publishProposal section)
- Docs: `skills/propose-{bulk-rnaseq,chipseq,dnaseq,genome-assembly}/resources/step-6-publish.md` (title rule + error row), `skills/propose-functional-update/SKILL.md` (~line 166, title rule), `docs/development.md` (one line where publish/ticket is described)
- Version: `.claude-plugin/plugin.json`, `package.json` → 4.1.1

**Interfaces:**
- Consumes: `ticketTitle(proposalId, manifest, speciesOf)`, `shortSpecies(name)` from Task 1; `organismDatasetProps(xml)`, `projectFileRelativePath(project)` from `project-organisms.js`; `git.showFile(ref, path)`, `git.fileExistsOnRef(ref, path)`; genome manifest path `${proposalRelativePath(acc)}/${MANIFEST_FILENAME}`.
- Produces: `speciesResolver(git, ref = 'origin/master') => (organism) => string` (module-private is fine), returning `shortSpecies(<found name>)` and, when that is null or nothing is found, throwing `Error` with message `No species for <abbrev>: <where>` where `<where>` is one of:
  - new: `organisms[i].species is "<value>"` (unreachable after validation, but kept)
  - loaded: `no organismFullName for <abbrev> in Datasets/lib/xml/datasets/<Project>.xml on origin/master`
  - pending: `genome proposal <acc> on origin/master names no species`
  Project XML is read once per project (memoize).

- [ ] **Step 1: Write the failing tests** in `tests/proposal-ops.test.js`:
  - Update `'publishProposal titles the ticket with the proposal id'` assertion to `assert.equal(create[1], '[FungiDB] PRJNA000003_bulk-rnaseq T. fakeus tfakST1')` (check the proposal's organism abbrev the fixture writes; adjust to it).
  - `'publishProposal titles a genome ticket with the manifest species'`: `preparedProposal()` → `create[1]` === `'[FungiDB] GCA_000001.1 T. fakeus tfakST-1'`.
  - `'publishProposal titles a linked organism with its pending genome species'`: reuse the setup of `'publishProposal names the pending genome of a linked organism'`; assert `create[1]` matches `/ T\. fakeus tfakST-1$/`.
  - `'publishProposal refuses a loaded organism with no full name before any ticket or git change'`: remove `organismFullName` from `FungiDB.xml` on master (commit + push in the test repo), publish a bulk-rnaseq proposal on `tfakST1`; `assert.rejects(..., /^No species for tfakST1: no organismFullName for tfakST1 in Datasets\/lib\/xml\/datasets\/FungiDB\.xml on origin\/master/)`; assert `ticket.calls` has no `create` and `gh.calls` has no `pr create`.
  - `'publishProposal on an update needs no species'`: same missing-full-name setup but the proposal is planted on master with `ticket: TICKET`; publish succeeds and `ticket.calls` has no `create`.

- [ ] **Step 2: Run** `yarn test:one tests/proposal-ops.test.js` — Expected: the new/updated title tests FAIL (title has no species); the refusal test FAILS (publish succeeds).

- [ ] **Step 3: Implement.** Add the fixture prop. In `publishProposal`, compute the title only on the create path but **resolve species in the preflight** (before `git.fetch()`-dependent steps that mutate: right after `assertNoOtherProposalFor`) when `!manifest.ticket` and there is no prior ticket on `origin/master` — move the `priorTicket` read up so it is computed once. Replace the inline title with `ticketTitle(proposalId, manifest, speciesResolver(git))`. Existing PR/summary lines are unchanged.

- [ ] **Step 4: Run** `yarn test:one tests/proposal-ops.test.js tests/ticket-title.test.js tests/genome-organism-file.test.js` — Expected: PASS (the fixture change must not break `genome-organism-file`).

- [ ] **Step 5: Docs and version.** In each `step-6-publish.md` add, after the paragraph introducing the ticket, one sentence: "The ticket is titled `[<project>] <proposal id> <G. species> <abbrev>`, e.g. `[PlasmoDB] PXD084821 P. knowlesi pknoA1H1`; the species comes from the proposal (new genomes), the project's organism record (loaded organisms) or the pending genome proposal." Add an error-table row: `` `No species for <abbrev>: ...` `` | "The organism's full name is missing where the message says; ask the data loading team to add `organismFullName`, or fix the genome proposal's `species`, then re-run". Same sentence in `propose-functional-update/SKILL.md`. Bump versions.

- [ ] **Step 6: Full verification**
  - `yarn test` — Expected: all pass.
  - `node bin/sync-shared.js --check` — Expected: exit 0.
  - `node bin/skill-closure.js` — Expected: 0 unresolved, 0 unreachable.

- [ ] **Step 7: Commit** — `git add -A shared skills tests docs .claude-plugin package.json && git commit -m "Name the species in new proposal ticket titles (4.1.1)"`

### Task 3: Pull request

- [ ] Push `ticket-title-species`, open a PR against `main` titled "Name the species in new proposal ticket titles (4.1.1)", body summarizing format, species sources, the refusal, that existing tickets are untouched, and that it may conflict trivially with `provider-annotation-provenance` (4.2.0) at the version and the title line. Request review: `gh pr edit <n> --add-reviewer jbrestel`.
