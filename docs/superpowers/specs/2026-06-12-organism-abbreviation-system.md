# Enhanced DatasetPresenter Naming with Organism Abbreviation System

**Date**: 2026-06-12  
**Author**: Contributing Curator ebapidb  
**Target**: Enhanced datasetPresenter naming convention for RNA-seq datasets

## Overview

Implement a standardized organism abbreviation system and enhanced datasetPresenter naming convention that uses publication authors and years when available, with fallback to submitter information.

## Problem Statement

Current RNA-seq datasetPresenter names use the format `${organismAbbrev}_${bioproject}_rnaSeq_RSRC`, which:
- Doesn't follow the desired naming convention
- Lacks consistency in organism abbreviations across curators
- Doesn't leverage available publication data for attribution

## Desired Naming Convention

**Format**: `orgAbbrev_LastName_Year_rnaSeq_RSRC`

**Components**:
- `orgAbbrev`: Organism abbreviation from centralized lookup or generated using standardized logic
- `LastName`: First author's last name (from publication) OR submitter organization (fallback)
- `Year`: Publication year OR BioProject registration year (fallback)
- `rnaSeq_RSRC`: Constant suffix

**Examples**:
- `ztriIPO323_Fagundes_2026_rnaSeq_RSRC` (with publication)
- `ztriIPO323_UoE_2024_rnaSeq_RSRC` (without publication, using submitter)

## Solution: Centralized Organism Abbreviation System

### Organism Abbreviation Logic

Based on existing Perl script logic:
1. Split organism name by whitespace: genus, species, strain
2. Clean strain abbreviation by removing/replacing:
   - Remove: "isolate", "strain", "breed", "str." (case insensitive)
   - Remove: `/`, `,`, `:`
   - Replace: `#` → `-`, `.` → `-`
3. Generate: `${genus[0].toLowerCase()}${species.substring(0,3)}${cleanedStrain}`
4. Also generate orthomclAbbrev: `${genus[0].toLowerCase()}${species.substring(0,3)}`

### Centralized Reference Data

**File**: `shared/resources/organism-abbreviations.csv`

**Structure**:
```csv
project,organism_full_name,organism_abbreviation,is_annotated_genome,is_reference_strain,orthoMCL_abbrev
FungiDB,Zymoseptoria tritici IPO323,ztriIPO323,1,1,ztri
VectorBase,Anopheles gambiae PEST,agamPEST,1,1,agam
```

**Usage**: Only entries where `is_annotated_genome=1 AND is_reference_strain=1`

### Lookup and Generation Workflow

1. **Interactive Input**: Prompt curator for organism name
2. **CSV Lookup**: Search organism-abbreviations.csv for exact match
3. **Found**: Use existing abbreviation with confirmation option
4. **Not Found**: Generate using standardized logic with override option
5. **Manual Update**: Output CSV line for curator to add manually

## Technical Implementation

### Interactive Organism Input

```javascript
// Prompt for organism name
const organismName = await promptOrganism();

// Lookup in CSV
const found = lookupOrganism(csvPath, organismName);

if (found) {
  const useExisting = await confirm(`Found: ${found.abbrev}. Use this abbreviation?`);
  orgAbbrev = useExisting ? found.abbrev : await promptCustom();
} else {
  const generated = generateOrganismAbbrev(organismName);
  const useGenerated = await confirm(`Generated: ${generated.organismAbbrev}. Use this abbreviation?`);
  orgAbbrev = useGenerated ? generated.organismAbbrev : await promptCustom();
  
  // Output suggestion for manual CSV update
  console.log(`ADD TO shared/resources/organism-abbreviations.csv:`);
  console.log(`${project},${organismName},${orgAbbrev},1,1,${generated.orthomclAbbrev}`);
}
```

### Enhanced Presenter Name Generation

```javascript
// Get publication data (already implemented)
const publicationData = readPublicationData(bioproject);

// Get BioProject data for fallback
const bioprojectData = readBioprojectData(bioproject); // New requirement

let authorOrSubmitter, year;

if (publicationData.pmidCount > 0) {
  // Use first author's last name and publication year
  const firstAuthor = publicationData.publications[0].authors[0];
  authorOrSubmitter = extractLastName(firstAuthor.name);
  year = extractYear(publicationData.publications[0].pubdate);
} else {
  // Fallback to submitter organization and registration year
  authorOrSubmitter = cleanSubmitterName(bioprojectData.submitterOrganization);
  year = extractYear(bioprojectData.registrationDate);
}

const presenterName = `${orgAbbrev}_${authorOrSubmitter}_${year}_rnaSeq_RSRC`;
```

## Integration with Existing Workflow

### File Changes

**New Files**:
- `shared/resources/organism-abbreviations.csv` - Central organism reference
- BioProject fetching capability for RNA-seq tool (currently genome-only)

**Modified Files**:
- `skills/curate-bulk-rnaseq/scripts/generate-presenter-xml.js` - Interactive input and new naming logic
- Add organism abbreviation generation utilities

### Workflow Integration

1. **Step 1**: Fetch SRA metadata (existing)
2. **Step 2a**: Fetch publications (existing)
3. **Step 2b**: Interactive organism abbreviation lookup/generation (new)
4. **Step 3**: Curate contacts (existing)
5. **Step 4**: Generate presenter XML with enhanced naming (modified)

### Data Dependencies

**Required**:
- SRA metadata (organism name extraction for suggestions)
- Publication data (author names and years)
- BioProject data (submitter organization and registration date)

**Optional**:
- Organism abbreviations CSV (graceful degradation if missing)

## Benefits

### For Curators
- **Consistent abbreviations**: Eliminates duplicate/conflicting organism abbreviations
- **Smart defaults**: Automatic lookup of existing abbreviations
- **Manual control**: Always allows override of generated values
- **Publication attribution**: Proper author and year attribution in dataset names

### For VEuPathDB
- **Standardized naming**: Consistent datasetPresenter naming across all RNA-seq datasets
- **Better attribution**: Clear connection between datasets and source publications
- **Maintainable system**: Version-controlled organism reference data

### For Researchers
- **Discoverable datasets**: Meaningful names that include publication attribution
- **Clear provenance**: Easy to trace datasets back to source publications
- **Consistent naming**: Predictable naming patterns across all datasets

## Error Handling & Edge Cases

### Organism Name Parsing
- **Missing strain**: Use genus + species only
- **Complex strains**: Apply full cleaning logic from Perl script
- **Special characters**: Handle brackets, punctuation, etc.

### Publication Data
- **No authors**: Use "Unknown" as fallback
- **Missing publication year**: Extract from registration date
- **Multiple publications**: Use first publication in list

### CSV File Issues
- **Missing file**: Generate abbreviations, warn about missing reference
- **Malformed rows**: Skip silently, log warnings
- **Multiple matches**: Use first match, log warning

## Implementation Approach

1. **Bootstrap CSV**: Create initial organism-abbreviations.csv from existing Google Sheet
2. **Add BioProject fetching**: Extend RNA-seq tool to fetch BioProject metadata
3. **Implement organism utilities**: JavaScript versions of Perl logic
4. **Modify presenter generation**: Add interactive input and new naming logic
5. **Update documentation**: Add new step to workflow documentation

## Future Enhancements

- **Google Sheet sync**: Bidirectional sync between CSV file and Google Sheet
- **Fuzzy matching**: Handle typos and variations in organism names
- **Batch processing**: Handle multiple organisms in single session
- **Validation tools**: Check for duplicate abbreviations and naming conflicts