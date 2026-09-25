# Two-Phase Dataset Proposals

**Date:** 2026-09-18
**Status:** Draft for review

## Problem

Datasets were authored directly into per-build release branches across three
repositories (ApiCommonDatasets, ApiCommonPresenters, EbrcModelCommon). Proposed
datasets sat unmerged in those branches for months, and merging them forward
produced conflicts, especially duplicate contacts in allContacts.xml.

Two things have changed:

1. The three repositories are archived. Their contents now live in
   **VEuPathDatasets**: dataset XML under `Datasets/`, presenters, contacts and
   classes under `Model/`.
2. Authoring splits into two phases. Phase 1 gathers data with a human in the
   loop and records a **proposal**. Phase 2, run by the data loading team at the
   start of a build cycle, turns proposals into presenter XML.

## Goals

- No long-lived branches carrying unmerged dataset content.
- Proposals are machine-readable and stay valid when XML templates change.
- Phase 2 is a stateless, dataset-type-agnostic transform that the loading team
  can run unattended, one proposal at a time or by target build.
- Ticket system is a swappable adapter. Redmine today, GitHub issues later.
- Adding a dataset type means adding one Phase 1 skill and one renderer.

## Non-goals (this iteration)

- Generating dataset definition XML under `Datasets/lib/xml/datasets/`. Phase 2
  renders presenters only. The manifest carries the fields dataset XML will
  need so this is an addition later, not a redesign.
- Writing `classes.xml`.
- Closing tickets. "Done" is the rebuildXX-to-master merge, which happens
  outside these skills.

## Branch model

```
master      proposals + contacts land here, continuously, via PR
  |
  +-- rebuild02   cut from master at build start; Phase 2 adds presenters and
  |               deletes the consumed proposals here; merged back to master
  |               when loading finishes
  |
  +-- rebuild03   next cycle
```

- Phase 1 writes to `proposal/<accession>` off master and opens a PR to master.
  A human merges it.
- Phase 2 writes to `load/<accession>` off `rebuild<targetBuild>` and opens a PR
  to that rebuild branch. Rendering the presenter and deleting the proposal are
  one commit, so master never sees one without the other.
- Proposals landing on master mid-cycle target the next build and wait.
- **Straggler:** a proposal for build NN that lands on master after rebuildNN
  was cut is not on rebuildNN. Phase 2 detects this, cherry-picks the proposal's
  commit from origin/master onto its own `load/<accession>` branch, and
  continues. Proposal, presenter and deletion arrive in one PR. Nobody pushes
  to a rebuild branch directly; a protected branch would block a human just as
  it blocks the skill. If the cherry-pick conflicts, Phase 2 stops and leaves
  the branch for inspection.
- While a build is in progress, master's `Proposals/` overstates the queue.
  Ticket status is the truth for in-progress work.
- If a proposal is edited on master after Phase 2 consumed it, merge-back hits
  a modify/delete conflict. Phase 1 refuses to update a proposal whose ticket is
  `loading` or `done`, which makes this rare.

## Repository changes in dataset-curator

- `veupathdb-repos/VEuPathDatasets` is the only required checkout.
  `check-repos.sh` is already repo-agnostic; skills call it with one argument.
- Paths used by skills:
  - `Model/lib/xml/datasetPresenters/<Project>.xml`
  - `Model/lib/xml/datasetPresenters/contacts/allContacts.xml`
  - `Model/lib/xml/datasetClass/classes.xml` (documented, not written)
- `shared/resources/curator-branching.md` is removed and replaced by
  `shared/resources/proposal-workflow.md`, describing the branch model above.
  It is synced into every skill that touches git.
- README.md, CLAUDE.md, docs/development.md and CLAUDE-skills-strategy.md drop
  every mention of the archived repositories.
- The "curator handles all git operations" rule is replaced: skills perform
  branch, commit, push and PR creation through a shared helper. Humans merge
  PRs. Skills never push to master or rebuildXX directly.

## The proposal bundle

Location: `Proposals/<accession>/` on VEuPathDatasets master. Accession is the
assembly accession for genome assemblies and the BioProject for bulk RNA-seq.

```
Proposals/PRJNA123456/
  manifest.json
  inputs/     raw fetched data, byte-identical to what the fetch scripts wrote
  curated/    curator decisions: sample_annotations.json, presenter-overrides.json
```

`curated/presenter-overrides.json` holds any curator edits to presenter text
(display names, attribution, summary, description, methodology, PubMed IDs,
injector properties). Renderers merge it over their defaults. Rendered XML is
never stored, so this is the only place a curator's wording survives.

The `inputs/` vs `curated/` split lets a future re-fetch or re-curate step
target one half without touching the other.

### manifest.json

```json
{
  "schemaVersion": 1,
  "accession": "PRJNA123456",
  "datasetType": "bulk-rnaseq",
  "project": "FungiDB",
  "organismAbbrev": "afumAf293",
  "targetBuild": "02",
  "ticket": { "system": "redmine", "id": "12345", "url": "https://..." },
  "contacts": { "primary": "brestelli", "additional": ["smith"] },
  "curator": "jbrestel@apidb.org",
  "createdAt": "2026-09-18T14:00:00Z",
  "skill": { "name": "propose-bulk-rnaseq", "version": "1.1.1" }
}
```

Field rules:

| Field | Rule |
|---|---|
| schemaVersion | Integer. Phase 2 refuses versions it does not know. |
| accession | Non-empty. Must equal the directory name. |
| datasetType | Must have a matching file in `renderers/`. |
| project | Must appear in `valid-projects.json`. |
| organismAbbrev | Non-empty string. No further validation yet. |
| targetBuild | Two or more digits; matched against `rebuild<targetBuild>`. |
| ticket | Present after publish. `system` is `redmine` or `github`. |
| contacts.primary | Non-empty contactId that exists in allContacts.xml. |
| contacts.additional | Array, may be empty, each present in allContacts.xml. |
| curator | Email. Taken from git config user.email. |
| createdAt | ISO 8601 UTC. |
| skill | Name and version of the Phase 1 skill that wrote it. |

`shared/scripts/manifest.js` exports `validate(manifest, {dirName, contactIds})` and
`read(proposalDir)` / `write(proposalDir, manifest)`. `read` and `write` inject
`dirName` from the proposal directory's own name, and callers supply `contactIds`
read via `contacts.js`. Validation runs on every write and every read.

## Phase 1 skills

`propose-genome-assembly` and `propose-bulk-rnaseq`, renamed from today's
`curate-*` skills. Data fetching, sample analysis and contact curation are
unchanged in substance.

### Intake

Project, accession, **target build**, **organism abbreviation**. Bulk RNA-seq
keeps its optional article PDF.

### Preconditions

- `check-repos.sh VEuPathDatasets` passes.
- Checkout is on master, clean, and up to date with origin.
- If `Proposals/<accession>/` exists on master, the skill reads the ticket
  status through the adapter. It proceeds as an update only when status is
  `proposed`. If that manifest records no ticket the status cannot be checked,
  so the skill stops and names the two ways forward: add the ticket to the
  manifest on master, or re-run with `--force-update`, which treats the
  proposal as `proposed`.
- `proposal/<accession>` exists neither locally nor on origin.

### Steps

1. Create `proposal/<accession>` off master (shared git helper).
2. Fetch steps as today, writing to `tmp/`.
3. Curate contacts as today, editing `allContacts.xml` in place. Record the
   contactIds.
4. Bulk RNA-seq only: sample analysis and delivery outputs, unchanged. The
   delivery directory stays outside git.
5. **Write proposal.** Copy fetched files into `Proposals/<accession>/inputs/`,
   curated files into `curated/`, write and validate `manifest.json` without
   the `ticket` field.
6. **Preview.** Run the matching renderer against the proposal directory and
   show the curator the presenter XML. Nothing from the preview is committed.
   This guarantees every proposal has rendered successfully once before Phase 2
   sees it.
7. **Publish.** One shared script:
   1. commit `Proposals/<accession>/` and `allContacts.xml`
   2. push, open PR against master with a manifest summary as the body
   3. create the ticket through the adapter with the PR link and summary
   4. write the ticket reference into the manifest, amend the commit, force-push
      the proposal branch
   5. print the PR and ticket URLs

   Publish is idempotent: re-running after a failure resumes, reusing the
   pushed commit, the open PR and the recorded ticket.

The curator merges the PR.

## Phase 2 skill

`load-proposals`, one skill for every dataset type.

### Invocation

By accession, or by target build. The build sweep lists `Proposals/*/manifest.json`
on the current branch with matching `targetBuild` and runs the single-accession
flow for each. One PR per proposal.

- The build sweep is skill-driven: Claude loops over `list-proposals` output and
  runs the single-accession flow per row. There is no sweep script to keep
  transactional.
- `list-proposals` is tolerant: a manifest that will not read or validate is
  reported alongside the table rather than failing the whole listing.
- `--dry-run` runs every precondition and the render, prints the presenter XML,
  and mutates nothing - the rehearsal before a sweep.

### Preconditions (a script checks all before touching anything)

- `check-repos.sh VEuPathDatasets` passes.
- Current branch is `rebuild<targetBuild>` and the tree is clean.
- `Proposals/<accession>/` exists on the current branch, or exists on
  `origin/master` (straggler). For a straggler the manifest is read from
  `origin/master` for the build check, and the commit(s) touching the proposal
  are recorded for cherry-picking.
- `load/<accession>` does not already exist, locally or on origin. Only a
  resume may overwrite the remote branch, and only with `--force-with-lease`.
- The rebuild branch is exactly at `origin/<rebuildNN>` after a fetch: ahead is
  as wrong as behind, since either hides what the load will be reviewed against.
- Contacts named by the manifest exist in the `allContacts.xml` of the ref the
  manifest was read from: this branch for a proposal already here,
  `origin/master` for a straggler, whose own commit added them. The straggler is
  re-checked against the working tree after its cherry-pick, which is what
  proves the contacts reached `rebuildNN`.
- A straggler's commits are bounded to `rebuildNN..origin/master`, so an earlier
  build's propose and load commits for the same accession stay behind; its
  presenter is rendered from a `git archive` export of `origin/master` into a
  scratch directory, before any branch or file is touched.
- No `<datasetPresenter name="...">` with the rendered name exists in the
  project file. Renderers are pure, so the render runs once for this check and
  again for the insert without side effects.

### Per proposal

1. Create `load/<accession>` off the rebuild branch. For a straggler,
   cherry-pick the recorded commit(s); on conflict, stop and name the files.
2. Read and validate the manifest.
3. Dispatch to `renderers/<datasetType>.js`. Insert the returned block into
   `Model/lib/xml/datasetPresenters/<Project>.xml` before the closing root tag.
4. `git rm -r Proposals/<accession>`.
5. One commit. Push. Open PR against the rebuild branch.
6. Through the adapter: comment on the ticket with the PR link, set status
   `loading`.

If anything fails after the branch is created, the branch is left for
inspection and the skill says how to delete it and rerun.

- A run that reached the load commit is resumable: detection is the load branch
  checked out, the proposal gone and at least one commit ahead of the rebuild
  branch. It re-pushes under a lease, reuses an open PR, and recovers the
  presenter name from the load commit's subject.
- Recovery footers are two-tier: past the commit the failure ends with "re-run
  to resume", anything earlier with the start-over commands, prefixed with
  `cherry-pick --abort` when a conflicted pick still holds the checkout.

### Renderer contract

`renderers/<datasetType>.js` exports `render(proposalDir) -> string`. The string
is a complete `<datasetPresenter>` element including the dataset-specific
injector section. A renderer reads only files under `proposalDir`, never
touches git, the ticket, or other files. Today's two `generate-presenter-xml.js`
scripts become the first two renderers with their `tmp/` reads repointed to
`inputs/` and `curated/`.

Renderers live in `shared/scripts/renderers/` and sync into both the Phase 1
skill that previews with them and `load-proposals`.

- Every renderer syncs into every propose skill, not just its own: manifest
  validation rejects a `datasetType` with no file in `renderers/`, so a skill
  missing a sibling renderer could not read a proposal of that type.

Renderers escape every free-text interpolation; identifiers (accession,
organismAbbrev, BioProject accession) are format-validated instead:
`escapeXml` for element text and attributes, `escapeForCDATA` inside CDATA.
`injectorProps` overrides may add props the defaults do not list, since
injector classes accept more props than the template shows; prop names are
validated and the render CLI warns on stderr about keys absent from the
defaults.

## Ticket adapter

`shared/scripts/ticket/index.js` reads config, selects a backend, and exposes:

```
create({title, body}) -> {system, id, url}
comment(ref, body)
hasComment(ref, text) -> boolean
commentOnce(ref, text) -> boolean
getStatus(ref) -> 'proposed' | 'loading' | 'done'
setStatus(ref, status)
```

- Publish and load are both idempotent, so a re-run must not repeat a
  notification: `commentOnce` posts only when `hasComment` does not already
  find the text, and the pull request URL in the body is the key.
- Status vocabulary is ours. Backends map it: Redmine to status IDs from
  config, GitHub to labels.
- `redmine.js` uses the REST API with an API key from `REDMINE_API_KEY`. It
  does not use the Redmine MCP server.
- `github.js` shells out to `gh` with `GITHUB_TOKEN` unset. The issues
  repository is configurable.
- A ticket reference always carries `system`, so a Redmine-era proposal keeps
  working after the switch to GitHub as long as the Redmine backend exists.

## Configuration

`curator.config.json` in the curation workspace directory (the current working
directory, next to `veupathdb-repos/`), because plugin users do not have this
repository checked out. A committed `curator.config.example.json` in this
repository is the template, and the filename is gitignored here:

```json
{
  "veupathdbRepos": "veupathdb-repos",
  "ticket": {
    "system": "redmine",
    "redmine": {
      "url": "https://redmine.apidb.org",
      "project": "apidb",
      "statusIds": { "proposed": 1, "loading": 2, "done": 5 }
    },
    "github": {
      "repo": "VEuPathDB/VEuPathDatasets",
      "labels": { "proposed": "proposal", "loading": "loading", "done": "loaded" }
    }
  }
}
```

Nothing else in the skills is environment-specific.

## Error handling

- Validate everything, print the plan, then mutate. No git or ticket mutation
  happens before all preconditions pass.
- master and rebuildXX are reached only through PRs, so a mid-run failure never
  leaves either half-written.
- Every stop message names the exact command to recover (delete branch, resolve
  the named conflict, fix manifest field).

## Testing

- Node's built-in test runner. Zero dependencies, per repo policy.
- Unit tests: manifest validator; each renderer against a fixture proposal in
  `resources/fixtures/`; adapter status mapping for both backends.
- Git helper tested against a throwaway local repository with a bare remote.
- Ticket backends tested against stubs, never live services.
- Roleplay tests per development.md for skill activation: "propose a new
  genome", "load proposals for build 02".

## Migration

- Existing `curate-*` skills are renamed, not duplicated. README symlink
  instructions update accordingly.
- No existing proposals exist, so no data migration.
- `package.json` `sharedFiles` gains entries for `proposal-workflow.md`,
  `manifest.js`, `git-ops.js`, `ticket/`, and `renderers/`.
- Version bumps to 2.0.0: the skill names and the git rule both change.

## Open items deferred to implementation planning

- Exact Redmine status IDs and project identifier for the config example.
- Whether the presenter name check in Phase 2 should also grep other project
  files (a dataset proposed under the wrong project).

## Revisions (2026-09-25, first real run)

- **The presenter record is structured and complete in Phase 1.** Every
  proposal carries `curated/presenter.json`, derived by `write-proposal.js`
  from the inputs plus curator overrides and validated against per-type
  required fields (RNA-seq also requires `shortDisplayName` and
  `shortAttribution`). The renderer contract splits in two: `derive` (Phase 1)
  and `render` (manifest plus record only). JSON rather than stored XML because
  it separates curator decisions from site policy (injector defaults and the
  build number are applied at load), insulates proposals from presenter-schema
  changes, and will also feed dataset XML generation. `inputs/` is provenance.
- **The workspace is the VEuPathDatasets checkout.** The `veupathdb-repos/`
  layout and per-workspace `curator.config.json` are gone. The team config
  ships in the plugin (`resources/curator.config.json`), a per-clone override
  goes at `.curation/curator.config.json`, and scratch files live under
  `.curation/`, excluded through `.git/info/exclude`.
- **GitHub tickets carry the build.** Issues are filed under a
  `Build <NN>` milestone and added to a GitHub Project whose status column
  mirrors the labels. Labels remain the only status the skills read.
