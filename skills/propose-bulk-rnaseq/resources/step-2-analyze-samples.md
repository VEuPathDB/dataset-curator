# Step 2: Analyze Samples

## Overview

In this step, Claude analyzes the fetched SRA metadata to:
1. Identify experimental factors (which attributes vary between samples)
2. Generate sample annotations with meaningful labels
3. Determine strand specificity
4. Group technical replicates

## Using PDF Data (if available)

If `.curation/tmp/<ACCESSION>_pdf_extracted.json` exists from Step 1, use it to enhance analysis:

- **Strandedness**: Use `extracted.strandedness` value directly (no need to infer)
- **Sample context**: The `textChunks.methods` section may explain:
  - What experimental conditions mean
  - How samples were grouped
  - Technical details that clarify ambiguous metadata
- **Factor interpretation**: Methods text can help decode cryptic sample attribute names

**Check for PDF data:**
```bash
# If this file exists, incorporate the extracted data
.curation/tmp/<ACCESSION>_pdf_extracted.json
```

## Claude's Analysis Tasks

### 1a. Identify Experimental Factors

Examine the `sample_attributes` across all runs to find attributes that:
- Have **different values** across samples (these are the experimental factors)
- Are biologically meaningful (not technical metadata)

**Include** attributes like:
- infection, treatment, condition
- tissue, cell_type, organ
- timepoint, age, developmental_stage
- genotype, strain, isolate

**Exclude** technical columns like:
- Run, Bytes, Platform, Instrument
- Consent, DATASTORE fields
- BioProject, Center Name

### 1b. Write Factor Definitions

For each experimental factor identified above, populate `displayName`, `definition`, and (where applicable) `unit`.

#### `displayName` (required)

The human-readable label shown in UI. Lowercase preferred. As a default, replace underscores with spaces.

| Factor key | displayName |
|---|---|
| `infection` | `"infection"` |
| `developmental_stage` | `"developmental stage"` |
| `cell_type` | `"cell type"` |

It is fine to keep `displayName` identical to the key when the key is already readable (e.g. `"tissue"`, `"genotype"`).

#### `definition` (required)

A short noun-phrase (≤80 characters) that describes what the factor measures, written for a biologist reading a web-based analysis tool. No trailing period.

**Good definitions:**

| Factor key | definition |
|---|---|
| `infection` | `"Whether samples were exposed to a pathogen or left as untreated controls"` |
| `timepoint` | `"Time elapsed after treatment"` |
| `tissue` | `"Organ or tissue type from which RNA was extracted"` |
| `genotype` | `"Genetic background of the organism (wild-type or mutant)"` |
| `treatment` | `"Drug, compound, or intervention applied to the sample"` |
| `developmental_stage` | `"Life stage or developmental phase of the organism"` |
| `cell_type` | `"Cell population or cell line used"` |

**Avoid:**
- Repeating the key name: `"Infection"` adds nothing
- Generic catch-alls: `"Sample condition"`, `"Biological variable"`
- Raw cryptic SRA attribute names verbatim
- Full sentences or text over ~80 characters

**How to derive:**
1. Check SRA `sample_attributes` key name and values for semantic clues
2. If PDF data is available, scan `textChunks.abstract` and `textChunks.methods` for plain-English descriptions
3. Use the actual factor values (e.g. `"infected"`, `"control"`) to confirm what contrast the factor represents

#### `unit` (optional)

Include only for factors with **numeric or continuous values** where a measurement unit is meaningful.

- **Format**: singular, SI-friendly, non-abbreviated, US-spelling
- **Examples**: `"hour"`, `"minute"`, `"day"`, `"microgram"`, `"millimolar"`, `"meter"`, `"micrometer"`
- **Not**: `"h"`, `"hrs"`, `"µg"`, `"mM"`, `"µM"`, `"metre"`
- **Count variables**: When a factor counts discrete things (organisms, cells, colonies), use `"count"`. This is not strictly SI but is used throughout VEuPathDB.

Include `unit` when factor values are measurements: `"24h"`, `"0.5 mg/kg"`, `"day 3"`, `"100 cells"`.
Omit `unit` for categorical values: `"infected"`, `"liver"`, `"wild-type"`, `"female"`.

**Strip units from factor values**: When `unit` is set, remove the unit suffix from every value in each sample's `factors` object. The unit is already captured formally in the top-level `factors` entry.

| Raw SRA value | unit | Value in sample.factors |
|---|---|---|
| `"24h"` | `"hour"` | `"24"` |
| `"48h"` | `"hour"` | `"48"` |
| `"7 days"` | `"day"` | `"7"` |
| `"100 cells"` | `"count"` | `"100"` |

### 2. Generate Sample Annotations

Create a structured annotation file with:

```json
{
  "bioproject": "PRJNA1018599",
  "profileSetName": "Short Display Name",
  "strandedness": "stranded|unstranded|unknown",
  "factors": {
    "genotype": {
      "displayName": "genotype",
      "definition": "Genetic background of the organism (wild-type or mutant)"
    },
    "age": {
      "displayName": "age",
      "definition": "Age of the organism at time of sampling",
      "unit": "day"
    }
  },
  "samples": [
    {
      "label": "Wild-type 7 days",
      "runs": ["SRR26104233", "SRR26104234"],
      "factors": {
        "genotype": "wild-type",
        "age": "7"
      }
    }
  ]
}
```

#### Sample ID Rules
Leave `sampleId` out unless the curator wants a specific id. `write-proposal.js` sets it: the SRA sample title (reduced to letters, digits, `_`, `.`, `-`) when every sample without a curator id has a distinct one, otherwise the BioSample accession. A curator-chosen `sampleId` is always kept. The same id names the sample in `samplesheet.csv`, the STF files and `analysisConfig.xml`. Each sample's BioSample is recorded as `biosample`.

#### Label Rules
- Human-readable label for graph x-axis
- Combine factor values that vary (e.g., "Infected - 24h")
- **NO replicate numbers** in labels (replicates share the same label)
- Keep concise for graph readability
- `label` is the display name in `analysisConfig.xml` (`label|sampleId`). Replicates share it: that is how merging replicates is expressed.
- **No `|`** in a label: it separates label from sampleId. `write-proposal.js` refuses a supplied label containing one, so choose another separator (e.g. " - ").
- Left out, `label` defaults to the sample title minus a replicate suffix (`_replicate_1`, `_rep1`, `_R1`, or the same after a space), whether the `sampleId` came from the title or from the BioSample, so replicates titled alike share a label. Any `|` in the title becomes a space. Only a sample with no title gets its `sampleId` as label. A `label` you supply is always kept.

#### Technical Replicate Grouping
- Runs with the same biological sample belong to one sample entry
- List all run accessions in the `runs` array
- Same sample_accession = same biological sample; one sample takes runs from exactly one BioSample

### 3. Determine Strand Specificity

**If PDF data is available**: Use the `extracted.strandedness` value from `_pdf_extracted.json`. This is the most reliable source.

**Otherwise**, check library preparation details in SRA metadata:

**Strand-specific indicators:**
- Library selection: dUTP, stranded protocols
- Library kit mentions: TruSeq Stranded, NEBNext Ultra II Directional
- Experiment description mentions strand-specificity

**Non-strand-specific indicators:**
- Older protocols (pre-2015)
- Library selection: random, unspecified
- No stranded kit mentioned

**Default**: Most modern RNA-seq (2016+) is strand-specific. When in doubt, use `unknown` and let the pipeline auto-detect.

**Valid values**: `stranded`, `unstranded`, `unknown`

## Reads not in SRA

When the curator says the reads are on a server or at URLs, there is no SRA
metadata to derive anything from. Each sample gets a curator-chosen `sampleId`
and `files` in place of `runs`: one entry per lane, with `fastq_2` only when
paired.

```json
{
  "sampleId": "WT_7d_1",
  "label": "Wild-type 7 days",
  "files": [{ "fastq_1": "WT_7d_1_R1.fastq.gz", "fastq_2": "WT_7d_1_R2.fastq.gz" }],
  "factors": { "genotype": "wild-type", "age": "7" }
}
```

The top-level keys of the annotation template above still apply:
`bioproject` (the identifier), `profileSetName`, `strandedness` and `factors`.
Ask the curator for the strandedness, since there is no metadata to infer it
from. The factors feed `graphXAxisSamplesDescription`, so they are worth
filling in.

File names are bare: no directory, spaces or commas, and each file is listed
once. The directory or URL goes in `--overrides` (Step 4), not in the
annotations:

```json
{ "dataset": { "source": { "type": "server", "paths": ["/abs/dir"] } } }
```

or `{ "dataset": { "source": { "type": "url", "urls": [...] } } }`. The overrides also
need a `"version"` (YYYY-MM-DD, when the data last changed) alongside `"name"`,
unless a GEO series supplies it. All entries
must agree on paired vs single. A mix is refused and cannot be overridden.

This is a conversation, not a derivation. Ask the curator, over as many turns
as needed, for:

- the proposal identifier: a BioProject if one exists, otherwise a readable id of letters, digits, `_` and `.`
- each sample's `sampleId` and `label`
- each sample's file names, per lane
- the server directory or the URLs

Never guess file names. Show the result back as a table (sampleId, label,
fastq_1, fastq_2) and write `.curation/tmp/<ID>_sample_annotations.json` only
after the curator confirms. Skip `fetch-sra-metadata.js` (Step 1) when there is
nothing in SRA. The NCBI BioProject link is only added when the identifier is a
BioProject.

## Output

Save the sample annotations to:
```
.curation/tmp/<ACCESSION>_sample_annotations.json
```

## Example Analysis

Given this SRA metadata:

| Run | Sample | infection | tissue | timepoint |
|-----|--------|-----------|--------|-----------|
| SRR001 | SAMN001 | infected | liver | 24h |
| SRR002 | SAMN001 | infected | liver | 24h |
| SRR003 | SAMN002 | control | liver | 24h |
| SRR004 | SAMN003 | infected | liver | 48h |

The analysis would produce:

```json
{
  "bioproject": "PRJNA...",
  "profileSetName": "Infection time course in liver",
  "strandedness": "stranded",
  "factors": {
    "infection": {
      "displayName": "infection",
      "definition": "Whether samples were exposed to the pathogen or left as untreated controls"
    },
    "timepoint": {
      "displayName": "timepoint",
      "definition": "Time elapsed after treatment",
      "unit": "hour"
    }
  },
  "samples": [
    {
      "label": "Infected 24h",
      "runs": ["SRR001", "SRR002"],
      "factors": {"infection": "infected", "timepoint": "24"}
    },
    {
      "label": "Control 24h",
      "runs": ["SRR003"],
      "factors": {"infection": "control", "timepoint": "24"}
    },
    {
      "label": "Infected 48h",
      "runs": ["SRR004"],
      "factors": {"infection": "infected", "timepoint": "48"}
    }
  ]
}
```

**Notes:**
- `tissue` is NOT a factor (all samples are liver), so it has no entry in `factors`
- SRR001 and SRR002 are technical replicates (same BioSample, SAMN001)
- Labels combine only the varying factors
- `timepoint` values are `"24"` and `"48"`, not `"24h"` and `"48h"` — the unit suffix is stripped because the unit is captured formally in `factors.timepoint.unit`

## Curator Review

After Claude generates annotations, the curator should verify:
- [ ] Sample groupings are correct
- [ ] Labels are clear and appropriate for graphs
- [ ] All experimental factors are captured
- [ ] Strand specificity determination is accurate
