# Step 2: Analyze Samples

## Overview

Claude reads `.curation/tmp/<ACCESSION>_sra_metadata.json` and writes
`.curation/tmp/<ACCESSION>_sample_annotations.json`:

1. One sample per BioSample, with all its runs
2. Factors: the isolate characteristics from the BioSample attributes
3. Labels that name each isolate

Leave out every run the curator chose to drop in Step 1.

## The sample model

**One sample per BioSample.** Every run of that BioSample goes into the same
sample's `runs`: they are technical replicates, and ngs-samples-nextflow
concatenates them. One sample never takes runs from two BioSamples;
`write-proposal.js` refuses that.

DNA-seq annotations have **no `strandedness`** and **no `organisms`**: the
proposal is single-organism, and `write-proposal.js` refuses `organisms` on a
sample.

### BioSamples that look identical

When two or more BioSamples share the strain, the sample name (title or alias)
and every factor value, show them to the curator as a table (BioSample, runs,
strain, sample name, factors) and ask whether that is expected. They **stay
separate samples**, each with its own `sampleId`; they may share a label.
Never merge them into one sample, and never drop one, unless the curator says
so.

## Factors

Factors are the isolate characteristics recorded in the BioSample
`sample_attributes`. Look for these, under whatever key the submitter used:

| Characteristic | Common attribute keys |
|---|---|
| strain | `strain` |
| isolate | `isolate`, `isolate_name_alias` |
| host | `host`, `specific_host` |
| geographic location | `geo_loc_name`, `country`, `lat_lon` |
| collection date | `collection_date` |

Include each of these that any BioSample records, **even when every sample has
the same value**: they describe the isolates and are kept as factors. Add
other attributes only when they vary between BioSamples and describe the
isolate biologically (for example `genotype`, `serotype`, `isolation_source`,
`drug_resistance`).

**Collection dates:** copy what the BioSample gives. A year-only value (such
as `2011`) becomes an integer variable in the STF, not a date; use a full date
only when the BioSample records one. Never invent a month or day.

**Exclude** technical and administrative columns: run and instrument fields,
`BioProject`, `Center Name`, submitter contact fields, and values like
`missing`, `not collected` or `not applicable` when every BioSample has them.

### Factor definitions

For each factor give `displayName`, `definition`, and (where applicable) `unit`.

#### `displayName` (required)

The human-readable label shown in the UI. Lowercase preferred. As a default,
replace underscores with spaces.

| Factor key | displayName |
|---|---|
| `strain` | `"strain"` |
| `geo_loc_name` | `"geographic location"` |
| `collection_date` | `"collection date"` |

#### `definition`

A short noun phrase (80 characters or fewer) that describes what the factor
records, written for a biologist reading a web-based analysis tool. No
trailing period.

| Factor key | definition |
|---|---|
| `strain` | `"Strain designation of the sequenced isolate"` |
| `isolate` | `"Name or identifier of the sequenced isolate"` |
| `host` | `"Host organism the isolate was collected from"` |
| `geo_loc_name` | `"Country or region where the isolate was collected"` |
| `collection_date` | `"Date the isolate was collected"` |

**Avoid:** repeating the key name, generic catch-alls ("Sample attribute"),
raw cryptic attribute names verbatim, full sentences.

#### `unit` (optional)

Include only for factors with numeric values where a unit is meaningful.
Singular, non-abbreviated, US spelling (`"day"`, `"meter"`). Omit it for
categorical values and for dates. When `unit` is set, strip the unit suffix
from every value in each sample's `factors`.

## The annotations file

```json
{
  "factors": {
    "strain": {
      "displayName": "strain",
      "definition": "Strain designation of the sequenced isolate"
    },
    "host": {
      "displayName": "host",
      "definition": "Host organism the isolate was collected from"
    },
    "geo_loc_name": {
      "displayName": "geographic location",
      "definition": "Country or region where the isolate was collected"
    }
  },
  "samples": [
    {
      "label": "Isolate A",
      "runs": ["SRR001", "SRR002"],
      "factors": { "strain": "A", "host": "grape", "geo_loc_name": "France" }
    },
    {
      "label": "Isolate B",
      "runs": ["SRR003"],
      "factors": { "strain": "B", "host": "strawberry", "geo_loc_name": "Chile" }
    }
  ]
}
```

#### Sample ID Rules

Leave `sampleId` out unless the curator wants a specific id. `write-proposal.js`
sets it: the SRA sample title (reduced to letters, digits, `_`, `.`, `-`) when
every sample without a curator id has a distinct one, otherwise the BioSample
accession. A curator-chosen `sampleId` is always kept.

When every BioSample shares one generic sample title (the same text for all),
the ids fall back to BioSample accessions and the labels to that one title.
Propose readable labels instead (for example from the `isolate` or `strain`
attribute), show them to the curator, and write them as `label` once they
confirm. The same id names the
sample in `samplesheet.csv` and the STF files. Each sample's BioSample is
recorded as `biosample`.

#### Label Rules

- A human-readable name for the isolate, usually its strain or isolate name.
- **No `|`** in a label; `write-proposal.js` refuses one.
- Left out, `label` defaults to the sample title minus a replicate suffix, or
  the `sampleId` when there is no title. A `label` you supply is always kept.
- BioSamples flagged as identical (above) may share a label.

## Output

```
.curation/tmp/<ACCESSION>_sample_annotations.json
```

## Curator Review

Show the curator the samples as a table (label, BioSample, runs, factors) and
confirm before Step 3:
- [ ] One sample per BioSample, with all its runs
- [ ] Dropped runs are absent; accepted warned runs are present
- [ ] Identical-looking BioSamples were shown and kept separate
- [ ] Labels name the isolates clearly
- [ ] The isolate characteristics are captured as factors
