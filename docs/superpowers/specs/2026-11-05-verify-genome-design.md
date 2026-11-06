# verify-genome (sub-project F)

## Problem

The last sub-project of annotated-genome preprocessing. A (dataset entries),
D (GFF pipeline), C (trial ISF runner), E (functional extraction) and B
(shared verify core) are merged. Nothing yet:

- turns D's, C's and E's records into a proposal's dataset entries, organism
  constants and organism props;
- validates a genome proposal or delivers its pipeline output;
- creates a new genome's organism file at load (carried over from A);
- guides a data loader through it (`verify-genome` skill).

Carry-overs from B: genome-assembly needs validators or mark-ready never
removes `preprocess/`; `delivery.json` records `against` as a branch, not a
commit; the delivery comment omits provenance; a symlinked `preprocess/` is
accepted.

## Decisions

- The amendment reuses the propose path: `start-proposal.js` (update mode),
  a new generic `amend-proposal.js` writing the working tree, then
  `publish-proposal.js` and `merge-proposal.js`. It calls a type hook,
  `preprocessedAmendment`.
- Organism-class props that Phase 1's record lacks are added by the amendment:
  two derived from the build, the rest by rule, `orthomclAbbrev` asked.
- Validators have a kind. `preprocess` validators read the work area and run
  at verify only; `content` validators read the proposal and also run at load.
- Load creates a new genome's organism file and its project-file blocks
  (in F, not a later sub-project).
- New organism files carry a committed boilerplate table: always
  `validateOrganismInfo`, `ECAssocFromUniprot`, `transcriptsFromReferenceStrain`;
  reference strains also `referenceStrain-dbEST`. (FungiDB, 350 files: 349,
  318, 267 = exactly the reference strains; `referenceStrain-GenbankEST` only
  51, so not boilerplate.)
- Details will be shaken out on a real genome: the plan ends with an
  acceptance run whose findings go into the plan's amendments block.

## Flow

The work area is `<root>/annotated-genome-validation/proposals/<id>/preprocess/`
(B's `workAreaOf`); every D/C/E command gets it as `--workDir`.

1. Claim: `start-verification.js <id>`.
2. Preprocess: `genome-pipeline.js fetch` → `survey` → **ID prompt 1**
   (sequence, gene, transcript or protein IDs to change? → `recipe.json`,
   `ids.tsv`) → `build` → `finalize` → `trial` (the data loader runs it: it
   writes a shared database) → `functional` → **ID prompt 2** (the same
   question about the built artifacts; a change goes back to `build`).
3. Amend: `start-proposal.js <accession> --type genome-assembly` →
   `amend-proposal.js --workspace <root> <id>` → `publish-proposal.js` →
   a person merges with `merge-proposal.js`.
4. Validate: `validate-proposal.js --workspace <root> <id>`.
5. Prepare: `prepare-delivery.js --workspace <root> --against origin/rebuild<RR> <id>`.
6. Review, then `mark-ready.js` or `request-revision.js`.
7. Load (`load-proposals`): for a new genome, writes its organism file and
   project-file blocks.

## D additions

`finalize` adds to each `partitions[]` entry of `genome-build.json`, additively
(schema version stays 1; readers treat a missing field as unknown):

| Field | Meaning |
|---|---|
| `featureTypes` | `{ <GFF type>: count }` over the partition's final GFF |
| `maxIntron` | Longest intron in the partition, in bases, or `0` |

## Records reader

`dataset-types/genome-assembly/preprocess.js` reads the work area:
`genome-build.json` (schema version 1), `trial/trial.json` (schema version 2),
`functional.json` (schema version 1), `fetch/fetch.json`.

`readPreprocessed(workArea)` returns `{ genomeBuild, trial, functional, fetch,
sha256: { genomeBuild, trial, functional } }` or throws on a missing record or
unknown schema version.

`preprocessedProblems(records, workArea)` returns the problems that make the
work area undeliverable; the `records` validator and the delivery hook both use it:

- trial `result` is not `passed`;
- trial or functional `genomeBuild.sha256` differs from `genome-build.json`'s;
- a file the trial loaded or produced (`loaded`, `outputs`) has another sha256;
- `checkFunctionalCurrent` problems;
- the trial neither `undone` nor `kept`.

## Amendment

### `amend-proposal.js`

```
node scripts/amend-proposal.js --workspace <root> [--organism key=value ...] <PROPOSAL>
```

Generic: refuses a type without `preprocessedAmendment`. Run from the
VEuPathDatasets checkout on `proposal/<id>` (`start-proposal.js` update mode),
it refuses on another branch. Writes `curated/datasets.json`,
`curated/organism.json` `constants` and the organism props it owns; prints
each derived value with its source, then a diff against master's copy. A
re-run replaces what it owns and keeps curator-set record keys.

### `preprocessedAmendment({ workArea, proposalDir, manifest, given })`

Returns `{ entries, constants, organism, sources }` from `readPreprocessed`;
refuses when `preprocessedProblems` is non-empty, and when `orthomclAbbrev`
is neither given nor already in the record.

Entries (a partition gets a feature entry only when `featureCount > 0`):

| Kind | Entry |
|---|---|
| Sequence, per partition | class `fasta_primary_genome_sequence`, `fasta_secondary_genome` or `fasta_organelle_genome` by role; name `$$genomeSource$$`; version `$$genomeVersion$$`; props `soTerm` (literal, the partition's), `table` `DoTS::ExternalNASequence`, `sourceIdRegex` `^>(\S+)`, `releaseDate` `""` (primary), `organelle` (organelle) |
| Features, per partition | class `NoPreprocess_<role>_genome_features`; version `$$genomeVersion$$`; `soTerm` as its sequence entry; `mapFile` `genemRNAExonCDS2Gus.xml`; the class's name or `source` prop `$$genomeSource$$` |
| Functional, per `functional.json` dataset | its class and name; version `$$functAnnotVersion$$`; its record props, the rest from a committed per-class defaults table |

Every entry's `source` is `{ type: "url", urls }` from `fetch.json`.

Constants: `genomeSource` and `genomeVersion` copied from the organism record;
`functAnnotVersion` from the report's `annotation_info.release_date`, else
`genomeVersion`.

### Organism record, schema version 2

`ORGANISM_RECORD_KEYS` gains the props below; `ORGANISM_RECORD_SCHEMA_VERSION`
becomes 2. A version 1 record still reads; the content validator asks for an
amendment.

| Prop | Value |
|---|---|
| `annotationIncludesTRNAs` | any partition's `featureTypes` has `tRNA` |
| `maxIntronSize` | max `maxIntron`, rounded up to a multiple of 500, at least 1000 |
| `isHugeGenome` | total sequence length from the assembly report over 1 Gb |
| `isNotEbiGenome` | `"true"` |
| `isCore` | `"false"` |
| `runExportPred` | `"false"` |
| `isFamilyRepresentative` | `familyRepOrganismAbbrev` empty or this organism; then `familyNcbiTaxonIds` and `familyNameForFiles` must be given |
| `familyNcbiTaxonIds`, `familyNameForFiles` | given, else `""` |
| `orthomclAbbrev` | given (`--organism orthomclAbbrev=…`); never derived |

`publicOrganismAbbrev` is not stored: load sets it from the settled abbreviation.
`--organism key=value` overrides any of these.

## Validators

`dataset-types/genome-assembly/validators/index.js`, registered in
`validators.js`. Every validator declares `kind: 'preprocess' | 'content'`
(bulk-rnaseq's are `content`).

- `validateProposal` passes `ctx.workArea` (`workAreaOf`).
- `contentValidation` (load) runs only `content` validators.
- `runValidators` refuses a `preprocess` validator without `ctx.workArea`.
- The genome `env.json` has `repos: {}` and no build; workspaces open as for
  any type.

Preprocess:

| Validator | Checks |
|---|---|
| `records` | `readPreprocessed` and `preprocessedProblems` (errors); returns the three record sha256s as `report.preprocess` |
| `ids` | Every ID in a functional file is in `final/<p>/transcriptInfoAndIds` at that file's level (gene, transcript, protein for EC); errors with a sample |
| `matchesBuild` | Master's entries and constants equal `preprocessedAmendment`'s; else "the proposal was amended from another build; re-run amend-proposal and publish" |
| `pipelineFindings` | D's warnings and findings, C's QA findings, E's warnings and info, at their own severities, tagged `build`, `trial`, `functional` |

Content:

| Validator | Checks |
|---|---|
| `entryShape` | One primary sequence entry; secondaries only beside a primary, distinct `soTerm`s; one organelle entry per organelle; each feature entry has a sequence entry of the same role and `soTerm`; annotated: `productNames` and at least one feature entry; unannotated: sequence entries only |
| `organismRecord` | Schema version 2 with every new prop; booleans valid; `maxIntronSize` a positive integer; `orthomclAbbrev` 4–8 lowercase letters; constants `genomeSource`/`genomeVersion` equal the record's; family representatives have `familyNcbiTaxonIds` and `familyNameForFiles` |

`report.preprocess` is optional; `REPORT_SCHEMA_VERSION` is unchanged.

## Delivery

- The hook becomes `preprocessedFiles(proposalDir, location, { workArea, report })`;
  `prepareDelivery` passes the `currentReport` it already fetches.
- `collectPreprocessed` refuses a symlinked work area (`lstat`).

The genome hook matches a location to a partition by role, `soTerm` and
organelle, and to a functional dataset by class and name:

| Location | Files |
|---|---|
| primary or secondary sequence (`…/final/`) | `genome.fasta`; `chromosomeMap.txt` when the partition has one |
| organelle sequence (file `…/final/genome.fasta`) | the partition's `genome.fasta` |
| features (`…/final/`) | `genome.gff`, `transcriptInfoAndIds` |
| functional (file, such as `…/final/products.txt`) | the `functional.json` dataset's file |

The plan first checks whether `fasta_secondary_genome` needs an empty
`chromosomeMap.txt`. If so, the hook may return `{ path, text }` and
`collectPreprocessed` treats it as rendered text.

Problems: `preprocessedProblems`; `report.preprocess` sha256s that differ from
the records ("the work area changed since validation; validate again"); a
location with no partition or dataset.

Provenance per location: the three record sha256s, the trial's `database` and
`release`, the generator version.

Carry-overs:

- `delivery.json` gains `againstCommit` (the commit of `against` at prepare).
  mark-ready reads classes at `againstCommit`, else `against` for older
  records. `DELIVERY_SCHEMA_VERSION` is unchanged; the field is additive.
- `formatDeliveryComment` adds one provenance line when `provenance` is present.

## Load: a new genome's organism file

When a genome proposal's organism is new (`settlementOn`) and the rebuild
branch has no `Datasets/lib/xml/datasets/<Project>/<abbrev>.xml`,
`renderDatasetParts` creates it instead of refusing "Dataset file missing". A
genome proposal whose organism file exists is still refused.

`<Project>/<abbrev>.xml`:

- constants `organismAbbrev`, `strainAbbrev`, `referenceStrainOrganismAbbrev`,
  `familyRepOrganismAbbrev`, `projectName`, `ncbiTaxonId`, `speciesNcbiTaxonId`,
  then the proposal's constants;
- the boilerplate table (a committed list in the genome type), in table order;
- the entries (`renderDatasets`).

`<Project>.xml`, after its top-level constants:

- `<dataset class="organism">` with props in class order: `publicOrganismAbbrev`
  is the settled abbreviation; `referenceStrainOrganismAbbrev` self for a
  reference strain; `familyRepOrganismAbbrev` self for a family representative;
- `<dataset class="referenceStrain">` for a reference strain.

Refusals before anything is written: the abbreviation is in a project file; a
non-reference strain's reference strain is not; `orthomclAbbrev` is used by
another organism.

Folded in from A: multi-entry load tests (a second entry clashes, the
"N datasets" subject, resume with a changed entry count) and a load-level test
of the `DISTINCT_NAME` advice.

## Skill

`skills/verify-genome/SKILL.md` links `resources/verify-procedure.md` and holds
only the genome parts: the preprocessing order, the two ID prompts, amend /
publish / merge, and the review list (build warnings, trial QA, functional
warnings, derived organism props, entries against partitions). `trial` and
`trial --undo` are the data loader's to run. Never an ad-hoc `--workDir`.
`sharedFiles` registers everything it imports; `CLAUDE.md` and
`docs/development.md` list it.

## Testing

- Targeted tests per task (the task's test file plus `import-graph`); full
  suite at checkpoints.
- Fixtures: small hand-built work areas (records plus tiny files); golden
  values as counts and digests.
- Every refusal has a test that fails without its check.
- Load tests use a fake rebuild branch with a project file: inserted blocks,
  the new file, and a re-render that finds the clash.
- Acceptance: E. cuniculi GB-M1 end to end (the data loader runs `trial`);
  findings go into the plan's amendments block.

## Scope

Out: per-proposal template DB copies, NYTProf ISF profiling, the docker-tools
Jenkins job, a RefSeq golden genome, functional-update proposals as their own
type.

## Version

4.0.0: the organism record goes to schema version 2 and load creates organism
files.
