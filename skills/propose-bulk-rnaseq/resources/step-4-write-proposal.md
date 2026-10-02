# Step 4: Write the Proposal and Preview

## What write-proposal.js does

1. Finds the VEuPathDatasets checkout it is run from.
2. Reads contact IDs from `allContacts.xml` and validates the primary and
   additional contacts exist. Unknown IDs fail here, before anything is written.
3. Builds the proposal in a staging directory: `inputs/`, `curated/` and
   `manifest.json`. Input files keep their names.
4. Derives `curated/presenter.json` from the inputs, applies the curator's
   `--overrides`, and checks that every required field is filled. For this
   dataset type the required fields are: `displayName`, `summary`, `description`, `shortDisplayName` and `shortAttribution`.
5. Does a trial render, and only then replaces `Proposals/<accession>/`. If
   any check fails, the existing proposal is left untouched.
6. Records the curator's git `user.email` and the plugin version.

The manifest records the organisms as `referenceOrganismAbbrev` and
`additionalOrganismAbbrevs` (from `--organism` and each `--also-organism`).
Each organism gets its own presenter and its own `<dataset>` entry.

`presenter.json` is the complete record of the presenter: names, attribution,
summary, description, methodology, PubMed IDs, links and the injector props
chosen for this dataset. Phase 2 renders the XML from it and the manifest
alone. Site-wide injector defaults and the build number are filled in at load
time, so they are not frozen into the proposal. The build is not in the
proposal at all: it is the milestone of the ticket, given at publish.

For a new proposal the manifest has no `ticket` yet; Step 6 adds it. For an update, the ticket recorded on master is carried forward.

Required input for an SRA source: `.curation/tmp/<BIOPROJECT>_sra_metadata.json`. Optional inputs:
`.curation/tmp/<GSE>_family.xml` (GEO-linked datasets) and
`.curation/tmp/<BIOPROJECT>_pdf_extracted.json` (when a PDF was extracted). For a
server or url source there is no SRA metadata file: omit that `--input` (see
the command in the skill's Step 4). Required `--curated` file: `.curation/tmp/<BIOPROJECT>_sample_annotations.json`.

## The dataset record

`write-proposal.js` also derives `curated/dataset.json`: the per-dataset props
of the `rnaSeqExperiment` class in `classes.xml`, and where the reads come
from.

| prop | from |
|---|---|
| `hasPairedEnds` | SRA library layout, or the files for a server or url source (a mix is refused, with no override); mixed SRA layouts stop the script |
| `isStrandSpecific` | `strandedness` in the sample annotations; `unknown` stops the script |
| `fromSRA` | `true` for the default source, `{ "type": "sra" }` |
| `limitNU`, `alignWithCdsCoordinates` | `30`, `false` |

The prop list is read from `classes.xml` in the checkout, so a prop added to the
class is required here as well. Settle a stopped value with the curator, then
set it in the overrides:

```json
{ "dataset": { "props": { "isStrandSpecific": "false" } } }
```

Reads not in SRA are declared as `{ "dataset": { "source": { "type": "server",
"paths": ["/abs/path"] } } }` or `{ "type": "url", "urls": [...] }`. The sample
annotations for them are built in Step 2, under "Reads not in SRA". Without SRA
metadata, `displayName` and `summary` must be given under `"presenter"`;
`description` too unless a GEO MINiML supplies it. Checking those locations and
copying data to the server is the data loading team's job.

The name must be new in every organism's dataset file: the script refuses a
name already in `Datasets/lib/xml/datasets/<Project>/<organismAbbrev>.xml` for
any of the proposal's organisms, or used by another proposal on master.

## The loading artifacts

`write-proposal.js` also writes `curated/samplesheet.csv`,
`curated/analysisConfig.xml`, `curated/entity-sample.tsv` and
`curated/entity-sample.yaml`. It checks that they agree with each other and with
`dataset.json` (sample ids, paired or single, strandedness) and refuses to write
the proposal otherwise. Each SRA run appears once in the samplesheet with
`fastq_2` empty; downstream expands it to its paired files. For reads not in SRA
the STF has no `SRA.ID.s.` column.

A hand edit is checked again at publish and at load, and is never overwritten
automatically. When a re-run would derive something different from a curated
artifact already in the proposal (a hand edit, or annotations that changed
since), `write-proposal.js` stops without changing anything:

```
curated/<files> differ from what write-proposal would derive (hand edits, or changed annotations). Ask the curator, then re-run with --keep-edits to keep them or --replace-edits to rewrite them (or per file: --keep-edit <file>, --replace-edit <file>).
```

Show the curator the named files and ask which they want. Never choose for
them, and never pass any of these flags before they answer.

- `--keep-edits` keeps every named file as it is in the proposal.
- `--replace-edits` rewrites every named file from the annotations and
  `dataset.json`.
- `--keep-edit <file>` and `--replace-edit <file>` (each repeatable) choose
  per file. Every named file must be chosen exactly once; a missing, repeated
  or unnamed file stops the script again with the list.

Use one form: the all-files flags cannot be combined with each other or with
the per-file ones. When nothing differs, no flag is needed.

A kept file must still agree with the other artifacts and with `dataset.json`,
or the script stops with the agreement error. That check covers sample ids,
paired or single, and strandedness only: a kept file does **not** pick up label
or factor changes made in the sample annotations since. Tell the curator this
when they choose to keep a file after changing the annotations. Changes that
should survive any re-run belong in the sample annotations or the overrides.

## Preview

```bash
node scripts/render-proposal.js Proposals/<BIOPROJECT>
node scripts/render-proposal.js --dataset Proposals/<BIOPROJECT>
```

This runs the same renderer `load-proposals` will run later, on the same
`presenter.json`. What the curator approves here is what loads.

If `presenter.json` sets an injector prop the renderer has no default for, the
preview prints `Warning: injector props not in defaults: ...` on stderr. Treat
it as a typo check: fix the key name in the overrides and re-run.

## Curator edits go in overrides, not XML or presenter.json

If the curator wants different text, or a required field is missing, create
`.curation/tmp/overrides.json` with any of these keys, re-run
`write-proposal.js` adding `--overrides .curation/tmp/overrides.json`,
and preview again:

```json
{
  "name": "Doe_heat_shock_2024",
  "version": "2024-05-01",
  "presenter": {
    "displayName": "…",
    "shortDisplayName": "…",
    "shortAttribution": "…",
    "summary": "…",
    "description": "…",
    "methodology": "…",
    "pubmedIds": ["12345678"],
    "injectorProps": { "graphType": "line" }
  }
}
```

Injector props go under `presenter`: `{ "presenter": { "injectorProps": { ... } } }`.

`name` and `version` identify the dataset in the manifest. `name` becomes a
directory name for the data loaders and part of the presenter name
(`<organism>_<name>_rnaSeq_RSRC`), so make it readable and never the
accession; the default is `<PrimaryContactSurname>_<year>`. `version` is when
the data last changed: the GEO series release date by default, and required
here when there is no GEO series.

Omit keys you do not want to override. These values are plain text, not
pre-escaped XML: write `Doe & Smith`, not `Doe &amp; Smith` - the renderer
escapes it for you. Unknown keys are refused, so a misspelled field name
fails loudly instead of doing nothing. Never edit the rendered XML or
`presenter.json` by hand: `write-proposal.js` re-derives them from the
annotations and overrides on every run. Only the curated loading artifacts
(`samplesheet.csv`, `analysisConfig.xml`, `entity-sample.*`) are protected from
overwrite, as described above.

### templateInjector properties

These are set via `injectorProps` in `overrides.json`. Review and
adjust based on the experiment:

| Property | Values | Notes |
|----------|--------|-------|
| `hasFishersExactTestData` | true/false | Are pairwise comparisons available? |
| `isDESeq` | true/false | Biological replicates: some label shared by two or more samples |
| `hasMultipleSamples` | true/false | More than one sample |
| `graphType` | bar/line | Bar for discrete conditions, line for time series |
| `graphXAxisSamplesDescription` | text | Required; drafted from the factor display names; a short description of the samples |

`hasMultipleSamples` and `isDESeq` are derived at write time and stored in
`presenter.json`: `hasMultipleSamples` is `true` for more than one sample, and
`isDESeq` is `true` only when the samples include biological replicates, that
is, at least one label is shared by two or more samples. Override them only to
contradict that.

## Presenter name

`<organism>_<name>_rnaSeq_RSRC`, one per organism, each the `datasetName` the
`rnaSeqExperiment` class gives its loader, so presenter and dataset join. Print
them, one per organism, with:

```bash
node scripts/render-proposal.js --name Proposals/<BIOPROJECT>
```

