# Step 1: Fetch SRA Metadata

## Overview

This step fetches run-level metadata from ENA and sample attributes from NCBI BioSample for the proposal's BioProject.

## Command

```bash
node scripts/fetch-sra-metadata.js <ACCESSION>
```

Replace `<ACCESSION>` with the proposal accession (e.g., `PRJNA1018599` or `GSE243493`).

## Example

```bash
node scripts/fetch-sra-metadata.js PRJNA1018599
```

## What This Fetches

The script queries two APIs and merges the results:

### ENA Portal API
- Run accessions (SRR...)
- Sample accessions (SAMN...)
- Library layout (PAIRED/SINGLE)
- Library strategy, source, selection
- Instrument platform and model
- Read and base counts
- Scientific name and taxonomy ID

### NCBI BioSample API
- Custom sample attributes (infection status, tissue, timepoint, etc.)
- These are the experimental factors that vary between samples

## Expected Output

The JSON file is saved to `.curation/tmp/<ACCESSION>_sra_metadata.json`:

```json
{
  "accession": "PRJNA1018599",
  "bioproject": "PRJNA1018599",
  "fetchDate": "2025-11-23T...",
  "source": "ENA+BioSample",
  "runCount": 24,
  "runs": [
    {
      "run_accession": "SRR26104233",
      "sample_accession": "SAMN37446236",
      "sample_alias": "GSM7789499",
      "library_layout": "PAIRED",
      "library_strategy": "RNA-Seq",
      "instrument_model": "Illumina HiSeq 2500",
      "read_count": 11294392,
      "scientific_name": "Rhipicephalus microplus",
      "sample_attributes": {
        "infection": "Babesia infected",
        "tissue": "hemolymph",
        "cell_type": "hemocyte"
      }
    }
  ]
}
```

## Manual CSV Fallback

If the API fetch fails, explain to the curator user that they should manually access the SRA Run Selector as follows:

1. Go to: `https://www.ncbi.nlm.nih.gov/Traces/study/?acc=<BIOPROJECT>`
2. Click the **Metadata** button to download `SraRunTable.csv`
3. Save as: `.curation/tmp/<BIOPROJECT>_SraRunTable.csv` in your curation workspace directory (which should also be the current directory)
4. Tell Claude "I downloaded the CSV for you here: .curation/tmp/<BIOPROJECT>_SraRunTable.csv"

Claude will rerun the script and parse the CSV file.

---

## GEO Cross-check

The MINiML for the GEO series was downloaded in Step 0 by
`resolve-accessions.js`; there is no separate GEO fetch. For a GSE accession,
`fetch-sra-metadata.js` reads the BioProject from
`.curation/tmp/<ACCESSION>_xref.json` and refuses without it.

When there is a series, the output's `geoCrossCheck` compares GEO's GSM
samples with the runs' `sample_alias` values. Show the curator any
`missingFromSra` (GEO samples with no runs) or `missingFromGeo` (runs from
another series) before Step 2, and use both sources there: GEO
characteristics and descriptions often name factors BioSample omits.

---

## Optional: Extract PDF Data

**STOP: Do NOT read the PDF or pdf-extraction.md yourself.** Both will consume your context.

**You MUST use the Task tool** with these parameters:
- **subagent_type**: `general-purpose`
- **prompt**: `Read the PDF at .curation/tmp/<ACCESSION>_article.pdf and extract structured data following the instructions and schema in resources/pdf-extraction.md. On success only, save to .curation/tmp/<ACCESSION>_pdf_extracted.json. Return a brief summary: strandedness, author count, and whether Author Contributions section was found.`

**Output (on success):** `.curation/tmp/<ACCESSION>_pdf_extracted.json`

## Troubleshooting

- **No runs found**: The BioProject may not have public SRA data yet
- **Missing sample attributes**: Not all submitters provide custom attributes
- **API timeout**: NCBI may be slow; the script uses rate limiting
