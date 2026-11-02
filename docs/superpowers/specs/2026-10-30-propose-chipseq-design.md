# Propose ChIP-seq Datasets

Status: draft, no open questions. John's decisions are listed at the end.

## Problem

Curators can propose bulk RNA-seq, DNA-seq and genome assemblies, but not
ChIP-seq. ChIP-seq is nearly DNA-seq: single organism, SRA runs grouped into
samples, a samplesheet for ngs-samples-nextflow (`assayType=ChipSeq`), and STF
entity files. It differs in three ways:

1. **Input controls.** A ChIP sample may name an input (control) sample from
   the same experiment, in a 4th samplesheet column. Inputs are common, not
   universal.
2. **Experiment type.** The class has a controlled vocabulary (`histonemod`,
   `histonemod_noInput`, `tfbinding`, `mnase`, `faire`, `dnase`) that applies
   to the whole experiment and selects the analysis.
3. **Peak calling.** Peaks are called only for `histonemod`. The presenter's
   `ChIPSeq` injector reports this as `hasCalledPeaks`.

Without a ploidy constant, CNV or orthomcl dependency, it is simpler than
DNA-seq in every other respect.

## How the build consumes a ChIP-seq dataset

Sources: `ApiCommonWorkflow` (`workflowTemplates/chipSeqExperiment.xml`,
`workflow/processChipSeqExperiment.xml`, `MakeChipSeqNextflowConfig.pm`) and
`bowtie-mapping-nextflow` (`workflows/bowtieMapping.nf`,
`workflows/coverageAndPeaks.nf`).

- **Class.** `chipSeqExperiment` in VEuPathDatasets now unpacks
  `final/samplesheet.csv` (a6a0b1eef). The per-sample `chipSeqSample` and
  `chipSeqSample_QuerySRA` classes are no longer used. No new class is needed.
- **Preprocessing.** ngs-samples-nextflow runs on `final/samplesheet.csv` with
  `assayType=ChipSeq`, then bowtie-mapping-nextflow runs on its output
  samplesheet.
- **Samplesheet.** Read by position (`splitCsv(skip: 1)`), so header names are
  ignored. The repository's own test sheets use `strand` and `input` as the 4th
  header. Each row becomes `[id: row[0], ref: row[3]]`. `fastq_2` is used only
  when `hasPairedReads`, which comes from the class prop `hasPairedEnds`.
- **The 4th column (`ref`) does two things:**
  - For every experiment type, each ChIP/input pair gets a `bamCompare` ratio
    track (filter: `v[0].ref == v[3].id`).
  - For `histonemod` only, each ChIP sample with a `ref` gets HOMER
    `findPeaks -style histone -i <input>`.
- **Peaks are gated on `experimentType` alone.** The Nextflow branch is
  `params.experimentType == "histonemod"`. The workflow steps
  `loadPeaksFromConfig` and `copyChipSeqPeaksGffToWebServices` are
  `includeIf="'$$experimentType$$'=='histonemod'"`. No other switch exists.
- **Other analysis by type:** `mnase` uses DANPOS coverage. Every other type
  uses HOMER tag directories and bigwig coverage.
- **Other props the workflow reads:** `readsFileType` (`-q`/`-f` for bowtie2),
  `extraBowtieParams` (bowtie2 `ext.args`) and `fromSRA`.
- **Fragment length.** It is never per-sample now. `homerFindPeaks_histonemod`
  reads `task.ext.fragLength`, which nothing sets. (That line also has a bug:
  `"-fragLength {task.ext.fragLength}"` is missing its `$`.)

## Evidence from existing datasets (VEuPathDatasets origin/master)

- 54 `chipSeqExperiment` entries: histonemod 18, tfbinding 18,
  histonemod_noInput 9, mnase 5, faire 2, dnase 2.
- Of the 31 that could be matched to their presenter, every
  `hasCalledPeaks=true` is `histonemod` (4 true, 3 false). The 3 false are
  legacy and predate this workflow.

## Scope

In scope:

- A `propose-chipseq` skill (Phase 1): single organism, reads from SRA only,
  all six experiment types (the one class and workflow handle them all).
- A `chipseq` dataset type that `load-proposals` renders (Phase 2).
- Optional 4th samplesheet column in `_sra-samples.js`.
- Library checks parameterized by dataset type.
- Extracting what `dnaseq` and `chipseq` share before writing the second copy.

Out of scope: `verify-chipseq`, multi-organism ChIP-seq, local/server read
sources, fasta reads, backfilling legacy datasets, and the bowtie-mapping
`fragLength` fix (filed separately).

## Architecture: a third SRA type is the time to extract

About 70% of `dnaseq.js` (`normalizeCurated`, `deriveArtifacts`,
`checkCurated`, `renderArtifacts`, `corpusFiles`, `presenterNames`, the
single-organism guards) would be copied into `chipseq.js` unchanged. Two
copies drift: a fix made in one agreement check and not the other is the
failure the `_sra-samples.js` extraction (2.2.1) was created to prevent.

`dataset-types/_sra-experiment.js` provides a factory:

```js
sraExperimentType({ datasetClass, samplesheetColumns, corpus, extraChecks })
```

The factory returns the shared exports. `dnaseq.js` and `chipseq.js` spread
those exports and keep their own presenter, dataset and organism rules. The
refactor ships first, in its own commit, with the dnaseq golden files
unchanged as its regression test. `bulk-rnaseq` stays out of the factory
because it is multi-organism.

## Dataset entry (`chipSeqExperiment`)

| Prop | Value |
|---|---|
| `experimentType` | Chosen by the curator; validated against `EXPERIMENT_TYPES` in `chipseq.js`. A test pins it to the fixture class's `<prop>` doc, because parsing free text at runtime is brittle |
| `hasPairedEnds` | Derived from the used runs' `library_layout`; a mix of layouts is an error |
| `readsFileType` | `fastq` (SRA only) |
| `extraBowtieParams` | Empty unless overridden |
| `fromSRA` | `true` |

- Dataset name: `${organismAbbrev}_${name}_chipSeq_RSRC`.
- Delivery: `${projectName}/${organismAbbrev}/chipSeq/${name}/${version}/final/`.

Both are read through `readDatasetClass` and never hard-coded.

`hasPairedEnds` has to be derived, not a curator default. If it is wrong, the
mapper silently drops `fastq_2` and maps paired data as single-end.

## Peak calling: derived, never curated

The workflow has exactly one switch for peaks, `experimentType`, so the
proposal gets no separate `callPeaks` prop. A dataset prop the workflow
ignores would record a value that has no effect.

The peak-calling property is the presenter's `hasCalledPeaks`, **rendered**
from the dataset record:

```
hasCalledPeaks = experimentType === 'histonemod'
```

`histonemod` without any inputs is an error (see Checks), so this matches the
workflow's own gate exactly.

- An override of `presenter.injectorProps.hasCalledPeaks` is refused, with a
  message saying it follows `experimentType`.
- A curator who has histone data but doesn't want peaks picks
  `histonemod_noInput`. Pairs still get ratio tracks; peaks are skipped.
- If the workflow ever gains a separate switch, add a dataset prop then and
  derive `hasCalledPeaks` from it. That change touches one function.

## Samplesheet

- The ChIP-seq samplesheet always has 4 columns:
  `sample,fastq_1,fastq_2,input`. The header name is ours, because the
  pipelines read by position. `input` matches the bowtie-mapping test data
  and says what the column means.
- An input row has an empty `input`. A ChIP row has its input's `sample` id,
  or an empty value when the dataset has no inputs.
- Several ChIP rows may name the same input (the workflow pairs by a
  cross-product filter). One column means at most one input per ChIP sample.
- Other types keep the 3-column sheet. `samplesheet(samples, { columns })` and
  `parseSamplesheet(text, { columns })` take the column list from the type.
  The default stays `sample,fastq_1,fastq_2`, so dnaseq and bulk-rnaseq output
  is byte-identical.

Example (from a curator, with the legacy header):

```
BF_H3_Input,SRR13477527,,
BF_H3_ChIP,SRR13477529,,BF_H3_Input
```

## Samples

Annotations gain two per-sample fields, which Claude proposes and the curator
confirms:

- `role`: `chip` or `input`.
- `input`: the `sampleId` of the control. Present only on `chip` samples.

STF factors add `role` and `target` (the antibody or histone mark, for example
`H3K4me3` or `H3`, or the TF name) next to the usual isolate characteristics.
Claude proposes them from BioSample attributes, sample titles and
`library_name` (titles such as `*_Input` and `*_ChIP`), and never invents a
target.

## Checks (`checkCurated`, on top of the shared ones)

Errors:

- Every non-empty `input` names a `sample` in the same sheet.
- An `input` target has `role: input` and an empty `input` of its own (no
  chains and no self-reference).
- The samplesheet `input` column agrees with the annotations for every sample.
- `histonemod` with no inputs at all. The class requires inputs; offer
  `histonemod_noInput` instead.
- `histonemod_noInput` with any inputs. Offer `histonemod`, or remove the
  pairing.
- Used runs mix single- and paired-end layouts.

Warnings:

- An input that no ChIP sample uses.
- Inputs in the dataset, but some ChIP samples without one. For `histonemod`
  those samples get no peaks. A dataset with no inputs at all gets no warning.

## Library checks

`libraryProblems(runs, { used, expect })`, where the type supplies `expect`.

- dnaseq: `{ source: 'GENOMIC', strategies: ['WGS'] }`, which is today's
  behavior.
- chipseq: expected strategy by type: `histonemod`, `histonemod_noInput` and
  `tfbinding` expect `ChIP-Seq`; `mnase` expects `MNase-Seq`; `faire` expects
  `FAIRE-seq`; `dnase` expects `DNase-Hypersensitivity`. Input samples are
  also allowed `WGS`. A mismatch is a warning, not a hard stop.

Claude suggests `experimentType` from the dominant `library_strategy` and the
sample titles (histone marks versus TF names). The curator picks it.

## Organism

`organismRule = { new: false, max: 1 }`, the same rule bulk-rnaseq uses.
Functional data such as ChIP-seq may be added for an organism that is already
loaded, or proposed for the same release or an earlier one. The workflow needs
only the genome FASTA; paralogs are not needed, so `check-released-organism.js`
is dropped from the skill. There is no `requiredOrganismConstants`.

How the existing machinery enforces this:

- **Phase 1:** `crossCheckOrganisms` accepts an organism that only a genome
  proposal on master introduces. It records `source: { proposal }` and warns
  that the dataset loads in the same build as that genome or later.
- **Phase 2:** settlement stops while that genome is not loaded on the
  rebuild branch ("load it first, in this build or an earlier one").

Phase 1 only warns about the build order. A ChIP-seq proposal filed for Build
70 against a genome milestoned for Build 72 is caught at load, not at
publish. Follow-up, not ChIP-specific: at publish, compare the genome ticket's
`Build NN` milestone with `--build` and refuse a later genome. That covers
every functional type.

## Presenter

- RNA-seq/DNA-seq fields. Default `displayName`:
  `ChIP-Seq analysis of <species>`, or the MNase-Seq, FAIRE-Seq or DNase-Seq
  equivalent, by experiment type.
- Injector `org.apidb.apicommon.model.datasetInjector.ChIPSeq`.
  `injectorDefaults = { key: '', subTrackAttr: 'name' }`. `hasCalledPeaks` is
  rendered as above.
- `requiredFields = ['shortDisplayName', 'shortAttribution']`.

## Delivery and preprocessing

- `prepare-delivery.js` needs no change. It doesn't run ngs-samples-nextflow;
  the build's `processChipSeqExperiment.xml` passes `assayType=ChipSeq`
  itself.
- Confirm that ngs-samples-nextflow keeps column 4 through concatenation of
  multi-run samples. The README says it is passed through as `var1`.
- `corpus = { root: 'common/chipSeq/sampleDetailsForEda', layout: 'per-organism' }`.
  The path is confirmed. The corpus starts empty, so the first delivery
  creates `<organism>/`.

## Wiring

- `dataset-types/index.js`, `package.json` `sharedFiles` (new
  `propose-chipseq` entries, plus `_sra-experiment.js` for dnaseq and
  chipseq).
- `curator.config.json` `typeLabels`: `chipseq: "chipseq"`.
- `skills/propose-chipseq/`: cloned from propose-dnaseq, minus the
  released-organism step, plus a Step 2 section on pairing inputs and choosing
  `experimentType`.
- README "Available Skills", CLAUDE.md repository tree, `docs/development.md`
  module table.

## Testing

- Refactor: the dnaseq golden `expected.xml` and the artifact tests pass
  unchanged.
- Fixture: a histonemod experiment with shared inputs, with golden presenter
  (`hasCalledPeaks=true`) and dataset XML. Add a tfbinding variant
  (`hasCalledPeaks=false`, pairs kept).
- Unit tests for every check above: dangling `input`, chain, self-reference,
  unused input, histonemod with no inputs, noInput with inputs, mixed
  layouts, and an overridden `hasCalledPeaks`.
- Samplesheet round trip with 3 and 4 columns.
- `libraryProblems` with `expect` for both types.

## Decisions (2026-11-02)

- **Organism:** loaded, or proposed for the same release or an earlier one
  (see Organism).
- **Corpus root:** `common/chipSeq/sampleDetailsForEda`; it starts empty.
- **Peaks:** histone modification experiments only, not TF binding yet. If TF
  binding gains peak calling, change the `hasCalledPeaks` derivation and the
  tfbinding fixture; nothing else.
