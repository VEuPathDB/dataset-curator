# Step 2: Analyze Samples

## Overview

In this step, Claude analyzes the fetched SRA metadata to:
1. Identify experimental factors (which attributes vary between samples)
2. Generate sample annotations with meaningful labels
3. Determine strand specificity
4. Group technical replicates

## Claude's Analysis Tasks

### 1. Identify Experimental Factors

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

### 2. Generate Sample Annotations

Create a structured annotation file with:

```json
{
  "bioproject": "PRJNA1018599",
  "profileSetName": "Short Display Name",
  "samples": [
    {
      "sampleId": "unique_sample_id",
      "label": "Condition A",
      "runs": ["SRR26104233", "SRR26104234"],
      "factors": {
        "infection": "infected",
        "tissue": "hemolymph"
      }
    }
  ]
}
```

#### Sample ID Rules
- Use BioSample accession (SAMN...) or GEO accession (GSM...) as base
- Must be unique across the experiment
- Keep concise but identifiable

#### Label Rules
- Human-readable label for graph x-axis
- Combine factor values that vary (e.g., "Infected - 24h")
- **NO replicate numbers** in labels (replicates share the same label)
- Keep concise for graph readability

#### Technical Replicate Grouping
- Runs with the same biological sample should share a `sampleId`
- List all run accessions in the `runs` array
- Same sample_accession = same biological sample

### 3. Determine Strand Specificity

Check library preparation details to determine strandedness:

**Strand-specific indicators:**
- Library selection: dUTP, stranded protocols
- Library kit mentions: TruSeq Stranded, NEBNext Ultra II Directional
- Experiment description mentions strand-specificity

**Non-strand-specific indicators:**
- Older protocols (pre-2015)
- Library selection: random, unspecified
- No stranded kit mentioned

**Default**: Most modern RNA-seq (2016+) is strand-specific. When in doubt, mark as strand-specific.

## Output

Save the sample annotations to:
```
tmp/<BIOPROJECT>_sample_annotations.json
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
  "factors": ["infection", "timepoint"],
  "samples": [
    {
      "sampleId": "SAMN001",
      "label": "Infected 24h",
      "runs": ["SRR001", "SRR002"],
      "factors": {"infection": "infected", "timepoint": "24h"}
    },
    {
      "sampleId": "SAMN002",
      "label": "Control 24h",
      "runs": ["SRR003"],
      "factors": {"infection": "control", "timepoint": "24h"}
    },
    {
      "sampleId": "SAMN003",
      "label": "Infected 48h",
      "runs": ["SRR004"],
      "factors": {"infection": "infected", "timepoint": "48h"}
    }
  ]
}
```

**Notes:**
- `tissue` is NOT a factor (all samples are liver)
- SRR001 and SRR002 are technical replicates (same SAMN001)
- Labels combine only the varying factors

## Curator Review

After Claude generates annotations, the curator should verify:
- [ ] Sample groupings are correct
- [ ] Labels are clear and appropriate for graphs
- [ ] All experimental factors are captured
- [ ] Strand specificity determination is accurate
