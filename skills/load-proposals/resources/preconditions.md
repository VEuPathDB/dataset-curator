# Preconditions

`load-proposal.js` checks these in order and stops at the first failure with
the exact fix.

| Check | Failure message contains | Fix |
|---|---|---|
| Working tree clean | `working tree is not clean` | User commits or stashes |
| Proposal exists anywhere | `No proposal found` | Wrong accession, or the proposal PR was never merged. A proposal only on `origin/master` is a straggler, not an error: it is cherry-picked onto `load/<accession>` during the load, automatically. |
| Branch matches target build | `the proposal targets build NN (rebuildNN)` | Check out the right rebuild branch, or this proposal is for another build |
| `load/<accession>` absent, or resumable | `already exists` | A previous run left it partway through, before its commit. Inspect, then `git branch -D load/<accession>`. If the branch already holds the load commit, this is not an error: re-running resumes instead (see [recovery](recovery.md)). |
| Presenter file exists | `Presenter file missing` | The project has no presenter file; ask the user |
| Presenter name free | `already exists in Model/lib/xml/datasetPresenters/<Project>.xml` | The dataset was already loaded, or the name collides. Ask the user. |

## Why a straggler happens

`rebuild<NN>` is cut from `master` at build start. Any proposal merged to
`master` after that moment is not on `rebuild<NN>`. `load-proposal.js`
cherry-picks the proposal's commit(s) onto `load/<accession>` automatically so
only that proposal comes over, then renders and deletes it as usual. If the
cherry-pick conflicts (`Cherry-pick conflicts in: ...`), the branch is left
mid-pick; the user resolves and continues the cherry-pick or runs
`git cherry-pick --abort`, then deletes the branch and reruns
`load-proposal.js` from scratch.
