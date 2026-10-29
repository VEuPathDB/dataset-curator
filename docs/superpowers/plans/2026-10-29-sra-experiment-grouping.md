# SRA Experiment Grouping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop treating "one BioSample" as "one sample". Runs merge as technical replicates without asking only when they share an SRA experiment (SRX). When one BioSample spans several SRX that differ, the curator decides whether to merge or split, and the decision is recorded. Every sample's BioSample and SRX accessions go into the entity-sample STF files.

**Architecture:** `fetch-sra-metadata.js` requests the experiment-level fields from ENA. A pure function in `_sra-samples.js` finds BioSamples whose experiments differ. A shared CLI reports them in Step 1 of both propose skills. `normalizeSamples` (run by `write-proposal.js`) refuses to merge differing experiments unless the sample carries a reason. It also gives each sample of a split BioSample its own default id. `sampleAnnotationsToStf` adds `BioSample` and `SRA experiment(s)` variables.

**Tech Stack:** Node 18 ESM, zero dependencies, `node:test`. Shared files are synced into skills by `bin/sync-shared.js`, configured in `package.json` `sharedFiles`.

---

## Motivating case: SAMN15226360 (PRJNA639160, *Blumeria hordei* SK2)

| Run | SRX | experiment_title | library_name | submission | first_public |
|---|---|---|---|---|---|
| SRR12005499 | SRX8538680 | …DNA-seq of Bgh: SK2 | S1147Nr3 | SRA1086590 | 2021-07-04 |
| SRR28871819 | SRX24431285 | …SK2 generation 5 | S7922Nr1 | SRA1857086 | 2024-05-03 |
| SRR28871818 | SRX24431286 | …SK2 generation 10 | S7922Nr2 | SRA1857086 | 2024-05-03 |

These are three populations under one BioSample: the selected line and two later generations of it. The step-2 rule "one sample per BioSample, all its runs" merges them into one sample, so variants would be called on a mix of three populations. The ENA `sample_title` is "Microbe sample from Blumeria hordei K1" on every BioSample in the project, so it says nothing about the sample.

Publication: Kusch et al. 2024, *New Phytologist*, doi:10.1111/nph.20063. The BioProject has no PubMed link. The 2021 bioRxiv preprint (10.1101/2021.12.09.471931) describes SK1–SK3 as independent lines selected from K1 on mlo barley. It also describes a 12-generation propagation on wild-type barley (cv. Ingrid), but it predates the 2024 runs. The fixture uses the SRA titles as they are; the published Methods aren't needed for this work.

The paper was hard to find: the BioProject has no PubMed link, and neither the accession nor the BioProject's own title (which differs from the paper's) finds it in Europe PMC. Only a Europe PMC title search without one word ("conserved") found it. Task 7 makes that lookup a script.

## Design decisions

1. **SRX is the unit of technical replication.** Within one SRX the runs are one library sequenced more than once, so they merge with no question asked.
2. **Comparing experiments uses accessions and fields, never name patterns.** A BioSample is flagged when it has two or more SRX and any of `experiment_title`, `library_name`, `submission_accession` or `first_public` differs between them. Names are shown to the curator as evidence only: in the SK2 case, Nr1/Nr2 look like replicate numbers but are different generations.
3. **Flagging happens in Step 1, and the decision is required at write.** `check-experiments.js` reports flagged BioSamples. `write-proposal.js` refuses a sample that merges flagged experiments unless the sample has `experimentsMerged: "<reason>"`. Splitting needs no reason. A legitimate top-up therefore costs one sentence, and the proposal records why it was merged.
4. **A split BioSample gets distinct ids by default.** When several samples share a BioSample and the ids would otherwise come from it, each id is `<BioSample>_<SRX>`. A sample with several SRX and no curator `sampleId` is refused, with a message asking for one.
5. **Normalized annotations record `experiments`.** These are the sample's distinct SRX accessions, in run order, next to the existing `biosample`. Verify and the STF writer then read provenance from the annotations without re-reading SRA metadata.
6. **entity-sample STF gains provenance variables:** `BioSample` (single-valued) and `SRA.experiment.s.` (multi-valued, `,`-delimited, like `SRA.ID.s.`). Both are written only when `sra: true`. Annotations from before this change have no `experiments`, so that column is written empty for them. EDA doesn't need the accessions, so both variables carry `hidden: [everywhere]`. This is study-wrangler's per-variable `hidden` metadata (levels `download`, `variableTree`, `map`, `everywhere`), read from the STF YAML as a list. The provenance stays in the corpus without showing up in the variable tree.
7. **No migration of existing proposals.** `checkSamplesAgree` compares sample ids only, so proposals already on master keep passing. Their STF files gain the new columns the next time `write-proposal.js` runs.

## Ground rules for every task

- Work on branch `sra-experiment-grouping` (holds this plan). Never commit to `main`.
- Edit `shared/`. Never edit the copies under `skills/*/scripts`: the pre-commit hook runs `yarn sync-shared` and overwrites them. A new shared file needs a `package.json` `sharedFiles` entry, or `tests/skill-imports.test.js` fails.
- Run tests with `yarn test`; a single file is `node --test tests/<file>.test.js`. Baseline on `main` (2.4.0): 828 pass, 0 fail, 5 skipped.
- TDD: write each failing test first, see it fail, then implement.
- Comments: only where the code is not self-describing, at most 2–3 lines. Match the JSDoc one-liners in `_sra-samples.js`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File structure

| File | Change |
|---|---|
| `shared/scripts/fetch-sra-metadata.js` | ENA fields gain `experiment_accession`, `library_name`, `submission_accession`, `first_public`. The CSV fallback maps `Experiment` to `experiment_accession` (it was wrongly mapped to `experiment_title`), plus `LibraryName`, `Submission` and `ReleaseDate` |
| `shared/scripts/dataset-types/_sra-samples.js` | New `mixedBioSamples(runs)`. `normalizeSamples` gains the `experimentsMerged` gate, `experiments` and the split-id default |
| `shared/scripts/check-experiments.js` (new) | CLI: report the flagged BioSamples for an accession as a table |
| `shared/scripts/lib/stf.js` | `BioSample` and `SRA.experiment.s.` variables |
| `shared/scripts/dataset-types/bulk-rnaseq/validators/consistency.js` | entity-sample `BioSample`/`SRA.experiment.s.` agree with the annotations, when the columns are present |
| `skills/propose-dnaseq/resources/step-1-fetch-metadata.md`, `step-2-analyze-samples.md`, `SKILL.md` | Run `check-experiments.js`; the sample model becomes "one sample per SRX group" |
| `skills/propose-bulk-rnaseq/resources/step-1-*.md`, `step-2-analyze-samples.md`, `SKILL.md` | Same; replace "Same sample_accession = same biological sample" |
| `shared/resources/proposal-workflow.md` | One line: samples group runs by SRA experiment, and BioSample is provenance |
| `shared/scripts/lib/publications.js`, `shared/scripts/find-publications.js` (new) | BioProject → linked PubMed, else Europe PMC candidates; full-text links |
| `tests/fixtures/sra-mixed-biosample.json` (new) | The three SK2 runs above, trimmed to the fetched fields |

---

### Task 1: Fetch the experiment-level fields

**Files:** `shared/scripts/fetch-sra-metadata.js`, `tests/fetch-sra-metadata.test.js` (or the existing test covering `csvToRuns`)

- [ ] **Step 1:** Failing test: `csvToRuns` on a runinfo row with `Experiment=SRX8538680`, `LibraryName=S1147Nr3`, `Submission=SRA1086590`, `ReleaseDate=2021-07-04 00:09:45` returns `experiment_accession: 'SRX8538680'`, `library_name`, `submission_accession` and `first_public: '2021-07-04'`, and doesn't put the SRX in `experiment_title`. Export `csvToRuns` if it isn't exported.
- [ ] **Step 2:** Add the four fields to `ENA_FIELDS`. Fix the CSV mapping and add the new runinfo headers to `knownKeys`.
- [ ] **Step 3:** Run the test and `yarn test`, then commit "Fetch SRA experiment accession, library name, submission and release date".

### Task 2: `mixedBioSamples`

**Files:** `shared/scripts/dataset-types/_sra-samples.js`, `tests/sra-samples.test.js`, `tests/fixtures/sra-mixed-biosample.json`

- [ ] **Step 1:** Failing tests:
  - SK2 fixture: one entry. `biosample: 'SAMN15226360'`, three `experiments` rows (`{ experiment, runs, experiment_title, library_name, submission_accession, first_public }`), and `differing` lists all four fields.
  - Generations 5 and 10 alone (same submission and date): flagged, with `differing: ['experiment_title', 'library_name']`.
  - Two SRX that agree on all four fields: not flagged.
  - Several runs in one SRX: not flagged.
  - A run with no `experiment_accession`: throws "re-run fetch-sra-metadata.js", since the metadata predates Task 1.
- [ ] **Step 2:** Implement:

```js
const EXPERIMENT_FIELDS = ['experiment_title', 'library_name', 'submission_accession', 'first_public'];

/** BioSamples whose runs span SRA experiments that differ in title, library name, submission or release date. */
export function mixedBioSamples(runs) {
  const missing = runs.filter((r) => !r.experiment_accession).map((r) => r.run_accession);
  if (missing.length) throw new Error(`Runs ${missing.join(', ')} have no experiment_accession; re-run fetch-sra-metadata.js`);
  return [...groupBy(runs, 'sample_accession')].flatMap(([biosample, own]) => {
    const experiments = [...groupBy(own, 'experiment_accession')].map(([experiment, rs]) => ({
      experiment, runs: rs.map((r) => r.run_accession), ...Object.fromEntries(EXPERIMENT_FIELDS.map((f) => [f, rs[0][f] ?? '']))
    }));
    const differing = EXPERIMENT_FIELDS.filter((f) => new Set(experiments.map((e) => e[f])).size > 1);
    return experiments.length > 1 && differing.length ? [{ biosample, experiments, differing }] : [];
  });
}
```

- [ ] **Step 3:** Run the tests, then commit.

### Task 3: `check-experiments.js`

**Files:** `shared/scripts/check-experiments.js` (new), `package.json` `sharedFiles` (into `propose-dnaseq` and `propose-bulk-rnaseq`), `tests/check-experiments.test.js`

- [ ] **Step 1:** Failing test: run the CLI against a `.curation/tmp/<ACC>_sra_metadata.json` built from the fixture in a temp dir. It prints a table per flagged BioSample (SRX, runs, then the four fields, with the differing ones marked) and exits 0. It prints "No BioSample spans differing SRA experiments" when there's nothing to report.
- [ ] **Step 2:** Implement it by following `check-library.js`: read the metadata file, call `mixedBioSamples` and print. It is report-only and never exits non-zero for a flag.
- [ ] **Step 3:** `yarn sync-shared`, then `yarn test`, then commit.

### Task 4: `normalizeSamples` gate, `experiments`, split ids

**Files:** `shared/scripts/dataset-types/_sra-samples.js`, `tests/sra-samples.test.js`

- [ ] **Step 1:** Failing tests (SK2 fixture):
  - One sample with all three runs and no `experimentsMerged`: throws. The message names SAMN15226360, the differing fields and the two ways out: split the runs by SRX, or set `experimentsMerged` to the reason.
  - The same sample with `experimentsMerged: "Top-up sequencing of one library"`: passes, and the reason is kept.
  - A blank `experimentsMerged`: throws, like a missing one.
  - Three samples, one per SRX, no curator ids: ids `SAMN15226360_SRX8538680`, `SAMN15226360_SRX24431285` and `SAMN15226360_SRX24431286`; each has `biosample` and `experiments: [<its SRX>]`.
  - Two samples sharing a BioSample, one of them holding two SRX and no curator `sampleId`: throws, asking for a `sampleId`.
  - Regression: one BioSample per sample, one SRX each; ids and labels are unchanged from today.
  - Every normalized SRA sample has `experiments`.
- [ ] **Step 2:** Implement it in the draft loop. Compute `experiments` from `own`. Run `mixedBioSamples` over the sample's own runs, and throw when it flags something and the sample has no reason. When choosing ids, a sample whose BioSample is shared by another sample falls back to `<biosample>_<experiments[0]>` instead of `biosample`, and it needs exactly one SRX.
- [ ] **Step 3:** Run `yarn test`; the bulk-rnaseq and dnaseq type tests must still pass. Commit.

### Task 5: entity-sample provenance variables

**Files:** `shared/scripts/lib/stf.js`, `tests/stf.test.js` (or wherever `sampleAnnotationsToStf` is tested), affected expectations in `tests/dataset-types*.test.js` and `tests/artifacts.test.js`

- [ ] **Step 1:** Failing tests:
  - `sra: true` gives a header of `sample.ID \\ Descriptors`, `SRA.ID.s.`, `BioSample`, `SRA.experiment.s.`, `label`, then the factors. Rows carry `biosample` and `experiments.join(',')`.
  - The YAML gains `variable: BioSample` (`provider_label: [BioSample]`, string, categorical) and `variable: SRA.experiment.s.` (`provider_label: ['SRA experiment(s)']`, `is_multi_valued: yes`, delimiter `,`). Each has `hidden:` with the single list item `everywhere`. `SRA.ID.s.` and `label` have no `hidden` key.
  - `sra: false` writes neither variable.
  - A sample with no `experiments` (older annotations) gets an empty cell.
- [ ] **Step 2:** Implement, then update the expected STF text in the existing tests. `serializeVariable` writes `hidden` as a YAML list when the variable has one.
- [ ] **Step 3:** Load the generated SK2 files with study.wrangler's `entity_from_stf` and validate them. Confirm both variables come back with `hidden` = `everywhere` and that validation passes. If a study-wrangler is set up for the tests, also run the STF validator test (`tests/validation-env.test.js` skips without one). Commit.

### Task 6: Verify agrees

**Files:** `shared/scripts/dataset-types/bulk-rnaseq/validators/consistency.js`, `tests/validators-bulk-rnaseq.test.js`

- [ ] **Step 1:** Failing tests: when entity-sample.tsv has the `BioSample`/`SRA.experiment.s.` columns, a row whose values differ from the annotations' `biosample`/`experiments` is an error. When the columns are absent (older proposals), the check is skipped.
- [ ] **Step 2:** Implement it next to the existing label and runs comparison. Commit.

### Task 7: `find-publications.js`

**Files:** `shared/scripts/lib/publications.js` (new, pure plus injectable fetch), `shared/scripts/find-publications.js` (new CLI), `package.json` `sharedFiles` (into `propose-dnaseq` and `propose-bulk-rnaseq`), `tests/publications.test.js`

Follow `lib/released-organisms.js`: `fetchImpl` is injectable, and the tests use canned responses only.

- [ ] **Step 1:** Failing tests for `findPublications(bioproject, { fetchImpl, geoPubmedIds })`, which returns `{ linked: [...], candidates: [...] }`. Each entry is `{ pmid, pmcid, doi, title, year, source, fullText: [{ url, availability }] }`.
  - **linked**: PubMed IDs from NCBI `elink` (bioproject → pubmed; the BioProject UID comes from `esearch`), plus any `geoPubmedIds` passed in, each looked up in Europe PMC (`EXT_ID:<pmid> AND SRC:MED`, `resultType=core`) for its DOI, PMCID and full-text links. These are confirmed links.
  - **candidates**, searched only when `linked` is empty:
    - a Europe PMC search for the accession string;
    - then a title search from the BioProject title (from `esummary`): the significant words (stop words and words under 3 letters dropped, at most 12) ANDed as `TITLE:(...)`;
    - when that finds nothing, the same search leaving out one word at a time.
    - Results are deduplicated by DOI, then PMID, keeping both MED and PPR (preprint) records.
  - SK2 canned case: elink finds nothing, the accession search finds nothing, the full title finds nothing, and leaving out "conserved" returns both `MED 39155769` and `PPR` 10.1101/2021.12.09.471931 as candidates.
  - Any HTTP failure throws with the URL's host in the message.
- [ ] **Step 2:** Implement it. The CLI is `node scripts/find-publications.js <ACCESSION>`. It reads the BioProject from `.curation/tmp/<ACCESSION>_sra_metadata.json` (or the accession itself when it is a PRJ…), and reads the GEO PubMed IDs from `.curation/tmp/<ACCESSION>_xref.json` when that file exists. It writes `.curation/tmp/<ACCESSION>_publications.json` and prints linked and candidate papers separately.
- [ ] **Step 3:** `yarn sync-shared`, then `yarn test`, then commit.

### Task 8: Skill documents

**Files:** both propose skills' `SKILL.md`, `step-1-fetch-metadata.md` and `step-2-analyze-samples.md`, plus `shared/resources/proposal-workflow.md`

- [ ] **Step 1:** Step 1 runs `node scripts/check-experiments.js <ACCESSION>` after the metadata fetch. For each flagged BioSample, show the table to the curator. Run `node scripts/find-publications.js <ACCESSION>`. Show the candidates to the curator to confirm, and never treat a candidate as linked without that. For each confirmed paper, read the Methods for how the samples relate: Europe PMC full text when there is a PMCID (`https://www.ebi.ac.uk/europepmc/webservices/rest/<PMCID>/fullTextXML`), else an open-access PDF from `fullText` (a bioRxiv preprint counts, noting that it may predate later runs). When nothing is readable, say so and ask the curator. Confirmed PubMed IDs also go to the presenter `pubmedIds`. Then ask the curator to choose: **split by SRX** (passages, time points, treatments, derived lines) or **merge** (re-sequencing of the same material), with the reason written as `experimentsMerged`.
- [ ] **Step 2:** In Step 2, "one sample per BioSample" becomes "one sample per SRA experiment group: runs sharing an SRX always merge; differing SRX under one BioSample follow the curator's Step 1 decision". Document the `<BioSample>_<SRX>` id default. For split samples, document the factors that describe how each one was derived: a `generation`/`passage` factor and the parent line, taken from the methods and not invented. Replace bulk-rnaseq's "Same sample_accession = same biological sample".
- [ ] **Step 3:** `proposal-workflow.md`: one sentence under "What a proposal holds" saying entity-sample carries each sample's BioSample and SRX accessions.
- [ ] **Step 4:** `yarn sync-shared`, then commit.

### Task 9: Version, end-to-end check, PR

- [ ] **Step 1:** Bump `package.json` to 2.5.0 (new annotation field and STF variables), plus wherever the version is mirrored (see the 2.4.0 commit `f3a40fe`).
- [ ] **Step 2:** End-to-end on PRJNA639160 in a scratch proposal dir, without publishing:
  - Run `fetch-sra-metadata.js`, then `check-experiments.js`; SAMN15226360 is flagged with three SRX.
  - Write annotations with one sample per SRX; `write-proposal.js` succeeds, and entity-sample.tsv shows the three ids with `BioSample` and `SRA.experiment.s.`.
  - Merge them with no `experimentsMerged`; `write-proposal.js` refuses.
  - `find-publications.js PRJNA639160` lists Kusch et al. 2024 (and the preprint) as candidates.
- [ ] **Step 3:** Run `yarn test` and confirm everything passes. Push the branch, open a PR against `main` (unset `GITHUB_TOKEN` for `gh`), and end the PR body with the Claude Code attribution line.

## Settled

 the accession variables are hidden in EDA (decision 6). `first_public` is compared by full date. A top-up released a day later is flagged and costs one `experimentsMerged` sentence, which is accepted. Switch to comparing years only if it proves noisy.
