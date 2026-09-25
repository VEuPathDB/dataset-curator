# Step 6: Publish

## What publish-proposal.js does, in order

1. Preflight, before anything changes: the current branch is
   `proposal/<accession>`, `gh` is authenticated, and
   `Proposals/<accession>/manifest.json` reads and validates, contacts included.
2. Ticket: reuses the one recorded in the manifest, or the one recorded on
   `origin/master` for an update; otherwise creates a new one and writes it
   into the manifest. The ticket body starts with the proposal directory,
   `Proposal: Proposals/<accession>`, followed by the manifest summary.
3. `git add Proposals/<accession> Model/lib/xml/datasetPresenters/contacts/allContacts.xml`
   and commits `Propose <accession> (<type>, <project>, build <NN>)` - only when
   the working tree has something to commit.
4. Pushes `proposal/<accession>` to origin, with `--force-with-lease` if the
   branch is already there.
5. Reuses the open pull request for the branch if there is one, otherwise opens
   one against `master` whose body begins `Part of <ticket>`, so the ticket and
   pull request cross-reference. Title: `[<project>] <type> <accession> for build <NN>`.
6. Comments the pull request URL on the ticket, once.

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
| `Expected to be on proposal/<accession>` | The proposal was written on the wrong branch. Run the printed `git checkout --` command to discard it there, `git checkout proposal/<accession>`, redo Step 4, then re-run |
| `Nothing to publish` | Nothing was written. Redo Step 4, then re-run |

Do not force-push or delete branches by hand to recover; the curator decides.

## After success

Print the PR and ticket URLs and remind the curator that merging the PR is
their step. Nothing else remains for this skill.
