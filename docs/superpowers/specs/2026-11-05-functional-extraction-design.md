# Functional extraction (sub-project E)

Annotated genomes load as sequence datasets plus `NoPreprocess_*_genome_features`
(sub-project D), and ISF ignores every functional GFF attribute
(`genemRNAExonCDS2Gus.xml` marks `product`, `Note`, `Dbxref`, `gene`,
`gene_synonym`, `protein_id` … `ignore="true"`). Functional annotation reaches
the database only through its own dataset classes. This sub-project extracts
those classes' files from D's GFF3.

`node genome-pipeline.js functional --workDir <dir>` reads the work area D
finalized and writes `final/function/` plus `functional.json`. It needs no
network, no database and no Docker, and does not depend on the trial (C).

## Decisions

- The only input is D's `build/<partition>/genome.gff3`. It carries the IDs ISF
  loads (gene `ID`, mRNA `ID` = the transcript ID in `transcriptInfoAndIds`)
  and keeps every NCBI attribute. No GenBank flat file, gene2go or UniProt
  GOA.
- Every `Dbxref` prefix found loads into a `dbxref_simple` dataset: the
  established VEuPathDB dataset for that prefix when a committed override
  names one, otherwise its own `<prefix>_from_annotation` dataset.
- E writes files and a record. F (`verify-genome`) turns the record into
  `datasets.json` entries and the delivery tree, sets versions
  (`$$functAnnotVersion$$`), and checks IDs against C's
  `transcriptInfoAndIds`.
- No existing ApiCommonData extractor is reused: the GenBank-era `make*File`
  scripts die on purpose, and `extractQualifiersFromAnnotation` splits
  products on `,`, overwrites IDs from `Parent`, and parses neither NCBI
  `go_*` nor `Ontology_term`.

## Input and IDs

`functional` reads `genome-build.json` with the validation `trial` uses
(schema version, partitions, final files, and `build/<p>/genome.gff3` matching
`buildFiles.gff3`). That validation moves from `commands/trial.js` to a shared
`genome-build.js`; a mismatch refuses with `run build and finalize again`.

Each partition's GFF3 is parsed with `gff.js` (`parseGff`, `featureGroups`,
`indexGraph`). Lines sharing an `ID` and type are one feature (CDS segments).
Attribute values are split on `,` and then percent-decoded (`decode`); NCBI
encodes a comma inside a value as `%2C`, so a product keeps its commas.

IDs resolve within the GFF3 through `Parent`:

| Level | ID |
|---|---|
| gene | the gene feature's `ID` |
| transcript | the RNA feature's `ID` (mRNA, ncRNA types, pseudogenic transcripts) |
| protein | `<transcript>-p1` (GusSkeletonMaker's rule; one protein per transcript) |

A CDS resolves to its parent transcript and that transcript's gene. A CDS or
RNA whose chain does not reach a gene is an error finding (D's transforms give
every RNA a parent, so this means D and E disagree).

`source` is `GenBank` for a `GCA_` accession and `RefSeq` for `GCF_`
(`genome-build.json` accession). The NCBI taxon ID for GAF column 13 comes from
the `# Taxid:` header of the fetched assembly report.

## Extraction table

One committed table, `functional/classes.js`, drives extraction. Each row:
class, dataset name, GFF attribute, feature kinds it is read from, ID level,
value transform, file name and line format.

| Class | Read from | ID | Name | File |
|---|---|---|---|---|
| `productNames` | `product` on CDS; on the RNA when it has no CDS | transcript | `<source>` | `products.txt` |
| `geneName` | gene `gene`, skipped when equal to the gene `ID` or its `locus_tag` | gene | `<source>` | `geneName.txt` |
| `comments` | `Note` on CDS/RNA → transcript; `Note` on gene → gene | transcript / gene | `<source>_transcript`, `<source>_gene` | `comments.txt` |
| `aliases` | `protein_id` on CDS | transcript | `gbProteinId` | `aliases.txt` |
| `dbxref_synonym` | gene `gene_synonym` | gene | `<source>` | `synonyms.txt` |
| `dbxref_simple` | `Dbxref` on gene, RNA and CDS, one dataset per resolved name | the override's level, else gene | the override's name, else `<prefix>_from_annotation` | `mapping.txt` |
| `GeneOntologyAssociations` | `go_function`, `go_process`, `go_component` | transcript | `<source>` | `associations.gas` |
| `EnzymeCommissionAssociations` | `EC_number` on CDS | protein | `<source>` | `ec.txt` |

`comments` has two datasets because the loader resolves gene IDs before
transcript IDs and the two are named apart in existing data.

Line formats (tab-separated, no header, LF):

- `products.txt`: `id, product, is_preferred`. `is_preferred` is `1` for the
  first product of a transcript in GFF order and `0` for the rest, written
  explicitly because the rows are sorted (`processProductAddPreferred.pl`
  would otherwise prefer the first line).
- `geneName.txt`: `geneId, name`. The loader marks every row preferred, so a
  gene gets one row; a gene whose features disagree on `gene` is a warning and
  keeps the gene feature's value.
- `comments.txt`: `id, comment`.
- `aliases.txt`, `synonyms.txt`, `mapping.txt`: `id, value`, one value per line.
- `associations.gas`: GAF 2.2 lines. `go_*` values are `term|GO id digits|PMID
  list|evidence`; column 1 `<source>`, 2 and 3 the transcript ID, 4 empty, 5
  `GO:<7 digits>`, 6 `PMID:<id>` joined by `|`, empty when there is none, 7 the evidence code (`IEA` when absent), 9 `F`/`P`/`C`, 12
  `transcript`, 13 `taxon:<id>`, 14 the build date, 15 `<source>`.
- `ec.txt`: `proteinId, EC`, partial values (`1.2.3.-`) kept.

Rows are deduplicated per (ID, value) and sorted by ID, then value
(`productNames` keeps first-seen order to set `is_preferred`, then sorts), so a
rerun writes byte-identical files.

`dbxref_simple` naming: the value is the text after the first `:`. A committed
table, `functional/dbxref-urls.js`, holds two things:

- **Overrides** for prefixes that already have an established VEuPathDB
  dataset, so the same external database name, view and URL are reused:
  prefix → `{ name, level: 'gene' | 'transcript', viewName: 'GeneFeature' |
  'Transcript', url }`. The ID written follows `level` (transcript IDs for
  `Transcript`; a gene's `Dbxref` at transcript level goes to each of its
  transcripts). Several prefixes may map to one name on purpose
  (`UniProtKB/Swiss-Prot` and `UniProtKB/TrEMBL` → `uniprot_from_annotation`);
  their rows merge into one dataset.
- **URL templates** (`EXTERNAL_ID_HERE`) for prefixes without an override.
  Those keep the sanitized rule at gene level (`GeneFeature`): the prefix is
  lower-cased and every run of characters outside `[a-z0-9]` becomes `_`
  (`ensemblgenomes_gn_from_annotation`). A prefix with neither an override
  nor a template still becomes a dataset with `url` null and a warning.

`target` is always `NAFeature`. A sanitized name shared by two prefixes, or a
sanitized name equal to an override name, is an error (`dbxrefNameClash`);
override prefixes sharing a name are not.

## Output

Written to a staged directory and swapped into place (`swapDirs`), then the
record:

```
final/function/<datasetClass>/<name>/<file>
functional.json
```

`functional.json`, schema version 1:

```json
{
  "schemaVersion": 1,
  "generator": { "name": "dataset-curator genome-pipeline", "version": "3.3.0" },
  "genomeBuild": { "sha256": "…" },
  "source": "GenBank",
  "datasets": [
    { "datasetClass": "productNames", "name": "GenBank", "file": "final/function/productNames/GenBank/products.txt",
      "rows": 436, "sha256": "…", "ids": { "level": "transcript", "count": 436 }, "props": {} },
    { "datasetClass": "dbxref_simple", "name": "uniprot_from_annotation", "file": "…/mapping.txt",
      "rows": 420, "sha256": "…", "ids": { "level": "transcript", "count": 420 },
      "props": { "prefixes": ["UniProtKB/Swiss-Prot", "UniProtKB/TrEMBL"], "url": "…EXTERNAL_ID_HERE", "target": "NAFeature", "viewName": "Transcript" } }
  ],
  "findings": []
}
```

A class with zero rows gets no file and no `datasets` entry; it appears only as
an info finding. Findings use C's shape
(`{ group: 'functional', check, severity, count, sample, message, fix }`):

| Severity | Check |
|---|---|
| error | `unresolvedFeature` (CDS or RNA without a gene), `noProducts` (a coding transcript with no product; productNames is required), `dbxrefNameClash` |
| warning | `unknownDbxrefPrefix` (no URL), `badGo` (malformed `go_*`), `badEc` (EC not `n.n.n.n` with `-` allowed), `geneNameConflict` |
| info | `emptyClass`, `multipleProducts` (sample lists the transcripts) |

`functional` exits 1 when any error finding exists, after writing the record so
the findings can be read; files are still written so a curator can inspect
them.

CLI output: one line per dataset (`class name: rows`), then the findings in C's
format.

## Modules

| Module | Purpose |
|---|---|
| `genome-build.js` | `readGenomeBuild`, moved from `commands/trial.js` |
| `functional/ids.js` | ID resolution over one partition's GFF3 |
| `functional/classes.js` | The extraction table |
| `functional/values.js` | `go_*`, `EC_number`, `Dbxref` parsing and prefix naming |
| `functional/dbxref-urls.js` | Prefix overrides (established datasets) and URL templates |
| `functional/record.js` | `functional.json` build and read |
| `commands/functional.js` | The command |

## Testing

- Unit tests per module with GFF text built inside each test, no committed
  fixture files: attribute splitting and `%2C`, ID resolution (CDS → mRNA →
  gene, ncRNA without CDS, orphan CDS), each table row, `go_*` and `EC_number`
  parsing including partial ECs, prefix naming and clashes, `is_preferred`,
  determinism (two runs, identical bytes), the record shape, and a stale GFF3
  refusal.
- The golden test (`genome-golden.test.js`) runs `functional` on the
  E. cuniculi work area and pins each file as `{ rows, sha256 }` and the class
  counts (442 products, the resolved Dbxref datasets, 0 GO and EC rows for this
  GCA genome).
- Each task runs its own test file and `import-graph.test.js`; the full suite
  runs at checkpoints.
- GO and EC are covered only by synthetic tests until a RefSeq (GCF) golden is
  added.

## Version

3.3.0 (new command).
