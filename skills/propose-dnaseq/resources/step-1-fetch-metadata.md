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
- Experiment accession (SRX...), title, library name, submission and
  release date (`first_public`)
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
      "experiment_accession": "SRX1234567",
      "experiment_title": "...",
      "library_name": "...",
      "submission_accession": "SRA123456",
      "first_public": "2021-07-04",
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
checks on every run. The CSV may lack some experiment fields (title,
submission); `check-experiments.js` then compares fewer fields and warns.

## Check the libraries

```bash
node scripts/check-library.js <ACCESSION>
```

It prints each problem on stderr as `Error: ...` or `Warning: ...`, and the
same lists as JSON on stdout.

| Check | Result |
|---|---|
| No runs | Hard stop (project) |
| No run at all with `library_source` `GENOMIC` | Hard stop (project) |
| A run with `read_count` or `base_count` 0 or missing | Run error |
| A run whose `library_source` is not `GENOMIC` | Run error |
| `library_strategy` not `WGS` | Warning |
| `library_selection` is an RNA selection (PolyA, cDNA, Oligo-dT, RT-PCR, Inverse rRNA, ...) | Warning |
| Mean read length over 300 bp on an Illumina instrument | Warning |
| Fewer than 1,000,000 reads in a BioSample sequenced only on Illumina | Warning |

| Exit | Meaning | What to do |
|---|---|---|
| 0 | No errors | Relay any warnings (below) |
| 1 | Project hard stop | Report every `Error:` line to the curator and stop the workflow |
| 3 | Only some runs fail | Show the curator the errored runs. They must be left out of the Step 2 annotations; continue with the rest |

A run error reads `Error: <run>: ... (drop this run from the sample
annotations, or stop)`. If the curator would rather not propose without those
runs, stop. `write-proposal.js` re-runs the checks over the runs the
annotations use and refuses any errored run that is still in them.

**Warnings are the curator's call.** Relay every `Warning:` line verbatim, then
for each warned run (or BioSample, for low depth) ask the curator to either:

- **drop** it: leave its runs out of the Step 2 annotations, or
- **accept** it: keep it as it is.

Never drop or accept on their behalf. Record their answers; Step 2 needs them.

## Check the experiments

```bash
node scripts/check-experiments.js <ACCESSION>
```

Runs of one SRA experiment (SRX) are one library sequenced more than once, so
Step 2 always keeps them in one sample. A BioSample is **flagged** when its
runs span two or more SRX that differ in `experiment_title`, `library_name`,
`submission_accession` or `first_public`: they may be different material
(passages, generations, derived lines) under one BioSample. SRX of one
BioSample that agree on all four are not flagged; merge them, no reason
needed.

It prints a table per flagged BioSample on stderr (SRX, runs, the four fields;
`*` marks the ones that differ) and the same as JSON on stdout. It only
reports, and exits 0 either way. Exit 1 means the metadata is missing or
predates experiment accessions: re-run `fetch-sra-metadata.js`.

Ignore a flag whose differing SRX were all dropped in the library checks.
Show the curator every other flagged table. Names are evidence, not proof: a
numeric suffix can mark two generations or passages as easily as two
replicates. Decide nothing until the publications are read.

## Find the publications

```bash
node scripts/find-publications.js <ACCESSION>
```

It writes `.curation/tmp/<ACCESSION>_publications.json` with two lists. Each
entry has `pmid`, `pmcid`, `doi`, `title`, `year`, `source` (`MED` for a
journal article, `PPR` for a preprint) and `fullText` links.

- **`linked`**: papers NCBI links to the BioProject. These are confirmed.
- **`candidates`**: searched only when nothing is linked, in Europe PMC by the
  accession and then by words of the BioProject title; `foundBy` says how.
  A candidate is unconfirmed. Show the curator each one (title, year, DOI,
  `foundBy`) and ask whether it describes this BioProject. **Never treat a
  candidate as linked without their yes.**

Every confirmed PubMed ID goes into `pubmedIds` in the Step 4 overrides. A
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

When nothing is readable, say so and ask the curator how the samples relate.

## Split or merge

For each flagged BioSample, show the curator what the Methods say, then ask
them to choose:

- **split by SRX**: each SRX becomes its own sample. For passages, time
  points, treatments or derived lines.
- **merge**: one sample with all the runs. For re-sequencing of the same
  material, such as a second submission of the same DNA extract. Record the
  curator's reason: Step 2 writes it as `experimentsMerged`, and
  `write-proposal.js` refuses the merge without it.

Never choose for them. Record their answers; Step 2 needs them.

## Troubleshooting

- **No runs found**: The BioProject may not have public SRA data yet
- **Missing sample attributes**: Not all submitters provide custom attributes
- **API timeout**: NCBI may be slow; the script uses rate limiting
