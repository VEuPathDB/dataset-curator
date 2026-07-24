# Build 71 RNA-seq STF Curation Workflow

This workflow processes 32 of the 34 datasets listed in `files/datasets-todo.tsv` (two are excluded — see "Excluded datasets" below). Unlike Build 70 (which parsed metadata out of ApiCommonPresenters commits), **all metadata is pre-supplied in the TSV** — there is no commit-parsing step. For each dataset we fetch the manual delivery, gather supporting context, and convert sample annotations to STF format.

**Working directory for all commands:** `/home/maccallr/work/dataset-curator`

## Key Files

- `files/datasets-todo.tsv` — the work list (34 rows, tab-separated, one header row; 32 to process)
- `files/rnaseq-done.txt` — skip-list checkpoint (carried over from Build 70 as a running ledger, so historical dataset names are included); append dataset name when done
- `files/rnaseq-skipped.txt` — datasets deliberately excluded from this run; never append to `rnaseq-done.txt`
- `files/rnaseq-caveats.txt` — per-dataset anomaly notes (see below)
- `files/run-log.md` — orchestrator-level per-dataset summary table, plus open workflow issues
- `skills/curate-bulk-rnaseq/scripts/fetch-sra-metadata.js` — fetch SRA/BioSample metadata
- `skills/sample-annotations-to-stf/` — STF conversion skill
- `build71/manual_delivery_tmp/<datasetName>/` — rsync'd pipeline output per dataset
- `build71/outputs/<datasetName>/` — STF output directory per dataset

### `datasets-todo.tsv` columns

| # | Column | Notes |
|---|--------|-------|
| 1 | `Data Type` | always `RNASeq` in this build |
| 2 | `datasetName` | authoritative dataset name — use verbatim |
| 3 | `projectId` | of the 32 processed: `FungiDB` (24), `HostDB` (5), `VectorBase` (3) — context only; not written to the STF |
| 4 | `bioprojectAccession` | `PRJNA…`/`PRJEB…`; **not unique** — see below |
| 5 | `pubmedId` | may be blank, a single PMID, **comma-separated PMIDs**, or a **DOI URL** |
| 6 | `manualDeliveryPath` | append `/final` when rsyncing (see Step 2 caveat) |
| 7 | `Notes` | Redmine ticket URL — reference only, do not fetch unless stuck |

## Orchestration

The main agent reads `files/datasets-todo.tsv`, skips the header row, **drops any row whose `datasetName` appears in `files/rnaseq-skipped.txt`**, and iterates the remaining 32 rows **sequentially**, spawning one subagent per dataset. Sequential processing keeps `rnaseq-done.txt` consistent and respects NCBI API rate limits.

Pass the subagent the whole row (datasetName, projectId, bioprojectAccession, pubmedId, manualDeliveryPath) plus a reminder about the caveats file.

### Excluded datasets

Two rows are **not** bulk RNA-seq and are excluded from this run by curator decision:

| datasetName | Reason |
|---|---|
| `mmusC57BL6J_Cneo_scRNA_2020_rnaSeq_RSRC` | single-cell RNA-seq |
| `etenHoughton2021_miRNA_3Stages_rnaSeq_RSRC` | miRNA-seq |

They stay out of `rnaseq-done.txt` so the ledger continues to mean "processed", not "seen". `rnaseq-skipped.txt` is the record of why.

### Caveats file

Subagents that encounter anomalies (mismatched organism prefixes, run accessions from a different BioProject in the samplesheet, label discrepancies between `analysisConfig.xml` and SRA metadata, missing strandedness, etc.) must append a line to `build71/files/rnaseq-caveats.txt` in the format `<datasetName>: <one-line description>`. Review this file alongside the STF outputs before delivery.

### Shared BioProjects — IMPORTANT

Unlike Build 70, **five BioProjects appear on more than one row**:

| BioProject | Datasets sharing it |
|---|---|
| `PRJNA1173228` | `foxy4287_…_Kim_2025`, `anidFGSCA4_…_Kim_2025`, `afumAf293_…_Kim_2025` |
| `PRJNA323849` | `foxy4287_foxy_Restrepo_2016`, `fsolFSSC5MPISDFRAT0091_fsol_Restrepo_2016` |
| `PRJNA819275` | `ttonCBS112818_Xiao_Tspp_2023`, `hsapREF_Xiao_Tspp_2023` |
| `PRJNA393407` | `ptri1-1BBBDRace1_Sucher_Ptriticina_2018`, `bgrasphordeiiRACE1_Sucher_Bhordei_2018` |
| `PRJNA670487` | `sscl1980UF-70_…_Kusch_2022_PAIRED`, `sscl1980UF-70_…_Kusch_2022_SINGLE` |

Consequences:

1. **Each dataset uses only a subset of the BioProject's runs.** The dataset's own `analysisConfig.xml` + `samplesheet.csv` are authoritative for which runs belong to it — never pull the full run list from the SRA metadata. (Typically these are dual-RNA-seq / host-pathogen pairs, multi-species experiments, or one study split by library layout.)
2. **The annotations JSON must be keyed by `datasetName`, not BioProject**, or the datasets will overwrite each other. Write `tmp/<datasetName>_sample_annotations.json` and pass `<datasetName>` as the *first* argument to the STF script (Step 5). The SRA metadata cache (`tmp/<BIOPROJECT>_sra_metadata.json`) is safe to share and can simply be reused if it already exists.

### Resuming in a new session

State lives entirely in `build71/files/`, so a fresh session can pick up mid-run:

1. Read `files/run-log.md` — the per-dataset table plus any unresolved workflow issues.
2. Read `files/rnaseq-done.txt` — everything already processed (includes Build 70 history).
3. Read `files/rnaseq-skipped.txt` — deliberately excluded rows.
4. Resume from the first `datasets-todo.tsv` row not present in either file, using the prompt template below.

After each subagent returns, the orchestrator must add a row to `run-log.md` — the subagent maintains `rnaseq-done.txt` and `rnaseq-caveats.txt`, but not the run log.

### Subagent model

Run subagents on **Sonnet** (curator preference for this build). The work is structural — XML/CSV parsing against a fixed spec — and row 1 confirmed Sonnet handles it cleanly.

### Subagent prompt template

Use this verbatim, substituting the row values. Do not paraphrase it — the concern-logging examples and report format are what make the run auditable.

```
You are processing ONE RNA-seq dataset for the VEuPathDB Build 71 STF curation workflow.

**Working directory for all commands: `/home/maccallr/work/dataset-curator`** (use this as
CWD for every bash command; all paths below are relative to it).

**First, read `/home/maccallr/work/dataset-curator/build71/CLAUDE.md` in full.** It is the
authoritative workflow spec. Follow Steps 1-7 exactly.

## Your dataset (row <N> of 32)

- datasetName: `<datasetName>`
- projectId: `<projectId>`
- bioprojectAccession: `<bioprojectAccession>`
- pubmedId: `<pubmedId or "none">`
- manualDeliveryPath: `<manualDeliveryPath>`

For Step 4, try the PubMed/bioRxiv MCP tools first; if they are not available to you, fall back
to `WebFetch` (see Step 4). Both are acceptable — do not block on the MCP tools.

## Critical reminders

- Write annotations to `tmp/<datasetName>_sample_annotations.json` (dataset-keyed, NOT
  bioproject-keyed).
- The STF command is:
  `node skills/sample-annotations-to-stf/scripts/sample-annotations-to-stf.js <datasetName> <datasetName> build71/outputs`
- `analysisConfig.xml` + `samplesheet.csv` are AUTHORITATIVE for sample structure. One
  `<value>` element = exactly one sample entry. Never group or collapse replicates.
- `label` is the condition text **before the pipe, transcribed VERBATIM** from
  `analysisConfig.xml` (identical across replicates, no replicate numbers). Do **not** decode,
  expand, or prettify abbreviations in the `label`. Capture the decoded/fine-grained meaning in
  `factors` instead (e.g. split `1 hour OFF-AM + 15µM FeCl3` into `medium`/`supplement` factors).
- Do NOT do any git operations (no commit, no branch, no push). The curator handles all git.
- For any JSON inspection/wrangling on the command line, use `jq` rather than Python/`json.loads`
  one-liners — the curator finds `jq` easier to read.

## Concerns log (IMPORTANT)

If you hit ANY anomaly, ambiguity, or judgement call you are less than confident about, append
a one-line entry to `build71/files/rnaseq-caveats.txt` in the format
`<datasetName>: <description>`. Examples of things that count: organism prefix mismatch between
dataset name and delivery path; run accessions in samplesheet.csv that don't belong to the
stated BioProject; sample counts disagreeing between analysisConfig.xml and samplesheet.csv;
missing or ambiguous `isStrandSpecific`; condition labels you had to guess the meaning of;
article unavailable; factors you were unsure how to define. Use `>>` append, never overwrite.

## Report back

End your response with a structured report containing exactly these sections:

**STATUS:** DONE | FAILED | SKIPPED (one word, plus one clause of detail)
**SAMPLES:** number of sample rows written
**PROFILESET:** the profileSetName used
**STRANDEDNESS:** stranded | unstranded | unknown
**FACTORS:** comma-separated list of factor keys
**CONCERNS:** every concern you logged, one per line, or the single word NONE. Repeat them
here in full even though you also wrote them to the caveats file.
```

### Safety filtering note

Many datasets involve pathogenic organisms (fungi, oomycetes, parasites). SRA metadata and article content for these can trip Claude's safety filter in subagents, causing a refusal. If a subagent fails with a policy/safety error, retry by spawning a new subagent with the same row but explicitly instructed to **skip Steps 3 and 4** (no NCBI fetch, no article fetch). `analysisConfig.xml` and `samplesheet.csv` supply all the structural information needed; Step 5 should proceed from those alone, noting in the caveats file that SRA/article context was unavailable.

---

## Per-Dataset Subagent Instructions

### Step 1: Check the skip list

Read `build71/files/rnaseq-done.txt`. If `datasetName` appears, stop immediately and report "SKIPPED: already done".

(No commit parsing in this build — `datasetName`, `projectId`, `bioprojectAccession` and `pubmedId` come straight from the TSV row.)

### Step 2: Fetch manual delivery data

```bash
rsync -Car yew:<manualDeliveryPath>/final build71/manual_delivery_tmp/<datasetName>/
```

Key files (both are required inputs for Step 5):
- `build71/manual_delivery_tmp/<datasetName>/final/analysisConfig.xml` — authoritative sample structure, labels, and strandedness
- `build71/manual_delivery_tmp/<datasetName>/final/samplesheet.csv` — maps replicate-level sample IDs to SRR/ERR run accessions

**Path caveat:** all `manualDeliveryPath` values end in a date directory (e.g. `…/2024-01-01`) **except** `sscl1980UF-70_…_Kusch_2022_SINGLE`, whose TSV value stops one level short. For that row use:

```
/eupath/data/EuPathDB/manualDelivery/FungiDB/sscl1980UF-70/rnaSeq/sscl1980UF-70_Kusch_2022_SINGLE/2021-07-22
```

All 34 delivery paths (with this fix) were verified to exist with a `final/` subdirectory on 2026-07-23.

### Step 3: Fetch SRA metadata

```bash
node skills/curate-bulk-rnaseq/scripts/fetch-sra-metadata.js <bioprojectAccession>
```

Output: `tmp/<BIOPROJECT>_sra_metadata.json`. If this file already exists (shared BioProject), reuse it rather than refetching.

### Step 4: Fetch article context

Use the abstract/methods as context for sample annotation — especially for decoding condition abbreviations and confirming strandedness. Handle the three `pubmedId` shapes:

- **Single PMID** (e.g. `38358035`) — `mcp__claude_ai_PubMed__get_full_text_article`, falling back to `mcp__claude_ai_PubMed__get_article_metadata`.
- **Comma-separated PMIDs** (`39495784, 41134624` and `40817095, 39026826`) — fetch the first; consult the second only if the first doesn't explain the sample structure.
- **DOI URL** (`https://doi.org/10.1101/2025.02.03.636182`, shared by the three Kim 2025 datasets) — a bioRxiv preprint with no PMID; try the `mcp__claude_ai_bioRxiv__*` tools, else `WebFetch` the DOI URL directly.
- **Blank** (9 datasets) — skip this step and rely on `analysisConfig.xml` + SRA metadata.

**Tip — GEO series metadata for decoding labels.** When SRA `sample_attributes` are sparse and
the paper's full text is paywalled (e.g. Wiley returns HTTP 402), the study's **GEO series** is
often the fastest authoritative source: the submitter's own per-sample titles/characteristics
usually decode the condition labels directly. Find the `GSExxxxxx` accession (SRA metadata,
article, or an NCBI search) and `WebFetch`
`https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=<GSE>`. This is how the row 1
`transformant_line` call was confirmed: GEO titles labelled replicates separately from the
`_A`/`_B` axis, proving A/B were independent transformant lines rather than replicate suffixes.

The PubMed and bioRxiv MCP servers are connected in the orchestrator session (confirmed working
2026-07-23 after the curator authenticated with their work account).

> **MCP-in-subagent caveat:** the row 1 subagent could not see `mcp__claude_ai_PubMed__*` (auth
> had not completed at that point). MCP availability may not propagate to every spawned subagent.
> So: **try the PubMed/bioRxiv MCP tools first; if they are not available to you, fall back to
> `WebFetch`** on `https://pubmed.ncbi.nlm.nih.gov/<PMID>/` or the DOI URL. Either source is
> acceptable — the abstract/methods is all this step needs. If neither works, log it as a caveat
> rather than guessing at condition labels.

### Step 5: Analyze samples (reasoning step)

Parse `build71/manual_delivery_tmp/<datasetName>/final/analysisConfig.xml` and `samplesheet.csv` as the **authoritative** source for sample structure. Use `tmp/<BIOPROJECT>_sra_metadata.json` and article context as supplementary information only (decode abbreviations, infer factor definitions, confirm strandedness).

**Parsing `analysisConfig.xml`:**
- `profileSetName` property → use verbatim as `profileSetName` in the output JSON
- `isStrandSpecific` property → `"0"` = `"unstranded"`, `"1"` = `"stranded"`, absent = `"unknown"`
- Each `<value>` under `samples` is pipe-delimited: `conditionLabel|sampleId`
  - The part **after** the pipe is the unique `sampleId` for that individual sample
  - The part **before** the pipe is the `conditionLabel` shared by all replicates of the same condition — use this as the `label` in the output
  - **Each `<value>` becomes exactly one entry in `samples`** — do not group or collapse

**Parsing `samplesheet.csv`:**
- `id` column = `sampleId` (matches the part after the pipe in `analysisConfig.xml`)
- `fastq1` column = the SRR/ERR accession for that sample
- For each sample entry, look up its `sampleId` in the samplesheet to get its run accession(s). Usually one row per `sampleId` (one SRR/ERR), but a `sampleId` may map to **multiple rows sharing one BioSample** (e.g. a sample sequenced across several runs). In that case include **all** those accessions in the sample's `runs` array — do not drop or split them into separate samples.

Produce **`tmp/<datasetName>_sample_annotations.json`** (dataset-keyed, not BioProject-keyed — see "Shared BioProjects" above):

```json
{
  "bioproject": "PRJNAXXXXXX",
  "profileSetName": "Transcriptomes of ... (verbatim from analysisConfig.xml)",
  "strandedness": "stranded|unstranded|unknown",
  "factors": {
    "factor1": {
      "displayName": "human-readable factor name",
      "definition": "what this factor measures (≤80 chars)",
      "unit": "hour"
    }
  },
  "samples": [
    {
      "sampleId": "sampleId-after-pipe-in-analysisConfig",
      "label": "conditionLabel-before-pipe (no replicate numbers, same for all replicates of a condition)",
      "runs": ["SRR..."],
      "factors": { "factor1": "value1" }
    }
  ]
}
```

For the example `WT_3d|WT_3d_rep1`, the output entry would be:
```json
{ "sampleId": "WT_3d_rep1", "label": "WT_3d", "runs": ["SRR7405244"], "factors": { ... } }
```

Rules:
- `factors`: attributes that vary between biological conditions — exclude replicate numbers and technical metadata (instrument, library layout, etc.). See `skills/curate-bulk-rnaseq/resources/step-2-analyze-samples.md` for full guidance on `displayName`, `definition`, and `unit`.
- `sampleId`: exactly the part after the pipe in `analysisConfig.xml` — one sample entry per `<value>` element
- `label`: the part before the pipe (the condition label, identical across replicates of the same condition), transcribed **verbatim** from `analysisConfig.xml` — do NOT decode or expand abbreviations into the label; put decoded meaning in `factors` instead. Never include replicate numbers. (SRA/article context is still used to *understand* the label so you can define factors, just not to rewrite it.)
- `runs`: the SRR/ERR accession(s) from `samplesheet.csv` for that `sampleId` — normally one, but include **all** accessions when a `sampleId` maps to multiple samplesheet rows under one BioSample
- `strandedness`: take from `isStrandSpecific` in `analysisConfig.xml`; cross-check with SRA/article if unclear

### Step 6: Convert to STF

Use the `sample-annotations-to-stf` skill. Because the annotations file is dataset-keyed, pass `<datasetName>` as **both** the first and second argument — the script's first argument only selects `tmp/<prefix>_sample_annotations.json`:

```bash
node skills/sample-annotations-to-stf/scripts/sample-annotations-to-stf.js <datasetName> <datasetName> build71/outputs
```

This writes draft STF files to `build71/outputs/<datasetName>/entity-sample.{tsv,yaml}`. Review the inferred YAML variable types per the skill's Step 2.

### Step 7: Record completion

```bash
echo "<datasetName>" >> build71/files/rnaseq-done.txt
```

---

## Final orchestrator step: DESeq-suitability test

Run **once by the orchestrator**, after all per-dataset processing is complete, over every
dataset that produced a `build71/outputs/<datasetName>/entity-sample.tsv` (i.e. successful
sample annotation — a FAILED row like a mismatched delivery has no output and is skipped).

**Purpose:** flag which datasets can support a DESeq differential-expression contrast.

**Rule (implemented in the script):** a dataset is DESeq-suitable **only if** its samples can be
partitioned, by the `label` field, into **two non-empty groups each containing at least two
samples**, where whole labels are assigned to one side or the other. That covers both:

- two (or more) distinct labels each with ≥2 replicates (e.g. `WT`×3 vs `mut`×3), and
- several labels combined into two groups of ≥2 (e.g. `1h`,`2h`,`3h`,`4h` → `1h+2h` vs `3h+4h`).

Combinatorially this is equivalent to: **some subset of the per-label sample counts sums to a
value between 2 and N−2** (N = total samples). Consequences: a single label (any count) is not
suitable (no contrast); fewer than 4 samples is not suitable; one label with only 1 replicate
paired with one other label is not suitable.

Datasets with **≥10 samples** are almost always suitable and aren't really the point of the test,
but the script is run on everything and reports them (split out under a "large" heading) since
running the script on all datasets is free.

```bash
node skills/curate-bulk-rnaseq/scripts/deseq-suitability.js build71/outputs
```

This writes a human-readable markdown report to `build71/files/deseq-suitability.md` containing
the suitable / not-suitable dataset lists as **bare fenced code blocks** (for easy cut-and-paste
into shell operations), plus a details table showing each dataset's sample count, label
composition, and an example valid split (or the reason it's unsuitable).
