# Proposal Workflow

How dataset proposals move from a curator's machine into VEuPathDB builds.

## One repository

All configuration lives in **VEuPathDatasets**:

| Content | Path |
|---|---|
| Dataset proposals (until `clean-proposals`) | `Proposals/<accession>/` |
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
master        proposals and contacts land here, via PR, and stay until
  |           clean-proposals. Contacts are only ever edited here.
  |
  +-- rebuild02   cut from master once and kept across builds. Presenters and
  |               dataset entries are added here by load PRs; the proposal
  |               itself never is. Merged into master at each build start.
  +-- rebuild03   next database rebuild
```

Two numbers, not one: a `Build NN` milestone is a **website release**; a
`rebuild<RR>` branch is a **database rebuild**. One rebuild feeds many
releases, so a proposal's milestone never picks its rebuild branch.

### Phase 1: proposing (curators)

1. A `propose-*` skill works on branch `proposal/<accession>` off `master`.
2. It fetches metadata, curates contacts into `allContacts.xml`, and writes
   `Proposals/<accession>/` containing `manifest.json`, `inputs/` and `curated/`
   (including `presenter.json`).
3. It commits, pushes, opens a PR against `master`, and creates a ticket that
   links to the PR. The ticket is filed in the `Build NN` milestone given to
   `publish-proposal.js --build NN`, and the manifest records the ticket. The
   build lives on the ticket alone; to move a proposal to another build, change
   the milestone on GitHub.
4. **You merge the PR.** That is the one manual git step, and it is deliberate.

### What a proposal holds

A proposal carries, or can derive from its own contents, everything three
consumers need. It never carries rendered XML. `curated/` does hold files
`write-proposal.js` derives (`presenter.json`, `dataset.json` and, for RNA-seq,
the loading artifacts), because they are reviewed and may be hand-edited.

| Layer | Record | Becomes, in Phase 2 |
|---|---|---|
| Identity | `manifest.json`: `organisms` (proposed abbreviations, each with its project), `datasetClass`, `name`, `version`, ticket, contacts | shared by every layer below |
| Presentation | `curated/presenter.json`: names, attribution, descriptions, links, PubMed IDs, chosen injector props | the presenter in `Model/lib/xml/datasetPresenters/<Project>.xml`, of the first organism's project |
| Dataset class | `curated/dataset.json`: the class's per-dataset props (checked against `classes.xml`) and where the reads come from | the `<dataset>` entry in `Datasets/lib/xml/datasets/<Project>/<organismAbbrev>.xml` |
| Loading artifacts | `curated/<abbrev>/samplesheet.csv`, `analysisConfig.xml`, `entity-sample.tsv` and `.yaml` (per organism), derived from the sample annotations and `dataset.json`, checked to agree at write, publish and load | `final/` files and STF corpus files, written at preprocessing |

For SRA reads, entity-sample also carries each sample's BioSample and SRA
experiment (SRX) accessions as provenance, hidden in EDA.

Phase 2 renders every output from these records and the manifest alone, adding
the build number (read from the ticket's milestone) and the current site-wide
defaults. What the curator previewed
is what loads, and template changes never make a proposal stale. `inputs/`
stays in the proposal as provenance.

Genome assembly proposals carry identity and presentation only for now.

### Organism abbreviations

A proposal carries *proposed* organism abbreviations. Two rules:

- **Phase 1 proposes.** The curator names the rebuild branch
  (`--rebuild-branch rebuild<RR>`); the proposed abbreviations are checked
  against `origin/rebuild<RR>` and the genome proposals pending on
  `origin/master`, and the proposal is refused or warned.
- **Phase 2 settles.** Each abbreviation is settled against the rebuild
  branch; on any conflict a person decides. For RNA-seq and DNA-seq that is
  at preprocessing (`prepare-delivery.js --settle`), and load follows the
  recorded settlement. Genome assemblies are settled at load (`--settle`).

Genomes load before the datasets linked to them.

### Phase 2: loading (data loading team)

1. `rebuild<RR>` is cut from `master` once, when a database rebuild starts,
   and kept across builds. It does not need to contain any proposal.
2. Verification: a person checks each merged proposal with its type's
   `verify-*` skill (`verify-bulk-rnaseq`; genome proposals by hand for now),
   optionally claiming it first with `start-verification.js`. For a type with
   validators, `validate-proposal.js` runs them with the validation workspace
   the data loader names and posts a report on the ticket; `mark-ready.js`
   refuses without a current, non-failing one. For RNA-seq and DNA-seq,
   `prepare-delivery.js` then prepares the delivery (step 5) and `mark-ready.js`
   also refuses without the current delivery. The outcome is `mark-ready.js`
   (`Ready to load`) or `request-revision.js` (`Needs revision`, back to the
   curator). Merging a proposal PR is not verification; it moves the ticket
   from `Initial draft` to `Proposed`.
3. The `load-proposals` skill, run on `rebuild<RR>`, loads `Ready to load`
   proposals; the ticket's `Build <NN>` milestone names the release the
   presenter is rendered for. A proposal with no ticket, or a ticket with no
   build milestone, is refused. For each it reads `Proposals/<accession>/`
   from `origin/master`, creates `load/<accession>` from `rebuild<RR>`, renders a
   presenter into the first organism's project file and a dataset entry into
   each organism's own file, commits, pushes, opens a PR against
   `rebuild<RR>`, and sets the ticket's Status to `Loading in progress`. For
   RNA-seq and DNA-seq it settles organisms as the delivery record says and
   refuses a missing record, a record for another rebuild branch or earlier
   proposal, or drift.
4. The load commit holds only rendered XML, plus master's `allContacts.xml`
   when it differs from the rebuild branch's copy. The proposal is never put on
   the rebuild branch and nothing is copied across, so `rebuild<RR>` merges into
   `master` without proposal conflicts. Because contacts are edited only on
   `master`, merging back cannot conflict on them. Two load PRs open at once
   can conflict in `allContacts.xml`, though, when `master` gained contacts
   between their runs: the second conflicts once the first merges. Resolve by
   taking `origin/master`'s copy, which by rule holds every contact: on the
   load branch, merge `origin/rebuild<RR>`, run
   `git checkout origin/master -- Model/lib/xml/datasetPresenters/contacts/allContacts.xml`,
   then commit and push.
5. Preprocessing (`prepare-delivery.js`) writes the loading artifacts and the
   proposal archive (`fromProvider/<ACCESSION>/`, the sibling of `final`) to
   the validation workspace's `delivery/<ACCESSION>/`, settles organisms, and
   mark-ready records that on the ticket. **The data loading team copies the
   tree to the server with the posted rsync, fetches or links the reads, and
   checks the result.** Load renders XML only. No skill writes to or checks the
   server.

### Build start

At the start of each website build, run `start-build.js --rebuild-branch
rebuild<RR> --build <NN> <step>` in order. Each step opens a PR a person merges
before the next:

1. `sync-contacts` copies `master`'s `allContacts.xml` onto `rebuild<RR>`
   (branch `sync-contacts/rebuild<RR>-build-<NN>`), unless they already match.
2. `merge-back` opens a PR merging `rebuild<RR>` into `master`. It is refused
   while the two `allContacts.xml` copies differ.
3. `clean-proposals` (branch `clean-proposals/build-<NN>`, needs `--workspace
   <root>`) is refused until the merge-back has merged. It deletes from `master`
   each proposal whose ticket is in an earlier build and at `Post Load QA`,
   `Final QA` or `Done`, and removes those proposals' local `delivery/<ACCESSION>/`.
   The server's delivery archive keeps them.

Contacts are only edited on `master`, so the sync is a straight copy and the
merge-back cannot conflict on them. If `sync-contacts` reports an already-open
PR but `master` gained more contacts since, `merge-back` still refuses: update
that sync branch, or close it and re-run `sync-contacts`. If `master` gains
contacts after the merge-back PR is opened, that PR can conflict in
`allContacts.xml` the same way; resolve it the same way (take `origin/master`'s
copy), or re-run `sync-contacts` first. A step's branch left over from an
earlier run with no open PR is refused with the command to delete it.

### Things to know

- `Proposals/` on master holds pending and recently loaded proposals until
  `clean-proposals`. Ticket status is the truth for what is still to load.
- Ticket status is the issue's Status field on the configured GitHub Project.
  Issue labels name the dataset type (`rnaseq`, `genome`), not the status.

  | Status | Set by | Meaning |
  |---|---|---|
  | `Initial draft` | `publish-proposal.js`, which also assigns the issue to you | Proposal PR open; the first version is still being worked on |
  | `Proposed` | `merge-proposal.js`, or the person merging, by hand | Merged, awaiting verification (also an open update PR of a merged proposal) |
  | `Preprocessing` | `start-verification.js` (optional), which also assigns the issue to you | Someone is verifying and preprocessing it |
  | `Needs revision` | `request-revision.js`, or by hand | Sent back to the curator with a reason |
  | `Ready to load` | `mark-ready.js`, after verification (and, for types with validators, a current report; for RNA-seq and DNA-seq, the current delivery) | Verified; the only status load accepts |
  | `Loading in progress` | `load-proposal.js` | Load PR open |
  | `Post Load QA` | `mark-loaded.js`, after the load PR merges | Loaded; the data loaders check it |
  | `Final QA` | the data loaders, by hand | Final check |
  | `Done` | the outreach team, by hand | Released |

  The options are added to the field by hand; the skills never edit the
  field, and publish and load check it before changing anything.
- When Claude is asked to merge a proposal PR it runs `merge-proposal.js`,
  never `gh pr merge`: it merges and moves the ticket to `Proposed`. A person
  merging in the GitHub UI moves the card by hand. Verification commands
  accept a merged proposal still at `Initial draft` and say so.
- A proposal can be updated at `Initial draft`, `Proposed`, `Preprocessing`,
  `Ready to load` or `Needs revision`. Publishing the update returns the ticket to `Proposed` from `Ready to load` or
  `Needs revision`; at `Preprocessing` it stays there. An updated proposal needs
  verifying and preparing again. From
  `Loading in progress` on it is locked.
- The `propose-*` skills refuse to update a proposal whose ticket is at
  `Loading in progress` or later.
- Two open `proposal/*` PRs that both add the same new contact will conflict
  in `allContacts.xml` at the second merge. If your PR sits open while another
  proposal merges, re-run the contact search and rebase before merging.
- A genome loaded with `--settle` under another abbreviation keeps reserving
  its proposed abbreviation as a claim until `clean-proposals` removes its
  proposal from `master`.
- If `rebuild<RR>` holds load commits from the earlier flow, which deleted the
  proposal on the rebuild branch, the first merge-back deletes those proposals
  from `master` too. That is intended: they were loaded.

## Rules for Claude Code

- Run from the top of the checkout. Never `cd` into subdirectories.
- Never push to `master` or a `rebuild*` branch. Skills push only to
  `proposal/*`, `load/*`, `sync-contacts/*` and `clean-proposals/*` branches
  and open PRs.
- Stop and report on any git error. Do not retry with `--force`.
