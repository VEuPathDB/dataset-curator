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

The main agent reads `files/redmine-rnaseq.json`, filters to entries with **both** `presenters_commit` and `manual_delivery`, and iterates them **sequentially**, spawning one subagent per entry. Sequential processing keeps `rnaseq-done.txt` consistent and respects API rate limits.

### Safety filtering note

Some datasets involve pathogenic organisms (fungi, oomycetes, parasites). The SRA metadata and PubMed article content for these may trigger Claude's safety filter in subagents, causing the subagent to refuse. If a subagent fails with a policy/safety error, process that commit directly in the main session instead.

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

### Step 3: Fetch article context via PubMed MCP

Use `mcp__claude_ai_PubMed__get_full_text_article` with the `pubmedId`. Fall back to `mcp__claude_ai_PubMed__get_article_metadata` if full text is unavailable. Use the abstract/methods as context for sample annotation (especially strandedness and experimental design). Skip if `pubmedId` is null.

The PubMed MCP tools are available in this session without any installation.

### Step 4: Analyze samples (reasoning step)

Read `tmp/<BIOPROJECT>_sra_metadata.json`. Use sample attributes and PubMed article context to produce `tmp/<BIOPROJECT>_sample_annotations.json`:

```json
{
  "bioproject": "PRJNAXXXXXX",
  "profileSetName": "short human-readable description of the experiment",
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
      "sampleId": "SAMN...",
      "label": "human-readable label (no replicate numbers)",
      "runs": ["SRR..."],
      "factors": { "factor1": "value1" }
    }
  ]
}
```

Rules:
- `factors`: attributes that vary between biological conditions — exclude replicate numbers and technical metadata (instrument, library layout, etc.). See `skills/curate-bulk-rnaseq/resources/step-2-analyze-samples.md` for full guidance on `displayName`, `definition`, and `unit`.
- `sampleId`: BioSample accession (SAMN/SAME/SAMD), unique per biological sample
- `label`: concise, combines varying factor values, **no replicate numbers**
- `runs`: all SRR/ERR accessions for that biological sample (group technical replicates under one sampleId)
- `strandedness`: infer from library prep info in metadata or PubMed methods; use `"unknown"` if unclear

### Step 5: Convert to STF

Use the `sample-annotations-to-stf` skill to convert the annotations for `<BIOPROJECT>` / `<datasetName>`. Use `build70/outputs` as the output base directory.

This writes draft STF files to `build70/outputs/<datasetName>/entity-sample.{tsv,yaml}`.

### Step 6: Record completion

```bash
echo "<datasetName>" >> build70/files/rnaseq-done.txt
```
