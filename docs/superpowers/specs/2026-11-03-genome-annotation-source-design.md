# Genome annotation source

## Problem

Genome proposals assume sequence and annotation both come from GenBank. Two
other flavors exist:

- **Unannotated**: GenBank sequence, no gene models. Loads with the
  `UnannotatedGenome` injector and displays as "Genome Sequence".
- **Provider-annotated**: GenBank sequence, annotation supplied by the data
  provider as an ancillary file (GFF/GTF) placed in
  `yew:/veupath/dataStaging/<proposal id>/`.

Today annotation status is a derived boolean (`isAnnotatedGenome` in
`curated/organism.json`, read from NCBI `annotation_info`). The curator cannot
state it, the injector is hard-coded to `AnnotatedGenome`, and staged files are
keyed by accession rather than proposal id.

## Scope

In scope: recording the annotation source in the manifest, deriving labels,
presenter text and injector from it, and keying dataStaging by proposal id for
every dataset type.

Out of scope: genome dataset entries. `genome-assembly` keeps no
`datasetClass`. Choosing between `genbank_primary_genome` and
`fasta_primary_genome_sequence` + `NoPreprocess_primary_genome_features` is
left to genome preprocessing/verification, which reads `annotation.source`.
The sequence always comes from GenBank (INSDC); there is no sequence-source
field.

## Data model

A new manifest field, valid only for `genome-assembly`:

```json
"annotation": { "source": "genbank" }
"annotation": { "source": "none" }
"annotation": { "source": "provider", "provider": "JGI", "version": "2024-03" }
```

Rules, enforced in `lib/manifest.js`:

- `annotation` is optional in validation so proposals already on master stay
  valid; `write-proposal.js` always writes it for genome proposals. When
  present, `source` must be `genbank`, `provider` or `none`.
- `provider` and `version` are non-empty strings, required when `source` is
  `provider` and refused otherwise. No other keys are allowed.
- `annotation` on any other dataset type is an error.
- Provider annotation files are listed in the existing `manifest.staging`
  (`[{ path, sha256? }]`). There is no second file list.

### Derivation (Phase 1, `write-proposal.js`)

- Default: `genbank` when the NCBI assembly report has `annotation_info`,
  otherwise `none`.
- The curator overrides with `--overrides '{"annotation": {...}}'`.
- `genbank` when the report has no `annotation_info`: error.
- `provider` when the report has `annotation_info`: warning
  ("provider annotation replaces GenBank's"), not an error.

### Single accessor

`annotationOf(proposalDir)` in `dataset-types/genome-assembly.js` is the only
reader. For a proposal written before this field existed it falls back to
`isAnnotatedGenome` in `curated/organism.json`, then to the report's
`annotation_info`, returning `genbank` or `none`. No migration is needed.

`isAnnotatedGenome` stays in `curated/organism.json`, since the `organism`
dataset needs it, but is set to `String(source !== 'none')` instead of being
read from NCBI.

## Consumers

| | `genbank` | `provider` | `none` |
|---|---|---|---|
| Ticket label (`ticketLabelVariant`) | `annotated` → `genome & annotation` | `annotated` → `genome & annotation` | `unannotated` → `genome sequence` |
| `displayName` | Genome Sequence and Annotation | Genome Sequence and Annotation | Genome Sequence |
| `summary` | Genome Sequence and Annotation of … | Genome Sequence and Annotation of … | Genome Sequence of … |
| `history.annotationSource` | `GenBank` or `RefSeq` | `annotation.provider` | `""` |
| `history.annotationVersion` | annotation release date | `annotation.version` | `""` |
| Injector | `AnnotatedGenome` with props | `AnnotatedGenome` with props | `UnannotatedGenome`, self-closing, no props |
| `isAnnotatedGenome` | `true` | `true` | `false` |

- Phase 1 (`derivePresenter`, `deriveOrganismRecord`, `ticketLabelVariant`)
  derives the text from `annotationOf()`. Curator presenter overrides still
  win.
- Phase 2 (`renderPresenter`) picks the injector from manifest
  `annotation.source` alone, defaulting to `genbank` for proposals written
  before the field existed (they all rendered `AnnotatedGenome`). It never reads
  `inputs/` or `curated/organism.json`. Non-empty `injectorProps` on a `none` proposal is an error.

## dataStaging keyed by proposal id

Applies to every dataset type.

- `lib/delivery-ops.js` (`stagingSource`, `pullStaging`) resolves
  `<staging.root>/<proposalId>` instead of `<staging.root>/<accession>`, and
  its messages say `dataStaging/<proposal id>`.
- `lib/manifest.js` `stagingErrors` text says `dataStaging/<proposal id>/`.
- For non-sibling proposals the proposal id equals the accession, so existing
  RNA-seq deliveries resolve to the same directory.
- A `provider` source with an empty `staging` is a manifest validation error,
  so every reader (write, publish, load, a future genome verification) refuses
  it. No genome `stagingProblems` hook is needed.
- `write-proposal.js` carries `staging`, and a `provider` annotation, forward
  from the existing proposal (the working tree's manifest, else master's) when
  the overrides omit them. `genbank` and `none` are facts re-derived from the
  report on every run unless that run's overrides set them, like any other
  override. Before this, `staging` was not in the manifest key order and a
  re-write dropped it.

The proposal skill does not contact the staging host. Preprocessing checks the
files exist and records `sha256`.

## Skill changes

`propose-genome-assembly`:

- New curation question after the NCBI fetch: "Is the annotation in GenBank,
  provided as a separate file, or absent?", pre-filled from the report.
- For a separate file: collect provider, version and file names; write them
  to `annotation` and `staging`; tell the curator the files must be in
  `yew:/veupath/dataStaging/<proposal id>/` before verification.
- Step docs and `SKILL.md` updated; `shared/resources/proposal-workflow.md`
  and the bulk RNA-seq docs say `dataStaging/<proposal id>/`.
- `docs/development.md` documents `annotation`, `deriveAnnotation` and
  `annotationOf`.

## Testing

- Manifest validation: each source; missing and extra `provider`/`version`;
  `annotation` on a non-genome type; `provider` with empty `staging`.
- Derivation: default from report with and without `annotation_info`; the
  `genbank`-without-annotation error; the `provider`-over-GenBank warning.
- `annotationOf` fallback for a proposal with no `annotation` field, with and
  without `curated/organism.json`.
- Rendering: presenter XML for each source, including the
  `UnannotatedGenome` injector and the provider history attributes;
  `injectorProps` on `none` refused.
- `ticketLabelVariant` for each source.
- Staging resolution uses the proposal id for a sibling proposal
  (`<accession>_<datasetType>`).

## Version

Minor bump to 2.8.0: the manifest gains a field.
