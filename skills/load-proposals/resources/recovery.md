# Recovery

## The load failed

The error tells you whether to re-run or start over: any failure past the
first change ends with either `Re-run the same command to resume.` or
`To start over: git -C '<repo>' checkout -f rebuild<NN> && git -C '<repo>'
branch -D load/<accession>`. Follow that line; the rest of this page explains
why it says what it says.

`load-proposal.js` is resumable. If it fails after the load commit was made
on `load/<accession>` (push failed, `gh pr create` failed, or the ticket
update failed), the fix is almost always:

```bash
node scripts/load-proposal.js <accession>
```

Run it again, on the same `load/<accession>` branch, with no other setup.
It detects that the commit already exists and picks up from there: it pushes
if needed, reuses an existing open pull request instead of opening a second
one, and comments on the ticket only if it has not already commented (whole
comment bodies are compared, so a partial run's notification is never
duplicated and never mistaken for a different one) before setting the issue's
project Status to `Loading in progress`. A failure setting the Status (no `project` scope
on the `gh` token, or no `Loading in progress` option on the field, which is added by
hand) stops the load; fix it and re-run. A resumed push uses `--force-with-lease`.

Some failures are prevented instead: preconditions fetch first and refuse a
rebuild branch that is not at origin, a load branch already on origin, a
contact the rebuild branch does not carry, a straggler already loaded into
this build, a ticket not at `Ready to load`, and a project Status field
missing its options - all before the load branch exists.

Report the original error verbatim to the user before resuming, in case it
points at something that needs attention (auth, network, permissions) rather
than a load-proposals bug.

## If re-running does not help

Fall back to starting over: delete the branch and run the load from scratch.

```bash
git checkout -f rebuild<NN>
git branch -D load/<accession>
```

Then `node scripts/load-proposal.js <accession>` again. Never force-push a
rebuild branch.

## Exception: a cherry-pick conflict (straggler proposals)

A straggler's cherry-pick can conflict mid-pick; this is not resumable by
re-running the command, because the branch is left with an unresolved
conflict rather than a clean load commit. The pick holds the checkout, so the
start-over line in the error is prefixed with `git -C '<repo>' cherry-pick
--abort &&`; run it as printed, or resolve and continue the pick by hand
first. Either way the branch is then deleted and the load runs from scratch:

```bash
git cherry-pick --abort
git checkout -f rebuild<NN>
git branch -D load/<accession>
node scripts/load-proposal.js <accession>
```

## A loaded proposal must be undone

Close the PR without merging and delete `load/<accession>`, locally and on
origin. Nothing was merged, so the proposal is still where it was before the
load: on `rebuild<NN>`, or on `master` only if it was a straggler. Set the
issue's Status on the project back to `Ready to load` by hand.

## mark-ready refuses

| Message contains | Fix |
|---|---|
| `is not on origin/master` | The proposal PR has not merged. Verify after it merges |
| `An update to <accession> is awaiting review` | An update PR from `proposal/<accession>` is open. Verify after it merges, since that is what will load |
| `only a "Proposed" or "Verification in progress" proposal can be marked ready` | Already `Ready to load`, sent back, or loading. Check the ticket; nothing to do for `Ready to load` |

## start-verification refuses

The same merged and no-open-update checks as mark-ready. It also refuses a
ticket not at `Proposed` (`only a "Proposed" proposal can start
verification`): someone may already be verifying it, so check the issue's
assignee. Claiming is optional; mark-ready and request-revision work from
`Proposed` as well.

## mark-loaded refuses

| Message contains | Fix |
|---|---|
| `No merged pull request from load/<accession>` | The load PR is still open or was closed unmerged. Merge it first, or do not mark it loaded |
| `status is "<status>", not "loading"` | The load did not set `Loading in progress`, or someone moved the ticket back. Check the ticket, set the Status by hand if the load really merged, and re-run. A ticket already at `Post Load QA`, `Final QA` or `Done` is not refused: re-running changes nothing |

## Initial draft at verification

start-verification, mark-ready and request-revision treat a ticket still at
`Initial draft` as `Proposed` when its proposal PR merged into master, and
print `The proposal PR <url> is merged but the ticket was still at "Initial
draft"; continuing as Proposed.` Otherwise they refuse with `is not merged
yet`: review happens on the PR. `Cannot check whether the proposal PR ...
merged` means the lookup failed; nothing changed, so re-run once `gh` works.

## merge-proposal refuses

| Message contains | Fix |
|---|---|
| `Cannot check for an open proposal PR` | The `gh` lookup failed; nothing was merged. Re-run when `gh` works |
| `No open or merged proposal PR` | Nothing to merge. Check the accession and that publish opened the PR |
| `merge-proposal merges only "Initial draft" or "Proposed" proposals` | The ticket is further along; do not merge with this script, and ask the user |
| `Cannot merge <url>: ...` | GitHub refused (conflicts, failing checks, branch protection). The ticket is unchanged. Resolve on the PR, then re-run |

