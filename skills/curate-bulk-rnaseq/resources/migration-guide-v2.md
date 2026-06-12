# Migration Guide: Enhanced Organism Abbreviation System v2.0

This guide explains the changes in the enhanced organism abbreviation system for RNA-seq dataset curation.

## What Changed

### 🎯 Enhanced DatasetPresenter Naming Convention

**Before (v1.x):**
```
${organismAbbrev}_${bioproject}_rnaSeq_RSRC
agamPEST_PRJNA1018599_rnaSeq_RSRC
```

**After (v2.0):**
```
${orgAbbrev}_${Author}_${Year}_rnaSeq_RSRC
agamPEST_Smith_2024_rnaSeq_RSRC
```

### 🔄 Interactive Organism Input

**Before:**
- Manual organism abbreviation input
- Inconsistent abbreviations across curators  
- No validation against reference database

**After:**
- Interactive organism name prompt
- Automatic CSV lookup for existing abbreviations
- Standardized abbreviation generation with reference strain fallback

### 📚 Publication-Based Attribution

**Before:**
- Always used BioProject accession in name
- No author/publication attribution

**After:**
- **Preferred**: First author last name + publication year
- **Fallback**: Submitter organization + registration year when no publications found

### 🧬 Enhanced Strain Processing

**Before:**
- Character replacements: `A.1` → `A-1`
- Inconsistent strain handling

**After:**
- Preserve original characters: `strain A.1` → `A.1` 
- Remove only common prefixes: `isolate`, `strain`, `breed`, `str.`

## New Workflow

### Step 1: Enhanced Publication Search

New cascading publication search:

1. **BioProject** → Search publications linked to BioProject
2. **GEO Series** → Search GEO-linked publications (if available)
3. **SAMN Accessions** → Search publications via sample accessions
4. **Text Mining** → Search publication abstracts for accession mentions

### Step 2: Interactive Organism Input

When running `generate-presenter-xml.js`, you'll see:

```bash
$ node scripts/generate-presenter-xml.js PRJNA1393503 FungiDB 1

Enter organism name: Fusarium graminearum
  Looking up: Fusarium graminearum  
  Not found in database
  Using reference strain from CSV: Fusarium graminearum PH-1 -> PH-1
  Generated: fgraPH-1 (f + gra + PH-1)
Use 'fgraPH-1' as organism abbreviation? [Y/n]: y
  Using: fgraPH-1
```

### Step 3: Enhanced Presenter Generation

The system automatically generates names like:

- **With publication**: `fgraPH-1_Fagundes_2026_rnaSeq_RSRC`  
- **Without publication**: `fgraPH-1_sichuanagr_2025_rnaSeq_RSRC`

## Migration Steps for Existing Users

### 1. Update Repository

```bash
# Pull latest changes
git pull origin main

# Switch to new branch for testing
git checkout -b test-enhanced-abbreviations
```

### 2. Ensure CSV File Available  

Verify the organism reference file exists:
```bash
ls "Summary of VEupathDB Organism names and abbreviations - bld70.csv"
```

If missing, contact your coordinator to obtain the latest organism reference data.

### 3. Test with Sample Dataset

Run the enhanced workflow on a test dataset:

```bash
# Fetch metadata
node scripts/fetch-sra-metadata.js PRJNA1393503
node scripts/fetch-pubmed.js --bioproject PRJNA1393503  
node scripts/fetch-bioproject.js PRJNA1393503

# Test enhanced presenter generation
node scripts/generate-presenter-xml.js PRJNA1393503 FungiDB test-contact
```

### 4. Compare Results

**Check the generated presenter name format:**
- ✅ Should follow `orgAbbrev_Author_Year_rnaSeq_RSRC`
- ✅ Organism abbreviation should include strain (e.g., `fgraPH-1`)
- ✅ Author/year attribution when publications found

## Key Benefits

### 🎯 **Consistency**
- Standardized organism abbreviations across all curators
- Centralized organism reference database
- Validated abbreviation generation rules

### 📖 **Attribution**  
- Proper credit to publication authors
- Clear provenance with publication years
- Meaningful dataset names for researchers

### 🔍 **Discoverability**
- Dataset names include publication context
- Easy to trace datasets back to source papers
- Better search and browsing experience

### 🛠️ **Maintainability**
- Version-controlled organism reference data
- Consistent naming patterns
- Reduced manual errors

## Troubleshooting

### "CSV lookup failed" Error

**Problem**: `CSV lookup failed: ENOENT: no such file or directory`

**Solution**: Ensure the organism reference CSV file is available:
```bash
# Check if file exists
ls "Summary of VEupathDB Organism names and abbreviations - bld70.csv"

# If missing, contact coordinator for latest file
```

### Generated Abbreviation Looks Wrong

**Problem**: Abbreviation doesn't match expected format

**Solutions**:
1. **Check organism name spelling**: Use exact NCBI taxonomy format
2. **Include strain information**: Add strain to organism input
3. **Override if needed**: Choose custom abbreviation when prompted

### No Publications Found

**Expected behavior**: System falls back to BioProject submitter data

**Result**: Names like `orgAbbrev_sichuanagr_2025_rnaSeq_RSRC`

**This is normal** for datasets without associated publications.

### Strain Characters Changed

**Before v2.0**: `strain A.1` became `strainA-1` 

**After v2.0**: `strain A.1` becomes `A.1`

**This is intended** - special characters are now preserved for better strain identification.

## Getting Help

- **Organism Abbreviation Issues**: See [Organism Abbreviation Guide](organism-abbreviation-guide.md)
- **General Workflow**: See main [SKILL.md](../SKILL.md) 
- **Step-by-Step**: See [Step 4 - Generate Presenter](step-4-generate-presenter.md)

## Backward Compatibility

### Existing Datasets

- **No changes required** for existing datasetPresenter entries
- **New datasets** will use enhanced naming convention
- **Mixed naming** is acceptable during transition period

### Script Interface

- **Same command structure**: `generate-presenter-xml.js` arguments unchanged
- **Added interactivity**: New organism input prompt
- **Same outputs**: XML format and structure remain compatible

## Version History

| Version | Changes | Date |
|---------|---------|------|
| **v2.0** | Enhanced organism abbreviation system, publication attribution | 2026-06-12 |
| v1.x | Original organism abbreviation system | 2024-2025 |