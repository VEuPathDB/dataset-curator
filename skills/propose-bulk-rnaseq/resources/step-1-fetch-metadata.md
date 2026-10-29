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
- Experiment accession (SRX...), title, library name, submission and
  release date (`first_public`)
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
      "experiment_accession": "SRX...",
      "experiment_title": "...",
      "library_name": "...",
      "submission_accession": "SRA...",
      "first_public": "YYYY-MM-DD",
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

Claude will rerun the script and parse the CSV file. The CSV may lack some
experiment fields (title, submission); `check-experiments.js` then compares
fewer fields and warns.

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

---

## Check the Experiments

```bash
node scripts/check-experiments.js <ACCESSION>
```

Runs of one SRA experiment (SRX) are one library sequenced more than once, so
Step 2 always keeps them in one sample. A BioSample is **flagged** when its
runs span two or more SRX that differ in `experiment_title`, `library_name`,
`submission_accession` or `first_public`: they may be different material
(time points, treatments, passages) under one BioSample. SRX of one BioSample
that agree on all four are not flagged; merge them, no reason needed.

It prints a table per flagged BioSample on stderr (SRX, runs, the four fields;
`*` marks the ones that differ) and the same as JSON on stdout. It only
reports, and exits 0 either way. Exit 1 means the metadata is missing or
predates experiment accessions: re-run `fetch-sra-metadata.js`.

Show the curator each flagged table. Names are evidence, not proof: a numeric
suffix can mark two time points or treatments as easily as two replicates.
Decide nothing until the publications are read.

## Find the Publications

```bash
node scripts/find-publications.js <ACCESSION>
```

For a GSE accession it reads the BioProject and GEO's PubMed IDs from
`.curation/tmp/<ACCESSION>_xref.json`. It writes
`.curation/tmp/<ACCESSION>_publications.json` with two lists. Each entry has
`pmid`, `pmcid`, `doi`, `title`, `year`, `source` (`MED` for a journal
article, `PPR` for a preprint) and `fullText` links.

- **`linked`**: papers NCBI links to the BioProject, plus GEO's PubMed IDs.
  These are confirmed.
- **`candidates`**: searched only when nothing is linked, in Europe PMC by the
  accession and then by words of the BioProject title; `foundBy` says how.
  A candidate is unconfirmed. Show the curator each one (title, year, DOI,
  `foundBy`) and ask whether it describes this BioProject. **Never treat a
  candidate as linked without their yes.**

Every confirmed PubMed ID, GEO's included, goes into `pubmedIds` in the Step 4
overrides: an override replaces the GEO list rather than adding to it. A
preprint has no PubMed ID.

### Read the Methods

When a BioSample is flagged, read each confirmed paper's Methods for how the
samples, libraries or lines were derived. **Never pull a whole paper into
context**: fetch it with a prompt that asks only for those Methods passages,
or hand it to a `general-purpose` subagent with the same request.

- With a `pmcid`, try the Europe PMC full text:
  `https://www.ebi.ac.uk/europepmc/webservices/rest/<PMCID>/fullTextXML`.
  It exists only for open-access PMC articles.
- If that fails or there is no `pmcid`, an open-access PDF from `fullText`.
  A bioRxiv preprint counts, but it may predate later runs: check the
  preprint's posting date on its page against the runs' `first_public`.
- A curator-supplied PDF was extracted above; use its `textChunks.methods`.

When nothing is readable, say so and ask the curator how the samples relate.

## Split or Merge

For each flagged BioSample, show the curator what the Methods say, then ask
them to choose:

- **split by SRX**: each SRX becomes its own sample. For passages, time
  points, treatments or derived lines.
- **merge**: one sample with all the runs. For re-sequencing of the same
  material, such as a second submission of the same RNA extract. Record the
  curator's reason: Step 2 writes it as `experimentsMerged`, and
  `write-proposal.js` refuses the merge without it.

Never choose for them. Record their answers; Step 2 needs them.

## Troubleshooting

- **No runs found**: The BioProject may not have public SRA data yet
- **Missing sample attributes**: Not all submitters provide custom attributes
- **API timeout**: NCBI may be slow; the script uses rate limiting
