# Step 2: Analyze Samples

## Overview

Claude reads `.curation/tmp/<ACCESSION>_sra_metadata.json` and writes
`.curation/tmp/<ACCESSION>_sample_annotations.json`:

1. One sample per SRA experiment group (below)
2. Factors: the isolate characteristics from the BioSample attributes
3. Labels that name each isolate

Leave out every run the curator chose to drop in Step 1.

## The sample model

**One sample per SRA experiment group.** Runs sharing an SRX always merge:
they are one library sequenced more than once, and ngs-samples-nextflow
concatenates a sample's runs. Differing SRX under one BioSample (flagged by
`check-experiments.js`) follow the curator's Step 1 decision. SRX that agree
on all four compared fields are not flagged and merge without a reason.

- **Merged**: one sample with all the runs, and the curator's reason as
  `experimentsMerged`:

  ```json
  {
    "label": "Isolate A",
    "runs": ["SRR001", "SRR002"],
    "experimentsMerged": "Top-up sequencing of the same library",
    "factors": { "strain": "A" }
  }
  ```

- **Split**: one sample per SRX, each with only its own runs and no
  `experimentsMerged`.

`write-proposal.js` refuses:

- runs of one SRX split across samples;
- a sample whose runs span flagged SRX without an `experimentsMerged` reason;
- an `experimentsMerged` on a sample whose runs are not flagged (stale: remove
  it);
- a sample taking runs from two BioSamples.

Each sample records its `biosample` and `experiments` (its SRX accessions);
both go into entity-sample as hidden provenance.

### Split samples

Describe how each split sample was derived, as factors: a `generation` or
`passage` factor, and the parent line it came from. Take them from the
publication Methods read in Step 1 or the SRA metadata (experiment titles,
library names); never invent them. If neither says, ask the curator.

DNA-seq annotations have **no `strandedness`** and **no `organisms`**: the
proposal is single-organism, and `write-proposal.js` refuses `organisms` on a
sample.

### BioSamples that look identical

When two or more BioSamples share the strain, the sample name (title or alias)
and every factor value, show them to the curator as a table (BioSample, runs,
strain, sample name, factors) and ask whether that is expected. They **stay
separate samples**, each with its own `sampleId`; they may share a label.
Never drop one unless the curator says so. They cannot be merged: one sample
never spans two BioSamples.

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
accession. A curator-chosen `sampleId` is always kept. Titles are used only
when no two BioSamples share one.

Samples of a split BioSample get the SRX appended: `<title>_<SRX>`, else
`<BioSample>_<SRX>`. A split sample spanning several SRX has no default and
needs a curator `sampleId`. When the defaults would be long or generic (a
title shared across the project), suggest short `sampleId`s that name the
line and generation, and confirm them with the curator.

When every BioSample shares one generic sample title (the same text for all),
the ids fall back to BioSample accessions and the labels to that one title.
Propose readable labels instead (for example from the `isolate` or `strain`
attribute), show them to the curator, and write them as `label` once they
confirm. The same id names the
sample in `samplesheet.csv` and the STF files. Each sample's BioSample is
recorded as `biosample`, and its SRX accessions as `experiments`.

#### Label Rules

- A human-readable name for the isolate, usually its strain or isolate name.
- **No `|`** in a label; `write-proposal.js` refuses one.
- Left out, `label` defaults to the sample title minus a replicate suffix, or
  the `sampleId` when there is no title. A `label` you supply is always kept.
- BioSamples flagged as identical (above) may share a label.
- Split samples of one BioSample share its title, so their default labels
  match: give each a label that names its generation or passage.

## Output

```
.curation/tmp/<ACCESSION>_sample_annotations.json
```

## Curator Review

Show the curator the samples as a table (label, BioSample, SRX, runs, factors) and
confirm before Step 3:
- [ ] Runs of one SRX are in one sample; flagged BioSamples are split or
      merged as the curator chose, merges with an `experimentsMerged` reason
- [ ] Dropped runs are absent; accepted warned runs are present
- [ ] Identical-looking BioSamples were shown and kept separate
- [ ] Labels name the isolates clearly
- [ ] The isolate characteristics are captured as factors
