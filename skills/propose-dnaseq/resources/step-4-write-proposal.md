# Step 4: Confirm the Organism Is Released, Write the Proposal and Preview

## The organism must be released

Gene CNV needs orthomcl paralogs, and those exist only for organisms already on
the released site. Check that first:

```bash
node scripts/check-released-organism.js <ACCESSION> --organism <ORGANISM_ABBREV> \
  --project <PROJECT> --rebuild-branch rebuild<RR>
```

`--rebuild-branch` is the one the curator gave; never guess it. The script
reads the organism's `ncbiTaxonId` from its organism file on
`origin/rebuild<RR>`, queries the released site's Genome Info and Stats report
(no API key), and matches the record `NCBITAXON_<ncbiTaxonId>` in the project.
On a match it writes `.curation/tmp/<ACCESSION>_released_organism.json` with
the record's `sourceId`, organism name, strain and `chromosomeCount`, and
prints the path.

| Exit | Meaning | What to do |
|---|---|---|
| 0 | Matched | Go on to write the proposal |
| 2 | No released record matches the taxon and project, or several organism files in the project share the taxon | See below |
| 1 | No `.curation/tmp/<ACCESSION>_sra_metadata.json` (run Step 1 first), the organism is not in the project on the rebuild branch, the query failed or the site's report changed shape, or a `--released-organism` pick is unknown or in another project | Hard stop: report the error to the curator |

### Exit 2: ask the curator

The script prints candidate records on stdout: released records whose
`organism_name` shares the genus and species (else only the genus), each with
its `sourceId`, strain, project and `chromosomeCount`. When the message says
`<n> organism files share taxon <id>: <abbrevs>; confirm which is released`,
the one candidate is the record that taxon matched, and the curator confirms
whether it is `<ORGANISM_ABBREV>` rather than one of the others. Show them to the curator as a table and
ask which one is `<ORGANISM_ABBREV>`, or whether the organism is not released
yet.

- **A pick:** re-run with `--released-organism <sourceId>`. The record is then
  stored with `matchedBy: "curator"`, and it goes into the proposal's `inputs/`
  where reviewers see it.
- **Not released:** stop. The dataset cannot be proposed until the organism is
  on the released site. Tell the curator why: gene CNV needs its orthomcl
  paralogs.
- **No candidates:** show the curator the message and ask whether the organism
  is released under another species name. If not, stop.

**Never pick a candidate for the curator**, even when only one is listed.

## What write-proposal.js does

```bash
node scripts/write-proposal.js \
  --accession <ACCESSION> --external-id bioproject=<ACCESSION> \
  --type dnaseq --project <PROJECT> \
  --organism <ORGANISM_ABBREV> \
  --rebuild-branch rebuild<RR> \
  --primary-contact <PRIMARY_CONTACT_ID> [--contact <ID> ...] \
  --skill propose-dnaseq \
  --input .curation/tmp/<ACCESSION>_sra_metadata.json \
  --input .curation/tmp/<ACCESSION>_released_organism.json \
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
5. Does a trial render, and only then replaces `Proposals/<accession>/`. If
   any check fails, the existing proposal is left untouched.
6. Records the curator's git `user.email` and the plugin version.

Both `--input` files are required. Without the released-organism file the
script stops and names the command to run.

### The organism

`--organism` is the *proposed* abbreviation. It is checked against
`origin/rebuild<RR>`, and pending genome proposals against `origin/master`.
An organism that only a pending genome proposal introduces is refused: it is
not released. `--also-organism` is refused: DNA-seq proposals are
single-organism. Relay every `Warning:` line to the curator verbatim.
Convention: `<g><sp><Strain>`: genus initial plus the first three letters of
the species, lowercase, then the strain with `.` replaced by `-` and spaces by
`_` (*Botrytis cinerea* B05.10 is `bcinB05-10`). Off-convention is a warning
now, and Phase 2 stops on it.

### Library checks again

`write-proposal.js` re-runs the Step 1 hard stops over the runs the sample
annotations use. A used run with no reads or a non-`GENOMIC` source refuses
the proposal; a failing run left out of the annotations does not.

The released-organism file must be for `--organism` and `--project`; one from
another organism or project is refused, naming the `check-released-organism.js`
command to re-run.

## The presenter record

`presenter.json` is the complete record of the presenter: names, attribution,
summary, description, methodology, PubMed IDs, links and the injector props.
Phase 2 renders the XML from it and the manifest alone.

Defaults:

| Field | Default |
|---|---|
| `displayName` | `DNA-Seq analysis of <species>` |
| `summary` | the same, with the species italicised |
| `description` | the runs' experiment title |
| `methodology` | library strategy, layout and instrument from the runs |
| `links` | the NCBI BioProject |
| `injectorProps.hasCNVData` | `true` when the released assembly has chromosomes (`chromosomeCount` above 0), else `false` |

When the runs have no experiment title, `description` is empty and the script
refuses until the overrides give one: draft it from the BioProject
description and confirm it with the curator.

**Show the curator the default `description` and `methodology` and ask whether
to keep or override each.** The description is the first SRA experiment title:
it may have typos or be generic. The methodology lists every library strategy
among the runs, so a kept warned run shows up (for example `WXS, WGS`).

**Tell the curator the `hasCNVData` value** and why, and that they, or
reviewers after publish, can change it under `presenter.injectorProps` in the
overrides.

The presenter is rendered with the `IsolatesHTS` template injector.

## The dataset record

`curated/dataset.json` holds the `dnaseqExperiment` class props:

| prop | value |
|---|---|
| `fromSRA` | `true` |
| `ploidy` | `$$ploidy$$`, the organism file's constant |

**Never set `ploidy` in Phase 1.** An override of `dataset.props.ploidy` is
refused. At load, `load-proposals` checks the organism file has a `ploidy`
constant, and when it does not, asks the data loader for the value.

Reads come from SRA only. A `dataset.source` override of another type is
refused.

The name must be new in the organism's dataset file: the script refuses a name
already in `Datasets/lib/xml/datasets/<Project>/<organismAbbrev>.xml`, or used
by another proposal on master. Choose another `"name"` in `--overrides`.

## The loading artifacts

`write-proposal.js` also writes `curated/<abbrev>/samplesheet.csv`,
`curated/<abbrev>/entity-sample.tsv` and `curated/<abbrev>/entity-sample.yaml`.
The samplesheet columns are `sample,fastq_1,fastq_2`; each SRA run appears once
with `fastq_2` empty, and downstream expands it to its paired files. It checks
that the samplesheet sample names, the STF sample ids and the annotations'
sampleIds are the same set, and refuses to write the proposal otherwise. The
same check runs again at publish and at load.

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
node scripts/render-proposal.js Proposals/<ACCESSION>
node scripts/render-proposal.js --dataset Proposals/<ACCESSION>
```

This runs the same renderer `load-proposals` will run later, on the same
`presenter.json`. What the curator approves here is what loads. The dataset
entry shows `ploidy` as `$$ploidy$$`; that is expected.

If `presenter.json` sets an injector prop the renderer has no default for, the
preview prints `Warning: injector props not in defaults: ...` on stderr. Treat
it as a typo check: fix the key name in the overrides and re-run.

## Curator edits go in overrides, not XML or presenter.json

Create `.curation/tmp/overrides.json` before the first run. `name`, `version`,
`presenter.shortDisplayName` and `presenter.shortAttribution` are required: no
GEO series supplies them. Re-run `write-proposal.js` and preview again after
each change.

```json
{
  "name": "Doe_isolates_2024",
  "version": "2024-05-01",
  "presenter": {
    "displayName": "…",
    "shortDisplayName": "…",
    "shortAttribution": "…",
    "summary": "…",
    "description": "…",
    "methodology": "…",
    "pubmedIds": ["12345678"],
    "injectorProps": { "hasCNVData": "false" }
  }
}
```

`name` and `version` identify the dataset in the manifest. `name` becomes a
directory name for the data loaders and part of the dataset name
(`<organism>_<name>_dnaseqExperiment_RSRC`), so make it readable and never the
accession. `version` is when the data last changed (YYYY-MM-DD).

Omit keys you do not want to override. These values are plain text, not
pre-escaped XML: write `Doe & Smith`, not `Doe &amp; Smith` - the renderer
escapes it for you. Unknown keys are refused, so a misspelled field name
fails loudly instead of doing nothing. Never edit the rendered XML or
`presenter.json` by hand: `write-proposal.js` re-derives them from the
annotations and overrides on every run. Only the curated loading artifacts
(`samplesheet.csv`, `entity-sample.*`) are protected from overwrite, as
described above.

## Presenter name

`<organism>_<name>_dnaseqExperiment_RSRC`, the `datasetName` the
`dnaseqExperiment` class gives its loader, so presenter and dataset join.
Print it with:

```bash
node scripts/render-proposal.js --name Proposals/<ACCESSION>
```
