# Shared verify core

## Problem

Sub-project B of genome preprocessing. After A, the verify scripts
(`start-verification`, `validate-proposal`, `prepare-delivery`, `mark-ready`,
`request-revision`) already live in `shared/scripts/` and work through type
hooks. Three things still stop a second `verify-*` skill:

1. The verification procedure is written once, inside
   `skills/verify-bulk-rnaseq/SKILL.md`. `verify-genome` would copy most of it.
2. `dataset-types/validators.js` hard-codes which types have validators and
   which validation workspace each uses, apart from the type modules.
3. `prepare-delivery` builds `final/` only from `renderArtifacts`: an
   in-memory map of path to text, hashed in memory. A genome's `final/` is the
   genome pipeline's output (FASTA, GFF3, functional files), up to gigabytes,
   produced in a work area by preprocessing.

Two carry-overs from A touch the same code:

- `markReady` checks entries against `classes.xml` on `origin/master`;
  `prepareDelivery` checks them against the rebuild branch it delivers for.
- `bin/sync-shared.js` has no `--check`, and nothing tests that `skills/`
  copies match `shared/`.

Out of scope (sub-project F): the genome-assembly hook and validators,
amending a proposal with entries and constants by pull request, the ID
prompts, and the `verify-genome` skill.

## Decisions

- Each dataset type declares its validation workspace; validators live in a
  per-type `validators/index.js` (a type module cannot import them without a
  cycle).
- The type-independent procedure is one shared resource every `verify-*`
  skill links to.
- A type may deliver files from a per-proposal work area by path. Text
  artifacts keep working unchanged.
- The work area is `<type>-validation/proposals/<id>/preprocess/`, derived,
  never passed.
- Delivered files are copies (reflink where the filesystem allows), never
  hard links: an in-place edit in the work area must not alter a recorded
  delivery.

## Type-declared verification

Each type module exports `validationWorkspace`, the directory name under the
validation root: `rnaseq-validation`, `dnaseq-validation`,
`chipseq-validation`, `annotated-genome-validation`.

Validators cannot be exported by the type module: `consistency.js` and
`perl-parse.js` import `bulk-rnaseq.js`, and `tests/import-graph.test.js`
forbids cycles. A type with validators instead has
`dataset-types/<type>/validators/index.js` exporting `validators`, the array
in run order. bulk-rnaseq's is `[libraryType, consistency, perlParse, stf]`.

`validators.js` keeps its three functions and signatures:

- `validatorsFor(t)`: from `VALIDATORS`, a map of type to its
  `validators/index.js` array (one line per type with validators), or `[]`.
- `validationWorkspaceFor(t)`: the type module's `validationWorkspace` via
  `DATASET_TYPES`, or `null` for an unknown type.
- `validationWorkspaceNames()`: the distinct declared names.

`WORKSPACES` is removed. Every type in `DATASET_TYPES` must declare
`validationWorkspace`; a test checks it.

## Shared procedure

`shared/resources/verify-procedure.md` holds the type-independent procedure,
moved from `verify-bulk-rnaseq/SKILL.md`:

- Before you start: `check-workspace.js`, `git fetch`, run from a
  VEuPathDatasets checkout, ask the data loader for the validation root, one
  validation per type at a time.
- Pick and claim: `list-proposals.js`, `start-verification.js`.
- Validate: `validate-proposal.js` flags (`--rebuild`, `--refresh`,
  `--against`, `--no-post`), verdicts, `could not verify`.
- Prepare the delivery: `prepare-delivery.js`, `--settle`, the delivery
  layout, `workspace/`, re-runs, the preprocessing work area (below).
- Decide: `mark-ready.js`, `request-revision.js`, disposal and
  `--discard-changes`, the squash-merged fix branch case.
- Rules.

It refers to the type's directory as `<type>-validation/` and to the type's
skill for type-specific checks. `verify-bulk-rnaseq/SKILL.md` keeps its
frontmatter, its directory name (`rnaseq-validation/`), what its validators
check and which findings go back to the curator, its delivery specifics
(`fromProvider/` staging, STF corpus files, the milestone due date) and its
review checklist (SRA runs, sample annotations, presenter text), and links to
`resources/verify-procedure.md` for every step. `package.json` `sharedFiles`
lists the resource for `verify-bulk-rnaseq`.

## Delivery from a work area

### Hook

A type may export:

```js
preprocessedFiles(proposalDir, location, { workArea }) →
  { files: [{ path, from }], problems: [string], provenance: object | null }
```

- `location` is one element of `entryDeliveries` (label, organism,
  `relative`, `file`, `datasetName`).
- `path` is relative to the entry's delivery directory (`location.relative`).
- `from` is an absolute path to a regular file inside `workArea`.
- `problems` are refusals, each naming the work-area file and the command
  that fixes it (F uses this to refuse a stale `genome-build.json` or
  `functional.json`).
- `provenance` is the type's summary of what produced the files (for example
  the sha256 of the pipeline's records); it is recorded, not interpreted.

### prepare-delivery

For a type with `preprocessedFiles`:

1. The work area is `join(typeDir, 'proposals', proposalId, 'preprocess')`.
   Missing: refuse with `No preprocessing work area for <id> at <path>; run
   preprocessing there first`.
2. Call the hook for each location after `assertDeliverable` and before
   staging is pulled. Any `problems` from any location: refuse, listing them
   under the entry label.
3. Check each file: `path` is relative with no `..` segment; `from`, after
   `realpath`, lies under the work area's `realpath` and is a regular file; no
   two files and no rendered text file share a delivery path. Each failure
   refuses, naming the entry label and path.
4. `deliveryProblems` counts a source file as present when its `stat` size is
   non-zero, as it counts non-empty text today.

All of these run before anything is written, so a refusal leaves the existing
delivery untouched.

### writeDeliveryTree

Gains `sources`, a map of delivery path to absolute source path, beside
`files` (text). Sources are copied into `<dir>.next` with
`copyFileSync(from, to, COPYFILE_FICLONE)`: a reflink where supported, else a
copy. Everything else is as today: built in `.next`, swapped in, each
`workspace/` carried over, `.next` removed on any failure.

`delivery.json` `files[].sha256` is computed by streaming each file, never by
reading it whole. The same streaming hash serves staging checks in
`pullStaging`.

### Record

When the type declares `preprocessedFiles`, the delivery record gains
`provenance`: each location's delivery directory (`location.relative`, unique
even when one entry delivers for several organisms) to the hook's non-null
`provenance`. Types without the hook
write no `provenance` key, so their `delivery.json` and delivery comment are
byte-identical to today. `DELIVERY_SCHEMA_VERSION` stays 1: the key is
optional and additive.

### Disposal

`mark-ready` removes `proposals/<id>/` as today, work area included; the
delivery holds copies. The shared procedure says so: keep the work area until
mark-ready, and re-run preprocessing if a revision follows.

## mark-ready checks entries on the delivery's ref

`markReady` reads the entries with `datasetsOf` from `origin/master` (no
classes needed) to learn whether a delivery is required. When it is, it reads
the current delivery first, then runs `assertValidEntries` with classes from
the delivery record's `against` ref, the ref `prepareDelivery` used. A
proposal with no entries is validated against `origin/master` as today. So
mark-ready can no longer refuse a delivery prepare-delivery accepted, or
accept one it would refuse, because `classes.xml` differs between master and
the rebuild branch.

## sync-shared --check

`node bin/sync-shared.js --check` writes nothing. It compares each
`sharedFiles` target with its source byte for byte, prints each missing or
differing target, and exits 1 if any; 0 otherwise. Without `--check`
behaviour is unchanged. A test runs the check against the repository and
fails on drift.

## Errors

Every new refusal names the proposal or entry label, the path, and the next
step. A copy that fails part-way removes `<dir>.next` and leaves the previous
delivery in place.

## Testing

Targeted tests per task, plus `tests/import-graph.test.js`; the full suite at
checkpoints only.

- Registry: `validatorsFor`, `validationWorkspaceFor` and
  `validationWorkspaceNames` give today's answers; unknown types give `[]` and
  `null`; every type in `DATASET_TYPES` declares `validationWorkspace`.
- `writeDeliveryTree` with `sources`: files land with identical bytes;
  `delivery.json` sha256s match an in-memory hash; a source that fails to copy
  leaves no `.next` and the old delivery intact; text and source files mix.
- Streaming hash: equals `createHash` over the whole file, including empty and
  multi-chunk files.
- `prepareDelivery` with a stub type declaring the hook: missing work area;
  `problems` refused under the entry label; `..` path, a `from` outside the
  work area (also via a symlink), a non-file, and a duplicate delivery path
  each refused; empty source refused by `deliveryProblems`; `provenance`
  recorded per entry.
- Regression: bulk-rnaseq, dnaseq and chipseq deliveries and `delivery.json`
  are byte-identical to before (no `provenance` key).
- mark-ready: classes are read from the delivery's `against` ref; a class that
  differs between master and the rebuild branch no longer decides the outcome.
- `sync-shared --check`: clean tree exits 0; a changed or missing target is
  named and exits 1; nothing is written.
- `verify-bulk-rnaseq/resources/verify-procedure.md` matches
  `shared/resources/verify-procedure.md` (covered by the drift test).

## Version

3.4.0: additive. Existing proposals, deliveries and reports read unchanged.
