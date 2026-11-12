---
name: verify-functional-update
description: Data loading team - verify a merged functional annotation update proposal before it loads. Claims it, fetches the staged curator file and the organism's released GFF into the proposal's work area (functional-update.js fetch), confirms the inferred column mapping with the data loader (columns), converts the file to the class's loader format with IDs mapped to the class's level (convert), runs validate-proposal against the rebuild branch (conversion findings, update record, build fitness including the history row and entry version), prepares the manual delivery with prepare-delivery, reviews it with the user, then mark-ready or request-revision
---

# Verify a Functional Annotation Update

Follow [the verification procedure](resources/verify-procedure.md) step by
step. This page adds what is specific to functional annotation updates:
preprocessing turns the curator's tab file into the class's loader file, with
IDs checked against the organism's released GFF.

## Workspace

This type's directory under the validation root is
`functional-update-validation/`. Its `env.json` names no repos and no build:

```json
{ "schemaVersion": 2, "repos": {}, "executables": {},
  "staging": { "host": "<ssh host>", "root": "<dataStaging root>" },
  "manualDelivery": { "host": "<ssh host>", "root": "<manualDelivery root>" } }
```

The proposal's work area is
`<root>/functional-update-validation/proposals/<PROPOSAL>/preprocess/`.
`functional-update.js` derives it from `--workspace <root>`; never pass a work
area by hand.

Also ask the data loader for the rebuild branch (`rebuildRR`). Every step
below that takes `--against` needs it.

## Order

1. Claim: `node scripts/start-verification.js <PROPOSAL>`.
2. Preprocess: fetch, columns, convert.
3. Validate with `--against`, prepare the delivery, review and decide, as the
   procedure says.

## Preprocess

### Fetch

```bash
node scripts/functional-update.js fetch <PROPOSAL> --workspace <root> --against origin/rebuildRR
```

Pulls the staged file from `dataStaging/<PROPOSAL>/` (checked against the
manifest's sha256) into `input/`, and the organism's GFF from its project
site's current release into `gff/`, recorded in `gff.json` with the pinned
release URL. It prints the GFF URL and release. A genome proposal on master
naming the organism is reported here and fails validation: the update waits
for that genome. Re-running fetches both again and removes the old
conversion, so convert again after it.

### Columns

```bash
node scripts/functional-update.js columns <PROPOSAL> --workspace <root>
```

Prints the inferred mapping as JSON: `columns` (`header`, `id: { column,
level }`, `values`), how many sampled rows matched, and the first rows of the
file. Columns are numbered from 1. Show the user the mapping beside the
sample rows and have the data loader confirm or correct each part: the ID
column, its level (`gene`, `transcript` or `protein`), each value column, and
whether the first row is a header.

`columns: null` means no column matched an ID in the released GFF: wrong
organism, wrong file, or IDs from another annotation release. Show the `note`
and stop; this usually goes back to the curator.

Value keys per class (optional ones in brackets):

| Class | Keys |
|---|---|
| `productNames` | `product` [`preferred`] |
| `GeneOntologyAssociations` | `goId` [`aspect`, `evidence`, `reference`, `qualifier`] |
| `EnzymeCommissionAssociations` | `ec` |
| `geneName` | `name` |
| `comments` | `comment` (gene or transcript IDs only) |
| `aliases` | `alias` |

Write the confirmed mapping, with exactly one of `--header` or `--no-header`:

```bash
node scripts/functional-update.js columns <PROPOSAL> --workspace <root> --write --header \
  --id <column>:<level> --value <key>=<column> [--value <key>=<column> ...]
```

**`#` lines.** Lines starting with `#` are skipped as comments, except that
`--header` takes the first non-blank line as the header even when it starts
with `#`. A preamble such as `# exported by ...` above the real header then
becomes the header, and the real header a data row (an unmatched ID, and
`extraColumns` on every row). Check the file's first lines; a file with a
preamble above its header goes back to the curator to remove it.

### Convert

```bash
node scripts/functional-update.js convert <PROPOSAL> --workspace <root>
```

Maps each row's ID to the class's level (product names, GO and aliases at
transcript, EC at protein, gene names at gene, comments at the ID's own
level) and writes `final/<file>` and `convert.json`. It prints each finding
and the row and ID counts, and exits 1 on an error finding (the files are
still written for inspection). Explain each finding to the user:

- `unmatchedIds`: IDs not at the stated level in the released GFF. An error
  when any are unmatched under 100 distinct input IDs, or more than 1% of
  them otherwise; a warning below that. Usually the wrong ID column or level,
  or IDs from an older annotation: fix the mapping, else request a revision.
- `ambiguousIds` (error): an ID present at two levels in the GFF and not at
  the stated level. `ambiguousIdsResolved` (warning): present at two levels,
  mapped from the stated one.
- `badGo` (rows with an invalid GO id or evidence code) and `badEc` (EC
  numbers not four dot-separated numbers or `-`): skipped.
- `badAspect`, `goAspectMissing`: the GAF aspect column is left empty; the
  association still loads. `badQualifier`: qualifiers other than `NOT`,
  ignored.
- `preferredCount` (product names): transcripts with no preferred product or
  several.
- `geneNameConflict`: genes given more than one name; the first is kept.
- `emptyValue`: rows missing a required value; skipped.
- `extraColumns`: rows wider than the header (or the first data row), with
  line numbers; often a tab inside a value. The extra columns are ignored.
- `skippedTypes` (info): gene children of feature types the index does not
  hold; IDs of those features show up as unmatched.
- `noRows` (error): nothing to load.

A changed mapping means `columns --write` again, then convert again.

## Validate

```bash
node scripts/validate-proposal.js --workspace <root> --against origin/rebuildRR <PROPOSAL>
```

`--against` is required for this type: validate-proposal refuses without it,
and mark-ready refuses a report made without it. The report records the
ticket's build; if the build milestone changes, validate again.

The validators: `converted` (the conversion is current for the proposal's
entry and work area, carries every convert finding, and no genome proposal
names the organism), `updateRecord` (`curated/update.json` agrees with the
entry and the staged file), and build fitness (the genome presenter and, for
an updated entry, the entry exist on the rebuild branch; a new entry's name is
free; the history row and version edit dry-run cleanly).

A build-fitness **warning** that names `--history` means the presenter's
latest history row lacks a genome or annotation value the new row copies.
That is not the curator's to fix: note the missing keys for the load, where
the data loader gives them with `load-proposal.js --history <key>=<value>`.

## Review with the user

- Every convert finding, with its sample IDs or lines.
- The ID and row counts against the size of the curator's file.
- The GFF release the IDs were checked against (`gff.json`).
- `curated/update.json` on `origin/master`: the history source and text, and
  whether the entry is updated (`bump`, with its previous version) or new.
- Any `--history` warning, so it is passed on for the load.

## Prepare the delivery

```bash
node scripts/prepare-delivery.js --workspace <root> --against origin/rebuildRR <PROPOSAL>
```

prepare-delivery copies `final/<file>` from the work area into the entry's
`final/` at the class's delivery path, and refuses a work area whose
conversion is stale. `fromProvider/` holds the staged curator file.
`delivery.json` records the conversion's, the GFF's and the input's sha256s
and the pinned GFF URL.

## After mark-ready

mark-ready removes `proposals/<PROPOSAL>/`, the work area with it. At load,
`load-proposal.js` sets the entry's new version (or adds the new entry) and
appends the history row to the genome presenter.

## Rules

- Never write `columns.json` without the data loader confirming the mapping.
- Never accept an `unmatchedIds` error or a `columns: null`; they go back to
  the curator or to a corrected mapping.
- Never validate without `--against origin/rebuildRR`.
- Never edit the staged file or the work area's `input/` by hand.
