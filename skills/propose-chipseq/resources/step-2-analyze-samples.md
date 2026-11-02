# Step 2: Analyze Samples

## Overview

Claude reads `.curation/tmp/<ACCESSION>_sra_metadata.json` and writes
`.curation/tmp/<ACCESSION>_sample_annotations.json`:

1. One sample per SRA experiment group (below)
2. A `sampleId` and a `role` (`chip` or `input`) on every sample, and an
   `input` on each ChIP sample that has a control
3. Factors: the target and whatever varies between samples
4. Labels that name each sample

Leave out every run the curator chose to drop in Step 1.

## The sample model

**One sample per SRA experiment group.** A group is one SRX, or several SRX
of one BioSample that are unflagged or that the curator merged in Step 1.
Runs sharing an SRX always merge: they are one library sequenced more than
once, and ngs-samples-nextflow concatenates a sample's runs. Differing SRX
under one BioSample (flagged by `check-experiments.js`) follow the curator's
Step 1 decision. SRX of one BioSample that agree on all four compared fields
are not flagged; merge them, no reason needed.

- **Merged**: one sample with all the runs, and the curator's reason as
  `experimentsMerged`:

  ```json
  {
    "sampleId": "BF_H3K4me3",
    "label": "BF H3K4me3",
    "role": "chip",
    "runs": ["SRR001", "SRR002"],
    "experimentsMerged": "Second submission re-sequencing the same chromatin extract",
    "factors": { "target": "H3K4me3" }
  }
  ```

- **Split**: one sample per SRX, each with only its own runs and no
  `experimentsMerged`.

`write-proposal.js` refuses:

- runs of one SRX split across samples;
- a sample whose own runs span differing SRX without an `experimentsMerged`
  reason;
- an `experimentsMerged` on a sample whose own runs don't span differing SRX
  (stale: remove it);
- a sample taking runs from two BioSamples.

Each sample records its `biosample` and `experiments` (its SRX accessions);
both go into entity-sample as hidden provenance.

### Split samples

Describe how each split sample was derived, as factors: a `replicate`,
`timepoint` or `treatment` factor, for example. Take them from the
publication Methods read in Step 1 or the SRA metadata (experiment titles,
library names); never invent them. If neither says, ask the curator.

ChIP-seq annotations have **no `strandedness`** and **no `organisms`**: the
proposal is single-organism, and `write-proposal.js` refuses `organisms` on a
sample.

### BioSamples that look identical

When two or more BioSamples share the strain, the sample name (title or alias)
and every factor value, show them to the curator as a table (BioSample, runs,
strain, sample name, factors) and ask whether that is expected. They **stay
separate samples**, each with its own `sampleId`; they may share a label.
Never drop one unless the curator says so. They cannot be merged: one sample
never spans two BioSamples.

## Input controls

Every sample has a `role`: `"chip"` or `"input"`. `write-proposal.js` refuses
any other value.

- A ChIP sample with a control has `"input": "<sampleId of its input>"`.
  The named sample must be an input sample of this experiment.
- Several ChIP samples may share one input. A ChIP sample has at most one
  input. Inputs never name an input.
- An absent or empty `input` both mean "no input control".
- Every sample has an explicit `sampleId`, because pairing refers to it.

Identify inputs from the sample titles, `library_name` and BioSample
attributes (for example `input`, `IgG`, `mock`, `whole cell extract`). Pair
each ChIP sample with the input that matches its remaining title tokens (life
stage, replicate, strain). Show the curator the proposed pairs as a table
(ChIP sample, input, the tokens they share) and confirm them. **Never guess a
pairing.** An unclear pair is the curator's call.

Do not add a `role` factor: it is reserved and `write-proposal.js` refuses it.
The STF gets a `role` column automatically, from each sample's `role`.

Libraries sequenced without an input control are fine: leave `input` out.
`write-proposal.js` warns about them in Step 4 when other samples do have
inputs.

## Factors

Factors are what the curator, and later the web site's user, can group and
compare samples by. Start with these, taking each from whatever key the
submitter used in the BioSample `sample_attributes`, the experiment title or
the library name:

| Factor | From | Definition |
|---|---|---|
| `target` | antibody, `chip_antibody`, `target`, title | `"Antibody target of the ChIP (histone mark or protein); input for input controls"` |
| `life_stage` | `dev_stage`, `life_stage`, title | `"Life cycle stage of the organism"` |
| `strain` | `strain` | `"Strain of the organism"` |
| `treatment` | `treatment`, title | `"Treatment applied before chromatin collection"` |

`target` is always present: the histone mark or protein the antibody pulls
down (for example `H3K4me3`), and `input` for input controls. Add the others
when any BioSample records them, even when every sample has the same value.
Add other attributes only when they vary between samples and describe the
biology (for example `genotype`, `timepoint`, `replicate`).

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
| `target` | `"target"` |
| `life_stage` | `"life stage"` |
| `strain` | `"strain"` |

#### `definition`

A short noun phrase (80 characters or fewer) that describes what the factor
records, written for a biologist reading a web-based analysis tool. No
trailing period. Use the definitions in the table above for those factors.

**Avoid:** repeating the key name, generic catch-alls ("Sample attribute"),
raw cryptic attribute names verbatim, full sentences.

#### `unit` (optional)

Include only for factors with numeric values where a unit is meaningful.
Singular, non-abbreviated, US spelling (`"day"`, `"hour"`). Omit it for
categorical values and for dates. When `unit` is set, strip the unit suffix
from every value in each sample's `factors`.

## The annotations file

```json
{
  "samples": [
    { "sampleId": "BF_H3_Input", "label": "BF H3 input", "role": "input", "runs": ["SRR13477527"], "factors": { "target": "input", "life_stage": "bloodstream form" } },
    { "sampleId": "BF_H3_ChIP", "label": "BF H3", "role": "chip", "input": "BF_H3_Input", "runs": ["SRR13477529"], "factors": { "target": "H3", "life_stage": "bloodstream form" } }
  ],
  "factors": {
    "target": { "displayName": "Target", "definition": "Antibody target of the ChIP (histone mark or protein); input for input controls" },
    "life_stage": { "displayName": "Life stage", "definition": "Life cycle stage of the organism" }
  }
}
```

#### Sample ID Rules

Every ChIP-seq sample gets an explicit `sampleId`: input pairing refers to it,
and the defaults (the SRA sample title, else the BioSample accession) rarely
read well. Reduce it to letters, digits, `_`, `.` and `-`, make it distinct
across the experiment, and keep it short, naming the target and condition
(`BF_H3_ChIP`, `BF_H3_Input`). Confirm the ids with the
curator along with the labels. The same id names the sample in
`samplesheet.csv`, in the `input` column and in the STF files. Each sample's
BioSample is recorded as `biosample`, and its SRX accessions as `experiments`.

#### Label Rules

- A human-readable name for the sample: its target and condition.
- **No `|`** in a label; `write-proposal.js` refuses one.
- Left out, `label` defaults to the sample title minus a replicate suffix, or
  the `sampleId` when there is no title. A `label` you supply is always kept.
- BioSamples flagged as identical (above) may share a label.
- Split samples of one BioSample default to labels ending in their SRX.
  Propose readable labels (for example from the target or timepoint factor)
  and confirm them with the curator.

## Output

```
.curation/tmp/<ACCESSION>_sample_annotations.json
```

## Curator Review

Show the curator the samples as a table (sampleId, label, role, input,
BioSample, SRX, runs, factors) and confirm before Step 3:
- [ ] Every sample has a `sampleId` and a `role`
- [ ] Every ChIP sample with a control names it in `input`, and the curator confirmed the pairs
- [ ] Runs of one SRX are in one sample; flagged BioSamples are split or
      merged as the curator chose, merges with an `experimentsMerged` reason
- [ ] Dropped runs are absent; accepted warned runs are present
- [ ] Identical-looking BioSamples were shown and kept separate
- [ ] Labels name the target and condition clearly
- [ ] `target` and every varying condition are captured as factors
