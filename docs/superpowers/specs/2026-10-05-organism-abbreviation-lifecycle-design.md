# Organism Abbreviation Lifecycle

**Date:** 2026-10-05
**Status:** Draft for review
**Supersedes:** PR #14 (widen the organism abbreviation regex)

## Problem

Organism abbreviations key the organism dataset file
(`Datasets/lib/xml/datasets/<Project>/<abbrev>.xml`), every dataset name built
from them (`<abbrev>_primary_genome_RSRC`, `<abbrev>_<name>_rnaSeq_RSRC`) and
the delivery directories on the server. A wrong abbreviation silently
attaches a dataset to the wrong organism or clobbers an existing one.

Today Phase 1 records the abbreviation as a final value and validates only
its characters (`/^[A-Za-z0-9]+$/`). That check is both too strict and too
weak:

- Too strict: 131 of the 840 organism files use `-`, `_` or `.`
  (`bcinB05-10`, `acspSK_2022a`, `aellCBS707.79`), so valid proposals fail.
- Too weak: a well-formed abbreviation can still be a typo, name the wrong
  organism, or collide with an existing one.

Character rules cannot answer "is this the right organism". Only the
Datasets XML and the other proposals in the build can.

## Principle

Phase 1 **proposes** abbreviations. Phase 2 **settles** them, as a set, for
the whole build. Any conflict or uncertainty stops Phase 2 for a human.
Nothing resolves an abbreviation conflict automatically.

## Phase 1

### Genome assembly (new organisms)

The manifest records:

| Field | Required | Notes |
|---|---|---|
| `proposedOrganismAbbrev` | yes | a hint; never used as identity |
| `ncbiTaxonId` | if available | strongest identity signal |
| `species` | yes | scientific name |
| `strain` | yes, when the organism has one | |

Checks: the hint passes the shape check below. If it already names an
organism file in any project on the rebuild branch (see Cross-check source),
Phase 1 stops: the organism is either redundant or the abbreviation is wrong.
Abbreviations are unique across all projects.

### All other dataset types

RNA-seq today, more types later. Each organism the dataset applies to is
recorded as a proposed abbreviation and, when the organism is not yet
loaded, a link to the genome proposal that introduces it:

```json
"organisms": [
  { "proposedOrganismAbbrev": "pfal3D7", "source": "loaded" },
  { "proposedOrganismAbbrev": "pfalNEW1", "source": { "proposal": "GCA_000000000.1" } }
]
```

The link is what lets Phase 2 follow a renamed genome abbreviation to its
dependent datasets, and enforce load ordering. A string match alone cannot.

Cross-check, per organism:

| Found | Result |
|---|---|
| exact file `<Project>/<abbrev>.xml` on the rebuild branch | settled |
| `<abbrev>.xml` under a different project | error |
| a pending genome proposal with that `proposedOrganismAbbrev` | **warn**: unsettled; record the `source` link |
| none of these | error |

### Shape check

Applied to every proposed abbreviation, because it reaches file paths in
Phase 2: `/^[A-Za-z0-9][A-Za-z0-9._-]*$/`. This admits every abbreviation in
use today and refuses `/`, spaces, quotes, `&` and a leading `.` or `-`.

### Naming convention

`<g><sp><Strain>`: the genus initial and the first three letters of the
species, lowercase, followed by the strain as given with `.` replaced by `-`
and spaces by `_`. *Plasmodium falciparum* 3D7 is `pfal3D7`; *Botrytis
cinerea* B05.10 is `bcinB05-10`.

For a genome proposal, Phase 1 derives the conventional abbreviation from
`species` and `strain`. If the proposal differs, or the derived abbreviation
still fails the shape check (a strain containing `/`, quotes and the like),
Phase 1 warns and Phase 2 stops for a human. The convention applies to new
organisms only: some loaded abbreviations predate it (`aellCBS707.79` keeps
its `.`) and are matched exactly, never re-derived.

### Cross-check source

Loaded organisms are read from `Datasets/lib/xml/datasets/*/` on
`origin/rebuild<NN>`, not `master`: organisms loaded during a build appear
there first. The curator names the rebuild branch; Phase 1 never guesses it. Pending genome proposals are read from
`Proposals/` on `origin/master`. Unmerged `proposal/*` branches are not
consulted; Phase 2 catches those collisions.

Files are read from the git ref (`git show <ref>:<path>`), never from the
working tree, so the result does not depend on what is checked out.

## Phase 2

`load-proposals` gains a settle step that runs for the whole build before
any rendering:

1. Collect every organism referenced by the build's `Ready to load`
   proposals.
2. Settle new-organism abbreviations from the genome proposals, mostly by
   accepting the proposed value.
3. Resolve each dependent dataset's organisms through its `source` link, or
   by exact match for loaded organisms.
4. Render, using only settled abbreviations.

### Mandatory stops

Phase 2 stops and asks a human when any of these hold. None has an
automatic fix.

- A proposed new abbreviation already names an organism file in any project.
- Two proposals in the build claim the same new abbreviation.
- A dependent dataset's genome proposal is neither loaded nor in this build.
  A dataset for a new organism loads in the same build as its organism, or
  later.
- A loaded abbreviation matches a file whose organism disagrees with the
  proposal's taxon id or species/strain.
- No taxon id, and species/strain does not identify a unique organism.
- A proposed new abbreviation fails the shape check or differs from the
  naming convention.

When a human changes an abbreviation, the load PR description records the
proposed value, the settled value and why.

### Source of truth

The organism file Phase 2 writes is the record of the settled abbreviation.
It is not written back to the manifest on `master`; the manifest keeps the
curator's proposal, and the load PR records any difference.

## Schema

This is `schemaVersion: 3`. Proposals in flight on v2 carry final-looking
abbreviations (`organismAbbrev`, `referenceOrganismAbbrev`,
`additionalOrganismAbbrevs`); `load-proposals` reads them as proposals with
`source: "loaded"` for one build cycle, then v2 support is removed.

## Decisions

- Abbreviations are unique across all projects.
- The curator names the rebuild branch for the Phase 1 cross-check.
- An organism's dataset XML will record its NCBI taxon id and strain; the
  mismatch stop reads them from there.
- New abbreviations follow `<g><sp><Strain>` (see Naming convention).

## Addendum: implementation decisions (2026-10-05)

Settled while planning; see `docs/superpowers/plans/2026-10-05-07-organism-abbreviations.md`.

- **One `organisms` array for every type.** Entries carry `proposedOrganismAbbrev` and `source`: `"new"` (genome, with `species`, `strain`, optional `ncbiTaxonId`), `"loaded"`, or `{ "proposal": "<genome accession>" }`.
- **No v2 dual-read.** The only v2 proposal in flight (PRJNA749283) is re-written as v3; this replaces the one-build-cycle compatibility window under Schema.
- **Dependent datasets resolve by taxon and strain.** Organism files already record `ncbiTaxonId` (840 of 840) and `strainAbbrev` (839 of 840). A linked organism settles to the file on the rebuild branch matching the genome proposal's taxon id and strain abbreviation, so a renamed genome is followed. The genome proposal is read from the rebuild branch, `origin/master`, or the history behind them.
- **A person settles with `--settle <proposed>=<abbrev>`.** It clears convention, ambiguity and mismatch stops; it never clears an abbreviation that is taken, claimed by another proposal, or has no organism file.
- **Deferred:** the genome load writing the organism file (constants and genome datasets) waits for the genome demo. Until then a dataset linked to a new genome stops in Phase 2.
- **Known gap until genome loads write organism files:** once a loaded genome's proposal is removed, its abbreviation is in neither the organism index nor the pending claims, so a later genome could propose the same abbreviation and pass both phases. Likewise a genome settled away from its proposal is claimed under its proposed value. Closing this is part of the organism-file work.
- **Legacy strain abbreviations:** 24 organism files keep "." in `strainAbbrev` (e.g. `aellCBS707.79`). The organism index normalises them ("." read as "-") so taxon+strain twins and near-identical abbreviations are still caught.
