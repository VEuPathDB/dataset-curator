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
