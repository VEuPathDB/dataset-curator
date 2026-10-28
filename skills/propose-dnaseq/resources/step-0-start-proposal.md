# Step 0: Start the Proposal

## The accession

The proposal is keyed by its BioProject. There is no GEO cross-reference for
DNA-seq.

If the curator gave a BioSample instead, look up the BioProject its runs
belong to:

```bash
curl -s "https://www.ebi.ac.uk/ena/portal/api/filereport?accession=<SAMN>&result=read_run&fields=study_accession&format=tsv"
```

The output has a `study_accession` column, one row per run. Show the curator
the BioProject and confirm it before going on. If the rows name more than one
BioProject, or none, show the curator and ask which to use; never guess.

## Command

```bash
node scripts/start-proposal.js <ACCESSION> --external-id bioproject=<ACCESSION>
```

Pass the same `--external-id` in Step 4.

## What it checks

`start-proposal.js` refuses to continue unless VEuPathDatasets is:

- on `master`
- clean (no uncommitted changes)
- up to date with `origin/master`
- without a `proposal/<accession>` branch, here or on `origin`
- without another proposal covering the BioProject: a `proposal/<id>` branch
  named for it, or a manifest recording it, on `origin/master` or another
  proposal branch on origin. The error names the proposal to update instead.

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
