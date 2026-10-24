---
name: verify-bulk-rnaseq
description: Data loading team - verify a merged bulk RNA-seq proposal before it loads. Claims it, runs validate-proposal (library type and depth, sample labels and runs across samplesheet, analysisConfig and STF, ApiCommonData's analysisConfig parser, study-wrangler STF validation, optional build fitness) with the validation workspace the data loader names, posts the report on the ticket, reviews warnings and presenter text with the user, then mark-ready or request-revision
---

# Verify a Bulk RNA-seq Proposal

Between merge (`Proposed`) and load (`Ready to load`). The automated part is
`validate-proposal.js`; the judgment part is yours and the user's.
See [proposal workflow](resources/proposal-workflow.md) for the statuses.

## Before you start

```bash
node scripts/check-workspace.js
git fetch
```

Run from the top of a VEuPathDatasets checkout. Validation reads the proposal
from `origin/master`, so the checked-out branch does not matter.

**Ask the data loader for the validation workspace.** It is the directory
holding `validation-env.json` (paths to ApiCommonData, perl, Rscript and the
R library with study.wrangler). Never guess it, search for it, or reuse one
from an earlier conversation without asking.

## Step 1: Pick and claim

```bash
node scripts/list-proposals.js --status proposed
node scripts/start-verification.js <ACCESSION>
```

Claiming is optional; it assigns the issue to the user and sets
`Verification in progress`.

## Step 2: Validate

```bash
node scripts/validate-proposal.js --workspace <dir> <ACCESSION>
```

Add `--against origin/rebuild<RR>` when the user names a rebuild branch, to
also run the load checks (organisms settle, names free, organism dataset
files present) without checking anything out. Organism stops come out as
warnings: a person settles them at load with `--settle`. Use `--no-post` only for a
trial run; mark-ready reads the posted report.

Verdicts: `pass`; `needs-review` (warnings: each needs the user's explicit
acceptance); `fail` (errors). Show the user every finding.

- `could not verify: ...` is a workspace problem, not a proposal problem:
  tell the data loader what is missing and re-run. Never mark ready around it.
- Depth, library type and consistency errors go back to the curator.

## Step 3: Review with the user

- Every warning in the report (the text says what can go wrong).
- SRA runs still resolve and any server paths exist (the validators read a
  proposal-time snapshot).
- Sample annotations read sensibly.
- The curator's notes on the ticket.
- Presenter text: `Proposals/<ACCESSION>/curated/presenter.json` on
  `origin/master` (display name, summary, description, contacts).

## Step 4: Decide

```bash
node scripts/mark-ready.js <ACCESSION> "<what was checked>"
node scripts/request-revision.js <ACCESSION> "<what the curator must fix>"
```

mark-ready refuses without a report for the current version of the proposal,
or when the latest report failed. Its comment records the verdict, tool
versions and the warnings the user accepted. A republished proposal returns
to `Proposed` and needs validating again.

## Rules

- Never pass a workspace the data loader did not name.
- Never mark ready on a `fail` verdict, and never accept a warning on the
  user's behalf.
- Never push; these scripts change only the ticket.
