# Load from master

Date: 2026-10-23
Status: design, awaiting review

## Problem

`rebuild02` is cut once and lives about a year; every `Build NN` website
release is loaded from it. Proposals always merge to `master` first. Load
today expects a proposal on the rebuild branch, and treats one only on
`master` as a "straggler" it cherry-picks onto `load/<acc>` and then deletes.
With a long-lived rebuild branch:

- every proposal is a straggler, so the exception is the only path;
- the cherry-pick range `rebuild02..origin/master` no longer excludes an
  accession's earlier propose commits (their copies on `rebuild02` have other
  ids), so re-loading an accession drags its old commits along;
- `rebuild02` collects proposal directories nobody needs there.

## Decisions

- **A proposal never goes onto a rebuild branch.** Load reads
  `Proposals/<acc>/` from `origin/master` and writes only what the build uses:
  the presenter, each organism's `<dataset>` entry, and `allContacts.xml`.
  Nothing is cherry-picked; "straggler" goes away.
- **The proposal is archived in manual delivery.** The whole proposal
  directory is copied to `fromProvider/proposal/`, where `fromProvider` is
  always the sibling of the class's `final` delivery directory, under the
  first organism. Every other organism's `fromProvider` is a relative symlink
  to the first one's.
- **Contacts are only edited on `master`.** Load replaces the rebuild
  branch's `allContacts.xml` with `origin/master`'s whole file, in the load
  commit. The rebuild branch never holds a contact `master` lacks, so
  merging it back cannot conflict once the two files are identical.
- **Build start** (`start-build.js`): sync contacts to the rebuild branch if
  they differ, merge the rebuild branch into `master`, then delete from
  `master` the proposals loaded for earlier releases.
- **Genome archival is deferred.** A dataset type with no dataset class has
  no delivery location and archives nothing for now; when genomes get a class,
  its `@@manualDeliveryDir@@` path (one organism) is used the same way.

## Load

`load-proposal.js --rebuild-branch rebuild<RR> [--dry-run] [--settle ...] <acc>`

1. Fetch. The proposal must be on `origin/master` (`No proposal ... on
   origin/master`); its manifest is validated against `origin/master`'s
   contacts.
2. Ticket, status, organism settlement, presenter-file and name checks as
   today, on the rebuild branch checkout.
3. Export `Proposals/<acc>/` from `origin/master` to a scratch directory;
   every render reads from there.
4. On `load/<acc>` cut from the rebuild branch, one commit:
   `Load <acc>: add <presenters> to <Project>[, <name> to <orgs>]`
   containing the presenter file, each organism's dataset file and, when it
   differs, `allContacts.xml` copied from `origin/master`. No proposal
   deletion.
5. Delivery under `.curation/delivery/`:
   - each organism's artifacts in its `final/` path, as today;
   - `<first organism's final>/../fromProvider/proposal/` holding the
     exported proposal directory;
   - for every other organism, `<its final>/../fromProvider` a relative
     symlink to the first organism's `fromProvider`.
   A class delivery path whose last segment is not `final` is refused.
   The hand-off note says to copy with symlinks preserved (`cp -a` or
   `rsync -a`).
6. Push, PR against the rebuild branch, ticket comment, `Loading in progress`,
   as today.

**Resume.** A run is a resume when the checkout is `load/<acc>`, the rebuild
branch is an ancestor of HEAD, and HEAD's subject starts `Load <acc>: `.
The proposal is re-exported from `origin/master` (propose refuses updates
from `Loading in progress` on, so it has not changed) to re-render the
delivery. The existing settle-as-committed check stays.

**Removed:** the straggler path (`commitsForPath`, `cherryPick`, the
cherry-pick recovery), the in-place path that read the working tree, and the
proposal deletion.

## Reading proposals

`listProposals` and `checkOrganisms` read `Proposals/` from `origin/master`
(through `git ls-tree` / `git show`), not the working tree, so they give the
same answer on any checkout. `markLoaded` reads the manifest from
`origin/master` instead of from the deletion in the load PR's head; it still
requires a merged PR from `load/<acc>`.

## Build start

`start-build.js --rebuild-branch rebuild<RR> --build <NN> <step>`, run by a
data loader from a VEuPathDatasets checkout; each step opens a PR, people
merge it, then the next step runs.

1. `sync-contacts`: if `allContacts.xml` on `origin/rebuild<RR>` differs from
   `origin/master`'s, branch `sync-contacts/rebuild<RR>-build-<NN>` from the rebuild
   branch, copy `master`'s file, push, open a PR into the rebuild branch.
   Otherwise report nothing to do.
2. `merge-back`: refuses while the contacts differ. Opens (or reports the
   open) PR from `rebuild<RR>` into `master`.
3. `clean-proposals`: refuses until `origin/rebuild<RR>` is an ancestor of
   `origin/master` (the merge-back merged). Branch `clean-proposals/build-<NN>`
   from `master`, delete each `Proposals/<acc>/` whose ticket's build is less
   than `<NN>` and whose status is `Post Load QA`, `Final QA` or `Done`; push;
   open a PR into `master` listing them. Proposals without a ticket, or not
   yet loaded, stay.

Skills push only to `proposal/*`, `load/*`, `sync-contacts/*` and
`clean-proposals/*`, and never to `master` or `rebuild*`.

`rebuild02` still holds the `Proposals/` it was cut with. Load ignores them,
and merging back cannot resurrect what `clean-proposals` deletes on `master`
because the rebuild branch never changes them.

## Error handling

| Situation | Outcome |
|---|---|
| Proposal not on `origin/master` | refused before any branch |
| Delivery path not ending in `final` | refused before any branch |
| Resume where HEAD is not this accession's load commit | refused; start-over command |
| `merge-back` while contacts differ | refused; run `sync-contacts` |
| `clean-proposals` before the merge-back merged | refused |
| Unreadable ticket during `clean-proposals` | that proposal is kept and reported |

## Testing

- Load: proposal only on `origin/master` loads; the commit holds presenter,
  dataset entries and `master`'s `allContacts.xml`, and no `Proposals/`
  change; a contact the proposal added on `master` is present on the load
  branch.
- Load of an accession loaded before (old commits on `master`) works and
  touches nothing of the earlier load.
- Delivery: first organism's `fromProvider/proposal/` holds the proposal;
  second organism's `fromProvider` is a relative symlink resolving to it;
  a non-`final` delivery path is refused.
- Resume: renders from `origin/master`; refuses a HEAD that is not the load
  commit.
- Merge-back simulation: after loads and new contacts on `master`,
  `sync-contacts` then merging the rebuild branch into `master` has no
  conflicts.
- `clean-proposals` deletes only earlier-release, loaded proposals.
- `markLoaded` finds the ticket from `origin/master`.

## Relation to other work

- After PR #28 (release vs rebuild).
- Before `verify-bulk-rnaseq` Plan B, whose load hook (Task 14) then calls
  validation on the exported proposal directory instead of in
  `renderAndCheck`'s in-place and straggler paths.

## Out of scope

- Genome delivery and archival.
- Removing the `Proposals/` that `rebuild02` was cut with.
