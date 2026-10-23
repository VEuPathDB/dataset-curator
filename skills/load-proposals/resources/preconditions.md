# Preconditions

`load-proposal.js` checks these in order and stops at the first failure with
the exact fix.

| Check | Failure message contains | Fix |
|---|---|---|
| Rebuild branch named | `rebuildBranch must name a rebuild branch` or `--rebuild-branch rebuildRR is required` | Ask the loader which rebuild this is; a `Build NN` milestone is a release and never names it |
| Working tree clean | `working tree is not clean` | User commits or stashes. On `load/<accession>` the message is `A previous load left uncommitted changes`, and it names the checkout and branch delete that start the load over. |
| Proposal exists | `No proposal found at Proposals/<accession> on origin/master` | Wrong accession, the proposal PR was never merged, or `clean-proposals` already removed it |
| Proposal has a ticket | `has no ticket, so it has no build` | The build is read from the ticket's milestone. Record the ticket in the proposal's `manifest.json` on master |
| Project Status field ready | `has no single-select field "Status"`, `has no option "<option>"`, or `Cannot read project` | Add the missing options to the project's Status field by hand; for a scope or permission error run `gh auth refresh -s project` |
| Ticket has a build milestone | `has no "Build {build}" milestone` | The message names the issue. Set a `Build NN` milestone on it to choose the build |
| Ticket verified | `is at "<option>"; only "Ready to load" proposals load` | Verify the proposal (Step 2 of the skill) and run `mark-ready.js`, or `request-revision.js` to send it back. A `Needs revision` proposal waits for the curator's republish. An `Initial draft` ticket gets an explanation: its PR is still open, or it was merged without moving the card to `Proposed`. A dry run also accepts `Proposed`, `Verification in progress` and `Needs revision` (it serves verification) and refuses only with `a dry run needs ...`. A resumed load is past this check |
| On the rebuild branch | `Expected to be on rebuild<RR>` ... `Loading targets rebuild<RR>.` | Check out the rebuild branch named with `--rebuild-branch` |
| Rebuild branch current | `rebuildRR is not at origin/rebuildRR` | `git pull` the rebuild branch; loading onto a stale or diverged build hides work already merged |
| `load/<accession>` absent, or resumable | `already exists` | A `load/<accession>` without this accession's load commit at its head (cut from the rebuild branch) is refused with the start-over command: inspect, then follow it. If the branch holds that load commit, this is not an error: re-running resumes instead (see [recovery](recovery.md)). |
| `load/<accession>` absent on origin | `origin/load/<accession> already exists` | An earlier load pushed it. Close its pull request, then `git push origin --delete load/<accession>`. Only a resume is allowed to overwrite that branch. |
| Contacts known | `contact "<id>" not found in allContacts.xml` | Checked against `origin/master`'s `allContacts.xml`, the only place contacts are edited. The load commit copies that file onto `load/<accession>` when it differs. |
| Presenter file exists | `Presenter file missing` | The project has no presenter file; ask the user |
| Presenter name free | `already exists in Model/lib/xml/datasetPresenters/<Project>.xml` | The dataset was already loaded, or the name collides. Ask the user. The proposal is rendered from a copy of `origin/master` for this check, so one already loaded into this build is refused before any branch, file or ticket changes. |

## Delivery path

A dataset class whose delivery path does not end in `final` is refused
(`A delivery path must end in "final"`): `fromProvider`, which holds the
proposal archive, is created beside `final`. Fix the class's
`@@manualDeliveryDir@@` in `classes.xml`.
