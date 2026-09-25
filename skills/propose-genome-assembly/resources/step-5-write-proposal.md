# Step 5: Write the Proposal and Preview

## What write-proposal.js does

1. Finds the VEuPathDatasets checkout it is run from.
2. Reads contact IDs from `allContacts.xml` and validates the primary and
   additional contacts exist. Unknown IDs fail here, before anything is written.
3. Builds the proposal in a staging directory: `inputs/`, `curated/` and
   `manifest.json`. Input files keep their names.
4. Derives `curated/presenter.json` from the inputs, applies the curator's
   `--overrides`, and checks that every required field is filled. For this
   dataset type the required fields are: `displayName`, `summary` and `description`.
5. Does a trial render, and only then replaces `Proposals/<accession>/`. If
   any check fails, the existing proposal is left untouched.
6. Records the curator's git `user.email` and the plugin version.

`presenter.json` is the complete record of the presenter: names, attribution,
summary, description, methodology, PubMed IDs, links and the injector props
chosen for this dataset. Phase 2 renders the XML from it and the manifest
alone. Site-wide injector defaults and the build number are filled in at load
time, so they are not frozen into the proposal.

For a new proposal the manifest has no `ticket` yet; Step 6 adds it. For an update, the ticket recorded on master is carried forward.

## Preview

```bash
node scripts/render-proposal.js Proposals/<ACCESSION>
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
escapes it for you. Unknown keys are refused, so a misspelled field name
fails loudly instead of doing nothing. Never edit the rendered XML or
`presenter.json` by hand; `write-proposal.js` rewrites the proposal directory
on every run.

## Presenter name

`<organismAbbrev>_primary_genome_RSRC`, taken from the manifest. If it collides
with an existing presenter, `load-proposals` will refuse later; check now:

```bash
grep -c 'name="<ORGANISM_ABBREV>_primary_genome_RSRC"' Model/lib/xml/datasetPresenters/<PROJECT>.xml
```
Expected: `0`.
