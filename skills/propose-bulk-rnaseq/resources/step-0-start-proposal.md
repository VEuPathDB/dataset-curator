# Step 0: Start the Proposal

## What it checks

`start-proposal.js` refuses to continue unless VEuPathDatasets is:

- on `master`
- clean (no uncommitted changes)
- up to date with `origin/master`
- without a `proposal/<accession>` branch, here or on `origin`

Each failure prints the exact command to fix it. Show it to the curator and
stop; do not run `git` fix-ups yourself.

## Existing proposals

If `Proposals/<accession>/` already exists on `origin/master`, the script reads
its manifest and asks the ticket system for the status:

| Status | Result |
|---|---|
| `proposed` | Continue as an update. Step 6 finds and reuses that ticket. |
| `loading` or `done` | Stop. The dataset is being or has been loaded. |
| no ticket recorded | Stop. The status cannot be checked. |

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
{ "mode": "update", "existingTicket": { "system": "redmine", "id": "12345", "url": "https://..." } }
```

Nothing from this output needs to be carried to Step 6. `publish-proposal.js`
reads the ticket from the manifest and from `origin/master` itself.
