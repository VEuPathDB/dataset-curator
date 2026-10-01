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
its manifest and reads the ticket's status: the issue's Status field on the
configured GitHub Project (`Proposed` is `proposed`, `Verification in progress` is
`verifying`, `Needs revision` is `revision`, `Ready to load` is `ready`,
`Loading in progress` is `loading`, `Post Load QA` is `qa`, `Final QA` is
`finalqa`, `Done` is `done`):

| Status | Result |
|---|---|
| `proposed`, `verifying`, `ready` or `revision` | Continue as an update. Step 6 finds and reuses that ticket. For `revision`, read the `Needs revision:` comment on the ticket first: it says what to fix. Publishing the update returns the ticket to `Proposed`, to be verified again before it can load. |
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
