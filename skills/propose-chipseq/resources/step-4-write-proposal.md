# Step 4: Write the Proposal and Preview

## What write-proposal.js does

```bash
node scripts/write-proposal.js \
  --accession <ACCESSION> --proposal <PROPOSAL> --external-id bioproject=<ACCESSION> \
  --type chipseq --project <PROJECT> \
  --organism <ORGANISM_ABBREV> \
  --rebuild-branch rebuild<RR> \
  --primary-contact <PRIMARY_CONTACT_ID> [--contact <ID> ...] \
  --skill propose-chipseq \
  --input .curation/tmp/<ACCESSION>_sra_metadata.json \
  --curated .curation/tmp/<ACCESSION>_sample_annotations.json \
  --overrides .curation/tmp/overrides.json
```

1. Finds the VEuPathDatasets checkout it is run from.
2. Reads contact IDs from `allContacts.xml` and validates the primary and
   additional contacts exist. Unknown IDs fail here, before anything is written.
3. Builds the proposal in a staging directory: `inputs/`, `curated/` and
   `manifest.json`. Input files keep their names.
4. Derives `curated/presenter.json` from the inputs, applies the curator's
   `--overrides`, and checks that every required field is filled:
   `displayName`, `summary`, `description`, `shortDisplayName` and
   `shortAttribution`. `displayName` is plain text: never put HTML tags in it;
   the script refuses one that has them. `summary` and `description` may use
   HTML.
5. Does a trial render, and only then replaces `Proposals/<PROPOSAL>/`. If
   any check fails, the existing proposal is left untouched.
6. Records the curator's git `user.email` and the plugin version.

### The organism

`--organism` is the *proposed* abbreviation. It must already be loaded on
`origin/rebuild<RR>`, or be proposed by a genome proposal for the same build or
an earlier one. When only a genome proposal introduces it, `write-proposal.js`
warns, and load waits for that genome. `--also-organism` is refused: ChIP-seq
proposals are single-organism. Relay every `Warning:` line to the curator
verbatim.
Convention: `<g><sp><Strain>`: genus initial plus the first three letters of
the species, lowercase, then the strain with `.` replaced by `-` and spaces by
`_` (*Botrytis cinerea* B05.10 is `bcinB05-10`). Off-convention is a warning
now, and Phase 2 stops on it.

### Library checks again

`write-proposal.js` re-runs the Step 1 hard stops over the runs the sample
annotations use. A used run with no reads or a non-`GENOMIC` source refuses
the proposal; a failing run left out of the annotations does not.

### The experiment type

The overrides must give `"dataset": { "props": { "experimentType": "<type>" } }`.
Claude suggests the type, and **the curator confirms it**:

| `experimentType` | Use for |
|---|---|
| `histonemod` | histone marks, with input controls |
| `histonemod_noInput` | histone marks, without input controls |
| `tfbinding` | transcription factors and other chromatin proteins |
| `mnase` | MNase-seq (from the library strategy) |
| `faire` | FAIRE-seq (from the library strategy) |
| `dnase` | DNase-seq (from the library strategy) |

`extraBowtieParams` may be set under `dataset.props`. It defaults to empty.
Never set it unless the curator or the paper asks for specific bowtie2 options.

`hasPairedEnds`, `readsFileType` and `fromSRA` are derived. Runs that mix
single- and paired-end layouts are refused: ask the curator which runs to drop.

**Peaks.** Tell the curator that peaks are called only for `histonemod`, and
only for ChIP samples that have an input. `hasCalledPeaks` follows
`experimentType` and cannot be overridden.

### Warnings to relay

`write-proposal.js` prints a `Warning:` line for each of these. Relay every one
verbatim and ask the curator about each:

- an input that is not the input of any ChIP sample (unused inputs);
- a ChIP sample without an input, when the experiment has inputs;
- runs whose library strategy doesn't match the experiment type.

### Refusals

`write-proposal.js` refuses:

- `experimentType` missing or not in the vocabulary;
- a derived prop (`hasPairedEnds`, `readsFileType`, `fromSRA`) in the overrides;
- `hasCalledPeaks` in the overrides;
- mixed library layouts;
- `histonemod` with no inputs;
- `histonemod_noInput` with inputs;
- an `input` that is not an input sample of this experiment;
- a `role` factor, or a sample role that is not `chip` or `input`;
- a samplesheet whose `input` column disagrees with the annotations.

## The presenter record

`presenter.json` is the complete record of the presenter: names, attribution,
summary, description, methodology, PubMed IDs, links and the injector props.
Phase 2 renders the XML from it and the manifest alone.

Defaults:

| Field | Default |
|---|---|
| `displayName` | `<assay> analysis of <species>`, the assay being the used runs' most common non-WGS library strategy, with DNase-Hypersensitivity shown as DNase-Seq and FAIRE-seq as FAIRE-Seq |
| `summary` | the same, with the species italicised |
| `description` | the runs' experiment title |
| `methodology` | library strategy, layout and instrument from the runs |
| `links` | the NCBI BioProject |
| `injectorProps.hasCalledPeaks` | `true` for `histonemod`, else `false`; rendered, never curated |

When the runs have no experiment title, `description` is empty and the script
refuses until the overrides give one: draft it from the BioProject
description and confirm it with the curator.

**Show the curator the default `displayName`, `description` and
`methodology` and ask whether to keep or override each.** The description is
the first SRA experiment title: it may have typos or be generic. The
methodology lists every library strategy among the runs, so a kept warned run
shows up.

The presenter is rendered with the `ChIPSeq` template injector.

## The dataset record

`curated/datasets.json` holds one entry; its `props` are the
`chipSeqExperiment` class props:

| prop | source |
|---|---|
| `experimentType` | curator (required, see above) |
| `extraBowtieParams` | curator (optional, default empty) |
| `hasPairedEnds` | derived from the used runs' library layout |
| `readsFileType` | derived: `fastq` |
| `fromSRA` | derived: `true` |

**Never hand-edit `curated/datasets.json`**, any more than `presenter.json`:
the renderer re-checks `hasPairedEnds`, `readsFileType` and `fromSRA` against
the values derived from the runs and refuses a file that disagrees. Change
the overrides and re-run `write-proposal.js`.

Reads come from SRA only. A `dataset.source` override of another type is
refused.

The name must be new in the organism's dataset file: the script refuses a name
already in `Datasets/lib/xml/datasets/<Project>/<organismAbbrev>.xml`, or used
by another proposal on master. Choose another `"name"` in `--overrides`.

## The loading artifacts

`write-proposal.js` also writes `curated/<abbrev>/samplesheet.csv`,
`curated/<abbrev>/entity-sample.tsv` and `curated/<abbrev>/entity-sample.yaml`.
The samplesheet columns are `sample,fastq_1,fastq_2,input`; each SRA run
appears once with `fastq_2` empty, and downstream expands it to its paired
files. `input` is the `sampleId` of the ChIP sample's control. It checks
that the samplesheet sample names, the STF sample ids and the annotations'
sampleIds are the same set, and that each samplesheet `input` agrees with the
annotations, and refuses to write the proposal otherwise. The same check runs
again at publish and at load. The STF gets a `role` column from each sample's
`role`.

A hand edit is checked again at publish and at load, and is never overwritten
automatically. When a re-run would derive something different from a curated
artifact already in the proposal (a hand edit, or annotations that changed
since), `write-proposal.js` stops without changing anything:

```
curated/<abbrev>/<files> differ from what write-proposal would derive (hand edits, or changed annotations). Ask the curator, then re-run with --keep-edits to keep them or --replace-edits to rewrite them (or per file: --keep-edit <file>, --replace-edit <file>).
```

Show the curator the named files and ask which they want. Never choose for
them, and never pass any of these flags before they answer.

- `--keep-edits` keeps every named file as it is in the proposal.
- `--replace-edits` rewrites every named file from the annotations.
- `--keep-edit <file>` and `--replace-edit <file>` (each repeatable) choose
  per file. Every named file must be chosen exactly once; a missing, repeated
  or unnamed file stops the script again with the list.

Use one form: the all-files flags cannot be combined with each other or with
the per-file ones. When nothing differs, no flag is needed.

A kept file must still agree with the other artifacts, or the script stops
with the agreement error. That check covers sample ids only: a kept file does
**not** pick up label or factor changes made in the sample annotations since.
Tell the curator this when they choose to keep a file after changing the
annotations. Changes that should survive any re-run belong in the sample
annotations or the overrides.

## Preview

```bash
node scripts/render-proposal.js Proposals/<PROPOSAL>
node scripts/render-proposal.js --dataset Proposals/<PROPOSAL>
```

This runs the same renderer `load-proposals` will run later, on the same
`presenter.json`. What the curator approves here is what loads.

If `presenter.json` sets an injector prop the renderer has no default for, the
preview prints `Warning: injector props not in defaults: ...` on stderr. Treat
it as a typo check: fix the key name in the overrides and re-run.

## Curator edits go in overrides, not XML or presenter.json

Create `.curation/tmp/overrides.json` before the first run. `name`, `version`,
`presenter.shortDisplayName`, `presenter.shortAttribution` and
`dataset.props.experimentType` are required: nothing else supplies them.
Re-run `write-proposal.js` and preview again after each change.

```json
{
  "name": "Doe_H3K4me3_2024",
  "version": "2024-05-01",
  "presenter": {
    "displayName": "…",
    "shortDisplayName": "…",
    "shortAttribution": "…",
    "summary": "…",
    "description": "…",
    "methodology": "…",
    "pubmedIds": ["12345678"]
  },
  "dataset": {
    "props": { "experimentType": "histonemod" }
  }
}
```

`name` and `version` identify the proposal's one dataset entry in
`curated/datasets.json`. `name` becomes a directory name for the data loaders
and part of the dataset name (`<organism>_<name>_chipSeq_RSRC`), so make it
readable and never the accession. `version` is when the data last changed (YYYY-MM-DD).

Omit keys you do not want to override. These values are plain text, not
pre-escaped XML: write `Doe & Smith`, not `Doe &amp; Smith` - the renderer
escapes it for you. Unknown keys are refused, so a misspelled field name
fails loudly instead of doing nothing. Never edit the rendered XML,
`presenter.json` or `datasets.json` by hand: `write-proposal.js` re-derives
them from the annotations and overrides on every run. Only the curated loading
artifacts (`samplesheet.csv`, `entity-sample.*`) are protected from
overwrite, as described above.

## Presenter name

`<organism>_<name>_chipSeq_RSRC`, the `datasetName` the `chipSeqExperiment`
class gives its loader, so presenter and dataset join. Print it with:

```bash
node scripts/render-proposal.js --name Proposals/<PROPOSAL>
```
