# Step 0: Start the Proposal

## Cross-reference first

```bash
node scripts/resolve-accessions.js <ID>
```

`<ID>` is whatever the curator gave: a BioProject or a GSE. The printed JSON:

| `kind` | Proposals | `<ACCESSION>` |
|---|---|---|
| `one-to-one` | one, with `externalIds.bioproject` and `externalIds.geo` | the id given |
| `no-geo` | one, with only `externalIds.bioproject` (GEO has no series for it) | the BioProject |
| `superseries` | one per sub-series that has a BioProject; `skipped` lists the rest | each sub-series BioProject |

For a SuperSeries, show the curator each proposal's `seriesTypes` and ask
which to propose: sub-series of ChIP-seq or other assays are not bulk
RNA-seq. Then run Steps 0 to 6 once per chosen proposal.

The script stops on a GSE that links to no BioProject (no SRA reads) and on
a BioProject linked to several unrelated series; ask the curator which GSE,
and start again from that GSE. Show every `Warning:` line to the curator.

Each proposal's `externalIds` become `--external-id kind=id` flags here and in
Step 4:

```bash
node scripts/start-proposal.js <ACCESSION> --external-id bioproject=<PRJ> --external-id geo=<GSE>
```

## What it checks

`start-proposal.js` refuses to continue unless VEuPathDatasets is:

- on `master`
- clean (no uncommitted changes)
- up to date with `origin/master`
- without a `proposal/<accession>` branch, here or on `origin`
- without another proposal covering one of the external ids: a
  `proposal/<id>` branch named for one, or a manifest recording one, on
  `origin/master` or another proposal branch on origin. The error names
  the proposal to update instead.

Each failure prints the exact command to fix it. Show it to the curator and
stop; do not run `git` fix-ups yourself.

## Existing proposals

If `Proposals/<accession>/` already exists on `origin/master`, the script reads
its manifest and reads the ticket's status: the issue's Status field on the
configured GitHub Project (`Initial draft` is `draft`, `Proposed` is `proposed`, `Verification in progress` is
`verifying`, `Needs revision` is `revision`, `Ready to load` is `ready`,
`Loading in progress` is `loading`, `Post Load QA` is `qa`, `Final QA` is
`finalqa`, `Done` is `done`):

| Status | Result |
|---|---|
| `draft`, `proposed`, `verifying`, `ready` or `revision` | Continue as an update. (`draft` here is a merged proposal whose card was not moved to `Proposed`.) Step 6 finds and reuses that ticket. For `revision`, read the `Needs revision:` comment on the ticket first: it says what to fix. Publishing the update returns the ticket to `Proposed`, to be verified again before it can load. |
| `loading`, `qa`, `finalqa` or `done` | Stop. The dataset is being or has been loaded. |
| no ticket recorded | Stop. The status cannot be checked. |
| issue not on the project, no Status, or another option | Stop. The error names the issue and option; the curator sets its Status on the project by hand. |

A proposal on master with no ticket is a hard stop: either the ticket is added
to `Proposals/<accession>/manifest.json` on master, or the script is re-run
with `--force-update`, which treats the proposal as `proposed`:

```bash
node scripts/start-proposal.js <accession> --force-update
```

That is the curator's decision. Ask before using it.

## Output

```json
{ "mode": "new" }
```
or
```json
{ "mode": "update", "existingTicket": { "system": "github", "id": "76", "url": "https://github.com/VEuPathDB/VEuPathDatasets/issues/76" } }
```

Carry the mode to Step 6. In mode `new`, Step 6 needs `--build`, because
publish creates the ticket. In mode `update`, omit `--build`: publish reads the
existing ticket from the manifest and from `origin/master` itself.
