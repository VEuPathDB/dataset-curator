# Step 5: Generate Delivery Outputs

## Overview

This step generates the pipeline configuration files and places them in the delivery directory for handoff to the data processing team.

## Delivery Directory

All outputs go to:

```
delivery/bulk-rnaseq/<BIOPROJECT>/
```

This directory is **not** version controlled (gitignored) - outputs are delivered separately from the configuration files in veupathdb-repos/.

## Create Delivery Directory

```bash
bash scripts/check-delivery-dirs.sh bulk-rnaseq <BIOPROJECT>
```

This creates the directory structure if it doesn't exist.

## Generate Analysis Config

```bash
node scripts/generate-analysis-config.js <BIOPROJECT> [--strand-specific]
```

### Arguments

- `BIOPROJECT`: BioProject accession
- `--strand-specific`: Add if the library is strand-specific (most modern RNA-seq is)

### Output: `analysisConfig.xml`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<xml>
  <step class="ApiCommonData::Load::RnaSeqAnalysisEbi">
    <property name="profileSetName" value="Short Display Name"/>
    <property name="samples">
        <value>Condition A|sampleId1</value>
        <value>Condition B|sampleId2</value>
    </property>
    <property name="isStrandSpecific" value="1"/>
  </step>
</xml>
```

The `samples` property maps display labels to sample IDs (from sample annotations).

## Generate Samplesheet

```bash
node scripts/generate-samplesheet.js <BIOPROJECT>
```

### Output: `samplesheet.csv`

```csv
sample,fastq_1,fastq_2,strandedness
sampleId1,SRR26104233,SRR26104233,auto
sampleId1,SRR26104234,SRR26104234,auto
sampleId2,SRR26104235,SRR26104235,auto
```

### Samplesheet Format

| Column | Description |
|--------|-------------|
| `sample` | Sample ID (biological sample) |
| `fastq_1` | Run accession for read 1 (or SRR for auto-fetch) |
| `fastq_2` | Run accession for read 2 (same as fastq_1 for paired, empty for single) |
| `strandedness` | `auto`, `forward`, `reverse`, or `unstranded` |

**Technical replicates**: Same `sample` ID with different run accessions

## Save Sample Annotations

Also save the sample annotations for reference:

```bash
# This is typically done by Claude writing the file directly
```

### Output: `sample-annotations.csv`

```csv
sampleId,label,runs,infection,timepoint
SAMN001,Infected 24h,"SRR001,SRR002",infected,24h
SAMN002,Control 24h,SRR003,control,24h
SAMN003,Infected 48h,SRR004,infected,48h
```

## Final Delivery Checklist

After generating all outputs, verify the delivery directory contains:

```
delivery/bulk-rnaseq/<BIOPROJECT>/
├── analysisConfig.xml       # Pipeline configuration
├── samplesheet.csv          # nf-core samplesheet
└── sample-annotations.csv   # Reference annotations
```

## Handoff Notes

Include the following information when delivering the dataset:

1. **BioProject**: PRJNA...
2. **Organism**: Scientific name
3. **Sample count**: Number of biological samples
4. **Run count**: Total number of SRA runs
5. **Strand specificity**: Yes/No
6. **Special notes**: Any issues or considerations

## Troubleshooting

### Missing sample annotations
If `generate-analysis-config.js` warns about missing annotations:
1. Ensure Step 2 (Analyze Samples) was completed
2. Check that `tmp/<BIOPROJECT>_sample_annotations.json` exists
3. The script will fall back to basic annotations from SRA metadata

### Strandedness detection
The scripts default to `auto` strandedness - the pipeline will auto-detect.
If you know the strandedness, you can manually edit the samplesheet.

### Technical replicates
Multiple runs with the same sample ID will be properly handled by the pipeline.
Verify grouping is correct in the sample annotations.
