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
   1. create the ticket through the adapter with the manifest summary (or
      reuse the recorded one) and write its reference into the manifest
   2. commit `Proposals/<accession>/` and `allContacts.xml`
   3. push, open PR against master whose body starts `Part of <ticket>`
      followed by the manifest summary
   4. comment the PR URL on the ticket
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
create({title, body, build}) -> {system, id, url}
mention(ref) -> string   # how a PR body cites the ticket
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
- **Pull requests cite their ticket.** Publish creates the ticket before
  opening the PR, so both the proposal and load PRs open with
  `Part of <mention>` (`owner/repo#N` on GitHub, the issue URL on Redmine).
  GitHub cross-references the two; the ticket also gets the PR URL as a
  comment. Never a closing keyword: merging a proposal PR does not finish the
  ticket.

## Addendum: complete dataset records (2026-09-25)

A proposal must carry, or be able to derive from its own contents, everything
three consumers need: the presentation layer (presenter XML), the dataset
class instance (dataset XML), and the loading artifacts delivered to the
server. Phase 1 records decisions; Phase 2 generates every output from the
proposal alone.

### Identity lives once, in the manifest

The manifest gains three fields; every layer derives from them and none keeps
its own copy:

- `datasetClass`: `rnaSeqExperiment` for bulk RNA-seq (fixed per type).
- `name`: the experiment name. Readable, letters, digits and underscores, and
  never the accession (data loaders create a directory with it). A default of
  `<PrimaryContactSurname>_<year>` is offered; curators are expected to
  override it. Unique per organism: refused if `Datasets/.../<organism>.xml`
  already has a dataset of that class and name, or a proposal on master does.
- `version`: when the data last changed. GEO-linked RNA-seq uses the GEO
  series `Release-Date` (not the platform's); otherwise it is a required
  override until another source is fetched.

The presenter name is derived, not chosen: `${organismAbbrev}_${name}_rnaSeq_RSRC`,
matching the `datasetName` pattern of the class's `datasetLoader`.

### `curated/dataset.json`

`{ schemaVersion, props, source }`. `props` holds the class's per-dataset
properties; identity props (`projectName`, `organismAbbrev`, `name`, `version`)
come from the manifest and are not repeated. For `rnaSeqExperiment`:

| prop | derived from |
|---|---|
| `hasPairedEnds` | SRA `library_layout` (all PAIRED -> true; mixed is refused) |
| `isStrandSpecific` | sample annotations `strandedness`; `unknown` is refused |
| `fromSRA` | `source.type === "sra"` |
| `limitNU` | default 30 |
| `alignWithCdsCoordinates` | default false |

The schema is `classes.xml` in the checkout, read at write and load time: the
record must supply exactly the class's `<prop>` names, so a prop added to the
class fails every proposal that lacks it instead of being dropped silently.

`source` says where the reads come from, so the data loading team can reach
them from the proposal: `{ "type": "sra" }` (every run is an SRA/ENA/DDBJ run
accession), or `{ "type": "server", "paths": [...] }` / `{ "type": "url",
"urls": [...] }`. The skills validate the form only (accession pattern,
absolute paths, http(s) URLs). Checking that data exists on the server, and
placing it there, is the data loading team's job alone; no skill touches the
server.

### Phase 2 additions to load-proposals

In the same commit as the presenter insertion and proposal deletion:

- Append `<dataset class="rnaSeqExperiment">` to
  `Datasets/lib/xml/datasets/<Project>/<organismAbbrev>.xml`, with
  `$$projectName$$` and `$$organismAbbrev$$` as existing entries do. Refused if
  the organism file is missing or already has the name.

Outside git:

- Generate `analysisConfig.xml`, `samplesheet.csv` and the sample STF files from
  the proposal into `.curation/delivery/<Project>/<organismAbbrev>/rnaSeq/<name>/<version>/final/`
  in the checkout. The layout mirrors the class's `<unpack>` path,
  `@@manualDeliveryDir@@/<Project>/<organismAbbrev>/rnaSeq/<name>/<version>/final/`,
  which is read from `classes.xml`, not hard-coded.
- Print that target path and the read `source`, and put both in the load PR
  and the ticket comment. The data loading team copies the files, fetches or
  links the reads, and checks the result. No skill writes to or checks the
  server, so there is no `manualDeliveryDir` setting.

### Phase 1 changes

- `write-proposal.js` derives `dataset.json` alongside `presenter.json`; both
  take curator overrides from one `--overrides` file (`presenter`, `dataset`,
  `name`, `version` sections).
- Step 5 (delivery outputs) becomes a preview: `render-proposal.js --artifacts
  <dir>` writes the same files Phase 2 will write, into `.curation/delivery/`.
- The artifact generators move from skill scripts into the shared per-type
  module, reading only the proposal directory.

### Module shape

`renderers/<type>.js` becomes `dataset-types/<type>.js`, one module per type
exporting `datasetClass`, `derivePresenter`, `deriveDataset`,
`renderPresenter`, `renderDataset` and `renderArtifacts`. The code now does more
than render, and the name should say so.

## Addendum: manifest schemaVersion 2 (2026-09-30)

Supersedes the sections above where they conflict: `targetBuild`, the Redmine
backend, a single `organismAbbrev` for RNA-seq, and loading artifacts
generated at Phase 2.

### The build lives on the ticket

`targetBuild` leaves the manifest. `--build` sets only the ticket's
`Build <NN>` milestone. Phase 2 reads the milestone to choose `rebuild<NN>`,
filter `list-proposals --build`, and fill the presenter's
`<history buildNumber>`. A proposal whose ticket has no build milestone is
refused at load. Retargeting a proposal means moving its milestone; no commit.
`publish-proposal.js --build NN` supplies it when publish creates the ticket; a
`--build` that disagrees with an existing ticket's milestone is refused.
The ticket's title equals the pull request's title,
`[<project>] <datasetType> <accession>`, and carries no build.

Phase 2 routing therefore depends on `gh` answering. Loaders already need it
to open the load PR, so this makes an existing dependency hard rather than
adding one.

### Redmine is removed

GitHub is the only ticket backend: the Redmine adapter, its config, tests and
docs go. `TICKET_SYSTEMS` is `['github']`. The adapter seam stays so another
backend can be added, but none is kept half-tested.

### Organism fields belong to the dataset type

Each `dataset-types/<type>.js` declares its organism fields and validates them;
`manifest.js` no longer hard-codes `organismAbbrev`.

- genome-assembly keeps `organismAbbrev` (the organism is the assembly).
- bulk-rnaseq has `referenceOrganismAbbrev` and `additionalOrganismAbbrevs`
  (an array, possibly empty, of further organisms the reads are aligned to).
  Entries are distinct, letters and digits, and never repeat the reference.

Identity props in `dataset.json` and the presenter name use each organism in
turn; `referenceOrganismAbbrev` is the primary, not the only one.

### Sample identity

Three files name every sample by one internal id, and must agree on it.

- `sampleId` in the sample annotations is the internal id: the SRA
  `sample_title`, reduced to letters, digits, `_`, `.` and `-`, when every
  sample has one and the results are unique; otherwise the BioSample
  accession. The BioSample accession is always kept as `biosample`.
- `label` is the common display name. Replicates share it; that is how
  merging replicates is expressed. The default is `sample_title` with a
  replicate suffix (`_replicate_N`, `_repN`, `_RN`) removed, however the
  `sampleId` was chosen; only a sample without a title defaults to its
  `sampleId`. The curator confirms it, and a curator-chosen `label` is kept.
- A `label` never contains `|`, which separates it from the `sampleId` in
  analysisConfig. A title-derived label has each `|` replaced by a space
  (spaces collapsed, trimmed); a curator-chosen label with one is refused.
  Every analysisConfig value has exactly one `|`.
- A curator-chosen `sampleId` is exempt from the title rule and is always
  kept. The replicate suffix also matches after whitespace (`Sample rep1`).

### Curated loading artifacts

`write-proposal.js` writes these into `curated/`, beside `presenter.json` and
`dataset.json`:

- `samplesheet.csv`: nf-core style, `sample,fastq_1,fastq_2,strandedness`, one
  row per run, `sample` = `sampleId`. An SRA run appears once with `fastq_2`
  empty; downstream expands it to its paired files.
- `analysisConfig.xml`: the `samples` property lists `label|sampleId`.
- `entity-sample.tsv` and `entity-sample.yaml`: the sample STF, keyed by
  `sampleId`. The `SRA.ID.s.` variable is written only for an `sra` source.

They are authoritative: the proposal PR reviews them, a curator may edit them,
and Phase 2 copies them rather than regenerating. A hand edit is never
overwritten automatically: when a re-run of `write-proposal.js` would derive
something different from a curated artifact already in the proposal, it
refuses and names the files until the curator chooses, for all of them
(`--keep-edits` or `--replace-edits`) or per file (`--keep-edit <file>`,
`--replace-edit <file>`, each differing file exactly once). Kept files still
pass the check below, but that check covers ids, pairing and strandedness
only, so a kept file does not pick up label or factor changes from the
annotations. Claude asks; it never chooses. One shared check runs at
write, at publish and at load, and refuses on any mismatch:

- samplesheet column 1, STF `sample.ID` and the right-hand side of every
  analysisConfig value are the same set of ids, and each analysisConfig value
  is `label|sampleId` with exactly one `|`;
- samplesheet `fastq_2` is empty for every SRA row and, for server and url
  sources, present exactly when `hasPairedEnds` is true; its
  strandedness and analysisConfig `isStrandSpecific` agree with
  `isStrandSpecific` in `dataset.json`.

`render-proposal.js --artifacts` becomes a copy into `.curation/delivery/`
after that check, not a generator.

### Reads not in SRA

A `server` or `url` source is curated by hand, sample by sample:

- Each sample has `files`, a non-empty list of `{ "fastq_1", "fastq_2" }`
  (one entry per lane; `fastq_2` only when paired), instead of `runs`.
  File names are bare, with no directory: `dataset.source.paths` or `urls` says
  where they are, and the data loading team places them. The proposal never
  encodes server layout.
- `sampleId` is required from the curator; there is no SRA title or
  BioSample to derive it from. `biosample` is recorded only when given.
  `label` defaults to `sampleId`.
- An `sra` source needs `runs` and refuses `files`; `server` and `url` need
  `files` and refuse `runs`. One proposal uses one kind.
- The SRA metadata input is optional for these sources. Without it the
  presenter's `displayName`, `summary` and `methodology` are not derived, so
  the curator supplies the required ones as overrides.
- `hasPairedEnds` comes from the files: every entry has `fastq_2`, or none
  does; a mix is refused outright, with no override.
- File names may not contain commas or spaces, and a name may not repeat
  within the proposal.
- The samplesheet writes one row per file entry: `sampleId`, `fastq_1`,
  `fastq_2` (or empty), strandedness.
- The proposal is named by an identifier the curator gives: a BioProject
  when there is one. The presenter links to NCBI BioProject only when the
  accession has that form (`PRJ[NED][A-Z]\d+`).
- This is human-in-the-loop territory: Claude asks for the sample names,
  labels, file names and read location over as many turns as it takes, shows
  them back as a table, and writes the annotations only on the curator's yes.
  What downstream consumes is the curated artifacts, so the agreement check
  is the gate, not the provenance of the values.

### Presenter

`graphXAxisSamplesDescription`, a short description of the samples, is a
required RNA-seq injector prop. The skill drafts it from the factor display
names; the curator confirms. Empty is refused at write and at load.

`hasMultipleSamples` is derived as `true` when there is more than one sample.
`isDESeq` is derived as `true` only when the samples include biological
replicates: some label is shared by two or more samples. Either can be
overridden.

### Phase 2 per organism

For the reference organism and each additional one, in the same load commit:

- a `<dataset class="rnaSeqExperiment">` in that organism's
  `Datasets/lib/xml/datasets/<Project>/<org>.xml`;
- a presenter named `${org}_${name}_rnaSeq_RSRC`;
- a copy of the curated artifacts under
  `.curation/delivery/<Project>/<org>/rnaSeq/<name>/<version>/final/`.

Write and load refuse if any organism file is missing or already has a dataset
of that class and name.

### Migration

No v1 reader. The only v1 proposal, PRJNA749283 (VEuPathDatasets#75, not
merged), is rewritten with the v2 skill before it merges.

## Addendum: status on the project, labels name the dataset type (2026-10-01)

Supersedes "Labels remain the only status the skills read" (Revisions,
2026-09-25).

- **Status is the project's Status field.** Each issue is an item in the
  configured GitHub Project; its single-select Status is the status the skills
  read and write: `proposed` → `Proposed` (Phase 1 complete), `loading` →
  `Loading in progress` (Phase 2 in progress), `done` → `Done`.
  `ticket.github.project` is required. Reading or setting status fails loudly; there is no
  warn-and-continue mirror any more. The options are added to the field by
  hand; the skills never edit the field definition.
- **Labels name the dataset type.** An issue gets one label per dataset type,
  from a config map (`bulk-rnaseq` → `rnaseq`, `genome-assembly` → `genome`).
  The label is created on first use, as build milestones are. A dataset type
  missing from the map is refused at publish.
- The old `proposal` / `loading` / `loaded` labels are retired.

### Lifecycle: verification and QA

Publish files the ticket at `Initial draft` while the first version is
worked on in its PR. Merging moves it to `Proposed`, but merging is not
verification: a person verifies it later, and only a verified proposal loads.
After the load, QA and release are human steps.

Initial draft → Proposed (at merge) → Verification in progress → Ready to
load / Needs revision → Loading in progress → Post Load QA → Final QA → Done.

| Status | Project option | Set by | Meaning |
|---|---|---|---|
| `draft` | `Initial draft` | `publish-proposal` (create, a fresh re-run, the post-create recovery) | Proposal PR open; first version in progress |
| `proposed` | `Proposed` | `merge-proposal`, or the person merging, by hand | Merged, awaiting verification; also an update PR of a merged proposal |
| `verifying` | `Verification in progress` | `start-verification` (optional) | Claimed: the issue is assigned to the verifier |
| `revision` | `Needs revision` | `request-revision`, after verification or review | Sent back to the curator with a reason |
| `ready` | `Ready to load` | `mark-ready`, after verification | Verified; the only status load accepts |
| `loading` | `Loading in progress` | `load-proposal` | Load PR open |
| `qa` | `Post Load QA` | `mark-loaded`, after the load PR merges | Loaded; the data loaders check it |
| `finalqa` | `Final QA` | the data loaders, by hand | Final check |
| `done` | `Done` | the outreach team, by hand | Released |

The option names are the Dataset Curation board's exactly. They are added to
the field by hand; publish and load first run a read-only check that the
field and every option exist. No skill sets `Final QA` or `Done`.

- **Merging.** `merge-proposal <accession>` is the scripted merge, used
  whenever Claude is asked to merge a proposal PR (never `gh pr merge`
  directly). It checks gh and the project, finds the open PR from
  `proposal/<accession>` fail-closed and requires it to target master, reads
  the ticket from the manifest at the PR's head commit (fetching
  `refs/pull/<n>/head` if needed; master's manifest on a re-run), needs
  `Initial draft` or `Proposed`, merges with a merge commit keeping the branch
  (`gh pr merge <branch> --merge`), confirms GitHub reports that PR merged (a
  queued or pending merge is refused with the ticket unchanged), then comments
  `Merged <url>` once and sets `Proposed`. A re-run after the merge finishes
  the note and status; an unmergeable PR is refused with the ticket
  unchanged. A person merging in the GitHub UI moves the card by hand.
- **A merged draft.** Because manual merges set the status by hand, a merged
  proposal can be left at `Initial draft`. start-verification, mark-ready and
  request-revision check for a merged PR from `proposal/<accession>` into
  master (fail-closed): merged, they continue as from `Proposed` and print
  `The proposal PR <url> is merged but the ticket was still at "Initial
  draft"; continuing as Proposed.`; not merged, they refuse, since review
  happens on the PR. start-proposal and publish treat a merged draft like
  `Proposed`; load and dry run refuse it with an explanation.
- **Verification** is a checklist with two outcomes.
  - `start-verification <accession>` claims it first, optionally: it refuses
    unless the proposal is on origin/master, no update PR from
    `proposal/<accession>` is open (a failed lookup refuses too), and the
    ticket is `Proposed`; it assigns the issue to the current gh user and
    sets `Verification in progress`.
  - The automated part is `load-proposal --dry-run <accession>`, which
    changes nothing and so accepts `Proposed`, `Verification in progress`,
    `Ready to load` or `Needs revision`: organism dataset files present on
    the target rebuild, no name collisions, curated artifacts in agreement.
    The human part: reads reachable, sample annotations sensible, presenter
    text reviewed.
  - `mark-ready <accession> ["<note>"]` makes the same merged and
    no-open-update checks and needs `Proposed` or `Verification in
    progress`; it comments `Verified: <note>` once when a note is given and
    sets `Ready to load`.
  - `request-revision <accession> "<reason>"` (or by hand), from `Proposed`,
    `Verification in progress`, `Ready to load` or `Needs revision`, comments
    `Needs revision: <reason>` once and sets `Needs revision`; on a ticket
    already there it only adds the reason. It can be used by a PR reviewer before an update
    merges; a first version (`Initial draft`) is reviewed on its PR.
- A proposal can be updated at `Initial draft`, `Proposed`, `Verification in progress`,
  `Ready to load` or `Needs revision`; publish refuses any other status
  before committing. A ticket only the proposal branch knows, with no project
  status (a project step that failed after the issue was filed), is repaired
  by the re-run unless its issue is closed, which publish refuses. Publishing
  an update returns a `Verification in progress`, `Ready to load` or `Needs
  revision` ticket to `Proposed` after the pull request, because an updated
  proposal needs verifying again; a `Proposed` ticket and the assignees are
  left alone.
- From `Loading in progress` on, a proposal is locked: no update,
  verification, dry run or load.
- `load-proposal` refuses anything but `Ready to load` before any branch
  exists. A resumed load is past this check.
- `list-proposals` shows every ticket's status read-only and filters with
  `--status`.
- `mark-loaded <accession>` refuses unless the load PR from `load/<accession>`
  has merged into a rebuild branch and the ticket is `Loading in progress`; it
  then comments the PR on the ticket once and sets `Post Load QA`. At `Post
  Load QA`, `Final QA` or `Done` it changes nothing. The ticket is read from
  the manifest just before the load commit deleted it, in the merged PR's
  head.
