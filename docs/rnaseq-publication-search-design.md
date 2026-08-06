# RNA-seq Publication Search Enhancement Design

**Date**: 2026-06-12  
**Author**: Contributing Curator ebapidb  
**Target**: curate-bulk-rnaseq skill enhancement

## Overview

Implement cascading publication search for the RNA-seq curation skill to find the primary publication associated with datasets. This addresses the current TODO for PubMed lookup in the bulk RNA-seq workflow.

## Problem Statement

The curate-bulk-rnaseq skill currently lacks publication search functionality, making it difficult for curators to:
- Find the primary publication for contact curation
- Identify relevant authors for the contact database
- Ensure proper attribution in dataset presenter XML

## Solution: Cascading Publication Search

### Search Strategy

**"Stop at first success" cascade focused on finding primary publication:**

1. **BioProject search** (primary) → Stop if publications found
2. **GEO search** (if GEO accession available) → Stop if publications found  
3. **SAMN search** (if previous methods failed) → Stop if publications found
4. **Text mining** (final fallback) → Search PubMed text for SAMN mentions

### Rationale

- **BioProject links** are most likely to contain the main study publication
- **GEO series** are often linked to the primary publication that deposited the data
- **SAMN searches** may find sample-specific publications but primary is usually at project level
- **Text mining** is computationally intensive so only used as last resort

## Technical Implementation

### New Files

```
skills/curate-bulk-rnaseq/
├── scripts/
│   └── fetch-pubmed.js               # NEW - Publication search script
└── resources/
    └── step-2a-fetch-publications.md # NEW - Step instructions
```

### Modified Files

```
skills/curate-bulk-rnaseq/
├── SKILL.md                          # UPDATE - Add workflow step
└── scripts/
    └── generate-presenter-xml.js     # UPDATE - Embed found PMIDs
```

### Script Architecture

**Main Function**: `fetch-pubmed.js`
```javascript
async function findPublications(bioprojectAccession, geoAccession, samnAccessions)

// Search methods (executed in order until success)
async function searchByBioproject(accession)     // E-utilities elink: bioproject→pubmed  
async function searchByGEO(gseAccession)        // E-utilities elink: gds→pubmed
async function searchBySAMN(samnList)           // E-utilities elink: biosample→pubmed
async function textMineForSAMN(samnList)        // PubMed esearch with SAMN terms

// Utility functions
async function enrichPublications(pmids)        // esummary to get full metadata
function deduplicatePMIDs(results)             // Remove duplicates
```

### API Usage

- **NCBI E-utilities base**: `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/`
- **No API key required** (follows existing codebase pattern)
- **Rate limiting**: 350ms delays between requests (matches existing scripts)
- **Error handling**: Graceful failure with empty arrays, not fatal errors

### Data Flow

1. **Input**: Read `tmp/<BIOPROJECT>_sra_metadata.json` for SAMN accessions and BioProject
2. **GEO Detection**: Check if `tmp/<BIOPROJECT>_miniml.xml` exists for GEO accession  
3. **Search Cascade**: Execute methods in order until publications found
4. **Output**: Save `tmp/<BIOPROJECT>_publications.json` with PMID metadata

## Integration with Existing Workflow

### Updated Skill Workflow

```markdown
## RNA-seq Curation Workflow
1. [Fetch SRA Metadata](resources/step-1-fetch-metadata.md)
2. [Analyze Samples](resources/step-2-analyze-samples.md)  
2a. [Fetch Publications](resources/step-2a-fetch-publications.md)  # NEW STEP
3. [Curate Contacts](resources/step-3-curate-contacts.md)
4. [Generate Presenter XML](resources/step-4-generate-presenter.md)
5. [Generate Delivery Outputs](resources/step-5-generate-outputs.md)
```

### File Dependencies

- **Before**: Step 2 produces `tmp/<BIOPROJECT>_sra_metadata.json` with SAMN accessions
- **Optional**: `tmp/<BIOPROJECT>_miniml.xml` if GEO data was fetched
- **After**: Step 3 can use publication authors from `tmp/<BIOPROJECT>_publications.json`

## Design Principles Compliance

### Zero Dependencies
- Uses only Node.js standard library (no npm dependencies)
- Follows existing codebase security philosophy
- Templates inlined as JavaScript template literals

### Progressive Disclosure
- SKILL.md updated with concise step link
- Detailed instructions in separate `resources/step-2a-fetch-publications.md`
- Keeps initial skill context small

### Error Handling & Robustness

**Cascading Failure Handling**:
```javascript
// Each search method fails gracefully
try {
  publications = await searchByBioproject(bioproject);
  if (publications.length > 0) {
    return { publications, searchMethod: 'bioproject' };
  }
} catch (error) {
  console.warn('BioProject search failed:', error.message);
  // Continue to next method
}
```

**Input Validation**:
- BioProject format: `^PRJ[A-Z]{1,2}\d+$`
- SAMN format: `^SAMN\d+$`
- GEO format: `^GSE\d+$`
- File existence checks before reading

**Graceful Degradation**:
- No publications found → Save empty JSON file, workflow continues
- API failures → Log warnings, don't stop execution
- Missing input files → Use available data sources

## Testing Strategy

### Validation Test Cases

| Scenario | Expected Behavior |
|----------|------------------|
| BioProject finds publications | Stop at step 1, save publications |
| BioProject empty, GEO finds publications | Continue to GEO, find publications, stop |
| BioProject + GEO empty, SAMN finds publications | Continue to SAMN, find publications |
| All structured methods empty | Continue to text mining |
| No publications found anywhere | Save empty JSON, workflow continues |
| API failures | Log warnings, continue to next method |

### Success Metrics

- **Primary publication identification**: Successfully finds main study publication
- **No false positives**: Publications are actually related to the dataset  
- **Performance**: Completes within reasonable time (< 2 minutes)
- **Robustness**: Handles API failures gracefully without stopping workflow

## Implementation Benefits

### For Curators
- **Automated publication discovery**: Reduces manual PubMed searching
- **Reliable contact sources**: Authors available for contact curation
- **Complete attribution**: Proper citations in dataset presenter XML

### For VEuPathDB
- **Consistent metadata**: Standardized publication linking across RNA-seq datasets
- **Quality improvement**: More complete dataset documentation
- **Workflow efficiency**: Streamlined curation process

### For Researchers
- **Proper attribution**: Clear links between datasets and source publications
- **Research discoverability**: Bidirectional links between data and papers
- **Context**: Understanding the biological context of datasets

## Future Enhancements

### Potential Extensions
- **Publication relevance scoring**: Rank multiple publications by relevance
- **Citation analysis**: Find papers that cite the dataset
- **Cross-database linking**: Integrate with additional publication databases

### Monitoring
- **Success rate tracking**: Monitor which search methods are most effective
- **Manual curator feedback**: Track when curators override automated results
- **API performance**: Monitor NCBI E-utilities response times and failures

## Conclusion

This enhancement transforms the RNA-seq curation workflow from manual publication discovery to an automated, reliable cascade that efficiently finds primary publications while maintaining robust error handling. The implementation follows all existing codebase patterns and integrates seamlessly with the current skill architecture.

The cascading approach prioritizes the most reliable data sources (structured database links) while providing comprehensive fallback mechanisms, ensuring curators can complete their work even when primary methods fail.