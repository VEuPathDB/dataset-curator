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

`--rebuild-branch <rebuildNN>` is required. Ask the curator for it; never guess.
Organisms are checked against `origin/<rebuildNN>` and pending genome proposals
against `origin/master`; errors name `origin/rebuildNN`. Relay every `Warning:`
line to the curator verbatim.

## The organism

`--organism` is the *proposed* abbreviation. Convention: `<g><sp><Strain>`: genus initial plus the first three letters of the species,
lowercase, then the strain with `.` replaced by `-` and spaces by `_`
(*Plasmodium falciparum* 3D7 is `pfal3D7`; *Botrytis cinerea* B05.10 is
`bcinB05-10`). Letters, digits, `.`, `_` and `-` are allowed, starting with a
letter or digit. Off-convention is a warning now, and Phase 2 stops on it.

The manifest records it in `organisms` (schemaVersion 3):

```json
"organisms": [
  { "proposedOrganismAbbrev": "<abbrev>", "source": "new",
    "species": "…", "strain": "…", "ncbiTaxonId": "…" }
]
```

`species`, `strain` and `ncbiTaxonId` come from the assembly report. The strain
falls back to the report's isolate, with a warning. Correct any of them in the
overrides:

```json
{ "organism": { "species": "…", "strain": "…", "ncbiTaxonId": "…" } }
```

An abbreviation that already exists in any project, or whose taxon and strain
are already loaded or proposed, is refused: the organism is redundant or the
abbreviation is wrong. Ask the curator which. Phase 2 settles the final
abbreviation, which may differ from the proposal.

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
`.curation/tmp/overrides.json` with any of these keys, re-run
`write-proposal.js` adding `--overrides .curation/tmp/overrides.json`,
and preview again:

```json
{
  "presenter": {
    "displayName": "…",
    "shortDisplayName": "…",
    "shortAttribution": "…",
    "summary": "…",
    "description": "…",
    "methodology": "…",
    "pubmedIds": ["12345678"],
    "injectorProps": { "isCurated": "true" }
  }
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
