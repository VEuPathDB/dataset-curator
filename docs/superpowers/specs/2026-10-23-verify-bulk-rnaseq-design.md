# Verify bulk RNA-seq proposals

Date: 2026-10-23
Status: approved design, not yet planned

## Problem

Verification is Step 2 of `load-proposals`. That skill's description covers
two jobs, so a request to verify pulls in loading context, and the gate
between "mark ready" and "load" sits inside one skill. Verification today is
also mostly a human checklist: the only automated part is
`load-proposal.js --dry-run`, which needs the rebuild branch checked out.

Several checks a person does by hand are deterministic:

- the runs are bulk short-read RNA-seq, not ChIP-seq, long-read or
  single-cell (nothing gates this today; `fetch-sra-metadata.js` records the
  fields but never rejects);
- sample IDs, labels and runs agree across `samplesheet.csv`,
  `analysisConfig.xml`, `entity-sample.tsv` and the sample annotations
  (`checkCurated` compares IDs only, and parses the XML with a regex);
- `analysisConfig.xml` is readable by the Perl that consumes it;
- the STF entity files pass study-wrangler validation;
- each sample has enough reads.

## Reference: PRJNA525426

Ticket #117 (`Proposed`, PR #118 merged, milestone `Build 73`). Walking it
through by hand on 2026-10-23:

| Check | Result |
|---|---|
| Library type | 6 runs, `RNA-Seq / TRANSCRIPTOMIC / cDNA / PAIRED / ILLUMINA MiSeq` |
| `checkCurated` | `[]` |
| Labels and runs across files | agree (checked by eye; not automated) |
| `AnalysisConfigParser` + `displayAndBaseName` | one `RnaSeqAnalysisEbi` step, 3 groups x 2 samples |
| study.wrangler 1.0.41 `validate` | `Entity is valid.` |
| Depth | 524,236 to 592,337 spots per sample, one run each |

Under the depth rule below every sample fails, so this proposal does not
verify.

## Decisions

- **One skill per dataset type**, mirroring `propose-*`:
  `verify-bulk-rnaseq` now, `verify-genome-assembly` later. Genome
  verification may spawn subordinate datasets and gets its own SKILL.md.
- **Validators live in `shared/`** so `load-proposal.js` runs the same code.
- **Validate once at verification, again at load.** No CI: re-checking every
  proposal on every push is not worth the cost.
- **Missing tools are errors**, never skips.
- **Verification needs no rebuild branch** for content checks. Build fitness
  reads a ref given with `--against`.
- `load-proposals` loses its verification step and the verification half of
  its description.

### Prerequisite: release is not rebuild

`Build NN` milestones are website releases. `rebuildNN` branches are
postgres database rebuilds (currently `rebuild02`); one rebuild feeds many
releases. `load-ops.js` derives `rebuild${build}` from the milestone at
lines 26, 115, 190 and 242, and the docs repeat the assumption. This is
fixed in its own PR before this work: load takes the rebuild branch it is
checked out on, or `--rebuild-branch`, and the milestone stays a release
target only. This design assumes that fix.

## Skill flow

`skills/verify-bulk-rnaseq/SKILL.md`:

1. `list-proposals.js --status proposed` and pick one.
2. `start-verification.js <ACC>` (optional claim; unchanged).
3. `validate-proposal.js <ACC> [--against <ref>]`: prints the report, writes
   `.curation/tmp/verify/<ACC>.json`, exits non-zero on any error.
4. A person reviews the presenter text, the curator's notes on the ticket
   and every warning.
5. `mark-ready.js <ACC> "<note>"` or `request-revision.js <ACC> "<reason>"`.

`start-verification`, `mark-ready`, `request-revision` and `list-proposals`
are already in `shared/scripts`; `package.json` `sharedFiles` adds
`verify-bulk-rnaseq` to their targets along with the new files.

## Layout

```
shared/scripts/
  validate-proposal.js
  lib/validation.js                   # runs validators, builds report, verdict
  lib/tools/apicommondata.js          # resolves the checkout, runs the Perl shim
  lib/tools/apicommondata-parse.pl
  lib/tools/study-wrangler.js         # resolves Rscript and the package version
  lib/tools/study-wrangler-validate.R
  dataset-types/bulk-rnaseq/validators/
    library-type.js
    consistency.js
    perl-parse.js
    stf.js
```

`dataset-types/bulk-rnaseq.js` exports `validators`, imported from that
directory. `buildFitness` is shared, not per type.

## Validator contract

```js
{ name: 'perlParse', tools: ['apiCommonData'], run: async (ctx) => Finding[] }
// ctx:     { proposalDir, manifest, tools, against }
// Finding: { validator, severity: 'error' | 'warning' | 'info', organism?, message }
```

`validation.js` resolves every tool a validator names before running it. A
tool that cannot be resolved becomes one `error` finding for that validator
("could not verify: <reason>"). An exception thrown by a validator becomes
one `error` finding naming it. All validators run; a run reports every
finding.

## Validators

### libraryType

Reads `inputs/<ACC>_sra_metadata.json`, the snapshot taken at proposal
time. Nothing is fetched live.

| Field | Pass | Warning | Error |
|---|---|---|---|
| `library_strategy` | `RNA-Seq` | | anything else, naming ChIP-Seq, ATAC-seq, miRNA-Seq, ncRNA-Seq when seen |
| `library_source` | `TRANSCRIPTOMIC` | | anything else, naming `TRANSCRIPTOMIC SINGLE CELL` when seen |
| `instrument_platform` | `ILLUMINA` | `BGISEQ`, `DNBSEQ`, `ION_TORRENT` | `OXFORD_NANOPORE`, `PACBIO_SMRT`, `LS454` and any other; the message points to `long-read-rnaseq-nextflow` for the long-read platforms |
| `library_selection` | | | never; reported as `info` |

Warning text:

- MGI (`BGISEQ`, `DNBSEQ`): bulk-rnaseq-nextflow clips only Illumina
  adapters (Trimmomatic `ILLUMINACLIP` with `All_adaptors-*.fa`). MGI adapter
  read-through stays in the reads, lowering alignment rates and adding
  soft-clipped or mismatched bases near the 3' end, worst with short
  inserts. Confirm the library's insert size, or add MGI adapters to the
  pipeline.
- `ION_TORRENT`: single-end reads of variable length with homopolymer indel
  errors. The pipeline does not clip Ion Torrent adapters, and indels near
  splice sites can shift HISAT2 junction calls and lower unique-alignment
  rates. Expect noisier junctions and counts.

**Depth.** Runs are grouped by samplesheet `sample`; rows sharing a name are
technical replicates and are concatenated downstream, so their `read_count`
values are summed. `read_count` is the spot count (read pairs for
paired-end). A sample under 1,000,000 spots is an `error` naming the sample,
its runs and the total. A samplesheet run missing from the metadata is an
`error`. For a `server` or `url` source there are no counts: one `warning`,
"depth not checked; confirm by hand".

### consistency

Runs `checkCurated` and adds, per organism:

- **labels**: each `analysisConfig.xml` group label equals the
  `label` of the same samples in `entity-sample.tsv` and the annotations;
- **runs**: the runs listed for each sample in `samplesheet.csv`, in the
  TSV's SRA ID column and in the annotations are the same set.

### perlParse

Runs ApiCommonData's `AnalysisConfigParser->parse` and
`AnalysisConfigRepeatFinder::displayAndBaseName` on each organism's
`analysisConfig.xml` through `apicommondata-parse.pl`, which prints JSON.
The shim builds a temporary `ApiCommonData/Load/` module tree of symlinks to
`<apiCommonDataPath>/Load/lib/perl/*.pm` and sets `PERL5LIB` to it. Errors
when the parse dies, when there is not exactly one
`ApiCommonData::Load::RnaSeqAnalysisEbi` step, or when the returned groups
(display name to sample list) differ from the label groups in the
annotations.

### stf

Runs `entity_from_stf(tsv, yaml)` then `validate()` from study.wrangler on
each organism's `entity-sample.tsv` and `.yaml`. Errors when either fails or
`validate()` is not `TRUE`; the R output is carried in the message.

### buildFitness (only with `--against <ref>`)

The existing load checks, refactored to read from a ref through
`git show` instead of `HEAD` and the working tree: every organism's dataset
file exists, the dataset and presenter names are free, and each proposed
abbreviation settles. Load keeps its checkout requirement because it writes.

## Tools

- `apiCommonDataPath` in `curator.config.json`: an ApiCommonData checkout.
  Its version is `git -C <path> rev-parse HEAD`.
- `Rscript` on `PATH` with `study.wrangler` installed, at or above a minimum
  version constant in `study-wrangler.js` (1.0.41 at time of writing).
  Its version is `packageVersion("study.wrangler")`.

## Report

```json
{
  "schemaVersion": 1,
  "accession": "PRJNA525426",
  "datasetType": "bulk-rnaseq",
  "proposalTree": "<tree hash of Proposals/<ACC> on origin/master>",
  "against": "origin/rebuild02",
  "tools": { "apiCommonData": "<commit>", "studyWrangler": "1.0.41" },
  "findings": [],
  "verdict": "pass"
}
```

`verdict` is `fail` with any error, `needs-review` with any warning, `pass`
otherwise. `against` is `null` without `--against`. Further keys (genome's
spawned datasets) are additive.

## mark-ready gate

`mark-ready.js` refuses unless `.curation/tmp/verify/<ACC>.json` exists, its
`proposalTree` equals the current tree of `Proposals/<ACC>` on
`origin/master`, and its `verdict` is not `fail`. An update republished
after validation changes the tree, so it must be validated again. The
`Verified:` comment carries the verdict, tool versions and the text of each
accepted warning, followed by the person's note.

## Load

`load-proposal.js`, dry run or not, runs the content validators (every one
but `buildFitness`, whose checks load already does on its branch) before
rendering and refuses on any error. It does not read the verification report.
The loader's machine therefore needs the same tools as the verifier's.

## Error handling

| Situation | Outcome |
|---|---|
| Tool path unset or wrong, `Rscript` or the package missing, version too old | `error`: could not verify, naming what is missing |
| Validator throws | `error` naming the validator and the message |
| Proposal not on `origin/master`, or an update PR is open | `validate-proposal.js` refuses, as `start-verification` does |
| `--against` ref missing | refuses before any validator runs |
| Report stale or `fail` at mark-ready | refuses, naming which |

## Testing

`node --test`, beside the existing suites:

- `libraryType`: each platform's severity, strategy and source errors, depth
  with replicate summing, a run missing from the metadata, the non-SRA
  warning.
- `consistency`: label mismatch, run mismatch, agreement.
- Perl and R runners: run against the real tools, and skip with a visible
  message when `apiCommonDataPath` or study.wrangler is unavailable. Tests
  may skip; validators may not.
- PRJNA525426 as a fixture: every validator passes except depth, which
  reports 6 errors.
- `validation.js`: missing tool and thrown validator become errors; verdict
  computation.
- `mark-ready`: refuses with no report, a stale `proposalTree`, and a `fail`
  verdict.

## Out of scope

- Genome assembly verification and subordinate datasets.
- CI.
- The release/rebuild fix (its own PR, above).
- Genome-size-aware depth thresholds.
