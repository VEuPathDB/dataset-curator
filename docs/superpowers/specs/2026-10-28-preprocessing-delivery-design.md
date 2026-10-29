# Preprocessing Owns Manual Delivery

## Problem

Load does two unrelated jobs. It renders XML into a rebuild branch (presenter,
dataset entry, `allContacts.xml`), and it writes the manual delivery files
(`final/`, the `fromProvider/` archive, the handoff note) under
`.curation/delivery/`. The delivery files depend on decisions load makes on the
spot (organism settlement), so the files a person copies to the server and the
XML that loads are only tied together by one run of one command.

Delivery also has to grow: files too large for git (GFF, full phenotype
tables, FASTQ not in SRA) arrive in `yew:/veupath/dataStaging/<ACCESSION>/`,
and sample annotations (STF) belong in per-type corpora under
`@@manualDeliveryDir@@/common/<type>/sampleDetailsForEda/`, not in `final/`.

## Decisions

- Preprocessing (ticket status `Preprocessing`) builds the whole delivery tree
  locally. Load renders XML, presenter and contacts only.
- Preprocessing settles organisms; load enforces that settlement and never
  settles. `--settle` moves from load to `prepare-delivery.js`.
- Decisions made during preprocessing that change what loads (dataset class,
  class props, version) are made in the proposal through the normal update
  path: `proposal/<ACCESSION>` branch, PR, a person merges.
- No skill writes to the server. People run the printed `rsync` and corpus
  commands. Skills may read the server over ssh.
- STF corpus releases are `YYYY-MM`, taken from the due date of the ticket's
  `Build NN` milestone.
- Every dataset has a dataset class. This spec implements bulk-rnaseq and
  dnaseq; genome classes and genome delivery are the next spec.

## Flow

```
Proposed ──start-verification──▶ Preprocessing
  [amend the proposal if needed → publish-proposal → PR → person merges]
  validate-proposal.js     report only, no other side effects
  prepare-delivery.js      settle organisms, build delivery/<ACCESSION>/, write delivery.json
  … preprocess in workspace/, re-validate as needed …
  mark-ready.js            needs a current report and a current delivery.json;
                           comment carries the delivery record and the handoff
──▶ Ready to load
  person: rsync the delivery tree to @@manualDeliveryDir@@
  load-proposal.js         XML + presenter + allContacts; enforces the record;
                           prints the type's corpus step
──▶ Loading in progress ──▶ Post Load QA
  start-build clean-proposals also removes delivery/<ACCESSION>/
```

A proposal update published while its ticket is at `Preprocessing` stays at
`Preprocessing`, since the verifier made it. From `Ready to load` it returns
to `Proposed`, as today. Any merge changes the proposal tree, which makes the
report and `delivery.json` stale.

## Workspace

The delivery tree lives in the per-type validation workspace, beside
`proposals/`, and survives `mark-ready` (which still removes only
`proposals/<ACCESSION>/`).

```
<root>/rnaseq-validation/
  env.json
  repos/  proposals/  loads/                     # unchanged
  delivery/<ACCESSION>/                          # paths relative to @@manualDeliveryDir@@
    delivery.json
    <Project>/<abbrev>/rnaSeq/<name>/<version>/
      final/                                     # rendered loading artifacts
      fromProvider/                              # first organism only
        <ACCESSION>/                             # Proposals/<ACCESSION>/ from origin/master
        <staging files>                          # from dataStaging/<ACCESSION>/
      workspace/                                 # preprocessing scratch; created once, never touched again
    <Project>/<abbrev2>/rnaSeq/<name>/<version>/
      final/
      fromProvider -> relative symlink to the first organism's fromProvider
      workspace/
    common/rnaSeq/sampleDetailsForEda/<YYYY-MM>/final/<datasetName>/entity-sample.{tsv,yaml}
```

The `rnaSeq/<name>/<version>/final/` part comes from the class's
`<unpack>ln -s @@manualDeliveryDir@@/...` line in `classes.xml`; a class path
not ending in `final` is refused, as today. `<ACCESSION>` is the proposal's
directory name under `Proposals/` (e.g. `PRJNA525426`, `GCA_964199285.2`).

### env.json additions

Two keys, optional for validation and required by `prepare-delivery.js` and
`assemble-stf-corpus.js`:

```json
{
  "staging":        { "host": "yew", "root": "/veupath/dataStaging" },
  "manualDelivery": { "host": "yew", "root": "/eupath/data/EuPathDB/manualDelivery" }
}
```

Access is `rsync`/`ssh` to the named host. Neither is guessed or defaulted; a
missing key names the key and asks the data loader.

## prepare-delivery.js

```
node scripts/prepare-delivery.js --workspace <root> --against origin/rebuild<RR> \
  [--settle <proposed>=<abbrev> ...] <ACCESSION>
```

Checks, all before anything is written:

1. The ticket is at `Proposed` or `Preprocessing` with no open update PR
   (`verifiableTicket`).
2. The latest report is current (its `proposalTree` matches `origin/master`)
   and not `fail`.
3. Every organism settles on `--against`, or by `--settle`. A stop is an
   error, not a warning.
4. The ticket's `Build NN` milestone has a due date. Its `YYYY-MM` is the
   corpus release. Without one: "set a due date on milestone Build NN; it
   picks the STF release month".
5. `env.json` has `staging` and `manualDelivery`.
6. Every staging file the proposal lists (see Staging) exists in
   `dataStaging/<ACCESSION>/`, and matches its sha256 when one is given.
7. For a type with a corpus, no settled dataset name is already published:
   for per-dataset corpora, not a directory in any release before
   `<YYYY-MM>` and not in `retired-datasets.tsv`; for per-organism corpora,
   no row of any release before `<YYYY-MM>` has its `dataset_id` (read-only
   ssh). The `<YYYY-MM>` release itself is not checked: anything there is this
   build's, so a re-delivery of the same dataset passes.

Then it writes `delivery/<ACCESSION>/`: `final/` from the type's
`renderArtifacts`, the proposal export and staging files in `fromProvider/`,
the symlinks, the corpus files, and `workspace/` if absent. A re-run replaces
everything except `workspace/`.

### delivery.json

```json
{
  "schemaVersion": 1,
  "accession": "PRJNA525426",
  "proposalTree": "<git tree id of Proposals/<ACCESSION> on origin/master>",
  "against": "origin/rebuild02",
  "build": "74",
  "release": "2026-10",
  "settlement": [{ "proposed": "tfakST1", "abbrev": "tfakST1" }],
  "staging": { "host": "yew", "path": "/veupath/dataStaging/PRJNA525426" },
  "files": [{ "path": "FungiDB/tfakST1/rnaSeq/.../final/samplesheet.csv", "sha256": "..." }]
}
```

`files` lists every regular file except under `workspace/`.

### Handoff

Printed by `prepare-delivery.js` and carried in the `mark-ready` comment:

```
rsync -a <root>/<type>-validation/delivery/<ACCESSION>/ \
  <manualDelivery.host>:<manualDelivery.root>/ --exclude delivery.json
```

`-a` keeps the `fromProvider` symlinks. This copies `workspace/` too, so
preprocessing output reaches the server.

## Staging

The proposal lists its staging files in the manifest:

```json
"staging": [{ "path": "annotation.gff3", "sha256": "..." }]
```

Paths are relative to `dataStaging/<ACCESSION>/`; `sha256` is optional. A
proposal with no `staging` list needs no staging directory. The proposal
checks (`write-proposal`, validate) check the list's shape; only
`prepare-delivery.js` checks the server. For bulk-rnaseq, a `server` source
requires a staging list covering every file the samplesheet names.

## Dataset types

Each type with a dataset class declares:

- `renderArtifacts(proposalDir, organism)`: `final/` files only. bulk-rnaseq
  drops `sample-annotations-stf/` from it.
- `corpus` (optional):
  - `root`: relative to `@@manualDeliveryDir@@`
  - `layout`: `per-dataset` or `per-organism`
  - `files(proposalDir, organism)`: the STF files for that organism

| Type | `corpus.root` | `layout` | Delivered to |
|---|---|---|---|
| bulk-rnaseq | `common/rnaSeq/sampleDetailsForEda` | per-dataset | `<YYYY-MM>/final/<datasetName>/` |
| dnaseq | `common/dnaSeq/sampleDetailsForEda` | per-organism | `<YYYY-MM>/incoming/<datasetName>/<abbrev>/` |

`<datasetName>` is the settled dataset name (`<abbrev>_<name>_rnaSeq_RSRC`).

## STF corpus

### rnaseq (per-dataset)

A release holds each dataset as a real directory in the release it first
appeared in and as a symlink in later ones. `make-cumulative-links.sh
<YYYY-MM>` (in the corpus root, maintained by the data loading team) backfills
the links and moves `latest`. It is idempotent and skips names already in the
release, so datasets may be copied in before or after it runs.

Corpus step, printed by load: `ssh <host> '<root>/common/rnaSeq/sampleDetailsForEda/make-cumulative-links.sh <YYYY-MM>'`.

### dnaseq (per-organism)

A release's `final/<Project>/<abbrev>/` holds `entity-sample.tsv`,
`entity-sample.yaml` and `study.yaml` for every dnaseq sample of that
organism, across datasets. Each row's `dataset_id` is `DS_` + the first 10 hex
characters of sha1(dataset name). Releases are full copies.

Preprocessing delivers per-dataset fragments to `<YYYY-MM>/incoming/`.

Corpus step, printed by load:
`node scripts/assemble-stf-corpus.js --workspace <root> --type dnaseq --release <YYYY-MM>`.

`assemble-stf-corpus.js`:

1. rsyncs down (read-only) the newest release `final/` before `<YYYY-MM>` and
   `<YYYY-MM>/incoming/`, into `<root>/dnaseq-validation/corpus/<YYYY-MM>/`.
2. Per organism: starts from the base release's files, replaces rows by
   `dataset_id` with the fragments' rows, unions YAML variables (a variable
   defined differently by two sources stops the run), and keeps the base
   `study.yaml` or generates one for an organism new to the corpus.
3. Validates each changed organism with study-wrangler.
4. Prints `rsync -a --delete <local>/<YYYY-MM>/final/ <host>:<root>/common/dnaSeq/sampleDetailsForEda/<YYYY-MM>/final/`.

The output is a pure function of the base release and `incoming/`. It never
reads the release's own `final/`, so re-running after more loads, in batches,
or after removing a fragment rebuilds the release exactly.

## mark-ready

For a type with a dataset class, `mark-ready.js` also refuses unless
`delivery/<ACCESSION>/delivery.json` exists and its `proposalTree` matches the
current report's. Its ticket comment gains, after the existing text, the
handoff and a machine-readable block:

~~~~
<!-- dataset-curator delivery record -->
```json
{ "schemaVersion": 1, "proposalTree": "...", "against": "origin/rebuild02",
  "settlement": [...], "release": "2026-10", "deliverySha": "<sha256 of delivery.json>" }
```
~~~~

Load reads the latest such block, as `latestReport` does for reports.

It never removes `delivery/<ACCESSION>/`.

## Load

Removed from `load-ops.js`: `deliver()`, `archiveProposal`, `handoffNote`,
`--delivery-base`, `--settle`. `artifacts.js` moves to preprocessing.

New preconditions, before any branch exists:

1. The latest delivery record on the ticket exists, parses, and its
   `proposalTree` matches `origin/master`. Otherwise: "run prepare-delivery.js
   and mark-ready.js again". This also catches proposals marked ready before
   this change.
2. Its `against` is the rebuild branch the ticket's build resolves to.
3. `settleOrganisms` on that branch, with the recorded settlement as `settle`,
   yields exactly the recorded abbreviations.

The resume check (`assertSettledAsCommitted`) stays. The PR body and ticket
comment cite the recorded settlement and print the type's corpus step; a batch
load prints each distinct corpus step once.

## Build start

`clean-proposals` takes `--workspace <root>` and, for each proposal it removes
from master, removes `<type>-validation/delivery/<ACCESSION>/`. Build start
runs on the machine that holds the validation workspace.

## Errors

- Every precondition failure names the fix: the command to run, the key to
  add, the milestone to date, or the file missing from dataStaging.
- ssh or rsync failures name the host and path and change nothing locally.
- `prepare-delivery.js` writes into a temporary sibling and renames into
  place (keeping `workspace/`), so a failure leaves the previous tree intact.

## Testing

- prepare-delivery: each precondition refuses with its message; the tree
  layout per organism; symlinks relative and surviving copy; re-run keeps
  `workspace/`; `delivery.json` checksums. ssh/rsync go through an injected
  runner, so tests use local directories.
- Release month from milestone due date; missing due date refuses.
- Dataset-name clash against corpus `latest`, `incoming`, retired names.
- mark-ready: refuses without, or with a stale, `delivery.json`; comment
  carries a block that load parses.
- Load: refuses without a record, on a different rebuild branch, on settlement
  drift; no delivery files written; corpus step printed once per batch.
- assemble-stf-corpus: merge by `dataset_id`; re-run identity; fragment
  removal; conflicting variable stops; new organism gets a `study.yaml`.
- Publishing an update at `Preprocessing` keeps the status.

## Out of scope

- Genome dataset classes and genome delivery (next spec).
- Any skill writing to the server.
- Changes to `make-cumulative-links.sh` or the existing corpus releases.
- chipSeq (same corpus model; added with its type).
