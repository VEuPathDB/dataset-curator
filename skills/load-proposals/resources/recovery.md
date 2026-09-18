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
duplicated and never mistaken for a different one) before setting the status
to `loading`. A resumed push uses `--force-with-lease`.

Some failures are prevented instead: preconditions fetch first and refuse a
rebuild branch behind origin, and a straggler already loaded into this build
is refused before the load branch exists.

Report the original error verbatim to the user before resuming, in case it
points at something that needs attention (auth, network, permissions) rather
than a load-proposals bug.

## If re-running does not help

Fall back to starting over: delete the branch and run the load from scratch.

```bash
git -C veupathdb-repos/VEuPathDatasets checkout -f rebuild<NN>
git -C veupathdb-repos/VEuPathDatasets branch -D load/<accession>
```

Then `node scripts/load-proposal.js <accession>` again. Never force-push a
rebuild branch.

## Exception: a cherry-pick conflict (straggler proposals)

A straggler's cherry-pick can conflict mid-pick; this is not resumable by
re-running the command, because the branch is left with an unresolved
conflict rather than a clean load commit. The user resolves the conflict and
continues the cherry-pick, or runs `git cherry-pick --abort`. Either way,
delete the branch and re-run `load-proposal.js` from scratch:

```bash
git -C veupathdb-repos/VEuPathDatasets checkout -f rebuild<NN>
git -C veupathdb-repos/VEuPathDatasets branch -D load/<accession>
node scripts/load-proposal.js <accession>
```

## A loaded proposal must be undone

Close the PR without merging and delete `load/<accession>`. The proposal is
still on `rebuild<NN>` and `master` because nothing was merged. Set the ticket
back to `proposed` by hand.
