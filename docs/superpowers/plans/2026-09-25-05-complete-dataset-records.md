# Plan 05: Complete dataset records

Implements the spec addendum "complete dataset records (2026-09-25)". Each
task ends with `yarn test` green and one commit. One committer at a time.

## Task 1: `renderers/` becomes `dataset-types/`

Pure refactor, no behaviour change.

- `git mv shared/scripts/renderers shared/scripts/dataset-types`.
- Exports: `derive` -> `derivePresenter`, `render` -> `renderPresenter`;
  `presenterName`, `requiredFields`, `injectorDefaults` unchanged.
- Update imports in `lib/manifest.js` (`rendererExists` -> `datasetTypeExists`),
  `lib/proposal-ops.js`, `lib/load-ops.js`, `render-proposal.js`, tests,
  `package.json` `sharedFiles`; `git rm` the synced `skills/*/scripts/renderers/`.
- Docs: `docs/development.md` module table and "Adding a dataset type".

## Task 2: identity in the manifest

- `lib/manifest.js`: `datasetClass`, `name`, `version` required for types that
  export a `datasetClass` (bulk-rnaseq). Genome assembly exports none for now
  and is unchanged; its classes are a later addendum.
  `name` matches `^[A-Za-z][A-Za-z0-9_]*$` and must not contain the accession.
  `version` matches `^\d{4}-\d{2}-\d{2}$`.
- Per type: `datasetClass` constant (`rnaSeqExperiment`), and
  `deriveIdentity(stagedDir, contacts)` returning default `name` / `version`:
  - bulk-rnaseq `version`: the GEO **Series** `Release-Date` from MINiML
    (not the Platform's); no MINiML -> none, so an override is required.
  - bulk-rnaseq `name` default: `<PrimaryContactSurname>_<year of version>`,
    surname from the contact's `<name>` in `allContacts.xml`.
- Overrides file gains sections: `{ "name", "version", "presenter": {...},
  "dataset": { "props": {...}, "source": {...} } }`. Unknown top-level or
  section keys are refused. The flat presenter-only shape is refused with a
  message naming the new shape.
- Presenter `name` for bulk-rnaseq becomes `${organismAbbrev}_${name}_rnaSeq_RSRC`.
- Fixture manifests gain the fields; goldens regenerated deliberately (the
  presenter name changes) and the diff reviewed by eye.

## Task 3: `classes.xml` reader

`lib/dataset-classes.js`, zero dependencies, regex over the checkout's
`Model/lib/xml/datasetClass/classes.xml`:

- `readDatasetClass(repoPath, className)` -> `{ props: [names], datasetNamePattern,
  deliveryPath }`, where `deliveryPath` is the `@@manualDeliveryDir@@/...final/`
  target of the class's `<unpack>ln -s` line, and `datasetNamePattern` is the
  `datasetLoader` `datasetName` attribute.
- Throws naming the class when it is missing, or when the loader or unpack line
  cannot be found.
- Tests against a small fixture `classes.xml` carrying a copy of the real
  `rnaSeqExperiment` block, plus one check against the demo checkout skipped
  when it isn't present.

## Task 4: `curated/dataset.json`

- `dataset-types/_common.js`: `validateDataset(record, classDef)`: `props` keys
  equal the class props minus `projectName`, `organismAbbrev`, `name`,
  `version`; all string values; `source` one of `sra` (every run accession
  `^[SED]RR\d+$`), `server` (absolute paths), `url` (http(s)).
- bulk-rnaseq `deriveDataset(stagedDir)`: `hasPairedEnds` from `library_layout`
  (mixed refused), `isStrandSpecific` from annotations `strandedness`
  (`unknown` refused), `fromSRA` from `source.type`, `limitNU` "30",
  `alignWithCdsCoordinates` "false"; `source` defaults to `{ type: "sra" }`.
- `renderDataset(proposalDir, classDef)`: the `<dataset class="...">` block,
  identity props first, `$$projectName$$` / `$$organismAbbrev$$` literal,
  matching existing entries.
- `writeProposal`: derive, validate against `classes.xml` from the checkout,
  write `curated/dataset.json`, trial-render; a hand-supplied `dataset.json`
  is refused like `presenter.json`.
- Uniqueness at write time: the organism file
  `Datasets/lib/xml/datasets/<Project>/<organismAbbrev>.xml` exists and has no
  dataset of this class and name; no manifest on `origin/master` other than
  this accession has the same `organismAbbrev` and `name`.

## Task 5: loading artifacts from the proposal

- `dataset-types/bulk-rnaseq.js` `renderArtifacts(proposalDir)` -> `{ files:
  { 'analysisConfig.xml', 'samplesheet.csv', 'sampleAnnotations.json',
  'sample-annotations-stf/<presenterName>/entity-sample.tsv', '.../entity-sample.yaml' } }`,
  logic moved from `generate-analysis-config.js`, `generate-samplesheet.js`
  and `sample-annotations-to-stf.js`, with XML escaping added.
  Reads only the proposal directory.
- STF core moves to `lib/stf.js`; `skills/sample-annotations-to-stf` keeps a
  thin CLI over it.
- `render-proposal.js --artifacts <dir>` writes them under
  `<dir>/<Project>/<organismAbbrev>/rnaSeq/<name>/<version>/final/` and prints
  the `@@manualDeliveryDir@@/...` target and the read source.
- Delete `generate-analysis-config.js`, `generate-samplesheet.js`,
  `check-delivery-dirs.sh` from the skill.
- Golden files for the fixture's artifacts.

## Task 6: Phase 2

- `lib/dataset-file.js`: `datasetFilePath`, `datasetNameExists`,
  `insertDataset` (before `</datasets>`), mirroring `presenter-file.js`.
- `loadProposal`: insert the dataset block in the same commit as the
  presenter and the proposal deletion; preconditions refuse a missing organism
  file or an existing name, before any branch exists.
- After the commit, write artifacts to
  `.curation/delivery/<Project>/<organismAbbrev>/rnaSeq/<name>/<version>/final/`;
  the PR body and ticket comment carry the `@@manualDeliveryDir@@` target, the
  local artifact path and the read source, with the note that copying and
  checking are the data loading team's.
- Straggler, resume and dry-run paths covered by tests like the presenter's.

## Task 7: skills and docs

- `propose-bulk-rnaseq` SKILL.md and steps 4-6: name and version in the
  overrides, Step 5 as the artifact preview, publish unchanged.
- `load-proposals` SKILL.md: the dataset insertion and the artifact hand-off.
- `proposal-workflow.md`: the three layers and who owns the server.
- `docs/development.md`: the type module contract.

## Task 8: first real proposal

Redo PRJNA749283 in `~/dataset-curation-demo` with `name`
`Duplessis_sexual_stages_2021`, `version` 2021-07-24, preview presenter,
dataset block and artifacts; then publish after John reviews.
