# Step 4: Write the Proposal and Preview

## What write-proposal.js does

1. Reads `curator.config.json` to find VEuPathDatasets.
2. Reads contact IDs from `allContacts.xml` and validates the primary and
   additional contacts exist. Unknown IDs fail here, before anything is written.
3. Replaces `Proposals/<accession>/` with fresh `inputs/`, `curated/` and
   `manifest.json`. Input files keep their names.
4. Records the curator's git `user.email` and the plugin version.

The manifest has no `ticket` field yet; Step 6 adds it.

Required input: `tmp/<BIOPROJECT>_sra_metadata.json`. Optional inputs:
`tmp/<GSE>_family.xml` (GEO-linked datasets) and
`tmp/<BIOPROJECT>_pdf_extracted.json` (when a PDF was extracted). Required
`--curated` file: `tmp/<BIOPROJECT>_sample_annotations.json`.

## Preview

```bash
node scripts/render-proposal.js veupathdb-repos/VEuPathDatasets/Proposals/<BIOPROJECT>
```

This runs the same renderer `load-proposals` will run later. Show the curator
the result. It proves the proposal renders and lets them catch bad metadata
while they still have context.

If a `presenter-overrides.json` has an `injectorProps` key the renderer does
not recognize, the preview prints `Warning: injector props not in defaults: ...`
on stderr. Treat it as a typo check: fix the key name and re-run.

## Curator edits go in overrides, not XML

If the curator wants different text, create `tmp/presenter-overrides.json`
with any of these keys, then re-run `write-proposal.js` adding
`--curated tmp/presenter-overrides.json`, and preview again:

```json
{
  "displayName": "…",
  "shortDisplayName": "…",
  "shortAttribution": "…",
  "summary": "…",
  "description": "…",
  "methodology": "…",
  "pubmedIds": ["12345678"],
  "injectorProps": { "isCurated": "true" }
}
```

Omit keys you do not want to override. These values are plain text, not
pre-escaped XML: write `Doe & Smith`, not `Doe &amp; Smith` - the renderer
escapes it for you. The rendered XML is never stored, so editing it would be
lost.

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

`<genusInitial><species3>_<BIOPROJECT>_rnaSeq_RSRC`, derived from the SRA
organism name (e.g. `afum_PRJNA123456_rnaSeq_RSRC`). Print it with:

```bash
node scripts/render-proposal.js --name veupathdb-repos/VEuPathDatasets/Proposals/<BIOPROJECT>
```

Step 5 needs it in `tmp/<BIOPROJECT>_presenter_name.txt`.
