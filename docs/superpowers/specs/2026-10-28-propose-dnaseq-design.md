# Propose DNA-seq Datasets

## Problem

Curators can propose bulk RNA-seq and genome assemblies, but not DNA-seq
(isolate WGS) experiments. DNA-seq shares most of RNA-seq's sample handling:
SRA runs resolved to BioSamples, a samplesheet for ngs-samples-nextflow, and
STF entity files. Its presenter, dataset entry and organism preconditions
differ.

The most important check for this dataset type: every `sample` in
`samplesheet.csv` is an id in `entity-sample.tsv`, and the reverse. Only
`bulk-rnaseq.js` performs that check today, and copying it would give two
implementations that can drift apart.

## Scope

In scope:

- A `propose-dnaseq` skill (Phase 1), single organism, reads from SRA only.
- A `dnaseq` dataset type that `load-proposals` renders (Phase 2), including
  the organism `ploidy` constant.
- A shared SRA-samples module that both `bulk-rnaseq` and `dnaseq` use.
- Dropping the `strandedness` column from every samplesheet, with a one-time
  migration of existing RNA-seq proposals.

Out of scope: `verify-dnaseq`, multi-organism DNA-seq, server/URL read
sources, and organisms already released but re-assembled in the current release
(their orthomcl data may be stale; not detected).

## Dataset class

From `Model/lib/xml/datasetClass/classes.xml` (`dnaseqExperiment`):

- Props: `projectName`, `organismAbbrev`, `name`, `version`, `fromSRA`, `ploidy`.
- Dataset name: `${organismAbbrev}_${name}_dnaseqExperiment_RSRC`.
- Delivery: `@@manualDeliveryDir@@/${projectName}/${organismAbbrev}/SNP/${name}/${version}/final/`,
  holding `samplesheet.csv`.

The type reads the pattern and delivery path through `readDatasetClass`. It
never hard-codes them.

## Artifacts

Per proposal:

| File | Content |
|---|---|
| `curated/dataset.json` | `props: { fromSRA: "true", ploidy: "$$ploidy$$" }`, `source: { type: "sra" }` |
| `curated/presenter.json` | RNA-seq presenter fields; injector props `{ hasCNVData }` |
| `curated/<abbrev>/samplesheet.csv` | `sample,fastq_1,fastq_2` |
| `curated/<abbrev>/entity-sample.tsv`, `.yaml` | STF via `lib/stf.js` |
| `curated/<ACCESSION>_sample_annotations.json` | Normalized sample annotations |

`ploidy` is always the organism-file constant reference `$$ploidy$$`, matching
all 200 existing dnaseq entries. It is never a literal value in Phase 1.

### Presenter

Same fields and rendering as RNA-seq (`displayName`, `shortDisplayName`,
`shortAttribution`, `summary`, description with General Description and
Methodology, links, PubMed ids, contacts, history), with:

```xml
<templateInjector className="org.apidb.apicommon.model.datasetInjector.IsolatesHTS">
  <prop name="hasCNVData">true|false</prop>
</templateInjector>
```

Defaults: `displayName` "DNA-Seq analysis of <organism>", and `summary` the
same text with the species italicised. `shortDisplayName` and
`shortAttribution` are required overrides, as they are for RNA-seq. No
`graphXAxisSamplesDescription`.

`hasCNVData` defaults to `String(chromosomeCount > 0)` from the released-site
query (below). The curator can change it in the overrides, and reviewers can
change it after the proposal is published.

## Organism rules

Organism abbreviation lookup and checks are the same as RNA-seq
(`crossCheckOrganisms` against `origin/rebuild<RR>`), with one stricter rule:

**The organism must already be on the released site.** Gene CNV depends on
orthomcl paralogs, and those exist only for released organisms. So:

- An organism that only a pending genome proposal introduces is a hard stop.
  RNA-seq only warns here. The type declares
  `organismRule: { new: false, pending: 'refuse' }`.
- An organism in the `rebuildRR` organism file but absent from the released
  site is a hard stop.

### Released-site query

`lib/released-organisms.js` calls

```
POST https://veupathdb.org/veupathdb/service/record-types/organism/searches/GenomeDataTypes/reports/standard
{"searchConfig":{"parameters":{}},
 "reportConfig":{"attributes":["organism_name","strain","project_id","chromosomeCount"],
                 "pagination":{"offset":0,"numRecords":2000}}}
```

The service does not return the VEuPathDB organismAbbrev. The lookup joins the
organism file's `ncbiTaxonId` constant to the record's `source_id`
(`NCBITAXON_<id>`) and checks that `project_id` matches. It returns
`{ released, chromosomeCount }`.

The report needs no API key.

When the query fails (network error, non-2xx response, unparseable body), the
script stops, and no override gets past it.

When no record matches the `ncbiTaxonId` and project, the script stops. It
lists candidate records whose `organism_name` shares the genus and species,
with their `source_id`, strain and `chromosomeCount`. Claude asks the curator
to pick one, or to confirm the organism is not released, which is a hard stop.
The curator's pick is passed as `--released-organism <source_id>` and recorded
in the manifest. Claude never picks for the curator.

## Library checks

`lib/library-checks.js` runs over the ENA run metadata after Step 1.
`fetch-sra-metadata.js` gains the fields `library_source`,
`library_selection`, `read_count` and `base_count`.

| Check | Result |
|---|---|
| No runs | Hard stop |
| A run with `read_count` or `base_count` 0 or missing | Hard stop |
| `library_source` not `GENOMIC` | Hard stop |
| `library_strategy` not `WGS` | Warning |
| `library_selection` in PolyA, cDNA, Oligo-dT | Warning |
| Mean read length (`base_count / read_count`, halved if paired) > 300 on an Illumina instrument | Warning |
| Fewer than 1,000,000 reads in a sample | Warning |

Warnings are listed per run. The curator drops runs or accepts them; Claude
relays every warning verbatim. Reference case: PRJNA1086165 (contains
SAMN40370510) triggers every warning type and no hard stop.

## Samples

One sample per BioSample. Several runs of the same BioSample are technical
replicates: they make one sample with one samplesheet row per run, and
ngs-samples-nextflow concatenates them.

Several BioSamples with the same strain, sample name and metadata (rare) stay
separate samples with distinct sampleIds and a shared label. Step 2 flags them
for the curator and never merges them silently.

Sample characteristics (strain, isolate, host, geographic location,
collection date) become STF variables. DNA-seq has no strandedness and no
graph factors.

## Shared SRA-samples module

`shared/scripts/dataset-types/_sra-samples.js`. Both types import it.

- `normalizeSamples(annotations, runs, opts)`: moved unchanged from
  `bulk-rnaseq.js`.
- `samplesheet(samples)` and `parseSamplesheet(text)`, with header
  `sample,fastq_1,fastq_2`.
- `stfFor(annotations, opts)`: wraps `sampleAnnotationsToStf`.
- `checkSamplesAgree({ samplesheet, tsv, annotations })`: sheet ids, STF ids
  and annotation sampleIds must all be the same set. Errors name the ids found
  in only one of them.

`bulk-rnaseq.js` keeps what is specific to it: analysisConfig, strandedness,
multi-organism membership and file sources. `checkOrganism` calls
`checkSamplesAgree` in place of its inline id comparisons.

`checkSamplesAgree` runs at write (`assertCuratedAgree`), publish and load for
both types. It refuses and never repairs.

## Samplesheet column migration

Strandedness is a property of the whole dataset (`dataset.json`
`isStrandSpecific`, analysisConfig), and the RNA-seq workflow ignores the
samplesheet column. The column is dropped. After the change the checker accepts
only the 3-column header.

`bin/dropSamplesheetStrandednessColumn.js` (in dataset-curator, run against a
VEuPathDatasets checkout):

- Targets every `Proposals/*/curated/*/samplesheet.csv` whose header is exactly
  `sample,fastq_1,fastq_2,strandedness`. A file with any other header is
  refused and named.
- `--dry-run` lists each file with its before and after header and row count.
- Afterwards it runs `checkCurated` on every migrated proposal.

It is applied to:

1. `origin/master`: the 10 RNA-seq proposals, in one PR.
2. `proposal/PRJDB6658` (PR #115, Initial draft): one commit pushed to its branch.

The migration PR and the dataset-curator PR that switches to the 3-column
header merge together. Otherwise the next load refuses the old files.

## Load (Phase 2)

`load-proposals` registers `dnaseq` in `DATASET_TYPES` and renders the
presenter and the dataset entry as for other types. The dataset entry goes into
`Datasets/lib/xml/datasets/<Project>/<abbrev>.xml`.

The ploidy constant is checked before the dataset entry is written:

- `<constant name="ploidy" value="N"/>` present: no change. A `--ploidy
  <abbrev>=M` with a different value is a hard stop.
- Missing, no `--ploidy`: hard stop naming the organism. Claude proposes a
  value with a one-line biological rationale and asks the data loader to
  confirm or correct it.
- Missing, with `--ploidy <abbrev>=N` (a positive integer): inserted after the
  last top-level `<constant>`.

Claude never passes `--ploidy` without the loader's confirmation.

## Skill workflow

`skills/propose-dnaseq/`, modeled on `propose-bulk-rnaseq`:

| Step | Command | DNA-seq specifics |
|---|---|---|
| 0 | `start-proposal.js <PRJ> --external-id bioproject=<PRJ>` | No GEO. A BioSample id is resolved to its BioProject, and the curator confirms. |
| 1 | `fetch-sra-metadata.js <ACC>`, `check-library.js <ACC>` | Library checks above |
| 2 | Claude writes `_sample_annotations.json` | Isolate model above |
| 3 | Contacts | Unchanged |
| 4 | `write-proposal.js --type dnaseq ... [--released-organism <source_id>]` | Organism and released-site checks, `hasCNVData` default, artifacts, id check |
| 5 | `render-proposal.js --artifacts .curation/delivery ...` | `SNP/<name>/<version>/final/` layout |
| 6 | `publish-proposal.js <ACC> --build <NN>` | Unchanged; id check re-run |

`fetch-sra-metadata.js` moves to `shared/scripts/`, synced into both propose
skills.

## Testing

- `_sra-samples.js`: the existing RNA-seq normalization and consistency tests
  move with the code and pass unchanged apart from the header.
- `checkSamplesAgree`: an id only in the samplesheet, an id only in the STF, an
  id only in the annotations, and ids that differ only in case. Each fails and
  names the ids, for both types.
- `library-checks`: fixtures shaped from PRJNA1086165 (WXS, PolyA, 8 kb
  NovaSeq reads, low depth → warnings), plus TRANSCRIPTOMIC and zero-read runs
  (→ hard stops).
- `released-organisms`: a recorded response covering released with
  chromosomes, released at contig level, no match (candidates listed), a
  `--released-organism` pick, an unknown pick, and a failed query. No live network.
- `dnaseq.js`: golden presenter XML (IsolatesHTS, `hasCNVData`), the dataset
  entry with `$$ploidy$$`, the delivery layout, and a dataset name checked
  through `readDatasetClass`.
- Load ploidy: present, present but different, missing without `--ploidy`, and
  missing with `--ploidy`.
- Migration: a dry run on a fixture tree, refusal of an unexpected header, and
  `checkCurated` passing afterwards.
- End to end: PRJNA1086165 → `bcinB05-10` in the demo checkout through Step 5,
  without publishing.

## Delivery

Each PR is on its own feature branch, built in a worktree.

1. dataset-curator: extract `_sra-samples.js`, switch to the 3-column
   samplesheet, add the migration script.
2. VEuPathDatasets: the migration PR to master plus the commit on
   `proposal/PRJDB6658`. Merges with 1.
3. dataset-curator: `propose-dnaseq`, the `dnaseq` type, library and
   released-organism checks, and `load-proposals` support including ploidy.
   Plugin version 2.3.0.
