# Step 6: Publish

## What publish-proposal.js does, in order

1. Preflight, before anything changes: the current branch is
   `proposal/<accession>`, `gh` is authenticated, the project's Status field
   has every configured option, and
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
7. On an update, returns a `Ready to load` or `Needs revision` ticket to
   `Proposed`: an updated proposal needs verifying again. A `Proposed` ticket
   is left alone.

Merging the pull request leaves the ticket at `Proposed`. The data loading
team verifies the merged proposal and marks it `Ready to load` (`mark-ready.js`)
or sends it back as `Needs revision` (`request-revision.js`); only `Ready to
load` proposals load.

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
| `has no single-select field "Status"`, `has no option "<option>"`, or `Cannot read project` | Add the missing options to the project's Status field by hand; for a scope or permission error run `gh auth refresh -s project`; then re-run |
| `The ticket <url> is at "<option>"; only a Proposed, Ready to load or Needs revision proposal can be updated` | The proposal is loading or loaded; it cannot be updated. Stop and tell the curator |
| `The ticket <url> is closed and has no project status` | The recorded ticket was closed before publish could set its Status. Reopen it, or remove `ticket` from the manifest so publish files a new one; ask the curator which |
| `No issue label for dataset type "<type>"` | Add the type to `ticket.github.typeLabels` in the config, then re-run |
| `A new ticket needs a build: re-run with --build NN` | Ask the curator which build, then re-run with `--build NN` |
| `The ticket <url> is in build <X>, not <NN>; move its milestone instead of passing --build` | Drop `--build`, or change the ticket's milestone on GitHub |
| `Expected to be on proposal/<accession>` | Run the printed command. If it is `git checkout --`, the proposal was written on the wrong branch: discard it there, `git checkout proposal/<accession>`, redo Step 5, then re-run. If the message says the manifest records a ticket, an earlier publish recorded it: switch back with the printed `git checkout proposal/<accession>` and re-run; never discard that manifest |
| `Nothing to publish` | Nothing was written. Redo Step 5, then re-run |

One failure comes after the ticket exists: `Issue <url> was created but its
Status could not be set to "Proposed"`. Publish records that issue in the
manifest before stopping. **Do not discard the working-tree changes in
`Proposals/<accession>/`.** Fix the cause first: usually the `gh` token lacks
the `project` scope (`gh auth refresh -s project`), or the project's Status
field is missing an option (the curator adds it by hand). Then re-run: it
reuses the issue and sets its Status rather than filing a second ticket.

If `gh issue create` printed no issue URL, publish looks for the one open
issue with exactly the ticket's title and carries on with it. When it finds
none it stops with `An issue may have been created`: check the repository's
issues before re-running, and if one exists, record it in the manifest's
`ticket` rather than letting a re-run file a second.

Do not force-push or delete branches by hand to recover; the curator decides.

## After success

Print the PR and ticket URLs and remind the curator that merging the PR is
their step. Nothing else remains for this skill.
