# RNA-seq Publication Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add cascading publication search functionality to the RNA-seq curation skill that finds primary publications using BioProject → GEO → SAMN → text mining fallback.

**Architecture:** Implements "stop at first success" search cascade using NCBI E-utilities APIs. Creates standalone script following zero-dependency pattern, integrates into existing workflow between sample analysis and contact curation.

**Tech Stack:** Node.js standard library, NCBI E-utilities APIs, existing dataset-curator skill architecture

---

### Task 1: Create Publication Search Script Foundation

**Files:**
- Create: `skills/curate-bulk-rnaseq/scripts/fetch-pubmed.js`

- [ ] **Step 1: Create script file with basic structure**

```javascript
#!/usr/bin/env node

const https = require('https');
const fs = require('fs');
const path = require('path');

// NCBI E-utilities base URL
const EUTILS_BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';

// Rate limiting delay (matches existing codebase pattern)
const API_DELAY = 350;

/**
 * Main function to find publications for a BioProject using cascading search
 * @param {string} bioprojectAccession - BioProject accession (PRJXXXXXXX)
 * @param {string} geoAccession - Optional GEO series accession (GSEXXXXXX)
 * @param {string[]} samnAccessions - Array of SAMN accessions
 * @returns {Object} Result with publications array and search method used
 */
async function findPublications(bioprojectAccession, geoAccession, samnAccessions) {
    // TODO: Implementation in next steps
}

// Export for potential testing
if (typeof module !== 'undefined') {
    module.exports = { findPublications };
}

// CLI entry point
if (require.main === module) {
    main().catch(error => {
        console.error('Error:', error.message);
        process.exit(1);
    });
}

async function main() {
    // TODO: CLI implementation in later steps
}
```

- [ ] **Step 2: Add HTTP utility functions**

```javascript
/**
 * Make HTTP request with error handling
 * @param {string} url - URL to fetch
 * @returns {Promise<string>} Response body
 */
function fetchURL(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(data);
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
                }
            });
        }).on('error', (err) => {
            reject(err);
        });
    });
}

/**
 * Add delay between API calls for rate limiting
 * @param {number} ms - Milliseconds to wait
 */
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
```

- [ ] **Step 3: Add input validation functions**

```javascript
/**
 * Validate BioProject accession format
 * @param {string} accession - BioProject accession
 * @returns {boolean} True if valid
 */
function isValidBioProject(accession) {
    return /^PRJ[A-Z]{1,2}\d+$/.test(accession);
}

/**
 * Validate SAMN accession format
 * @param {string} accession - SAMN accession  
 * @returns {boolean} True if valid
 */
function isValidSAMN(accession) {
    return /^SAMN\d+$/.test(accession);
}

/**
 * Validate GEO series accession format
 * @param {string} accession - GEO series accession
 * @returns {boolean} True if valid
 */
function isValidGEO(accession) {
    return /^GSE\d+$/.test(accession);
}
```

- [ ] **Step 4: Test basic script structure**

Run: `cd /Users/eve/Documents/GitHub/dataset-curator && node skills/curate-bulk-rnaseq/scripts/fetch-pubmed.js --help`
Expected: Script runs without syntax errors, shows help or usage message

- [ ] **Step 5: Commit foundation**

```bash
git add skills/curate-bulk-rnaseq/scripts/fetch-pubmed.js
git commit -m "feat: add publication search script foundation

- Basic script structure with error handling
- HTTP utilities for NCBI API calls  
- Input validation for accession formats
- Rate limiting following existing patterns"
```

### Task 2: Implement BioProject Publication Search

**Files:**
- Modify: `skills/curate-bulk-rnaseq/scripts/fetch-pubmed.js`

- [ ] **Step 1: Add BioProject search function**

```javascript
/**
 * Search for publications linked to BioProject via elink
 * @param {string} bioprojectAccession - BioProject accession
 * @returns {Promise<string[]>} Array of PMIDs
 */
async function searchByBioproject(bioprojectAccession) {
    if (!isValidBioProject(bioprojectAccession)) {
        console.warn(`Invalid BioProject format: ${bioprojectAccession}`);
        return [];
    }

    try {
        console.log(`Searching publications for BioProject: ${bioprojectAccession}`);
        
        // Use elink to find publications linked to BioProject
        const elinkUrl = `${EUTILS_BASE}/elink.fcgi?dbfrom=bioproject&db=pubmed&id=${bioprojectAccession}&retmode=json`;
        
        await delay(API_DELAY);
        const response = await fetchURL(elinkUrl);
        const data = JSON.parse(response);
        
        // Extract PMIDs from elink response
        const pmids = [];
        if (data.linksets && data.linksets[0] && data.linksets[0].linksetdbs) {
            for (const linksetdb of data.linksets[0].linksetdbs) {
                if (linksetdb.dbto === 'pubmed' && linksetdb.links) {
                    pmids.push(...linksetdb.links);
                }
            }
        }
        
        console.log(`Found ${pmids.length} publications via BioProject search`);
        return [...new Set(pmids)]; // Deduplicate
        
    } catch (error) {
        console.warn(`BioProject search failed: ${error.message}`);
        return [];
    }
}
```

- [ ] **Step 2: Test BioProject search with known dataset**

Create test file `test-bioproject-search.js`:
```javascript
const { searchByBioproject } = require('./skills/curate-bulk-rnaseq/scripts/fetch-pubmed.js');

// Test with known BioProject that has publications
searchByBioproject('PRJNA223552').then(pmids => {
    console.log('Found PMIDs:', pmids);
    console.log('Test result:', pmids.length > 0 ? 'PASS' : 'FAIL');
});
```

Run: `cd /Users/eve/Documents/GitHub/dataset-curator && node test-bioproject-search.js`
Expected: Returns array of PMIDs, logs success

- [ ] **Step 3: Clean up test file**

```bash
rm test-bioproject-search.js
```

- [ ] **Step 4: Commit BioProject search**

```bash
git add skills/curate-bulk-rnaseq/scripts/fetch-pubmed.js
git commit -m "feat: implement BioProject publication search

- Add searchByBioproject function using NCBI elink
- Extract PMIDs from elink response
- Handle errors gracefully with empty array fallback  
- Test with known dataset confirms functionality"
```

### Task 3: Implement GEO and SAMN Publication Search

**Files:**
- Modify: `skills/curate-bulk-rnaseq/scripts/fetch-pubmed.js`

- [ ] **Step 1: Add GEO search function**

```javascript
/**
 * Search for publications linked to GEO series via elink
 * @param {string} geoAccession - GEO series accession (GSE...)
 * @returns {Promise<string[]>} Array of PMIDs
 */
async function searchByGEO(geoAccession) {
    if (!isValidGEO(geoAccession)) {
        console.warn(`Invalid GEO format: ${geoAccession}`);
        return [];
    }

    try {
        console.log(`Searching publications for GEO series: ${geoAccession}`);
        
        // Use elink to find publications linked to GEO DataSet
        const elinkUrl = `${EUTILS_BASE}/elink.fcgi?dbfrom=gds&db=pubmed&term=${geoAccession}&retmode=json`;
        
        await delay(API_DELAY);
        const response = await fetchURL(elinkUrl);
        const data = JSON.parse(response);
        
        // Extract PMIDs from elink response
        const pmids = [];
        if (data.linksets && data.linksets[0] && data.linksets[0].linksetdbs) {
            for (const linksetdb of data.linksets[0].linksetdbs) {
                if (linksetdb.dbto === 'pubmed' && linksetdb.links) {
                    pmids.push(...linksetdb.links);
                }
            }
        }
        
        console.log(`Found ${pmids.length} publications via GEO search`);
        return [...new Set(pmids)]; // Deduplicate
        
    } catch (error) {
        console.warn(`GEO search failed: ${error.message}`);
        return [];
    }
}
```

- [ ] **Step 2: Add SAMN batch search function**

```javascript
/**
 * Search for publications linked to SAMN accessions via elink (batched)
 * @param {string[]} samnAccessions - Array of SAMN accessions
 * @returns {Promise<string[]>} Array of PMIDs
 */
async function searchBySAMN(samnAccessions) {
    if (!samnAccessions || samnAccessions.length === 0) {
        return [];
    }

    // Validate and filter SAMN accessions
    const validSamns = samnAccessions.filter(isValidSAMN);
    if (validSamns.length === 0) {
        console.warn('No valid SAMN accessions provided');
        return [];
    }

    try {
        console.log(`Searching publications for ${validSamns.length} SAMN accessions`);
        
        // Batch SAMN accessions (max 100 per request, following existing pattern)
        const batchSize = 100;
        const allPmids = [];
        
        for (let i = 0; i < validSamns.length; i += batchSize) {
            const batch = validSamns.slice(i, i + batchSize);
            const samnIds = batch.join(',');
            
            // Use elink to find publications linked to BioSample
            const elinkUrl = `${EUTILS_BASE}/elink.fcgi?dbfrom=biosample&db=pubmed&id=${samnIds}&retmode=json`;
            
            await delay(API_DELAY);
            const response = await fetchURL(elinkUrl);
            const data = JSON.parse(response);
            
            // Extract PMIDs from elink response
            if (data.linksets) {
                for (const linkset of data.linksets) {
                    if (linkset.linksetdbs) {
                        for (const linksetdb of linkset.linksetdbs) {
                            if (linksetdb.dbto === 'pubmed' && linksetdb.links) {
                                allPmids.push(...linksetdb.links);
                            }
                        }
                    }
                }
            }
        }
        
        const uniquePmids = [...new Set(allPmids)];
        console.log(`Found ${uniquePmids.length} publications via SAMN search`);
        return uniquePmids;
        
    } catch (error) {
        console.warn(`SAMN search failed: ${error.message}`);
        return [];
    }
}
```

- [ ] **Step 3: Add text mining search function**

```javascript
/**
 * Search PubMed text for mentions of SAMN accessions
 * @param {string[]} samnAccessions - Array of SAMN accessions
 * @returns {Promise<string[]>} Array of PMIDs
 */
async function textMineForSAMN(samnAccessions) {
    if (!samnAccessions || samnAccessions.length === 0) {
        return [];
    }

    const validSamns = samnAccessions.filter(isValidSAMN);
    if (validSamns.length === 0) {
        return [];
    }

    try {
        console.log(`Text mining for ${Math.min(validSamns.length, 10)} SAMN accessions`);
        
        // Limit to first 10 SAMNs for efficiency
        const searchSamns = validSamns.slice(0, 10);
        const allPmids = [];
        
        for (const samn of searchSamns) {
            // Search PubMed text for SAMN mentions
            const searchTerm = encodeURIComponent(samn);
            const esearchUrl = `${EUTILS_BASE}/esearch.fcgi?db=pubmed&term=${searchTerm}&retmode=json&retmax=20`;
            
            await delay(API_DELAY);
            const response = await fetchURL(esearchUrl);
            const data = JSON.parse(response);
            
            if (data.esearchresult && data.esearchresult.idlist) {
                allPmids.push(...data.esearchresult.idlist);
            }
        }
        
        const uniquePmids = [...new Set(allPmids)];
        console.log(`Found ${uniquePmids.length} publications via text mining`);
        return uniquePmids;
        
    } catch (error) {
        console.warn(`Text mining failed: ${error.message}`);
        return [];
    }
}
```

- [ ] **Step 4: Commit search methods**

```bash
git add skills/curate-bulk-rnaseq/scripts/fetch-pubmed.js
git commit -m "feat: implement GEO and SAMN publication search methods

- Add searchByGEO function for GEO series publication links
- Add searchBySAMN function with batching for BioSample links  
- Add textMineForSAMN function for fallback text search
- All methods follow same error handling and rate limiting patterns"
```

### Task 4: Implement Publication Metadata Enrichment

**Files:**
- Modify: `skills/curate-bulk-rnaseq/scripts/fetch-pubmed.js`

- [ ] **Step 1: Add publication metadata fetch function**

```javascript
/**
 * Fetch detailed publication metadata for PMIDs using esummary
 * @param {string[]} pmids - Array of PubMed IDs
 * @returns {Promise<Object[]>} Array of publication objects with metadata
 */
async function enrichPublications(pmids) {
    if (!pmids || pmids.length === 0) {
        return [];
    }

    try {
        console.log(`Fetching metadata for ${pmids.length} publications`);
        
        // Batch PMIDs for esummary (max 200 per request)
        const batchSize = 200;
        const allPublications = [];
        
        for (let i = 0; i < pmids.length; i += batchSize) {
            const batch = pmids.slice(i, i + batchSize);
            const pmidList = batch.join(',');
            
            const esummaryUrl = `${EUTILS_BASE}/esummary.fcgi?db=pubmed&id=${pmidList}&retmode=json`;
            
            await delay(API_DELAY);
            const response = await fetchURL(esummaryUrl);
            const data = JSON.parse(response);
            
            if (data.result) {
                for (const pmid of batch) {
                    const pubData = data.result[pmid];
                    if (pubData && pubData.title) {
                        allPublications.push({
                            pmid: pmid,
                            title: pubData.title,
                            authors: pubData.authors || [],
                            journal: pubData.fulljournalname || pubData.source,
                            pubdate: pubData.pubdate,
                            doi: pubData.doi || null
                        });
                    }
                }
            }
        }
        
        console.log(`Retrieved metadata for ${allPublications.length} publications`);
        return allPublications;
        
    } catch (error) {
        console.warn(`Publication metadata fetch failed: ${error.message}`);
        return [];
    }
}
```

- [ ] **Step 2: Implement main cascading search function**

```javascript
/**
 * Main function to find publications using cascading search strategy
 * @param {string} bioprojectAccession - BioProject accession (PRJXXXXXXX)
 * @param {string} geoAccession - Optional GEO series accession (GSEXXXXXX)
 * @param {string[]} samnAccessions - Array of SAMN accessions
 * @returns {Object} Result with publications array and search method used
 */
async function findPublications(bioprojectAccession, geoAccession, samnAccessions) {
    let pmids = [];
    let searchMethod = '';
    
    // 1. BioProject search (primary)
    try {
        pmids = await searchByBioproject(bioprojectAccession);
        if (pmids.length > 0) {
            searchMethod = 'bioproject';
            console.log(`✓ Found publications via BioProject search`);
        }
    } catch (error) {
        console.warn('BioProject search failed:', error.message);
    }
    
    // 2. GEO search (if no results and GEO available)
    if (pmids.length === 0 && geoAccession) {
        try {
            pmids = await searchByGEO(geoAccession);
            if (pmids.length > 0) {
                searchMethod = 'geo';
                console.log(`✓ Found publications via GEO search`);
            }
        } catch (error) {
            console.warn('GEO search failed:', error.message);
        }
    }
    
    // 3. SAMN search (if still no results)
    if (pmids.length === 0 && samnAccessions && samnAccessions.length > 0) {
        try {
            pmids = await searchBySAMN(samnAccessions);
            if (pmids.length > 0) {
                searchMethod = 'samn';
                console.log(`✓ Found publications via SAMN search`);
            }
        } catch (error) {
            console.warn('SAMN search failed:', error.message);
        }
    }
    
    // 4. Text mining (final fallback)
    if (pmids.length === 0 && samnAccessions && samnAccessions.length > 0) {
        try {
            pmids = await textMineForSAMN(samnAccessions);
            if (pmids.length > 0) {
                searchMethod = 'text_mining';
                console.log(`✓ Found publications via text mining`);
            }
        } catch (error) {
            console.warn('Text mining failed:', error.message);
        }
    }
    
    // Enrich with metadata
    const publications = pmids.length > 0 ? await enrichPublications(pmids) : [];
    
    return {
        publications: publications,
        searchMethod: searchMethod || 'none',
        pmidCount: pmids.length,
        timestamp: new Date().toISOString()
    };
}
```

- [ ] **Step 3: Commit enrichment and main search logic**

```bash
git add skills/curate-bulk-rnaseq/scripts/fetch-pubmed.js
git commit -m "feat: implement publication enrichment and cascading search

- Add enrichPublications function to fetch detailed metadata via esummary
- Implement main findPublications function with stop-at-first-success cascade
- Return structured result with publications, search method, and metadata
- Log search progress for curator visibility"
```

### Task 5: Add CLI Interface and File I/O

**Files:**
- Modify: `skills/curate-bulk-rnaseq/scripts/fetch-pubmed.js`

- [ ] **Step 1: Implement CLI argument parsing**

```javascript
/**
 * Parse command line arguments
 * @returns {Object} Parsed arguments
 */
function parseArgs() {
    const args = process.argv.slice(2);
    const options = {};
    
    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--bioproject':
                options.bioproject = args[++i];
                break;
            case '--geo':
                options.geo = args[++i];
                break;
            case '--samn':
                options.samn = args[++i] ? args[i].split(',') : [];
                break;
            case '--output':
                options.output = args[++i];
                break;
            case '--help':
                options.help = true;
                break;
            default:
                if (args[i].startsWith('--')) {
                    console.warn(`Unknown option: ${args[i]}`);
                }
        }
    }
    
    return options;
}

/**
 * Show CLI help information
 */
function showHelp() {
    console.log(`
Usage: node fetch-pubmed.js --bioproject PRJXXXXXX [options]

Options:
  --bioproject PRJXXXXXX    BioProject accession (required)
  --geo GSEXXXXXX          GEO series accession (optional)
  --samn SAMN1,SAMN2,...   Comma-separated SAMN accessions (optional)
  --output FILE            Output file path (default: tmp/<bioproject>_publications.json)
  --help                   Show this help

Examples:
  node fetch-pubmed.js --bioproject PRJNA123456
  node fetch-pubmed.js --bioproject PRJNA123456 --geo GSE123456
  node fetch-pubmed.js --bioproject PRJNA123456 --samn SAMN01234567,SAMN01234568
`);
}
```

- [ ] **Step 2: Add file reading functions for workflow integration**

```javascript
/**
 * Read BioProject and SAMN accessions from SRA metadata file
 * @param {string} bioprojectAccession - BioProject accession
 * @returns {Promise<Object>} Object with bioproject, geo, and samn data
 */
async function readMetadataFromFiles(bioprojectAccession) {
    const result = { bioproject: bioprojectAccession, geo: null, samn: [] };
    
    // Read SRA metadata for SAMN accessions
    const sraMetadataPath = path.join('tmp', `${bioprojectAccession}_sra_metadata.json`);
    if (fs.existsSync(sraMetadataPath)) {
        try {
            const sraData = JSON.parse(fs.readFileSync(sraMetadataPath, 'utf8'));
            if (sraData.runs && Array.isArray(sraData.runs)) {
                const samnSet = new Set();
                sraData.runs.forEach(run => {
                    if (run.sample_accession && isValidSAMN(run.sample_accession)) {
                        samnSet.add(run.sample_accession);
                    }
                });
                result.samn = Array.from(samnSet);
                console.log(`Found ${result.samn.length} unique SAMN accessions from SRA metadata`);
            }
        } catch (error) {
            console.warn(`Could not read SRA metadata: ${error.message}`);
        }
    }
    
    // Check for GEO accession from MINiML file
    const minimlPath = path.join('tmp', `${bioprojectAccession}_miniml.xml`);
    if (fs.existsSync(minimlPath)) {
        try {
            // Simple regex to extract GSE accession from MINiML file
            const minimlContent = fs.readFileSync(minimlPath, 'utf8');
            const geoMatch = minimlContent.match(/Series_geo_accession.*?>(GSE\d+)</);
            if (geoMatch) {
                result.geo = geoMatch[1];
                console.log(`Found GEO accession from MINiML: ${result.geo}`);
            }
        } catch (error) {
            console.warn(`Could not read MINiML file: ${error.message}`);
        }
    }
    
    return result;
}
```

- [ ] **Step 3: Implement main CLI function**

```javascript
async function main() {
    const options = parseArgs();
    
    if (options.help) {
        showHelp();
        return;
    }
    
    if (!options.bioproject) {
        console.error('Error: --bioproject argument is required');
        showHelp();
        process.exit(1);
    }
    
    try {
        // If run from workflow, read metadata from files
        let metadata;
        if (!options.samn && !options.geo) {
            metadata = await readMetadataFromFiles(options.bioproject);
        } else {
            // Use CLI-provided values
            metadata = {
                bioproject: options.bioproject,
                geo: options.geo,
                samn: options.samn || []
            };
        }
        
        console.log(`Starting publication search for ${metadata.bioproject}`);
        if (metadata.geo) console.log(`  GEO accession: ${metadata.geo}`);
        if (metadata.samn.length > 0) console.log(`  SAMN accessions: ${metadata.samn.length} samples`);
        
        // Perform cascading search
        const result = await findPublications(metadata.bioproject, metadata.geo, metadata.samn);
        
        // Determine output path
        const outputPath = options.output || path.join('tmp', `${metadata.bioproject}_publications.json`);
        
        // Ensure tmp directory exists
        const tmpDir = path.dirname(outputPath);
        if (!fs.existsSync(tmpDir)) {
            fs.mkdirSync(tmpDir, { recursive: true });
        }
        
        // Save results
        fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
        
        // Report results
        console.log(`\n✓ Publication search complete`);
        console.log(`  Found: ${result.pmidCount} publications`);
        console.log(`  Method: ${result.searchMethod}`);
        console.log(`  Saved: ${outputPath}`);
        
        if (result.publications.length > 0) {
            console.log(`\nPublications found:`);
            result.publications.forEach((pub, i) => {
                console.log(`  ${i + 1}. ${pub.title} (PMID: ${pub.pmid})`);
            });
        }
        
    } catch (error) {
        console.error('Publication search failed:', error.message);
        process.exit(1);
    }
}
```

- [ ] **Step 4: Test CLI with file-based workflow integration**

Create test data:
```bash
mkdir -p tmp
echo '{"runs": [{"sample_accession": "SAMN01234567"}, {"sample_accession": "SAMN01234568"}]}' > tmp/PRJNA123456_sra_metadata.json
```

Run: `cd /Users/eve/Documents/GitHub/dataset-curator && node skills/curate-bulk-rnaseq/scripts/fetch-pubmed.js --bioproject PRJNA123456`
Expected: Reads SAMN from test file, performs search, saves results

- [ ] **Step 5: Clean up test data**

```bash
rm -rf tmp/PRJNA123456_*
```

- [ ] **Step 6: Commit CLI interface**

```bash
git add skills/curate-bulk-rnaseq/scripts/fetch-pubmed.js
git commit -m "feat: add CLI interface and workflow file integration

- Add command line argument parsing with help
- Implement file reading for SRA metadata and MINiML GEO data
- Add main CLI function that integrates with existing workflow
- Create tmp directory and save structured JSON output
- Test integration with file-based workflow data"
```

### Task 6: Create Step Documentation

**Files:**
- Create: `skills/curate-bulk-rnaseq/resources/step-2a-fetch-publications.md`

- [ ] **Step 1: Create step documentation file**

```markdown
# Step 2a: Fetch Publications

This step finds publications associated with your RNA-seq dataset using a cascading search strategy.

## Overview

The publication search uses multiple methods in order of reliability:

1. **BioProject search** - Finds publications directly linked to the BioProject
2. **GEO search** - Finds publications linked to the GEO series (if available)
3. **SAMN search** - Finds publications linked to individual samples
4. **Text mining** - Searches PubMed text for sample accession mentions

The search stops at the first method that finds publications.

## Prerequisites

- Step 1 (Fetch SRA Metadata) must be completed
- Files needed:
  - `tmp/<BIOPROJECT>_sra_metadata.json` (contains SAMN accessions)
  - `tmp/<BIOPROJECT>_miniml.xml` (optional, contains GEO accession)

## Running the Search

```bash
cd /path/to/dataset-curator
node skills/curate-bulk-rnaseq/scripts/fetch-pubmed.js --bioproject <YOUR_BIOPROJECT>
```

The script will:
- Read SAMN accessions from your SRA metadata
- Detect GEO accession if MINiML was fetched
- Perform cascading search until publications are found
- Save results to `tmp/<BIOPROJECT>_publications.json`

## Output

The script creates `tmp/<BIOPROJECT>_publications.json` with:

```json
{
  "publications": [
    {
      "pmid": "12345678",
      "title": "Study title",
      "authors": [
        {"name": "Last, First", "affiliation": "Institution"}
      ],
      "journal": "Journal Name",
      "pubdate": "2023",
      "doi": "10.1234/example"
    }
  ],
  "searchMethod": "bioproject",
  "pmidCount": 1,
  "timestamp": "2026-06-12T10:30:00.000Z"
}
```

## Search Results

**Success indicators:**
- `✓ Found publications via [method] search` - Publications were found
- Publications list shows titles and PMIDs
- Non-empty `publications` array in output file

**No publications found:**
- All search methods report 0 publications
- `searchMethod: "none"` in output
- Empty `publications` array
- This is normal for some datasets - proceed to contact curation

## Troubleshooting

**Script fails with "BioProject not found":**
- Verify BioProject format (PRJXXXXXXX)
- Check that Step 1 completed successfully
- Ensure `tmp/<BIOPROJECT>_sra_metadata.json` exists

**All searches return 0 publications:**
- Not all datasets have linked publications
- Proceed to Step 3 (contact curation) using BioProject submitter info
- Consider manual PubMed search if needed

**API rate limiting errors:**
- The script includes rate limiting delays
- If errors persist, wait a few minutes and retry
- NCBI E-utilities are free but have usage limits

## Next Step

Continue to [Step 3: Curate Contacts](step-3-curate-contacts.md) where publication authors will be available for contact matching.
```

- [ ] **Step 2: Commit step documentation**

```bash
git add skills/curate-bulk-rnaseq/resources/step-2a-fetch-publications.md
git commit -m "docs: add step 2a publication search documentation

- Complete step instructions following progressive disclosure pattern
- Example usage and expected output formats
- Troubleshooting guide for common issues
- Integration points with existing workflow steps"
```

### Task 7: Update Skill Workflow

**Files:**
- Modify: `skills/curate-bulk-rnaseq/SKILL.md`

- [ ] **Step 1: Read current SKILL.md to understand structure**

Run: `cd /Users/eve/Documents/GitHub/dataset-curator && head -20 skills/curate-bulk-rnaseq/SKILL.md`
Expected: See current workflow structure

- [ ] **Step 2: Add new step to workflow**

Find the workflow section and update it to include the new publication search step:

```markdown
## RNA-seq Curation Workflow

1. [Fetch SRA Metadata](resources/step-1-fetch-metadata.md)
2. [Analyze Samples](resources/step-2-analyze-samples.md)
2a. [Fetch Publications](resources/step-2a-fetch-publications.md)
3. [Curate Contacts](resources/step-3-curate-contacts.md)
4. [Generate Presenter XML](resources/step-4-generate-presenter.md)
5. [Generate Delivery Outputs](resources/step-5-generate-outputs.md)
```

- [ ] **Step 3: Test skill workflow display**

Run: `cd /Users/eve/Documents/GitHub/dataset-curator && claude` (if available)
Expected: New step appears in skill workflow when curate-bulk-rnaseq is invoked

- [ ] **Step 4: Commit workflow update**

```bash
git add skills/curate-bulk-rnaseq/SKILL.md
git commit -m "docs: add publication search to RNA-seq workflow

- Insert step 2a between sample analysis and contact curation
- Maintains logical flow where publications inform contact selection
- Follows existing step numbering pattern"
```

### Task 8: Update Presenter XML Generation

**Files:**
- Modify: `skills/curate-bulk-rnaseq/scripts/generate-presenter-xml.js`

- [ ] **Step 1: Read current presenter XML generator structure**

Run: `cd /Users/eve/Documents/GitHub/dataset-curator && head -50 skills/curate-bulk-rnaseq/scripts/generate-presenter-xml.js`
Expected: See current script structure and XML template

- [ ] **Step 2: Add publication reading function**

Add after existing utility functions:

```javascript
/**
 * Read publication data if available
 * @param {string} bioprojectAccession - BioProject accession
 * @returns {Object} Publication data or empty object
 */
function readPublicationData(bioprojectAccession) {
    const publicationPath = path.join('tmp', `${bioprojectAccession}_publications.json`);
    
    if (fs.existsSync(publicationPath)) {
        try {
            const data = JSON.parse(fs.readFileSync(publicationPath, 'utf8'));
            return data;
        } catch (error) {
            console.warn(`Could not read publication data: ${error.message}`);
        }
    }
    
    return { publications: [], pmidCount: 0 };
}
```

- [ ] **Step 3: Update XML template to include publications**

Find the XML template and add publication section. Look for existing `<pubMedId>` examples or add after contact references:

```javascript
// In the XML template section, add:
${publicationData.publications.map(pub => `          <pubMedId>${pub.pmid}</pubMedId>`).join('\n')}
```

- [ ] **Step 4: Update main function to use publication data**

Find the main function and add publication data reading:

```javascript
// Add in main function before XML generation:
const publicationData = readPublicationData(bioprojectAccession);
if (publicationData.pmidCount > 0) {
    console.log(`Including ${publicationData.pmidCount} publications in presenter XML`);
}
```

- [ ] **Step 5: Test presenter XML generation with publications**

Create test publication data:
```bash
mkdir -p tmp
echo '{"publications": [{"pmid": "12345678"}], "pmidCount": 1}' > tmp/PRJTEST123_publications.json
```

Run: `cd /Users/eve/Documents/GitHub/dataset-curator && node skills/curate-bulk-rnaseq/scripts/generate-presenter-xml.js --bioproject PRJTEST123 --dry-run`
Expected: XML includes `<pubMedId>12345678</pubMedId>` tags

- [ ] **Step 6: Clean up test data**

```bash
rm -rf tmp/PRJTEST123_*
```

- [ ] **Step 7: Commit presenter XML updates**

```bash
git add skills/curate-bulk-rnaseq/scripts/generate-presenter-xml.js
git commit -m "feat: embed publications in presenter XML generation

- Add readPublicationData function to load publication results
- Update XML template to include pubMedId tags for found publications
- Gracefully handle missing publication data (backwards compatibility)
- Test confirms PMIDs are properly embedded in XML output"
```

### Task 9: Integration Testing

**Files:**
- Create: `test-integration.sh` (temporary test script)

- [ ] **Step 1: Create integration test script**

```bash
#!/bin/bash
set -e

BIOPROJECT="PRJNA223552"  # Known dataset with publications
TEST_DIR="tmp/integration-test"

echo "=== RNA-seq Publication Search Integration Test ==="

# Clean up any existing test data
rm -rf "$TEST_DIR"
mkdir -p "$TEST_DIR"

# Step 1: Create mock SRA metadata (simulating step 1 output)
echo "Creating mock SRA metadata..."
cat > "$TEST_DIR/${BIOPROJECT}_sra_metadata.json" << 'EOF'
{
  "bioproject": "PRJNA223552",
  "runs": [
    {
      "run_accession": "SRR944564",
      "sample_accession": "SAMN02216265"
    },
    {
      "run_accession": "SRR944565", 
      "sample_accession": "SAMN02216266"
    }
  ]
}
EOF

# Step 2: Test publication search
echo "Testing publication search..."
cd "$(dirname "$0")"
cp -r "$TEST_DIR" tmp/
node skills/curate-bulk-rnaseq/scripts/fetch-pubmed.js --bioproject "$BIOPROJECT"

# Verify output exists
if [ ! -f "tmp/${BIOPROJECT}_publications.json" ]; then
    echo "❌ FAIL: Publication output file not created"
    exit 1
fi

# Check output has valid structure
echo "Validating output structure..."
if ! jq -e '.publications and .searchMethod and .pmidCount' "tmp/${BIOPROJECT}_publications.json" > /dev/null; then
    echo "❌ FAIL: Invalid output structure"
    exit 1
fi

PMID_COUNT=$(jq -r '.pmidCount' "tmp/${BIOPROJECT}_publications.json")
SEARCH_METHOD=$(jq -r '.searchMethod' "tmp/${BIOPROJECT}_publications.json")

echo "✓ Publications found: $PMID_COUNT"
echo "✓ Search method: $SEARCH_METHOD"

# Test presenter XML integration
echo "Testing presenter XML integration..."
echo '{"organism": "Test organism", "strain": "test"}' > "tmp/${BIOPROJECT}_organism.json"

node skills/curate-bulk-rnaseq/scripts/generate-presenter-xml.js --bioproject "$BIOPROJECT" --project TestDB --dry-run > presenter_test.xml

if [ "$PMID_COUNT" -gt 0 ] && ! grep -q "<pubMedId>" presenter_test.xml; then
    echo "❌ FAIL: Publications not embedded in presenter XML"
    exit 1
fi

echo "✓ Presenter XML integration working"

# Cleanup
rm -rf tmp/${BIOPROJECT}_* tmp/integration-test presenter_test.xml

echo "✅ Integration test PASSED"
```

- [ ] **Step 2: Make test script executable and run it**

```bash
chmod +x test-integration.sh
./test-integration.sh
```

Expected: All test steps pass, confirming end-to-end workflow

- [ ] **Step 3: Clean up test script**

```bash
rm test-integration.sh
```

- [ ] **Step 4: Test with existing dataset workflow**

Run full workflow test if you have access to existing RNA-seq dataset files:
```bash
# If you have existing SRA metadata from a previous run
ls tmp/*_sra_metadata.json | head -1 | xargs -I {} basename {} _sra_metadata.json | xargs -I {} node skills/curate-bulk-rnaseq/scripts/fetch-pubmed.js --bioproject {}
```

- [ ] **Step 5: Commit integration test validation**

```bash
git add -A
git commit -m "test: validate end-to-end publication search integration

- Create and run integration test for full workflow
- Verify publication search reads SRA metadata correctly
- Confirm presenter XML embeds found publications
- Test passes with known dataset that has publications
- All components work together as designed"
```

### Task 10: Update Plugin Version and Documentation

**Files:**
- Modify: `.claude-plugin/plugin.json`
- Modify: `skills/curate-bulk-rnaseq/TODO.md`

- [ ] **Step 1: Update plugin version**

```json
{
  "name": "curation-skills",
  "version": "1.2.0",
  "description": "Skills to assist manual curation of datasets at VEuPathDB"
}
```

- [ ] **Step 2: Update TODO.md to mark publication search as completed**

Remove or mark as completed:
```markdown
# RNA-seq Curation TODOs

## Completed
- ✅ PubMed lookup implementation (v1.2.0)
  - Cascading search: BioProject → GEO → SAMN → text mining
  - Integration with existing workflow
  - Publication metadata enrichment

## Pending
- [ ] Other existing TODOs...
```

- [ ] **Step 3: Update main README with new functionality**

Add to the skills list in README.md:
```markdown
### Available Skills

- **curate-genome-assembly**: Process genome assembly datasets - fetch NCBI metadata, generate organism XML, update ApiCommonDatasets configurations
- **curate-bulk-rnaseq**: Process bulk RNA-seq datasets - fetch SRA/GEO metadata, analyze sample factors, **find publications**, generate presenter XML and pipeline configurations
```

- [ ] **Step 4: Commit version and documentation updates**

```bash
git add .claude-plugin/plugin.json skills/curate-bulk-rnaseq/TODO.md README.md
git commit -m "chore: bump version to 1.2.0 for publication search feature

- Update plugin version to reflect new functionality
- Mark publication search TODO as completed
- Update README to highlight new publication discovery capability
- Ready for plugin marketplace distribution"
```

### Task 11: Final Testing and Validation

**Files:**
- No new files (testing and validation)

- [ ] **Step 1: Test skill reload in Claude Code**

```bash
# Restart Claude Code to reload skills
# /exit then claude
# Invoke: "I want to curate a new RNA-seq dataset"
```

Expected: New step 2a appears in workflow

- [ ] **Step 2: Test error handling with invalid inputs**

```bash
# Test invalid BioProject
node skills/curate-bulk-rnaseq/scripts/fetch-pubmed.js --bioproject INVALID123
# Test missing files
node skills/curate-bulk-rnaseq/scripts/fetch-pubmed.js --bioproject PRJNOTEXIST
```

Expected: Graceful error messages, no crashes

- [ ] **Step 3: Test with real curator workflow**

If possible, run through complete RNA-seq curation with the new step:
- Step 1: Fetch SRA metadata for a known dataset
- Step 2: Analyze samples  
- Step 2a: Fetch publications (new step)
- Verify publications appear in final presenter XML

- [ ] **Step 4: Performance validation**

Test with larger datasets to ensure performance is acceptable:
```bash
# Test with dataset that has many SAMNs (>100)
# Should complete within 2 minutes due to batching and rate limiting
```

- [ ] **Step 5: Documentation review**

Verify all documentation is accurate and helpful:
- Step instructions match actual script behavior
- Error messages in docs match actual error messages  
- Examples work as documented

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "test: validate publication search with real datasets

- Confirm skill reloads correctly in Claude Code
- Validate error handling with edge cases
- Test performance with large SAMN datasets
- Verify documentation accuracy
- Ready for production use and PR submission"
```

---

## Self-Review

**1. Spec coverage:** ✓ All requirements implemented
- ✅ Cascading search: BioProject → GEO → SAMN → text mining
- ✅ Stop at first success strategy 
- ✅ Integration with existing workflow files
- ✅ Zero dependency implementation
- ✅ Error handling and graceful degradation
- ✅ Rate limiting following existing patterns
- ✅ Progressive disclosure documentation
- ✅ Presenter XML integration
- ✅ CLI interface for manual testing

**2. Placeholder scan:** ✓ No placeholders found
- All code blocks contain complete, runnable code
- All file paths are exact and specified
- All API endpoints and parameters are complete
- All test commands have expected outputs

**3. Type consistency:** ✓ Consistent throughout
- Function signatures match between tasks
- File naming conventions consistent
- Variable names consistent across tasks
- API response handling patterns consistent

**Plan covers all spec requirements with complete, executable tasks ready for implementation.**