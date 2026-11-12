# Lazy dataset types and per-skill `sharedFiles`

Branch: `refactor-deps`. Groundwork already committed: `bin/lib/skill-closure.js`, `bin/skill-closure.js`,
`tests/skill-closure.test.js` (a skill must resolve every import and carry nothing unreachable).

## Problem

`shared/scripts/dataset-types/index.js` statically imports all five type modules, so every skill that loads the
registry carries every type and its subtree (genome pipeline, `genome-build.js`, validators, ...). Every skill is
"closed" today only because everything reaches everything. `sharedFiles` in `package.json` is a hand-kept
allowlist and nothing ties it to what a skill needs.

The registry is used three ways:

| Use | Callers | Needs |
|---|---|---|
| async `loadDatasetType(type)` | render-proposal, verification-ops, validation-ops, amend-ops, delivery-ops, build-fitness, load-ops | the one type module of the manifest being processed |
| sync `DATASET_TYPES` keys | proposal-ops (sibling proposal ids, error text) | the list of type names |
| sync `DATASET_TYPES[t].validationWorkspace` / `.libraryStrategies` | dataset-types/validators.js, check-library.js | two static strings per type |

Only the first needs the module. Other direct importers: `check-functional-entries.js` (imports
`functional-update.js` directly) and `validators.js` (statically imports the bulk-rnaseq, genome-assembly and
functional-update validator indexes).

## Design

1. **`dataset-types/meta.js`** (new, shared, no heavy imports): per type `{ validationWorkspace, libraryStrategies? }`
   and `DATASET_TYPE_NAMES`. Move the constants out of the type modules, which re-export from meta.js so existing
   importers and tests keep working. `libraryStrategies` for chipseq is derived from `STRATEGY_OF`; keep that table
   in meta.js or move it with it.
2. **Lazy `index.js`** (done): a map of literal-path loaders (`() => import('./chipseq.js')`, not computed paths, so
   closure analysis and the boundary test can follow them). `lazy.js` turns the loader's own module-not-found into
   `This skill does not include dataset type "<type>"`; a module missing from inside a type propagates. The
   exported `DATASET_TYPES` map is gone; tests get one from `tests/helpers.js`.
3. **Switch the sync consumers to meta.js**: `proposal-ops.js`, `validators.js`, `check-library.js`.
   (done) `validatorsFor(type)` is async with literal-path loaders; `hasValidators` (meta.js) answers the sync
   `.length > 0` questions in verification-ops and delivery-ops.
4. **Closure test** treats an unresolved literal dynamic `import()` as optional (a skill need not carry every
   type) and still fails on unresolved static imports. (done) The existing "every relative import in a skill
   resolves" check in `tests/sync-shared.test.js` must get the same rule before the first trim.
5. **Per-skill `sharedFiles`**: type modules and their subtrees (`dataset-types/<type>/**`) are listed only for the
   skills that handle that type. Mapping from the discovery pass (see "Discovery results"):

   | Skill | Type modules | Also needs from the type trees |
   |---|---|---|
   | propose-chipseq | chipseq | `_sra-*`, `_common` |
   | propose-dnaseq | dnaseq | `_sra-*`, `_common` |
   | propose-bulk-rnaseq | bulk-rnaseq | `bulk-rnaseq/**`, `_sra-samples`, `lib/stf.js` |
   | propose-genome-assembly | genome-assembly | `genome-assembly/**`, `genome/` (genome-build, workdir, trial/record, functional/record) |
   | propose-functional-update | functional-update | `genome-assembly/entries.js`, `genome/{workdir,feature-types,functional/*}` (not `genome-assembly.js`) |
   | verify-bulk-rnaseq | bulk-rnaseq | as above |
   | verify-genome | genome-assembly | `genome/**` incl. commands, trial, pipeline |
   | verify-functional-update | functional-update (guarded in its CLI) | as propose-functional-update |
   | load-proposals | all five | everything |

   `check-library.js` is carried only by chipseq and dnaseq already; with meta.js it needs neither module.

## Discovery results

Evidence for the table above (read-only pass, no code changed):

- **Type modules are self-contained.** The three sequencing types share only `_common`, `_sra-samples` and
  `_sra-experiment`. No type module imports another type's module. The one cross-type edge is
  `functional-update/update.js` -> `genome-assembly/entries.js` (a leaf file with no imports), so
  functional-update does not need `genome-assembly.js` or its validators/delivery/preprocess.
- **`genome/` is needed by exactly two types.** No `lib/*` or top-level shared script imports `genome/`. Only
  `genome-assembly/**` and `functional-update/**` do, plus the genome CLIs. So once the registry is lazy,
  chipseq, dnaseq and bulk-rnaseq skills can shed the whole `genome/` tree and `dataset-types/genome-assembly/**`
  (this is what removes `genome-build.js` from them).
- **`validators.js` is on the critical path, not optional.** It statically imports the genome-assembly,
  bulk-rnaseq and functional-update validator indexes, and `genome-assembly/validators/ids.js` imports
  `genome-build.js`. Until `validators.js` is lazy, every skill that loads it still carries all of those. Design
  step 3 must land before any trimming.
- **Skill CLIs are type-generic.** `start-proposal.js` and `write-proposal.js` take `--type <datasetType>` in every
  `propose-*` skill; nothing restricts a skill to its own type (only `verify-functional-update/scripts/
  functional-update.js` guards, `manifest.datasetType !== 'functional-update'`). After trimming, a skill asked
  for a type it lacks fails with the "does not include" error from the lazy registry. That is the intended
  behavior, but check the docs of each skill don't invite other types (the one-line mentions of sibling types in
  SKILL.md are cross-references, not needs).
- **Only `propose-functional-update` carries `check-functional-entries.js`**, which imports `functional-update.js`
  directly, so it needs no registry.
- **`load-proposals`, `verify-bulk-rnaseq` and `verify-genome` have no type guard** in their scripts. I assigned
  `verify-bulk-rnaseq` and `verify-genome` their own type from their SKILL.md descriptions ("verify a merged bulk
  RNA-seq proposal", "annotated genome assembly"). `load-proposals` loads whatever merged, so it keeps all five.

Open questions for the work, not the discovery: does `verify-genome`'s `list-proposals.js` show other types'
proposals (it would then fail in `loadDatasetType`), and does `propose-genome-assembly` really need the
`genome/commands` and `trial` files it carries (the closure test will say once the registry is lazy)?

## Order of work (one commit each)

1. **Discovery, no code**: done (see "Discovery results").
2. **meta.js plus re-exports**; no behavior change. Done (ff7ddbf).
3. **`validators.js` lazy plus its callers**, `lazy.js`. Done (a553198).
4. **Lazy registry, sync consumers moved to meta.js, optional dynamic imports in the closure analysis,
   `tests/helpers.js` supplying `DATASET_TYPES`.** Done.
5. **Trim `sharedFiles`** skill by skill, one commit each, deleting the copies sync will not remove. After each:
   `node bin/sync-shared.js --check`, `node bin/skill-closure.js <skill>`, and the full test suite.
6. A shared type module that is no longer reachable in a skill but still imported by shared tests keeps passing
   because tests import from `shared/`; nothing to do.

## Verification

- `node bin/skill-closure.js` reports 0 unresolved, 0 unreachable for every skill, at every commit.
- `node bin/sync-shared.js --check` passes.
- Full suite on Node 24: `PATH=$HOME/.volta/tools/image/node/24.11.0/bin:$PATH yarn test`. Baseline before this
  work, from the first investigation: 1783 tests, 460 pre-existing failures (the test git helper uses
  `git init --initial-branch`, which the installed git rejects). Compare against the saved failing-test list,
  `basefail.txt`, in the session scratchpad, not against a clean pass.
- Per trimmed skill, run one real CLI from its SKILL.md end to end (`write-proposal.js` for chipseq; `check-library.js`
  for dnaseq and chipseq) from a skill directory that contains only its allowed files, to catch a missing
  dynamic import.

## Risks

- A dynamic `import()` of a literal path that does not resolve is now optional to the closure test, so a typo in
  one is caught only by the tests that exercise that type from `shared/` and by the end-to-end CLI run above.
- Tests that import `DATASET_TYPES` or type modules directly need updating; they run against `shared/`, not skills.
- A skill dropping a type changes what its manifests can name. Make sure `datasetTypeExists` (uses
  `ORGANISM_RULES`) and the "unknown type" error distinguish "unknown" from "not in this skill".
- Ship as a version bump like earlier refactors (4.1.0 -> next minor); check how skills are versioned before
  committing.
