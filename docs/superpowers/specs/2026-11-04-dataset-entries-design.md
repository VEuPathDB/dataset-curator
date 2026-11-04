# Dataset entries

## Problem

A proposal loads exactly one dataset. Its identity (`datasetClass`, `name`,
`version`) lives in the manifest, its props and read source in
`curated/dataset.json`, and its class is a constant of the dataset type.

Annotated genomes break this. A genome loads 2–6 sequence and feature datasets
(`fasta_primary_genome_sequence`, `fasta_secondary_genome` per lower SO type,
`fasta_organelle_genome` per organelle, and the matching `NoPreprocess_*_genome_features`)
plus functional datasets (`productNames` always; `GeneOntologyAssociations`,
`EnzymeCommissionAssociations`, `geneName`, `dbxref_synonym`, `comments`,
`aliases`, one or more `dbxref_simple` when available). Their names and versions
are usually organism constants (`$$genomeSource$$`, `$$genomeVersion$$`), which
the manifest's identity rules reject, and their delivery paths use `${soTerm}`
and `${source}`, which manifest identity cannot fill.

The class parser fails too: every genome and functional class delivers through
`<manualGet fileOrDir="…">`, and `parseDatasetClass` only understands
`<unpack>ln -s @@manualDeliveryDir@@/…`.

This spec is sub-project A of genome preprocessing. The rest (GFF pipeline,
trial ISF runner, shared verify core, functional extraction, `verify-genome`)
build on it. Background: `docs/superpowers/research/2026-11-03-genome-dataset-class-formats.md`
and `docs/superpowers/research/2026-11-04-trial-isf-spike.md`.

## Decisions

- Dataset entries are the only source of dataset identity. A proposal holds
  0..N entries.
- Phase 1 stays class-agnostic for genomes: `write-proposal.js` writes no genome
  entries. Data loaders add them in preprocessing by amending the proposal.
- Organism constants a proposal introduces live in `curated/organism.json`
  under `constants`.
- Later functional-annotation updates will be their own single-entry proposals
  (a future type). This model serves them unchanged.

## Data model

### `curated/datasets.json`

```json
{
  "schemaVersion": 2,
  "datasets": [
    {
      "datasetClass": "fasta_primary_genome_sequence",
      "name": "$$genomeSource$$",
      "version": "$$genomeVersion$$",
      "props": { "soTerm": "$$soTerm$$", "table": "DoTS::ExternalNASequence", "sourceIdRegex": "^>(\\S+)", "releaseDate": "" },
      "source": { "type": "server", "paths": ["/…"] }
    }
  ]
}
```

- `datasets: []` is valid.
- An entry's identity is (`datasetClass`, `name`), unique within the proposal.
- `name` is a literal matching today's name rule, or exactly one `$$constant$$`.
- `version` is a literal `YYYY-MM-DD`, or exactly one `$$constant$$` whose
  resolved value is `YYYY-MM-DD`.
- `props` are exactly the class's props minus the identity props, as today's
  `validateDataset` requires. Values are strings and may reference
  `$$constants$$`.
- `source` follows today's `validateSource`.

### `curated/organism.json`

Gains `constants`, an object of constant name to string value:

```json
"constants": { "genomeSource": "GenBank", "genomeVersion": "2017-03-09", "soTerm": "chromosome", "functAnnotVersion": "2017-03-09", "source": "GenBank" }
```

Every `$$x$$` in any entry must resolve to one of:

- a key of `constants`;
- a constant every organism file defines: `projectName`, `organismAbbrev`,
  `strainAbbrev`, `ncbiTaxonId`, `speciesNcbiTaxonId`;
- a constant the dataset type requires at load (`requiredOrganismConstants`,
  such as dnaseq's `ploidy`, which load supplies).

Who sets `constants` is out of scope (genome preprocessing).

### Re-writing a proposal

`write-proposal.js` re-derives a single-entry type's one entry on every run, as
today, with curator overrides applied. Entries of other types, and
`organism.json` `constants`, come from preprocessing, so a re-write carries them
forward from the existing proposal: the working tree's copy when present, else
master's, the same rule as `staging` and a provider `annotation`. A new genome
proposal starts with `datasets: []` and no `constants`.

### Manifest

`datasetClass`, `name` and `version` leave `IDENTITY_FIELDS`, the manifest key
order and manifest validation. The manifest keeps proposal-level facts:
accession, type, organisms, annotation, staging, contacts, curator, ticket.

### Old proposals

A proposal with manifest identity and a schemaVersion 1 `curated/dataset.json`
reads as one entry. No migration; the next `write-proposal.js` run writes
`datasets.json` and drops `dataset.json` and the manifest identity.

## Accessors

- `datasetsOf(proposalDir, manifest)` in `dataset-types/_common.js` is the only
  reader of `datasets.json`, `dataset.json` and legacy manifest identity. It
  returns validated entries `[{ datasetClass, name, version, props, source }]`.
  `readDataset` and `requireIdentity` are removed.
- `resolveEntry(entry, constants)` returns the entry with every `$$constant$$`
  in `name`, `version` and `props` substituted, or throws naming the entry and
  the unresolved constant.

## Dataset types

Each type declares the classes it may hold and how many entries:

| Type | `datasetClasses` | Entries |
|---|---|---|
| bulk-rnaseq | `rnaSeqExperiment` | exactly 1 |
| dnaseq | its class | exactly 1 |
| chipseq | its class | exactly 1 |
| genome-assembly | sequence, features and functional classes listed above | 0..N |

This replaces the single `datasetType.datasetClass`. "Has a delivery" means
"has at least one entry".

## Consumers

| Area | Today | After |
|---|---|---|
| Presenter names (`presenterNames`, `datasetNameFor`) | `m.name` | single-entry types use `datasetsOf()[0].name`; genome is unchanged |
| Clash checks (`proposal-ops`, `build-fitness`, `load-ops`) | one (class, name) per organism | each entry |
| Sibling-proposal name clash (`proposal-ops`) | manifest `name` | entry (class, name) per organism |
| Load (`load-ops`) | one `<dataset>` per organism | one per entry per organism, in entry order; resolved `constants` are the given values to `withOrganismConstants` |
| Delivery (`delivery-ops`, `artifacts.deliveryLocation`) | one path from manifest identity | one path per entry |
| Render and handoff (`render-proposal`) | one class | each entry |
| Ticket and commit text | `Name` / `Version` lines | one `class name version` line per entry |

Entry order is the order of `<dataset>` blocks in the organism file.
Preprocessing writes sequences, then features, then functional entries.

Curator overrides do not change: for single-entry types `--overrides` `name`
and `version` apply to the entry.

## Class parsing and delivery paths

`classes.xml` declares delivery in three shapes:

| Shape | Example | Delivery |
|---|---|---|
| `manualGet common/empty` with `<unpack>ln -s @@manualDeliveryDir@@/…` | `rnaSeqExperiment` | the `ln -s` source directory |
| `manualGet fileOrDir="…/final/"` | `fasta_primary_genome_sequence`, `NoPreprocess_*` | that directory |
| `manualGet fileOrDir="…/final/<file>"` | `productNames` (`products.txt`), `dbxref_simple` (`mapping.txt`), `fasta_organelle_genome` (`genome.fasta`) | that directory and a required file |

`parseDatasetClass` returns `delivery: { dir, file }` relative to
`@@manualDeliveryDir@@`, `file` null for a directory delivery. The `ln -s`
form wins when `manualGet` is `common/empty`. `dir` must end in `final`. A
class matching no shape is an error naming the class. Other `<unpack>` steps
run at load and are ignored here.

`deliveryLocation(manifest, classDef, organism, entry)` expands placeholders
from the organism (`projectName`, `organismAbbrev`), the resolved entry's
`name` and `version`, and its resolved `props`. `identityValues` is removed. An
unfilled `${x}` is an error naming the entry and placeholder.

Delivery checks run per entry: the expanded `dir` exists in the delivery tree,
and when `file` is set it exists and is non-empty. File contents are checked by
the type's validators, not here.

## Validation errors

All raised by validation, so write, publish, load and mark-ready refuse before
doing anything:

- `dataset.json` and `datasets.json` both present
- duplicate (`datasetClass`, `name`)
- a class the type does not allow; the wrong entry count for single-entry types
- missing or extra props
- an unresolved `$$constant$$`
- a resolved `version` that is not `YYYY-MM-DD`
- an unfilled `${placeholder}` in a delivery path
- two entries expanding to the same delivery `dir` (for example two
  `fasta_secondary_genome` entries with the same `soTerm`)

## Scope

In scope: the `datasets.json` schema, `datasetsOf`, `resolveEntry`,
`organism.json` `constants`, removing manifest identity, the class parser, and
every consumer above. Genome `write-proposal.js` writes `datasets: []` for a new
proposal and carries entries and `constants` forward on a re-write.

Out of scope: producing genome entries, choosing partitions and setting
constants (genome preprocessing); `verify-genome`; how load creates a new
genome's organism file; the functional-update proposal type.

## Testing

- `datasetsOf`: v2, v1 fallback, both files present.
- `resolveEntry`: resolution, unresolved constant, non-date resolved version,
  a type-required constant left for load.
- Re-writing a genome proposal keeps its entries and `constants`, from the
  working tree and from master.
- Each validation error above.
- `parseDatasetClass`: fixtures cut from the real `classes.xml` for each
  delivery shape, and every genome and functional class listed above (all fail
  today).
- Regression: existing bulk-rnaseq, dnaseq and chipseq render, load and
  delivery tests produce byte-identical XML and paths.
- One synthetic genome proposal (primary, secondary and organelle sequence
  entries, two features entries, `productNames`, two `dbxref_simple`) through
  validation, delivery paths and load XML rendering.

## Version

Major bump to 3.0.0: 2.x cannot read proposals whose manifests no longer carry
dataset identity. 3.x reads both shapes.
