# Functional Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `functional --workDir <dir>` command that reads the build GFF3 of each annotated partition D finalized and writes the files of the functional dataset classes (`productNames`, `geneName`, `comments`, `aliases`, `dbxref_synonym`, one `dbxref_simple` per Dbxref prefix, `GeneOntologyAssociations`, `EnzymeCommissionAssociations`) under `final/function/`, plus a `functional.json` record for F. It needs no network, database or Docker.

**Architecture:** `genome-build.js` takes over `readGenomeBuild` (and `partitionName`) from the trial so both commands validate `genome-build.json` the same way. `functional/ids.js` resolves every gene, RNA and CDS of one GFF3 to the gene and transcript IDs ISF loads. `functional/values.js` parses attribute values (`%2C`-safe splitting, `go_*`, `EC_number`, `Dbxref`, prefix names). `functional/classes.js` holds the extraction table and the engine that turns resolved features into sorted, deduplicated rows and findings. `functional/dbxref-urls.js` maps prefixes to URL templates. `functional/record.js` owns `functional.json`. `commands/functional.js` reads the work area, formats files, stages and swaps `final/function/`, then writes the record. `genome-pipeline.js` wires the CLI.

**Tech Stack:** Node ES modules, `node:test`, `node:assert/strict`, Node built-ins only, no npm dependencies. Spec: `docs/superpowers/specs/2026-11-05-functional-extraction-design.md`.

---

## Spec corrections

Found while grounding the spec in code and data. The tasks implement the corrected version.

1. **E. cuniculi has 442 product rows, not 436.** The build GFF3 of the golden work area has 436 `CDS` lines over 428 `mRNA`s and 14 RNAs without a CDS (8 `tRNA`, 3 `snRNA`, 1 `snoRNA`, 1 `SRP_RNA`, 1 `RNase_MRP_RNA`), every one with a `product` (`build/primary_chromosome/genome.gff3` type counts; 442 is also `featureCount` in `tests/genome-golden.test.js:124`). The spec's own rule ("on the RNA when it has no CDS") gives 428 + 14 = 442 rows and 442 transcripts. 436 is the CDS line count. Task 10 pins 442.
2. **`readGenomeBuild` needs a command name and `partitionName`.** Its errors hard-code `'trial'` (`commands/trial.js:81-100`) and it calls `partitionName` from `trial/steps.js` (`commands/trial.js:90`, `trial/steps.js:19`). `genome-build.js` gets `readGenomeBuild(workDir, command)` and `partitionName`; `trial/steps.js`, `trial/record.js`, `commands/trial.js` and `tests/genome-trial-steps.test.js` import `partitionName` from there. Its tests move from `tests/genome-trial-preflight.test.js` to a new `tests/genome-build-record.test.js`.
3. **The findings helper is D's, not C's.** `finding(group, check, severity, ids, message, fix = null, count = ids.length)` and `formatFinding` live in `checks.js:6` and `checks.js:21`; `trial/qa.js` imports them. E reuses them from `checks.js`. The shape is the one the spec names.
4. **The version lives in two files.** Commit efcb205 (3.2.0) bumped `package.json` and `.claude-plugin/plugin.json`. Task 11 bumps both to 3.3.0.
5. **No generic URL for `EnsemblGenomes-Gn`/`-Tr`.** Existing VEuPathDatasets `dbxref_simple` datasets use species-specific Ensembl URLs (`fungi.ensembl.org/<Species>/Gene/Summary?g=…`), so `functional/dbxref-urls.js` has no template for them and E. cuniculi gets an `unknownDbxrefPrefix` warning for both. Observation for F, not changed here: existing `_from_annotation` datasets mostly use `viewName` `Transcript` and the name `uniprot_from_annotation`; the spec's rule gives gene-level `GeneFeature` and `uniprotkb_swiss_prot_from_annotation`/`uniprotkb_trembl_from_annotation`. The plan follows the spec.

Verified, no correction: GusSkeletonMaker names translations `$transcriptId."-p".$aaCount`, counting TranslatedAAFeatures in `translation_stop` order, for `mRNA`s of coding, pseudo, repeated and transposable-element genes (`ApiCommonData/Load/lib/perl/GusSkeletonMaker.pm:564-579`). One translation per transcript gives `<transcript>-p1`. The fetch record names the report as `files.report` (`commands/fetch.js:9`); the E. cuniculi report has `# Taxid:          284813`.

## Decisions beyond the spec

Settled while planning; the tasks implement these.

1. **`geneName` source.** `gene` is read from the gene and from its RNAs and CDSs. The gene feature's own value wins; when it has none, the first value its RNAs or CDSs carry in GFF order is used. Any second distinct value is a `geneNameConflict` warning. The name is skipped when it equals the gene ID or any `locus_tag` on those features.
2. **`go_*` features.** Read from RNAs and CDSs (transcript level), deduplicated per transcript.
3. **`go_*` parsing.** A raw `,` separates terms, but NCBI may also put one inside a PMID list. A piece continues the previous one when that has fewer than four `|` fields and the piece does not itself start a term (`^[^|]*\|\d+\|`). The GO id is 1–7 digits, zero-padded to 7; PMIDs are digits split on `,`, `;` or whitespace; evidence is 2–3 capital letters, `IEA` when empty. Anything else is `badGo`.
4. **GAF columns.** 17 tab-separated columns (GAF 2.2), the spec's columns 1–15 as listed and 16–17 empty. Column 14, the date, is `genome-build.json` `finalizedAt` as `YYYYMMDD`, so a rerun writes the same bytes. A build without `finalizedAt` is refused.
5. **Bad values are skipped.** A malformed `go_*` (`badGo`) or `EC_number` (`badEc`) is not written; the warning samples `<id>: <value>`. A `Dbxref` with no `prefix:` part is a `badDbxref` warning (not in the spec's table; skipping it silently would hide data).
6. **Clashing Dbxref prefixes are not written.** Both would land in one directory. `dbxrefNameClash` is an error, so the run exits 1.
7. **Tabs and line breaks** inside a decoded value become one space, so a `%09` cannot break the TSV.
8. **`emptyClass`** is one info finding whose sample names each empty dataset as `<class>/<name>`, or `dbxref_simple` when no prefix was found.
9. **"Coding transcript"** for `noProducts` is a transcript with at least one CDS.
10. **The taxon** comes from `fetch/fetch.json` `files.report`, checked against its sha256, through a new `reportTaxonId(text)` in `assembly-report.js`.
11. **The engine lives in `functional/classes.js`** beside the table; no extra module.
12. **Writes.** `functional.json` is removed first; files are staged in `final/function.tmp` and swapped in with `swapDirs`; the record is written last. `runFunctional` is synchronous.

---

## Conventions

- Work in the worktree `/home/jbrestel/workspaces/src/dataset-curator-functional` on branch `feature/functional-extraction`. Never commit to `main`.
- New code: `shared/scripts/genome/genome-build.js`, `shared/scripts/genome/functional/{ids,values,dbxref-urls,classes,record}.js`, `shared/scripts/genome/commands/functional.js`. Nothing under `shared/scripts/genome/` is in `package.json` `sharedFiles`; `bin/sync-shared.js` never copies it.
- Reuse D's helpers; do not copy them: `PipelineError`, `readJson`, `readText`, `sha256`, `sha256File`, `swapDirs`, `workPaths`, `writeFileAtomic`, `writeJsonAtomic` (`workdir.js`); `BUILD_FILES`, `GENERATOR`, `SCHEMA_VERSION` (`record.js`); `finding`, `formatFinding` (`checks.js`); `parseGff`, `featureGroups`, `getValues`, `parentsOf`, `decode`, `spanLabel` (`gff.js`); `levelOf` (`feature-types.js`).
- **No committed fixtures.** Tests build GFF3 text inside the test with `gffLine`/`gffText` (`tests/genome-helpers.js`). The golden test pins E. cuniculi output as rows, ID counts and sha256 digests, never as files.
- **Testing per task:** run only that task's test file plus the import-graph test, e.g. `node --test --test-reporter=dot --test-global-setup=/home/jbrestel/workspaces/src/dataset-curator-functional/tests/globalSetup.js /home/jbrestel/workspaces/src/dataset-curator-functional/tests/genome-functional-ids.test.js /home/jbrestel/workspaces/src/dataset-curator-functional/tests/import-graph.test.js`.
- **Full suite only at two checkpoints**, Task 6 (mid-plan) and Task 11 (final): `node --test --test-reporter=dot --test-global-setup=/home/jbrestel/workspaces/src/dataset-curator-functional/tests/globalSetup.js /home/jbrestel/workspaces/src/dataset-curator-functional/tests/*.test.js`. Pass the glob, not the directory.
- Shell: one simple command per call; no `$(...)`, backticks, `;` chains or heredocs. Use `git -C /home/jbrestel/workspaces/src/dataset-curator-functional ...`. Create and edit files with the editor tools only.
- Comments: self-describing code; at most 2–3 line comments, only where the logic is not obvious; no examples that go stale.
- Commit messages end with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (pass it as a second `-m`).
- Test files: `tests/genome-functional-*.test.js`, `tests/genome-functional.test.js` and `tests/genome-build-record.test.js`; the shared work-area builder is `tests/genome-functional-helpers.js` (not a `*.test.js` file).

---

## File structure

| File | Responsibility |
|---|---|
| `shared/scripts/genome/genome-build.js` | `partitionName`, `readGenomeBuild(workDir, command)`: the validation `trial` and `functional` share |
| `shared/scripts/genome/assembly-report.js` | Gains `reportTaxonId(text)` |
| `shared/scripts/genome/functional/values.js` | `attrValues`, `parseGo`, `goValues`, `GO_ASPECTS`, `isEc`, `parseDbxref`, `dbxrefDatasetName` |
| `shared/scripts/genome/functional/dbxref-urls.js` | `DBXREF_URLS`, `urlOf` |
| `shared/scripts/genome/functional/ids.js` | `proteinIdOf`, `resolveFeatures` |
| `shared/scripts/genome/functional/classes.js` | `DATASETS` (the extraction table), `uniqueSorted`, `extractDatasets`, `fileText` |
| `shared/scripts/genome/functional/record.js` | `FUNCTIONAL_SCHEMA_VERSION`, `FUNCTION_DIR`, `functionalPaths`, `newFunctionalRecord`, `readFunctionalRecord` |
| `shared/scripts/genome/commands/functional.js` | `sourceOf`, `gafDate`, `readTaxonId`, `runFunctional` |
| `shared/scripts/genome/genome-pipeline.js` | CLI: `functional --workDir <dir>` |
| `shared/scripts/genome/commands/trial.js`, `trial/steps.js`, `trial/record.js` | Import `partitionName`/`readGenomeBuild` from `genome-build.js` |
| `tests/genome-functional-helpers.js` | `FUNCTIONAL_GFF3`, `REPORT`, `REPORT_NAME`, `functionalWorkDir` |
| `tests/genome-build-record.test.js`, `tests/genome-functional-*.test.js`, `tests/genome-functional.test.js` | Unit and command tests |

Import order (no cycles): `values.js`, `dbxref-urls.js`, `ids.js` → `classes.js` (also `checks.js`) → `record.js` → `commands/functional.js` (also `genome-build.js`, `assembly-report.js`) → `genome-pipeline.js`. `genome-build.js` imports only `record.js` and `workdir.js`.

Signatures used across tasks (keep them exactly):

```js
// genome-build.js
partitionName(part) -> string
readGenomeBuild(workDir, command) -> { build, sha256 }
// assembly-report.js
reportTaxonId(text) -> number | null
// functional/values.js
GO_ASPECTS                                   // { go_function: 'F', go_process: 'P', go_component: 'C' }
attrValues(group, key) -> string[]
parseGo(raw) -> { goId, reference, evidence } | null
goValues(group, key) -> { values: [{ goId, reference, evidence }], bad: string[] }
isEc(value) -> boolean, parseDbxref(value) -> { prefix, id } | null, dbxrefDatasetName(prefix) -> string
// functional/dbxref-urls.js
DBXREF_URLS, urlOf(prefix) -> string | null
// functional/ids.js
proteinIdOf(transcriptId) -> string
resolveFeatures(graph) -> { features: [{ kind: 'gene'|'rna'|'cds', group, gene, transcript, hasCds? }], unresolved: string[], codingTranscripts: string[] }
// functional/classes.js
DATASETS, uniqueSorted(rows) -> rows
extractDatasets(features, { source, codingTranscripts }) -> { datasets: [{ datasetClass, level, file, format, name, props, rows }], findings }
fileText(dataset, { source, taxonId, date }) -> string
// functional/record.js
FUNCTIONAL_SCHEMA_VERSION, FUNCTION_DIR, functionalPaths(workDir) -> { functionDir, stagedDir, functionalJson }
newFunctionalRecord({ genomeBuildSha256, source, datasets, findings }) -> record   // datasets carry rows and sha256
readFunctionalRecord(workDir, command) -> record
// commands/functional.js
sourceOf(accession) -> 'GenBank' | 'RefSeq' | null, gafDate(finalizedAt) -> 'YYYYMMDD' | null
readTaxonId(workDir) -> number
runFunctional({ workDir }) -> record
// tests/genome-functional-helpers.js
FUNCTIONAL_GFF3, REPORT, REPORT_NAME, functionalWorkDir({ gff3, accession, report } = {}) -> workDir
```

---

## Task 1: `genome-build.js`, shared by `trial` and `functional`

**Files:**
- Create: `shared/scripts/genome/genome-build.js`
- Modify: `shared/scripts/genome/commands/trial.js`, `shared/scripts/genome/trial/steps.js:1-19`, `shared/scripts/genome/trial/record.js:6`
- Modify: `tests/genome-trial-preflight.test.js:3-10,38-61`, `tests/genome-trial-steps.test.js:3-5`
- Test: `tests/genome-build-record.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/genome-build-record.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { partitionName, readGenomeBuild } from '../shared/scripts/genome/genome-build.js';
import { sha256 } from '../shared/scripts/genome/workdir.js';
import { tempDir } from './genome-helpers.js';
import { ORGANELLE, PRIMARY, trialBuild, trialWorkDir } from './genome-trial-helpers.js';

test('partitionName is the last part of a partition dir', () => {
  assert.equal(partitionName(trialBuild().partitions[0]), PRIMARY);
  assert.equal(partitionName(trialBuild().partitions[1]), ORGANELLE);
});

test('readGenomeBuild returns the record and its sha256', () => {
  const { workDir } = trialWorkDir();
  const { build, sha256: digest } = readGenomeBuild(workDir, 'trial');
  assert.deepEqual(build, trialBuild());
  assert.equal(digest, sha256(`${JSON.stringify(trialBuild(), null, 2)}\n`));
});

test('readGenomeBuild refuses a missing, other-version or incomplete genome-build.json', () => {
  assert.throws(() => readGenomeBuild(tempDir('empty-'), 'trial'), /trial: .*genome-build\.json: is missing\nNext: run finalize first/);
  const { workDir: older } = trialWorkDir({ ...trialBuild(), schemaVersion: 2 });
  assert.throws(() => readGenomeBuild(older, 'trial'), /has schemaVersion 2, not 1\nNext: run build and finalize again/);
  const { workDir: bad } = trialWorkDir({ ...trialBuild(), accession: '../x' });
  assert.throws(() => readGenomeBuild(bad, 'trial'), /is incomplete: it needs accession, apiCommonData\.isfMap\.sha256 and partitions/);
});

test('readGenomeBuild refuses a final/ file that is missing or empty, and a build GFF3 that changed', () => {
  const { workDir } = trialWorkDir();
  const fasta = join(workDir, `final/${ORGANELLE}/genome.fasta`);
  writeFileSync(fasta, '');
  assert.throws(() => readGenomeBuild(workDir, 'trial'), (e) => e.file === fasta && e.problem === 'is missing or empty' && e.next === 'run finalize again');
  const { workDir: changed } = trialWorkDir();
  appendFileSync(join(changed, `build/${PRIMARY}/genome.gff3`), '# edited\n');
  assert.throws(() => readGenomeBuild(changed, 'trial'), /genome\.gff3: does not match genome-build\.json/);
});

test('readGenomeBuild names the command that called it', () => {
  assert.throws(() => readGenomeBuild(tempDir('empty-'), 'functional'), (e) => e.command === 'functional' && /^functional: /.test(e.message));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test --test-reporter=dot --test-global-setup=/home/jbrestel/workspaces/src/dataset-curator-functional/tests/globalSetup.js /home/jbrestel/workspaces/src/dataset-curator-functional/tests/genome-build-record.test.js /home/jbrestel/workspaces/src/dataset-curator-functional/tests/import-graph.test.js`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `shared/scripts/genome/genome-build.js`.

- [ ] **Step 3: Write `genome-build.js`**

Create `shared/scripts/genome/genome-build.js`:

```js
import { existsSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { BUILD_FILES, SCHEMA_VERSION } from './record.js';
import { PipelineError, readJson, sha256File, workPaths } from './workdir.js';

const REFINALIZE = 'run build and finalize again';
const hasContent = (file) => existsSync(file) && statSync(file).size > 0;

export const partitionName = (part) => basename(part.dir);

/** genome-build.json as finalize wrote it, every final/ file it lists, and each annotated partition's build GFF3 unchanged. */
export function readGenomeBuild(workDir, command) {
  const p = workPaths(workDir);
  const build = readJson(p.genomeBuildJson, command, 'run finalize first');
  if (build?.schemaVersion !== SCHEMA_VERSION) {
    throw new PipelineError(command, p.genomeBuildJson, `has schemaVersion ${build?.schemaVersion}, not ${SCHEMA_VERSION}`, REFINALIZE);
  }
  const complete = /^[\w.]+$/.test(build.accession ?? '') && typeof build.apiCommonData?.isfMap?.sha256 === 'string'
    && Array.isArray(build.partitions) && build.partitions.length > 0
    && build.partitions.every((part) => typeof part?.dir === 'string' && part.final && typeof part.soTerm === 'string' && Number.isInteger(part.featureCount));
  if (!complete) throw new PipelineError(command, p.genomeBuildJson, 'is incomplete: it needs accession, apiCommonData.isfMap.sha256 and partitions', REFINALIZE);
  for (const part of build.partitions) {
    if (!part.final.fasta) throw new PipelineError(command, p.genomeBuildJson, `${partitionName(part)} has no final FASTA`, REFINALIZE);
    if (part.featureCount > 0 && !part.final.gff) {
      throw new PipelineError(command, p.genomeBuildJson, `${partitionName(part)} has featureCount ${part.featureCount} but no final GFF`, REFINALIZE);
    }
    for (const name of Object.values(part.final).filter(Boolean)) {
      const file = join(workDir, part.dir, name);
      if (!hasContent(file)) throw new PipelineError(command, file, 'is missing or empty', 'run finalize again');
    }
    const gff3 = join(p.buildDir, partitionName(part), BUILD_FILES.gff3);
    if (part.featureCount > 0 && (!existsSync(gff3) || sha256File(gff3) !== part.buildFiles?.gff3)) {
      throw new PipelineError(command, gff3, 'does not match genome-build.json', REFINALIZE);
    }
  }
  return { build, sha256: sha256File(p.genomeBuildJson) };
}
```

- [ ] **Step 4: Point the trial at it**

In `shared/scripts/genome/commands/trial.js`:

Replace

```js
import { BUILD_FILES, SCHEMA_VERSION } from '../record.js';
import { finding } from '../checks.js';
```

with

```js
import { BUILD_FILES } from '../record.js';
import { finding } from '../checks.js';
import { partitionName, readGenomeBuild } from '../genome-build.js';
```

Replace

```js
  ISF_KINDS, isfFiles, isfMapIn, partitionName, planSteps, releaseVersion, stepKey, TRANSCRIPT_IDS, TRANSCRIPT_INFO, trialDatabaseName, undoPlan
} from '../trial/steps.js';
import { PipelineError, readJson, readText, sha256, sha256File, workPaths } from '../workdir.js';
```

with

```js
  ISF_KINDS, isfFiles, isfMapIn, planSteps, releaseVersion, stepKey, TRANSCRIPT_IDS, TRANSCRIPT_INFO, trialDatabaseName, undoPlan
} from '../trial/steps.js';
import { PipelineError, readText, sha256, sha256File, workPaths } from '../workdir.js';
```

Replace

```js
const hasContent = (file) => existsSync(file) && statSync(file).size > 0;
const REFINALIZE = 'run build and finalize again';
```

with

```js
const hasContent = (file) => existsSync(file) && statSync(file).size > 0;
```

Delete the whole `readGenomeBuild` function, from the line `/** genome-build.json as finalize wrote it, every final/ file it lists, and the build GFF3 QA reads gene trees from. */` through its closing `}` and the blank line after it (the function now lives in `genome-build.js`).

Replace

```js
  const { build, sha256: genomeBuildSha256 } = readGenomeBuild(workDir);
```

with

```js
  const { build, sha256: genomeBuildSha256 } = readGenomeBuild(workDir, 'trial');
```

In `shared/scripts/genome/trial/steps.js`, replace

```js
import { basename, posix } from 'node:path';
import { MAP_PATH } from '../preprocess-gff3.js';
```

with

```js
import { posix } from 'node:path';
import { partitionName } from '../genome-build.js';
import { MAP_PATH } from '../preprocess-gff3.js';
```

and delete the line

```js
export const partitionName = (part) => basename(part.dir);
```

In `shared/scripts/genome/trial/record.js`, replace

```js
import { partitionName } from './steps.js';
```

with

```js
import { partitionName } from '../genome-build.js';
```

- [ ] **Step 5: Move the trial's `readGenomeBuild` tests**

In `tests/genome-trial-preflight.test.js`, replace

```js
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  checkImageMap, checkTrialOptions, contextOf, currentDatabase, fastaSourceIds, imageInfo, leftoverDatabasesSql, preflightReferenceData, readGenomeBuild,
  takenSourceIdsSql
} from '../shared/scripts/genome/commands/trial.js';
import { PipelineError, sha256 } from '../shared/scripts/genome/workdir.js';
```

with

```js
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  checkImageMap, checkTrialOptions, contextOf, currentDatabase, fastaSourceIds, imageInfo, leftoverDatabasesSql, preflightReferenceData,
  takenSourceIdsSql
} from '../shared/scripts/genome/commands/trial.js';
import { PipelineError } from '../shared/scripts/genome/workdir.js';
```

and delete the three tests `'readGenomeBuild returns the record and its sha256'`, `'readGenomeBuild refuses a missing, other-version or incomplete genome-build.json'` and `'readGenomeBuild refuses a final/ file that is missing or empty, and a build GFF3 that changed'` (they are in `tests/genome-build-record.test.js` now).

In `tests/genome-trial-steps.test.js`, replace

```js
import {
  ISF_UNDO, isfFiles, isfMapIn, partitionName, planSteps, PLUGINS, releaseVersion, trialDatabaseName, UNDO, undoPlan
} from '../shared/scripts/genome/trial/steps.js';
```

with

```js
import { partitionName } from '../shared/scripts/genome/genome-build.js';
import {
  ISF_UNDO, isfFiles, isfMapIn, planSteps, PLUGINS, releaseVersion, trialDatabaseName, UNDO, undoPlan
} from '../shared/scripts/genome/trial/steps.js';
```

- [ ] **Step 6: Run the tests to verify they pass**

This task moves trial code, so it also runs the trial test files that import it.

Run: `node --test --test-reporter=dot --test-global-setup=/home/jbrestel/workspaces/src/dataset-curator-functional/tests/globalSetup.js /home/jbrestel/workspaces/src/dataset-curator-functional/tests/genome-build-record.test.js /home/jbrestel/workspaces/src/dataset-curator-functional/tests/genome-trial-preflight.test.js /home/jbrestel/workspaces/src/dataset-curator-functional/tests/genome-trial-steps.test.js /home/jbrestel/workspaces/src/dataset-curator-functional/tests/genome-trial-record.test.js /home/jbrestel/workspaces/src/dataset-curator-functional/tests/genome-trial.test.js /home/jbrestel/workspaces/src/dataset-curator-functional/tests/import-graph.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```
git -C /home/jbrestel/workspaces/src/dataset-curator-functional add shared/scripts/genome/genome-build.js shared/scripts/genome/commands/trial.js shared/scripts/genome/trial/steps.js shared/scripts/genome/trial/record.js tests/genome-build-record.test.js tests/genome-trial-preflight.test.js tests/genome-trial-steps.test.js
git -C /home/jbrestel/workspaces/src/dataset-curator-functional commit -m "genome-build.js: readGenomeBuild and partitionName shared by trial and functional" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 2: `reportTaxonId`

**Files:**
- Modify: `shared/scripts/genome/assembly-report.js`
- Test: `tests/genome-assembly-report.test.js`

- [ ] **Step 1: Write the failing test**

In `tests/genome-assembly-report.test.js`, replace

```js
import { classifySequence, findReportRow, parseAssemblyReport } from '../shared/scripts/genome/assembly-report.js';
```

with

```js
import { classifySequence, findReportRow, parseAssemblyReport, reportTaxonId } from '../shared/scripts/genome/assembly-report.js';
```

and append:

```js
test('reportTaxonId reads the "# Taxid:" header line', () => {
  assert.equal(reportTaxonId(readFileSync(ECUN_REPORT, 'utf-8')), 284813);
  assert.equal(reportTaxonId('# Assembly name:  X\r\n# Taxid:          5833\r\n'), 5833);
  assert.equal(reportTaxonId('# Assembly name:  X\n# Sequence-Name\tSequence-Role\n'), null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test --test-reporter=dot --test-global-setup=/home/jbrestel/workspaces/src/dataset-curator-functional/tests/globalSetup.js /home/jbrestel/workspaces/src/dataset-curator-functional/tests/genome-assembly-report.test.js /home/jbrestel/workspaces/src/dataset-curator-functional/tests/import-graph.test.js`
Expected: FAIL with `SyntaxError: The requested module ... does not provide an export named 'reportTaxonId'`.

- [ ] **Step 3: Add `reportTaxonId`**

Append to `shared/scripts/genome/assembly-report.js`:

```js
/** The NCBI taxon ID on the report's `# Taxid:` header line, or null. */
export function reportTaxonId(text) {
  const match = text.match(/^# Taxid:\s*(\d+)\s*$/m);
  return match ? Number(match[1]) : null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test --test-reporter=dot --test-global-setup=/home/jbrestel/workspaces/src/dataset-curator-functional/tests/globalSetup.js /home/jbrestel/workspaces/src/dataset-curator-functional/tests/genome-assembly-report.test.js /home/jbrestel/workspaces/src/dataset-curator-functional/tests/import-graph.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git -C /home/jbrestel/workspaces/src/dataset-curator-functional add shared/scripts/genome/assembly-report.js tests/genome-assembly-report.test.js
git -C /home/jbrestel/workspaces/src/dataset-curator-functional commit -m "assembly-report: reportTaxonId reads # Taxid:" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 3: `functional/values.js` and `functional/dbxref-urls.js`

**Files:**
- Create: `shared/scripts/genome/functional/values.js`, `shared/scripts/genome/functional/dbxref-urls.js`
- Test: `tests/genome-functional-values.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/genome-functional-values.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DBXREF_URLS, urlOf } from '../shared/scripts/genome/functional/dbxref-urls.js';
import { attrValues, dbxrefDatasetName, goValues, isEc, parseDbxref, parseGo } from '../shared/scripts/genome/functional/values.js';
import { featureGroups, parseGff } from '../shared/scripts/genome/gff.js';
import { CM, gffLine, gffText } from './genome-helpers.js';

const groupOf = (...lines) => featureGroups(parseGff(gffText(...lines)))[0];

test('attrValues splits on raw commas, then decodes, so an encoded comma stays inside a value', () => {
  const cds = groupOf(gffLine(CM, 'CDS', 1, 9, '+', 'ID=P1;Note=10_0010%2C unknown%2C gene found by Glimmer;product=a,b'));
  assert.deepEqual(attrValues(cds, 'Note'), ['10_0010, unknown, gene found by Glimmer']);
  assert.deepEqual(attrValues(cds, 'product'), ['a', 'b']);
  assert.deepEqual(attrValues(cds, 'gene'), []);
});

test('attrValues reads every line of a feature once, and keeps a decoded tab from breaking a TSV cell', () => {
  const cds = groupOf(
    gffLine(CM, 'CDS', 1, 9, '+', 'ID=P1;product=kinase;Note=tab%09inside'),
    gffLine(CM, 'CDS', 20, 29, '+', 'ID=P1;product=kinase,phosphatase')
  );
  assert.deepEqual(attrValues(cds, 'product'), ['kinase', 'phosphatase']);
  assert.deepEqual(attrValues(cds, 'Note'), ['tab inside']);
});

test('parseGo reads term|GO id|PMIDs|evidence, padding the id and defaulting the evidence to IEA', () => {
  assert.deepEqual(parseGo('ATP binding|0005524|12345678|IEA'), { goId: 'GO:0005524', reference: 'PMID:12345678', evidence: 'IEA' });
  assert.deepEqual(parseGo('translation|6412||'), { goId: 'GO:0006412', reference: '', evidence: 'IEA' });
  assert.deepEqual(parseGo('nucleus|0005634|111,222|IDA'), { goId: 'GO:0005634', reference: 'PMID:111|PMID:222', evidence: 'IDA' });
  for (const bad of ['ATP binding', 'ATP binding|GO:0005524||IEA', 'x|00055241||IEA', 'x|0005524|PMID 1|IEA', 'x|0005524||IDA,broken', 'a|1|2|3|4']) {
    assert.equal(parseGo(bad), null, bad);
  }
});

test('goValues splits terms on raw commas and rejoins a PMID list that a comma split', () => {
  const cds = groupOf(gffLine(CM, 'CDS', 1, 9, '+',
    'ID=P1;go_function=ATP binding|0005524|12345678|IEA,protein kinase activity|0004672|111,222|IDA,broken'));
  const { values, bad } = goValues(cds, 'go_function');
  assert.deepEqual(values.map((v) => [v.goId, v.reference, v.evidence]), [
    ['GO:0005524', 'PMID:12345678', 'IEA'], ['GO:0004672', 'PMID:111|PMID:222', 'IDA']
  ]);
  assert.deepEqual(bad, ['broken']);
});

test('isEc takes four dot-separated numbers, with - for an unknown level', () => {
  for (const ec of ['2.7.11.1', '1.2.3.-', '3.-.-.-']) assert.ok(isEc(ec), ec);
  for (const ec of ['2.7.11', '2.7.11.1.5', 'EC:2.7.11.1', '2.7.11.n1', '']) assert.ok(!isEc(ec), ec);
});

test('parseDbxref splits at the first colon', () => {
  assert.deepEqual(parseDbxref('UniProtKB/Swiss-Prot:Q8ST30'), { prefix: 'UniProtKB/Swiss-Prot', id: 'Q8ST30' });
  assert.deepEqual(parseDbxref('HGNC:HGNC:5'), { prefix: 'HGNC', id: 'HGNC:5' });
  for (const bad of ['Q8ST30', ':Q8ST30', 'InterPro:']) assert.equal(parseDbxref(bad), null, bad);
});

test('dbxrefDatasetName lower-cases the prefix and turns each run of other characters into _', () => {
  assert.equal(dbxrefDatasetName('UniProtKB/Swiss-Prot'), 'uniprotkb_swiss_prot_from_annotation');
  assert.equal(dbxrefDatasetName('InterPro'), 'interpro_from_annotation');
  assert.equal(dbxrefDatasetName('EnsemblGenomes-Gn'), 'ensemblgenomes_gn_from_annotation');
  assert.equal(dbxrefDatasetName('NCBI_GP'), 'ncbi_gp_from_annotation');
});

test('every URL template has one EXTERNAL_ID_HERE, and no two known prefixes share a dataset name', () => {
  for (const [prefix, url] of Object.entries(DBXREF_URLS)) assert.equal(url.split('EXTERNAL_ID_HERE').length, 2, prefix);
  const names = Object.keys(DBXREF_URLS).map(dbxrefDatasetName);
  assert.equal(new Set(names).size, names.length);
  assert.equal(urlOf('InterPro'), 'http://www.ebi.ac.uk/interpro/entry/EXTERNAL_ID_HERE');
  assert.equal(urlOf('EnsemblGenomes-Gn'), null);
  assert.equal(urlOf('constructor'), null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test --test-reporter=dot --test-global-setup=/home/jbrestel/workspaces/src/dataset-curator-functional/tests/globalSetup.js /home/jbrestel/workspaces/src/dataset-curator-functional/tests/genome-functional-values.test.js /home/jbrestel/workspaces/src/dataset-curator-functional/tests/import-graph.test.js`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `functional/dbxref-urls.js`.

- [ ] **Step 3: Write `values.js`**

Create `shared/scripts/genome/functional/values.js`:

```js
import { decode, getValues } from '../gff.js';

export const GO_ASPECTS = Object.freeze({ go_function: 'F', go_process: 'P', go_component: 'C' });
const GO_START = /^[^|]*\|\d+\|/;
const EVIDENCE = /^[A-Z]{2,3}$/;
const EC = /^\d+(?:\.(?:\d+|-)){3}$/;

const cell = (value) => value.replace(/[\t\r\n]+/g, ' ').trim();
const pipes = (text) => text.split('|').length - 1;

/** One attribute's values over a feature's lines, split on raw commas and then decoded, so an encoded %2C stays in its value. */
export function attrValues(group, key) {
  const values = [];
  for (const line of group.lines) {
    for (const raw of getValues(line, key)) {
      const value = cell(decode(raw));
      if (value && !values.includes(value)) values.push(value);
    }
  }
  return values;
}

/** An NCBI go_* value, `term|GO id digits|PMIDs|evidence`, or null when it is not one. */
export function parseGo(raw) {
  const parts = raw.split('|').map((part) => cell(decode(part)));
  if (parts.length !== 4 || !/^\d{1,7}$/.test(parts[1])) return null;
  const pmids = parts[2].split(/[,;\s]+/).filter(Boolean);
  if (pmids.some((pmid) => !/^\d+$/.test(pmid))) return null;
  const evidence = parts[3] || 'IEA';
  if (!EVIDENCE.test(evidence)) return null;
  return { goId: `GO:${parts[1].padStart(7, '0')}`, reference: pmids.map((pmid) => `PMID:${pmid}`).join('|'), evidence };
}

/**
 * A feature's go_* values. A raw comma separates terms but may also sit inside a PMID list, so a piece that does not
 * start a term continues the previous one while that one has fewer than four fields.
 */
export function goValues(group, key) {
  const values = [];
  const bad = [];
  for (const line of group.lines) {
    const pieces = [];
    for (const raw of getValues(line, key)) {
      if (pieces.length && pipes(pieces.at(-1)) < 3 && !GO_START.test(raw)) pieces[pieces.length - 1] += `,${raw}`;
      else pieces.push(raw);
    }
    for (const piece of pieces) {
      const go = parseGo(piece);
      if (go) values.push(go);
      else bad.push(cell(decode(piece)));
    }
  }
  return { values, bad };
}

export const isEc = (value) => EC.test(value);

export function parseDbxref(value) {
  const i = value.indexOf(':');
  return i > 0 && i < value.length - 1 ? { prefix: value.slice(0, i), id: value.slice(i + 1) } : null;
}

export const dbxrefDatasetName = (prefix) => `${prefix.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_from_annotation`;
```

- [ ] **Step 4: Write `dbxref-urls.js`**

Create `shared/scripts/genome/functional/dbxref-urls.js`:

```js
/** URL templates for Dbxref prefixes, as existing VEuPathDatasets dbxref_simple datasets spell them. */
export const DBXREF_URLS = Object.freeze({
  GeneID: 'https://www.ncbi.nlm.nih.gov/gene/?term=EXTERNAL_ID_HERE',
  GOA: 'https://www.ebi.ac.uk/QuickGO/searchproducts/EXTERNAL_ID_HERE',
  InterPro: 'http://www.ebi.ac.uk/interpro/entry/EXTERNAL_ID_HERE',
  NCBI_GP: 'http://www.ncbi.nlm.nih.gov/protein/EXTERNAL_ID_HERE',
  PDB: 'http://www.rcsb.org/structure/EXTERNAL_ID_HERE',
  PMID: 'http://www.ncbi.nlm.nih.gov/pubmed/?term=EXTERNAL_ID_HERE',
  'UniProtKB/Swiss-Prot': 'http://www.uniprot.org/uniprot/EXTERNAL_ID_HERE',
  'UniProtKB/TrEMBL': 'http://www.uniprot.org/uniprot/EXTERNAL_ID_HERE'
});

export const urlOf = (prefix) => (Object.hasOwn(DBXREF_URLS, prefix) ? DBXREF_URLS[prefix] : null);
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test --test-reporter=dot --test-global-setup=/home/jbrestel/workspaces/src/dataset-curator-functional/tests/globalSetup.js /home/jbrestel/workspaces/src/dataset-curator-functional/tests/genome-functional-values.test.js /home/jbrestel/workspaces/src/dataset-curator-functional/tests/import-graph.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```
git -C /home/jbrestel/workspaces/src/dataset-curator-functional add shared/scripts/genome/functional/values.js shared/scripts/genome/functional/dbxref-urls.js tests/genome-functional-values.test.js
git -C /home/jbrestel/workspaces/src/dataset-curator-functional commit -m "Functional: attribute values, go_*, EC, Dbxref parsing and URL templates" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 4: `functional/ids.js`, ID resolution

**Files:**
- Create: `shared/scripts/genome/functional/ids.js`
- Test: `tests/genome-functional-ids.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/genome-functional-ids.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proteinIdOf, resolveFeatures } from '../shared/scripts/genome/functional/ids.js';
import { parseGff } from '../shared/scripts/genome/gff.js';
import { CM, gffLine, gffText } from './genome-helpers.js';

const resolve = (...lines) => resolveFeatures(parseGff(gffText(...lines)));
const summary = (features) => features.map((f) => [f.kind, f.group.id, f.gene, f.transcript, ...(f.kind === 'rna' ? [f.hasCds] : [])]);

test('a CDS resolves to its mRNA and that mRNA\'s gene; its segments are one feature', () => {
  const { features, unresolved, codingTranscripts } = resolve(
    gffLine(CM, 'gene', 100, 900, '+', 'ID=ECU10_0010'),
    gffLine(CM, 'mRNA', 100, 900, '+', 'ID=ECU10_0010_mRNA;Parent=ECU10_0010'),
    gffLine(CM, 'exon', 100, 400, '+', 'ID=ECU10_0010_mRNA_exon1;Parent=ECU10_0010_mRNA'),
    gffLine(CM, 'CDS', 100, 400, '+', 'ID=CAD25721.2;Parent=ECU10_0010_mRNA'),
    gffLine(CM, 'CDS', 600, 900, '+', 'ID=CAD25721.2;Parent=ECU10_0010_mRNA')
  );
  assert.deepEqual(summary(features), [
    ['gene', 'ECU10_0010', 'ECU10_0010', null],
    ['rna', 'ECU10_0010_mRNA', 'ECU10_0010', 'ECU10_0010_mRNA', true],
    ['cds', 'CAD25721.2', 'ECU10_0010', 'ECU10_0010_mRNA']
  ]);
  assert.equal(features[2].group.lines.length, 2);
  assert.deepEqual(unresolved, []);
  assert.deepEqual(codingTranscripts, ['ECU10_0010_mRNA']);
});

test('an ncRNA without a CDS is a transcript of its gene, and a pseudogene is a gene', () => {
  const { features, codingTranscripts } = resolve(
    gffLine(CM, 'gene', 1000, 1072, '+', 'ID=gene_CM000001.1_1000_1072'),
    gffLine(CM, 'snRNA', 1000, 1072, '+', 'ID=rna_CM000001.1_1000_1072_snRNA;Parent=gene_CM000001.1_1000_1072;product=U4 snRNA'),
    gffLine(CM, 'pseudogene', 2000, 2300, '+', 'ID=PSG1'),
    gffLine(CM, 'pseudogenic_transcript', 2000, 2300, '+', 'ID=PSG1_t;Parent=PSG1')
  );
  assert.deepEqual(summary(features), [
    ['gene', 'gene_CM000001.1_1000_1072', 'gene_CM000001.1_1000_1072', null],
    ['rna', 'rna_CM000001.1_1000_1072_snRNA', 'gene_CM000001.1_1000_1072', 'rna_CM000001.1_1000_1072_snRNA', false],
    ['gene', 'PSG1', 'PSG1', null],
    ['rna', 'PSG1_t', 'PSG1', 'PSG1_t', false]
  ]);
  assert.deepEqual(codingTranscripts, []);
});

test('an RNA or CDS whose Parent chain reaches no gene is unresolved, labelled by ID or span', () => {
  const { features, unresolved } = resolve(
    gffLine(CM, 'gene', 1, 99, '+', 'ID=G1'),
    gffLine(CM, 'tRNA', 100, 172, '+', 'ID=rna-orphan'),
    gffLine(CM, 'CDS', 200, 300, '+', 'ID=P2;Parent=missing_mRNA'),
    gffLine(CM, 'CDS', 10, 20, '+', 'Parent=missing_mRNA'),
    gffLine(CM, 'CDS', 50, 60, '+', 'ID=P3;Parent=G1')
  );
  assert.deepEqual(unresolved, ['rna-orphan', 'P2', 'CM000001.1:10..20', 'P3']);
  assert.deepEqual(summary(features), [['gene', 'G1', 'G1', null]]);
});

test('a CDS under two transcripts belongs to each', () => {
  const { features, codingTranscripts } = resolve(
    gffLine(CM, 'gene', 1, 900, '+', 'ID=G1'),
    gffLine(CM, 'mRNA', 1, 900, '+', 'ID=T1;Parent=G1'),
    gffLine(CM, 'mRNA', 1, 900, '+', 'ID=T2;Parent=G1'),
    gffLine(CM, 'CDS', 1, 900, '+', 'ID=P1;Parent=T1,T2')
  );
  assert.deepEqual(summary(features).slice(3), [['cds', 'P1', 'G1', 'T1'], ['cds', 'P1', 'G1', 'T2']]);
  assert.deepEqual(codingTranscripts, ['T1', 'T2']);
});

test('proteinIdOf follows GusSkeletonMaker: the transcript ID and -p1', () => {
  assert.equal(proteinIdOf('ECU10_0010_mRNA'), 'ECU10_0010_mRNA-p1');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test --test-reporter=dot --test-global-setup=/home/jbrestel/workspaces/src/dataset-curator-functional/tests/globalSetup.js /home/jbrestel/workspaces/src/dataset-curator-functional/tests/genome-functional-ids.test.js /home/jbrestel/workspaces/src/dataset-curator-functional/tests/import-graph.test.js`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `functional/ids.js`.

- [ ] **Step 3: Write `ids.js`**

Create `shared/scripts/genome/functional/ids.js`:

```js
import { levelOf } from '../feature-types.js';
import { featureGroups, parentsOf, spanLabel } from '../gff.js';

/** GusSkeletonMaker names translations `<transcript>-p<n>`; ISF makes one per transcript. */
export const proteinIdOf = (transcriptId) => `${transcriptId}-p1`;
const labelOf = (group) => group.id ?? spanLabel(group.lines[0]);

/**
 * The genes, RNAs and CDSs of one GFF3 with the gene and transcript IDs ISF loads them under, found through Parent.
 * A CDS under several transcripts appears once for each.
 */
export function resolveFeatures(graph) {
  const groups = featureGroups(graph);
  const ofLevel = (level) => new Map(groups.filter((g) => g.id !== null && levelOf(g.type) === level).map((g) => [g.id, g]));
  const genes = ofLevel('gene');
  const transcripts = ofLevel('transcript');
  const geneOf = (rna) => parentsOf(rna.lines[0]).find((p) => genes.has(p)) ?? null;
  const features = [];
  const unresolved = [];
  for (const group of groups) {
    const level = levelOf(group.type);
    if (level === 'gene' && group.id !== null) {
      features.push({ kind: 'gene', group, gene: group.id, transcript: null });
    } else if (level === 'transcript') {
      const gene = group.id === null ? null : geneOf(group);
      if (gene === null) unresolved.push(labelOf(group));
      else features.push({ kind: 'rna', group, gene, transcript: group.id, hasCds: false });
    } else if (group.type === 'CDS') {
      const owners = parentsOf(group.lines[0]).filter((p) => transcripts.has(p))
        .map((transcript) => ({ gene: geneOf(transcripts.get(transcript)), transcript })).filter((o) => o.gene !== null);
      if (!owners.length) unresolved.push(labelOf(group));
      for (const owner of owners) features.push({ kind: 'cds', group, ...owner });
    }
  }
  const coding = new Set(features.filter((f) => f.kind === 'cds').map((f) => f.transcript));
  for (const f of features) if (f.kind === 'rna') f.hasCds = coding.has(f.transcript);
  return { features, unresolved, codingTranscripts: [...coding] };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test --test-reporter=dot --test-global-setup=/home/jbrestel/workspaces/src/dataset-curator-functional/tests/globalSetup.js /home/jbrestel/workspaces/src/dataset-curator-functional/tests/genome-functional-ids.test.js /home/jbrestel/workspaces/src/dataset-curator-functional/tests/import-graph.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git -C /home/jbrestel/workspaces/src/dataset-curator-functional add shared/scripts/genome/functional/ids.js tests/genome-functional-ids.test.js
git -C /home/jbrestel/workspaces/src/dataset-curator-functional commit -m "Functional: resolve genes, transcripts and CDSs to ISF's IDs" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 5: `functional/classes.js`, the table and the engine

This task writes the engine and the six plain rows; Task 6 adds `dbxref_simple`, GO and EC.

**Files:**
- Create: `shared/scripts/genome/functional/classes.js`
- Test: `tests/genome-functional-classes.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/genome-functional-classes.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractDatasets, fileText, uniqueSorted } from '../shared/scripts/genome/functional/classes.js';
import { resolveFeatures } from '../shared/scripts/genome/functional/ids.js';
import { parseGff } from '../shared/scripts/genome/gff.js';
import { CM, gffLine, gffText } from './genome-helpers.js';

const CTX = { source: 'GenBank', taxonId: 284813, date: '20261104' };
const extract = (...lines) => {
  const { features, codingTranscripts } = resolveFeatures(parseGff(gffText(...lines)));
  return extractDatasets(features, { source: 'GenBank', codingTranscripts });
};
const dataset = (result, datasetClass, name) => result.datasets.find((d) => d.datasetClass === datasetClass && d.name === name);
const text = (result, datasetClass, name) => fileText(dataset(result, datasetClass, name), CTX);
const checks = (result) => result.findings.map((f) => [f.severity, f.check, f.count, f.sample]);

const codingGene = (id, { gene = '', rna = '', cds = '' } = {}) => [
  gffLine(CM, 'gene', 100, 900, '+', `ID=${id}${gene}`),
  gffLine(CM, 'mRNA', 100, 900, '+', `ID=${id}_mRNA;Parent=${id}${rna}`),
  gffLine(CM, 'exon', 100, 900, '+', `ID=${id}_mRNA_exon1;Parent=${id}_mRNA`),
  gffLine(CM, 'CDS', 100, 900, '+', `ID=${id}.p;Parent=${id}_mRNA${cds}`)
];
const trnaGene = (id, rna) => [
  gffLine(CM, 'gene', 1000, 1072, '+', `ID=${id}`),
  gffLine(CM, 'tRNA', 1000, 1072, '+', `ID=rna-${id};Parent=${id}${rna}`)
];

test('uniqueSorted drops repeated rows and orders by code unit, ID first', () => {
  assert.deepEqual(uniqueSorted([['b', 'x'], ['a', 'z'], ['b', 'x'], ['a', 'Z'], ['B', 'y']]), [['B', 'y'], ['a', 'Z'], ['a', 'z'], ['b', 'x']]);
});

test('productNames reads product from the CDS, and from an RNA that has no CDS', () => {
  const r = extract(
    ...codingGene('ECU10_0010', { rna: ';product=ignored mRNA product', cds: ';product=hypothetical protein' }),
    ...trnaGene('ECU10_0155', ';product=tRNA-Asn')
  );
  assert.equal(text(r, 'productNames', 'GenBank'), 'ECU10_0010_mRNA\thypothetical protein\t1\nrna-ECU10_0155\ttRNA-Asn\t1\n');
  assert.equal(dataset(r, 'productNames', 'GenBank').level, 'transcript');
  assert.equal(dataset(r, 'productNames', 'GenBank').file, 'products.txt');
});

test('is_preferred marks the first product in GFF order, then rows sort by ID and product', () => {
  const r = extract(
    ...codingGene('B_0020', { cds: ';product=zinc finger%2C C2H2 type,DNA binding protein' }),
    ...codingGene('A_0010', { cds: ';product=kinase' })
  );
  assert.equal(text(r, 'productNames', 'GenBank'),
    'A_0010_mRNA\tkinase\t1\nB_0020_mRNA\tDNA binding protein\t0\nB_0020_mRNA\tzinc finger, C2H2 type\t1\n');
  assert.deepEqual(checks(r).filter(([, check]) => check === 'multipleProducts'), [['info', 'multipleProducts', 1, ['B_0020_mRNA']]]);
});

test('a coding transcript with no product is a noProducts error; an RNA without one is not', () => {
  const r = extract(...codingGene('ECU10_0010', { cds: ';product=kinase' }), ...codingGene('ECU10_0020'), ...trnaGene('ECU10_0155', ''));
  assert.deepEqual(checks(r).filter(([severity]) => severity === 'error'), [['error', 'noProducts', 1, ['ECU10_0020_mRNA']]]);
});

test('geneName keeps the gene feature\'s own name, skips one equal to its ID or a locus_tag, and warns when its features disagree', () => {
  const r = extract(
    ...codingGene('ECU10_0010', { gene: ';gene=ECU10_0010', cds: ';gene=ECU10_0010;product=p' }),
    gffLine(CM, 'gene', 53670, 53750, '-', 'ID=ECU11_0375_2;gene=ECU11_0375'),
    gffLine(CM, 'tRNA', 53670, 53750, '-', 'ID=rna-ECU11_0375;Parent=ECU11_0375_2;gene=ECU11_0375;product=tRNA-Leu'),
    ...codingGene('TST_0030', { gene: ';gene=tstC;locus_tag=TST_0030', cds: ';gene=tstC2;product=p' }),
    ...codingGene('TST_0040', { gene: ';gene=TST_0040x;locus_tag=TST_0040x', cds: ';product=p' }),
    ...codingGene('TST_0050', { cds: ';gene=tstE;product=p' })
  );
  assert.equal(text(r, 'geneName', 'GenBank'), 'ECU11_0375_2\tECU11_0375\nTST_0030\ttstC\nTST_0050\ttstE\n');
  assert.deepEqual(checks(r).filter(([, check]) => check === 'geneNameConflict'), [['warning', 'geneNameConflict', 1, ['TST_0030']]]);
});

test('comments: Notes on RNAs and CDSs go to transcripts, Notes on genes to genes', () => {
  const r = extract(
    ...codingGene('ECU10_0010', { gene: ';Note=gene note', cds: ';Note=10_0010%2C unknown%2C gene found by Glimmer;product=p' }),
    ...trnaGene('ECU10_0155', ';Note=tRNA found by tRNAscan-SE;product=tRNA-Asn')
  );
  assert.equal(text(r, 'comments', 'GenBank_transcript'),
    'ECU10_0010_mRNA\t10_0010, unknown, gene found by Glimmer\nrna-ECU10_0155\ttRNA found by tRNAscan-SE\n');
  assert.equal(text(r, 'comments', 'GenBank_gene'), 'ECU10_0010\tgene note\n');
});

test('aliases take protein_id per transcript; dbxref_synonym takes gene_synonym per gene', () => {
  const r = extract(...codingGene('ECU10_0010', { gene: ';gene_synonym=ecuA,ecu-a', cds: ';product=p;protein_id=CAD25721.2' }));
  assert.equal(text(r, 'aliases', 'gbProteinId'), 'ECU10_0010_mRNA\tCAD25721.2\n');
  assert.equal(text(r, 'dbxref_synonym', 'GenBank'), 'ECU10_0010\tecu-a\nECU10_0010\tecuA\n');
});

test('a dataset with no rows is left out and named in one emptyClass info finding', () => {
  const r = extract(...codingGene('ECU10_0010', { cds: ';product=p' }));
  assert.deepEqual(r.datasets.map((d) => `${d.datasetClass}/${d.name}`), ['productNames/GenBank']);
  assert.deepEqual(checks(r), [['info', 'emptyClass', 5,
    ['geneName/GenBank', 'comments/GenBank_transcript', 'comments/GenBank_gene', 'aliases/gbProteinId', 'dbxref_synonym/GenBank']]]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test --test-reporter=dot --test-global-setup=/home/jbrestel/workspaces/src/dataset-curator-functional/tests/globalSetup.js /home/jbrestel/workspaces/src/dataset-curator-functional/tests/genome-functional-classes.test.js /home/jbrestel/workspaces/src/dataset-curator-functional/tests/import-graph.test.js`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `functional/classes.js`.

- [ ] **Step 3: Write `classes.js`**

Create `shared/scripts/genome/functional/classes.js`:

```js
import { finding } from '../checks.js';
import { attrValues } from './values.js';

const GENE = (f) => f.kind === 'gene';
const RNA = (f) => f.kind === 'rna';
const CDS = (f) => f.kind === 'cds';
const RNA_WITHOUT_CDS = (f) => RNA(f) && !f.hasCds;
const anyOf = (...kinds) => (f) => kinds.some((kind) => kind(f));
const ID_AT = { gene: (f) => f.gene, transcript: (f) => f.transcript };

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Rows unique per (ID, value), sorted by ID, then value, by code unit, so a rerun writes the same bytes. */
export function uniqueSorted(rows) {
  const unique = new Map(rows.map((row) => [row.join('\t'), row]));
  return [...unique.values()].sort((a, b) => compare(a[0], b[0]) || compare(a.slice(1).join('\t'), b.slice(1).join('\t')));
}

function plainColumns(feature, key) {
  return { values: attrValues(feature.group, key).map((value) => ({ cols: [value] })), bad: [] };
}

function single(found, ctx, spec) {
  return { datasets: [{ name: spec.name(ctx.source), props: {}, rows: uniqueSorted(found.map((o) => [o.id, ...o.cols])) }], findings: [] };
}

/** is_preferred is set from GFF order before the rows are sorted: 1 for a transcript's first product, 0 for the rest. */
function products(found, ctx, spec) {
  const byTranscript = new Map();
  for (const { id, cols: [product] } of found) {
    const list = byTranscript.get(id) ?? [];
    if (!list.includes(product)) list.push(product);
    byTranscript.set(id, list);
  }
  const rows = [...byTranscript].flatMap(([id, list]) => list.map((product, i) => [id, product, i === 0 ? '1' : '0']));
  return {
    datasets: [{ name: spec.name(ctx.source), props: {}, rows: uniqueSorted(rows) }],
    findings: [
      finding('functional', 'noProducts', 'error', ctx.codingTranscripts.filter((t) => !byTranscript.has(t)),
        'coding transcripts with no product; productNames needs one for each'),
      finding('functional', 'multipleProducts', 'info', [...byTranscript].filter(([, list]) => list.length > 1).map(([id]) => id),
        'transcripts with more than one product; the first in GFF order is preferred')
    ]
  };
}

/** One name per gene: the gene feature's own `gene`, else the first its RNAs or CDSs carry; none when that is the ID or a locus_tag. */
function geneNames(found, ctx, spec) {
  const byGene = new Map();
  for (const { id, cols: [name], feature } of found) {
    const entry = byGene.get(id) ?? { names: [], own: null, locusTags: new Set() };
    if (!entry.names.includes(name)) entry.names.push(name);
    if (feature.kind === 'gene' && entry.own === null) entry.own = name;
    for (const tag of attrValues(feature.group, 'locus_tag')) entry.locusTags.add(tag);
    byGene.set(id, entry);
  }
  const rows = [];
  for (const [id, { names, own, locusTags }] of byGene) {
    const name = own ?? names[0];
    if (name !== id && !locusTags.has(name)) rows.push([id, name]);
  }
  const conflicts = [...byGene].filter(([, entry]) => entry.names.length > 1).map(([id]) => id);
  return {
    datasets: [{ name: spec.name(ctx.source), props: {}, rows: uniqueSorted(rows) }],
    findings: [finding('functional', 'geneNameConflict', 'warning', conflicts, "genes whose features disagree on gene; the gene feature's value is kept")]
  };
}

/** The extraction table: per dataset, the attributes it reads, the features it reads them from, the ID level and the file. */
export const DATASETS = Object.freeze([
  { datasetClass: 'productNames', name: (source) => source, keys: ['product'], from: anyOf(CDS, RNA_WITHOUT_CDS), level: 'transcript', file: 'products.txt', finish: products },
  { datasetClass: 'geneName', name: (source) => source, keys: ['gene'], from: anyOf(GENE, RNA, CDS), level: 'gene', file: 'geneName.txt', finish: geneNames },
  { datasetClass: 'comments', name: (source) => `${source}_transcript`, keys: ['Note'], from: anyOf(RNA, CDS), level: 'transcript', file: 'comments.txt' },
  { datasetClass: 'comments', name: (source) => `${source}_gene`, keys: ['Note'], from: GENE, level: 'gene', file: 'comments.txt' },
  { datasetClass: 'aliases', name: () => 'gbProteinId', keys: ['protein_id'], from: CDS, level: 'transcript', file: 'aliases.txt' },
  { datasetClass: 'dbxref_synonym', name: (source) => source, keys: ['gene_synonym'], from: GENE, level: 'gene', file: 'synonyms.txt' }
]);

function occurrences(spec, features) {
  const columns = spec.columns ?? plainColumns;
  const found = [];
  const bad = [];
  for (const feature of features) {
    if (!spec.from(feature)) continue;
    const id = ID_AT[spec.level](feature);
    for (const key of spec.keys) {
      const read = columns(feature, key);
      for (const value of read.values) found.push({ id, cols: value.cols, prefix: value.prefix ?? null, feature });
      for (const value of read.bad) bad.push(`${id}: ${value}`);
    }
  }
  return { found, bad };
}

/** Every dataset of the table with its rows, and the findings; a dataset without rows is left out and named in emptyClass. */
export function extractDatasets(features, { source, codingTranscripts }) {
  const ctx = { source, codingTranscripts };
  const datasets = [];
  const findings = [];
  const empty = [];
  for (const spec of DATASETS) {
    const { found, bad } = occurrences(spec, features);
    if (spec.badCheck) findings.push(finding('functional', spec.badCheck.check, 'warning', bad, spec.badCheck.message));
    const made = (spec.finish ?? single)(found, ctx, spec);
    findings.push(...made.findings);
    if (!made.datasets.length) empty.push(spec.datasetClass);
    for (const d of made.datasets) {
      if (d.rows.length) datasets.push({ datasetClass: spec.datasetClass, level: spec.level, file: spec.file, format: spec.format ?? null, ...d });
      else empty.push(`${spec.datasetClass}/${d.name}`);
    }
  }
  findings.push(finding('functional', 'emptyClass', 'info', empty, 'datasets with no rows; no file is written for them'));
  return { datasets, findings: findings.filter((f) => f.count) };
}

/** A dataset's file: tab-separated lines, no header, LF. */
export function fileText(dataset, ctx) {
  return `${dataset.rows.map((row) => (dataset.format ? dataset.format(row, ctx) : row).join('\t')).join('\n')}\n`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test --test-reporter=dot --test-global-setup=/home/jbrestel/workspaces/src/dataset-curator-functional/tests/globalSetup.js /home/jbrestel/workspaces/src/dataset-curator-functional/tests/genome-functional-classes.test.js /home/jbrestel/workspaces/src/dataset-curator-functional/tests/import-graph.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git -C /home/jbrestel/workspaces/src/dataset-curator-functional add shared/scripts/genome/functional/classes.js tests/genome-functional-classes.test.js
git -C /home/jbrestel/workspaces/src/dataset-curator-functional commit -m "Functional: extraction table and engine for products, gene names, comments, aliases, synonyms" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 6: `dbxref_simple`, GO and EC rows, then the mid-plan checkpoint

**Files:**
- Modify: `shared/scripts/genome/functional/classes.js`
- Test: `tests/genome-functional-classes.test.js`

- [ ] **Step 1: Write the failing tests**

In `tests/genome-functional-classes.test.js`, replace

```js
  assert.deepEqual(checks(r), [['info', 'emptyClass', 5,
    ['geneName/GenBank', 'comments/GenBank_transcript', 'comments/GenBank_gene', 'aliases/gbProteinId', 'dbxref_synonym/GenBank']]]);
```

with

```js
  assert.deepEqual(checks(r), [['info', 'emptyClass', 8, [
    'geneName/GenBank', 'comments/GenBank_transcript', 'comments/GenBank_gene', 'aliases/gbProteinId', 'dbxref_synonym/GenBank',
    'dbxref_simple', 'GeneOntologyAssociations/GenBank', 'EnzymeCommissionAssociations/GenBank'
  ]]]);
```

and append:

```js
const geneFeature = (url) => ({ url, target: 'NAFeature', viewName: 'GeneFeature' });

test('dbxref_simple makes one gene-level dataset per prefix, from genes, RNAs and CDSs', () => {
  const r = extract(...codingGene('ECU10_0010', {
    gene: ';Dbxref=GeneID:1001',
    rna: ';Dbxref=GeneID:1001',
    cds: ';Dbxref=EnsemblGenomes-Gn:CAD25721,InterPro:IPR011667,UniProtKB/Swiss-Prot:Q8ST30,NCBI_GP:CAD25721.2,InterPro:IPR000001;product=p'
  }));
  assert.deepEqual(r.datasets.filter((d) => d.datasetClass === 'dbxref_simple').map((d) => [d.name, d.level, d.file, d.props]), [
    ['ensemblgenomes_gn_from_annotation', 'gene', 'mapping.txt', { prefix: 'EnsemblGenomes-Gn', ...geneFeature(null) }],
    ['geneid_from_annotation', 'gene', 'mapping.txt', { prefix: 'GeneID', ...geneFeature('https://www.ncbi.nlm.nih.gov/gene/?term=EXTERNAL_ID_HERE') }],
    ['interpro_from_annotation', 'gene', 'mapping.txt', { prefix: 'InterPro', ...geneFeature('http://www.ebi.ac.uk/interpro/entry/EXTERNAL_ID_HERE') }],
    ['ncbi_gp_from_annotation', 'gene', 'mapping.txt', { prefix: 'NCBI_GP', ...geneFeature('http://www.ncbi.nlm.nih.gov/protein/EXTERNAL_ID_HERE') }],
    ['uniprotkb_swiss_prot_from_annotation', 'gene', 'mapping.txt', { prefix: 'UniProtKB/Swiss-Prot', ...geneFeature('http://www.uniprot.org/uniprot/EXTERNAL_ID_HERE') }]
  ]);
  assert.equal(text(r, 'dbxref_simple', 'geneid_from_annotation'), 'ECU10_0010\t1001\n');
  assert.equal(text(r, 'dbxref_simple', 'interpro_from_annotation'), 'ECU10_0010\tIPR000001\nECU10_0010\tIPR011667\n');
  assert.deepEqual(checks(r).filter(([severity]) => severity === 'warning'), [['warning', 'unknownDbxrefPrefix', 1, ['EnsemblGenomes-Gn']]]);
});

test('prefixes that give one dataset name are a dbxrefNameClash error and are not written; a value with no prefix is badDbxref', () => {
  const r = extract(...codingGene('ECU10_0010', { cds: ';Dbxref=Uni-Prot:Q1,Uni_Prot:Q2,InterPro:IPR1,Q8ST30;product=p' }));
  assert.deepEqual(r.datasets.filter((d) => d.datasetClass === 'dbxref_simple').map((d) => d.name), ['interpro_from_annotation']);
  const clash = r.findings.find((f) => f.check === 'dbxrefNameClash');
  assert.deepEqual([clash.severity, clash.sample], ['error', ['uni_prot_from_annotation']]);
  assert.match(clash.message, /uni_prot_from_annotation ← Uni-Prot and Uni_Prot/);
  assert.deepEqual(checks(r).filter(([, check]) => check === 'badDbxref'), [['warning', 'badDbxref', 1, ['ECU10_0010: Q8ST30']]]);
});

test('GeneOntologyAssociations writes GAF 2.2 lines per transcript from go_function, go_process and go_component', () => {
  const r = extract(...codingGene('XP_0010', {
    cds: ';go_function=ATP binding|0005524|12345678|IEA;go_process=translation|0006412||;go_component=nucleus|0005634|111,222|IDA,broken;product=p'
  }));
  const gaf = (goId, reference, evidence, aspect) =>
    ['GenBank', 'XP_0010_mRNA', 'XP_0010_mRNA', '', goId, reference, evidence, '', aspect, '', '', 'transcript', 'taxon:284813', '20261104', 'GenBank', '', ''].join('\t');
  assert.equal(text(r, 'GeneOntologyAssociations', 'GenBank'), [
    gaf('GO:0005524', 'PMID:12345678', 'IEA', 'F'),
    gaf('GO:0005634', 'PMID:111|PMID:222', 'IDA', 'C'),
    gaf('GO:0006412', '', 'IEA', 'P')
  ].map((line) => `${line}\n`).join(''));
  assert.equal(dataset(r, 'GeneOntologyAssociations', 'GenBank').file, 'associations.gas');
  assert.deepEqual(checks(r).filter(([, check]) => check === 'badGo'), [['warning', 'badGo', 1, ['XP_0010_mRNA: broken']]]);
});

test('EnzymeCommissionAssociations maps each EC_number on a CDS to the protein ID, keeping partial ECs', () => {
  const r = extract(...codingGene('XP_0010', { cds: ';EC_number=2.7.11.1,1.2.3.-,2.7.11;product=p' }));
  assert.equal(text(r, 'EnzymeCommissionAssociations', 'GenBank'), 'XP_0010_mRNA-p1\t1.2.3.-\nXP_0010_mRNA-p1\t2.7.11.1\n');
  assert.equal(dataset(r, 'EnzymeCommissionAssociations', 'GenBank').level, 'protein');
  assert.deepEqual(checks(r).filter(([, check]) => check === 'badEc'), [['warning', 'badEc', 1, ['XP_0010_mRNA-p1: 2.7.11']]]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test --test-reporter=dot --test-global-setup=/home/jbrestel/workspaces/src/dataset-curator-functional/tests/globalSetup.js /home/jbrestel/workspaces/src/dataset-curator-functional/tests/genome-functional-classes.test.js /home/jbrestel/workspaces/src/dataset-curator-functional/tests/import-graph.test.js`
Expected: FAIL: the emptyClass test lists 5 datasets, not 8, and the four new tests find no `dbxref_simple`, GO or EC datasets.

- [ ] **Step 3: Add the three rows**

In `shared/scripts/genome/functional/classes.js`, replace

```js
import { finding } from '../checks.js';
import { attrValues } from './values.js';
```

with

```js
import { finding } from '../checks.js';
import { urlOf } from './dbxref-urls.js';
import { proteinIdOf } from './ids.js';
import { attrValues, dbxrefDatasetName, GO_ASPECTS, goValues, isEc, parseDbxref } from './values.js';
```

Replace

```js
const ID_AT = { gene: (f) => f.gene, transcript: (f) => f.transcript };
```

with

```js
const ID_AT = { gene: (f) => f.gene, transcript: (f) => f.transcript, protein: (f) => proteinIdOf(f.transcript) };
```

Replace

```js
/** The extraction table: per dataset, the attributes it reads, the features it reads them from, the ID level and the file. */
```

with

```js
function dbxrefColumns(feature, key) {
  const values = [];
  const bad = [];
  for (const value of attrValues(feature.group, key)) {
    const ref = parseDbxref(value);
    if (ref) values.push({ cols: [ref.id], prefix: ref.prefix });
    else bad.push(value);
  }
  return { values, bad };
}

function goColumns(feature, key) {
  const { values, bad } = goValues(feature.group, key);
  return { values: values.map((go) => ({ cols: [go.goId, go.reference, go.evidence, GO_ASPECTS[key]] })), bad };
}

function ecColumns(feature, key) {
  const values = attrValues(feature.group, key);
  return { values: values.filter(isEc).map((ec) => ({ cols: [ec] })), bad: values.filter((ec) => !isEc(ec)) };
}

/** One dataset per Dbxref prefix. Prefixes that sanitize to one name would share a directory, so they are left out. */
function dbxrefDatasets(found) {
  const byPrefix = new Map();
  for (const { id, cols: [value], prefix } of found) {
    if (!byPrefix.has(prefix)) byPrefix.set(prefix, []);
    byPrefix.get(prefix).push([id, value]);
  }
  const prefixesOf = new Map();
  for (const prefix of byPrefix.keys()) {
    const name = dbxrefDatasetName(prefix);
    prefixesOf.set(name, [...(prefixesOf.get(name) ?? []), prefix]);
  }
  const clashes = [...prefixesOf].filter(([, prefixes]) => prefixes.length > 1);
  const datasets = [...prefixesOf].filter(([, prefixes]) => prefixes.length === 1)
    .map(([name, [prefix]]) => ({
      name, props: { prefix, url: urlOf(prefix), target: 'NAFeature', viewName: 'GeneFeature' }, rows: uniqueSorted(byPrefix.get(prefix))
    }))
    .sort((a, b) => compare(a.name, b.name));
  return {
    datasets,
    findings: [
      finding('functional', 'dbxrefNameClash', 'error', clashes.map(([name]) => name),
        `Dbxref prefixes that give one dataset name: ${clashes.map(([name, prefixes]) => `${name} ← ${prefixes.join(' and ')}`).join('; ')}`),
      finding('functional', 'unknownDbxrefPrefix', 'warning', datasets.filter((d) => d.props.url === null).map((d) => d.props.prefix),
        'Dbxref prefixes with no URL template in functional/dbxref-urls.js; their datasets get url null')
    ]
  };
}

function gafLine([id, goId, reference, evidence, aspect], { source, taxonId, date }) {
  return [source, id, id, '', goId, reference, evidence, '', aspect, '', '', 'transcript', `taxon:${taxonId}`, date, source, '', ''];
}

/** The extraction table: per dataset, the attributes it reads, the features it reads them from, the ID level and the file. */
```

Replace

```js
  { datasetClass: 'dbxref_synonym', name: (source) => source, keys: ['gene_synonym'], from: GENE, level: 'gene', file: 'synonyms.txt' }
]);
```

with

```js
  { datasetClass: 'dbxref_synonym', name: (source) => source, keys: ['gene_synonym'], from: GENE, level: 'gene', file: 'synonyms.txt' },
  {
    datasetClass: 'dbxref_simple', name: null, keys: ['Dbxref'], from: anyOf(GENE, RNA, CDS), level: 'gene', file: 'mapping.txt',
    columns: dbxrefColumns, finish: dbxrefDatasets, badCheck: { check: 'badDbxref', message: 'Dbxref values with no "prefix:" part; they are skipped' }
  },
  {
    datasetClass: 'GeneOntologyAssociations', name: (source) => source, keys: Object.keys(GO_ASPECTS), from: anyOf(RNA, CDS), level: 'transcript',
    file: 'associations.gas', columns: goColumns, format: gafLine,
    badCheck: { check: 'badGo', message: 'go_* values that are not term|GO id|PMIDs|evidence; they are skipped' }
  },
  {
    datasetClass: 'EnzymeCommissionAssociations', name: (source) => source, keys: ['EC_number'], from: CDS, level: 'protein', file: 'ec.txt',
    columns: ecColumns, badCheck: { check: 'badEc', message: 'EC_number values that are not four dot-separated numbers or -; they are skipped' }
  }
]);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test --test-reporter=dot --test-global-setup=/home/jbrestel/workspaces/src/dataset-curator-functional/tests/globalSetup.js /home/jbrestel/workspaces/src/dataset-curator-functional/tests/genome-functional-classes.test.js /home/jbrestel/workspaces/src/dataset-curator-functional/tests/import-graph.test.js`
Expected: PASS.

- [ ] **Step 5: Mid-plan checkpoint: full suite**

Run: `node --test --test-reporter=dot --test-global-setup=/home/jbrestel/workspaces/src/dataset-curator-functional/tests/globalSetup.js /home/jbrestel/workspaces/src/dataset-curator-functional/tests/*.test.js`
Expected: PASS, with skips only where `perl` or `APICOMMONDATA_DIR` is missing.

- [ ] **Step 6: Commit**

```
git -C /home/jbrestel/workspaces/src/dataset-curator-functional add shared/scripts/genome/functional/classes.js tests/genome-functional-classes.test.js
git -C /home/jbrestel/workspaces/src/dataset-curator-functional commit -m "Functional: dbxref_simple per prefix, GO as GAF 2.2, EC by protein" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 7: `functional/record.js`, the `functional.json` contract

**Files:**
- Create: `shared/scripts/genome/functional/record.js`
- Test: `tests/genome-functional-record.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/genome-functional-record.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import {
  FUNCTION_DIR, FUNCTIONAL_SCHEMA_VERSION, functionalPaths, newFunctionalRecord, readFunctionalRecord
} from '../shared/scripts/genome/functional/record.js';
import { GENERATOR } from '../shared/scripts/genome/record.js';
import { PipelineError, writeJsonAtomic } from '../shared/scripts/genome/workdir.js';
import { tempDir } from './genome-helpers.js';

const PROPS = { prefix: 'InterPro', url: 'http://www.ebi.ac.uk/interpro/entry/EXTERNAL_ID_HERE', target: 'NAFeature', viewName: 'GeneFeature' };
const DATASET = {
  datasetClass: 'dbxref_simple', name: 'interpro_from_annotation', file: 'mapping.txt', level: 'gene', format: null, sha256: 'abc', props: PROPS,
  rows: [['G1', 'IPR1'], ['G1', 'IPR2'], ['G2', 'IPR1']], text: 'G1\tIPR1\nG1\tIPR2\nG2\tIPR1\n'
};

test('newFunctionalRecord lists each dataset with its file, row count, digest and distinct IDs', () => {
  assert.equal(FUNCTIONAL_SCHEMA_VERSION, 1);
  assert.deepEqual(newFunctionalRecord({ genomeBuildSha256: 'gb', source: 'GenBank', datasets: [DATASET], findings: [] }), {
    schemaVersion: 1,
    generator: { ...GENERATOR },
    genomeBuild: { sha256: 'gb' },
    source: 'GenBank',
    datasets: [{
      datasetClass: 'dbxref_simple', name: 'interpro_from_annotation', file: 'final/function/dbxref_simple/interpro_from_annotation/mapping.txt',
      rows: 3, sha256: 'abc', ids: { level: 'gene', count: 2 }, props: PROPS
    }],
    findings: []
  });
});

test('functionalPaths puts the files under final/function and the record beside genome-build.json', () => {
  assert.equal(FUNCTION_DIR, 'final/function');
  assert.deepEqual(functionalPaths('/w'), {
    functionDir: join('/w', 'final/function'), stagedDir: join('/w', 'final/function.tmp'), functionalJson: join('/w', 'functional.json')
  });
});

test('readFunctionalRecord returns the record and refuses a missing, other-version or incomplete one', () => {
  const workDir = tempDir('functional-record-');
  const path = functionalPaths(workDir).functionalJson;
  assert.throws(() => readFunctionalRecord(workDir, 'verify'),
    (e) => e instanceof PipelineError && e.command === 'verify' && e.problem === 'is missing' && e.next === 'run functional');
  const record = newFunctionalRecord({ genomeBuildSha256: 'gb', source: 'GenBank', datasets: [DATASET], findings: [] });
  writeJsonAtomic(path, record);
  assert.deepEqual(readFunctionalRecord(workDir, 'verify'), record);
  writeJsonAtomic(path, { ...record, schemaVersion: 2 });
  assert.throws(() => readFunctionalRecord(workDir, 'verify'), /has schemaVersion 2, not 1\nNext: run functional again/);
  writeJsonAtomic(path, { ...record, datasets: undefined });
  assert.throws(() => readFunctionalRecord(workDir, 'verify'), /is incomplete: it needs genomeBuild\.sha256, source, datasets and findings/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test --test-reporter=dot --test-global-setup=/home/jbrestel/workspaces/src/dataset-curator-functional/tests/globalSetup.js /home/jbrestel/workspaces/src/dataset-curator-functional/tests/genome-functional-record.test.js /home/jbrestel/workspaces/src/dataset-curator-functional/tests/import-graph.test.js`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `functional/record.js`.

- [ ] **Step 3: Write `record.js`**

Create `shared/scripts/genome/functional/record.js`:

```js
import { join } from 'node:path';
import { GENERATOR } from '../record.js';
import { PipelineError, readJson } from '../workdir.js';

/** The functional.json contract; bump when its shape changes. */
export const FUNCTIONAL_SCHEMA_VERSION = 1;
export const FUNCTION_DIR = 'final/function';
const RERUN = 'run functional again';

export const functionalPaths = (workDir) => ({
  functionDir: join(workDir, FUNCTION_DIR),
  stagedDir: join(workDir, `${FUNCTION_DIR}.tmp`),
  functionalJson: join(workDir, 'functional.json')
});

export function newFunctionalRecord({ genomeBuildSha256, source, datasets, findings }) {
  return {
    schemaVersion: FUNCTIONAL_SCHEMA_VERSION,
    generator: { ...GENERATOR },
    genomeBuild: { sha256: genomeBuildSha256 },
    source,
    datasets: datasets.map((d) => ({
      datasetClass: d.datasetClass,
      name: d.name,
      file: `${FUNCTION_DIR}/${d.datasetClass}/${d.name}/${d.file}`,
      rows: d.rows.length,
      sha256: d.sha256,
      ids: { level: d.level, count: new Set(d.rows.map((row) => row[0])).size },
      props: d.props
    })),
    findings
  };
}

export function readFunctionalRecord(workDir, command) {
  const { functionalJson } = functionalPaths(workDir);
  const record = readJson(functionalJson, command, 'run functional');
  if (record?.schemaVersion !== FUNCTIONAL_SCHEMA_VERSION) {
    throw new PipelineError(command, functionalJson, `has schemaVersion ${record?.schemaVersion}, not ${FUNCTIONAL_SCHEMA_VERSION}`, RERUN);
  }
  const complete = typeof record.genomeBuild?.sha256 === 'string' && typeof record.source === 'string'
    && Array.isArray(record.datasets) && Array.isArray(record.findings);
  if (!complete) throw new PipelineError(command, functionalJson, 'is incomplete: it needs genomeBuild.sha256, source, datasets and findings', RERUN);
  return record;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test --test-reporter=dot --test-global-setup=/home/jbrestel/workspaces/src/dataset-curator-functional/tests/globalSetup.js /home/jbrestel/workspaces/src/dataset-curator-functional/tests/genome-functional-record.test.js /home/jbrestel/workspaces/src/dataset-curator-functional/tests/import-graph.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git -C /home/jbrestel/workspaces/src/dataset-curator-functional add shared/scripts/genome/functional/record.js tests/genome-functional-record.test.js
git -C /home/jbrestel/workspaces/src/dataset-curator-functional commit -m "Functional: functional.json record, schema version 1" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 8: `commands/functional.js`

**Files:**
- Create: `tests/genome-functional-helpers.js`, `shared/scripts/genome/commands/functional.js`
- Test: `tests/genome-functional.test.js`

- [ ] **Step 1: Write the work-area helper**

Create `tests/genome-functional-helpers.js`:

```js
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sha256 } from '../shared/scripts/genome/workdir.js';
import { CM, gffLine, gffText } from './genome-helpers.js';
import { PRIMARY, trialBuild, trialWorkDir } from './genome-trial-helpers.js';

export const REPORT_NAME = 'GCA_000000001.1_TEST1_assembly_report.txt';
export const REPORT = '# Assembly name:  TEST1\n# Taxid:          284813\n#\n# Sequence-Name\tSequence-Role\n';

/** A coding gene and a tRNA gene as D's build writes them, carrying every attribute functional reads. */
export const FUNCTIONAL_GFF3 = gffText(
  gffLine(CM, 'gene', 100, 900, '+', 'ID=TST_0010;Name=tstA;gbkey=Gene;gene=tstA;gene_synonym=tstA1,tstA2;locus_tag=TST_0010;Dbxref=GeneID:1001'),
  gffLine(CM, 'mRNA', 100, 900, '+', 'ID=TST_0010_mRNA;Parent=TST_0010;Dbxref=GeneID:1001'),
  gffLine(CM, 'exon', 100, 900, '+', 'ID=TST_0010_mRNA_exon1;Parent=TST_0010_mRNA'),
  gffLine(CM, 'CDS', 100, 900, '+', 'ID=PRT1.1;Parent=TST_0010_mRNA;Dbxref=GeneID:1001,InterPro:IPR000719,UniProtKB/Swiss-Prot:Q00001;'
    + 'Note=kinase domain%2C N-terminal;product=kinase%2C putative;protein_id=PRT1.1;EC_number=2.7.11.1,1.2.3.-;'
    + 'go_function=ATP binding|0005524|12345678|IEA;go_process=protein phosphorylation|0006468||IEA'),
  gffLine(CM, 'gene', 1000, 1072, '+', 'ID=TST_0030;gbkey=Gene;gene=TST_0030;locus_tag=TST_0030'),
  gffLine(CM, 'tRNA', 1000, 1072, '+', 'ID=rna-TST_0030;Parent=TST_0030;Note=tRNA-Leu (TAG);gbkey=tRNA;product=tRNA-Leu'),
  gffLine(CM, 'exon', 1000, 1072, '+', 'ID=exon-TST_0030-1;Parent=rna-TST_0030')
);

/** A finalized work area for functional: the trial helpers' build with this GFF3, and fetch/ holding the assembly report. */
export function functionalWorkDir({ gff3 = FUNCTIONAL_GFF3, accession = 'GCA_000000001.1', report = REPORT } = {}) {
  const build = { ...trialBuild(), accession };
  build.partitions[0].buildFiles.gff3 = sha256(gff3);
  const { workDir } = trialWorkDir(build);
  writeFileSync(join(workDir, `build/${PRIMARY}/genome.gff3`), gff3);
  mkdirSync(join(workDir, 'fetch'), { recursive: true });
  writeFileSync(join(workDir, 'fetch', REPORT_NAME), report);
  const fetched = {
    accession, assembly: 'GCA_000000001.1_TEST1', fetchedAt: '2026-11-04T00:00:00.000Z',
    files: { report: { name: REPORT_NAME, url: 'https://ftp.ncbi.nlm.nih.gov/test/report', sha256: sha256(report) } }
  };
  writeFileSync(join(workDir, 'fetch', 'fetch.json'), `${JSON.stringify(fetched, null, 2)}\n`);
  return workDir;
}
```

- [ ] **Step 2: Write the failing test**

Create `tests/genome-functional.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gafDate, runFunctional, sourceOf } from '../shared/scripts/genome/commands/functional.js';
import { PipelineError, sha256File } from '../shared/scripts/genome/workdir.js';
import { FUNCTIONAL_GFF3, functionalWorkDir, REPORT_NAME } from './genome-functional-helpers.js';
import { CM, gffLine } from './genome-helpers.js';
import { PRIMARY } from './genome-trial-helpers.js';

const read = (workDir, rel) => readFileSync(join(workDir, rel), 'utf-8');
const refuses = (fn, problem) => assert.throws(fn, (e) => e instanceof PipelineError && e.command === 'functional' && e.problem === problem);
const gaf = (source, goId, reference, aspect) =>
  `${[source, 'TST_0010_mRNA', 'TST_0010_mRNA', '', goId, reference, 'IEA', '', aspect, '', '', 'transcript', 'taxon:284813', '20261104', source, '', ''].join('\t')}\n`;

test('sourceOf and gafDate', () => {
  assert.equal(sourceOf('GCA_000091225.2'), 'GenBank');
  assert.equal(sourceOf('GCF_000091225.2'), 'RefSeq');
  assert.equal(sourceOf('ASM9122v2'), null);
  assert.equal(gafDate('2026-11-04T00:00:00.000Z'), '20261104');
  assert.equal(gafDate(undefined), null);
});

test('functional writes each dataset under final/function and lists it in functional.json', () => {
  const workDir = functionalWorkDir();
  const record = runFunctional({ workDir });
  assert.deepEqual(record.datasets.map((d) => [d.datasetClass, d.name, d.rows, d.ids.level, d.ids.count]), [
    ['productNames', 'GenBank', 2, 'transcript', 2],
    ['geneName', 'GenBank', 1, 'gene', 1],
    ['comments', 'GenBank_transcript', 2, 'transcript', 2],
    ['aliases', 'gbProteinId', 1, 'transcript', 1],
    ['dbxref_synonym', 'GenBank', 2, 'gene', 1],
    ['dbxref_simple', 'geneid_from_annotation', 1, 'gene', 1],
    ['dbxref_simple', 'interpro_from_annotation', 1, 'gene', 1],
    ['dbxref_simple', 'uniprotkb_swiss_prot_from_annotation', 1, 'gene', 1],
    ['GeneOntologyAssociations', 'GenBank', 2, 'transcript', 1],
    ['EnzymeCommissionAssociations', 'GenBank', 2, 'protein', 1]
  ]);
  assert.equal(read(workDir, 'final/function/productNames/GenBank/products.txt'), 'TST_0010_mRNA\tkinase, putative\t1\nrna-TST_0030\ttRNA-Leu\t1\n');
  assert.equal(read(workDir, 'final/function/geneName/GenBank/geneName.txt'), 'TST_0010\ttstA\n');
  assert.equal(read(workDir, 'final/function/comments/GenBank_transcript/comments.txt'),
    'TST_0010_mRNA\tkinase domain, N-terminal\nrna-TST_0030\ttRNA-Leu (TAG)\n');
  assert.equal(read(workDir, 'final/function/aliases/gbProteinId/aliases.txt'), 'TST_0010_mRNA\tPRT1.1\n');
  assert.equal(read(workDir, 'final/function/dbxref_synonym/GenBank/synonyms.txt'), 'TST_0010\ttstA1\nTST_0010\ttstA2\n');
  assert.equal(read(workDir, 'final/function/dbxref_simple/uniprotkb_swiss_prot_from_annotation/mapping.txt'), 'TST_0010\tQ00001\n');
  assert.equal(read(workDir, 'final/function/GeneOntologyAssociations/GenBank/associations.gas'),
    gaf('GenBank', 'GO:0005524', 'PMID:12345678', 'F') + gaf('GenBank', 'GO:0006468', '', 'P'));
  assert.equal(read(workDir, 'final/function/EnzymeCommissionAssociations/GenBank/ec.txt'), 'TST_0010_mRNA-p1\t1.2.3.-\nTST_0010_mRNA-p1\t2.7.11.1\n');
  for (const d of record.datasets) assert.equal(sha256File(join(workDir, d.file)), d.sha256, d.file);
  assert.ok(!existsSync(join(workDir, 'final/function/comments/GenBank_gene')));
  assert.deepEqual(record.findings.map((f) => [f.severity, f.check, f.sample]), [['info', 'emptyClass', ['comments/GenBank_gene']]]);
  assert.equal(record.source, 'GenBank');
  assert.equal(record.genomeBuild.sha256, sha256File(join(workDir, 'genome-build.json')));
  assert.deepEqual(JSON.parse(read(workDir, 'functional.json')), record);
});

test('a GCF_ accession is RefSeq, in dataset names and GAF columns', () => {
  const workDir = functionalWorkDir({ accession: 'GCF_000000001.1' });
  const record = runFunctional({ workDir });
  assert.equal(record.source, 'RefSeq');
  assert.ok(record.datasets.some((d) => d.datasetClass === 'comments' && d.name === 'RefSeq_transcript'));
  assert.equal(read(workDir, 'final/function/GeneOntologyAssociations/RefSeq/associations.gas'),
    gaf('RefSeq', 'GO:0005524', 'PMID:12345678', 'F') + gaf('RefSeq', 'GO:0006468', '', 'P'));
});

test('a rerun writes the same bytes and replaces final/function as a whole', () => {
  const workDir = functionalWorkDir();
  runFunctional({ workDir });
  const first = read(workDir, 'functional.json');
  mkdirSync(join(workDir, 'final/function/stale'), { recursive: true });
  writeFileSync(join(workDir, 'final/function/stale/x.txt'), 'left over\n');
  runFunctional({ workDir });
  assert.equal(read(workDir, 'functional.json'), first);
  for (const rel of ['final/function/stale', 'final/function.tmp', 'final/function.old']) assert.ok(!existsSync(join(workDir, rel)), rel);
});

test('error findings are recorded after the files are written', () => {
  const extra = [
    gffLine(CM, 'gene', 3000, 3300, '+', 'ID=TST_0050'),
    gffLine(CM, 'mRNA', 3000, 3300, '+', 'ID=TST_0050_mRNA;Parent=TST_0050'),
    gffLine(CM, 'CDS', 3000, 3300, '+', 'ID=PRT5.1;Parent=TST_0050_mRNA'),
    gffLine(CM, 'tRNA', 2000, 2072, '+', 'ID=rna-orphan;product=tRNA-Gly')
  ];
  const workDir = functionalWorkDir({ gff3: `${FUNCTIONAL_GFF3}${extra.join('\n')}\n` });
  const record = runFunctional({ workDir });
  assert.deepEqual(record.findings.filter((f) => f.severity === 'error').map((f) => [f.check, f.sample]),
    [['unresolvedFeature', ['rna-orphan']], ['noProducts', ['TST_0050_mRNA']]]);
  assert.ok(existsSync(join(workDir, 'final/function/productNames/GenBank/products.txt')));
  assert.deepEqual(JSON.parse(read(workDir, 'functional.json')).findings, record.findings);
});

test('functional refuses a build GFF3 that changed since finalize, and writes nothing', () => {
  const workDir = functionalWorkDir();
  appendFileSync(join(workDir, `build/${PRIMARY}/genome.gff3`), '# edited\n');
  assert.throws(() => runFunctional({ workDir }), (e) => e instanceof PipelineError && e.command === 'functional'
    && e.problem === 'does not match genome-build.json' && e.next === 'run build and finalize again');
  assert.ok(!existsSync(join(workDir, 'functional.json')));
  assert.ok(!existsSync(join(workDir, 'final/function')));
});

test('functional refuses an accession that is neither GCA_ nor GCF_', () => {
  refuses(() => runFunctional({ workDir: functionalWorkDir({ accession: 'ASM9122v2' }) }), 'has accession ASM9122v2, neither GCA_ nor GCF_');
});

test('functional reads the taxon from the fetched report, refusing one without # Taxid or changed since fetch', () => {
  refuses(() => runFunctional({ workDir: functionalWorkDir({ report: '# Assembly name:  TEST1\n# Sequence-Name\tSequence-Role\n' }) }),
    'has no "# Taxid:" line');
  const edited = functionalWorkDir();
  appendFileSync(join(edited, 'fetch', REPORT_NAME), '# edited\n');
  refuses(() => runFunctional({ workDir: edited }), 'does not match fetch/fetch.json');
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --test --test-reporter=dot --test-global-setup=/home/jbrestel/workspaces/src/dataset-curator-functional/tests/globalSetup.js /home/jbrestel/workspaces/src/dataset-curator-functional/tests/genome-functional.test.js /home/jbrestel/workspaces/src/dataset-curator-functional/tests/import-graph.test.js`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `commands/functional.js`.

- [ ] **Step 4: Write `commands/functional.js`**

Create `shared/scripts/genome/commands/functional.js`:

```js
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { reportTaxonId } from '../assembly-report.js';
import { finding } from '../checks.js';
import { extractDatasets, fileText } from '../functional/classes.js';
import { resolveFeatures } from '../functional/ids.js';
import { functionalPaths, newFunctionalRecord } from '../functional/record.js';
import { partitionName, readGenomeBuild } from '../genome-build.js';
import { parseGff } from '../gff.js';
import { BUILD_FILES } from '../record.js';
import { PipelineError, readJson, readText, sha256, sha256File, swapDirs, workPaths, writeFileAtomic, writeJsonAtomic } from '../workdir.js';

const REFINALIZE = 'run build and finalize again';

export function sourceOf(accession) {
  if (accession.startsWith('GCA_')) return 'GenBank';
  if (accession.startsWith('GCF_')) return 'RefSeq';
  return null;
}

/** GAF's date column from finalize's timestamp, so a rerun writes the same bytes. */
export const gafDate = (finalizedAt) => (/^\d{4}-\d{2}-\d{2}T/.test(finalizedAt ?? '') ? finalizedAt.slice(0, 10).replaceAll('-', '') : null);

/** The NCBI taxon ID from the `# Taxid:` line of the assembly report fetch recorded. */
export function readTaxonId(workDir) {
  const p = workPaths(workDir);
  const report = readJson(p.fetchJson, 'functional', 'run fetch <assemblyAccession> first')?.files?.report;
  if (typeof report?.name !== 'string' || report.name.includes('/') || typeof report.sha256 !== 'string') {
    throw new PipelineError('functional', p.fetchJson, 'is incomplete: no files.report name and sha256', 'delete fetch/fetch.json and run fetch again');
  }
  const path = join(p.fetchDir, report.name);
  if (!existsSync(path)) throw new PipelineError('functional', path, 'is missing', 'run fetch again');
  if (sha256File(path) !== report.sha256) throw new PipelineError('functional', path, 'does not match fetch/fetch.json', 'delete it and run fetch again');
  const taxonId = reportTaxonId(readText(path));
  if (taxonId === null) throw new PipelineError('functional', path, 'has no "# Taxid:" line', 'run fetch again; if the report still has none, NCBI changed its format');
  return taxonId;
}

function readFeatures(build, workDir) {
  const { buildDir } = workPaths(workDir);
  const all = { features: [], unresolved: [], codingTranscripts: [] };
  for (const part of build.partitions.filter((x) => x.featureCount > 0)) {
    const model = resolveFeatures(parseGff(readText(join(buildDir, partitionName(part), BUILD_FILES.gff3))));
    all.features.push(...model.features);
    all.unresolved.push(...model.unresolved);
    all.codingTranscripts.push(...model.codingTranscripts);
  }
  return all;
}

/** The old record goes first and the new one is written last, so functional.json never describes files that are not there. */
function writeDatasets(workDir, datasets) {
  const paths = functionalPaths(workDir);
  rmSync(paths.functionalJson, { force: true });
  rmSync(paths.stagedDir, { recursive: true, force: true });
  mkdirSync(paths.stagedDir, { recursive: true });
  for (const d of datasets) writeFileAtomic(join(paths.stagedDir, d.datasetClass, d.name, d.file), d.text);
  swapDirs(paths.stagedDir, paths.functionDir);
}

export function runFunctional({ workDir }) {
  const { build, sha256: genomeBuildSha256 } = readGenomeBuild(workDir, 'functional');
  const { genomeBuildJson } = workPaths(workDir);
  const source = sourceOf(build.accession);
  if (!source) throw new PipelineError('functional', genomeBuildJson, `has accession ${build.accession}, neither GCA_ nor GCF_`, REFINALIZE);
  const date = gafDate(build.finalizedAt);
  if (!date) throw new PipelineError('functional', genomeBuildJson, 'has no finalizedAt timestamp', REFINALIZE);
  const ctx = { source, taxonId: readTaxonId(workDir), date };
  const { features, unresolved, codingTranscripts } = readFeatures(build, workDir);
  const extracted = extractDatasets(features, { source, codingTranscripts });
  const datasets = extracted.datasets.map((d) => {
    const text = fileText(d, ctx);
    return { ...d, text, sha256: sha256(text) };
  });
  const findings = [
    finding('functional', 'unresolvedFeature', 'error', unresolved, 'CDS or RNA features whose Parent chain reaches no gene; build and functional disagree, report it'),
    ...extracted.findings
  ].filter((f) => f.count);
  writeDatasets(workDir, datasets);
  const record = newFunctionalRecord({ genomeBuildSha256, source, datasets, findings });
  writeJsonAtomic(functionalPaths(workDir).functionalJson, record);
  return record;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test --test-reporter=dot --test-global-setup=/home/jbrestel/workspaces/src/dataset-curator-functional/tests/globalSetup.js /home/jbrestel/workspaces/src/dataset-curator-functional/tests/genome-functional.test.js /home/jbrestel/workspaces/src/dataset-curator-functional/tests/import-graph.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```
git -C /home/jbrestel/workspaces/src/dataset-curator-functional add shared/scripts/genome/commands/functional.js tests/genome-functional-helpers.js tests/genome-functional.test.js
git -C /home/jbrestel/workspaces/src/dataset-curator-functional commit -m "Functional: runFunctional writes final/function and functional.json" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 9: CLI

**Files:**
- Modify: `shared/scripts/genome/genome-pipeline.js`
- Test: `tests/genome-pipeline-cli.test.js`

- [ ] **Step 1: Write the failing test**

In `tests/genome-pipeline-cli.test.js`, replace

```js
import { fakeApiCommonData, fetchedWorkDir, perlMissing, tempDir, writeRecipe } from './genome-helpers.js';
```

with

```js
import { FUNCTIONAL_GFF3, functionalWorkDir } from './genome-functional-helpers.js';
import { CM, fakeApiCommonData, fetchedWorkDir, gffLine, perlMissing, tempDir, writeRecipe } from './genome-helpers.js';
```

and append:

```js
test('functional takes only --workDir, prints a line per dataset, and exits 1 on an error finding', () => {
  let r = cli('functional', '--workDir', tempDir('cli-'), '--image', 'gus_isf:local');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /functional does not take --image\.\nUsage:/);
  r = cli('functional', '--workDir', functionalWorkDir());
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^ {2}productNames GenBank: 2$/m);
  assert.match(r.stdout, /^ {2}dbxref_simple interpro_from_annotation: 1$/m);
  assert.match(r.stdout, /^info functional\/emptyClass \(1\): datasets with no rows; no file is written for them \[comments\/GenBank_gene\]$/m);
  assert.match(r.stdout, /^Wrote .*functional\.json$/m);
  const orphan = functionalWorkDir({ gff3: `${FUNCTIONAL_GFF3}${gffLine(CM, 'tRNA', 2000, 2072, '+', 'ID=rna-orphan;product=tRNA-Gly')}\n` });
  r = cli('functional', '--workDir', orphan);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^error functional\/unresolvedFeature \(1\): .* \[rna-orphan\]$/m);
  assert.match(cli().stderr, /node genome-pipeline\.js functional --workDir <dir>/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test --test-reporter=dot --test-global-setup=/home/jbrestel/workspaces/src/dataset-curator-functional/tests/globalSetup.js /home/jbrestel/workspaces/src/dataset-curator-functional/tests/genome-pipeline-cli.test.js /home/jbrestel/workspaces/src/dataset-curator-functional/tests/import-graph.test.js`
Expected: FAIL: `functional` is not a command, so the CLI prints usage (no `functional does not take --image`).

- [ ] **Step 3: Wire `functional` into the CLI**

In `shared/scripts/genome/genome-pipeline.js`, replace

```js
 * genome-pipeline.js - NCBI annotated genome in, ISF-ready partitions and genome-build.json out; `trial` loads them into GUS.
 * Specs: docs/superpowers/specs/2026-11-04-gff-pipeline-design.md, docs/superpowers/specs/2026-11-05-trial-isf-runner-design.md
```

with

```js
 * genome-pipeline.js - NCBI annotated genome in, ISF-ready partitions and genome-build.json out; `trial` loads them into GUS,
 * `functional` writes the functional annotation files.
 * Specs: docs/superpowers/specs/2026-11-04-gff-pipeline-design.md, docs/superpowers/specs/2026-11-05-trial-isf-runner-design.md,
 * docs/superpowers/specs/2026-11-05-functional-extraction-design.md
```

Replace

```js
import { runFinalize } from './commands/finalize.js';
```

with

```js
import { runFinalize } from './commands/finalize.js';
import { runFunctional } from './commands/functional.js';
```

Replace

```js
  '       node genome-pipeline.js finalize --workDir <dir> --apiCommonData <ApiCommonData checkout> [--preprocessGFF3 <script>]',
```

with

```js
  '       node genome-pipeline.js finalize --workDir <dir> --apiCommonData <ApiCommonData checkout> [--preprocessGFF3 <script>]',
  '       node genome-pipeline.js functional --workDir <dir>',
```

Replace

```js
  finalize: ['workDir', 'apiCommonData', 'preprocessGFF3'],
```

with

```js
  finalize: ['workDir', 'apiCommonData', 'preprocessGFF3'],
  functional: ['workDir'],
```

Replace

```js
  } else {
    const { image, gusConfig, taxonId, keep, undo } = values;
```

with

```js
  } else if (command === 'functional') {
    const record = runFunctional({ workDir });
    print([...record.datasets.map((d) => `  ${d.datasetClass} ${d.name}: ${d.rows}`), ...record.findings.map(formatFinding),
      `Wrote ${join(workDir, 'functional.json')}`]);
    if (record.findings.some((f) => f.severity === 'error')) process.exit(1);
  } else {
    const { image, gusConfig, taxonId, keep, undo } = values;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test --test-reporter=dot --test-global-setup=/home/jbrestel/workspaces/src/dataset-curator-functional/tests/globalSetup.js /home/jbrestel/workspaces/src/dataset-curator-functional/tests/genome-pipeline-cli.test.js /home/jbrestel/workspaces/src/dataset-curator-functional/tests/import-graph.test.js`
Expected: PASS (`survey, build and finalize run from the command line` skips without `perl`).

- [ ] **Step 5: Commit**

```
git -C /home/jbrestel/workspaces/src/dataset-curator-functional add shared/scripts/genome/genome-pipeline.js tests/genome-pipeline-cli.test.js
git -C /home/jbrestel/workspaces/src/dataset-curator-functional commit -m "genome-pipeline: functional --workDir" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 10: Golden E. cuniculi functional output

The golden test already builds the E. cuniculi X/XI work area (fetch stubbed with fixtures, survey, build, finalize). It now runs `functional` on it and pins each dataset as rows, ID count and sha256. The row and ID counts below were computed independently from the golden build GFF3 (`build/primary_chromosome/genome.gff3`); the digests come from one run.

**Files:**
- Modify: `tests/genome-golden.test.js`

- [ ] **Step 1: Add the functional run with the known counts**

In `tests/genome-golden.test.js`, replace

```js
import { runFinalize } from '../shared/scripts/genome/commands/finalize.js';
```

with

```js
import { runFinalize } from '../shared/scripts/genome/commands/finalize.js';
import { runFunctional } from '../shared/scripts/genome/commands/functional.js';
```

Replace

```js
  golden('genome-build.json', `${JSON.stringify(masked(record), null, 2)}\n`);
});
```

with

```js
  golden('genome-build.json', `${JSON.stringify(masked(record), null, 2)}\n`);

  const functional = runFunctional({ workDir });
  assert.deepEqual(functional.findings.map((f) => [f.severity, f.check, f.count, f.sample]), [
    ['warning', 'unknownDbxrefPrefix', 2, ['EnsemblGenomes-Gn', 'EnsemblGenomes-Tr']],
    ['info', 'emptyClass', 3, ['comments/GenBank_gene', 'GeneOntologyAssociations/GenBank', 'EnzymeCommissionAssociations/GenBank']]
  ]);
  assert.deepEqual(functional.datasets.map((d) => [`${d.datasetClass}/${d.name}`, d.rows, d.ids.count]), [
    ['productNames/GenBank', 442, 442],
    ['geneName/GenBank', 1, 1],
    ['comments/GenBank_transcript', 407, 407],
    ['aliases/gbProteinId', 428, 428],
    ['dbxref_synonym/GenBank', 3, 3],
    ['dbxref_simple/ensemblgenomes_gn_from_annotation', 420, 420],
    ['dbxref_simple/ensemblgenomes_tr_from_annotation', 420, 420],
    ['dbxref_simple/goa_from_annotation', 286, 286],
    ['dbxref_simple/interpro_from_annotation', 955, 332],
    ['dbxref_simple/ncbi_gp_from_annotation', 428, 428],
    ['dbxref_simple/pdb_from_annotation', 15, 7],
    ['dbxref_simple/uniprotkb_swiss_prot_from_annotation', 104, 104],
    ['dbxref_simple/uniprotkb_trembl_from_annotation', 316, 316]
  ]);
  assert.equal(readFileSync(join(workDir, 'final/function/geneName/GenBank/geneName.txt'), 'utf-8'), 'ECU11_0375_2\tECU11_0375\n');
});
```

- [ ] **Step 2: Run the golden test**

It needs `perl` and an ApiCommonData git checkout; `GOLDEN_WORKDIR` keeps the work area (in the worktree's ignored `tmp/`) for Step 3 and Task 12.

Run: `APICOMMONDATA_DIR=/home/jbrestel/workspaces/src/ApiCommonData GOLDEN_WORKDIR=/home/jbrestel/workspaces/src/dataset-curator-functional/tmp/golden-ecun node --test --test-reporter=dot --test-global-setup=/home/jbrestel/workspaces/src/dataset-curator-functional/tests/globalSetup.js /home/jbrestel/workspaces/src/dataset-curator-functional/tests/genome-golden.test.js /home/jbrestel/workspaces/src/dataset-curator-functional/tests/import-graph.test.js`
Expected: PASS. If a count differs, stop: the counts were derived from the same GFF3, so a difference means the extraction disagrees with the spec. Use superpowers:systematic-debugging before changing either side. If the test skips, the output names the missing prerequisite.

- [ ] **Step 3: Read the digests from the run**

Run: `node --input-type=module -e "import { readFileSync } from 'node:fs'; const r = JSON.parse(readFileSync(process.argv[1], 'utf-8')); for (const d of r.datasets) console.log(JSON.stringify([d.datasetClass + '/' + d.name, d.sha256]) + ',');" /home/jbrestel/workspaces/src/dataset-curator-functional/tmp/golden-ecun/functional.json`
Expected: 13 lines, one `["<class>/<name>", "<64 hex>"],` per dataset, in the order of Step 1's table.

- [ ] **Step 4: Pin the digests**

In `tests/genome-golden.test.js`, after the line `const EXPECTED = join(ECUN, 'expected');`, add a constant whose entries are exactly the 13 lines Step 3 printed:

```js
/** sha256 of each E. cuniculi functional file; a change means the extraction changed, so review the files of a local run. */
const ECUN_FUNCTIONAL_SHA256 = Object.fromEntries([
  // the 13 lines printed by Step 3, verbatim
]);
```

Replace the comment line with the 13 printed lines (the `Object.fromEntries` call takes them as `[name, sha256]` pairs; no comment stays in the file). Then replace

```js
  assert.equal(readFileSync(join(workDir, 'final/function/geneName/GenBank/geneName.txt'), 'utf-8'), 'ECU11_0375_2\tECU11_0375\n');
});
```

with

```js
  assert.equal(readFileSync(join(workDir, 'final/function/geneName/GenBank/geneName.txt'), 'utf-8'), 'ECU11_0375_2\tECU11_0375\n');
  assert.deepEqual(Object.fromEntries(functional.datasets.map((d) => [`${d.datasetClass}/${d.name}`, d.sha256])), ECUN_FUNCTIONAL_SHA256);
});
```

- [ ] **Step 5: Run the golden test again**

Run: `APICOMMONDATA_DIR=/home/jbrestel/workspaces/src/ApiCommonData GOLDEN_WORKDIR=/home/jbrestel/workspaces/src/dataset-curator-functional/tmp/golden-ecun node --test --test-reporter=dot --test-global-setup=/home/jbrestel/workspaces/src/dataset-curator-functional/tests/globalSetup.js /home/jbrestel/workspaces/src/dataset-curator-functional/tests/genome-golden.test.js /home/jbrestel/workspaces/src/dataset-curator-functional/tests/import-graph.test.js`
Expected: PASS (the second run also shows the files are stable across reruns into the same work area).

- [ ] **Step 6: Commit**

```
git -C /home/jbrestel/workspaces/src/dataset-curator-functional add tests/genome-golden.test.js
git -C /home/jbrestel/workspaces/src/dataset-curator-functional commit -m "Golden: E. cuniculi functional datasets pinned as rows, ID counts and sha256" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 11: Docs, version 3.3.0, final checkpoint

**Files:**
- Modify: `docs/development.md` (Genome pipeline section)
- Modify: `package.json:3`, `.claude-plugin/plugin.json:3`

- [ ] **Step 1: Document `functional`**

In `docs/development.md`, replace

```
    node shared/scripts/genome/genome-pipeline.js trial    --workDir <dir> --image <name> --gusConfig <file> --undo
```

with

```
    node shared/scripts/genome/genome-pipeline.js trial    --workDir <dir> --image <name> --gusConfig <file> --undo
    node shared/scripts/genome/genome-pipeline.js functional --workDir <dir>
```

Replace

```
  why in `fallback` and in the `isfProfile` finding.

| Module | Purpose |
```

with

```
  why in `fallback` and in the `isfProfile` finding.

#### `functional`: the functional annotation files

`functional` (spec: `docs/superpowers/specs/2026-11-05-functional-extraction-design.md`)
reads each annotated partition's `build/<partition>/genome.gff3` after
`finalize` and writes the files of the functional dataset classes under
`final/function/<datasetClass>/<name>/`, then `functional.json`. It needs no
network, database or Docker and does not depend on `trial`. ISF ignores every
functional attribute, so this is how `product`, `Note`, `Dbxref`, `gene`,
`gene_synonym`, `protein_id`, `go_*` and `EC_number` reach the database.

- **Extraction table.** `functional/classes.js` lists each dataset: the
  attributes, the features they are read from, the ID level (gene, transcript,
  or protein `<transcript>-p1`, GusSkeletonMaker's rule) and the file.
  `<source>` is `GenBank` for `GCA_` and `RefSeq` for `GCF_`. Each `Dbxref`
  prefix becomes its own `dbxref_simple` dataset,
  `<prefix lower-cased, other characters as _>_from_annotation`.
  `functional/dbxref-urls.js` holds the URL templates; a prefix without one is
  written with `url` null and an `unknownDbxrefPrefix` warning. Add a template
  there when a new prefix turns up.
- **Files.** Tab-separated, no header, LF, unique per (ID, value) and sorted by
  code unit, so a rerun writes the same bytes. `products.txt` carries an
  explicit `is_preferred`: the transcript's first product in GFF order. The GAF
  date is `genome-build.json` `finalizedAt` and the taxon is the assembly
  report's `# Taxid:`. A dataset with no rows gets no file and is named in the
  `emptyClass` info finding.
- **`functional.json`** (`FUNCTIONAL_SCHEMA_VERSION`, now 1, in
  `functional/record.js`) is the hand-off to F: `generator`,
  `genomeBuild.sha256`, `source`, `findings`, and per dataset `{ datasetClass,
  name, file, rows, sha256, ids: { level, count }, props }`. Files are staged
  in `final/function.tmp` and swapped in; the old record is removed first and
  the new one written last. `finalize` replaces `final/` and with it
  `final/function/`, so run `functional` again after it; a
  `genomeBuild.sha256` that differs from `genome-build.json` marks a stale
  record.
- **Exit status.** An error finding (`unresolvedFeature`, `noProducts`,
  `dbxrefNameClash`) exits 1 after the files and the record are written, so
  they can be inspected.

| Module | Purpose |
```

Replace

```
| `genome-pipeline.js` | CLI: argument parsing and printing for the five commands |
| `commands/` | `fetch`, `survey`, `build`, `finalize`, `trial` |
| `commands/trial.js` | Preflight, the lock, `runTrial`, QA, Undo and `runTrialUndo` |
```

with

```
| `genome-pipeline.js` | CLI: argument parsing and printing for the six commands |
| `commands/` | `fetch`, `survey`, `build`, `finalize`, `trial`, `functional` |
| `commands/trial.js` | Preflight, the lock, `runTrial`, QA, Undo and `runTrialUndo` |
| `commands/functional.js` | `runFunctional`: build GFF3s in, `final/function/` and `functional.json` out |
| `genome-build.js` | `readGenomeBuild` and `partitionName`, shared by `trial` and `functional` |
| `functional/ids.js` | Gene, transcript and protein IDs through `Parent` |
| `functional/classes.js` | The extraction table and the extraction |
| `functional/values.js` | Attribute values, `go_*`, `EC_number`, `Dbxref` and prefix names |
| `functional/dbxref-urls.js` | Dbxref prefix → URL template |
| `functional/record.js` | `functional.json` contract |
```

Replace

```
`GOLDEN_WORKDIR=<dir>` to keep the E. cuniculi work area there instead of a
temporary directory; it is the input for a manual `trial` run.
```

with

```
`GOLDEN_WORKDIR=<dir>` to keep the E. cuniculi work area there instead of a
temporary directory; it is the input for manual `trial` and `functional` runs.
The golden test also runs `functional` and pins each dataset as rows, ID count
and sha256.
```

- [ ] **Step 2: Bump the version to 3.3.0**

In `package.json`, replace `"version": "3.2.0",` with `"version": "3.3.0",`.
In `.claude-plugin/plugin.json`, replace `"version": "3.2.0",` with `"version": "3.3.0",`.

- [ ] **Step 3: Final checkpoint: full suite**

Run: `node --test --test-reporter=dot --test-global-setup=/home/jbrestel/workspaces/src/dataset-curator-functional/tests/globalSetup.js /home/jbrestel/workspaces/src/dataset-curator-functional/tests/*.test.js`
Expected: PASS, with skips only where `perl` or `APICOMMONDATA_DIR` is missing. (Records read `GENERATOR.version` at run time and the golden masks it, so the bump changes no expectation.)

- [ ] **Step 4: Commit**

```
git -C /home/jbrestel/workspaces/src/dataset-curator-functional add docs/development.md package.json .claude-plugin/plugin.json
git -C /home/jbrestel/workspaces/src/dataset-curator-functional commit -m "Functional extraction: docs and version 3.3.0" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 12: Manual acceptance (not code)

Runs on the golden E. cuniculi X/XI work area Task 10 kept in `/home/jbrestel/workspaces/src/dataset-curator-functional/tmp/golden-ecun`. Read-only apart from that work area: no network, database or Docker. Record the outcome in the PR description.

Prerequisites: `perl` on the host and the ApiCommonData checkout at `/home/jbrestel/workspaces/src/ApiCommonData` (the golden test runs `preprocessGFF3`).

Checklist:

- [ ] **Build the work area.** `APICOMMONDATA_DIR=/home/jbrestel/workspaces/src/ApiCommonData GOLDEN_WORKDIR=/home/jbrestel/workspaces/src/dataset-curator-functional/tmp/golden-ecun node --test --test-global-setup=/home/jbrestel/workspaces/src/dataset-curator-functional/tests/globalSetup.js /home/jbrestel/workspaces/src/dataset-curator-functional/tests/genome-golden.test.js` passes.
- [ ] **Run `functional` from the command line.** `node /home/jbrestel/workspaces/src/dataset-curator-functional/shared/scripts/genome/genome-pipeline.js functional --workDir /home/jbrestel/workspaces/src/dataset-curator-functional/tmp/golden-ecun` exits 0 and prints 13 dataset lines (`productNames GenBank: 442` first), `warning functional/unknownDbxrefPrefix (2)` for `EnsemblGenomes-Gn` and `EnsemblGenomes-Tr`, `info functional/emptyClass (3)`, and `Wrote …/functional.json`.
- [ ] **Spot-check a coding gene.** Each of these finds one line (`grep -c -P` returns 1):
  - `grep -c -P "^ECU10_0010_mRNA\thypothetical protein\t1$" /home/jbrestel/workspaces/src/dataset-curator-functional/tmp/golden-ecun/final/function/productNames/GenBank/products.txt`
  - `grep -c -P "^ECU10_0010_mRNA\t10_0010, unknown, gene found by Glimmer$" /home/jbrestel/workspaces/src/dataset-curator-functional/tmp/golden-ecun/final/function/comments/GenBank_transcript/comments.txt`
  - `grep -c -P "^ECU10_0010_mRNA\tCAD25721.2$" /home/jbrestel/workspaces/src/dataset-curator-functional/tmp/golden-ecun/final/function/aliases/gbProteinId/aliases.txt`
  - `grep -c -P "^ECU10_0010\tIPR011667$" /home/jbrestel/workspaces/src/dataset-curator-functional/tmp/golden-ecun/final/function/dbxref_simple/interpro_from_annotation/mapping.txt`
  - `grep -c -P "^ECU10_0010\tQ8ST30$" /home/jbrestel/workspaces/src/dataset-curator-functional/tmp/golden-ecun/final/function/dbxref_simple/uniprotkb_swiss_prot_from_annotation/mapping.txt`
- [ ] **Spot-check an RNA.** `grep -c -P "^rna-ECU11_0375\ttRNA-Leu\t1$" /home/jbrestel/workspaces/src/dataset-curator-functional/tmp/golden-ecun/final/function/productNames/GenBank/products.txt` returns 1, and `geneName/GenBank/geneName.txt` holds only `ECU11_0375_2	ECU11_0375`.
- [ ] **No GO or EC files.** `ls /home/jbrestel/workspaces/src/dataset-curator-functional/tmp/golden-ecun/final/function` lists `aliases comments dbxref_simple dbxref_synonym geneName productNames`.
- [ ] **Byte-identical rerun.** Copy the record (`cp /home/jbrestel/workspaces/src/dataset-curator-functional/tmp/golden-ecun/functional.json /home/jbrestel/workspaces/src/dataset-curator-functional/tmp/functional.first.json`), run `functional` again, then `cmp /home/jbrestel/workspaces/src/dataset-curator-functional/tmp/functional.first.json /home/jbrestel/workspaces/src/dataset-curator-functional/tmp/golden-ecun/functional.json` prints nothing.
- [ ] **Optional, IDs against a trial.** When a kept or earlier `trial` wrote `final/primary_chromosome/transcriptInfoAndIds` in this work area, every transcript ID in `products.txt` appears in its column 5 (442 of 442).
- [ ] **Report.** Paste the `functional` output and the spot-check results into the PR.

---

## Self-review

**Spec coverage.**
- Command, no network/database/Docker, independent of C: Tasks 8, 9. Only input is D's build GFF3, validated as `trial` does via a shared `genome-build.js`, refusing a mismatch with `run build and finalize again`: Tasks 1, 8.
- `parseGff`/`featureGroups`; CDS segments one feature; split on `,` then decode: Tasks 3, 4. ID levels gene/transcript/protein `-p1`; CDS → transcript → gene; unresolved → error: Task 4, Task 8 (`unresolvedFeature`). `source` from GCA_/GCF_; taxon from `# Taxid:`: Tasks 2, 8.
- Extraction table rows: productNames (CDS, RNA without CDS, `is_preferred`), geneName (skip ID/locus_tag, conflict warning), comments ×2, aliases, dbxref_synonym: Task 5. dbxref_simple per prefix with naming, URL table, unknown-prefix warning and clash error; GO as GAF; EC by protein with partial ECs: Tasks 3, 6. Dedup and sort, determinism: Tasks 5, 8.
- Output: staged and swapped `final/function/<class>/<name>/<file>`, then `functional.json` schema 1 with generator, genomeBuild.sha256, source, datasets, findings: Tasks 7, 8. Empty class → no file, info finding: Tasks 5, 6, 8. Findings table (unresolvedFeature, noProducts, dbxrefNameClash, unknownDbxrefPrefix, badGo, badEc, geneNameConflict, emptyClass, multipleProducts): Tasks 5, 6, 8. Exit 1 after writing: Tasks 8, 9. CLI output: Task 9.
- Modules as the spec's table: Tasks 1, 3–8. Testing list: attribute splitting and `%2C` (3), ID resolution incl. ncRNA and orphan (4), each table row (5, 6), go_*/EC incl. partial (3, 6), prefix naming and clashes (3, 6), `is_preferred` (5), determinism (8), record shape (7), stale GFF3 refusal (1, 8), golden (10). Version 3.3.0: Task 11. Acceptance: Task 12.

**Placeholder scan.** Every code step shows its code. The one value not known in advance, the 13 golden digests, is produced by Task 10 Step 3's command and pasted verbatim in Step 4; the counts beside them are fixed now.

**Type consistency.** `readGenomeBuild(workDir, command)` everywhere (trial passes `'trial'`); `resolveFeatures` features carry `kind`, `group`, `gene`, `transcript` and, for RNAs, `hasCds`, which `classes.js` predicates read; `extractDatasets(features, { source, codingTranscripts })` returns datasets with `datasetClass`, `level`, `file`, `format`, `name`, `props`, `rows`, which `fileText` and `newFunctionalRecord` read (the command adds `text` and `sha256`); `finding(group, check, severity, ids, message)` from `checks.js`; `functionalPaths(workDir)` gives `functionDir`, `stagedDir`, `functionalJson`.
