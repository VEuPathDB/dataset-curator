# Trial ISF runner

## Problem

D (`docs/superpowers/specs/2026-11-04-gff-pipeline-design.md`) turns an NCBI
annotated genome into ISF-ready partitions and predicts how many gene trees ISF
will build. Two things still need a real GUS database:

- `final/<partition>/transcriptInfoAndIds`. The `NoPreprocess_*_genome_features`
  classes run ISF with `SET_TRANSCRIPT_IDS` and die without it. It is written by
  an ISF run with `PRINT_TRANSCRIPT_IDS`, which needs the sequences loaded.
- Proof that the files load. ISF drops features silently. A transcript can get
  more than one protein, and a 2-CDS gene with no exons loads as one exon
  spanning its intron, which only shows up as an internal stop codon.

This spec is sub-project C of genome preprocessing: D's output in,
`transcriptInfoAndIds` and a QA record out. Background:
`docs/superpowers/research/2026-11-04-trial-isf-spike.md`.

## Decisions

- The runner takes a connection, not a database strategy. The loader mounts a
  `gus.config` naming the target database. The runner never reads that file.
- The target database is UniDB_shu_m for now: one long-lived database, cleaned
  with GUS Undo after each trial. Later, each proposal gets its own copy of the
  seed `unidb_rebuild02_isftest`. Only the mounted `gus.config` changes.
- Image: `gus_isf` (docker-tools, `gus_isf/Dockerfile`). It is
  `gus-apidb-base` plus a GUS and CBIL that compile ISF on perl 5.38, BioPerl,
  and ApiCommonData/Load at a pinned commit. GUS::Model is not in the image,
  because it must match the target schema.
- Node orchestrates, with one `docker run` per GUS step, so a run can resume
  and Undo knows each invocation ID.
- Features load into the sequence dataset's release. The trial does not mirror
  production's `_genome_features_RSRC` names.
- Undo runs at the end by default. `--keep` keeps the rows to inspect. A failed
  step never triggers Undo automatically.

## Command

```
node shared/scripts/genome/genome-pipeline.js trial --workDir <dir> --image <name> --gusConfig <file> --taxonId <ncbi taxon id> [--keep]
node shared/scripts/genome/genome-pipeline.js trial --workDir <dir> --image <name> --gusConfig <file> --undo
```

`--workDir` is D's work area, after `finalize`. The trial writes under
`<workDir>/trial/`, plus `final/<partition>/transcriptInfoAndIds`.

## Steps

Every GUS step is a `docker run --rm --network host -u <uid>:<gid>` of the model
image (below). `gus.config` is mounted read-only at
`$GUS_HOME/config/gus.config` and the work area at `/work`. Steps run in this
order, so the cheap failures surface before hours of ISF:

1. **Preflight** (no writes). The runner refuses when any of these fails:
   - `genome-build.json` is `schemaVersion` 1, and every file its
     `partitions[].final` lists exists and is not empty. `final/` has no
     checksums from D (`genome.gff` is not byte-stable), so the trial records
     the sha256s of the files it loads in `trial.json`.
   - The image's ISF map sha256 differs from
     `genome-build.json`'s `apiCommonData.isfMap.sha256`.
   - `SO_RSRC`, the `--taxonId` row in `sres.taxon` and its genetic code are
     present.
   - Rows already exist for this run's trial release names.
2. **Model image.** The runner fingerprints the target schema: the sha256 of
   `core.tableinfo` (`table_id`, `name`, `database_id`) in id order. It reuses
   the local image `gus_isf-model:<database>-<fingerprint12>`, or else runs
   `rm -rf $GUS_HOME/lib/perl/GUS/Model && bld GUS/Model` against the database
   and `docker commit`s the result under that tag.
3. **Sequences**, per partition:
   - `InsertExternalDatabase --name <db>`;
   - `InsertExternalDatabaseRls --databaseName <db> --databaseVersion <ver>`;
   - `LoadFastaSequences`, with `final/<p>/genome.fasta`,
     `--chromosomeMapFile final/<p>/chromosomeMap.txt` (chromosome primary
     only), `--soTermName <soTerm>`, `--ncbiTaxId`, `--SOExtDbRlsSpec 'SO_RSRC|%'`,
     `--regexSourceId '^>(\S+)'`, `--tableName DoTS::ExternalNASequence`.
   All three run with `--commit`.
4. **ISF run 1**, per partition with `featureCount > 0`. The arguments are those
   of the `NoPreprocess_*_genome_features` classes:
   - `--mapFile $GUS_HOME/lib/xml/isf/genemRNAExonCDS2Gus.xml`
   - `--inputFileOrDir final/<p>/genome.gff --fileFormat gff3`
   - `--soExtDbSpec 'SO_RSRC|%' --defaultOrganism <taxonId> --seqSoTerm <soTerm>`
   - `--seqIdColumn source_id --naSequenceSubclass ExternalNASequence`
   - `--chromosomeMapFile` when the partition has one
   - `--validationLog`, `--bioperlTreeOutput`
   - `--postprocessingDirective PRINT_TRANSCRIPT_IDS --postprocessingDir trial/<p>/`
   - no `--commit`

   On exit 0 only, `trial/<p>/transcriptIds` is copied to
   `final/<p>/transcriptInfoAndIds`. A failed ISF still writes a partial file.
5. **ISF run 2**, per partition with `featureCount > 0`. Same arguments, but
   `--postprocessingDirective SET_TRANSCRIPT_IDS --postprocessingDir final/<p>/`
   and `--commit`.
6. **QA** (SELECTs, below).
7. **Undo**, unless `--keep`. It works through the recorded invocations in
   reverse order:
   - ISF: `InsertSequenceFeaturesUndo --mapFile <map> --algInvocationId <id> --commit`
   - everything else: `GUS::Community::Plugin::Undo --plugin <plugin> --algInvocationId <id> --commit`

   It then confirms that no rows are left for the trial's external database
   releases.

Names:
- Trial external database: `curatorTrial_<accession>_<partition>_RSRC`, where
  `<partition>` is the basename of the partition's `dir`.
- Release version: the run's start time, `YYYYMMDDTHHMMSS`. A rerun after Undo
  never collides with leftovers.

Partitions with `featureCount: 0` load sequences and skip both ISF runs.

Each `ga` logs `AlgInvocationId<TAB><id>`. The runner records that id per step.
A run without one, or with a non-zero exit, fails the step.

## Records

`trial/trial.json`, written atomically after every step:

| Field | Meaning |
|---|---|
| `schemaVersion` | `1` |
| `genomeBuild` | `{ sha256 }` of the `genome-build.json` the trial tested |
| `loaded` | Per partition, the sha256s of the `final/` files it loaded (`genome.gff`, `genome.fasta`, `chromosomeMap.txt`) |
| `image` | `{ name, digest, apiCommonDataCommit, modelTag, schemaFingerprint }` |
| `database` | The database name from `SELECT current_database()`. The config file itself is never read |
| `release` | The release version used |
| `steps[]` | `{ key, plugin, partition, status, exitCode, algInvocationId, log, startedAt, seconds }`. `key` is `<step>:<partition>` |
| `findings[]` | QA findings, in D's finding shape |
| `profile` | Per ISF run: `source` (`pg_stat_statements` or `pg_stat_user_tables`), its top entries, `secondsPerGene` |
| `kept` | `true` when `--keep` left the rows |
| `undone` | `true` once Undo succeeded |

Each `ga` run's output is written to `trial/logs/<key>.log`.

A rerun skips `done` steps while `genomeBuild.sha256` and the `loaded` sha256s
still match. Any difference means D's output changed. The runner then refuses with
"trial is for an older build", and the next step is `trial --undo`. `--undo`
also cleans up after `--keep` and after a failed run.

`genome-build.json` is not modified. F reads `genome-build.json` and
`trial/trial.json`, which is the hand-off.

## QA

After ISF run 2, the runner runs SELECTs scoped to the trial's external database
release IDs. Each result is a finding (`group`, `check`, `severity`, `count`,
`sample`, `message`):

| Check | Severity |
|---|---|
| Genes loaded per partition ≠ `featureCount`; sample: GFF gene IDs missing from `dots.genefeature.source_id` | error |
| Transcript with more than one protein (`dots.translatedaafeature` per transcript) | error |
| Coding transcript with no protein | error |
| Transcript `source_id`s in the database ≠ column 5 of `transcriptInfoAndIds` | error |
| Rows in `transcriptInfoAndIds` ≠ genes loaded | error |
| Protein with an internal stop codon (`dots.translatedaasequence`) | warning |
| ISF `validation.log` not empty (first lines as sample) | warning |
| Seconds per step and per gene, per ISF run | info |
| Top 10 queries by calls and by total time, per ISF run | info |

Profiling:
- It uses `pg_stat_statements` when the extension is installed. The runner
  snapshots it before and after each ISF run and reports the difference.
- Otherwise it falls back to a `pg_stat_user_tables` difference (scans and
  inserts per table).
- The source is recorded either way.

Profiling is how the trial finds out why ISF runs at ~0.57 s/gene.

Any error finding makes `trial` exit non-zero. The rows stay until Undo, which
by default runs after QA.

## Errors

Every failure is a `PipelineError('trial', file, problem, next)` naming the
step, the partition, the log path, and the next step. A `ga` failure includes
the last 20 lines of its log. Only exit status counts; a file existing does not.
A failed step leaves the rows loaded so far. The next step is a rerun (resume)
or `trial --undo`.

## Modules

New code goes in `shared/scripts/genome/trial/`:

| Module | Job |
|---|---|
| `gus.js` | Build the `docker run` argument list for a `ga` call. Parse `AlgInvocationId` and the exit status. Run SELECTs through `selectRows` in the image. One injectable `exec` |
| `selectRows` (Perl) | In the model image. Reads SQL on stdin and prints rows tab-separated. Connects through `GUS::Supported::GusConfig` (`getDbiDsn`, `getDatabaseLogin`, `getDatabasePassword`) and DBI, the same path `ga` uses. It runs one read-only transaction and refuses anything that is not a `SELECT` or `WITH` |
| `model-image.js` | Schema fingerprint, then reuse or build the per-database model image |
| `steps.js` | The step list derived from `genome-build.json`. Plugin arguments per step. The Undo plan |
| `qa.js` | The QA SELECTs, turned into findings, plus profiling snapshots and differences |
| `record.js` | The `trial.json` shape, `schemaVersion`, resume and stale checks |
| `../commands/trial.js` | The `trial` command and `--undo` |

SELECTs run inside the image through `selectRows`, using the mounted
`gus.config`. `gus.config` is GUS's format, which `psql` cannot read. The
credentials never leave the container, and the host needs no database client.
The model-image step copies `selectRows` into `$GUS_HOME/bin`.

## Testing

As for D:
- Each task runs only its own test file plus `tests/import-graph.test.js`, and
  the full suite runs at checkpoints.
- Docker (and so every `ga` and `selectRows` call) sits behind the one `exec` seam. Unit tests feed recorded
  outputs: `ga` exit codes and log tails, SELECT rows, `docker image inspect`.
- No test touches Docker or a database.

What the tests cover:
- Step order and the arguments for each step.
- Partitions with `featureCount: 0`.
- Recording the invocation ID; a missing ID fails the step.
- Copying `transcriptIds` only on exit 0.
- Resume, and refusing a stale build.
- The Undo order, and its plugin and arguments per step.
- Preflight refusals.
- Model image cache hit and miss.
- Turning each QA query into a finding.
- Choosing the profiling source.
- Atomic `trial.json`.

Acceptance (manual, not a test) is D's golden E. cuniculi X/XI output run
against UniDB_shu_m with `gus_isf:local`, about 9 minutes of ISF. It must give:
- 442 genes loaded in both runs;
- zero transcripts with more than one protein;
- a `transcriptInfoAndIds` with 442 rows;
- a clean Undo;
- a first ISF query profile.

## Scope

In scope:
- the `trial` command and `--undo`;
- the per-database model image;
- sequence loading, both ISF runs, QA and profiling;
- `trial.json`.

Out of scope:
- making copies of `unidb_rebuild02_isftest` (needs a DBA);
- publishing `gus_isf` (docker-tools #4 and a Jenkins job);
- speeding up ISF in GUS;
- calling the runner from a skill (F);
- any database writes other than those of the GUS plugins and Undo.

## Version

Minor bump: a new command; no skill calls it yet.
