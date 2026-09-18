# Step 0: Start the Proposal

## What it checks

`start-proposal.js` refuses to continue unless VEuPathDatasets is:

- on `master`
- clean (no uncommitted changes)
- up to date with `origin/master`
- without an existing `proposal/<accession>` branch

Each failure prints the exact command to fix it. Show it to the curator and
stop; do not run `git` fix-ups yourself.

## Existing proposals

If `Proposals/<accession>/` already exists on `origin/master`, the script reads
its manifest and asks the ticket system for the status:

| Status | Result |
|---|---|
| `proposed` | Continue as an update. Output includes `existingTicket`. Save it for Step 6. |
| `loading` or `done` | Stop. The dataset is being or has been loaded. |
| no ticket recorded | Continue as an update with no existing ticket; Step 6 creates one. |

## Output

```json
{ "mode": "new" }
```
or
```json
{ "mode": "update", "existingTicket": { "system": "redmine", "id": "12345", "url": "https://..." } }
```
