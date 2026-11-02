# Sibling Proposals: One Study, Several Dataset Types

Status: draft, no open questions. John's decisions are listed at the end.

## Problem

One BioProject can hold experiments of several dataset types. PRJNA1306639
has both DNA-seq and RNA-seq. Once the first proposal for it exists, the
second is refused, because everything about a proposal is keyed by its
accession alone:

- `Proposals/<accession>/`, `proposal/<accession>`, `load/<accession>`,
  `verify/<accession>` and the validation workspace's `delivery/<accession>/`.
- The ticket title `[<projects>] <accession> <organisms>`.
- `assertNoOtherProposalFor`, which refuses any proposal sharing an external
  id with another one, whatever its type.
- `validate`, which requires the proposal directory to equal the accession.

The dataset XML is not the obstacle. `datasetNameExists` matches on class
and name, and dataset names carry a class suffix
(`<abbrev>_<name>_rnaSeq_RSRC` vs `<abbrev>_<name>_dnaseqExperiment_RSRC`),
so siblings never clash in an organism file.

The orphan branches `proposal/GSE82060_Foxy` and `proposal/GSE82060_Fsol`
show the ad hoc suffix workaround already being reached for.

## Non-goal: a shared presenter

Each dataset keeps its own presenter. Of 3,271 presenters in ToxoDB,
PlasmoDB, FungiDB, VectorBase and TriTrypDB on master, none has
templateInjectors of more than one class. A presenter has a single
`type`/`subtype`, which would misdescribe one of two mixed datasets.
What siblings genuinely share is study text (description, contacts,
pubmedIds); reusing it is a follow-up, below.

## Design

### Proposal id

A proposal's id is its directory name under `Proposals/`. It is derived,
never chosen:

- `<accession>` when no other proposal uses that name, otherwise
- `<accession>_<datasetType>`.

No other form is valid. Existing proposals keep their accession as their id;
nothing on master moves, and the manifest gains no field.

`validate(m, { dirName })` accepts a directory named `m.accession` or
`m.accession + '_' + m.datasetType`, replacing the equality check.
Free-form suffixes fail.

### Identity is content, not path

A proposal is identified by `(datasetType, external ids)`. The path is a
handle.

`assertNoOtherProposalFor(git, proposalId, datasetType, ids)` refuses only
when another proposal shares an id **and** has the same `datasetType`. A
proposal branch whose manifest is not yet written has an unknown type and
still refuses, as today.

### Allocation and resolution

`start-proposal.js <accession> --type <datasetType> [--external-id ...]
[--force-update]`; `--type` becomes required.

1. **Resolve.** Find the proposal whose manifest has this accession and
   type, on origin/master or on a proposal branch on origin. If found, its id
   is used, and the existing update flow (ticket status check) applies.
2. **Allocate.** Otherwise the id is the accession when
   `Proposals/<accession>` is absent on origin/master and no
   `proposal/<accession>` branch exists here or on origin; else
   `<accession>_<datasetType>`.
3. Guard, create `proposal/<id>`, and print `{ mode, proposalId,
   existingTicket? }`.

The skills pass `proposalId` to every later script.

### Accession becomes proposal id

These take the proposal id where they take the accession today. For every
existing proposal the two are equal, so behaviour is unchanged:

- `proposalRelativePath`, `proposalBranch`, `manifestRelativePath`,
  `readOnRef`, `readTicketOnRef`, `manifestOn`.
- `loadBranch`, `verifyBranch`, `openVerifyWorkspace`,
  `verifyWorkspaceDisposal`, `openDeliveryDir`.
- The positional argument of `publish-proposal`, `merge-proposal`,
  `start-verification`, `validate-proposal`, `prepare-delivery`,
  `mark-ready`, `request-revision`, `load-proposal` and `mark-loaded`.
  `render-proposal` already takes the proposal directory.
- `write-proposal.js` gains `--proposal <id>`, defaulting to `--accession`.
- The ticket title becomes `[<projects>] <proposalId> <organisms>`. Siblings
  otherwise get identical titles, and `findIssueByTitle`'s exact-match
  recovery would return the wrong issue.
- The load commit subject (`Load <proposalId>: ...`) and
  `presenterNamesFromCommit` use the id.
- `list-proposals` prints the id, then the accession.

Unchanged:

- `dataStaging/<accession>/` stays per accession and may be shared by
  siblings; each manifest's `dataStaging` list names its own files with
  sha256.
- `organisms[].source: { proposal: "<assembly accession>" }`. A genome
  assembly accession has one genome-assembly proposal, so its id is always
  its accession.
- `name` must still not contain the accession; the id is not checked.

### Skills

The `propose-*` skills pass `--type` to `start-proposal.js` and use the
printed `proposalId` thereafter. `verify-bulk-rnaseq` and `load-proposals`
already work from proposal listings and tickets, and pass the id they read
there.

## Testing

- The id rule: allocation when free, when taken by another type, and
  resolution of an existing sibling on master and on a branch.
- `validate`: bare accession, `<accession>_<datasetType>`, a free-form
  suffix (refused), and a suffix naming another type (refused).
- The guard: a different type sharing a BioProject passes; the same type is
  refused; an untyped branch is refused.
- Sibling ticket titles differ.
- End to end: the PRJNA1306639 DNA-seq proposal beside its RNA-seq sibling.

## Follow-up (not in this change)

In Phase 1, offer a sibling's `presenter.json` text fields (description,
contacts, pubmedIds) as the starting point for a new proposal.

## Version

2.7.0: `start-proposal.js` requires `--type`.

## Decisions

- One presenter per dataset; no shared presenter (no precedent in 3,271).
- Flat directories; no type-nested layout and no migration of the 44
  existing proposals.
- Id rule (a): the accession when free, `<accession>_<datasetType>` when
  taken.
- `dataStaging/<accession>/` stays shared between siblings.
