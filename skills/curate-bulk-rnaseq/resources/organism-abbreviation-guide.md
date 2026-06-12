# Organism Abbreviation System Guide

This guide explains how the enhanced organism abbreviation system works for RNA-seq dataset curation.

## Overview

The organism abbreviation system generates standardized organism abbreviations for datasetPresenter naming using the format:

**`orgAbbrev_Author_Year_rnaSeq_RSRC`**

**Examples:**
- `fgraPH-1_Fagundes_2026_rnaSeq_RSRC` (with publication)
- `fgraPH-1_sichuanagr_2025_rnaSeq_RSRC` (without publication, using submitter)

## How It Works

### 1. Interactive Organism Input

When running `generate-presenter-xml.js`, you'll be prompted:

```
Enter organism name: 
```

**Input the full organism name** including strain if known:
- ✅ `Fusarium graminearum PH-1`
- ✅ `Fusarium graminearum` (system will find reference strain)
- ✅ `Candida albicans strain A.1`
- ❌ `F. graminearum` (use full genus and species)

### 2. CSV Lookup Process

The system first searches the organism reference database:

```
Looking up: Fusarium graminearum PH-1
Found in database: fgraPH-1
Use 'fgraPH-1' as organism abbreviation? [Y/n]: 
```

**If found**: You can accept the existing abbreviation or provide a custom one.

**If not found**: The system generates a new abbreviation using standardized rules.

### 3. Abbreviation Generation Rules

**Format**: `${genus[0]}${species[0:3]}${strain}`

| **Component** | **Rule** | **Example** |
|---------------|----------|-------------|
| **Genus** | First letter, lowercase | `Fusarium` → `f` |
| **Species** | First 3 letters, lowercase | `graminearum` → `gra` |
| **Strain** | Cleaned strain identifier | `PH-1` → `PH-1` |

**Result**: `f` + `gra` + `PH-1` = `fgraPH-1`

### 4. Strain Processing

**Prefixes removed** (case-insensitive):
- `isolate `, `strain `, `breed `, `str. `

**Characters preserved as-is**:
- Dots: `strain A.1` → `A.1`
- Hyphens: `isolate K-12` → `K-12`  
- Slashes: `breed S/N` → `S/N`
- All other special characters

### 5. Reference Strain Fallback

When no strain is provided (e.g., just "Fusarium graminearum"), the system:

1. **Searches CSV** for organisms matching genus and species
2. **Filters** for entries where `is_annotated_genome=1` AND `is_reference_strain=1`
3. **Uses reference strain** to generate correct abbreviation

```
Using reference strain from CSV: Fusarium graminearum PH-1 -> PH-1
Generated: fgraPH-1
```

## Enhanced Presenter Naming

### Publication Attribution (Preferred)

When publications are found:
- **Author**: First author's last name
- **Year**: Publication year

**Example**: `fgraPH-1_Fagundes_2026_rnaSeq_RSRC`

### BioProject Fallback

When no publications are found:
- **Submitter**: Cleaned submitter organization
- **Year**: BioProject registration year

**Example**: `fgraPH-1_sichuanagr_2025_rnaSeq_RSRC`

**Submitter cleaning rules**:
- `university` → `U`
- `college` → `C`
- `institute` → `I`
- Remove special characters
- Max 10 characters

## Step-by-Step Example

### Input
```bash
node scripts/generate-presenter-xml.js PRJNA1393503 FungiDB 1
```

### Interactive Session
```
Enter organism name: Fusarium graminearum
  Looking up: Fusarium graminearum
  Not found in database
  Using reference strain from CSV: Fusarium graminearum PH-1 -> PH-1
  Generated: fgraPH-1 (f + gra + PH-1)
Use 'fgraPH-1' as organism abbreviation? [Y/n]: y
  Using: fgraPH-1

ADD TO shared/resources/organism-abbreviations.csv:
FungiDB,Fusarium graminearum,fgraPH-1,1,1,fgra
```

### Result
**DatasetPresenter Name**: `fgraPH-1_sichuanagr_2025_rnaSeq_RSRC`

## Best Practices

### For Curators

1. **Use full organism names**: Include complete genus and species
2. **Include strain when known**: Helps ensure correct abbreviation
3. **Review suggestions**: Always check generated abbreviations make sense
4. **Add to CSV**: Copy suggested CSV line to organism reference file when needed

### For Common Organisms

**When prompted for organism names**:
- Use NCBI taxonomy format: `Genus species strain`
- Check sample metadata for hints about strain/isolate
- When in doubt, check the organism reference CSV file

### Error Prevention

❌ **Don't use**:
- Abbreviated genus: `F. graminearum`
- Informal names: `baker's yeast`
- Missing species: `Homo`

✅ **Do use**:
- Full scientific names: `Saccharomyces cerevisiae`
- Include strain when available: `Saccharomyces cerevisiae S288C`
- Check spelling against NCBI taxonomy

## Troubleshooting

### "CSV lookup failed" Error
- **Cause**: Organism reference file not found
- **Solution**: Ensure `Summary of VEupathDB Organism names and abbreviations - bld70.csv` is in the dataset-curator root directory

### Unexpected Abbreviation Generated
- **Cause**: Strain information not parsed correctly
- **Solution**: Check organism name format, ensure spaces separate genus/species/strain

### Reference Strain Not Found
- **Cause**: No reference strain in CSV for this genus/species
- **Solution**: Use the generated abbreviation or manually specify strain

## Reference Files

- **Organism Database**: `Summary of VEupathDB Organism names and abbreviations - bld70.csv`
- **Valid Projects**: `resources/valid-projects.json`
- **Implementation**: `scripts/organism-utils.js`