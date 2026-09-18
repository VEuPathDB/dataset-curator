# Step 5: Write the Proposal and Preview

## What write-proposal.js does

1. Reads `curator.config.json` to find VEuPathDatasets.
2. Reads contact IDs from `allContacts.xml` and validates the primary and
   additional contacts exist. Unknown IDs fail here, before anything is written.
3. Replaces `Proposals/<accession>/` with fresh `inputs/`, `curated/` and
   `manifest.json`. Input files keep their names.
4. Records the curator's git `user.email` and the plugin version.

For a new proposal the manifest has no `ticket` yet; Step 6 adds it. For an update, the ticket recorded on master is carried forward.

## Preview

```bash
node scripts/render-proposal.js veupathdb-repos/VEuPathDatasets/Proposals/<ACCESSION>
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

## Presenter name

`<organismAbbrev>_primary_genome_RSRC`, taken from the manifest. If it collides
with an existing presenter, `load-proposals` will refuse later; check now:

```bash
grep -c 'name="<ORGANISM_ABBREV>_primary_genome_RSRC"' veupathdb-repos/VEuPathDatasets/Model/lib/xml/datasetPresenters/<PROJECT>.xml
```
Expected: `0`.
