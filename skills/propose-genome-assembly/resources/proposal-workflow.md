# Proposal Workflow

How dataset proposals move from a curator's machine into VEuPathDB builds.

## One repository

All configuration lives in **VEuPathDatasets**:

| Content | Path |
|---|---|
| Dataset proposals (pending) | `Proposals/<accession>/` |
| Presenters | `Model/lib/xml/datasetPresenters/<Project>.xml` |
| Contacts | `Model/lib/xml/datasetPresenters/contacts/allContacts.xml` |
| Dataset classes | `Model/lib/xml/datasetClass/classes.xml` |
| Dataset definitions | `Datasets/lib/xml/datasets/<Project>/<organismAbbrev>/` |

Your curation workspace **is** a VEuPathDatasets checkout. Use an existing
clone or make one, and run the skills from its top directory:

```bash
git clone git@github.com:VEuPathDB/VEuPathDatasets.git
cd VEuPathDatasets
node <skill>/scripts/check-workspace.js
```

Scratch files (`.curation/tmp/`, `.curation/delivery/`) live inside the clone.
`check-workspace.js` adds `.curation/` to `.git/info/exclude`, so they never
show up in `git status` and no `.gitignore` change is needed in the repository.

## Branch model

```
master        proposals and contacts land here continuously, via PR
  |
  +-- rebuild02   cut from master when a build starts. Presenters are added and
  |               consumed proposals deleted here. Merged back to master when
  |               loading finishes.
  +-- rebuild03   next cycle
```

### Phase 1: proposing (curators)

1. A `propose-*` skill works on branch `proposal/<accession>` off `master`.
2. It fetches metadata, curates contacts into `allContacts.xml`, and writes
   `Proposals/<accession>/` containing `manifest.json`, `inputs/` and `curated/`.
3. It commits, pushes, opens a PR against `master`, and creates a ticket that
   links to the PR. The manifest records the ticket.
4. **You merge the PR.** That is the one manual git step, and it is deliberate.

Proposals do not carry rendered XML. They carry the data the renderer needs,
so template changes never make a proposal stale.

### Phase 2: loading (data loading team)

1. At build start, `rebuild<NN>` is cut from `master`. It already contains every
   proposal merged so far.
2. The `load-proposals` skill, run on `rebuild<NN>`, picks proposals whose
   `targetBuild` is `<NN>`. For each it creates `load/<accession>`, renders the
   presenter into the project file, deletes `Proposals/<accession>/`, commits,
   pushes, opens a PR against `rebuild<NN>`, and marks the ticket `loading`.
3. Rendering and deletion are one commit. Master never sees one without the
   other because `rebuild<NN>` is the only path back to master.

### Stragglers

A proposal for build NN that reaches master after `rebuild<NN>` was cut is not
on the rebuild branch. `load-proposals` detects this, cherry-picks the
proposal's commit from `origin/master` onto its own `load/<accession>` branch,
and continues. The cherry-picked proposal, the rendered presenter and the
proposal's deletion all arrive in one PR against `rebuild<NN>`. Nobody pushes
to a rebuild branch directly. If the cherry-pick conflicts, the skill stops,
leaves `load/<accession>` for inspection, and names the conflicting files.

### Things to know

- While a build is in progress, `Proposals/` on master overstates the queue.
  Ticket status is the truth for in-progress work.
- Editing a proposal on master after Phase 2 consumed it causes a modify/delete
  conflict at merge-back. The `propose-*` skills refuse to update a proposal
  whose ticket is `loading` or `done`.
- Two open `proposal/*` PRs that both add the same new contact will conflict
  in `allContacts.xml` at the second merge. If your PR sits open while another
  proposal merges, re-run the contact search and rebase before merging.

## Rules for Claude Code

- Run from the top of the checkout. Never `cd` into subdirectories.
- Never push to `master` or a `rebuild*` branch. Skills push only to
  `proposal/*` and `load/*` branches and open PRs.
- Stop and report on any git error. Do not retry with `--force`.
