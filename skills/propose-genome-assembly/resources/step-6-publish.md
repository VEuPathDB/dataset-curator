# Step 6: Publish

## What publish-proposal.js does, in order

1. Preflight, before anything changes: the current branch is
   `proposal/<accession>`, `gh` is authenticated, and
   `Proposals/<accession>/manifest.json` reads and validates, contacts included.
2. Ticket: reuses the one recorded in the manifest, or the one recorded on
   `origin/master` for an update; otherwise creates a new one, titled
   `[<project>] <type> <accession>` like the pull request, in the `Build NN`
   milestone given by `--build` (the milestone, not the title, carries the
   build), labelled with the dataset type (`ticket.github.typeLabels`; the
   label is created on first use) and added to the project with Status
   `Proposed`, and writes it into the manifest. When
   updating a proposal that already has a ticket, omit `--build` (or pass the
   build its milestone already has). The ticket body starts with the proposal directory,
   `Proposal: Proposals/<accession>`, followed by the manifest summary.
3. `git add Proposals/<accession> Model/lib/xml/datasetPresenters/contacts/allContacts.xml`
   and commits `Propose <accession> (<type>, <project>)` - only when
   the working tree has something to commit.
4. Pushes `proposal/<accession>` to origin, with `--force-with-lease` if the
   branch is already there.
5. Reuses the open pull request for the branch if there is one, otherwise opens
   one against `master` whose body begins `Part of <ticket>`, so the ticket and
   pull request cross-reference. Title: `[<project>] <type> <accession>`.
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
| `--build must be two or more digits, e.g. 02; got "<value>"` | Re-run with a valid `--build` |
| `No issue label for dataset type "<type>"` | Add the type to `ticket.github.typeLabels` in the config, then re-run |
| `A new ticket needs a build: re-run with --build NN` | Ask the curator which build, then re-run with `--build NN` |
| `The ticket <url> is in build <X>, not <NN>; move its milestone instead of passing --build` | Drop `--build`, or change the ticket's milestone on GitHub |
| `Expected to be on proposal/<accession>` | The proposal was written on the wrong branch. Run the printed `git checkout --` command to discard it there, `git checkout proposal/<accession>`, redo Step 5, then re-run |
| `Nothing to publish` | Nothing was written. Redo Step 5, then re-run |

One failure comes after the ticket exists: `Issue <url> was created but its
Status could not be set to "Proposed" in project <owner>/<number>`. Publish
records that issue in the manifest before stopping, so the re-run reuses it and
sets its Status rather than filing a second ticket. Usually the `gh` token
lacks the `project` scope (`gh auth refresh -s project`) or the project's
Status field has no `Proposed` option (the curator adds it by hand).

Do not force-push or delete branches by hand to recover; the curator decides.

## After success

Print the PR and ticket URLs and remind the curator that merging the PR is
their step. Nothing else remains for this skill.
