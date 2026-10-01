# Preconditions

`load-proposal.js` checks these in order and stops at the first failure with
the exact fix.

| Check | Failure message contains | Fix |
|---|---|---|
| Working tree clean | `working tree is not clean` | User commits or stashes. On `load/<accession>` the message is `A previous load left uncommitted changes`, and it names the checkout and branch delete that start the load over. |
| Proposal exists anywhere | `No proposal found` | Wrong accession, or the proposal PR was never merged. A proposal only on `origin/master` is a straggler, not an error: it is cherry-picked onto `load/<accession>` during the load, automatically. |
| Proposal has a ticket | `has no ticket, so it has no build` | The build is read from the ticket's milestone. Record the ticket in the proposal's `manifest.json` on master |
| Project Status field ready | `has no single-select field "Status"`, `has no option "<option>"`, or `Cannot read project` | Add the missing options to the project's Status field by hand; for a scope or permission error run `gh auth refresh -s project` |
| Ticket has a build milestone | `has no "Build {build}" milestone` | The message names the issue. Set a `Build NN` milestone on it to choose the build |
| Ticket verified | `is at "<option>"; only "Ready to load" proposals load` | Verify the proposal (Step 2 of the skill) and run `mark-ready.js`, or `request-revision.js` to send it back. A `Needs revision` proposal waits for the curator's republish. A dry run also accepts `Proposed`, `Verification in progress` and `Needs revision` (it serves verification) and refuses only with `a dry run needs ...`. A resumed load is past this check |
| Branch matches the ticket's build | `The proposal's ticket is in build NN (rebuildNN)` | Check out the right rebuild branch, or change the ticket's milestone if the proposal is for another build |
| Rebuild branch current | `rebuildNN is not at origin/rebuildNN` | `git pull` the rebuild branch; loading onto a stale or diverged build hides work already merged |
| `load/<accession>` absent, or resumable | `already exists` | A previous run left it partway through, before its commit. Inspect, then `git branch -D load/<accession>`. If the branch already holds the load commit, this is not an error: re-running resumes instead (see [recovery](recovery.md)). |
| `load/<accession>` absent on origin | `origin/load/<accession> already exists` | An earlier load pushed it. Close its pull request, then `git push origin --delete load/<accession>`. Only a resume is allowed to overwrite that branch. |
| Contacts known where the proposal lives | `contact "<id>" not found in allContacts.xml` | A proposal on this branch is checked against this branch's contacts; a straggler against `origin/master`, since its own commit added them, and again after the cherry-pick has brought them onto `load/<accession>`. |
| Presenter file exists | `Presenter file missing` | The project has no presenter file; ask the user |
| Presenter name free | `already exists in Model/lib/xml/datasetPresenters/<Project>.xml` | The dataset was already loaded, or the name collides. Ask the user. A straggler is rendered from a copy of `origin/master` for this check, so one already loaded into this build is refused before any branch, file or ticket changes. |

## Why a straggler happens

`rebuild<NN>` is cut from `master` at build start. Any proposal merged to
`master` after that moment is not on `rebuild<NN>`. `load-proposal.js`
cherry-picks the proposal's commit(s) onto `load/<accession>` automatically so
only that proposal comes over, then renders and deletes it as usual. Only
commits in `rebuild<NN>..origin/master` are considered, so an earlier build's
propose and load commits for the same accession are left behind. If the
cherry-pick conflicts (`Cherry-pick conflicts in: ...`), the branch is left
mid-pick; the user resolves and continues the cherry-pick or runs
`git cherry-pick --abort`, then deletes the branch and reruns
`load-proposal.js` from scratch.
