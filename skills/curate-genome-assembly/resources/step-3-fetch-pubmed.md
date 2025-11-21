# Step 3: Fetch PubMed Data

## Overview

This step finds and fetches PubMed publications linked to the BioProject. These publications provide:
- PubMed IDs for the presenter XML
- Author information for contact identification

## Prerequisites

Step 2 should be completed first (the script can use the bioproject JSON to get the numeric ID).

## Command

```bash
node scripts/fetch-pubmed.js <BIOPROJECT_ACCESSION>
```

Or with numeric ID directly:

```bash
node scripts/fetch-pubmed.js <BIOPROJECT_ID>
```

## Example

```bash
node scripts/fetch-pubmed.js PRJNA282568
```

## What the Script Does

1. **elink**: Finds PubMed records linked to the BioProject in NCBI's database
2. **esummary**: Fetches details for each linked PubMed record

## Output

The script saves results to `tmp/<BIOPROJECT>_pubmed.json`:

```json
{
  "bioProjectId": "282568",
  "bioProjectAccession": "PRJNA282568",
  "pubmedCount": 1,
  "papers": [
    {
      "pmid": "29521624",
      "title": "Genome sequence of the oleaginous yeast Rhodotorula toruloides...",
      "authors": [
        {"name": "Coradetti ST", "authtype": "Author"},
        {"name": "Pinel D", "authtype": "Author"},
        {"name": "Skerker JM", "authtype": "Author"}
      ],
      "source": "Biotechnol Biofuels",
      "pubdate": "2018",
      "lastAuthor": "Skerker JM"
    }
  ]
}
```

## Key Fields

- **pmid**: PubMed ID to include in presenter XML
- **authors**: List of authors (useful for contact identification)
- **lastAuthor**: Senior/corresponding author (often the primary contact)

## No Publications Found

If no linked publications are found:
- The script creates an empty results file
- This is common for newer genomes or those without associated papers
- PubMed IDs can be added manually later if curator finds relevant publications

## Contact Identification

Use the author list to help identify contacts:
1. **lastAuthor** is typically the senior/corresponding author - good candidate for primary contact
2. For genome-specific papers, other authors may be appropriate additional contacts
3. For papers where genome is incidental to a larger study, use judgment about which authors to include

## Next Step

Proceed to [Step 4 - Curate Contacts](step-4-curate-contacts.md) to identify and create contact entries.
