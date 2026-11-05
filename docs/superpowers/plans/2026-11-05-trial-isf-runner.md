# Trial ISF Runner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `trial` command (and `trial --undo`) that loads D's `final/` partitions into a GUS database inside the `gus_isf` image, writes `final/<partition>/transcriptInfoAndIds`, checks what loaded with QA SELECTs and a query profile, records everything in `trial/trial.json`, and removes the rows with GUS Undo.

**Architecture:** Node orchestrates one `docker run` per GUS step. `trial/gus.js` owns every Docker call (`ga`, `selectRows`, `docker image inspect`, `cat`) behind one injectable `exec`. `trial/steps.js` turns `genome-build.json` into the ordered step list and the Undo plan, `trial/model-image.js` builds or reuses a per-database GUS::Model image, `trial/qa.js` holds every SELECT and turns rows into D's findings, `trial/record.js` owns `trial.json` and resume. `commands/trial.js` runs preflight, steps, QA and Undo; `genome-pipeline.js` wires the CLI. A small Perl script, `trial/selectRows.pl`, runs read-only SELECTs inside the image through `GUS::Supported::GusConfig` and DBI.

**Tech Stack:** Node 18 ES modules (Volta pins 18.20.5), `node:test`, `node:assert/strict`, no npm dependencies; Docker and the `gus_isf` image at run time only; core Perl on the host for the `selectRows.pl` unit test. Spec: `docs/superpowers/specs/2026-11-05-trial-isf-runner-design.md`. Background: `docs/superpowers/research/2026-11-04-trial-isf-spike.md`.

---

## Conventions

- Work in the worktree `/home/jbrestel/workspaces/src/dataset-curator-trial-isf` on branch `feature/trial-isf`. Never commit to `main`.
- New code: `shared/scripts/genome/trial/{gus,model-image,steps,qa,record}.js`, `shared/scripts/genome/trial/selectRows.pl`, `shared/scripts/genome/commands/trial.js`. Nothing under `shared/scripts/genome/` is in `package.json` `sharedFiles`; `bin/sync-shared.js` never copies it.
- Reuse D's helpers; do not copy them: `PipelineError`, `readJson`, `readText`, `sha256`, `sha256File`, `writeJsonAtomic`, `workPaths` (`workdir.js`); `SCHEMA_VERSION`, `GENERATOR`, `BUILD_FILES` (`record.js`); `finding`, `formatFinding` (`checks.js`); `parseGff` (`gff.js`); `isfTrees` (`isf-map.js`); `MAP_PATH` (`preprocess-gff3.js`); `defaultExec`, `failureOutput` (`lib/tools/exec.js`).
- **The exec seam.** Every Docker call goes through one `exec(cmd, args, opts)` with `defaultExec`'s contract: it returns stdout as a string, or throws an error with `status`, `stdout`, `stderr` (and `code: 'ENOENT'` when the binary is missing). `ga` and `bld` runs pass `opts.stdio = ['ignore', fd, fd]` so their output goes straight to the log file; `selectRows` passes `opts.input` (the SQL). Tests pass a fake `exec` fed recorded output: `ga` log tails, `selectRows` TSV and `docker image inspect` JSON, as literal strings. **No test touches Docker or a database.**
- **Testing per task:** run only that task's test file plus the import-graph test, e.g. `node --test --test-reporter=dot /home/jbrestel/workspaces/src/dataset-curator-trial-isf/tests/genome-trial-gus.test.js /home/jbrestel/workspaces/src/dataset-curator-trial-isf/tests/import-graph.test.js`.
- **Full suite only at two checkpoints**, Task 8 (mid-plan) and Task 15 (final): `node --test --test-reporter=dot --test-global-setup=/home/jbrestel/workspaces/src/dataset-curator-trial-isf/tests/globalSetup.js /home/jbrestel/workspaces/src/dataset-curator-trial-isf/tests/*.test.js`. Pass the glob, not the directory.
- Shell: one simple command per call; no `$(...)`, backticks, `;` chains or heredocs. Use `git -C /home/jbrestel/workspaces/src/dataset-curator-trial-isf ...`. Create and edit files with the editor tools only.
- Comments: self-describing code; at most 2–3 line comments, only where the logic is not obvious; no examples that go stale.
- Commit messages end with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (pass it as a second `-m`).
- Test files: `tests/genome-trial-*.test.js` and `tests/genome-trial.test.js`; shared builders in `tests/genome-trial-helpers.js` (not a `*.test.js` file).

## Decisions beyond the spec

Settled while planning, from the GUS source (`GusAppFramework` at the scratchpad clone), `VEuPathDatasets` classes, `docker-gus-apidb-base` and `docker-tools-gus-isf`. The tasks implement these.

1. **AlgInvocationId line.** `GUS::PluginMgr::Plugin::log` (Plugin.pm:1331) prints `join("\t", scalar localtime, @_)` to **STDERR**, so `logAlgInvocationId` writes `<localtime>\tAlgInvocationId\t<id>`, e.g. `Thu Nov  5 10:23:45 2026\tAlgInvocationId\t7322`. GusApplication.pm:607 logs it right after `openInvocation` and again after a successful run (:621). The parser matches `^[^\t\n]*\tAlgInvocationId\t(\d+)$` (multiline) and takes the first match. A run without `--commit` still logs an ID, but its invocation row is rolled back. The runner captures stdout and stderr together in `trial/logs/<key>.log`.
2. **GusConfig.** `GUS::Supported::GusConfig->new()` with no argument reads `$ENV{GUS_HOME}/config/gus.config` and needs only `CBIL::Util::PropertySet` (no GUS::Model). `ga` puts `$GUS_HOME/lib/perl` on `@INC` with `use lib`; the image sets no `PERL5LIB`, so `selectRows.pl` does the same. `gus-apidb-base` installs `libdbi-perl` and `libdbd-pg-perl`. `selectRows.pl` never loads GUS::Model, so it runs in the base image (for the schema fingerprint and preflight) bind-mounted from the host, and from `$GUS_HOME/bin/selectRows` in the model image.
3. **`GUS_HOME` comes from the image.** `docker run` argv is not shell-expanded, so `$GUS_HOME` cannot appear in plugin arguments. The runner reads `GUS_HOME` from `docker image inspect` `Config.Env` (`/opt/veupathdb/gus_home` in `gus-apidb-base`) and refuses an image without it. `image.digest` records the inspect `Id`; `image.apiCommonDataCommit` is `$GUS_HOME/APICOMMONDATA_COMMIT`, which the `gus_isf` Dockerfile writes (null when absent).
4. **Class arguments.** The classes are in `VEuPathDatasets/Model/lib/xml/datasetClass/classes.xml`, not ApiCommonData. Against `NoPreprocess_{primary,secondary,organelle}_genome_features` and `fasta_{primary_genome_sequence,secondary_genome,organelle_genome}`:
   - ISF: the classes pass `--extDbName %PARENT_DATASET_NAME% --extDbRlsVer %PARENT_DATASET_VERSION%` and `--inputFileExtension "gff"`, which the spec's list omits. The trial passes both, with the trial's own database and release; that is how "features load into the sequence dataset's release".
   - ISF and LoadFastaSequences: `--soGusConfigFile` is dropped. SO lookups use the mounted `gus.config`, the same database.
   - ISF: `--validationLog` and `--bioperlTreeOutput` go to `trial/<p>/<run>.validation.log` and `trial/<p>/<run>.bioperlTree.out` (one pair per run), not `final/`.
   - ISF `--chromosomeMapFile`: the organelle class has none; the trial passes it only when the partition's `final.chromosomeMap` is non-null, which D sets for a chromosome primary only.
   - LoadFastaSequences: `--regexSourceId '^>(\S+)'` replaces the class's `${sourceIdRegex}`; `--tableName DoTS::ExternalNASequence` replaces the secondary/organelle classes' `${table}`; the organelle class loads into the parent primary dataset's release, the trial into the partition's own trial database. The classes spell the flag `--soTermName` while the plugin declares `SOTermName`; GUS parses with Getopt::Long, which ignores case, so the trial keeps the class spelling.
5. **Undo arguments.** `GUS::Community::Plugin::Undo` takes `--plugin <name> --algInvocationId <list> --commit` and deletes the plugin's `undoTables` (ExternalDatabase, ExternalDatabaseRelease, AASequenceImp/NASequenceImp for LoadFastaSequences) plus `Core.AlgorithmParam`/`AlgorithmInvocation`. `InsertSequenceFeaturesUndo` takes `--mapFile <map> --algInvocationId <list> --commit`. The trial's `isfPrint` run never commits, so it has nothing to undo and is left out of the Undo plan.
6. **Resume after a committed failure.** A step that ran with `--commit`, failed and logged an AlgInvocationId may have committed rows (ISF commits per tree). Rerunning would load them twice, so the runner refuses to resume and names `trial --undo`. A failed step without an ID, or a failed `isfPrint`, resumes.
7. **`steps[]` is an append-only list of attempts.** Each attempt also records `kind` and `commit`. The last attempt per key decides `done`; every committed attempt with an ID, failed or not, is undone. `trial.json` also carries `generator`, `taxonId`, `trialDatabases` (partition → trial external database name) and `startedAt`.
8. **Gene counts compare against gene trees.** `featureCount` counts every ISF tree, including `repeat_region`, `gap` and UTR trees that never reach `dots.genefeature`. QA re-runs D's `isfTrees` port on `build/<p>/genome.gff3` and compares `dots.genefeature` with the trees whose type is `*_gene` or `pseudogene`, sampling the missing GFF gene IDs. For the golden E. cuniculi build both are 442. Preflight checks that `build/<p>/genome.gff3` still matches `partitions[].buildFiles.gff3`.
9. **"Coding transcript"** means an `mRNA` node in the port's tree without `pseudo`. `transcriptInfoAndIds` rows are compared with genes loaded, as the spec says. A gene with several transcripts would make that an error; NCBI GenBank annotation rarely has them.
10. **Model image cache.** The tag is `gus_isf-model:<database lower-cased, [^a-z0-9_.-] → _>-<fingerprint12>` (Docker tags are lower-case). The cache also requires the label `org.veupathdb.curator.selectRows.sha256` to match the current `selectRows.pl`, so a changed script rebuilds. The build container runs as root (no `-u`) because it writes `$GUS_HOME`.
11. **`selectRows` output** has a header line (column names, lower-case), then rows; `NULL` is `\N`; `\`, tab, newline and CR are escaped. Every query starts with a `-- trial:<name>` line, which the guard strips; the tag names the query in errors, logs and test fakes. The guard also refuses a `;` inside the statement.
12. **`--undo` checks the database.** It reads `current_database()` and refuses a `gus.config` that names a database other than the one in `trial.json`. After Undo it counts rows left in the trial release and, by `row_alg_invocation_id`, in `sres.externaldatabase`, `sres.externaldatabaserelease`, `dots.{nasequence,nafeature,aafeature,aasequence}imp`.
13. **A rerun after a successful Undo starts a new trial** with a new release and overwrites `trial.json`. Release versions are UTC.
14. **Exit status.** `trial` exits 1 when QA has an error finding, after Undo has run.
15. **Acceptance work area.** The golden test gains `GOLDEN_WORKDIR`, so the E. cuniculi X/XI work area can be kept for the manual acceptance (Task 14).
16. **`selectRows.pl` testing.** Only its SQL guard and TSV formatting are unit-tested, with host core Perl (skipped without `perl`). Its DBI path is six lines, the same `GusConfig` + `DBI->connect` path `ga` uses, and the acceptance run exercises it. `DBD::Sponge` or a mock handle would add a non-core Perl dependency to the test suite for little gain.

---

## File structure

| File | Responsibility |
|---|---|
| `shared/scripts/genome/trial/selectRows.pl` | Read one SELECT/WITH on stdin; GusConfig + DBI; read-only transaction; print TSV |
| `shared/scripts/genome/trial/gus.js` | `docker run` arguments, `ga` runs into a log, AlgInvocationId parsing, `selectRows` calls and TSV parsing, `docker image inspect`, reading a file from an image |
| `shared/scripts/genome/trial/steps.js` | Plugin names, trial names, release version, the step list from `genome-build.json`, the Undo plan |
| `shared/scripts/genome/trial/record.js` | `trial.json` paths, shape, schema version, digests of loaded files, resume and stale checks |
| `shared/scripts/genome/trial/model-image.js` | Schema fingerprint, model tag, reuse or build the model image |
| `shared/scripts/genome/trial/qa.js` | Every QA/Undo SELECT, expected gene trees, QA findings, profiling snapshots and differences |
| `shared/scripts/genome/commands/trial.js` | Preflight, `runTrial`, `runTrialUndo` |
| `shared/scripts/genome/genome-pipeline.js` | CLI: `trial` command, `--image`, `--gusConfig`, `--taxonId`, `--keep`, `--undo` |
| `tests/genome-trial-helpers.js` | Trial work area, recorded outputs, fake Docker `exec`, fake clock |
| `tests/genome-trial-*.test.js`, `tests/genome-trial.test.js` | Unit and command tests |

Import order (no cycles): `gus.js` → `steps.js` → `record.js`, `qa.js`, `model-image.js` → `commands/trial.js` → `genome-pipeline.js`.

Signatures used across tasks (keep them exactly):

```js
// gus.js
WORK, inWork(...parts), SELECT_ROWS_SCRIPT, SELECT_ROWS_MOUNT, hostUser(), tail(text, lines = 20)
dockerRunArgs(ctx, command, { stdin = false, mounts = [] } = {})        // ctx = { workDir, image, gusHome, gusConfig, user }
parseAlgInvocationId(log) -> number | null
runLogged(args, logPath, { exec }) -> { exitCode, log }
runGa(ctx, { plugin, args }, logPath, { exec }) -> { exitCode, algInvocationId, log }
parseTsv(text) -> object[]
selectRows(ctx, sql, { exec, mounted = false }) -> object[]
inspectImage(name, { exec }) -> null | { id, gusHome, labels }
readImageFile(image, path, { exec }) -> string | null
// steps.js
PLUGINS, ISF_UNDO, UNDO, ISF_KINDS, TRANSCRIPT_IDS, TRANSCRIPT_INFO
partitionName(part), trialDatabaseName(accession, part), releaseVersion(date), isfMapIn(gusHome), stepKey(kind, partition), isfFiles(kind, partition)
planSteps(build, { taxonId, release, gusHome }) -> [{ key, kind, plugin, partition, dir, commit, args }]
undoPlan(steps, { gusHome }) -> [{ key, kind: 'undo', plugin, partition, commit: true, args }]
// record.js
TRIAL_SCHEMA_VERSION, trialPaths(workDir) -> { trialDir, trialJson, logOf(key), partitionDir(name) }
loadedDigests(build, workDir), newTrialRecord({ genomeBuildSha256, loaded, release, taxonId, image, trialDatabases, startedAt })
readTrialRecord(path) -> record | null, staleProblem(record, { genomeBuildSha256, loaded, taxonId }) -> string | null
lastAttempt(record, key), isDone(record, key), committedFailure(record), saveTrialRecord(path, record)
// model-image.js
FINGERPRINT_SQL, SELECT_ROWS_LABEL, BUILD_MODEL, schemaFingerprint(rows), modelTag(database, fingerprint)
ensureModelImage(baseCtx, database, { exec, logPath }) -> { modelTag, schemaFingerprint, built }
// qa.js
sqlString, sqlList, releasesSql(names, release), genesSql(ids), transcriptsSql(ids), internalStopsSql(ids), leftoversSql(names, release, invocationIds)
expectedModels(gff3Text) -> { geneIds, codingTranscriptIds }, parseTranscriptInfo(text) -> [{ gene, transcript }]
qaFindings(parts, { genes, transcripts, internalStops }) -> finding[]
PROFILE_SOURCE_SQL, STATEMENTS_SQL, TABLES_SQL, profileSource(select), snapshot(source, select), profileDiff(source, before, after), profileEntry(diff, { seconds, genes }), profileFindings(profile)
// commands/trial.js
DATABASE_SQL, SO_SQL, taxonSql(taxonId), checkTrialOptions(options, { undo = false } = {}), readGenomeBuild(workDir) -> { build, sha256 }
imageInfo(image, { exec }), checkImageMap(image, gusHome, build, { exec }), contextOf({ workDir, image, gusConfig, user }, gusHome)
currentDatabase(ctx, expected, { exec }), preflightReferenceData(ctx, { database, taxonId, names, release, fresh }, { exec })
runTrial({ workDir, image, gusConfig, taxonId, keep = false, exec = defaultExec, now = () => new Date(), user = hostUser() }) -> record
runTrialUndo({ workDir, image, gusConfig, exec = defaultExec, now = () => new Date(), user = hostUser() }) -> record
```

---

## Task 1: `selectRows.pl`

**Files:**
- Create: `shared/scripts/genome/trial/selectRows.pl`
- Test: `tests/genome-trial-select-rows.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/genome-trial-select-rows.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { perlMissing } from './genome-helpers.js';

const SCRIPT = fileURLToPath(new URL('../shared/scripts/genome/trial/selectRows.pl', import.meta.url));
const perl = (code, ...args) =>
  spawnSync('perl', ['-e', `require shift @ARGV; ${code}`, SCRIPT, ...args], { encoding: 'utf-8' });

test('guardSql strips leading comment lines and a trailing semicolon from a SELECT or WITH', { skip: perlMissing }, () => {
  assert.equal(perl('print guardSql($ARGV[0])', '-- trial:database\nSELECT current_database() AS name;\n').stdout,
    'SELECT current_database() AS name');
  assert.equal(perl('print guardSql($ARGV[0])', '  with t AS (SELECT 1) SELECT * FROM t').stdout,
    'with t AS (SELECT 1) SELECT * FROM t');
});

test('guardSql refuses anything but one SELECT or WITH', { skip: perlMissing }, () => {
  for (const sql of ['DELETE FROM dots.nafeatureimp', 'SELECT 1; DELETE FROM dots.nafeatureimp', '', '-- trial:x\n', 'SELECTED']) {
    const r = perl('guardSql($ARGV[0])', sql);
    assert.notEqual(r.status, 0, sql);
    assert.match(r.stderr, /^selectRows: only (a SELECT or WITH statement|one statement) is allowed$/m, sql);
  }
});

test('formatRow writes NULL as \\N and escapes backslashes, tabs and newlines', { skip: perlMissing }, () => {
  const r = perl('print formatRow(undef, "a\\tb", "c\\nd", "e\\\\f", "", 7)');
  assert.equal(r.stdout, '\\N\ta\\tb\tc\\nd\te\\\\f\t\t7\n');
});

test('run as a script, it refuses a write before it connects', { skip: perlMissing }, () => {
  const r = spawnSync('perl', [SCRIPT], { input: 'DELETE FROM dots.nafeatureimp', encoding: 'utf-8', env: { PATH: process.env.PATH } });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /selectRows: only a SELECT or WITH statement is allowed/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test --test-reporter=dot /home/jbrestel/workspaces/src/dataset-curator-trial-isf/tests/genome-trial-select-rows.test.js /home/jbrestel/workspaces/src/dataset-curator-trial-isf/tests/import-graph.test.js`
Expected: FAIL; perl reports `Can't locate .../selectRows.pl`.

- [ ] **Step 3: Write `selectRows.pl`**

Create `shared/scripts/genome/trial/selectRows.pl`:

```perl
#!/usr/bin/env perl
# Prints the rows of one SELECT or WITH read on stdin as TSV: a header line, then rows, NULL as \N.
# Connects as ga does (GusConfig at $GUS_HOME/config/gus.config, then DBI) in a read-only transaction.
use strict;
use warnings;

sub guardSql {
  my ($sql) = @_;
  $sql =~ s/\A(?:\s*--[^\n]*\n)*\s*//;
  $sql =~ s/;\s*\z//;
  die "selectRows: only a SELECT or WITH statement is allowed\n" unless $sql =~ /\A(?:SELECT|WITH)\b/i;
  die "selectRows: only one statement is allowed\n" if $sql =~ /;/;
  return $sql;
}

sub formatValue {
  my ($value) = @_;
  return '\N' unless defined $value;
  $value =~ s/\\/\\\\/g;
  $value =~ s/\t/\\t/g;
  $value =~ s/\n/\\n/g;
  $value =~ s/\r/\\r/g;
  return $value;
}

sub formatRow {
  return join("\t", map { formatValue($_) } @_) . "\n";
}

sub main {
  my $sql = guardSql(do { local $/; <STDIN> } // '');
  die "selectRows: GUS_HOME is not set\n" unless $ENV{GUS_HOME};
  unshift @INC, "$ENV{GUS_HOME}/lib/perl";
  require DBI;
  require GUS::Supported::GusConfig;
  my $config = GUS::Supported::GusConfig->new();
  my $dbh = DBI->connect($config->getDbiDsn(), $config->getDatabaseLogin(), $config->getDatabasePassword(),
    { RaiseError => 1, PrintError => 0, AutoCommit => 0 });
  $dbh->do('SET TRANSACTION READ ONLY');
  my $sth = $dbh->prepare($sql);
  $sth->execute();
  binmode STDOUT, ':encoding(UTF-8)';
  print formatRow(@{ $sth->{NAME_lc} });
  while (my @row = $sth->fetchrow_array()) {
    print formatRow(@row);
  }
  $dbh->rollback();
  $dbh->disconnect();
}

main() unless caller;
1;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test --test-reporter=dot /home/jbrestel/workspaces/src/dataset-curator-trial-isf/tests/genome-trial-select-rows.test.js /home/jbrestel/workspaces/src/dataset-curator-trial-isf/tests/import-graph.test.js`
Expected: PASS (4 + 1 tests; the 4 skip when `perl` is missing).

- [ ] **Step 5: Commit**

```
git -C /home/jbrestel/workspaces/src/dataset-curator-trial-isf add shared/scripts/genome/trial/selectRows.pl tests/genome-trial-select-rows.test.js
git -C /home/jbrestel/workspaces/src/dataset-curator-trial-isf commit -m "Trial ISF: selectRows.pl, read-only SELECTs through GusConfig and DBI" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 2: Test helpers: trial work area, recorded outputs, fake Docker

Every later test uses these. The fake `exec` answers the same calls `gus.js` makes, from recorded outputs.

**Files:**
- Create: `tests/genome-trial-helpers.js`

- [ ] **Step 1: Write the helpers**

Create `tests/genome-trial-helpers.js`:

```js
import { mkdirSync, writeFileSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { MAP_PATH } from '../shared/scripts/genome/preprocess-gff3.js';
import { sha256 } from '../shared/scripts/genome/workdir.js';
import { gffLine, gffText, tempDir } from './genome-helpers.js';

export const GUS_HOME = '/opt/veupathdb/gus_home';
export const IMAGE = 'gus_isf:local';
export const IMAGE_ID = 'sha256:4f1c2a9be0d7c3e6f5a8b9d0e1f2a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4';
export const ACD_COMMIT = '585237ffed0bfaa2f1c047c813a7f584091dbe5d';
export const ACCESSION = 'GCA_000000001.1';
export const TAXON_ID = 284813;
export const DATABASE = 'UniDB_shu_m';
export const USER = '1000:1000';
export const START = new Date('2026-11-05T10:23:45.000Z');
export const RELEASE = '20261105T102345';
export const PRIMARY = 'primary_chromosome';
export const ORGANELLE = 'organelle_mitochondrion';
export const MAP_IN_IMAGE = `${GUS_HOME}/lib/xml/isf/genemRNAExonCDS2Gus.xml`;
export const MAP_TEXT = '<mapping>\n  <gusSkeletonMaker class="ApiCommonData::Load::GusSkeletonMaker"/>\n</mapping>\n';
export const trialDb = (partition) => `curatorTrial_${ACCESSION}_${partition}_RSRC`;

export const PLUGIN = Object.freeze({
  externalDatabase: 'GUS::Supported::Plugin::InsertExternalDatabase',
  externalDatabaseRls: 'GUS::Supported::Plugin::InsertExternalDatabaseRls',
  sequences: 'GUS::Supported::Plugin::LoadFastaSequences',
  isf: 'GUS::Supported::Plugin::InsertSequenceFeatures',
  isfUndo: 'GUS::Supported::Plugin::InsertSequenceFeaturesUndo',
  undo: 'GUS::Community::Plugin::Undo'
});

/** build/primary_chromosome/genome.gff3: a coding gene and a tRNA gene, as D's build writes them. */
export const PRIMARY_GFF3 = gffText(
  gffLine('CM000001.1', 'gene', 100, 400, '+', 'ID=TST_0010'),
  gffLine('CM000001.1', 'mRNA', 100, 400, '+', 'ID=TST_0010_mRNA;Parent=TST_0010'),
  gffLine('CM000001.1', 'exon', 100, 400, '+', 'ID=TST_0010_mRNA_exon1;Parent=TST_0010_mRNA'),
  gffLine('CM000001.1', 'CDS', 100, 400, '+', 'ID=PRT1.1;Parent=TST_0010_mRNA;protein_id=PRT1.1'),
  gffLine('CM000001.1', 'gene', 1000, 1072, '+', 'ID=TST_0030'),
  gffLine('CM000001.1', 'tRNA', 1000, 1072, '+', 'ID=rna-TST_0030;Parent=TST_0030'),
  gffLine('CM000001.1', 'exon', 1000, 1072, '+', 'ID=exon-TST_0030-1;Parent=rna-TST_0030')
);
export const PRIMARY_GFF = 'CM000001.1\tEMBL\tgene\t100\t400\t.\t+\t.\tID "TST_0010";\n';
export const PRIMARY_FASTA = '>CM000001.1\nACGT\n';
export const PRIMARY_CHROMOSOME_MAP = 'CM000001.1\tchr1\t1\n';
export const ORGANELLE_FASTA = '>CM000003.1\nACGT\n';

/** ISF's PRINT_TRANSCRIPT_IDS output for PRIMARY_GFF3: gene, sequence, exon orders, exon coordinates, transcript. */
export const TRANSCRIPT_IDS_TEXT = 'TST_0010\tATGAAACCCTAA\t1\t100,400\tTST_0010_mRNA\nTST_0030\tGCGGATTTAGCTCAG\t1\t1000,1072\trna-TST_0030\n';

export function trialBuild() {
  return {
    schemaVersion: 1,
    generator: { name: 'dataset-curator genome-pipeline', version: '3.1.0' },
    source: 'ncbi',
    accession: ACCESSION,
    apiCommonData: {
      commit: ACD_COMMIT, dirty: false, isfMap: { path: MAP_PATH, sha256: sha256(MAP_TEXT) },
      preprocessGFF3: { sha256: sha256('preprocessGFF3'), override: false }
    },
    partitions: [
      {
        role: 'primary', soTerm: 'chromosome', organelle: null, sequenceCount: 1, dir: `final/${PRIMARY}`, featureCount: 2, gffLines: 7,
        final: { gff: 'genome.gff', fasta: 'genome.fasta', chromosomeMap: 'chromosomeMap.txt' },
        buildFiles: { gff3: sha256(PRIMARY_GFF3), fasta: sha256(PRIMARY_FASTA), chromosomeMap: sha256(PRIMARY_CHROMOSOME_MAP) }
      },
      {
        role: 'organelle', soTerm: 'mitochondrial_chromosome', organelle: 'mitochondrion', sequenceCount: 1, dir: `final/${ORGANELLE}`,
        featureCount: 0, gffLines: 1, final: { gff: null, fasta: 'genome.fasta', chromosomeMap: null },
        buildFiles: { gff3: sha256('##gff-version 3\n'), fasta: sha256(ORGANELLE_FASTA), chromosomeMap: null }
      }
    ],
    builtAt: '2026-11-04T00:00:00.000Z',
    finalizedAt: '2026-11-04T00:00:00.000Z'
  };
}

/** A finalized work area for `build`, and a gus.config the runner never reads. */
export function trialWorkDir(build = trialBuild()) {
  const workDir = tempDir('trial-work-');
  const write = (rel, text) => {
    mkdirSync(dirname(join(workDir, rel)), { recursive: true });
    writeFileSync(join(workDir, rel), text);
  };
  write(`build/${PRIMARY}/genome.gff3`, PRIMARY_GFF3);
  write(`final/${PRIMARY}/genome.gff`, PRIMARY_GFF);
  write(`final/${PRIMARY}/genome.fasta`, PRIMARY_FASTA);
  write(`final/${PRIMARY}/chromosomeMap.txt`, PRIMARY_CHROMOSOME_MAP);
  write(`final/${ORGANELLE}/genome.fasta`, ORGANELLE_FASTA);
  write('genome-build.json', `${JSON.stringify(build, null, 2)}\n`);
  const gusConfig = join(tempDir('trial-config-'), 'gus.config');
  writeFileSync(gusConfig, 'dbiDsn=dbi:Pg:dbname=UniDB_shu_m;host=localhost;port=5432\n');
  return { workDir, gusConfig };
}

/** Each call returns the next second, starting at `start`. */
export function fakeClock(start = START) {
  let t = start.getTime();
  return () => {
    const d = new Date(t);
    t += 1000;
    return d;
  };
}

/** `docker image inspect gus_isf:local`, trimmed to the fields the runner reads. */
export const INSPECT_BASE = `[
  {
    "Id": "${IMAGE_ID}",
    "RepoTags": ["gus_isf:local"],
    "Config": {
      "Env": [
        "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/opt/veupathdb/project_home/install/bin:/opt/veupathdb/gus_home/bin:/opt/java/bin:/usr/lib/postgresql/16/bin",
        "GUS_HOME=/opt/veupathdb/gus_home",
        "PROJECT_HOME=/opt/veupathdb/project_home"
      ],
      "Labels": null,
      "WorkingDir": "/work"
    }
  }
]`;

export const modelInspect = (labels) => JSON.stringify([{
  Id: 'sha256:7c2e0d4f9b8a6c5e3d2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b1c0d',
  RepoTags: [],
  Config: { Env: [`GUS_HOME=${GUS_HOME}`], Labels: labels }
}]);

/** What GusApplication writes to stdout and stderr for one `ga` run. */
export function gaLog(id, plugin, failure = null) {
  const at = 'Thu Nov  5 10:23:45 2026';
  const invocation = id === null ? [] : [`${at}\tAlgInvocationId\t${id}`, `${at}\tCOMMIT\tcommit on`];
  const end = failure
    ? ['', 'ERROR:', failure, '', 'STACK TRACE:', `  at ${GUS_HOME}/lib/perl/GUS/PluginMgr/GusApplication.pm line 598.`]
    : [`${at}\tTIME\t10 sec  (0:00:10)`, `${at}\tRESULT\tdone`, ...invocation];
  return [`${at}\tDSN\tdbi:Pg:dbname=UniDB_shu_m;host=localhost;port=5432`, `${at}\tPLUGIN\t${plugin}`, ...invocation, ...end, ''].join('\n');
}

/** selectRows output, keyed by each query's `-- trial:<name>` tag. */
export const SELECTS = {
  database: 'name\nUniDB_shu_m\n',
  soRelease: 'n\n1\n',
  taxon: 'taxon_id\tgenetic_code_id\tcodes\n91245\t1\t1\n',
  schemaFingerprint: 'table_id\tname\tdatabase_id\n1\tAlgorithm\t1\n2\tAlgorithmImplementation\t1\n56\tExternalNASequence\t3\n',
  genes: 'release_id\tsource_id\n501\tTST_0010\n501\tTST_0030\n',
  transcripts: 'release_id\tsource_id\tproteins\n501\tTST_0010_mRNA\t1\n501\trna-TST_0030\t0\n',
  internalStops: 'release_id\tsource_id\n',
  profileSource: 'n\n1\n',
  leftovers: 'what\tn\ntrialRelease\t0\nsres.externaldatabase\t0\nsres.externaldatabaserelease\t0\ndots.nasequenceimp\t0\ndots.nafeatureimp\t0\ndots.aafeatureimp\t0\ndots.aasequenceimp\t0\n'
};
export const RELEASES_LOADED = `name\trelease_id\n${trialDb(PRIMARY)}\t501\n${trialDb(ORGANELLE)}\t502\n`;
export const statementsAt = (k) => 'queryid\tcalls\ttotal_exec_time\tquery\n'
  + `-4211\t${2 * k}\t${1.5 * k}\tselect name, ontology_term_id from SRES.ontologyterm where external_database_release_id=$1\n`
  + `881\t${k}\t${30 * k}\tINSERT INTO DoTS.NAFeatureImp (na_feature_id, subclass_view) VALUES ($1, $2)\n`;
export const tablesAt = (k) => 'name\tseq_scan\tidx_scan\tn_tup_ins\n'
  + `sres.ontologyterm\t${3 * k}\t${k}\t0\n`
  + `dots.nafeatureimp\t${k}\t${2 * k}\t${4 * k}\n`;

const DEFAULT_FILES = { [MAP_IN_IMAGE]: MAP_TEXT, [`${GUS_HOME}/APICOMMONDATA_COMMIT`]: `${ACD_COMMIT}\n` };
const COMMANDS = ['ga', 'cat', 'bash', 'perl'];
const commandAt = (args) => args.findIndex((a) => COMMANDS.includes(a));
const failure = (status, stderr) => Object.assign(new Error(`Command failed with status ${status}`), { status, stdout: '', stderr });
const argAfter = (args, flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : null);

/**
 * A Docker stand-in for the exec seam. `ga(call, state)` may return { exitCode, id, log, writes } to override the
 * default success (next AlgInvocationId; a PRINT run writes transcriptIds). `selects` overrides SELECTS by tag,
 * with a string or (sql, state) => string. `files` overrides what `cat` reads from an image (null: missing).
 */
export function fakeDocker({ ga = null, selects = {}, files = {}, images = { [IMAGE]: INSPECT_BASE }, buildExit = 0 } = {}) {
  const calls = [];
  const state = { images: { ...images }, nextId: 7319, plugins: [], snapshots: 0 };

  const select = (sql) => {
    const name = sql.match(/^-- trial:(\w+)/)[1];
    const override = selects[name];
    if (typeof override === 'function') return override(sql, state);
    if (override !== undefined) return override;
    if (name === 'releases') return state.plugins.includes(PLUGIN.externalDatabaseRls) ? RELEASES_LOADED : 'name\trelease_id\n';
    if (name === 'statements') return statementsAt(++state.snapshots);
    if (name === 'tables') return tablesAt(++state.snapshots);
    if (!(name in SELECTS)) throw failure(1, `DBD::Pg::st execute failed: no fake for ${name}`);
    return SELECTS[name];
  };

  const runGa = (args, opts) => {
    const at = commandAt(args);
    const mount = args.find((a, i) => args[i - 1] === '-v' && a.endsWith(':/work'));
    const call = { plugin: args[at + 1], args: args.slice(at + 2), host: mount.slice(0, -':/work'.length) };
    call.directive = argAfter(call.args, '--postprocessingDirective');
    const result = ga?.(call, state) ?? {};
    const id = 'id' in result ? result.id : state.nextId++;
    const exitCode = result.exitCode ?? 0;
    const printed = call.directive === 'PRINT_TRANSCRIPT_IDS' && exitCode === 0
      ? { [`${argAfter(call.args, '--postprocessingDir')}transcriptIds`]: TRANSCRIPT_IDS_TEXT } : {};
    for (const [path, text] of Object.entries(result.writes ?? printed)) {
      const host = path.replace(/^\/work/, call.host);
      mkdirSync(dirname(host), { recursive: true });
      writeFileSync(host, text);
    }
    if (call.plugin === PLUGIN.undo && call.args.includes(PLUGIN.externalDatabaseRls)) {
      state.plugins = state.plugins.filter((p) => p !== PLUGIN.externalDatabaseRls);
    } else {
      state.plugins.push(call.plugin);
    }
    writeSync(opts.stdio[1], result.log ?? gaLog(id, call.plugin, exitCode === 0 ? null : 'died'));
    if (exitCode !== 0) throw failure(exitCode, '');
    return null;
  };

  const exec = (cmd, args, opts = {}) => {
    calls.push({ cmd, args, input: opts.input ?? null });
    if (cmd !== 'docker') throw failure(127, `${cmd}: not faked`);
    if (args[0] === 'image' && args[1] === 'inspect') {
      if (state.images[args[2]]) return state.images[args[2]];
      throw failure(1, `Error response from daemon: No such image: ${args[2]}`);
    }
    if (args[0] === 'rm') return '';
    if (args[0] === 'commit') {
      const [key, value] = argAfter(args, '--change').replace(/^LABEL /, '').split('=');
      state.images[args.at(-1)] = modelInspect({ [key]: value });
      return 'sha256:7c2e0d4f9b8a\n';
    }
    const at = commandAt(args);
    if (args[at] === 'cat') {
      const path = args[at + 1];
      const text = path in files ? files[path] : DEFAULT_FILES[path];
      if (text === undefined || text === null) throw failure(1, `cat: ${path}: No such file or directory`);
      return text;
    }
    if (args[at] === 'bash') {
      writeSync(opts.stdio[1], buildExit === 0 ? 'generateGusObjects: done\nBUILD SUCCESSFUL\n' : 'DBI connect failed\nBUILD FAILED\n');
      if (buildExit !== 0) throw failure(buildExit, '');
      return null;
    }
    if (args[at] === 'perl') return select(opts.input);
    if (args[at] === 'ga') return runGa(args, opts);
    throw failure(125, `unexpected docker call: ${args.join(' ')}`);
  };

  const gaCalls = () => calls.filter((c) => c.args[commandAt(c.args)] === 'ga')
    .map((c) => ({ plugin: c.args[commandAt(c.args) + 1], args: c.args.slice(commandAt(c.args) + 2) }));
  const queries = () => calls.filter((c) => c.input !== null).map((c) => c.input.match(/^-- trial:(\w+)/)[1]);
  return { exec, calls, state, gaCalls, queries };
}
```

- [ ] **Step 2: Check that it loads**

Run: `node --input-type=module -e "import('/home/jbrestel/workspaces/src/dataset-curator-trial-isf/tests/genome-trial-helpers.js').then((m) => console.log(Object.keys(m).length))"`
Expected: prints a number (no import error).

- [ ] **Step 3: Commit**

```
git -C /home/jbrestel/workspaces/src/dataset-curator-trial-isf add tests/genome-trial-helpers.js
git -C /home/jbrestel/workspaces/src/dataset-curator-trial-isf commit -m "Trial ISF: test work area, recorded outputs and fake Docker" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 3: `gus.js`, the Docker seam

**Files:**
- Create: `shared/scripts/genome/trial/gus.js`
- Test: `tests/genome-trial-gus.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/genome-trial-gus.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import {
  dockerRunArgs, inspectImage, inWork, parseAlgInvocationId, parseTsv, readImageFile, runGa, SELECT_ROWS_MOUNT, SELECT_ROWS_SCRIPT,
  selectRows, tail
} from '../shared/scripts/genome/trial/gus.js';
import { PipelineError } from '../shared/scripts/genome/workdir.js';
import { tempDir } from './genome-helpers.js';
import { GUS_HOME, IMAGE_ID, INSPECT_BASE } from './genome-trial-helpers.js';

const CTX = { workDir: '/data/work', image: 'gus_isf-model:unidb_shu_m-0123456789ab', gusHome: GUS_HOME, gusConfig: '/home/me/gus.config', user: '1000:1000' };

const GA_LOG_OK = [
  'Thu Nov  5 10:23:45 2026\tDSN\tdbi:Pg:dbname=UniDB_shu_m;host=localhost;port=5432',
  'Thu Nov  5 10:23:45 2026\tPLUGIN\tGUS::Supported::Plugin::LoadFastaSequences',
  'Thu Nov  5 10:23:45 2026\tAlgInvocationId\t7322',
  'Thu Nov  5 10:23:45 2026\tCOMMIT\tcommit on',
  'Thu Nov  5 10:23:55 2026\tTIME\t10 sec  (0:00:10)',
  'Thu Nov  5 10:23:55 2026\tRESULT\tInserted 11 sequences',
  'Thu Nov  5 10:23:55 2026\tAlgInvocationId\t7322',
  'Thu Nov  5 10:23:55 2026\tCOMMIT\tcommit on',
  ''
].join('\n');

const GA_LOG_DIED_IN_OPEN_INVOCATION = [
  "Invalid child name for Table GUS::Model::Core::AlgorithmInvocation_Table: 'GUS::Model::ApidbUserDatasets::AnnotationProperties'"
    + ' at /opt/veupathdb/gus_home/lib/perl/GUS/ObjRelP/DbiTable.pm line 312.',
  ''
].join('\n');

const GA_LOG_ISF_DIED = [
  'Thu Nov  5 10:30:01 2026\tDSN\tdbi:Pg:dbname=UniDB_shu_m;host=localhost;port=5432',
  'Thu Nov  5 10:30:01 2026\tPLUGIN\tGUS::Supported::Plugin::InsertSequenceFeatures',
  'Thu Nov  5 10:30:01 2026\tAlgInvocationId\t7325',
  'Thu Nov  5 10:30:01 2026\tCOMMIT\tcommit off',
  '',
  'ERROR:',
  'double check the number of CDS and exons of ECU10_0805, not consistant with the exon number',
  '',
  'STACK TRACE:',
  '  at /opt/veupathdb/gus_home/lib/perl/GUS/PluginMgr/GusApplication.pm line 598.',
  ''
].join('\n');

test('dockerRunArgs mounts gus.config read-only at $GUS_HOME/config and the work area at /work, as the host user', () => {
  assert.deepEqual(dockerRunArgs(CTX, ['ga', 'GUS::Supported::Plugin::InsertExternalDatabase', '--name', 'x']), [
    'run', '--rm', '--network', 'host', '-u', '1000:1000', '-e', 'HOME=/tmp',
    '-v', '/home/me/gus.config:/opt/veupathdb/gus_home/config/gus.config:ro', '-v', '/data/work:/work', '-w', '/work',
    CTX.image, 'ga', 'GUS::Supported::Plugin::InsertExternalDatabase', '--name', 'x'
  ]);
  assert.deepEqual(dockerRunArgs(CTX, ['perl', '/x.pl'], { stdin: true, mounts: ['/a:/b:ro'] }).slice(14),
    ['-v', '/a:/b:ro', '-i', CTX.image, 'perl', '/x.pl']);
  assert.equal(inWork('final/primary_chromosome', 'genome.gff'), '/work/final/primary_chromosome/genome.gff');
});

test('parseAlgInvocationId reads the first timestamped AlgInvocationId line and nothing else', () => {
  assert.equal(parseAlgInvocationId(GA_LOG_OK), 7322);
  assert.equal(parseAlgInvocationId(GA_LOG_ISF_DIED), 7325);
  assert.equal(parseAlgInvocationId(GA_LOG_DIED_IN_OPEN_INVOCATION), null);
  assert.equal(parseAlgInvocationId('Thu Nov  5 10:23:55 2026\tRESULT\tAlgInvocationId\t99\n'), null);
});

test('runGa writes the container output to the log and reads the invocation ID from it', () => {
  const logPath = join(tempDir('ga-'), 'logs', 'sequences:primary_chromosome.log');
  const calls = [];
  const exec = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    writeSync(opts.stdio[1], GA_LOG_OK);
    return null;
  };
  const result = runGa(CTX, { plugin: 'GUS::Supported::Plugin::LoadFastaSequences', args: ['--commit'] }, logPath, { exec });
  assert.deepEqual(result, { exitCode: 0, algInvocationId: 7322, log: GA_LOG_OK });
  assert.equal(readFileSync(logPath, 'utf-8'), GA_LOG_OK);
  assert.equal(calls[0].cmd, 'docker');
  assert.deepEqual(calls[0].args.slice(-3), ['ga', 'GUS::Supported::Plugin::LoadFastaSequences', '--commit']);
  assert.equal(calls[0].opts.stdio[0], 'ignore');
});

test('runGa reports the exit status of a failed ga with the ID it logged before dying', () => {
  const logPath = join(tempDir('ga-'), 'isfPrint:primary_chromosome.log');
  const exec = (cmd, args, opts) => {
    writeSync(opts.stdio[1], GA_LOG_ISF_DIED);
    throw Object.assign(new Error('Command failed'), { status: 255 });
  };
  const result = runGa(CTX, { plugin: 'GUS::Supported::Plugin::InsertSequenceFeatures', args: [] }, logPath, { exec });
  assert.equal(result.exitCode, 255);
  assert.equal(result.algInvocationId, 7325);
  assert.match(tail(result.log), /ERROR:\ndouble check the number of CDS/);
});

test('a missing docker binary is a PipelineError, not a failed step', () => {
  const exec = () => { throw Object.assign(new Error('spawnSync docker ENOENT'), { code: 'ENOENT' }); };
  assert.throws(() => runGa(CTX, { plugin: 'p', args: [] }, join(tempDir('ga-'), 'x.log'), { exec }),
    (e) => e instanceof PipelineError && e.file === 'docker' && e.problem === 'is not on PATH');
});

test('tail keeps the last 20 lines', () => {
  const text = `${Array.from({ length: 25 }, (_, i) => `line ${i + 1}`).join('\n')}\n`;
  assert.equal(tail(text), Array.from({ length: 20 }, (_, i) => `line ${i + 6}`).join('\n'));
});

test('parseTsv reads selectRows output: header, \\N as null, escapes undone', () => {
  assert.deepEqual(parseTsv('a\tb\tc\n1\t\\N\tx\\ty\\\\z\n\t\t\n'), [{ a: '1', b: null, c: 'x\ty\\z' }, { a: '', b: '', c: '' }]);
  assert.deepEqual(parseTsv('a\tb\n'), []);
  assert.deepEqual(parseTsv(''), []);
});

test('selectRows feeds the SQL on stdin to selectRows in the model image and parses its TSV', () => {
  const calls = [];
  const exec = (cmd, args, opts) => {
    calls.push({ args, opts });
    return 'name\trelease_id\ncuratorTrial_GCA_000000001.1_primary_chromosome_RSRC\t501\n';
  };
  const sql = '-- trial:releases\nSELECT d.name, r.external_database_release_id AS release_id FROM x';
  assert.deepEqual(selectRows(CTX, sql, { exec }), [{ name: 'curatorTrial_GCA_000000001.1_primary_chromosome_RSRC', release_id: '501' }]);
  assert.deepEqual(calls[0].args.slice(-4), ['-i', CTX.image, 'perl', '/opt/veupathdb/gus_home/bin/selectRows']);
  assert.equal(calls[0].opts.input, sql);
});

test('selectRows with mounted: true runs the host copy of selectRows.pl, for an image that lacks it', () => {
  const calls = [];
  const exec = (cmd, args) => { calls.push(args); return 'name\nUniDB_shu_m\n'; };
  assert.deepEqual(selectRows(CTX, '-- trial:database\nSELECT current_database() AS name', { exec, mounted: true }), [{ name: 'UniDB_shu_m' }]);
  assert.deepEqual(calls[0].slice(14), ['-v', `${SELECT_ROWS_SCRIPT}:${SELECT_ROWS_MOUNT}:ro`, '-i', CTX.image, 'perl', SELECT_ROWS_MOUNT]);
});

test('a failed SELECT is a PipelineError naming its query tag and what DBI printed', () => {
  const exec = () => {
    throw Object.assign(new Error('Command failed'), { status: 255, stdout: '', stderr: 'DBD::Pg::st execute failed: ERROR:  relation "core.tableinfo" does not exist' });
  };
  assert.throws(() => selectRows(CTX, '-- trial:schemaFingerprint\nSELECT 1', { exec }),
    (e) => e instanceof PipelineError && e.file === 'selectRows' && /^-- trial:schemaFingerprint failed: DBD::Pg::st execute failed/.test(e.problem));
});

test('inspectImage reads the image ID, GUS_HOME and labels, and null for no such image', () => {
  assert.deepEqual(inspectImage('gus_isf:local', { exec: () => INSPECT_BASE }), { id: IMAGE_ID, gusHome: GUS_HOME, labels: {} });
  const missing = () => { throw Object.assign(new Error('x'), { status: 1, stdout: '', stderr: 'Error response from daemon: No such image: nope:1' }); };
  assert.equal(inspectImage('nope:1', { exec: missing }), null);
  const down = () => { throw Object.assign(new Error('x'), { status: 1, stdout: '', stderr: 'Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?' }); };
  assert.throws(() => inspectImage('gus_isf:local', { exec: down }), /docker image inspect failed: Cannot connect to the Docker daemon/);
});

test('readImageFile cats a file from the image, or null when it is not there', () => {
  const calls = [];
  const exec = (cmd, args) => { calls.push(args); return 'abc\n'; };
  assert.equal(readImageFile('gus_isf:local', '/opt/x', { exec }), 'abc\n');
  assert.deepEqual(calls[0], ['run', '--rm', 'gus_isf:local', 'cat', '/opt/x']);
  const absent = () => { throw Object.assign(new Error('x'), { status: 1, stdout: '', stderr: 'cat: /opt/x: No such file or directory' }); };
  assert.equal(readImageFile('gus_isf:local', '/opt/x', { exec: absent }), null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test --test-reporter=dot /home/jbrestel/workspaces/src/dataset-curator-trial-isf/tests/genome-trial-gus.test.js /home/jbrestel/workspaces/src/dataset-curator-trial-isf/tests/import-graph.test.js`
Expected: FAIL with `Cannot find module .../trial/gus.js`.

- [ ] **Step 3: Write `gus.js`**

Create `shared/scripts/genome/trial/gus.js`:

```js
import { closeSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { dirname, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { failureOutput } from '../../lib/tools/exec.js';
import { PipelineError } from '../workdir.js';

export const WORK = '/work';
export const inWork = (...parts) => posix.join(WORK, ...parts);
export const SELECT_ROWS_SCRIPT = fileURLToPath(new URL('./selectRows.pl', import.meta.url));
export const SELECT_ROWS_MOUNT = '/opt/curator/selectRows.pl';
const MAX_BUFFER = 512 * 1024 * 1024;
const ALG_INVOCATION = /^[^\t\n]*\tAlgInvocationId\t(\d+)$/m;
const UNESCAPE = { '\\': '\\', t: '\t', n: '\n', r: '\r' };

export const hostUser = () => `${process.getuid()}:${process.getgid()}`;
export const tail = (text, lines = 20) => text.trimEnd().split('\n').slice(-lines).join('\n');
const dockerMissing = () => new PipelineError('trial', 'docker', 'is not on PATH', 'install Docker or put it on PATH');

export function dockerRunArgs(ctx, command, { stdin = false, mounts = [] } = {}) {
  return [
    'run', '--rm', '--network', 'host', '-u', ctx.user, '-e', 'HOME=/tmp',
    '-v', `${ctx.gusConfig}:${ctx.gusHome}/config/gus.config:ro`, '-v', `${ctx.workDir}:${WORK}`, '-w', WORK,
    ...mounts.flatMap((mount) => ['-v', mount]), ...(stdin ? ['-i'] : []),
    ctx.image, ...command
  ];
}

/** ga's Plugin::log writes `<scalar localtime>\tAlgInvocationId\t<id>` to stderr once its invocation row exists. */
export function parseAlgInvocationId(log) {
  const match = log.match(ALG_INVOCATION);
  return match ? Number(match[1]) : null;
}

/** Runs docker with stdout and stderr in `logPath`. Only the exit status says whether it worked. */
export function runLogged(args, logPath, { exec }) {
  mkdirSync(dirname(logPath), { recursive: true });
  const fd = openSync(logPath, 'w');
  let exitCode = 0;
  try {
    exec('docker', args, { stdio: ['ignore', fd, fd] });
  } catch (e) {
    if (e.code === 'ENOENT') throw dockerMissing();
    exitCode = typeof e.status === 'number' ? e.status : 1;
  } finally {
    closeSync(fd);
  }
  return { exitCode, log: readFileSync(logPath, 'utf-8') };
}

export function runGa(ctx, { plugin, args }, logPath, { exec }) {
  const { exitCode, log } = runLogged(dockerRunArgs(ctx, ['ga', plugin, ...args]), logPath, { exec });
  return { exitCode, algInvocationId: parseAlgInvocationId(log), log };
}

const unescapeValue = (value) => (value === '\\N' ? null : value.replace(/\\([\\tnr])/g, (_, c) => UNESCAPE[c]));

/** selectRows output: a header line, then one line per row. */
export function parseTsv(text) {
  const lines = text.replace(/\n$/, '').split('\n');
  if (lines.length === 1 && lines[0] === '') return [];
  const [header, ...rows] = lines;
  const names = header.split('\t');
  return rows.map((row) => Object.fromEntries(row.split('\t').map((value, i) => [names[i], unescapeValue(value)])));
}

export function selectRows(ctx, sql, { exec, mounted = false }) {
  const command = ['perl', mounted ? SELECT_ROWS_MOUNT : posix.join(ctx.gusHome, 'bin/selectRows')];
  const mounts = mounted ? [`${SELECT_ROWS_SCRIPT}:${SELECT_ROWS_MOUNT}:ro`] : [];
  let out;
  try {
    out = exec('docker', dockerRunArgs(ctx, command, { stdin: true, mounts }), { input: sql, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: MAX_BUFFER });
  } catch (e) {
    if (e.code === 'ENOENT') throw dockerMissing();
    throw new PipelineError('trial', 'selectRows', `${sql.split('\n')[0]} failed: ${failureOutput(e)}`,
      'check that the mounted gus.config reaches the database, then run trial again');
  }
  return parseTsv(out);
}

export function inspectImage(name, { exec }) {
  let out;
  try {
    out = exec('docker', ['image', 'inspect', name]);
  } catch (e) {
    if (e.code === 'ENOENT') throw dockerMissing();
    if (/No such image/i.test(failureOutput(e))) return null;
    throw new PipelineError('trial', name, `docker image inspect failed: ${failureOutput(e)}`, 'check that Docker is running');
  }
  const [info] = JSON.parse(out);
  const env = Object.fromEntries((info.Config?.Env ?? []).map((kv) => [kv.slice(0, kv.indexOf('=')), kv.slice(kv.indexOf('=') + 1)]));
  return { id: info.Id, gusHome: env.GUS_HOME ?? null, labels: info.Config?.Labels ?? {} };
}

export function readImageFile(image, path, { exec }) {
  try {
    return exec('docker', ['run', '--rm', image, 'cat', path]);
  } catch (e) {
    if (e.code === 'ENOENT') throw dockerMissing();
    return null;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test --test-reporter=dot /home/jbrestel/workspaces/src/dataset-curator-trial-isf/tests/genome-trial-gus.test.js /home/jbrestel/workspaces/src/dataset-curator-trial-isf/tests/import-graph.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git -C /home/jbrestel/workspaces/src/dataset-curator-trial-isf add shared/scripts/genome/trial/gus.js tests/genome-trial-gus.test.js
git -C /home/jbrestel/workspaces/src/dataset-curator-trial-isf commit -m "Trial ISF: Docker seam for ga, selectRows and image inspection" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 4: `steps.js`, the step list and the Undo plan

**Files:**
- Create: `shared/scripts/genome/trial/steps.js`
- Test: `tests/genome-trial-steps.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/genome-trial-steps.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ISF_UNDO, isfFiles, isfMapIn, partitionName, planSteps, PLUGINS, releaseVersion, trialDatabaseName, UNDO, undoPlan
} from '../shared/scripts/genome/trial/steps.js';
import { GUS_HOME, MAP_IN_IMAGE, ORGANELLE, PRIMARY, RELEASE, START, TAXON_ID, trialBuild, trialDb } from './genome-trial-helpers.js';

const build = trialBuild();
const steps = planSteps(build, { taxonId: TAXON_ID, release: RELEASE, gusHome: GUS_HOME });
const byKey = (key) => steps.find((s) => s.key === key);

test('names: partition, trial database, release version, map in the image', () => {
  assert.equal(partitionName(build.partitions[0]), PRIMARY);
  assert.equal(trialDatabaseName(build.accession, build.partitions[1]), trialDb(ORGANELLE));
  assert.equal(releaseVersion(new Date('2026-11-05T10:23:45.678Z')), RELEASE);
  assert.equal(isfMapIn(GUS_HOME), MAP_IN_IMAGE);
  assert.deepEqual(isfFiles('isfSet', PRIMARY), {
    validationLog: `trial/${PRIMARY}/isfSet.validation.log`, bioperlTree: `trial/${PRIMARY}/isfSet.bioperlTree.out`
  });
});

test('sequences load for every partition first, then ISF run 1 and run 2 for partitions with features', () => {
  assert.deepEqual(steps.map((s) => s.key), [
    `externalDatabase:${PRIMARY}`, `externalDatabaseRls:${PRIMARY}`, `sequences:${PRIMARY}`,
    `externalDatabase:${ORGANELLE}`, `externalDatabaseRls:${ORGANELLE}`, `sequences:${ORGANELLE}`,
    `isfPrint:${PRIMARY}`, `isfSet:${PRIMARY}`
  ]);
  assert.deepEqual(steps.map((s) => s.commit), [true, true, true, true, true, true, false, true]);
});

test('the external database and its release are the trial names, with --commit', () => {
  assert.deepEqual(byKey(`externalDatabase:${PRIMARY}`), {
    key: `externalDatabase:${PRIMARY}`, kind: 'externalDatabase', plugin: PLUGINS.externalDatabase, partition: PRIMARY,
    dir: `final/${PRIMARY}`, commit: true, args: ['--name', trialDb(PRIMARY), '--commit']
  });
  assert.deepEqual(byKey(`externalDatabaseRls:${PRIMARY}`).args, ['--databaseName', trialDb(PRIMARY), '--databaseVersion', RELEASE, '--commit']);
});

test('LoadFastaSequences takes the class arguments, and a chromosome map only where the partition has one', () => {
  assert.deepEqual(byKey(`sequences:${PRIMARY}`).args, [
    '--externalDatabaseName', trialDb(PRIMARY), '--externalDatabaseVersion', RELEASE, '--ncbiTaxId', '284813',
    '--sequenceFile', `/work/final/${PRIMARY}/genome.fasta`, '--chromosomeMapFile', `/work/final/${PRIMARY}/chromosomeMap.txt`,
    '--soTermName', 'chromosome', '--SOExtDbRlsSpec', 'SO_RSRC|%', '--regexSourceId', '^>(\\S+)',
    '--tableName', 'DoTS::ExternalNASequence', '--commit'
  ]);
  assert.deepEqual(byKey(`sequences:${ORGANELLE}`).args, [
    '--externalDatabaseName', trialDb(ORGANELLE), '--externalDatabaseVersion', RELEASE, '--ncbiTaxId', '284813',
    '--sequenceFile', `/work/final/${ORGANELLE}/genome.fasta`,
    '--soTermName', 'mitochondrial_chromosome', '--SOExtDbRlsSpec', 'SO_RSRC|%', '--regexSourceId', '^>(\\S+)',
    '--tableName', 'DoTS::ExternalNASequence', '--commit'
  ]);
});

const isfArgs = (kind, directive, postprocessingDir) => [
  '--extDbName', trialDb(PRIMARY), '--extDbRlsVer', RELEASE, '--mapFile', MAP_IN_IMAGE,
  '--inputFileOrDir', `/work/final/${PRIMARY}/genome.gff`, '--inputFileExtension', 'gff',
  '--chromosomeMapFile', `/work/final/${PRIMARY}/chromosomeMap.txt`,
  '--fileFormat', 'gff3', '--soExtDbSpec', 'SO_RSRC|%', '--defaultOrganism', '284813', '--seqSoTerm', 'chromosome',
  '--validationLog', `/work/trial/${PRIMARY}/${kind}.validation.log`, '--bioperlTreeOutput', `/work/trial/${PRIMARY}/${kind}.bioperlTree.out`,
  '--seqIdColumn', 'source_id', '--naSequenceSubclass', 'ExternalNASequence',
  '--postprocessingDirective', directive, '--postprocessingDir', postprocessingDir
];

test('ISF run 1 prints transcript IDs into trial/<p>/ without --commit; run 2 sets them from final/<p>/ with --commit', () => {
  assert.deepEqual(byKey(`isfPrint:${PRIMARY}`).args, isfArgs('isfPrint', 'PRINT_TRANSCRIPT_IDS', `/work/trial/${PRIMARY}/`));
  assert.deepEqual(byKey(`isfSet:${PRIMARY}`).args, [...isfArgs('isfSet', 'SET_TRANSCRIPT_IDS', `/work/final/${PRIMARY}/`), '--commit']);
  assert.equal(byKey(`isfSet:${PRIMARY}`).plugin, PLUGINS.isfSet);
});

test('a build with no features anywhere loads sequences only', () => {
  const bare = trialBuild();
  bare.partitions[0] = { ...bare.partitions[0], featureCount: 0, final: { ...bare.partitions[0].final, gff: null } };
  const kinds = planSteps(bare, { taxonId: TAXON_ID, release: RELEASE, gusHome: GUS_HOME }).map((s) => s.kind);
  assert.deepEqual([...new Set(kinds)], ['externalDatabase', 'externalDatabaseRls', 'sequences']);
});

const attempt = (key, kind, plugin, commit, algInvocationId, status = 'done') => ({
  key, kind, plugin, partition: PRIMARY, commit, status, exitCode: status === 'done' ? 0 : 255, algInvocationId,
  log: `trial/logs/${key}.log`, startedAt: START.toISOString(), seconds: 1
});

test('undoPlan undoes every committed invocation newest first, ISF with its Undo, the rest with Community Undo', () => {
  const recorded = [
    attempt(`externalDatabase:${PRIMARY}`, 'externalDatabase', PLUGINS.externalDatabase, true, 7319),
    attempt(`externalDatabaseRls:${PRIMARY}`, 'externalDatabaseRls', PLUGINS.externalDatabaseRls, true, 7320),
    attempt(`sequences:${PRIMARY}`, 'sequences', PLUGINS.sequences, true, null, 'failed'),
    attempt(`sequences:${PRIMARY}`, 'sequences', PLUGINS.sequences, true, 7322),
    attempt(`isfPrint:${PRIMARY}`, 'isfPrint', PLUGINS.isfPrint, false, 7323),
    attempt(`isfSet:${PRIMARY}`, 'isfSet', PLUGINS.isfSet, true, 7324, 'failed'),
    attempt('qa', 'qa', null, false, null),
    attempt(`undo:isfSet:${PRIMARY}`, 'undo', ISF_UNDO, true, 7330)
  ];
  const step = (key, plugin, args) => ({ key, kind: 'undo', partition: PRIMARY, commit: true, plugin, args });
  assert.deepEqual(undoPlan(recorded, { gusHome: GUS_HOME }), [
    step(`undo:isfSet:${PRIMARY}`, ISF_UNDO, ['--mapFile', MAP_IN_IMAGE, '--algInvocationId', '7324', '--commit']),
    step(`undo:sequences:${PRIMARY}`, UNDO, ['--plugin', PLUGINS.sequences, '--algInvocationId', '7322', '--commit']),
    step(`undo:externalDatabaseRls:${PRIMARY}`, UNDO, ['--plugin', PLUGINS.externalDatabaseRls, '--algInvocationId', '7320', '--commit']),
    step(`undo:externalDatabase:${PRIMARY}`, UNDO, ['--plugin', PLUGINS.externalDatabase, '--algInvocationId', '7319', '--commit'])
  ]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test --test-reporter=dot /home/jbrestel/workspaces/src/dataset-curator-trial-isf/tests/genome-trial-steps.test.js /home/jbrestel/workspaces/src/dataset-curator-trial-isf/tests/import-graph.test.js`
Expected: FAIL with `Cannot find module .../trial/steps.js`.

- [ ] **Step 3: Write `steps.js`**

Create `shared/scripts/genome/trial/steps.js`:

```js
import { basename, posix } from 'node:path';
import { MAP_PATH } from '../preprocess-gff3.js';
import { inWork } from './gus.js';

export const PLUGINS = Object.freeze({
  externalDatabase: 'GUS::Supported::Plugin::InsertExternalDatabase',
  externalDatabaseRls: 'GUS::Supported::Plugin::InsertExternalDatabaseRls',
  sequences: 'GUS::Supported::Plugin::LoadFastaSequences',
  isfPrint: 'GUS::Supported::Plugin::InsertSequenceFeatures',
  isfSet: 'GUS::Supported::Plugin::InsertSequenceFeatures'
});
export const ISF_UNDO = 'GUS::Supported::Plugin::InsertSequenceFeaturesUndo';
export const UNDO = 'GUS::Community::Plugin::Undo';
export const ISF_KINDS = new Set(['isfPrint', 'isfSet']);
export const TRANSCRIPT_IDS = 'transcriptIds';
export const TRANSCRIPT_INFO = 'transcriptInfoAndIds';

export const partitionName = (part) => basename(part.dir);
export const trialDatabaseName = (accession, part) => `curatorTrial_${accession}_${partitionName(part)}_RSRC`;
export const releaseVersion = (date) => date.toISOString().slice(0, 19).replace(/[-:]/g, '');
export const isfMapIn = (gusHome) => posix.join(gusHome, 'lib/xml/isf', posix.basename(MAP_PATH));
export const stepKey = (kind, partition) => `${kind}:${partition}`;
export const isfFiles = (kind, partition) => ({
  validationLog: `trial/${partition}/${kind}.validation.log`,
  bioperlTree: `trial/${partition}/${kind}.bioperlTree.out`
});

/** Sequences for every partition, then ISF run 1 and run 2 where ISF loads anything: cheap failures first. */
export function planSteps(build, { taxonId, release, gusHome }) {
  const parts = build.partitions.map((part) => ({ part, name: partitionName(part), database: trialDatabaseName(build.accession, part) }));
  const step = (kind, p, args) => ({
    key: stepKey(kind, p.name), kind, plugin: PLUGINS[kind], partition: p.name, dir: p.part.dir,
    commit: kind !== 'isfPrint', args: kind === 'isfPrint' ? args : [...args, '--commit']
  });
  const file = (p, key) => inWork(p.part.dir, p.part.final[key]);
  const chromosomeMap = (p) => (p.part.final.chromosomeMap ? ['--chromosomeMapFile', file(p, 'chromosomeMap')] : []);
  const sequences = parts.flatMap((p) => [
    step('externalDatabase', p, ['--name', p.database]),
    step('externalDatabaseRls', p, ['--databaseName', p.database, '--databaseVersion', release]),
    step('sequences', p, [
      '--externalDatabaseName', p.database, '--externalDatabaseVersion', release, '--ncbiTaxId', String(taxonId),
      '--sequenceFile', file(p, 'fasta'), ...chromosomeMap(p), '--soTermName', p.part.soTerm,
      '--SOExtDbRlsSpec', 'SO_RSRC|%', '--regexSourceId', '^>(\\S+)', '--tableName', 'DoTS::ExternalNASequence'
    ])
  ]);
  const annotated = parts.filter((p) => p.part.featureCount > 0);
  const isf = (kind, directive, postprocessingDir) => annotated.map((p) => {
    const files = isfFiles(kind, p.name);
    return step(kind, p, [
      '--extDbName', p.database, '--extDbRlsVer', release, '--mapFile', isfMapIn(gusHome),
      '--inputFileOrDir', file(p, 'gff'), '--inputFileExtension', 'gff', ...chromosomeMap(p),
      '--fileFormat', 'gff3', '--soExtDbSpec', 'SO_RSRC|%', '--defaultOrganism', String(taxonId), '--seqSoTerm', p.part.soTerm,
      '--validationLog', inWork(files.validationLog), '--bioperlTreeOutput', inWork(files.bioperlTree),
      '--seqIdColumn', 'source_id', '--naSequenceSubclass', 'ExternalNASequence',
      '--postprocessingDirective', directive, '--postprocessingDir', `${postprocessingDir(p)}/`
    ]);
  });
  return [
    ...sequences,
    ...isf('isfPrint', 'PRINT_TRANSCRIPT_IDS', (p) => inWork('trial', p.name)),
    ...isf('isfSet', 'SET_TRANSCRIPT_IDS', (p) => inWork(p.part.dir))
  ];
}

/** Every committed invocation, failed or not, newest first. isfPrint never commits, so it has nothing to undo. */
export function undoPlan(steps, { gusHome }) {
  return steps
    .filter((s) => s.commit && s.kind !== 'undo' && s.algInvocationId !== null)
    .reverse()
    .map((s) => ({
      key: `undo:${s.key}`, kind: 'undo', partition: s.partition, commit: true,
      plugin: ISF_KINDS.has(s.kind) ? ISF_UNDO : UNDO,
      args: ISF_KINDS.has(s.kind)
        ? ['--mapFile', isfMapIn(gusHome), '--algInvocationId', String(s.algInvocationId), '--commit']
        : ['--plugin', s.plugin, '--algInvocationId', String(s.algInvocationId), '--commit']
    }));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test --test-reporter=dot /home/jbrestel/workspaces/src/dataset-curator-trial-isf/tests/genome-trial-steps.test.js /home/jbrestel/workspaces/src/dataset-curator-trial-isf/tests/import-graph.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git -C /home/jbrestel/workspaces/src/dataset-curator-trial-isf add shared/scripts/genome/trial/steps.js tests/genome-trial-steps.test.js
git -C /home/jbrestel/workspaces/src/dataset-curator-trial-isf commit -m "Trial ISF: step list from genome-build.json and the Undo plan" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 5: `record.js`, the `trial.json` contract

**Files:**
- Create: `shared/scripts/genome/trial/record.js`
- Test: `tests/genome-trial-record.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/genome-trial-record.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { GENERATOR } from '../shared/scripts/genome/record.js';
import {
  committedFailure, isDone, lastAttempt, loadedDigests, newTrialRecord, readTrialRecord, saveTrialRecord, staleProblem, trialPaths,
  TRIAL_SCHEMA_VERSION
} from '../shared/scripts/genome/trial/record.js';
import { PipelineError, sha256 } from '../shared/scripts/genome/workdir.js';
import { tempDir } from './genome-helpers.js';
import {
  IMAGE, ORGANELLE, ORGANELLE_FASTA, PRIMARY, PRIMARY_CHROMOSOME_MAP, PRIMARY_FASTA, PRIMARY_GFF, RELEASE, START, TAXON_ID, trialBuild,
  trialDb, trialWorkDir
} from './genome-trial-helpers.js';

const LOADED = {
  [PRIMARY]: { gff: sha256(PRIMARY_GFF), fasta: sha256(PRIMARY_FASTA), chromosomeMap: sha256(PRIMARY_CHROMOSOME_MAP) },
  [ORGANELLE]: { gff: null, fasta: sha256(ORGANELLE_FASTA), chromosomeMap: null }
};
const fresh = () => newTrialRecord({
  genomeBuildSha256: 'b'.repeat(64), loaded: LOADED, release: RELEASE, taxonId: TAXON_ID, startedAt: START.toISOString(),
  image: { name: IMAGE, digest: 'sha256:1', apiCommonDataCommit: null, modelTag: null, schemaFingerprint: null },
  trialDatabases: { [PRIMARY]: trialDb(PRIMARY), [ORGANELLE]: trialDb(ORGANELLE) }
});
const attempt = (key, fields) => ({ key, kind: key.split(':')[0], plugin: 'p', partition: PRIMARY, commit: true, status: 'done', exitCode: 0, algInvocationId: 1, log: null, startedAt: null, seconds: 1, ...fields });

test('trialPaths puts trial.json, logs and per-partition files under <workDir>/trial', () => {
  const p = trialPaths('/w');
  assert.equal(p.trialDir, '/w/trial');
  assert.equal(p.trialJson, '/w/trial/trial.json');
  assert.equal(p.logOf(`isfSet:${PRIMARY}`), `/w/trial/logs/isfSet:${PRIMARY}.log`);
  assert.equal(p.partitionDir(PRIMARY), `/w/trial/${PRIMARY}`);
});

test('loadedDigests hashes the final/ files each partition loads, null where it has none', () => {
  const { workDir } = trialWorkDir();
  assert.deepEqual(loadedDigests(trialBuild(), workDir), LOADED);
});

test('a new record starts with no steps, findings or profile, neither kept nor undone', () => {
  assert.deepEqual(fresh(), {
    schemaVersion: TRIAL_SCHEMA_VERSION, generator: { ...GENERATOR }, genomeBuild: { sha256: 'b'.repeat(64) }, loaded: LOADED,
    image: { name: IMAGE, digest: 'sha256:1', apiCommonDataCommit: null, modelTag: null, schemaFingerprint: null },
    database: null, release: RELEASE, taxonId: TAXON_ID, trialDatabases: { [PRIMARY]: trialDb(PRIMARY), [ORGANELLE]: trialDb(ORGANELLE) },
    startedAt: START.toISOString(), steps: [], findings: [], profile: {}, kept: false, undone: false
  });
});

test('saveTrialRecord writes atomically and readTrialRecord reads it back; no file reads as null', () => {
  const dir = tempDir('trial-record-');
  const path = join(dir, 'trial', 'trial.json');
  assert.equal(readTrialRecord(path), null);
  const record = fresh();
  saveTrialRecord(path, record);
  assert.deepEqual(readTrialRecord(path), record);
  assert.equal(existsSync(`${path}.part`), false);
});

test('readTrialRecord refuses another schemaVersion', () => {
  const dir = tempDir('trial-record-');
  mkdirSync(join(dir, 'trial'));
  const path = join(dir, 'trial', 'trial.json');
  writeFileSync(path, JSON.stringify({ ...fresh(), schemaVersion: 2 }));
  assert.throws(() => readTrialRecord(path), (e) => e instanceof PipelineError && e.problem === 'has schemaVersion 2, not 1');
});

test('staleProblem: D output or the taxon changed since the trial started', () => {
  const record = fresh();
  const now = { genomeBuildSha256: 'b'.repeat(64), loaded: LOADED, taxonId: TAXON_ID };
  assert.equal(staleProblem(record, now), null);
  assert.equal(staleProblem(record, { ...now, genomeBuildSha256: 'c'.repeat(64) }), 'trial is for an older build');
  assert.equal(staleProblem(record, { ...now, loaded: { ...LOADED, [ORGANELLE]: { ...LOADED[ORGANELLE], fasta: 'x' } } }), 'trial is for an older build');
  assert.equal(staleProblem(record, { ...now, taxonId: 6035 }), `trial ran with --taxonId ${TAXON_ID}`);
});

test('the last attempt of a key decides whether it is done', () => {
  const record = { ...fresh(), steps: [attempt('sequences:p', { status: 'failed', algInvocationId: null }), attempt('sequences:p', {})] };
  assert.equal(isDone(record, 'sequences:p'), true);
  assert.equal(lastAttempt(record, 'isfSet:p'), null);
  assert.equal(isDone(record, 'isfSet:p'), false);
});

test('committedFailure finds a committed step whose last attempt failed after logging an invocation', () => {
  const ok = { ...fresh(), steps: [attempt('isfPrint:p', { commit: false, status: 'failed' }), attempt('sequences:p', { status: 'failed', algInvocationId: null })] };
  assert.equal(committedFailure(ok), null);
  const bad = { ...fresh(), steps: [attempt('isfSet:p', { status: 'failed', algInvocationId: 7326 })] };
  assert.equal(committedFailure(bad).algInvocationId, 7326);
  const undo = { ...fresh(), steps: [attempt('undo:isfSet:p', { kind: 'undo', status: 'failed', algInvocationId: 7330 })] };
  assert.equal(committedFailure(undo), null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test --test-reporter=dot /home/jbrestel/workspaces/src/dataset-curator-trial-isf/tests/genome-trial-record.test.js /home/jbrestel/workspaces/src/dataset-curator-trial-isf/tests/import-graph.test.js`
Expected: FAIL with `Cannot find module .../trial/record.js`.

- [ ] **Step 3: Write `record.js`**

Create `shared/scripts/genome/trial/record.js`:

```js
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { GENERATOR } from '../record.js';
import { PipelineError, readJson, sha256File, writeJsonAtomic } from '../workdir.js';
import { partitionName } from './steps.js';

/** The trial.json contract; bump when its shape changes. */
export const TRIAL_SCHEMA_VERSION = 1;

export function trialPaths(workDir) {
  const trialDir = join(workDir, 'trial');
  return {
    trialDir,
    trialJson: join(trialDir, 'trial.json'),
    logOf: (key) => join(trialDir, 'logs', `${key}.log`),
    partitionDir: (name) => join(trialDir, name)
  };
}

/** final/ has no checksums from D, so the trial records the sha256 of each file it loads. */
export function loadedDigests(build, workDir) {
  return Object.fromEntries(build.partitions.map((part) => {
    const digest = (key) => (part.final[key] ? sha256File(join(workDir, part.dir, part.final[key])) : null);
    return [partitionName(part), { gff: digest('gff'), fasta: digest('fasta'), chromosomeMap: digest('chromosomeMap') }];
  }));
}

export function newTrialRecord({ genomeBuildSha256, loaded, release, taxonId, image, trialDatabases, startedAt }) {
  return {
    schemaVersion: TRIAL_SCHEMA_VERSION, generator: { ...GENERATOR }, genomeBuild: { sha256: genomeBuildSha256 }, loaded,
    image, database: null, release, taxonId, trialDatabases, startedAt,
    steps: [], findings: [], profile: {}, kept: false, undone: false
  };
}

export function readTrialRecord(path) {
  if (!existsSync(path)) return null;
  const record = readJson(path, 'trial', 'delete it if no trial rows are loaded, then run trial again');
  if (record?.schemaVersion !== TRIAL_SCHEMA_VERSION) {
    throw new PipelineError('trial', path, `has schemaVersion ${record?.schemaVersion}, not ${TRIAL_SCHEMA_VERSION}`,
      'undo it with the version of trial that wrote it, then delete it');
  }
  return record;
}

export function staleProblem(record, { genomeBuildSha256, loaded, taxonId }) {
  if (record.genomeBuild.sha256 !== genomeBuildSha256 || JSON.stringify(record.loaded) !== JSON.stringify(loaded)) return 'trial is for an older build';
  if (record.taxonId !== taxonId) return `trial ran with --taxonId ${record.taxonId}`;
  return null;
}

export const lastAttempt = (record, key) => record.steps.filter((s) => s.key === key).at(-1) ?? null;
export const isDone = (record, key) => lastAttempt(record, key)?.status === 'done';

/** A step that ran with --commit and failed after its invocation existed may have left rows; resuming would load them twice. */
export function committedFailure(record) {
  const keys = [...new Set(record.steps.map((s) => s.key))];
  return keys.map((key) => lastAttempt(record, key))
    .find((s) => s.status === 'failed' && s.commit && s.kind !== 'undo' && s.algInvocationId !== null) ?? null;
}

export const saveTrialRecord = (path, record) => writeJsonAtomic(path, record);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test --test-reporter=dot /home/jbrestel/workspaces/src/dataset-curator-trial-isf/tests/genome-trial-record.test.js /home/jbrestel/workspaces/src/dataset-curator-trial-isf/tests/import-graph.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git -C /home/jbrestel/workspaces/src/dataset-curator-trial-isf add shared/scripts/genome/trial/record.js tests/genome-trial-record.test.js
git -C /home/jbrestel/workspaces/src/dataset-curator-trial-isf commit -m "Trial ISF: trial.json contract, resume and stale checks" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 6: `model-image.js`, the per-database GUS::Model image

**Files:**
- Create: `shared/scripts/genome/trial/model-image.js`
- Test: `tests/genome-trial-model-image.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/genome-trial-model-image.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseTsv, SELECT_ROWS_MOUNT, SELECT_ROWS_SCRIPT } from '../shared/scripts/genome/trial/gus.js';
import {
  BUILD_MODEL, ensureModelImage, FINGERPRINT_SQL, modelTag, schemaFingerprint, SELECT_ROWS_LABEL
} from '../shared/scripts/genome/trial/model-image.js';
import { PipelineError, sha256, sha256File } from '../shared/scripts/genome/workdir.js';
import { tempDir } from './genome-helpers.js';
import { DATABASE, fakeDocker, GUS_HOME, IMAGE, INSPECT_BASE, modelInspect, SELECTS, USER } from './genome-trial-helpers.js';

const FINGERPRINT = sha256('1\tAlgorithm\t1\n2\tAlgorithmImplementation\t1\n56\tExternalNASequence\t3');
const TAG = `gus_isf-model:unidb_shu_m-${FINGERPRINT.slice(0, 12)}`;
const CONTAINER = `gus_isf-model-build-${FINGERPRINT.slice(0, 12)}`;
const baseCtx = () => ({ workDir: tempDir('trial-work-'), image: IMAGE, gusHome: GUS_HOME, gusConfig: '/home/me/gus.config', user: USER });
const logOf = (ctx) => join(ctx.workDir, 'trial/logs/modelImage.log');

test('schemaFingerprint hashes table_id, name and database_id in id order', () => {
  assert.equal(schemaFingerprint(parseTsv(SELECTS.schemaFingerprint)), FINGERPRINT);
  assert.equal(FINGERPRINT_SQL, '-- trial:schemaFingerprint\nSELECT table_id, name, database_id FROM core.tableinfo ORDER BY table_id');
});

test('modelTag lower-cases the database name for Docker and keeps 12 characters of the fingerprint', () => {
  assert.equal(modelTag('UniDB_shu_m', FINGERPRINT), TAG);
  assert.equal(modelTag('My DB!', 'abcdef0123456789'), 'gus_isf-model:my_db_-abcdef012345');
});

test('a missing model image is generated in the base image with bld GUS/Model, labelled and committed', () => {
  const docker = fakeDocker();
  const ctx = baseCtx();
  assert.deepEqual(ensureModelImage(ctx, DATABASE, { exec: docker.exec, logPath: logOf(ctx) }), { modelTag: TAG, schemaFingerprint: FINGERPRINT, built: true });
  assert.deepEqual(docker.calls[0].args.slice(-3), [IMAGE, 'perl', SELECT_ROWS_MOUNT]);
  assert.equal(docker.calls[0].input, FINGERPRINT_SQL);
  assert.deepEqual(docker.calls.slice(1).map((c) => c.args), [
    ['image', 'inspect', TAG],
    ['rm', '-f', CONTAINER],
    ['run', '--name', CONTAINER, '--network', 'host', '-v', `/home/me/gus.config:${GUS_HOME}/config/gus.config:ro`,
      '-v', `${SELECT_ROWS_SCRIPT}:${SELECT_ROWS_MOUNT}:ro`, IMAGE, 'bash', '-c', BUILD_MODEL],
    ['commit', '--change', `LABEL ${SELECT_ROWS_LABEL}=${sha256File(SELECT_ROWS_SCRIPT)}`, CONTAINER, TAG],
    ['rm', '-f', CONTAINER]
  ]);
  assert.equal(BUILD_MODEL, 'rm -rf $GUS_HOME/lib/perl/GUS/Model && bld GUS/Model && install -m 755 /opt/curator/selectRows.pl $GUS_HOME/bin/selectRows');
  assert.match(readFileSync(logOf(ctx), 'utf-8'), /BUILD SUCCESSFUL/);
});

test('a model image tagged for this schema and labelled with this selectRows is reused', () => {
  const docker = fakeDocker({ images: { [IMAGE]: INSPECT_BASE, [TAG]: modelInspect({ [SELECT_ROWS_LABEL]: sha256File(SELECT_ROWS_SCRIPT) }) } });
  const ctx = baseCtx();
  assert.equal(ensureModelImage(ctx, DATABASE, { exec: docker.exec, logPath: logOf(ctx) }).built, false);
  assert.deepEqual(docker.calls.map((c) => c.args[0]), ['run', 'image']);
});

test('a model image built with another selectRows is built again', () => {
  const docker = fakeDocker({ images: { [IMAGE]: INSPECT_BASE, [TAG]: modelInspect({ [SELECT_ROWS_LABEL]: 'old' }) } });
  const ctx = baseCtx();
  assert.equal(ensureModelImage(ctx, DATABASE, { exec: docker.exec, logPath: logOf(ctx) }).built, true);
});

test('a failed bld names its log, shows its tail, commits nothing and removes the container', () => {
  const docker = fakeDocker({ buildExit: 2 });
  const ctx = baseCtx();
  assert.throws(() => ensureModelImage(ctx, DATABASE, { exec: docker.exec, logPath: logOf(ctx) }),
    (e) => e instanceof PipelineError && e.file === logOf(ctx) && /^bld GUS\/Model exited 2:\n[\s\S]*BUILD FAILED/.test(e.problem));
  assert.equal(docker.calls.some((c) => c.args[0] === 'commit'), false);
  assert.deepEqual(docker.calls.at(-1).args, ['rm', '-f', CONTAINER]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test --test-reporter=dot /home/jbrestel/workspaces/src/dataset-curator-trial-isf/tests/genome-trial-model-image.test.js /home/jbrestel/workspaces/src/dataset-curator-trial-isf/tests/import-graph.test.js`
Expected: FAIL with `Cannot find module .../trial/model-image.js`.

- [ ] **Step 3: Write `model-image.js`**

Create `shared/scripts/genome/trial/model-image.js`:

```js
import { failureOutput } from '../../lib/tools/exec.js';
import { PipelineError, sha256, sha256File } from '../workdir.js';
import { inspectImage, runLogged, SELECT_ROWS_MOUNT, SELECT_ROWS_SCRIPT, selectRows, tail } from './gus.js';

export const FINGERPRINT_SQL = '-- trial:schemaFingerprint\nSELECT table_id, name, database_id FROM core.tableinfo ORDER BY table_id';
export const SELECT_ROWS_LABEL = 'org.veupathdb.curator.selectRows.sha256';
export const BUILD_MODEL = `rm -rf $GUS_HOME/lib/perl/GUS/Model && bld GUS/Model && install -m 755 ${SELECT_ROWS_MOUNT} $GUS_HOME/bin/selectRows`;

export const schemaFingerprint = (rows) => sha256(rows.map((r) => `${r.table_id}\t${r.name}\t${r.database_id}`).join('\n'));
export const modelTag = (database, fingerprint) =>
  `gus_isf-model:${database.toLowerCase().replace(/[^a-z0-9_.-]/g, '_')}-${fingerprint.slice(0, 12)}`;

function removeContainer(name, exec) {
  try {
    exec('docker', ['rm', '-f', name]);
  } catch { /* nothing to remove */ }
}

/** GUS::Model must match the target schema: reuse the image for this fingerprint, or generate it and commit the container. */
export function ensureModelImage(baseCtx, database, { exec, logPath }) {
  const fingerprint = schemaFingerprint(selectRows(baseCtx, FINGERPRINT_SQL, { exec, mounted: true }));
  const tag = modelTag(database, fingerprint);
  const scriptSha = sha256File(SELECT_ROWS_SCRIPT);
  if (inspectImage(tag, { exec })?.labels[SELECT_ROWS_LABEL] === scriptSha) return { modelTag: tag, schemaFingerprint: fingerprint, built: false };
  const container = `gus_isf-model-build-${fingerprint.slice(0, 12)}`;
  removeContainer(container, exec);
  try {
    const { exitCode, log } = runLogged([
      'run', '--name', container, '--network', 'host',
      '-v', `${baseCtx.gusConfig}:${baseCtx.gusHome}/config/gus.config:ro`, '-v', `${SELECT_ROWS_SCRIPT}:${SELECT_ROWS_MOUNT}:ro`,
      baseCtx.image, 'bash', '-c', BUILD_MODEL
    ], logPath, { exec });
    if (exitCode !== 0) {
      throw new PipelineError('trial', logPath, `bld GUS/Model exited ${exitCode}:\n${tail(log)}`,
        'check that gus.config names the target database, then run trial again');
    }
    try {
      exec('docker', ['commit', '--change', `LABEL ${SELECT_ROWS_LABEL}=${scriptSha}`, container, tag]);
    } catch (e) {
      throw new PipelineError('trial', tag, `docker commit failed: ${failureOutput(e)}`, 'check Docker, then run trial again');
    }
  } finally {
    removeContainer(container, exec);
  }
  return { modelTag: tag, schemaFingerprint: fingerprint, built: true };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test --test-reporter=dot /home/jbrestel/workspaces/src/dataset-curator-trial-isf/tests/genome-trial-model-image.test.js /home/jbrestel/workspaces/src/dataset-curator-trial-isf/tests/import-graph.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git -C /home/jbrestel/workspaces/src/dataset-curator-trial-isf add shared/scripts/genome/trial/model-image.js tests/genome-trial-model-image.test.js
git -C /home/jbrestel/workspaces/src/dataset-curator-trial-isf commit -m "Trial ISF: per-database GUS::Model image, cached by schema fingerprint" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 7: `qa.js`, the QA SELECTs and findings

**Files:**
- Create: `shared/scripts/genome/trial/qa.js`
- Test: `tests/genome-trial-qa.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/genome-trial-qa.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  expectedModels, genesSql, internalStopsSql, leftoversSql, parseTranscriptInfo, qaFindings, releasesSql, sqlList, sqlString, transcriptsSql
} from '../shared/scripts/genome/trial/qa.js';
import { gffLine } from './genome-helpers.js';
import { PRIMARY, PRIMARY_GFF3, RELEASE, TRANSCRIPT_IDS_TEXT, trialDb } from './genome-trial-helpers.js';

const part = (overrides = {}) => ({
  name: PRIMARY, featureCount: 2, releaseId: '501',
  expected: { geneIds: ['TST_0010', 'TST_0030'], codingTranscriptIds: ['TST_0010_mRNA'] },
  transcriptInfo: parseTranscriptInfo(TRANSCRIPT_IDS_TEXT),
  validationLogs: [{ key: `isfPrint:${PRIMARY}`, text: '' }, { key: `isfSet:${PRIMARY}`, text: '' }],
  ...overrides
});
const CLEAN = {
  genes: [{ release_id: '501', source_id: 'TST_0010' }, { release_id: '501', source_id: 'TST_0030' }],
  transcripts: [{ release_id: '501', source_id: 'TST_0010_mRNA', proteins: '1' }, { release_id: '501', source_id: 'rna-TST_0030', proteins: '0' }],
  internalStops: []
};
const summary = (findings) => findings.map((f) => [f.check, f.severity, f.count, f.sample]);

test('expectedModels lists the gene trees ISF builds and their coding transcripts, not other trees', () => {
  const gff = `${PRIMARY_GFF3}${gffLine('CM000001.1', 'repeat_region', 2000, 2100, '+', 'ID=rep1')}\n`;
  assert.deepEqual(expectedModels(gff), { geneIds: ['TST_0010', 'TST_0030'], codingTranscriptIds: ['TST_0010_mRNA'] });
});

test('parseTranscriptInfo keeps columns 1 and 5 of each row', () => {
  assert.deepEqual(parseTranscriptInfo(TRANSCRIPT_IDS_TEXT), [{ gene: 'TST_0010', transcript: 'TST_0010_mRNA' }, { gene: 'TST_0030', transcript: 'rna-TST_0030' }]);
  assert.deepEqual(parseTranscriptInfo(''), []);
});

test('a trial that loaded what the GFF describes has no findings, and rows of other releases do not count', () => {
  assert.deepEqual(qaFindings([part()], CLEAN), []);
  assert.deepEqual(qaFindings([part()], { ...CLEAN, genes: [...CLEAN.genes, { release_id: '502', source_id: 'OTHER' }] }), []);
});

test('a gene the GFF has and dots.genefeature lacks is an error, and so is the row count of transcriptInfoAndIds', () => {
  const findings = qaFindings([part()], { ...CLEAN, genes: [CLEAN.genes[0]] });
  assert.deepEqual(summary(findings), [['geneCount', 'error', 1, ['TST_0030']], ['transcriptInfoRows', 'error', 1, []]]);
  assert.equal(findings[0].group, 'trial');
  assert.equal(findings[0].message, `${PRIMARY}: 1 genes loaded, 2 gene trees expected (featureCount 2); sample: GFF genes not in dots.genefeature`);
  assert.equal(findings[1].message, `${PRIMARY}: transcriptInfoAndIds has 2 rows for 1 genes loaded`);
});

test('a transcript with two proteins, and a coding transcript with none, are errors; a tRNA without one is not', () => {
  const two = qaFindings([part()], { ...CLEAN, transcripts: [{ ...CLEAN.transcripts[0], proteins: '2' }, CLEAN.transcripts[1]] });
  assert.deepEqual(summary(two), [['multipleProteins', 'error', 1, ['TST_0010_mRNA']]]);
  const none = qaFindings([part()], { ...CLEAN, transcripts: [{ ...CLEAN.transcripts[0], proteins: '0' }, CLEAN.transcripts[1]] });
  assert.deepEqual(summary(none), [['codingNoProtein', 'error', 1, ['TST_0010_mRNA']]]);
});

test('transcript IDs that differ between dots.transcript and column 5 of transcriptInfoAndIds are an error', () => {
  const renamed = parseTranscriptInfo(TRANSCRIPT_IDS_TEXT.replace('\tTST_0010_mRNA\n', '\tTST_0010_mRNA_x\n'));
  assert.deepEqual(summary(qaFindings([part({ transcriptInfo: renamed })], CLEAN)), [['transcriptIds', 'error', 2, ['TST_0010_mRNA', 'TST_0010_mRNA_x']]]);
});

test('an internal stop codon and a non-empty validation.log are warnings', () => {
  const findings = qaFindings([part({ validationLogs: [{ key: `isfSet:${PRIMARY}`, text: 'line one\nline two\n' }] })],
    { ...CLEAN, internalStops: [{ release_id: '501', source_id: 'TST_0010_mRNA' }] });
  assert.deepEqual(summary(findings), [['internalStop', 'warning', 1, ['TST_0010_mRNA']], ['validationLog', 'warning', 2, ['line one', 'line two']]]);
  assert.equal(findings[1].message, `${PRIMARY}: isfSet:${PRIMARY} wrote 2 lines to its validation.log`);
});

test('a partition whose release was never found counts every gene as missing', () => {
  assert.deepEqual(summary(qaFindings([part({ releaseId: null })], CLEAN)).map(([check]) => check), ['geneCount', 'transcriptIds', 'transcriptInfoRows']);
});

test('the SELECTs are tagged, quote names and scope to release IDs', () => {
  assert.equal(sqlString("O'Brien"), "'O''Brien'");
  assert.equal(sqlList(['a', 'b']), "'a', 'b'");
  assert.equal(releasesSql([trialDb(PRIMARY)], RELEASE), [
    '-- trial:releases',
    'SELECT d.name, r.external_database_release_id AS release_id',
    'FROM sres.externaldatabase d JOIN sres.externaldatabaserelease r ON r.external_database_id = d.external_database_id',
    `WHERE d.name IN ('${trialDb(PRIMARY)}') AND r.version = '${RELEASE}'`
  ].join('\n'));
  assert.match(genesSql(['501', '502']), /^-- trial:genes\nSELECT .* FROM dots\.genefeature WHERE external_database_release_id IN \(501, 502\)$/);
  assert.match(transcriptsSql(['501']), /^-- trial:transcripts\n[\s\S]*LEFT JOIN dots\.translatedaafeature[\s\S]*IN \(501\)\nGROUP BY/);
  assert.match(internalStopsSql(['501']), /^-- trial:internalStops\n[\s\S]*rtrim\(s\.sequence, '\*'\) LIKE '%\*%'$/);
});

test('leftoversSql counts the trial release, and rows of each invocation when there are any', () => {
  assert.equal(leftoversSql([trialDb(PRIMARY)], RELEASE, []).split('\n').length, 4);
  const sql = leftoversSql([trialDb(PRIMARY)], RELEASE, [7319, 7326]);
  assert.match(sql, /^-- trial:leftovers\nSELECT 'trialRelease' AS what, count\(\*\) AS n\n/);
  assert.match(sql, /\nUNION ALL SELECT 'dots\.nafeatureimp', count\(\*\) FROM dots\.nafeatureimp WHERE row_alg_invocation_id IN \(7319, 7326\)/);
  assert.equal(sql.split('\n').length, 10);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test --test-reporter=dot /home/jbrestel/workspaces/src/dataset-curator-trial-isf/tests/genome-trial-qa.test.js /home/jbrestel/workspaces/src/dataset-curator-trial-isf/tests/import-graph.test.js`
Expected: FAIL with `Cannot find module .../trial/qa.js`.

- [ ] **Step 3: Write `qa.js`**

Create `shared/scripts/genome/trial/qa.js`:

```js
import { finding } from '../checks.js';
import { parseGff } from '../gff.js';
import { isfTrees } from '../isf-map.js';

export const sqlString = (value) => `'${String(value).replace(/'/g, "''")}'`;
export const sqlList = (values) => values.map(sqlString).join(', ');
const idList = (ids) => ids.map(Number).join(', ');
const GENE_TREE = /^pseudogene$|_gene$/;

export const releasesSql = (names, release) => [
  '-- trial:releases',
  'SELECT d.name, r.external_database_release_id AS release_id',
  'FROM sres.externaldatabase d JOIN sres.externaldatabaserelease r ON r.external_database_id = d.external_database_id',
  `WHERE d.name IN (${sqlList(names)}) AND r.version = ${sqlString(release)}`
].join('\n');

export const genesSql = (releaseIds) => [
  '-- trial:genes',
  `SELECT external_database_release_id AS release_id, source_id FROM dots.genefeature WHERE external_database_release_id IN (${idList(releaseIds)})`
].join('\n');

export const transcriptsSql = (releaseIds) => [
  '-- trial:transcripts',
  'SELECT t.external_database_release_id AS release_id, t.source_id, count(a.aa_feature_id) AS proteins',
  'FROM dots.transcript t LEFT JOIN dots.translatedaafeature a ON a.na_feature_id = t.na_feature_id',
  `WHERE t.external_database_release_id IN (${idList(releaseIds)})`,
  'GROUP BY t.external_database_release_id, t.source_id'
].join('\n');

export const internalStopsSql = (releaseIds) => [
  '-- trial:internalStops',
  'SELECT t.external_database_release_id AS release_id, t.source_id',
  'FROM dots.transcript t',
  'JOIN dots.translatedaafeature a ON a.na_feature_id = t.na_feature_id',
  'JOIN dots.translatedaasequence s ON s.aa_sequence_id = a.aa_sequence_id',
  `WHERE t.external_database_release_id IN (${idList(releaseIds)}) AND rtrim(s.sequence, '*') LIKE '%*%'`
].join('\n');

const LEFTOVER_TABLES = ['sres.externaldatabase', 'sres.externaldatabaserelease', 'dots.nasequenceimp', 'dots.nafeatureimp', 'dots.aafeatureimp', 'dots.aasequenceimp'];

export const leftoversSql = (names, release, invocationIds) => [
  '-- trial:leftovers',
  "SELECT 'trialRelease' AS what, count(*) AS n",
  'FROM sres.externaldatabase d JOIN sres.externaldatabaserelease r ON r.external_database_id = d.external_database_id',
  `WHERE d.name IN (${sqlList(names)}) AND r.version = ${sqlString(release)}`,
  ...(invocationIds.length
    ? LEFTOVER_TABLES.map((table) => `UNION ALL SELECT '${table}', count(*) FROM ${table} WHERE row_alg_invocation_id IN (${idList(invocationIds)})`)
    : [])
].join('\n');

/** Gene trees from D's ISF port: what dots.genefeature should hold. featureCount also counts repeat, gap and UTR trees. */
export function expectedModels(gff3Text) {
  const genes = isfTrees(parseGff(gff3Text)).trees.filter((t) => GENE_TREE.test(t.type));
  return {
    geneIds: genes.map((g) => g.id),
    codingTranscriptIds: genes.flatMap((g) => g.children).filter((t) => t.type === 'mRNA' && !t.keys.includes('pseudo')).map((t) => t.id)
  };
}

export const parseTranscriptInfo = (text) => text.split('\n').filter((line) => line.trim() !== '')
  .map((line) => {
    const columns = line.split('\t');
    return { gene: columns[0], transcript: columns[4] ?? null };
  });

function partitionFindings(p, db) {
  const at = (message) => `${p.name}: ${message}`;
  const loaded = new Set(db.genes);
  const missing = p.expected.geneIds.filter((id) => !loaded.has(id));
  const coding = new Set(p.expected.codingTranscriptIds);
  const inDb = new Set(db.transcripts.map((t) => t.source_id));
  const inFile = new Set(p.transcriptInfo.map((r) => r.transcript));
  const validation = p.validationLogs.filter((v) => v.text.trim() !== '');
  return [
    finding('trial', 'geneCount', 'error', missing,
      at(`${db.genes.length} genes loaded, ${p.expected.geneIds.length} gene trees expected (featureCount ${p.featureCount}); sample: GFF genes not in dots.genefeature`),
      null, Math.max(Math.abs(p.expected.geneIds.length - db.genes.length), missing.length)),
    finding('trial', 'multipleProteins', 'error', db.transcripts.filter((t) => Number(t.proteins) > 1).map((t) => t.source_id),
      at('transcripts with more than one protein')),
    finding('trial', 'codingNoProtein', 'error',
      db.transcripts.filter((t) => coding.has(t.source_id) && Number(t.proteins) === 0).map((t) => t.source_id),
      at('coding transcripts with no protein')),
    finding('trial', 'transcriptIds', 'error',
      [...[...inDb].filter((id) => !inFile.has(id)), ...[...inFile].filter((id) => !inDb.has(id))],
      at('transcript source_ids in only one of dots.transcript and column 5 of transcriptInfoAndIds')),
    finding('trial', 'transcriptInfoRows', 'error', [],
      at(`transcriptInfoAndIds has ${p.transcriptInfo.length} rows for ${db.genes.length} genes loaded`), null,
      Math.abs(p.transcriptInfo.length - db.genes.length)),
    finding('trial', 'internalStop', 'warning', db.internalStops, at('proteins with an internal stop codon; a CDS may span an intron')),
    ...validation.map((v) => {
      const lines = v.text.trimEnd().split('\n');
      return finding('trial', 'validationLog', 'warning', lines, at(`${v.key} wrote ${lines.length} lines to its validation.log`));
    })
  ].filter((f) => f.count > 0);
}

/** parts: [{ name, featureCount, releaseId, expected, transcriptInfo, validationLogs }]; rows from the three QA SELECTs. */
export function qaFindings(parts, { genes, transcripts, internalStops }) {
  return parts.flatMap((p) => {
    const mine = (rows) => rows.filter((r) => p.releaseId !== null && r.release_id === p.releaseId);
    return partitionFindings(p, {
      genes: mine(genes).map((r) => r.source_id),
      transcripts: mine(transcripts),
      internalStops: mine(internalStops).map((r) => r.source_id)
    });
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test --test-reporter=dot /home/jbrestel/workspaces/src/dataset-curator-trial-isf/tests/genome-trial-qa.test.js /home/jbrestel/workspaces/src/dataset-curator-trial-isf/tests/import-graph.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git -C /home/jbrestel/workspaces/src/dataset-curator-trial-isf add shared/scripts/genome/trial/qa.js tests/genome-trial-qa.test.js
git -C /home/jbrestel/workspaces/src/dataset-curator-trial-isf commit -m "Trial ISF: QA SELECTs and findings" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 8: `qa.js` profiling, then the mid-plan checkpoint

**Files:**
- Modify: `shared/scripts/genome/trial/qa.js` (append)
- Modify: `tests/genome-trial-qa.test.js` (import line, append tests)

- [ ] **Step 1: Write the failing test**

In `tests/genome-trial-qa.test.js`, replace the import block

```js
import {
  expectedModels, genesSql, internalStopsSql, leftoversSql, parseTranscriptInfo, qaFindings, releasesSql, sqlList, sqlString, transcriptsSql
} from '../shared/scripts/genome/trial/qa.js';
import { gffLine } from './genome-helpers.js';
import { PRIMARY, PRIMARY_GFF3, RELEASE, TRANSCRIPT_IDS_TEXT, trialDb } from './genome-trial-helpers.js';
```

with

```js
import { parseTsv } from '../shared/scripts/genome/trial/gus.js';
import {
  expectedModels, genesSql, internalStopsSql, leftoversSql, parseTranscriptInfo, PROFILE_SOURCE_SQL, profileDiff, profileEntry, profileFindings,
  profileSource, qaFindings, releasesSql, snapshot, sqlList, sqlString, STATEMENTS_SQL, TABLES_SQL, transcriptsSql
} from '../shared/scripts/genome/trial/qa.js';
import { gffLine } from './genome-helpers.js';
import { PRIMARY, PRIMARY_GFF3, RELEASE, statementsAt, tablesAt, TRANSCRIPT_IDS_TEXT, trialDb } from './genome-trial-helpers.js';
```

and append:

```js
test('pg_stat_statements is the profiling source when the extension is installed, else pg_stat_user_tables', () => {
  const asked = [];
  const select = (n) => (sql) => { asked.push(sql); return [{ n }]; };
  assert.equal(profileSource(select('1')), 'pg_stat_statements');
  assert.equal(profileSource(select('0')), 'pg_stat_user_tables');
  assert.deepEqual(asked, [PROFILE_SOURCE_SQL, PROFILE_SOURCE_SQL]);
  assert.match(PROFILE_SOURCE_SQL, /^-- trial:profileSource\n.*pg_extension WHERE extname = 'pg_stat_statements'$/);
});

test('snapshot reads the view for its source', () => {
  const asked = [];
  const select = (sql) => { asked.push(sql); return []; };
  snapshot('pg_stat_statements', select);
  snapshot('pg_stat_user_tables', select);
  assert.deepEqual(asked, [STATEMENTS_SQL, TABLES_SQL]);
  assert.match(STATEMENTS_SQL, /^-- trial:statements\nSELECT queryid, calls, total_exec_time, left\(query, 300\) AS query FROM pg_stat_statements/);
  assert.match(TABLES_SQL, /^-- trial:tables\nSELECT schemaname \|\| '\.' \|\| relname AS name, seq_scan, idx_scan, n_tup_ins FROM pg_stat_user_tables$/);
});

test('profileDiff ranks queries by calls and by total time over the ISF run', () => {
  const diff = profileDiff('pg_stat_statements', parseTsv(statementsAt(1)), parseTsv(statementsAt(2)));
  const ontology = { query: 'select name, ontology_term_id from SRES.ontologyterm where external_database_release_id=$1', calls: 2, totalMs: 2 };
  const insert = { query: 'INSERT INTO DoTS.NAFeatureImp (na_feature_id, subclass_view) VALUES ($1, $2)', calls: 1, totalMs: 30 };
  assert.deepEqual(diff, { source: 'pg_stat_statements', byCalls: [ontology, insert], byTotalTime: [insert, ontology] });
});

test('profileDiff falls back to scans and inserts per table, leaving out tables that did nothing of the kind', () => {
  const diff = profileDiff('pg_stat_user_tables', parseTsv(tablesAt(1)), parseTsv(tablesAt(2)));
  const ontology = { table: 'sres.ontologyterm', seqScans: 3, idxScans: 1, inserts: 0 };
  const features = { table: 'dots.nafeatureimp', seqScans: 1, idxScans: 2, inserts: 4 };
  assert.deepEqual(diff, { source: 'pg_stat_user_tables', byScans: [ontology, features], byInserts: [features] });
});

test('profileEntry adds seconds per gene; profileFindings reports time and the busiest queries as info', () => {
  const entry = profileEntry(profileDiff('pg_stat_statements', parseTsv(statementsAt(1)), parseTsv(statementsAt(2))), { seconds: 1, genes: 2 });
  assert.equal(entry.secondsPerGene, 0.5);
  assert.equal(profileEntry({ source: 'pg_stat_user_tables', byScans: [], byInserts: [] }, { seconds: 3, genes: 0 }).secondsPerGene, null);
  const findings = profileFindings({ [`isfPrint:${PRIMARY}`]: entry });
  assert.deepEqual(findings.map((f) => [f.check, f.severity, f.count]), [['isfTime', 'info', 1], ['isfProfile', 'info', 2]]);
  assert.equal(findings[0].message, `isfPrint:${PRIMARY}: 1 s, 0.5 s per gene`);
  assert.equal(findings[1].sample[0], '30 ms in 1 calls: INSERT INTO DoTS.NAFeatureImp (na_feature_id, subclass_view) VALUES ($1, $2)');
  assert.equal(findings[1].message, `isfPrint:${PRIMARY}: busiest queries by total time (pg_stat_statements)`);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test --test-reporter=dot /home/jbrestel/workspaces/src/dataset-curator-trial-isf/tests/genome-trial-qa.test.js /home/jbrestel/workspaces/src/dataset-curator-trial-isf/tests/import-graph.test.js`
Expected: FAIL with `The requested module '../shared/scripts/genome/trial/qa.js' does not provide an export named 'PROFILE_SOURCE_SQL'`.

- [ ] **Step 3: Append profiling to `qa.js`**

Append to `shared/scripts/genome/trial/qa.js`:

```js
const TOP = 10;
export const PROFILE_SOURCE_SQL = "-- trial:profileSource\nSELECT count(*) AS n FROM pg_extension WHERE extname = 'pg_stat_statements'";
export const STATEMENTS_SQL = '-- trial:statements\nSELECT queryid, calls, total_exec_time, left(query, 300) AS query FROM pg_stat_statements'
  + ' WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())';
export const TABLES_SQL = "-- trial:tables\nSELECT schemaname || '.' || relname AS name, seq_scan, idx_scan, n_tup_ins FROM pg_stat_user_tables";

export const profileSource = (select) =>
  (Number(select(PROFILE_SOURCE_SQL)[0]?.n ?? 0) > 0 ? 'pg_stat_statements' : 'pg_stat_user_tables');
export const snapshot = (source, select) => select(source === 'pg_stat_statements' ? STATEMENTS_SQL : TABLES_SQL);

function totals(rows, keyOf, fields) {
  const out = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    const total = out.get(key) ?? { key, row, ...Object.fromEntries(fields.map((f) => [f, 0])) };
    for (const f of fields) total[f] += Number(row[f] ?? 0);
    out.set(key, total);
  }
  return out;
}

function differences(before, after, keyOf, fields) {
  const was = totals(before, keyOf, fields);
  return [...totals(after, keyOf, fields).values()]
    .map((t) => ({ ...t, ...Object.fromEntries(fields.map((f) => [f, t[f] - (was.get(t.key)?.[f] ?? 0)])) }))
    .filter((t) => fields.some((f) => t[f] > 0));
}

const top = (rows, field, shape) => rows.filter((r) => r[field] > 0).sort((a, b) => b[field] - a[field]).slice(0, TOP).map(shape);

/** The work one ISF run did, from snapshots taken before and after it. */
export function profileDiff(source, before, after) {
  if (source === 'pg_stat_statements') {
    const rows = differences(before, after, (r) => r.queryid ?? r.query, ['calls', 'total_exec_time']);
    const shape = (t) => ({ query: t.row.query, calls: t.calls, totalMs: Math.round(t.total_exec_time) });
    return { source, byCalls: top(rows, 'calls', shape), byTotalTime: top(rows, 'total_exec_time', shape) };
  }
  const rows = differences(before, after, (r) => r.name, ['seq_scan', 'idx_scan', 'n_tup_ins']);
  const shape = (t) => ({ table: t.key, seqScans: t.seq_scan, idxScans: t.idx_scan, inserts: t.n_tup_ins });
  return { source, byScans: top(rows, 'seq_scan', shape), byInserts: top(rows, 'n_tup_ins', shape) };
}

export const profileEntry = (diff, { seconds, genes }) =>
  ({ ...diff, seconds, secondsPerGene: genes > 0 ? Math.round((seconds / genes) * 1000) / 1000 : null });

export function profileFindings(profile) {
  return Object.entries(profile).flatMap(([key, p]) => {
    const statements = p.source === 'pg_stat_statements';
    const busiest = statements
      ? p.byTotalTime.map((q) => `${q.totalMs} ms in ${q.calls} calls: ${q.query}`)
      : p.byScans.map((t) => `${t.table}: ${t.seqScans} sequential scans, ${t.inserts} inserts`);
    return [
      finding('trial', 'isfTime', 'info', [], `${key}: ${p.seconds} s, ${p.secondsPerGene} s per gene`, null, 1),
      finding('trial', 'isfProfile', 'info', busiest, `${key}: busiest ${statements ? 'queries by total time' : 'tables by sequential scans'} (${p.source})`)
    ].filter((f) => f.count > 0);
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test --test-reporter=dot /home/jbrestel/workspaces/src/dataset-curator-trial-isf/tests/genome-trial-qa.test.js /home/jbrestel/workspaces/src/dataset-curator-trial-isf/tests/import-graph.test.js`
Expected: PASS.

- [ ] **Step 5: Mid-plan checkpoint: full suite**

Run: `node --test --test-reporter=dot --test-global-setup=/home/jbrestel/workspaces/src/dataset-curator-trial-isf/tests/globalSetup.js /home/jbrestel/workspaces/src/dataset-curator-trial-isf/tests/*.test.js`
Expected: PASS, with skips only where `perl` or `APICOMMONDATA_DIR` is missing.

- [ ] **Step 6: Commit**

```
git -C /home/jbrestel/workspaces/src/dataset-curator-trial-isf add shared/scripts/genome/trial/qa.js tests/genome-trial-qa.test.js
git -C /home/jbrestel/workspaces/src/dataset-curator-trial-isf commit -m "Trial ISF: profiling from pg_stat_statements or pg_stat_user_tables" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 9: `commands/trial.js` preflight

The import block below is final: Tasks 10–12 use every name in it.

**Files:**
- Create: `shared/scripts/genome/commands/trial.js`
- Test: `tests/genome-trial-preflight.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/genome-trial-preflight.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  checkImageMap, checkTrialOptions, contextOf, currentDatabase, imageInfo, preflightReferenceData, readGenomeBuild
} from '../shared/scripts/genome/commands/trial.js';
import { PipelineError, sha256 } from '../shared/scripts/genome/workdir.js';
import { tempDir } from './genome-helpers.js';
import {
  DATABASE, fakeDocker, GUS_HOME, IMAGE, IMAGE_ID, MAP_IN_IMAGE, ORGANELLE, PRIMARY, RELEASE, RELEASES_LOADED, TAXON_ID, trialBuild, trialDb,
  trialWorkDir, USER
} from './genome-trial-helpers.js';

const names = [trialDb(PRIMARY), trialDb(ORGANELLE)];
const ctxOf = ({ workDir, gusConfig }) => contextOf({ workDir, image: IMAGE, gusConfig, user: USER }, GUS_HOME);
const refuses = (fn, problem) => assert.throws(fn, (e) => e instanceof PipelineError && (problem instanceof RegExp ? problem.test(e.problem) : e.problem === problem));

test('checkTrialOptions needs an image, an existing gus.config and, except for --undo, a taxon ID', () => {
  const { gusConfig } = trialWorkDir();
  refuses(() => checkTrialOptions({ gusConfig, taxonId: TAXON_ID }), 'is required');
  refuses(() => checkTrialOptions({ image: IMAGE, taxonId: TAXON_ID }), 'is required');
  refuses(() => checkTrialOptions({ image: IMAGE, gusConfig: '/nowhere/gus.config', taxonId: TAXON_ID }), 'is missing');
  for (const taxonId of [undefined, Number.NaN, 0, 2.5]) refuses(() => checkTrialOptions({ image: IMAGE, gusConfig, taxonId }), 'must be an NCBI taxon id');
  checkTrialOptions({ image: IMAGE, gusConfig, taxonId: TAXON_ID });
  checkTrialOptions({ image: IMAGE, gusConfig }, { undo: true });
});

test('readGenomeBuild returns the record and its sha256', () => {
  const { workDir } = trialWorkDir();
  const { build, sha256: digest } = readGenomeBuild(workDir);
  assert.deepEqual(build, trialBuild());
  assert.equal(digest, sha256(`${JSON.stringify(trialBuild(), null, 2)}\n`));
});

test('readGenomeBuild refuses a missing, other-version or incomplete genome-build.json', () => {
  assert.throws(() => readGenomeBuild(tempDir('empty-')), /trial: .*genome-build\.json: is missing\nNext: run finalize first/);
  const { workDir: older } = trialWorkDir({ ...trialBuild(), schemaVersion: 2 });
  assert.throws(() => readGenomeBuild(older), /has schemaVersion 2, not 1\nNext: run build and finalize again/);
  const { workDir: bad } = trialWorkDir({ ...trialBuild(), accession: '../x' });
  assert.throws(() => readGenomeBuild(bad), /is incomplete: it needs accession, apiCommonData\.isfMap\.sha256 and partitions/);
});

test('readGenomeBuild refuses a final/ file that is missing or empty, and a build GFF3 that changed', () => {
  const { workDir } = trialWorkDir();
  const fasta = join(workDir, `final/${ORGANELLE}/genome.fasta`);
  writeFileSync(fasta, '');
  assert.throws(() => readGenomeBuild(workDir), (e) => e.file === fasta && e.problem === 'is missing or empty' && e.next === 'run finalize again');
  const { workDir: changed } = trialWorkDir();
  appendFileSync(join(changed, `build/${PRIMARY}/genome.gff3`), '# edited\n');
  assert.throws(() => readGenomeBuild(changed), /genome\.gff3: does not match genome-build\.json/);
});

test('imageInfo refuses an image that is not local or sets no GUS_HOME', () => {
  assert.deepEqual(imageInfo(IMAGE, { exec: fakeDocker().exec }), { id: IMAGE_ID, gusHome: GUS_HOME, labels: {} });
  refuses(() => imageInfo(IMAGE, { exec: fakeDocker({ images: {} }).exec }), 'is not a local Docker image');
  const bare = JSON.stringify([{ Id: IMAGE_ID, Config: { Env: ['PATH=/usr/bin'], Labels: null } }]);
  refuses(() => imageInfo(IMAGE, { exec: fakeDocker({ images: { [IMAGE]: bare } }).exec }), 'sets no GUS_HOME');
});

test('checkImageMap refuses an image whose ISF map differs from the one genome-build.json was built against', () => {
  checkImageMap(IMAGE, GUS_HOME, trialBuild(), { exec: fakeDocker().exec });
  refuses(() => checkImageMap(IMAGE, GUS_HOME, trialBuild(), { exec: fakeDocker({ files: { [MAP_IN_IMAGE]: '<other/>' } }).exec }),
    'differs from the ISF map genome-build.json was built against');
  refuses(() => checkImageMap(IMAGE, GUS_HOME, trialBuild(), { exec: fakeDocker({ files: { [MAP_IN_IMAGE]: null } }).exec }),
    'differs from the ISF map genome-build.json was built against');
});

test('currentDatabase asks the database its name and refuses one other than expected', () => {
  const ctx = ctxOf(trialWorkDir());
  assert.equal(currentDatabase(ctx, null, { exec: fakeDocker().exec }), DATABASE);
  assert.equal(currentDatabase(ctx, DATABASE, { exec: fakeDocker().exec }), DATABASE);
  refuses(() => currentDatabase(ctx, DATABASE, { exec: fakeDocker({ selects: { database: 'name\nother_db\n' } }).exec }),
    'names database other_db, but the trial loaded into UniDB_shu_m');
});

test('preflightReferenceData passes with SO_RSRC, the taxon and its genetic code, and no rows for a fresh release', () => {
  const docker = fakeDocker();
  preflightReferenceData(ctxOf(trialWorkDir()), { database: DATABASE, taxonId: TAXON_ID, names, release: RELEASE, fresh: true }, { exec: docker.exec });
  assert.deepEqual(docker.queries(), ['soRelease', 'taxon', 'releases']);
  assert.match(docker.calls[1].input, /WHERE t\.ncbi_tax_id = 284813$/);
});

test('preflightReferenceData refuses missing reference data', () => {
  const ctx = ctxOf(trialWorkDir());
  const run = (selects) => () => preflightReferenceData(ctx, { database: DATABASE, taxonId: TAXON_ID, names, release: RELEASE, fresh: true }, { exec: fakeDocker({ selects }).exec });
  refuses(run({ soRelease: 'n\n0\n' }), 'has no SO_RSRC release');
  refuses(run({ taxon: 'taxon_id\tgenetic_code_id\tcodes\n' }), 'has no sres.taxon row for NCBI taxon 284813');
  refuses(run({ taxon: 'taxon_id\tgenetic_code_id\tcodes\n91245\t\\N\t0\n' }), 'has no genetic code for NCBI taxon 284813');
  refuses(run({ releases: RELEASES_LOADED }), new RegExp(`^already has release ${RELEASE} of ${trialDb(PRIMARY)}`));
});

test('a resumed trial does not refuse its own release', () => {
  const docker = fakeDocker({ selects: { releases: RELEASES_LOADED } });
  preflightReferenceData(ctxOf(trialWorkDir()), { database: DATABASE, taxonId: TAXON_ID, names, release: RELEASE, fresh: false }, { exec: docker.exec });
  assert.deepEqual(docker.queries(), ['soRelease', 'taxon']);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test --test-reporter=dot /home/jbrestel/workspaces/src/dataset-curator-trial-isf/tests/genome-trial-preflight.test.js /home/jbrestel/workspaces/src/dataset-curator-trial-isf/tests/import-graph.test.js`
Expected: FAIL with `Cannot find module .../commands/trial.js`.

- [ ] **Step 3: Write the preflight**

Create `shared/scripts/genome/commands/trial.js`:

```js
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { defaultExec } from '../../lib/tools/exec.js';
import { BUILD_FILES, SCHEMA_VERSION } from '../record.js';
import { hostUser, inspectImage, readImageFile, runGa, selectRows, tail } from '../trial/gus.js';
import { ensureModelImage } from '../trial/model-image.js';
import {
  expectedModels, genesSql, internalStopsSql, leftoversSql, parseTranscriptInfo, profileDiff, profileEntry, profileFindings, profileSource,
  qaFindings, releasesSql, snapshot, transcriptsSql
} from '../trial/qa.js';
import {
  committedFailure, isDone, loadedDigests, newTrialRecord, readTrialRecord, saveTrialRecord, staleProblem, trialPaths
} from '../trial/record.js';
import {
  ISF_KINDS, isfFiles, isfMapIn, partitionName, planSteps, releaseVersion, stepKey, TRANSCRIPT_IDS, TRANSCRIPT_INFO, trialDatabaseName, undoPlan
} from '../trial/steps.js';
import { PipelineError, readJson, readText, sha256, sha256File, workPaths } from '../workdir.js';

export const DATABASE_SQL = '-- trial:database\nSELECT current_database() AS name';
export const SO_SQL = '-- trial:soRelease\nSELECT count(*) AS n FROM sres.externaldatabase d'
  + " JOIN sres.externaldatabaserelease r ON r.external_database_id = d.external_database_id WHERE d.name = 'SO_RSRC'";
export const taxonSql = (taxonId) => '-- trial:taxon\nSELECT t.taxon_id, t.genetic_code_id,'
  + ' (SELECT count(*) FROM sres.geneticcode g WHERE g.genetic_code_id = t.genetic_code_id) AS codes'
  + ` FROM sres.taxon t WHERE t.ncbi_tax_id = ${Number(taxonId)}`;
const REFINALIZE = 'run build and finalize again';
const GUS_CONFIG_NEXT = 'pass --gusConfig <the gus.config naming the target database>';

export function checkTrialOptions({ image, gusConfig, taxonId }, { undo = false } = {}) {
  if (!image) throw new PipelineError('trial', '--image', 'is required', 'pass --image <a gus_isf image>');
  if (!gusConfig) throw new PipelineError('trial', '--gusConfig', 'is required', GUS_CONFIG_NEXT);
  if (!existsSync(gusConfig)) throw new PipelineError('trial', gusConfig, 'is missing', GUS_CONFIG_NEXT);
  if (!undo && !(Number.isInteger(taxonId) && taxonId > 0)) {
    throw new PipelineError('trial', '--taxonId', 'must be an NCBI taxon id', 'pass --taxonId <ncbi taxon id>');
  }
}

/** genome-build.json as finalize wrote it, every final/ file it lists, and the build GFF3 QA reads gene trees from. */
export function readGenomeBuild(workDir) {
  const p = workPaths(workDir);
  const build = readJson(p.genomeBuildJson, 'trial', 'run finalize first');
  if (build?.schemaVersion !== SCHEMA_VERSION) {
    throw new PipelineError('trial', p.genomeBuildJson, `has schemaVersion ${build?.schemaVersion}, not ${SCHEMA_VERSION}`, REFINALIZE);
  }
  const complete = /^[\w.]+$/.test(build.accession ?? '') && typeof build.apiCommonData?.isfMap?.sha256 === 'string'
    && Array.isArray(build.partitions) && build.partitions.length > 0
    && build.partitions.every((part) => typeof part?.dir === 'string' && part.final && typeof part.soTerm === 'string' && Number.isInteger(part.featureCount));
  if (!complete) throw new PipelineError('trial', p.genomeBuildJson, 'is incomplete: it needs accession, apiCommonData.isfMap.sha256 and partitions', REFINALIZE);
  for (const part of build.partitions) {
    for (const name of Object.values(part.final).filter(Boolean)) {
      const file = join(workDir, part.dir, name);
      if (!existsSync(file) || statSync(file).size === 0) throw new PipelineError('trial', file, 'is missing or empty', 'run finalize again');
    }
    const gff3 = join(p.buildDir, partitionName(part), BUILD_FILES.gff3);
    if (part.featureCount > 0 && (!existsSync(gff3) || sha256File(gff3) !== part.buildFiles?.gff3)) {
      throw new PipelineError('trial', gff3, 'does not match genome-build.json', REFINALIZE);
    }
  }
  return { build, sha256: sha256File(p.genomeBuildJson) };
}

export function imageInfo(image, { exec }) {
  const info = inspectImage(image, { exec });
  if (!info) throw new PipelineError('trial', image, 'is not a local Docker image', 'build gus_isf (docker-tools gus_isf/Dockerfile) and tag it, or pass another --image');
  if (!info.gusHome) throw new PipelineError('trial', image, 'sets no GUS_HOME', 'pass a gus_isf image');
  return info;
}

export function checkImageMap(image, gusHome, build, { exec }) {
  const text = readImageFile(image, isfMapIn(gusHome), { exec });
  if (text === null || sha256(text) !== build.apiCommonData.isfMap.sha256) {
    throw new PipelineError('trial', `${image}:${isfMapIn(gusHome)}`, 'differs from the ISF map genome-build.json was built against',
      'use a gus_isf image built at the ApiCommonData commit finalize used, or run build and finalize with this one');
  }
}

export const contextOf = ({ workDir, image, gusConfig, user }, gusHome) =>
  ({ workDir: resolve(workDir), image, gusHome, gusConfig: resolve(gusConfig), user });

export function currentDatabase(ctx, expected, { exec }) {
  const database = selectRows(ctx, DATABASE_SQL, { exec, mounted: true })[0]?.name ?? null;
  if (expected && database !== expected) {
    throw new PipelineError('trial', ctx.gusConfig, `names database ${database}, but the trial loaded into ${expected}`, `pass the gus.config for ${expected}`);
  }
  return database;
}

/** The global rows the trial reads (SO, taxon, genetic code), and no rows yet for a fresh trial's release. */
export function preflightReferenceData(ctx, { database, taxonId, names, release, fresh }, { exec }) {
  const select = (sql) => selectRows(ctx, sql, { exec, mounted: true });
  if (Number(select(SO_SQL)[0]?.n ?? 0) === 0) {
    throw new PipelineError('trial', database, 'has no SO_RSRC release', 'load the Sequence Ontology (InsertSequenceOntologyOBO), or use a seeded database');
  }
  const [taxon] = select(taxonSql(taxonId));
  if (!taxon) throw new PipelineError('trial', database, `has no sres.taxon row for NCBI taxon ${taxonId}`, 'check --taxonId, or load the taxon (LoadTaxon or a taxonomy patch)');
  if (taxon.genetic_code_id === null || Number(taxon.codes) === 0) {
    throw new PipelineError('trial', database, `has no genetic code for NCBI taxon ${taxonId}`, 'load NCBI genetic codes with the taxonomy');
  }
  if (!fresh) return;
  const existing = select(releasesSql(names, release));
  if (existing.length) {
    throw new PipelineError('trial', database, `already has release ${release} of ${existing.map((r) => r.name).join(', ')}`,
      'run trial --undo, or run trial again in a second');
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test --test-reporter=dot /home/jbrestel/workspaces/src/dataset-curator-trial-isf/tests/genome-trial-preflight.test.js /home/jbrestel/workspaces/src/dataset-curator-trial-isf/tests/import-graph.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git -C /home/jbrestel/workspaces/src/dataset-curator-trial-isf add shared/scripts/genome/commands/trial.js tests/genome-trial-preflight.test.js
git -C /home/jbrestel/workspaces/src/dataset-curator-trial-isf commit -m "Trial ISF: preflight of options, genome-build.json, image and reference data" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 10: `runTrial`: model image, sequences, both ISF runs, resume

**Files:**
- Modify: `shared/scripts/genome/commands/trial.js` (append)
- Test: `tests/genome-trial.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/genome-trial.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { runTrial } from '../shared/scripts/genome/commands/trial.js';
import { parseTsv } from '../shared/scripts/genome/trial/gus.js';
import { modelTag, schemaFingerprint } from '../shared/scripts/genome/trial/model-image.js';
import { PipelineError, sha256File } from '../shared/scripts/genome/workdir.js';
import {
  ACD_COMMIT, DATABASE, fakeClock, fakeDocker, IMAGE, IMAGE_ID, ORGANELLE, PLUGIN, PRIMARY, RELEASE, SELECTS, START, TAXON_ID,
  TRANSCRIPT_IDS_TEXT, trialDb, trialWorkDir, USER
} from './genome-trial-helpers.js';

const trial = (ctx, docker, options = {}) =>
  runTrial({ ...ctx, image: IMAGE, taxonId: TAXON_ID, keep: true, exec: docker.exec, now: fakeClock(), user: USER, ...options });
const readRecord = (workDir) => JSON.parse(readFileSync(join(workDir, 'trial/trial.json'), 'utf-8'));
const FORWARD = [
  `externalDatabase:${PRIMARY}`, `externalDatabaseRls:${PRIMARY}`, `sequences:${PRIMARY}`,
  `externalDatabase:${ORGANELLE}`, `externalDatabaseRls:${ORGANELLE}`, `sequences:${ORGANELLE}`,
  `isfPrint:${PRIMARY}`, `isfSet:${PRIMARY}`
];
const FINGERPRINT = schemaFingerprint(parseTsv(SELECTS.schemaFingerprint));
const RESUME_OR_UNDO = 'fix the cause, then run trial again to resume, or trial --undo to remove what it loaded';
const UNDO_FIRST = 'run trial --undo, then trial again';
const isPrint = (call) => call.directive === 'PRINT_TRANSCRIPT_IDS';

test('trial loads sequences for every partition, runs both ISF passes where there are features, and records each step', async () => {
  const ctx = trialWorkDir();
  const docker = fakeDocker();
  const record = await trial(ctx, docker);
  assert.deepEqual(docker.gaCalls().map((c) => c.plugin), [
    PLUGIN.externalDatabase, PLUGIN.externalDatabaseRls, PLUGIN.sequences, PLUGIN.externalDatabase, PLUGIN.externalDatabaseRls, PLUGIN.sequences,
    PLUGIN.isf, PLUGIN.isf
  ]);
  const forward = record.steps.slice(0, FORWARD.length);
  assert.deepEqual(forward.map((s) => s.key), FORWARD);
  assert.deepEqual(forward.map((s) => s.algInvocationId), [7319, 7320, 7321, 7322, 7323, 7324, 7325, 7326]);
  assert.deepEqual(forward[0], {
    key: `externalDatabase:${PRIMARY}`, kind: 'externalDatabase', plugin: PLUGIN.externalDatabase, partition: PRIMARY, commit: true,
    status: 'done', exitCode: 0, algInvocationId: 7319, log: `trial/logs/externalDatabase:${PRIMARY}.log`,
    startedAt: '2026-11-05T10:23:46.000Z', seconds: 1
  });
  assert.equal(forward[6].commit, false);
  assert.match(readFileSync(join(ctx.workDir, forward[2].log), 'utf-8'), /\tAlgInvocationId\t7321\n/);
  assert.equal(readFileSync(join(ctx.workDir, `final/${PRIMARY}/transcriptInfoAndIds`), 'utf-8'), TRANSCRIPT_IDS_TEXT);
  assert.deepEqual(record.image, {
    name: IMAGE, digest: IMAGE_ID, apiCommonDataCommit: ACD_COMMIT, modelTag: modelTag(DATABASE, FINGERPRINT), schemaFingerprint: FINGERPRINT
  });
  assert.equal(record.database, DATABASE);
  assert.equal(record.release, RELEASE);
  assert.equal(record.startedAt, START.toISOString());
  assert.equal(record.taxonId, TAXON_ID);
  assert.deepEqual(record.trialDatabases, { [PRIMARY]: trialDb(PRIMARY), [ORGANELLE]: trialDb(ORGANELLE) });
  assert.equal(record.genomeBuild.sha256, sha256File(join(ctx.workDir, 'genome-build.json')));
  assert.equal(record.kept, true);
  assert.equal(record.undone, false);
  assert.deepEqual(Object.keys(record.profile), [`isfPrint:${PRIMARY}`, `isfSet:${PRIMARY}`]);
  assert.equal(record.profile[`isfPrint:${PRIMARY}`].source, 'pg_stat_statements');
  assert.equal(record.profile[`isfPrint:${PRIMARY}`].secondsPerGene, 0.5);
  assert.deepEqual(readRecord(ctx.workDir), record);
});

test('a failed PRINT run leaves its partial transcriptIds uncopied; the rerun resumes at that step', async () => {
  const ctx = trialWorkDir();
  const docker = fakeDocker({
    ga: (call, state) => {
      if (!isPrint(call) || state.printFailed) return undefined;
      state.printFailed = true;
      return { exitCode: 255, writes: { [`/work/trial/${PRIMARY}/transcriptIds`]: 'TST_0010\tATG\t1\t100,400\tTST_0010_mRNA\n' } };
    }
  });
  await assert.rejects(trial(ctx, docker), (e) => e instanceof PipelineError
    && e.file === join(ctx.workDir, `trial/logs/isfPrint:${PRIMARY}.log`)
    && /^isfPrint:primary_chromosome \(GUS::Supported::Plugin::InsertSequenceFeatures\) exited 255; last lines of its log:\n[\s\S]*ERROR:\ndied/.test(e.problem)
    && e.next === RESUME_OR_UNDO);
  assert.equal(existsSync(join(ctx.workDir, `final/${PRIMARY}/transcriptInfoAndIds`)), false);
  assert.deepEqual(readRecord(ctx.workDir).steps.at(-1).status, 'failed');
  assert.equal(docker.gaCalls().length, 7);
  const record = await trial(ctx, docker);
  assert.equal(docker.gaCalls().length, 9);
  assert.equal(readFileSync(join(ctx.workDir, `final/${PRIMARY}/transcriptInfoAndIds`), 'utf-8'), TRANSCRIPT_IDS_TEXT);
  assert.equal(record.steps.filter((s) => s.key === `isfPrint:${PRIMARY}`).length, 2);
});

test('a ga that exits 0 without logging an AlgInvocationId fails its step', async () => {
  const ctx = trialWorkDir();
  const docker = fakeDocker({ ga: (call) => (call.plugin === PLUGIN.externalDatabase ? { id: null } : undefined) });
  await assert.rejects(trial(ctx, docker), (e) => /^externalDatabase:primary_chromosome \(GUS::Supported::Plugin::InsertExternalDatabase\) logged no AlgInvocationId/.test(e.problem)
    && e.next === RESUME_OR_UNDO);
  assert.deepEqual(readRecord(ctx.workDir).steps.map((s) => [s.status, s.exitCode, s.algInvocationId]), [['failed', 0, null]]);
});

test('a committed step that failed after its invocation existed is not resumed; the next step is trial --undo', async () => {
  const ctx = trialWorkDir();
  const docker = fakeDocker({ ga: (call) => (call.plugin === PLUGIN.sequences && call.args.includes(trialDb(PRIMARY)) ? { exitCode: 255 } : undefined) });
  await assert.rejects(trial(ctx, docker), (e) => e.next === UNDO_FIRST);
  await assert.rejects(trial(ctx, docker), (e) => e.problem === `sequences:${PRIMARY} failed after loading rows (AlgInvocationId 7321)` && e.next === UNDO_FIRST);
  assert.equal(docker.gaCalls().length, 3);
});

test('a missing transcriptInfoAndIds before ISF run 2 has run reruns ISF run 1', async () => {
  const ctx = trialWorkDir();
  const docker = fakeDocker({
    ga: (call, state) => {
      if (call.directive !== 'SET_TRANSCRIPT_IDS' || state.setFailed) return undefined;
      state.setFailed = true;
      return { exitCode: 255, id: null };
    }
  });
  await assert.rejects(trial(ctx, docker), /isfSet:primary_chromosome .* exited 255/);
  rmSync(join(ctx.workDir, `final/${PRIMARY}/transcriptInfoAndIds`));
  await trial(ctx, docker);
  assert.deepEqual(docker.gaCalls().slice(8).map((c) => c.args[c.args.indexOf('--postprocessingDirective') + 1]), ['PRINT_TRANSCRIPT_IDS', 'SET_TRANSCRIPT_IDS']);
});

test('trial refuses to resume once D output or the taxon changed', async () => {
  const ctx = trialWorkDir();
  const docker = fakeDocker();
  await trial(ctx, docker);
  await assert.rejects(trial(ctx, docker, { taxonId: 6035 }), (e) => e.problem === `trial ran with --taxonId ${TAXON_ID}` && e.next === UNDO_FIRST);
  appendFileSync(join(ctx.workDir, `final/${ORGANELLE}/genome.fasta`), 'ACGT\n');
  await assert.rejects(trial(ctx, docker), (e) => e.file === join(ctx.workDir, 'trial/trial.json') && e.problem === 'trial is for an older build' && e.next === UNDO_FIRST);
});

test('a refused preflight writes nothing and runs no ga', async () => {
  const ctx = trialWorkDir();
  const docker = fakeDocker({ selects: { taxon: 'taxon_id\tgenetic_code_id\tcodes\n' } });
  await assert.rejects(trial(ctx, docker), /has no sres\.taxon row for NCBI taxon 284813/);
  assert.equal(existsSync(join(ctx.workDir, 'trial')), false);
  assert.deepEqual(docker.gaCalls(), []);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test --test-reporter=dot /home/jbrestel/workspaces/src/dataset-curator-trial-isf/tests/genome-trial.test.js /home/jbrestel/workspaces/src/dataset-curator-trial-isf/tests/import-graph.test.js`
Expected: FAIL with `does not provide an export named 'runTrial'`.

- [ ] **Step 3: Append the runner**

Append to `shared/scripts/genome/commands/trial.js`:

```js
const RESUME_OR_UNDO = 'fix the cause, then run trial again to resume, or trial --undo to remove what it loaded';
const UNDO_FIRST = 'run trial --undo, then trial again';

function useModelImage(record, ctx, env) {
  const model = ensureModelImage(ctx, record.database, { exec: env.exec, logPath: env.paths.logOf('modelImage') });
  record.image = { ...record.image, modelTag: model.modelTag, schemaFingerprint: model.schemaFingerprint };
  env.save();
  return { ...ctx, image: model.modelTag };
}

/** One ga run, recorded as an attempt. Only the exit status and a logged AlgInvocationId count as success. */
function runStep(record, step, ctx, env, next) {
  const logPath = env.paths.logOf(step.key);
  const started = env.now();
  const { exitCode, algInvocationId, log } = runGa(ctx, step, logPath, { exec: env.exec });
  const ok = exitCode === 0 && algInvocationId !== null;
  record.steps.push({
    key: step.key, kind: step.kind, plugin: step.plugin, partition: step.partition, commit: step.commit,
    status: ok ? 'done' : 'failed', exitCode, algInvocationId, log: relative(env.workDir, logPath),
    startedAt: started.toISOString(), seconds: (env.now() - started) / 1000
  });
  env.save();
  if (ok) return record.steps.at(-1);
  const why = exitCode === 0 ? 'logged no AlgInvocationId' : `exited ${exitCode}`;
  const loadedRows = step.commit && step.kind !== 'undo' && algInvocationId !== null;
  throw new PipelineError('trial', logPath, `${step.key} (${step.plugin}) ${why}; last lines of its log:\n${tail(log)}`, loadedRows ? UNDO_FIRST : next);
}

function copyTranscriptIds(from, to) {
  if (!existsSync(from) || statSync(from).size === 0) {
    throw new PipelineError('trial', from, 'is missing or empty after a successful PRINT_TRANSCRIPT_IDS run', RESUME_OR_UNDO);
  }
  copyFileSync(from, to);
}

function runForward(record, build, ctx, env) {
  const select = (sql) => selectRows(ctx, sql, { exec: env.exec });
  let source = null;
  for (const step of planSteps(build, { taxonId: record.taxonId, release: record.release, gusHome: ctx.gusHome })) {
    const printed = join(env.workDir, step.dir, TRANSCRIPT_INFO);
    const reprint = step.kind === 'isfPrint' && !existsSync(printed) && !isDone(record, stepKey('isfSet', step.partition));
    if (isDone(record, step.key) && !reprint) continue;
    const isf = ISF_KINDS.has(step.kind);
    const transcriptIds = join(env.paths.partitionDir(step.partition), TRANSCRIPT_IDS);
    if (isf) mkdirSync(env.paths.partitionDir(step.partition), { recursive: true });
    if (step.kind === 'isfPrint') rmSync(transcriptIds, { force: true });
    if (isf && !source) source = profileSource(select);
    const before = isf ? snapshot(source, select) : null;
    const attempt = runStep(record, step, ctx, env, RESUME_OR_UNDO);
    if (step.kind === 'isfPrint') copyTranscriptIds(transcriptIds, printed);
    if (isf) {
      const genes = build.partitions.find((part) => partitionName(part) === step.partition).featureCount;
      record.profile[step.key] = profileEntry(profileDiff(source, before, snapshot(source, select)), { seconds: attempt.seconds, genes });
      env.save();
    }
  }
}

export async function runTrial({ workDir, image, gusConfig, taxonId, keep = false, exec = defaultExec, now = () => new Date(), user = hostUser() }) {
  checkTrialOptions({ image, gusConfig, taxonId });
  const paths = trialPaths(workDir);
  const { build, sha256: genomeBuildSha256 } = readGenomeBuild(workDir);
  const loaded = loadedDigests(build, workDir);
  const previous = readTrialRecord(paths.trialJson);
  const resuming = previous !== null && !previous.undone;
  if (resuming) {
    const problem = staleProblem(previous, { genomeBuildSha256, loaded, taxonId });
    if (problem) throw new PipelineError('trial', paths.trialJson, problem, UNDO_FIRST);
    const failed = committedFailure(previous);
    if (failed) throw new PipelineError('trial', join(workDir, failed.log), `${failed.key} failed after loading rows (AlgInvocationId ${failed.algInvocationId})`, UNDO_FIRST);
  }
  const info = imageInfo(image, { exec });
  checkImageMap(image, info.gusHome, build, { exec });
  const ctx = contextOf({ workDir, image, gusConfig, user }, info.gusHome);
  const startedAt = now();
  const record = resuming ? previous : newTrialRecord({
    genomeBuildSha256, loaded, taxonId, release: releaseVersion(startedAt), startedAt: startedAt.toISOString(),
    trialDatabases: Object.fromEntries(build.partitions.map((part) => [partitionName(part), trialDatabaseName(build.accession, part)])),
    image: {
      name: image, digest: info.id, apiCommonDataCommit: readImageFile(image, `${info.gusHome}/APICOMMONDATA_COMMIT`, { exec })?.trim() ?? null,
      modelTag: null, schemaFingerprint: null
    }
  });
  record.database = currentDatabase(ctx, resuming ? record.database : null, { exec });
  preflightReferenceData(ctx, {
    database: record.database, taxonId, names: Object.values(record.trialDatabases), release: record.release, fresh: !resuming
  }, { exec });
  const env = { exec, now, workDir, paths, save: () => saveTrialRecord(paths.trialJson, record) };
  const modelCtx = useModelImage(record, ctx, env);
  runForward(record, build, modelCtx, env);
  record.kept = keep;
  env.save();
  return record;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test --test-reporter=dot /home/jbrestel/workspaces/src/dataset-curator-trial-isf/tests/genome-trial.test.js /home/jbrestel/workspaces/src/dataset-curator-trial-isf/tests/import-graph.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git -C /home/jbrestel/workspaces/src/dataset-curator-trial-isf add shared/scripts/genome/commands/trial.js tests/genome-trial.test.js
git -C /home/jbrestel/workspaces/src/dataset-curator-trial-isf commit -m "Trial ISF: run sequences and both ISF passes, resume, refuse stale builds" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 11: QA in `runTrial`

**Files:**
- Modify: `shared/scripts/genome/commands/trial.js` (tail of `runTrial`, append `runQa`)
- Modify: `tests/genome-trial.test.js` (append)

- [ ] **Step 1: Write the failing test**

Append to `tests/genome-trial.test.js`:

```js
test('QA runs scoped to the trial release and records only info findings for a clean load', async () => {
  const ctx = trialWorkDir();
  const docker = fakeDocker();
  const record = await trial(ctx, docker);
  assert.equal(record.steps.at(-1).key, 'qa');
  assert.equal(record.steps.at(-1).status, 'done');
  assert.deepEqual(record.findings.map((f) => [f.check, f.severity]), [['isfTime', 'info'], ['isfProfile', 'info'], ['isfTime', 'info'], ['isfProfile', 'info']]);
  assert.equal(record.findings[0].message, `isfPrint:${PRIMARY}: 1 s, 0.5 s per gene`);
  const genes = docker.calls.find((c) => c.input?.startsWith('-- trial:genes')).input;
  assert.match(genes, /IN \(501\)$/);
  assert.match(docker.calls.filter((c) => c.input?.startsWith('-- trial:releases')).at(-1).input, new RegExp(`IN \\('${trialDb(PRIMARY)}'\\)`));
  assert.deepEqual(readRecord(ctx.workDir), record);
});

test('a gene missing from the database is an error finding, and a validation.log line a warning', async () => {
  const ctx = trialWorkDir();
  const docker = fakeDocker({
    selects: { genes: 'release_id\tsource_id\n501\tTST_0010\n' },
    ga: (call) => (call.directive === 'SET_TRANSCRIPT_IDS'
      ? { writes: { [`/work/trial/${PRIMARY}/isfSet.validation.log`]: 'Feature tRNA rna-TST_0030 has no product\n' } } : undefined)
  });
  const record = await trial(ctx, docker);
  const problems = record.findings.filter((f) => f.severity !== 'info').map((f) => [f.check, f.severity, f.sample]);
  assert.deepEqual(problems, [
    ['geneCount', 'error', ['TST_0030']], ['transcriptInfoRows', 'error', []], ['validationLog', 'warning', ['Feature tRNA rna-TST_0030 has no product']]
  ]);
});

test('a resumed trial whose QA is done does not run it again', async () => {
  const ctx = trialWorkDir();
  const docker = fakeDocker();
  await trial(ctx, docker);
  const asked = docker.queries().filter((q) => q === 'genes').length;
  await trial(ctx, docker);
  assert.equal(docker.queries().filter((q) => q === 'genes').length, asked);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test --test-reporter=dot /home/jbrestel/workspaces/src/dataset-curator-trial-isf/tests/genome-trial.test.js /home/jbrestel/workspaces/src/dataset-curator-trial-isf/tests/import-graph.test.js`
Expected: FAIL; the last step is `isfSet:primary_chromosome`, not `qa`.

- [ ] **Step 3: Add `runQa` and call it**

In `shared/scripts/genome/commands/trial.js`, replace

```js
  const modelCtx = useModelImage(record, ctx, env);
  runForward(record, build, modelCtx, env);
  record.kept = keep;
  env.save();
  return record;
}
```

with

```js
  const modelCtx = useModelImage(record, ctx, env);
  runForward(record, build, modelCtx, env);
  runQa(record, build, modelCtx, env);
  record.kept = keep;
  env.save();
  return record;
}
```

and append:

```js
function runQa(record, build, ctx, env) {
  if (isDone(record, 'qa')) return;
  const started = env.now();
  const select = (sql) => selectRows(ctx, sql, { exec: env.exec });
  const readIfThere = (rel) => {
    const file = join(env.workDir, rel);
    return existsSync(file) ? readFileSync(file, 'utf-8') : '';
  };
  const annotated = build.partitions.filter((part) => part.featureCount > 0);
  const names = annotated.map((part) => record.trialDatabases[partitionName(part)]);
  const releases = new Map(names.length ? select(releasesSql(names, record.release)).map((r) => [r.name, r.release_id]) : []);
  const parts = annotated.map((part) => {
    const name = partitionName(part);
    return {
      name, featureCount: part.featureCount, releaseId: releases.get(record.trialDatabases[name]) ?? null,
      expected: expectedModels(readText(join(workPaths(env.workDir).buildDir, name, BUILD_FILES.gff3))),
      transcriptInfo: parseTranscriptInfo(readIfThere(join(part.dir, TRANSCRIPT_INFO))),
      validationLogs: ['isfPrint', 'isfSet'].map((kind) => ({ key: stepKey(kind, name), text: readIfThere(isfFiles(kind, name).validationLog) }))
    };
  });
  const ids = parts.map((p) => p.releaseId).filter((id) => id !== null);
  const rows = ids.length
    ? { genes: select(genesSql(ids)), transcripts: select(transcriptsSql(ids)), internalStops: select(internalStopsSql(ids)) }
    : { genes: [], transcripts: [], internalStops: [] };
  record.findings = [...qaFindings(parts, rows), ...profileFindings(record.profile)];
  record.steps.push({
    key: 'qa', kind: 'qa', plugin: null, partition: null, commit: false, status: 'done', exitCode: null, algInvocationId: null, log: null,
    startedAt: started.toISOString(), seconds: (env.now() - started) / 1000
  });
  env.save();
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test --test-reporter=dot /home/jbrestel/workspaces/src/dataset-curator-trial-isf/tests/genome-trial.test.js /home/jbrestel/workspaces/src/dataset-curator-trial-isf/tests/import-graph.test.js`
Expected: PASS (the Task 10 tests still pass: they read `steps.slice(0, FORWARD.length)` and only count `ga` calls).

- [ ] **Step 5: Commit**

```
git -C /home/jbrestel/workspaces/src/dataset-curator-trial-isf add shared/scripts/genome/commands/trial.js tests/genome-trial.test.js
git -C /home/jbrestel/workspaces/src/dataset-curator-trial-isf commit -m "Trial ISF: QA after ISF run 2, as findings in trial.json" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 12: Undo, by default and with `--undo`

**Files:**
- Modify: `shared/scripts/genome/commands/trial.js` (tail of `runTrial`, append `runUndo` and `runTrialUndo`)
- Modify: `tests/genome-trial.test.js` (import line, append)

- [ ] **Step 1: Write the failing test**

In `tests/genome-trial.test.js`, replace

```js
import { runTrial } from '../shared/scripts/genome/commands/trial.js';
```

with

```js
import { runTrial, runTrialUndo } from '../shared/scripts/genome/commands/trial.js';
```

and append:

```js
const MAP = '/opt/veupathdb/gus_home/lib/xml/isf/genemRNAExonCDS2Gus.xml';
const communityUndo = (plugin, id) => ({ plugin: PLUGIN.undo, args: ['--plugin', plugin, '--algInvocationId', String(id), '--commit'] });
const UNDO_CALLS = [
  { plugin: PLUGIN.isfUndo, args: ['--mapFile', MAP, '--algInvocationId', '7326', '--commit'] },
  communityUndo(PLUGIN.sequences, 7324), communityUndo(PLUGIN.externalDatabaseRls, 7323), communityUndo(PLUGIN.externalDatabase, 7322),
  communityUndo(PLUGIN.sequences, 7321), communityUndo(PLUGIN.externalDatabaseRls, 7320), communityUndo(PLUGIN.externalDatabase, 7319)
];
const undo = (ctx, docker) => runTrialUndo({ ...ctx, image: IMAGE, exec: docker.exec, now: fakeClock(), user: USER });

test('trial undoes every committed invocation newest first, then checks nothing is left', async () => {
  const ctx = trialWorkDir();
  const docker = fakeDocker();
  const record = await trial(ctx, docker, { keep: false });
  assert.deepEqual(docker.gaCalls().slice(FORWARD.length), UNDO_CALLS);
  assert.deepEqual(record.steps.slice(FORWARD.length + 1).map((s) => [s.key, s.status]), [
    `undo:isfSet:${PRIMARY}`, `undo:sequences:${ORGANELLE}`, `undo:externalDatabaseRls:${ORGANELLE}`, `undo:externalDatabase:${ORGANELLE}`,
    `undo:sequences:${PRIMARY}`, `undo:externalDatabaseRls:${PRIMARY}`, `undo:externalDatabase:${PRIMARY}`
  ].map((key) => [key, 'done']));
  assert.match(docker.calls.find((c) => c.input?.startsWith('-- trial:leftovers')).input, /row_alg_invocation_id IN \(7319, 7320, 7321, 7322, 7323, 7324, 7326\)/);
  assert.equal(record.undone, true);
  assert.equal(record.kept, false);
  assert.deepEqual(readRecord(ctx.workDir), record);
});

test('--keep leaves the rows; --undo removes them later with the cached model image', async () => {
  const ctx = trialWorkDir();
  const docker = fakeDocker();
  await trial(ctx, docker);
  const record = await undo(ctx, docker);
  assert.deepEqual(docker.gaCalls().slice(FORWARD.length), UNDO_CALLS);
  assert.equal(docker.calls.filter((c) => c.args.includes('bash')).length, 1);
  assert.equal(record.undone, true);
  assert.equal(record.kept, false);
  const calls = docker.calls.length;
  assert.equal((await undo(ctx, docker)).undone, true);
  assert.equal(docker.calls.length, calls);
});

test('--undo removes what a failed committed step loaded, and a new trial can then start', async () => {
  const ctx = trialWorkDir();
  const docker = fakeDocker({ ga: (call, state) => (call.plugin === PLUGIN.sequences && !state.failedOnce ? (state.failedOnce = true, { exitCode: 255 }) : undefined) });
  await assert.rejects(trial(ctx, docker), (e) => e.next === UNDO_FIRST);
  await undo(ctx, docker);
  assert.deepEqual(docker.gaCalls().slice(3), [
    communityUndo(PLUGIN.sequences, 7321), communityUndo(PLUGIN.externalDatabaseRls, 7320), communityUndo(PLUGIN.externalDatabase, 7319)
  ]);
  const again = await trial(ctx, docker, { now: fakeClock(new Date('2026-11-06T08:00:00.000Z')) });
  assert.equal(again.release, '20261106T080000');
  assert.equal(again.steps[0].key, `externalDatabase:${PRIMARY}`);
  assert.equal(again.undone, false);
});

test('rows left after Undo fail the run and leave it not undone', async () => {
  const ctx = trialWorkDir();
  const docker = fakeDocker({ selects: { leftovers: 'what\tn\ntrialRelease\t0\ndots.nafeatureimp\t3\n' } });
  await assert.rejects(trial(ctx, docker, { keep: false }), /rows remain after Undo: dots\.nafeatureimp 3/);
  assert.equal(readRecord(ctx.workDir).undone, false);
});

test('a failed Undo step names the log and says to run --undo again', async () => {
  const ctx = trialWorkDir();
  const docker = fakeDocker({ ga: (call) => (call.plugin === PLUGIN.isfUndo ? { exitCode: 255, id: null } : undefined) });
  await assert.rejects(trial(ctx, docker, { keep: false }), (e) => e.file === join(ctx.workDir, `trial/logs/undo:isfSet:${PRIMARY}.log`)
    && e.next === 'fix the cause, then run trial --undo again');
});

test('--undo needs a trial.json and the database the trial loaded into', async () => {
  const empty = trialWorkDir();
  await assert.rejects(undo(empty, fakeDocker()), /trial\.json: is missing; there is nothing to undo\nNext: run trial first/);
  const ctx = trialWorkDir();
  await trial(ctx, fakeDocker());
  await assert.rejects(undo(ctx, fakeDocker({ selects: { database: 'name\nother_db\n' } })), /names database other_db, but the trial loaded into UniDB_shu_m/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test --test-reporter=dot /home/jbrestel/workspaces/src/dataset-curator-trial-isf/tests/genome-trial.test.js /home/jbrestel/workspaces/src/dataset-curator-trial-isf/tests/import-graph.test.js`
Expected: FAIL with `does not provide an export named 'runTrialUndo'`.

- [ ] **Step 3: Add Undo**

In `shared/scripts/genome/commands/trial.js`, replace

```js
  const modelCtx = useModelImage(record, ctx, env);
  runForward(record, build, modelCtx, env);
  runQa(record, build, modelCtx, env);
  record.kept = keep;
  env.save();
  return record;
}
```

with

```js
  const modelCtx = useModelImage(record, ctx, env);
  runForward(record, build, modelCtx, env);
  runQa(record, build, modelCtx, env);
  if (keep) {
    record.kept = true;
    env.save();
  } else {
    runUndo(record, modelCtx, env);
  }
  return record;
}
```

and append:

```js
function runUndo(record, ctx, env) {
  for (const step of undoPlan(record.steps, { gusHome: ctx.gusHome })) {
    if (isDone(record, step.key)) continue;
    runStep(record, step, ctx, env, 'fix the cause, then run trial --undo again');
  }
  const invocations = record.steps.filter((s) => s.commit && s.kind !== 'undo' && s.algInvocationId !== null).map((s) => s.algInvocationId);
  const left = selectRows(ctx, leftoversSql(Object.values(record.trialDatabases), record.release, invocations), { exec: env.exec })
    .filter((r) => Number(r.n) > 0);
  if (left.length) {
    throw new PipelineError('trial', env.paths.trialJson, `rows remain after Undo: ${left.map((r) => `${r.what} ${r.n}`).join(', ')}`,
      'read the Undo logs under trial/logs, remove the rows, then run trial --undo again');
  }
  record.kept = false;
  record.undone = true;
  env.save();
}

export async function runTrialUndo({ workDir, image, gusConfig, exec = defaultExec, now = () => new Date(), user = hostUser() }) {
  checkTrialOptions({ image, gusConfig }, { undo: true });
  const paths = trialPaths(workDir);
  const record = readTrialRecord(paths.trialJson);
  if (!record) throw new PipelineError('trial', paths.trialJson, 'is missing; there is nothing to undo', 'run trial first');
  if (record.undone) return record;
  const ctx = contextOf({ workDir, image, gusConfig, user }, imageInfo(image, { exec }).gusHome);
  currentDatabase(ctx, record.database, { exec });
  const env = { exec, now, workDir, paths, save: () => saveTrialRecord(paths.trialJson, record) };
  runUndo(record, useModelImage(record, ctx, env), env);
  return record;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test --test-reporter=dot /home/jbrestel/workspaces/src/dataset-curator-trial-isf/tests/genome-trial.test.js /home/jbrestel/workspaces/src/dataset-curator-trial-isf/tests/import-graph.test.js`
Expected: PASS (the Task 10–11 tests pass `keep: true` through the `trial` helper).

- [ ] **Step 5: Commit**

```
git -C /home/jbrestel/workspaces/src/dataset-curator-trial-isf add shared/scripts/genome/commands/trial.js tests/genome-trial.test.js
git -C /home/jbrestel/workspaces/src/dataset-curator-trial-isf commit -m "Trial ISF: Undo after QA by default, trial --undo, leftover check" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 13: CLI

**Files:**
- Modify: `shared/scripts/genome/genome-pipeline.js` (whole file)
- Modify: `tests/genome-pipeline-cli.test.js` (imports, append)

- [ ] **Step 1: Write the failing test**

In `tests/genome-pipeline-cli.test.js`, replace

```js
import { spawnSync } from 'node:child_process';
```

with

```js
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
```

and append:

```js
test('trial takes --image, --gusConfig, --taxonId and --keep, or --undo in place of the last two', () => {
  const dir = tempDir('cli-');
  let r = cli('trial', '--workDir', dir, '--undo', '--keep');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /trial --undo takes no --keep or --taxonId\.\nUsage:/);
  r = cli('fetch', 'GCA_000000001.1', '--workDir', dir, '--image', 'gus_isf:local');
  assert.match(r.stderr, /fetch does not take --image\.\nUsage:/);
  r = cli('trial', '--workDir', dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^Error: trial: --image: is required\nNext: pass --image/);
  r = cli('trial', '--workDir', dir, '--image', 'gus_isf:local', '--gusConfig', join(dir, 'gus.config'), '--taxonId', '284813');
  assert.match(r.stderr, /^Error: trial: .*gus\.config: is missing/);
  r = cli('trial', '--workDir', dir, '--image', 'gus_isf:local', '--gusConfig', CLI, '--taxonId', 'ecun');
  assert.match(r.stderr, /^Error: trial: --taxonId: must be an NCBI taxon id/);
  r = cli('trial', '--workDir', dir, '--image', 'gus_isf:local', '--gusConfig', CLI, '--undo');
  assert.match(r.stderr, /^Error: trial: .*trial\.json: is missing; there is nothing to undo/);
  assert.match(cli().stderr, /node genome-pipeline\.js trial --workDir <dir> --image <name> --gusConfig <file> --undo/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test --test-reporter=dot /home/jbrestel/workspaces/src/dataset-curator-trial-isf/tests/genome-pipeline-cli.test.js /home/jbrestel/workspaces/src/dataset-curator-trial-isf/tests/import-graph.test.js`
Expected: FAIL; `trial` prints the usage instead of the expected messages.

- [ ] **Step 3: Wire the command**

Replace the whole of `shared/scripts/genome/genome-pipeline.js` with:

```js
#!/usr/bin/env node
/**
 * genome-pipeline.js - NCBI annotated genome in, ISF-ready partitions and genome-build.json out; `trial` loads them into GUS.
 * Specs: docs/superpowers/specs/2026-11-04-gff-pipeline-design.md, docs/superpowers/specs/2026-11-05-trial-isf-runner-design.md
 */
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { formatFinding } from './checks.js';
import { runBuild } from './commands/build.js';
import { runFetch } from './commands/fetch.js';
import { runFinalize } from './commands/finalize.js';
import { runSurvey } from './commands/survey.js';
import { runTrial, runTrialUndo } from './commands/trial.js';
import { PipelineError } from './workdir.js';

const USAGE = [
  'Usage: node genome-pipeline.js fetch <assemblyAccession> --workDir <dir>',
  '       node genome-pipeline.js survey --workDir <dir> --apiCommonData <ApiCommonData checkout>',
  '       node genome-pipeline.js build --workDir <dir> --apiCommonData <ApiCommonData checkout>',
  '       node genome-pipeline.js finalize --workDir <dir> --apiCommonData <ApiCommonData checkout> [--preprocessGFF3 <script>]',
  '       node genome-pipeline.js trial --workDir <dir> --image <name> --gusConfig <file> --taxonId <ncbi taxon id> [--keep]',
  '       node genome-pipeline.js trial --workDir <dir> --image <name> --gusConfig <file> --undo'
].join('\n');

const ACCEPTED = {
  fetch: ['workDir'],
  survey: ['workDir', 'apiCommonData'],
  build: ['workDir', 'apiCommonData'],
  finalize: ['workDir', 'apiCommonData', 'preprocessGFF3'],
  trial: ['workDir', 'image', 'gusConfig', 'taxonId', 'keep', 'undo']
};
const COMMANDS = Object.keys(ACCEPTED);

function fail(message) {
  console.error(message);
  process.exit(1);
}

const print = (lines) => console.log(lines.join('\n'));

function trialLines(record, workDir) {
  const last = new Map(record.steps.map((s) => [s.key, s]));
  const rows = record.undone ? 'Undo removed the trial rows'
    : record.kept ? 'Kept the trial rows; run trial --undo to remove them'
      : 'The trial rows are still loaded; run trial --undo to remove them';
  return [
    ...[...last.values()].map((s) => `  ${s.key}: ${s.status}${s.algInvocationId === null ? '' : ` (AlgInvocationId ${s.algInvocationId})`}, ${s.seconds} s`),
    ...record.findings.map(formatFinding),
    rows,
    `Wrote ${join(workDir, 'trial', 'trial.json')}`
  ];
}

async function main() {
  const { values, positionals } = parseArgs({
    options: {
      workDir: { type: 'string' }, apiCommonData: { type: 'string' }, preprocessGFF3: { type: 'string' },
      image: { type: 'string' }, gusConfig: { type: 'string' }, taxonId: { type: 'string' }, keep: { type: 'boolean' }, undo: { type: 'boolean' }
    },
    allowPositionals: true
  });
  const [command, ...rest] = positionals;
  if (!COMMANDS.includes(command)) fail(USAGE);
  const { workDir, apiCommonData, preprocessGFF3 } = values;
  if (!workDir) fail(`--workDir is required.\n${USAGE}`);
  const stray = Object.keys(values).filter((name) => !ACCEPTED[command].includes(name));
  if (stray.length) fail(`${command} does not take ${stray.map((s) => `--${s}`).join(', ')}.\n${USAGE}`);

  if (command === 'fetch') {
    if (rest.length !== 1) fail(`fetch takes one assembly accession.\n${USAGE}`);
    const record = await runFetch({ workDir, accession: rest[0] });
    print([`Fetched ${record.assembly} into ${join(workDir, 'fetch')}`,
      ...Object.entries(record.files).map(([role, f]) => `  ${role}: ${f.name} (sha256 ${f.sha256.slice(0, 12)})`)]);
  } else if (command === 'survey') {
    const survey = await runSurvey({ workDir, apiCommonData });
    print([...survey.findings.map(formatFinding), `Suggested recipe: ${JSON.stringify(survey.suggestedRecipe)}`, `Wrote ${join(workDir, 'survey.json')}`]);
  } else if (command === 'build') {
    const record = await runBuild({ workDir, apiCommonData });
    print([...record.transforms.map((t) => `  ${t.name}: ${t.changes}`), ...record.warnings.map((w) => `warning: ${w}`),
      ...record.findings.map(formatFinding), `Wrote ${join(workDir, 'build')} (normalized.gff3 sha256 ${record.normalized.sha256.slice(0, 12)})`]);
  } else if (command === 'finalize') {
    const record = await runFinalize({ workDir, apiCommonData, preprocessGFF3 });
    const dirty = record.apiCommonData.dirty ? ['warning: the ApiCommonData checkout has uncommitted changes; genome-build.json records that'] : [];
    print([...record.partitions.map((part) => `  ${part.dir}: ${part.sequenceCount} sequences`), ...dirty, `Wrote ${join(workDir, 'genome-build.json')}`]);
  } else {
    const { image, gusConfig, taxonId, keep, undo } = values;
    if (undo && (keep || taxonId !== undefined)) fail(`trial --undo takes no --keep or --taxonId.\n${USAGE}`);
    const record = undo
      ? await runTrialUndo({ workDir, image, gusConfig })
      : await runTrial({ workDir, image, gusConfig, taxonId: taxonId === undefined ? undefined : Number(taxonId), keep: Boolean(keep) });
    print(trialLines(record, workDir));
    if (record.findings.some((f) => f.severity === 'error')) process.exit(1);
  }
}

main().catch((err) => {
  if (err instanceof PipelineError) fail(`Error: ${err.message}`);
  if (err.code?.startsWith('ERR_PARSE_ARGS')) fail(`${err.message}\n${USAGE}`);
  fail(err.stack ?? String(err));
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test --test-reporter=dot /home/jbrestel/workspaces/src/dataset-curator-trial-isf/tests/genome-pipeline-cli.test.js /home/jbrestel/workspaces/src/dataset-curator-trial-isf/tests/import-graph.test.js`
Expected: PASS (the earlier CLI tests are unchanged).

- [ ] **Step 5: Commit**

```
git -C /home/jbrestel/workspaces/src/dataset-curator-trial-isf add shared/scripts/genome/genome-pipeline.js tests/genome-pipeline-cli.test.js
git -C /home/jbrestel/workspaces/src/dataset-curator-trial-isf commit -m "Trial ISF: trial command and --undo in genome-pipeline.js" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 14: Keep the golden work area for acceptance

The acceptance runs `trial` on the golden E. cuniculi X/XI build. `fetch` from NCBI would bring the whole genome, so the golden test (which stubs NCBI with the X/XI fixtures) is the way to make that work area; it needs to keep it.

**Files:**
- Modify: `tests/genome-golden.test.js:99`

- [ ] **Step 1: Let the golden test write into `GOLDEN_WORKDIR`**

In `tests/genome-golden.test.js`, replace

```js
  const workDir = tempDir('golden-ecun-');
```

with

```js
  const workDir = process.env.GOLDEN_WORKDIR ?? tempDir('golden-ecun-');
  mkdirSync(workDir, { recursive: true });
```

(`mkdirSync` is already imported.)

- [ ] **Step 2: Run the golden test**

Run: `node --test --test-reporter=dot /home/jbrestel/workspaces/src/dataset-curator-trial-isf/tests/genome-golden.test.js /home/jbrestel/workspaces/src/dataset-curator-trial-isf/tests/import-graph.test.js`
Expected: PASS, or the golden test skips with "APICOMMONDATA_DIR is not set".

- [ ] **Step 3: Commit**

```
git -C /home/jbrestel/workspaces/src/dataset-curator-trial-isf add tests/genome-golden.test.js
git -C /home/jbrestel/workspaces/src/dataset-curator-trial-isf commit -m "Golden test: GOLDEN_WORKDIR keeps the E. cuniculi work area" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 15: Docs, version 3.2.0, final checkpoint

**Files:**
- Modify: `docs/development.md` (Genome pipeline section)
- Modify: `package.json:3`, `.claude-plugin/plugin.json:3`

- [ ] **Step 1: Document `trial`**

In `docs/development.md`, replace

```
    node shared/scripts/genome/genome-pipeline.js finalize --workDir <dir> --apiCommonData <checkout> [--preprocessGFF3 <script>]
```

with

```
    node shared/scripts/genome/genome-pipeline.js finalize --workDir <dir> --apiCommonData <checkout> [--preprocessGFF3 <script>]
    node shared/scripts/genome/genome-pipeline.js trial    --workDir <dir> --image gus_isf:local --gusConfig <file> --taxonId <ncbi taxon id> [--keep]
    node shared/scripts/genome/genome-pipeline.js trial    --workDir <dir> --image gus_isf:local --gusConfig <file> --undo
```

Replace

```
| `genome-pipeline.js` | CLI: argument parsing and printing for the four commands |
| `commands/` | `fetch`, `survey`, `build`, `finalize` |
```

with

```
| `genome-pipeline.js` | CLI: argument parsing and printing for the five commands |
| `commands/` | `fetch`, `survey`, `build`, `finalize`, `trial` |
```

Replace

```
| `preprocess-gff3.js` | `perl -c` precheck and running `preprocessGFF3` |
```

with

```
| `preprocess-gff3.js` | `perl -c` precheck and running `preprocessGFF3` |
| `trial/gus.js` | Every Docker call: `ga` runs into a log, AlgInvocationId parsing, `selectRows`, `docker image inspect` |
| `trial/selectRows.pl` | Read-only SELECTs in the image through GusConfig and DBI; TSV out |
| `trial/steps.js` | Step list from `genome-build.json`, plugin arguments, the Undo plan |
| `trial/model-image.js` | Schema fingerprint; reuse or build `gus_isf-model:<database>-<fingerprint12>` |
| `trial/qa.js` | QA and Undo SELECTs, QA findings, profiling |
| `trial/record.js` | `trial/trial.json` contract, resume and stale checks |
```

Then, after the paragraph that ends `with \`UPDATE_GOLDEN=1\` and review the diff of a local run.`, insert:

```
**Trial ISF** (spec: `docs/superpowers/specs/2026-11-05-trial-isf-runner-design.md`).
After `finalize`, `trial` loads the work area into the GUS database the mounted
`gus.config` names, inside the `gus_isf` image (docker-tools `gus_isf/Dockerfile`),
one `docker run` per `ga` call: external database, release and
`LoadFastaSequences` per partition, then ISF with `PRINT_TRANSCRIPT_IDS` (no
`--commit`; its `transcriptIds` is copied to `final/<partition>/transcriptInfoAndIds`
on exit 0 only) and ISF with `SET_TRANSCRIPT_IDS` (`--commit`). QA SELECTs and a
query profile follow, then GUS Undo unless `--keep`; `trial --undo` cleans up
after `--keep` or a failure. `ga` logs are in `trial/logs/<key>.log` and
everything else is in `trial/trial.json`, written after every step. A rerun
resumes; it refuses a build that changed ("trial is for an older build") and a
committed step that failed after loading rows, and names `trial --undo` for both.
The runner reads `GUS_HOME` from the image, never reads `gus.config`, and builds
`gus_isf-model:<database>-<fingerprint12>` (GUS::Model generated against the
target schema, plus `selectRows`) once per schema. `trial` exits 1 on a QA error.
Every Docker call goes through one `exec`; the tests feed it recorded output
(`tests/genome-trial-helpers.js`) and never touch Docker or a database. The
golden test keeps its work area in `GOLDEN_WORKDIR` when set, for a manual run
of `trial` on E. cuniculi X/XI.
```

- [ ] **Step 2: Bump the version to 3.2.0**

In `package.json`, replace `"version": "3.1.0",` with `"version": "3.2.0",`.
In `.claude-plugin/plugin.json`, replace `"version": "3.1.0",` with `"version": "3.2.0",`.

- [ ] **Step 3: Final checkpoint: full suite**

Run: `node --test --test-reporter=dot --test-global-setup=/home/jbrestel/workspaces/src/dataset-curator-trial-isf/tests/globalSetup.js /home/jbrestel/workspaces/src/dataset-curator-trial-isf/tests/*.test.js`
Expected: PASS, with skips only where `perl` or `APICOMMONDATA_DIR` is missing. (The trial tests read `GENERATOR.version` at run time, so the bump changes no expectation.)

- [ ] **Step 4: Commit**

```
git -C /home/jbrestel/workspaces/src/dataset-curator-trial-isf add docs/development.md package.json .claude-plugin/plugin.json
git -C /home/jbrestel/workspaces/src/dataset-curator-trial-isf commit -m "Trial ISF runner: docs and version 3.2.0" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 16: Manual acceptance (not code)

John runs this, or the controller does with John's explicit OK: it writes to UniDB_shu_m through GUS plugins and Undo, and takes about 9 minutes of ISF per run. Record the outcome in the PR description.

Prerequisites:
- `gus_isf:local` is built from `/home/jbrestel/workspaces/src/docker-tools-gus-isf/gus_isf/Dockerfile`.
- John's `gus.config` for UniDB_shu_m (mode 600) is at a path he names. Nobody but the container reads it.
- An ApiCommonData checkout whose `Load/lib/xml/isf/genemRNAExonCDS2Gus.xml` matches the image's map. The image's commit is `docker run --rm gus_isf:local cat /opt/veupathdb/gus_home/APICOMMONDATA_COMMIT`; check that commit out if preflight says the map differs.
- `perl` on the host (the golden test runs preprocessGFF3).

Checklist:

- [ ] **Build the work area.** `GOLDEN_WORKDIR=<scratch>/ecunTrial APICOMMONDATA_DIR=<ApiCommonData checkout> node --test /home/jbrestel/workspaces/src/dataset-curator-trial-isf/tests/genome-golden.test.js` passes, and `<scratch>/ecunTrial/genome-build.json` lists one partition, `final/primary_chromosome`, with `featureCount` 442. This is fetch (stubbed with the X/XI fixtures), survey, build and finalize.
- [ ] **Run the trial, keeping the rows.** `node /home/jbrestel/workspaces/src/dataset-curator-trial-isf/shared/scripts/genome/genome-pipeline.js trial --workDir <scratch>/ecunTrial --image gus_isf:local --gusConfig <gus.config> --taxonId 284813 --keep` exits 0. The first run builds `gus_isf-model:unidb_shu_m-<fingerprint12>` (about a minute; `trial/logs/modelImage.log`).
- [ ] **442 genes in both runs.** `final/primary_chromosome/transcriptInfoAndIds` has 442 lines (run 1). `trial.json` has no `geneCount` finding (run 2: 442 rows in `dots.genefeature` for the trial release). The `RESULT` lines of `trial/logs/isfPrint:primary_chromosome.log` and `trial/logs/isfSet:primary_chromosome.log` report the same feature count.
- [ ] **No transcript with more than one protein.** No `multipleProteins` or `codingNoProtein` finding in `trial.json`.
- [ ] **transcriptInfoAndIds matches the database.** No `transcriptIds` or `transcriptInfoRows` finding.
- [ ] **Profile.** `trial.json` `profile["isfSet:primary_chromosome"]` has a `source`, `seconds`, `secondsPerGene` (expect about 0.5–0.6) and top-10 lists; the `isfProfile` info finding names the busiest queries. Note whether the repeated `SRES.ontologyterm` query from the spike is at the top.
- [ ] **Clean Undo.** `node /home/jbrestel/workspaces/src/dataset-curator-trial-isf/shared/scripts/genome/genome-pipeline.js trial --workDir <scratch>/ecunTrial --image gus_isf:local --gusConfig <gus.config> --undo` exits 0, reuses the model image (no new `modelImage.log` build), and prints `Undo removed the trial rows`. `trial.json` has `undone: true`. A read-only check in psql, `SELECT count(*) FROM sres.externaldatabase WHERE name LIKE 'curatorTrial_GCA_000091225.2_%'`, returns 0.
- [ ] **Resume, once.** Optional: interrupt a second run (Ctrl-C) during `isfPrint`, rerun the same command, and see it resume at `isfPrint` without repeating the sequence steps; then `trial --undo`.
- [ ] **Report.** Paste the `trial` output, the `profile` top entries and the Undo output into the PR.

---

## Self-review

**Spec coverage.**
- Command and `--undo`: Tasks 10, 12, 13. `<workDir>/trial/` and `final/<p>/transcriptInfoAndIds`: Task 10.
- Every step a `docker run --rm --network host -u` with `gus.config` read-only at `$GUS_HOME/config/gus.config` and the work area at `/work`: Task 3 (`dockerRunArgs`).
- Preflight: schemaVersion and `final` files (Task 9 `readGenomeBuild`); map sha256 (`checkImageMap`); SO_RSRC, taxon, genetic code and existing release rows (`preflightReferenceData`); no writes on refusal (Task 10 test).
- Model image: fingerprint from `core.tableinfo` in id order, reuse by tag via `docker image inspect`, `rm -rf … && bld GUS/Model`, `docker commit`, `selectRows` copied into `$GUS_HOME/bin`: Task 6.
- Sequences with `--commit`: Task 4. ISF run 1 and run 2 arguments, `featureCount: 0` partitions skipped: Task 4. Copy only on exit 0: Task 10. QA: Tasks 7, 11. Undo in reverse with the right plugins, then the leftover check: Tasks 4, 12.
- Names: trial database and release version: Task 4. AlgInvocationId recorded per step; a missing one or non-zero exit fails the step: Tasks 3, 10.
- Records: every `trial.json` field (Task 5), written atomically after every step (Tasks 5, 10), logs at `trial/logs/<key>.log` (Task 10), resume and "trial is for an older build" (Tasks 5, 10), `--undo` after `--keep` and after a failure (Task 12), `genome-build.json` untouched (only read).
- QA table rows: Task 7 (errors and warnings), Task 8 (info: seconds and top queries). Profiling with `pg_stat_statements` or `pg_stat_user_tables` and the source recorded: Tasks 8, 10. Error findings make `trial` exit non-zero after Undo: Task 13.
- Errors as `PipelineError('trial', file, problem, next)` with the log path and last 20 lines: Tasks 3, 10.
- Modules as the spec's table: Tasks 1, 3–12. Testing list: step order and arguments (4), `featureCount: 0` (4), invocation ID (3, 10), copy on exit 0 (10), resume and stale (5, 10), Undo order and arguments (4, 12), preflight refusals (9, 10), model image hit and miss (6), QA findings (7, 11), profiling source (8), atomic `trial.json` (5).
- Acceptance: Task 16. Version minor bump: Task 15.

**Placeholder scan.** Every code step shows the code; `<scratch>`, `<gus.config>` and `<ApiCommonData checkout>` appear only in the manual checklist, where John supplies them.

**Type consistency.** Checked against the signature list: `runGa(ctx, { plugin, args }, logPath, { exec })` is called with a step object (which has `plugin` and `args`); `selectRows(ctx, sql, { exec, mounted })`; `ensureModelImage(baseCtx, database, { exec, logPath })`; `preflightReferenceData(ctx, { database, taxonId, names, release, fresh }, { exec })`; `newTrialRecord` takes `trialDatabases` and `startedAt`; `undoPlan(record.steps, { gusHome })`; `profileEntry(diff, { seconds, genes })`; steps carry `dir`, attempts carry `kind` and `commit`; the qa step has `kind: 'qa'` and `commit: false`, so `undoPlan` and `committedFailure` skip it.
