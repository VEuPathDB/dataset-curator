# Step 6: Publish

## What publish-proposal.js does, in order

1. Preflight, before anything changes: the current branch is
   `proposal/<accession>`, `gh` is authenticated, and
   `Proposals/<accession>/manifest.json` reads and validates, contacts included.
2. `git add Proposals/<accession> Model/lib/xml/datasetPresenters/contacts/allContacts.xml`
   and commits `Propose <accession> (<type>, <project>, build <NN>)` - only when
   the working tree has something to commit.
3. Pushes `proposal/<accession>` to origin, with `--force-with-lease` if the
   branch is already there.
4. Reuses the open pull request for the branch if there is one, otherwise opens
   one against `master`. Title: `[<project>] <type> <accession> for build <NN>`.
5. Ticket: reuses the one recorded in the manifest; otherwise comments on the
   ticket recorded on `origin/master`, or creates a new one.
6. If the manifest on disk has no ticket yet, writes it in, amends the commit
   and force-pushes with lease.

## If it fails

**Re-run the same command.** Publish is idempotent: it commits only if there is
something to commit, reuses the pull request it already opened, and reuses the
ticket already recorded. Re-running never opens a second PR or files a second
ticket. When a re-run picks up where the last one stopped it prints
`Resumed an earlier publish.`, which is expected, not an error.

The preflight errors stop the script before anything changes:

| Error | Fix |
|---|---|
| `gh is not authenticated; run: gh auth login` | `gh auth login` in a terminal, then re-run |
| `REDMINE_API_KEY environment variable is required` | export it, then re-run |
| `Expected to be on proposal/<accession>` | The proposal was written on the wrong branch. Run the printed `git checkout --` command to discard it there, `git -C veupathdb-repos/VEuPathDatasets checkout proposal/<accession>`, redo Step 5, then re-run |
| `Nothing to publish` | Nothing was written. Redo Step 5, then re-run |

Do not force-push or delete branches by hand to recover; the curator decides.

## After success

Print the PR and ticket URLs and remind the curator that merging the PR is
their step. Nothing else remains for this skill.
