# Build 70 RNA-seq STF Curation Workflow

This workflow processes Redmine ticket entries from `files/redmine-rnaseq.json`. Each qualifying entry has both a `presenters_commit` (adding a `datasetPresenter` XML block to ApiCommonPresenters) and a `manual_delivery` path. For each dataset, we extract metadata, run Steps 1–2 of the `curate-bulk-rnaseq` skill, and convert sample annotations to STF format.

**Working directory for all commands:** `/home/maccallr/work/dataset-curator`

## Key Files

- `files/redmine-rnaseq.json` — Redmine ticket entries; only process entries that have **both** `presenters_commit` and `manual_delivery` fields (skip entries with `error` or `skip` fields, or missing either field)
- `files/rnaseq-done.txt` — skip-list checkpoint; append dataset name when done
- `scripts/parse-github-commit.js` — extract presenter metadata from a commit
- `skills/curate-bulk-rnaseq/scripts/fetch-sra-metadata.js` — fetch SRA/BioSample metadata
- `outputs/<datasetName>/` — output directory per dataset

## Orchestration

The main agent reads `files/redmine-rnaseq.json`, filters to entries with **both** `presenters_commit` and `manual_delivery`, **and** where the `manual_delivery` value matches `/rnaSeq/` (including the slashes), and iterates them **sequentially**, spawning one subagent per entry. Sequential processing keeps `rnaseq-done.txt` consistent and respects API rate limits.

### Safety filtering note

Some datasets involve pathogenic organisms (fungi, oomycetes, parasites). The SRA metadata and PubMed article content for these may trigger Claude's safety filter in subagents, causing the subagent to refuse. If a subagent fails with a policy/safety error, retry by spawning a new subagent with the same entry but explicitly instructed to **skip Steps 2 and 4** (no NCBI fetch, no PubMed fetch). The `analysisConfig.xml` and `samplesheet.csv` provide all the structural information needed; Step 5 should proceed using only those files, noting in the output that SRA/PubMed context was unavailable.

---

## Per-Entry Subagent Instructions

Spawn a subagent with the following workflow for each qualifying entry. Provide the `presenters_commit` URL, the `manual_delivery` path, and any pre-parsed metadata (if already known) in the prompt.

### Step 1: Parse the commit

```bash
node build70/scripts/parse-github-commit.js <commitUrl>
```

Output JSON: `{ datasetName, projectName, bioprojectAccession, pubmedId }`

The script uses the local `veupathdb-repos/ApiCommonPresenters` git checkout. It handles:
- `projectName` missing from the tag (inferred from the `.xml` filename)
- CDATA-wrapped URLs
- Numeric BioProject IDs (resolved to accession via NCBI esummary)
- Dataset type check: exits with code 2 and `NOT_RNASEQ` message if `templateInjector className` is not `RNASeq` or `RNASeqEbi` — stop and report "SKIPPED: not RNA-seq"

**Check skip list:** Read `build70/files/rnaseq-done.txt`. If `datasetName` appears, stop immediately and report "SKIPPED: already done".

### Step 2: Fetch SRA metadata

```bash
node skills/curate-bulk-rnaseq/scripts/fetch-sra-metadata.js <bioprojectAccession>
```

Output: `tmp/<BIOPROJECT>_sra_metadata.json`

### Step 3: Fetch manual delivery data

```bash
rsync -Car yew:<manual_delivery>/final build70/manual_delivery_tmp/<datasetName>/
```

This fetches the pipeline output directory. Key files (both are required inputs for Step 5):
- `build70/manual_delivery_tmp/<datasetName>/final/analysisConfig.xml` — authoritative sample structure, labels, and strandedness
- `build70/manual_delivery_tmp/<datasetName>/final/samplesheet.csv` — maps replicate-level sample IDs to SRR/ERR run accessions

### Step 4: Fetch article context via PubMed MCP

Use `mcp__claude_ai_PubMed__get_full_text_article` with the `pubmedId`. Fall back to `mcp__claude_ai_PubMed__get_article_metadata` if full text is unavailable. Use the abstract/methods as context for sample annotation (especially strandedness and experimental design). Skip if `pubmedId` is null.

The PubMed MCP tools are available in this session without any installation.

### Step 5: Analyze samples (reasoning step)

Parse `build70/manual_delivery_tmp/<datasetName>/final/analysisConfig.xml` and `samplesheet.csv` as the **authoritative** source for sample structure. Use `tmp/<BIOPROJECT>_sra_metadata.json` and PubMed article context as supplementary information (e.g. to decode abbreviations, infer factor definitions, and confirm strandedness).

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
- For each sample entry, look up its `sampleId` in the samplesheet to get its single run accession

Produce `tmp/<BIOPROJECT>_sample_annotations.json`:

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
- `label`: the part before the pipe (the condition label, identical across replicates of the same condition) — decode abbreviations using SRA metadata or PubMed context where helpful; never include replicate numbers
- `runs`: single SRR/ERR accession from `samplesheet.csv` for that `sampleId`
- `strandedness`: take from `isStrandSpecific` in `analysisConfig.xml`; cross-check with SRA/PubMed if unclear

### Step 6: Convert to STF

Use the `sample-annotations-to-stf` skill to convert the annotations for `<BIOPROJECT>` / `<datasetName>`. Use `build70/outputs` as the output base directory.

This writes draft STF files to `build70/outputs/<datasetName>/entity-sample.{tsv,yaml}`.

### Step 7: Record completion

```bash
echo "<datasetName>" >> build70/files/rnaseq-done.txt
```
