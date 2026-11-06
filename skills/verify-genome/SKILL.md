---
name: verify-genome
description: Data loading team - verify a merged annotated genome assembly proposal before it loads. Claims it, preprocesses its NCBI annotation in the proposal's work area (genome-pipeline.js fetch, survey, build, finalize; the data loader runs the trial ISF load; functional), asks about ID changes before and after the trial, amends the proposal with its dataset entries and organism props by pull request (amend-proposal, publish-proposal, merge-proposal), runs validate-proposal (pipeline records, functional IDs, the amendment against the build, pipeline findings, entry shape, organism record), prepares the manual delivery from the work area with prepare-delivery, reviews it with the user, then mark-ready or request-revision
---

# Verify an Annotated Genome Proposal

Follow [the verification procedure](resources/verify-procedure.md) step by
step. This page adds what is specific to annotated genomes: preprocessing,
which makes the files a genome loads, and the amendment, which writes what
preprocessing settled into the proposal.

Only GenBank-annotated genomes are supported for now. Provider GFF annotation
comes later, and unannotated genomes are not handled by verify-genome:
amend-proposal refuses both.

## Workspace

This type's directory under the validation root is
`annotated-genome-validation/`. Its `env.json` names no repos and no build:

```json
{ "schemaVersion": 2, "repos": {}, "executables": {},
  "staging": { "host": "<ssh host>", "root": "<dataStaging root>" },
  "manualDelivery": { "host": "<ssh host>", "root": "<manualDelivery root>" } }
```

The proposal's work area is
`<root>/annotated-genome-validation/proposals/<PROPOSAL>/preprocess/`; below
it is `<work>`. Every `genome-pipeline.js` command takes it as `--workDir`.
**Never pass any other `--workDir`**: validation and prepare-delivery read only
this one, and mark-ready removes it.

Also ask the data loader for the ApiCommonData checkout (`<ApiCommonData>`).

## Order

1. Claim: `node scripts/start-verification.js <PROPOSAL>`.
2. Preprocess, with both ID prompts.
3. Amend the proposal by pull request.
4. Validate, prepare the delivery, review and decide, as the procedure says.

## Preprocess

```bash
node scripts/genome/genome-pipeline.js fetch <ACCESSION> --workDir <work>
node scripts/genome/genome-pipeline.js survey --workDir <work> --apiCommonData <ApiCommonData>
```

survey writes `<work>/survey.json` with its findings and a `suggestedRecipe`;
it does not write `recipe.json`. Show the user every finding, then copy
`suggestedRecipe` into `<work>/recipe.json` (unchanged, unless the user changes
it).

**ID prompt 1.** Ask the user: do any sequence, gene, transcript or protein IDs
need changing before the trial? `ids.default.tsv` appears after the first build
and shows the default IDs, so the first build is how the user sees them. A
change is a line in `<work>/ids.tsv` (header `level old new`, tab-separated;
`old` as NCBI wrote it) and `"ids": "ids.tsv"` in `recipe.json`; then run build
again. Needs are vague and occasional: ask, never assume.

```bash
node scripts/genome/genome-pipeline.js build --workDir <work> --apiCommonData <ApiCommonData>
node scripts/genome/genome-pipeline.js finalize --workDir <work> --apiCommonData <ApiCommonData>
```

**The trial is the data loader's to run**, never yours: it writes a shared
database. Give them the command, with the GUS image and `gus.config` they use
and the proposal's NCBI taxon id:

```bash
node scripts/genome/genome-pipeline.js trial --workDir <work> --image <image> --gusConfig <gus.config> --taxonId <taxon id>
```

It undoes its rows at the end. `trial --undo` is needed only after `--keep` or
a failed trial, and is also the data loader's to run:

```bash
node scripts/genome/genome-pipeline.js trial --workDir <work> --image <image> --gusConfig <gus.config> --undo
```

Wait for them to say the trial passed, then:

```bash
node scripts/genome/genome-pipeline.js functional --workDir <work>
```

**ID prompt 2.** Show the user the built IDs (`final/<partition>/transcriptInfoAndIds`
and the functional files) and ask the same question. A change goes back to
`ids.tsv`, then build, finalize, the data loader's `trial` (after `trial --undo`
only if the earlier trial was kept or failed), and functional.

## Amend

```bash
node scripts/start-proposal.js <ACCESSION> --type genome-assembly
node scripts/amend-proposal.js --workspace <root> --organism orthomclAbbrev=<abbrev> <PROPOSAL>
node scripts/publish-proposal.js <PROPOSAL>
node scripts/merge-proposal.js <PROPOSAL>
```

start-proposal must report `update` mode. If it refuses because
`proposal/<PROPOSAL>` still exists (merged branches are kept), confirm with
the user that its pull request merged, then run the delete commands it prints.

`orthomclAbbrev` is never derived: ask the user for it (4 to 8 lowercase
letters, not used by another organism). If `familyRepOrganismAbbrev` in
`curated/organism.json` is empty, amend-proposal refuses: ask the user for
`--organism familyRepOrganismAbbrev=<abbrev>`, or, when this organism
represents its family, `--organism isFamilyRepresentative=true` with
`--organism familyNcbiTaxonIds=<taxon ids>` and
`--organism familyNameForFiles=<name>`. Any other organism prop can be set the
same way when the user says so.

amend-proposal prints every derived value with its source and the diff against
master. Review them with the user before publishing. Merge only when the user
says the pull request was reviewed; merge-proposal keeps the ticket at
Preprocessing. A re-run replaces the entries and the props it owns and keeps
everything else in `curated/organism.json`.

## Validate

The validators read the work area (`records`: the pipeline records agree and
the trial passed; `matchesBuild`: master's entries and constants are the
work area's; `ids`: every functional ID is one ISF loads;
`pipelineFindings`: build, trial and functional findings) and the proposal
(`entryShape`, `organismRecord`). The report records the pipeline records'
sha256s; prepare-delivery refuses a work area that changed since.

## Review with the user

- Build warnings and findings (`[build]`).
- Trial QA findings and profile (`[trial]`).
- Functional warnings and info (`[functional]`).
- The derived organism props and their sources (amend-proposal's output).
- The entries against the partitions: one sequence entry per partition, one
  features entry per partition ISF loads anything from.
- Presenter text: `Proposals/<PROPOSAL>/curated/presenter.json` on `origin/master`.

## Prepare the delivery

prepare-delivery copies each entry's files from the work area into `final/`:
the partition's `genome.fasta` (and `chromosomeMap.txt` for a chromosome
primary), `genome.gff` and `transcriptInfoAndIds`, and each functional file.
`delivery.json` records the pipeline records' sha256s, the trial database and
release, and the generator version.

## After mark-ready

mark-ready removes `proposals/<PROPOSAL>/`, the work area with it. At load,
`load-proposal.js` writes the new organism's file and its organism dataset in
the project file.

## Rules

- The shared procedure says never push. The one exception: the amendment's
  publish-proposal and merge-proposal push only `proposal/<PROPOSAL>`.
- Never run `trial` or `trial --undo`.
- Never pass a `--workDir` other than the proposal's work area.
- Never choose `orthomclAbbrev` or family props on the user's behalf.
