# Step 2b: Fetch BioProject Metadata

This step fetches BioProject metadata to get submitter organization and registration date for fallback attribution.

## Overview

When publications are not available, the enhanced presenter naming uses submitter information from the BioProject as fallback attribution.

## Command

```bash
node scripts/fetch-bioproject.js <BIOPROJECT>
```

Replace `<BIOPROJECT>` with the accession (e.g., `PRJNA1018599`).

## Example

```bash
node scripts/fetch-bioproject.js PRJNA1018599
```

## What This Fetches

- **BioProject title and description**
- **Submitter organization** - Used for fallback attribution
- **Registration date** - Used for fallback year
- **Organism information** - Additional metadata

## Expected Output

The JSON file is saved to `tmp/<BIOPROJECT>_bioproject.json`:

```json
{
  "accession": "PRJNA1018599",
  "id": "1018599",
  "title": "RNA-seq of Rhipicephalus microplus...",
  "description": "Comparative transcriptome...",
  "organism": "Rhipicephalus microplus",
  "submitterOrganization": "University of São Paulo",
  "registrationDate": "2023-01-15"
}
```

## Integration

This data is automatically used by the presenter XML generation step when:
- No publications are found for the dataset
- Fallback attribution is needed for presenter naming

---

**Next Step:** [Step 3: Curate Contacts](step-3-curate-contacts.md)