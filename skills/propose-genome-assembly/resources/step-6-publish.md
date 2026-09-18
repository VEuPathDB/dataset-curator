# Step 6: Publish

## What publish-proposal.js does, in order

1. Confirms the current branch is `proposal/<accession>`.
2. `git add Proposals/<accession> Model/lib/xml/datasetPresenters/contacts/allContacts.xml`
3. Commits: `Propose <accession> (<type>, <project>, build <NN>)`
4. Pushes `proposal/<accession>` to origin.
5. Opens a pull request against `master` with `gh pr create`. Title:
   `[<project>] <type> <accession> for build <NN>`.
6. Creates the ticket through the configured adapter with the PR link, or
   comments on the existing ticket when `--existing-ticket` is given.
7. Writes the ticket reference into `manifest.json`, amends the commit, and
   force-pushes with lease. The branch is the skill's own, so this is safe.

## If it fails

Anything after step 3 leaves a commit on `proposal/<accession>`. Report the
error to the curator. Typical causes and fixes:

| Error | Fix |
|---|---|
| `gh: not logged in` | `gh auth login` in a terminal, then re-run the script |
| `REDMINE_API_KEY environment variable is required` | export it, re-run |
| `a pull request for branch ... already exists` | An earlier run got as far as the PR. Do not re-run. Ask the curator to check the PR and the ticket by hand and finish any missing step manually. |

Do not force-push or delete branches to recover; the curator decides.

## After success

Print the PR and ticket URLs and remind the curator that merging the PR is
their step. Nothing else remains for this skill.
