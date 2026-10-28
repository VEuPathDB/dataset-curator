# Step 1: Fetch SRA Metadata and Check the Libraries

## Fetch

```bash
node scripts/fetch-sra-metadata.js <ACCESSION> --no-geo
```

`--no-geo` skips the GEO cross-check, which does not apply to DNA-seq.

The script queries two APIs and merges the results into
`.curation/tmp/<ACCESSION>_sra_metadata.json`:

### ENA Portal API
- Run accessions (SRR...)
- Sample accessions (SAMN...)
- Library layout (PAIRED/SINGLE)
- Library strategy, source, selection
- Instrument platform and model
- Read and base counts
- Scientific name and taxonomy ID

### NCBI BioSample API
- Sample attributes: strain, isolate, host, geographic location, collection
  date and whatever else the submitter recorded. Step 2 builds the factors
  from these.

```json
{
  "accession": "PRJNA123456",
  "bioproject": "PRJNA123456",
  "source": "ENA+BioSample",
  "runCount": 12,
  "runs": [
    {
      "run_accession": "SRR1234567",
      "sample_accession": "SAMN1234567",
      "sample_title": "...",
      "library_layout": "PAIRED",
      "library_strategy": "WGS",
      "library_source": "GENOMIC",
      "library_selection": "RANDOM",
      "instrument_model": "Illumina NovaSeq 6000",
      "read_count": 12000000,
      "base_count": 3600000000,
      "scientific_name": "<species>",
      "sample_attributes": { "strain": "...", "geo_loc_name": "...", "host": "..." }
    }
  ]
}
```

## Manual CSV Fallback

If the API fetch fails, explain to the curator that they should manually access the SRA Run Selector as follows:

1. Go to: `https://www.ncbi.nlm.nih.gov/Traces/study/?acc=<BIOPROJECT>`
2. Click the **Metadata** button to download `SraRunTable.csv`
3. Save as: `.curation/tmp/<BIOPROJECT>_SraRunTable.csv` in the curation workspace directory (the current directory)
4. Tell Claude "I downloaded the CSV for you here: .curation/tmp/<BIOPROJECT>_SraRunTable.csv"

Claude re-runs the script, which parses the CSV. The library checks need each
run's library source, read count and base count; a CSV without them fails the
checks on every run.

## Check the libraries

```bash
node scripts/check-library.js <ACCESSION>
```

It prints each problem on stderr as `Error: ...` or `Warning: ...`, and the
same lists as JSON on stdout.

| Check | Result |
|---|---|
| No runs | Hard stop |
| A run with `read_count` or `base_count` 0 or missing | Hard stop |
| `library_source` not `GENOMIC` | Hard stop |
| `library_strategy` not `WGS` | Warning |
| `library_selection` is an RNA selection (PolyA, cDNA, Oligo-dT, ...) | Warning |
| Mean read length over 300 bp on an Illumina instrument | Warning |
| Fewer than 1,000,000 reads in a BioSample | Warning |

**Exit 1 is a hard stop.** Report every `Error:` line to the curator and stop
the workflow. The proposal cannot be written: `write-proposal.js` runs the same
hard stops and refuses.

**Warnings are the curator's call.** Relay every `Warning:` line verbatim, then
for each warned run (or BioSample, for low depth) ask the curator to either:

- **drop** it: leave its runs out of the Step 2 annotations, or
- **accept** it: keep it as it is.

Never drop or accept on their behalf. Record their answers; Step 2 needs them.

## Troubleshooting

- **No runs found**: The BioProject may not have public SRA data yet
- **Missing sample attributes**: Not all submitters provide custom attributes
- **API timeout**: NCBI may be slow; the script uses rate limiting
