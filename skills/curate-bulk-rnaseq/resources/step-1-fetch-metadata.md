# Step 1: Fetch SRA Metadata

## Overview

This step fetches run-level metadata from ENA and sample attributes from NCBI BioSample for the specified BioProject.

## Command

```bash
node scripts/fetch-sra-metadata.js <BIOPROJECT>
```

Replace `<BIOPROJECT>` with the accession (e.g., `PRJNA1018599`).

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

The JSON file is saved to `tmp/<BIOPROJECT>_sra_metadata.json`:

```json
{
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
3. Save as: `tmp/<BIOPROJECT>_SraRunTable.csv` in your curation workspace directory (which should also be the current directory)
4. Tell Claude "I downloaded the CSV for you here: tmp/<BIOPROJECT>_SraRunTable.csv"

Claude will rerun the script and parse the CSV file.

---

## Optional: Fetch MINiML for GEO-linked Datasets

If the BioProject is linked to a GEO Series (GSE), fetch the MINiML XML for richer descriptions:

```bash
node scripts/fetch-miniml.js <BIOPROJECT>
```

### Output

- **Success**: Prints GSE accession, saves `tmp/<GSE>_family.xml`
- **No GEO link**: Prints `NO_GEO_LINK` (this is OK - many datasets aren't in GEO)

The MINiML file contains:
- Series title and summary
- Sample descriptions and characteristics
- Platform information
- Contributor details

---

## Optional: Extract PDF Data

If the curator has provided a journal article PDF at `tmp/<BIOPROJECT>_article.pdf`, Claude should read and extract key information for use in later steps.

### Check for PDF

Ask the curator if they have a PDF available. If yes, confirm the file exists at `tmp/<BIOPROJECT>_article.pdf`.

### PDF Extraction Process

1. **Read the PDF** using the Read tool
2. **Extract structured data** into the JSON schema below
3. **Save to** `tmp/<BIOPROJECT>_pdf_extracted.json`

### Output Schema

The JSON output **must include** the required fields below at these exact paths. Downstream scripts depend on this structure. You may add additional fields as useful, but the required fields must be present.

**Required fields** (scripts depend on these paths):
- `extracted.strandedness` - Used by `generate-samplesheet.js`
- `extracted.authors[]` - Used by Step 3 contact curation
- `textChunks.abstract` - Used by Step 4 description generation
- `textChunks.methods` - Used by Step 4 methodology generation

```json
{
  "bioproject": "PRJNA1018599",
  "pdfSource": "tmp/PRJNA1018599_article.pdf",
  "extracted": {
    "strandedness": "stranded|unstranded|unknown",
    "libraryPrepProtocol": "TruSeq Stranded mRNA",
    "authors": [
      {
        "name": "Full Name",
        "affiliation": "University/Institute",
        "role": "corresponding|first|senior|other",
        "isLikelyDataSubmitter": true
      }
    ]
  },
  "textChunks": {
    "abstract": "Full abstract text...",
    "methods": "Relevant methods section text (RNA extraction, library prep, sequencing)...",
    "introConclusion": "Final paragraph of introduction summarizing the study goals...",
    "authorAffiliations": "Full author list with affiliations as printed..."
  }
}
```

**Optional additional fields**: Feel free to add other useful extracted data (article metadata, conditions, organism info, etc.) as top-level or nested fields.

### Extracting Strandedness

Look in the Methods section for library preparation details:

| Protocol/Kit | Strandedness |
|--------------|--------------|
| TruSeq Stranded | `stranded` |
| NEBNext Ultra II Directional | `stranded` |
| dUTP method | `stranded` |
| SMARTer Stranded | `stranded` |
| TruSeq (non-stranded) | `unstranded` |
| Unclear/not mentioned | `unknown` |

**Note**: Most RNA-seq from 2016+ is stranded. If the paper mentions "strand-specific" or uses a directional protocol, use `stranded`.

### Identifying Author Roles

- **Corresponding author**: Usually marked with `*` or email - often the PI
- **First author**: Often the person who did the experiments
- **Senior/last author**: Often the PI if different from corresponding
- **Data submitter**: May be mentioned in acknowledgments or data availability section

Cross-reference authors with GEO contributors or BioProject submitters to identify who likely submitted the data.

### Example Extraction

For a paper titled "Transcriptome analysis of tick hemocytes during Babesia infection":

```json
{
  "bioproject": "PRJNA1018599",
  "pdfSource": "tmp/PRJNA1018599_article.pdf",

  "extracted": {
    "strandedness": "stranded",
    "libraryPrepProtocol": "TruSeq Stranded mRNA Library Prep Kit",
    "authors": [
      {
        "name": "Jane Smith",
        "affiliation": "Department of Entomology, State University",
        "role": "first",
        "isLikelyDataSubmitter": true
      },
      {
        "name": "John Doe",
        "affiliation": "Department of Entomology, State University",
        "role": "corresponding",
        "isLikelyDataSubmitter": false
      }
    ]
  },

  "textChunks": {
    "abstract": "Tick-borne diseases pose significant threats... This study examines transcriptional changes in R. microplus hemocytes during B. bigemina infection...",
    "methods": "Total RNA was extracted using TRIzol reagent. Libraries were prepared using TruSeq Stranded mRNA Library Prep Kit (Illumina) and sequenced on HiSeq 2500...",
    "introConclusion": "To better understand tick immune responses to Babesia infection, we performed RNA-seq analysis of hemocytes from infected and uninfected R. microplus ticks at multiple timepoints.",
    "authorAffiliations": "Jane Smith1*, John Doe1. 1Department of Entomology, State University, City, Country. *Corresponding author: jdoe@university.edu"
  },

  "article": {
    "title": "Transcriptome analysis of tick hemocytes during Babesia infection",
    "journal": "Parasites & Vectors",
    "year": 2025,
    "doi": "10.1186/s13071-025-06662-w"
  },
  "organism": "Rhipicephalus microplus",
  "conditions": ["B. bovis-infected", "B. bigemina-infected", "Uninfected control"]
}
```

Note: The `extracted` and `textChunks` sections contain the **required** fields. The `article`, `organism`, and `conditions` fields are examples of **optional additions** that provide useful context.

## Troubleshooting

- **No runs found**: The BioProject may not have public SRA data yet
- **Missing sample attributes**: Not all submitters provide custom attributes
- **API timeout**: NCBI may be slow; the script uses rate limiting
