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

`presenter.json` is the complete record of the presenter: names, attribution,
summary, description, methodology, PubMed IDs, links and the injector props
chosen for this dataset. Phase 2 renders the XML from it and the manifest
alone. Site-wide injector defaults and the build number are filled in at load
time, so they are not frozen into the proposal.

For a new proposal the manifest has no `ticket` yet; Step 6 adds it. For an update, the ticket recorded on master is carried forward.

Required input: `.curation/tmp/<BIOPROJECT>_sra_metadata.json`. Optional inputs:
`.curation/tmp/<GSE>_family.xml` (GEO-linked datasets) and
`.curation/tmp/<BIOPROJECT>_pdf_extracted.json` (when a PDF was extracted). Required
`--curated` file: `.curation/tmp/<BIOPROJECT>_sample_annotations.json`.

## The dataset record

`write-proposal.js` also derives `curated/dataset.json`: the per-dataset props
of the `rnaSeqExperiment` class in `classes.xml`, and where the reads come
from.

| prop | from |
|---|---|
| `hasPairedEnds` | SRA library layout; mixed layouts stop the script |
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
"paths": ["/abs/path"] } } }` or `{ "type": "url", "urls": [...] }`. Checking
those locations and copying data to the server is the data loading team's job.

The name must be new for the organism: the script refuses a name already in
`Datasets/lib/xml/datasets/<Project>/<organismAbbrev>.xml` or used by another
proposal on master.

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
`.curation/tmp/presenter-overrides.json` with any of these keys, re-run
`write-proposal.js` adding `--overrides .curation/tmp/presenter-overrides.json`,
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

`name` and `version` identify the dataset in the manifest. `name` becomes a
directory name for the data loaders and part of the presenter name
(`<organismAbbrev>_<name>_rnaSeq_RSRC`), so make it readable and never the
accession; the default is `<PrimaryContactSurname>_<year>`. `version` is when
the data last changed: the GEO series release date by default, and required
here when there is no GEO series.

Omit keys you do not want to override. These values are plain text, not
pre-escaped XML: write `Doe & Smith`, not `Doe &amp; Smith` - the renderer
escapes it for you. Unknown keys are refused, so a misspelled field name
fails loudly instead of doing nothing. Never edit the rendered XML or
`presenter.json` by hand; `write-proposal.js` rewrites the proposal directory
on every run.

### templateInjector properties

These are set via `injectorProps` in `presenter-overrides.json`. Review and
adjust based on the experiment:

| Property | Values | Notes |
|----------|--------|-------|
| `hasFishersExactTestData` | true/false | Are pairwise comparisons available? |
| `isDESeq` | true/false | Was DESeq used for analysis? |
| `hasMultipleSamples` | true/false | More than one biological condition? |
| `graphType` | bar/line | Bar for discrete conditions, line for time series |

`hasMultipleSamples` and `isDESeq` are derived at render time from the sample
count, so both are already `true` for more than one sample. Override them only
to contradict that.

## Presenter name

`<organismAbbrev>_<name>_rnaSeq_RSRC`, the `datasetName` the `rnaSeqExperiment`
class gives its loader, so presenter and dataset join. Print it with:

```bash
node scripts/render-proposal.js --name Proposals/<BIOPROJECT>
```

Step 5 needs it in `.curation/tmp/<BIOPROJECT>_presenter_name.txt`.
