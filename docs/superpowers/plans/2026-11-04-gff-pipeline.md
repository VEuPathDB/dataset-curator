# GFF Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** NCBI assembly accession in, partitioned ISF-ready `final/<partition>/` files and a `genome-build.json` record of every change out, through four commands (`fetch`, `survey`, `build`, `finalize`) over one in-memory GFF feature graph.

**Architecture:** Pure modules under `shared/scripts/genome/` (GFF graph, FASTA, assembly report, partitions, ISF map plus a port of ISF's type renames, ID policy, transforms, checks) and four command modules that each read the work area, verify their predecessor's checksums, and write files. `genome-pipeline.js` is the CLI. Network (`fetch`) and process execution (`perl`, `git`) go through injectable seams so tests stay offline.

**Tech Stack:** Node 18 ES modules (Volta pins 18.20.5), `node:test`, `node:assert/strict`, `node:zlib`, no npm dependencies; host `perl` for ApiCommonData's `preprocessGFF3`. Spec: `docs/superpowers/specs/2026-11-04-gff-pipeline-design.md`.

**Conventions:**
- Work on branch `feature/gff-pipeline` in `/home/jbrestel/workspaces/src/dataset-curator-gff-pipeline`.
- Nothing under `shared/scripts/genome/` is listed in `package.json` `sharedFiles`, so `bin/sync-shared.js` never touches it (it only walks the listed files) and no `skills/*` copy is made. No skill calls these scripts yet.
- Tests live at `tests/genome-*.test.js` so the `yarn test` glob (`node --test --test-global-setup=tests/globalSetup.js tests/*.test.js`, which points `TMPDIR` at a per-run directory and removes it afterwards) picks them up. Shared test builders go in `tests/genome-helpers.js` (not a `*.test.js` file). Run one file with `node --test tests/<file>.test.js`.
- `tests/import-graph.test.js` fails on any import cycle under `shared/scripts`; the module order below has none.
- Comments: self-describing code; at most 2–3 line comments, only where logic is not obvious.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Golden test env var: `APICOMMONDATA_DIR` (an ApiCommonData checkout). The golden and the real-map/real-script tests skip with a message when it or `perl` is missing.

**Execution amendments (after Task 2 review; these override the task text below):**
- `gff.js` gained `encode`, `setRawAttr` and `cloneGraph`, and `parseGff` refuses CRLF, `##FASTA` and non-integer coordinates. Read the committed `gff.js`, not Task 2's listing, for the current API.
- IDs and `Parent` values in the graph are raw GFF text. Write them with `setRawAttr` (multi-value `Parent` as `ids.join(',')`); `renameIds` maps raw → raw. `setAttr` encodes and is only for human-text attribute values.
- `ids.tsv` `new` values are human text: `readIdsTsv` stores `encode(new)`; `old` values are matched as written (raw, as in the GFF).
- Wherever a task copies a graph with `structuredClone(graph)`, use `cloneGraph(graph)` from `gff.js` instead.
- `parseAssemblyReport` / `planPartitions` (after Task 4–5 review): problems may have `sequence: null` (`noPrimary`); `checks.js` must drop null samples and omit the `partitions.tsv` fix line for them. New kinds `duplicateAccession`, `unusedOverride`, `conflictingSoTerm`. `readPartitionsTsv` validates rows and throws with file line numbers. Read the committed `assembly-report.js` and `partitions.js` (not the Task 4–5 listings) for the current API; `parseAssemblyReport(text, file)` throws `PipelineError`.
- Task 13 adds three structure checks (spec Checks table; ISF `die`s the port does not reproduce, from `genemRNAExonCDS2BioperlTree.pm`): `missingId` (gene or RNA line with no `ID`, error), `strandMismatch` (gene, transcript and exons not all on one strand — Perl `checkGeneStructure`, error), `cdsOutsideExons` (a transcript's CDS segments not each contained in one of its exons — Perl lines ~440–445, error). Each with a fixture test. `conflictingSoTerm` and `noPrimary` problems carry no sequence ID: no `partitions.tsv` fix line and no sample for them.
- `parseAssemblyReport(text, file, command)`: `loadInputs` passes its own command name.
- `applyIdPolicy` (after Task 8–9 review) returns two reverse maps: `inputIdOf` (settled → input, gene/transcript/protein only) and `inputSequenceIdOf` (settled → input, sequences). `runChecks` (Task 13) takes `inputSequenceIdOf = new Map()` too and maps sequence-ID findings through it (Task 13's test that passes a sequence in `inputIdOf` uses `inputSequenceIdOf`); Tasks 16 and 17 pass `inputSequenceIdOf: policy.inputSequenceIdOf`. `readIdsTsv` entries carry `written` (curator text) beside encoded `new`; messages echo `written`. `ids.default.tsv` `new` is decoded.
- Transforms (after Task 10–12 review): `CANONICAL_ORDER` is collapseSplitGenes, addMrnaToGeneCds, parentOrphanRnas, addExonPerCds, stripAttributes. Every recipe, suggested recipe and expected `[name, count]` list in Tasks 13, 16, 17 and 20 follows that order (the `STRUCTURAL` constant in Task 13's test, survey's and build's suggested recipes, the change-count assertions); counts are unchanged. `runTransforms`' `created` map traces each created ID to its root input source (`{level, id}`, level may be `sequence`), and an `ID_COLLISION` error carries `e.from` the same way: resolve `level: 'sequence'` sources through `inputSequenceIdOf`, others through `inputIdOf`. `parentOrphanRnas` shares one gene per seq+span+strand and errors on opposite strands (no `ids.tsv` fix line for that error).
- Task 13 adds `cdsUnderGene` (error): a CDS whose parent is a gene, which `addMrnaToGeneCds` skips when the gene also has an RNA child.
- `checks.js` as committed (after Task 13): `runChecks({ graph, isfMap, fastaIds, plan, synthesized, inputIdOf, inputSequenceIdOf, idsEntries })`, `collisionFinding(collisions, idsEntries = [])`, `formatFinding(f)`, `duplicateIds(groups)`. Call sites in Tasks 16–17:
  - Task 16 survey: raw `runChecks` adds `idsEntries: ids.entries`; `preview()` uses `collisionFinding(policy.collisions, idLines)` and adds `inputSequenceIdOf: policy.inputSequenceIdOf, idsEntries: idLines` to its `runChecks`; its `ID_COLLISION` catch names the root input from `e.from` (`inputSequenceIdOf` when `e.from.level === 'sequence'`, else `inputIdOf`).
  - Task 17 build: `settleIds()` builds its fix lines from `collisionFinding(policy.collisions, ids.entries).fix?.ids`, not by hand; `transform()` receives `policy` (both maps) and resolves `e.from` the same way as survey, following the existing-`ids.tsv`-line rule; build's `runChecks` adds `inputSequenceIdOf: policy.inputSequenceIdOf, idsEntries: ids.entries`.
- After Task 16 review: `checks.js` exports `collisionFromError(e, policy, idsEntries = [])`, the one place that turns a transform `ID_COLLISION` into a duplicateId finding with its fix line. Build's `transform()` uses it (no hand-built "next" text, no second copy of the `e.from` rule) and throws `PipelineError('build', p.recipeJson, formatted finding message, its fix line)`; the other transform errors (`SPLIT_ACROSS`, `ORPHAN_OPPOSITE_STRANDS`) keep the "hand fix to the input GFF" next step; anything without a known code is rethrown as is. Build calls `loadInputs(fetched, 'build')`; `loadInputs` already turns GFF/gzip/FASTA read failures into `PipelineError(command, path, …)`. `readIdsFile(path, 'build')` still throws on any ids.tsv error (build refuses; survey reports them as `idsTsvLine` findings).
- After Task 14–15 review: `apiCommonDataCommit(dir, { exec })` returns `{ commit, dirty }` and makes three git calls (`rev-parse --show-toplevel`, `rev-parse HEAD`, `status --porcelain`); fake `exec` stubs in Task 18 tests must answer all three (or use a real temp git repo). Task 18: `resolveScript` returns `{ script, ...apiCommonDataCommit(apiCommonData, { exec }) }`; `runFinalize` destructures `{ script, commit, dirty }`; the record is `apiCommonData: { commit, dirty, preprocessGFF3: { sha256: sha256File(script) } }`. `workdir.js` has `writeFileAtomic` / `writeJsonAtomic`; command records (`build.json`, `genome-build.json`, `survey.json`) are written with `writeJsonAtomic`. fetch errors are all `PipelineError('fetch', …)`.
- Collision fix lines (Tasks 13 and 17): suggest the `ids.tsv` line for an owner that has a level (gene, transcript or protein; never an exon or other level-less feature). If that owner's `old` already has an `ids.tsv` line, name that existing line number instead of suggesting a new line (a second line for the same `old` is the "repeated old" error).
- Tests: per task run only `node --test --test-reporter=dot tests/genome-<x>.test.js tests/import-graph.test.js`. Where a step says to run the full suite, do so only at Tasks 7, 13 and 21, with `--test-reporter=dot` (`node --test --test-reporter=dot --test-global-setup=tests/globalSetup.js tests/*.test.js`).

---

## Spec questions

All resolved by John on 2026-11-05; the spec is amended to match. The plan below implements the answers.

1. **No `locus_tag` in the golden genome.** E. cuniculi's GenBank GFF has no `locus_tag` attribute at all (0 of 909 features). *Resolved (accepted):* `ncbiDefault` gene ID = `locus_tag`, else the gene ID without its `gene-` prefix.
2. **`ncbiDefault` transcripts collided with their own genes.** Stripping `rna-` from every RNA gave each NCBI ncRNA transcript its gene's ID. *Resolved (proposal rejected; "keep the rna- prefix"):* under `ncbiDefault` an **mRNA**'s ID loses its `rna-` prefix; every other transcript (tRNA, rRNA, ncRNA, snRNA, …) keeps its NCBI ID unchanged. No `<geneId>_<type>` rule. Synthesized mRNAs stay `<geneId>_mRNA`.
3. **`ids.tsv` could not fix phase-1 or phase-2 collisions as ordered.** *Resolved (proposal rejected; "all in phase 1"):* an `ids.tsv` `old` is always an input ID as NCBI wrote it (the `old` column of `ids.default.tsv`), applied in phase 1 after the policy and before the collision check. Transform-created IDs cannot be overridden directly; they follow from the settled IDs. A created-ID collision error names the input ID whose `ids.tsv` line would fix it. Build phases: (1) IDs = policy + `ids.tsv` + collision check, (2) structural transforms, (3) partition.
4. **ECU11_0375 in the golden (determined).** Genes `gene-ECU11_0375` → `ECU11_0375` and `gene-ECU11_0375-2` → `ECU11_0375-2`; the tRNA keeps `rna-ECU11_0375`. Nothing collides (checked: 0 collisions in the fixture under the resolved policy). The golden still exercises `ids.tsv` with one real line, `gene	gene-ECU11_0375-2	ECU11_0375_2`: `ECU11_0375-2` is the only gene ID with a `-` after the policy, so the curator gives it an underscore form; the tRNA's `Parent` follows.
5. **`survey` on the raw graph missed attribute errors on features ISF would drop** (ECU10_0805's `is_ordered`). *Resolved (accepted):* `survey` also previews the suggested build in memory (`ncbiDefault`, `ids.tsv` if present, suggested structural transforms) and reports that preview's findings with `stage: "suggested"` (raw ones carry `stage: "raw"`). Suggested `stripAttributes` entries come from the preview. A collision or `ids.tsv` error in the preview is reported and the preview stops.

Questions 6–12 below were accepted as proposed.

6. **Where build's record lives (minor).** `finalize` must check `build/normalized.gff3` against a recorded sha256. *Accepted:* `build/build.json` holds the record; `build` also writes each partition's `chromosomeMap.txt` under `build/<partition>/`, and `finalize` copies it. `genome-build.json` is `build.json` plus the ApiCommonData commit, the `preprocessGFF3` sha256 and `finalizedAt`. It also carries `partitionsTsv` sha256, `warnings` and the non-error `findings` (not listed in the spec, but they are inputs to or results of the build).
7. **A partition with no features (minor).** An unannotated mitochondrion yields an empty GFF, and `preprocessGFF3` output would fail the non-empty check. *Proposed:* each `partitions[]` entry from `build` carries `featureCount`; `finalize` writes no `genome.gff` for a partition with `featureCount: 0`.
8. **Which GFF types are transcripts (minor).** *Proposed:* the RNA type list of `genemRNAExonCDS2BioperlTree` plus `ribozyme`, `RNase_P_RNA`, `tmRNA`, `Y_RNA`, `vault_RNA`. Gene level: `gene`, `pseudogene`, `protein_coding_gene`, `ncRNA_gene`. Protein level: `CDS`.
9. **"Feature type the ISF map does not handle" (minor).** *Proposed:* every feature the ported preprocessor drops (top-level types it ignores, genes that yield no tree, children of a missing parent) plus every ported node whose ISF type has no `<feature>` in the map. `region` is always dropped, so every NCBI build carries this warning.
10. **Port test target (minor).** IDs differ between the spike's preprocessing and ours, so the exact comparison (types, IDs, coordinates, qualifier keys) runs on the spike's own ISF input cut to X and XI (checked in as `isf/isf-input.gff3.gz`). The golden additionally checks types and coordinates of the pipeline's own build against `bioperltree.out`. Verified during planning: a prototype of the Task 7 port reproduces all 440 trees of the cut `bioperltree.out` with 0 differences.
11. **Fetch storage (minor).** NCBI serves `*_genomic.gff.gz` and `*_genomic.fna.gz`; `fetch` stores them as served and every reader gunzips by extension. A re-run re-downloads each file to compare its sha256 with `fetch.json` (literal spec; costly for large FASTAs — NCBI's `md5checksums.txt` is a cheaper later option).
12. **Organelle location types (minor).** Only `Mitochondrion`, `Apicoplast` and `Chloroplast` map to organelle partitions (`mitochondrial_chromosome`, `apicoplast_chromosome`, `chloroplast_chromosome`); any other location type is the "unknown location type" error, overridable by `partitions.tsv`. `chromosomeMap.txt` order is the 1-based position within the partition, in report order.

---

## File Structure

Created (all new):

| File | Responsibility |
|---|---|
| `shared/scripts/genome/workdir.js` | Work-area paths, `PipelineError` (command, file, next step), sha256, gz-aware text read, JSON read/write |
| `shared/scripts/genome/gff.js` | GFF3 ⇄ graph (lines, features, ordered raw attributes), groups, child index, renames, insert/remove, subset. The only line-level GFF code |
| `shared/scripts/genome/feature-types.js` | Gene / transcript / protein levels; ISF's RNA type list |
| `shared/scripts/genome/fasta.js` | Streaming FASTA index and subset-with-rename |
| `shared/scripts/genome/assembly-report.js` | NCBI assembly report parse, lookup, rank classification |
| `shared/scripts/genome/partitions.js` | `partitions.tsv`, partition plan, `chromosomeMap.txt` text |
| `shared/scripts/genome/isf-map.js` | ISF map XML reader; port of `genemRNAExonCDS2BioperlTree` (`isfTrees`) |
| `shared/scripts/genome/ids.js` | `ids.tsv`, `ncbiDefault`/`none` policy and `ids.tsv` overrides, all in phase 1 |
| `shared/scripts/genome/transforms/claim-ids.js` | Created-ID collision guard |
| `shared/scripts/genome/transforms/collapse-split-genes.js` | `collapseSplitGenes` |
| `shared/scripts/genome/transforms/strip-attributes.js` | `stripAttributes` and its arg check |
| `shared/scripts/genome/transforms/add-mrna-to-gene-cds.js` | `addMrnaToGeneCds` |
| `shared/scripts/genome/transforms/add-exon-per-cds.js` | `addExonPerCds` |
| `shared/scripts/genome/transforms/parent-orphan-rnas.js` | `parentOrphanRnas` |
| `shared/scripts/genome/transforms/index.js` | Registry, canonical order, recipe arg checks, `runTransforms` |
| `shared/scripts/genome/checks.js` | Every check `survey` and `build` share; finding format |
| `shared/scripts/genome/preprocess-gff3.js` | `perl -c` precheck, run `preprocessGFF3`, ApiCommonData commit |
| `shared/scripts/genome/commands/fetch.js` | `fetch` and `verifyFetch` |
| `shared/scripts/genome/commands/inputs.js` | Loading the ISF map, inputs, `ids.tsv`, `partitions.tsv` for commands |
| `shared/scripts/genome/commands/survey.js` | `survey` |
| `shared/scripts/genome/commands/build.js` | `build` |
| `shared/scripts/genome/commands/finalize.js` | `finalize` |
| `shared/scripts/genome/genome-pipeline.js` | CLI (the spec's "commands" module; the command bodies live in `commands/` to keep files focused) |
| `tests/genome-helpers.js` | Tiny synthetic genome, GFF/report builders, NCBI stub, fake ApiCommonData, bioperltree parser, Dbxref normalizer |
| `tests/genome-*.test.js` | One per module/command, plus `genome-golden.test.js` |
| `tests/fixtures/genome/isf-map-mini.xml` | Cut-down ISF map for unit tests (Task 6) |
| `tests/fixtures/genome/ecun/expected/…` | Golden outputs, generated and reviewed in Task 20 |

Fixtures already in the worktree (created while planning, cut from the spike's NCBI download and trial run with throwaway scripts; chromosomes X = `AL590449.1` and XI = `AL590450.2`):

| File | Size | Content |
|---|---|---|
| `tests/fixtures/genome/ecun/fetch/GCA_000091225.2_ASM9122v2_genomic.gff.gz` | 39 KB | NCBI GFF, header + X and XI blocks + `###` (920 lines, 909 features) |
| `tests/fixtures/genome/ecun/fetch/GCA_000091225.2_ASM9122v2_genomic.fna.gz` | 167 KB | X and XI (537,101 bytes uncompressed) |
| `tests/fixtures/genome/ecun/fetch/GCA_000091225.2_ASM9122v2_assembly_report.txt` | 1.3 KB | Report header + X and XI rows, CRLF as NCBI serves it |
| `tests/fixtures/genome/ecun/isf/isf-input.gff3.gz` | 48 KB | The spike's `genome.normalized.stripped.gff3` (what ISF read), cut to X and XI |
| `tests/fixtures/genome/ecun/isf/bioperltree.out.gz` | 19 KB | ISF's `--bioperlTreeOutput` from the spike, cut to the 440 trees on X and XI |
| `tests/fixtures/genome/ecun/recipe.json` | — | The golden recipe |
| `tests/fixtures/genome/ecun/ids.tsv` | — | `gene	gene-ECU11_0375-2	ECU11_0375_2` |

Modified: `package.json` and `.claude-plugin/plugin.json` (3.0.0 → 3.1.0), `docs/development.md` (genome pipeline section).

### Facts the golden asserts (computed from the cut fixtures during planning)

- Raw: 2 sequences; 438 gene lines, 436 gene IDs; ECU10_0805 is the only split gene (3 lines: 110270–110296, 110085–110241, 109856–110061, minus strand, `is_ordered=true` on each); 428 genes have CDS and no RNA (424 CDS-only + 4 CDS+intron); 436 CDS lines in 428 CDS IDs; 8 gene-parented tRNAs; 6 parentless RNAs (X: `SRP_RNA` 138959–139146; XI: `snRNA` ×3, `snoRNA`, `RNase_MRP_RNA`); no `locus_tag`; no PMID or `previous_systematic_id`.
- Ported ISF view of the raw GFF: 12 trees, 434 dropped (2 `region`, 430 gene lines, `SRP_RNA`, `RNase_MRP_RNA`).
- Under the resolved `ncbiDefault`: `ids.default.tsv` 864 rows (436 genes + 0 transcripts, as the raw GFF has no mRNA, + 428 proteins); 0 collisions; the one gene ID left with a `-` is `ECU11_0375-2`, which the golden `ids.tsv` renames (1 override applied).
- Build with the golden recipe: transform changes 1, 428, 428 (436 exons), 6, 1; normalized GFF 1777 feature lines; ported ISF view 442 trees (428 `coding_gene`, 8 `tRNA_gene`, 3 `snRNA_gene`, 1 `snoRNA_gene`, 1 `SRP_RNA_gene`, 1 `RNase_MRP_RNA_gene`), dropped 2 `region`.
- `preprocessGFF3` emits one line per feature (comments dropped): 1777 lines. With `use Bio::SeqIO;` removed it compiles on this host's perl 5.38 with core modules only (checked); unpatched it fails with `Can't locate Bio/SeqIO.pm`.

---

## Tasks

### Task 1: Work area, errors and checksums (`workdir.js`)

**Files:**
- Create: `shared/scripts/genome/workdir.js`
- Test: `tests/genome-workdir.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { PipelineError, readJson, readText, sha256, sha256File, workPaths, writeJson } from '../shared/scripts/genome/workdir.js';

const scratch = () => mkdtempSync(join(tmpdir(), 'genome-workdir-'));

test('a PipelineError names the command, the file and the next step', () => {
  const e = new PipelineError('build', 'recipe.json', 'is missing', 'copy suggestedRecipe from survey.json');
  assert.equal(e.message, 'build: recipe.json: is missing\nNext: copy suggestedRecipe from survey.json');
  assert.equal(e.command, 'build');
  assert.equal(e.file, 'recipe.json');
  assert.equal(e.problem, 'is missing');
  assert.equal(e.next, 'copy suggestedRecipe from survey.json');
});

test('workPaths lays out the work area', () => {
  const p = workPaths('/w');
  assert.equal(p.fetchDir, '/w/fetch');
  assert.equal(p.fetchJson, '/w/fetch/fetch.json');
  assert.equal(p.surveyJson, '/w/survey.json');
  assert.equal(p.idsDefault, '/w/ids.default.tsv');
  assert.equal(p.buildJson, '/w/build/build.json');
  assert.equal(p.normalized, '/w/build/normalized.gff3');
  assert.equal(p.finalDir, '/w/final');
  assert.equal(p.genomeBuildJson, '/w/genome-build.json');
});

test('readText reads plain and gzipped files alike', () => {
  const dir = scratch();
  writeFileSync(join(dir, 'a.txt'), 'hello\n');
  writeFileSync(join(dir, 'a.txt.gz'), gzipSync('hello\n'));
  assert.equal(readText(join(dir, 'a.txt')), 'hello\n');
  assert.equal(readText(join(dir, 'a.txt.gz')), 'hello\n');
});

test('sha256 of text and of a file agree', () => {
  const dir = scratch();
  writeFileSync(join(dir, 'abc'), 'abc');
  assert.equal(sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(sha256File(join(dir, 'abc')), sha256('abc'));
});

test('readJson refuses a missing file with the next step; writeJson round-trips', () => {
  const dir = scratch();
  assert.throws(() => readJson(join(dir, 'survey.json'), 'build', 'run survey first'),
    (e) => e instanceof PipelineError && /^build: .*survey\.json: is missing\nNext: run survey first$/.test(e.message));
  writeJson(join(dir, 'x', 'y.json'), { a: 1 });
  assert.deepEqual(readJson(join(dir, 'x', 'y.json'), 'build', 'n/a'), { a: 1 });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/genome-workdir.test.js`
Expected: FAIL with `Cannot find module '…/shared/scripts/genome/workdir.js'`.

- [ ] **Step 3: Implement**

```js
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { gunzipSync } from 'node:zlib';

/** A failure that names the command, the file and the next step. */
export class PipelineError extends Error {
  constructor(command, file, problem, next) {
    super(`${command}: ${file}: ${problem}\nNext: ${next}`);
    this.name = 'PipelineError';
    Object.assign(this, { command, file, problem, next });
  }
}

export function workPaths(workDir) {
  const buildDir = join(workDir, 'build');
  return {
    fetchDir: join(workDir, 'fetch'),
    fetchJson: join(workDir, 'fetch', 'fetch.json'),
    surveyJson: join(workDir, 'survey.json'),
    recipeJson: join(workDir, 'recipe.json'),
    idsTsv: join(workDir, 'ids.tsv'),
    idsDefault: join(workDir, 'ids.default.tsv'),
    partitionsTsv: join(workDir, 'partitions.tsv'),
    buildDir,
    buildJson: join(buildDir, 'build.json'),
    normalized: join(buildDir, 'normalized.gff3'),
    finalDir: join(workDir, 'final'),
    genomeBuildJson: join(workDir, 'genome-build.json')
  };
}

export const sha256 = (data) => createHash('sha256').update(data).digest('hex');
export const sha256File = (path) => sha256(readFileSync(path));

export function readText(path) {
  const bytes = readFileSync(path);
  return (path.endsWith('.gz') ? gunzipSync(bytes) : bytes).toString('utf-8');
}

export function readJson(path, command, next) {
  if (!existsSync(path)) throw new PipelineError(command, path, 'is missing', next);
  return JSON.parse(readFileSync(path, 'utf-8'));
}

export function writeText(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

export const writeJson = (path, value) => writeText(path, `${JSON.stringify(value, null, 2)}\n`);
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test tests/genome-workdir.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add shared/scripts/genome/workdir.js tests/genome-workdir.test.js
git commit -m "Genome pipeline: work area, PipelineError, checksums

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: GFF graph and feature levels (`gff.js`, `feature-types.js`)

**Files:**
- Create: `shared/scripts/genome/gff.js`, `shared/scripts/genome/feature-types.js`, `tests/genome-helpers.js`
- Test: `tests/genome-gff.test.js`

The graph is `{ lines: [{ kind: 'comment', text } | { kind: 'feature', feature }], trailingNewline }`. A feature is `{ seqId, source, type, start, end, score, strand, phase, attrs }` where `attrs` is an ordered list of `[key, rawValue]` (values stay percent-encoded, so serialization is byte-identical; `decode` reads them). Lines sharing an ID and type are one feature *group* (CDS segments, split genes).

- [ ] **Step 1: Create the test helpers**

`tests/genome-helpers.js` (later tasks append to it):

```js
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const genomeFixtures = new URL('./fixtures/genome/', import.meta.url).pathname;
const ecunFetch = join(genomeFixtures, 'ecun/fetch');
export const ECUN_GFF = join(ecunFetch, 'GCA_000091225.2_ASM9122v2_genomic.gff.gz');
export const ECUN_FASTA = join(ecunFetch, 'GCA_000091225.2_ASM9122v2_genomic.fna.gz');
export const ECUN_REPORT = join(ecunFetch, 'GCA_000091225.2_ASM9122v2_assembly_report.txt');
export const tempDir = (prefix) => mkdtempSync(join(tmpdir(), prefix));

/** One GFF3 feature line; CDS lines get phase 0. */
export const gffLine = (seqId, type, start, end, strand, attrs) =>
  [seqId, 'EMBL', type, start, end, '.', strand, type === 'CDS' ? '0' : '.', attrs].join('\t');
export const gffText = (...lines) => `##gff-version 3\n${lines.join('\n')}\n`;

export const CM = 'CM000001.1';
export const KZ = 'KZ000002.1';

/** A two-sequence NCBI GenBank-style GFF with every shape the transforms fix. */
export const TINY_GFF = [
  '##gff-version 3',
  `##sequence-region ${CM} 1 2000`,
  gffLine(CM, 'region', 1, 2000, '+', `ID=${CM}:1..2000;gbkey=Src;mol_type=genomic DNA`),
  gffLine(CM, 'gene', 100, 400, '+', 'ID=gene-TST_0010;Name=TST_0010;gbkey=Gene;gene=TST_0010;gene_biotype=protein_coding'),
  gffLine(CM, 'CDS', 100, 200, '+', 'ID=cds-PRT1.1;Parent=gene-TST_0010;Dbxref=NCBI_GP:PRT1.1,UniProtKB/TrEMBL:Q00001;gbkey=CDS;product=hypothetical protein;protein_id=PRT1.1'),
  gffLine(CM, 'CDS', 300, 400, '+', 'ID=cds-PRT1.1;Parent=gene-TST_0010;Dbxref=NCBI_GP:PRT1.1,UniProtKB/TrEMBL:Q00001;gbkey=CDS;product=hypothetical protein;protein_id=PRT1.1'),
  gffLine(CM, 'gene', 800, 900, '-', 'ID=gene-TST_0020;Name=TST_0020;gbkey=Gene;gene=TST_0020;gene_biotype=protein_coding;is_ordered=true'),
  gffLine(CM, 'gene', 500, 700, '-', 'ID=gene-TST_0020;Name=TST_0020;gbkey=Gene;gene=TST_0020;gene_biotype=protein_coding;is_ordered=true'),
  gffLine(CM, 'CDS', 800, 900, '-', 'ID=cds-PRT2.1;Parent=gene-TST_0020;gbkey=CDS;protein_id=PRT2.1'),
  gffLine(CM, 'CDS', 500, 700, '-', 'ID=cds-PRT2.1;Parent=gene-TST_0020;gbkey=CDS;protein_id=PRT2.1'),
  gffLine(CM, 'gene', 1000, 1072, '+', 'ID=gene-TST_0030;Name=TST_0030;gbkey=Gene;gene=TST_0030;gene_biotype=tRNA'),
  gffLine(CM, 'tRNA', 1000, 1072, '+', 'ID=rna-TST_0030;Parent=gene-TST_0030;Note=tRNA-Leu%2C anticodon TAG;gbkey=tRNA;product=tRNA-Leu'),
  gffLine(CM, 'exon', 1000, 1072, '+', 'ID=exon-TST_0030-1;Parent=rna-TST_0030;gbkey=tRNA;product=tRNA-Leu'),
  gffLine(CM, 'snRNA', 1200, 1300, '+', `ID=rna-${CM}:1200..1300;gbkey=ncRNA;product=U4 snRNA`),
  gffLine(CM, 'exon', 1200, 1300, '+', `ID=exon-${CM}:1200..1300-1;Parent=rna-${CM}:1200..1300;gbkey=ncRNA;product=U4 snRNA`),
  `##sequence-region ${KZ} 1 600`,
  gffLine(KZ, 'gene', 10, 300, '+', 'ID=gene-TST_0040;Name=TST_0040;gbkey=Gene;gene=TST_0040;gene_biotype=protein_coding'),
  gffLine(KZ, 'CDS', 10, 300, '+', 'ID=cds-PRT4.1;Parent=gene-TST_0040;gbkey=CDS;protein_id=PRT4.1'),
  '###'
].join('\n') + '\n';

/** TINY_GFF plus a gene whose mRNA is named for the same locus: ncbiDefault gives both the ID TST_0050. */
export const TINY_COLLIDING_GFF = TINY_GFF.replace(`##sequence-region ${KZ}`, [
  gffLine(CM, 'gene', 1400, 1500, '+', 'ID=gene-TST_0050;Name=TST_0050;gbkey=Gene;gene=TST_0050;gene_biotype=protein_coding'),
  gffLine(CM, 'mRNA', 1400, 1500, '+', 'ID=rna-TST_0050;Parent=gene-TST_0050;gbkey=mRNA'),
  gffLine(CM, 'exon', 1400, 1500, '+', 'ID=exon-TST_0050-1;Parent=rna-TST_0050;gbkey=mRNA'),
  gffLine(CM, 'CDS', 1400, 1500, '+', 'ID=cds-PRT5.1;Parent=rna-TST_0050;gbkey=CDS;protein_id=PRT5.1'),
  `##sequence-region ${KZ}`
].join('\n'));
```

- [ ] **Step 2: Write the failing test** (`tests/genome-gff.test.js`)

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import {
  decode, deleteAttrs, featureGroups, features, getValues, idOf, indexGraph, newFeature, parentsOf,
  parseGff, renameIds, renameSequences, serializeGff, setAttr, subsetGff, withInsertions, withoutFeatures
} from '../shared/scripts/genome/gff.js';
import { levelOf } from '../shared/scripts/genome/feature-types.js';
import { ECUN_GFF, genomeFixtures, gffLine, gffText, TINY_GFF } from './genome-helpers.js';

test('parse then serialize is byte-identical for NCBI escaping, multi-value attributes and comments', () => {
  const text = [
    '##gff-version 3',
    '#!processor NCBI annotwriter',
    gffLine('chr1', 'CDS', 1, 9, '+', 'ID=cds-1;Parent=gene-1;Dbxref=GOA:Q1,InterPro:IPR1;Note=a%2C b%3B c%3D d;product=x'),
    gffLine('chr1', 'gene', 1, 9, '+', 'ID=gene-1;isFminPartial;partial=true;'),
    'chr1\tEMBL\tregion\t1\t100\t.\t+\t.\t.',
    '',
    '###'
  ].join('\n');
  assert.equal(serializeGff(parseGff(text)), text);
  assert.equal(serializeGff(parseGff(`${text}\n`)), `${text}\n`);
});

test('the E. cuniculi fixture GFFs round-trip byte for byte', () => {
  for (const path of [ECUN_GFF, join(genomeFixtures, 'ecun/isf/isf-input.gff3.gz')]) {
    const text = gunzipSync(readFileSync(path)).toString('utf-8');
    assert.equal(serializeGff(parseGff(text)), text);
  }
});

test('a line without nine columns is refused with its line number', () => {
  assert.throws(() => parseGff('##gff-version 3\nchr1\tEMBL\tgene\n'), /GFF line 2 has 3 tab-separated columns, not 9/);
});

test('attribute helpers read raw values and decode on request', () => {
  const [cds] = features(parseGff(TINY_GFF)).filter((f) => f.type === 'CDS');
  assert.equal(idOf(cds), 'cds-PRT1.1');
  assert.deepEqual(parentsOf(cds), ['gene-TST_0010']);
  assert.deepEqual(getValues(cds, 'Dbxref'), ['NCBI_GP:PRT1.1', 'UniProtKB/TrEMBL:Q00001']);
  assert.equal(decode('tRNA-Leu%2C anticodon TAG'), 'tRNA-Leu, anticodon TAG');
});

test('setAttr puts a new Parent right after ID; deleteAttrs reports a change', () => {
  const [snRNA] = features(parseGff(TINY_GFF)).filter((f) => f.type === 'snRNA');
  setAttr(snRNA, 'Parent', 'g1');
  assert.deepEqual(snRNA.attrs.map(([k]) => k), ['ID', 'Parent', 'gbkey', 'product']);
  setAttr(snRNA, 'note', 'x');
  assert.deepEqual(snRNA.attrs.at(-1), ['note', 'x']);
  assert.equal(deleteAttrs(snRNA, ['gbkey', 'absent']), true);
  assert.equal(deleteAttrs(snRNA, ['absent']), false);
});

test('featureGroups joins the lines of one feature and keeps file order', () => {
  const groups = featureGroups(parseGff(TINY_GFF));
  assert.equal(groups.find((g) => g.id === 'gene-TST_0020').lines.length, 2);
  assert.equal(groups.find((g) => g.id === 'cds-PRT1.1').lines.length, 2);
  assert.deepEqual(groups.slice(0, 3).map((g) => g.id), ['CM000001.1:1..2000', 'gene-TST_0010', 'cds-PRT1.1']);
});

test('renameIds moves IDs and every Parent; renameSequences moves seqIds and sequence-region lines', () => {
  const graph = parseGff(TINY_GFF);
  renameIds(graph, new Map([['gene-TST_0010', 'TST_0010']]));
  renameSequences(graph, new Map([['KZ000002.1', 'scaffold2']]));
  const text = serializeGff(graph);
  assert.match(text, /\tID=TST_0010;Name=TST_0010;/);
  assert.match(text, /ID=cds-PRT1\.1;Parent=TST_0010;/);
  assert.match(text, /^##sequence-region scaffold2 1 600$/m);
  assert.match(text, /^scaffold2\tEMBL\tgene\t10\t300\t/m);
});

test('withInsertions and withoutFeatures return new graphs in one pass', () => {
  const graph = parseGff(gffText(gffLine('c', 'gene', 1, 9, '+', 'ID=g'), gffLine('c', 'CDS', 1, 9, '+', 'ID=c;Parent=g')));
  const [gene, cds] = features(graph);
  const mrna = newFeature({ seqId: 'c', source: 'EMBL', type: 'mRNA', start: 1, end: 9, strand: '+', attrs: [['ID', 'm'], ['Parent', 'g']] });
  const grown = withInsertions(graph, { after: new Map([[gene, [mrna]]]) });
  assert.deepEqual(features(grown).map((f) => f.type), ['gene', 'mRNA', 'CDS']);
  assert.match(serializeGff(grown), /\tmRNA\t1\t9\t\.\t\+\t\.\tID=m;Parent=g\n/);
  assert.deepEqual(features(withInsertions(graph, { before: new Map([[gene, [mrna]]]) })).map((f) => f.type), ['mRNA', 'gene', 'CDS']);
  assert.deepEqual(features(withoutFeatures(grown, new Set([cds]))).map((f) => f.type), ['gene', 'mRNA']);
  assert.equal(features(graph).length, 2);
});

test('indexGraph finds children by parent ID', () => {
  const { childrenOf } = indexGraph(parseGff(TINY_GFF));
  assert.deepEqual(childrenOf('gene-TST_0020').map((f) => f.start), [800, 500]);
  assert.deepEqual(childrenOf('nothing'), []);
});

test('subsetGff keeps the header, the chosen sequences and their sequence-region blocks', () => {
  const kz = TINY_GFF.split('\n').filter((l) => l.startsWith('KZ000002.1'));
  assert.equal(serializeGff(subsetGff(parseGff(TINY_GFF), new Set(['KZ000002.1']))),
    ['##gff-version 3', '##sequence-region KZ000002.1 1 600', ...kz, '###', ''].join('\n'));
});

test('levelOf sorts types into gene, transcript and protein', () => {
  assert.equal(levelOf('gene'), 'gene');
  assert.equal(levelOf('pseudogene'), 'gene');
  assert.equal(levelOf('mRNA'), 'transcript');
  assert.equal(levelOf('ribozyme'), 'transcript');
  assert.equal(levelOf('CDS'), 'protein');
  assert.equal(levelOf('exon'), null);
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `node --test tests/genome-gff.test.js`
Expected: FAIL with `Cannot find module '…/genome/gff.js'`.

- [ ] **Step 4: Implement `shared/scripts/genome/feature-types.js`**

```js
export const GENE_TYPES = new Set(['gene', 'pseudogene', 'protein_coding_gene', 'ncRNA_gene']);

/** The child types ApiCommonData::Load::genemRNAExonCDS2BioperlTree loads as transcripts. */
export const ISF_RNA_TYPES = new Set([
  'mRNA', 'transcript', 'misc_RNA', 'guide_RNA', 'siRNA', 'rRNA', 'snRNA', 'snoRNA', 'tRNA', 'ncrna', 'ncRNA',
  'lncRNA', 'lincRNA', 'lnc_RNA', 'miRNA', 'scaRNA', 'pseudogenic_transcript', 'scRNA', 'srpRNA', 'SRP.RNA',
  'RNase_MRP_RNA', 'SRP_RNA', 'pre_miRNA', 'antisense_RNA', 'telomerase_RNA', 'V_gene_segment', 'C_gene_segment',
  'primary_transcript', 'piRNA', 'circular_ncRNA', 'miRNA_primary_transcript', 'nc_primary_transcript', 'precursor_RNA'
]);

export const TRANSCRIPT_TYPES = new Set([...ISF_RNA_TYPES, 'ribozyme', 'RNase_P_RNA', 'tmRNA', 'Y_RNA', 'vault_RNA']);

export function levelOf(type) {
  if (GENE_TYPES.has(type)) return 'gene';
  if (TRANSCRIPT_TYPES.has(type)) return 'transcript';
  return type === 'CDS' ? 'protein' : null;
}
```

- [ ] **Step 5: Implement `shared/scripts/genome/gff.js`**

```js
export function parseGff(text) {
  const raw = text.split('\n');
  const trailingNewline = raw.at(-1) === '';
  if (trailingNewline) raw.pop();
  const lines = raw.map((line, i) => {
    if (line === '' || line.startsWith('#')) return { kind: 'comment', text: line };
    const cols = line.split('\t');
    if (cols.length !== 9) throw new Error(`GFF line ${i + 1} has ${cols.length} tab-separated columns, not 9`);
    return { kind: 'feature', feature: parseFeature(cols) };
  });
  return { lines, trailingNewline };
}

function parseFeature([seqId, source, type, start, end, score, strand, phase, col9]) {
  const feature = { seqId, source, type, start: Number(start), end: Number(end), score, strand, phase, attrs: [] };
  if (col9 === '.' || col9 === '') return { ...feature, emptyAttrs: col9 };
  const trailingSemicolon = col9.endsWith(';');
  feature.attrs = (trailingSemicolon ? col9.slice(0, -1) : col9).split(';').map((kv) => {
    const i = kv.indexOf('=');
    return i < 0 ? [kv, null] : [kv.slice(0, i), kv.slice(i + 1)];
  });
  return trailingSemicolon ? { ...feature, trailingSemicolon } : feature;
}

export function serializeFeature(f) {
  const col9 = f.attrs.length
    ? f.attrs.map(([k, v]) => (v === null ? k : `${k}=${v}`)).join(';') + (f.trailingSemicolon ? ';' : '')
    : (f.emptyAttrs ?? '.');
  return [f.seqId, f.source, f.type, f.start, f.end, f.score, f.strand, f.phase, col9].join('\t');
}

export function serializeGff(graph) {
  const text = graph.lines.map((l) => (l.kind === 'comment' ? l.text : serializeFeature(l.feature))).join('\n');
  return graph.trailingNewline ? `${text}\n` : text;
}

export const newFeature = ({ seqId, source, type, start, end, strand, attrs }) =>
  ({ seqId, source, type, start, end, score: '.', strand, phase: '.', attrs });

export const features = (graph) => graph.lines.filter((l) => l.kind === 'feature').map((l) => l.feature);
export const seqIdsOf = (graph) => [...new Set(features(graph).map((f) => f.seqId))];

export const getAttr = (f, key) => f.attrs.find(([k]) => k === key)?.[1] ?? null;
export const getValues = (f, key) => { const v = getAttr(f, key); return v ? v.split(',') : []; };
export const idOf = (f) => getAttr(f, 'ID');
export const parentsOf = (f) => getValues(f, 'Parent');
export const decode = (value) => value.replace(/%([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

export function setAttr(f, key, value) {
  const existing = f.attrs.find(([k]) => k === key);
  if (existing) { existing[1] = value; return; }
  const afterId = f.attrs.findIndex(([k]) => k === 'ID') + 1;
  f.attrs.splice(key === 'Parent' && afterId > 0 ? afterId : f.attrs.length, 0, [key, value]);
}

export function deleteAttrs(f, keys) {
  const kept = f.attrs.filter(([k]) => !keys.includes(k));
  const changed = kept.length !== f.attrs.length;
  f.attrs = kept;
  return changed;
}

/** Lines sharing an ID and type are one feature; lines without an ID stand alone. */
export function featureGroups(graph) {
  const groups = [];
  const byKey = new Map();
  for (const f of features(graph)) {
    const id = idOf(f);
    const key = id === null ? null : `${id}\t${f.type}`;
    if (key !== null && byKey.has(key)) { byKey.get(key).lines.push(f); continue; }
    const group = { id, type: f.type, lines: [f] };
    groups.push(group);
    if (key !== null) byKey.set(key, group);
  }
  return groups;
}

export function indexGraph(graph) {
  const children = new Map();
  for (const f of features(graph)) {
    for (const p of parentsOf(f)) {
      if (!children.has(p)) children.set(p, []);
      children.get(p).push(f);
    }
  }
  return { childrenOf: (id) => children.get(id) ?? [] };
}

export function renameIds(graph, mapping) {
  for (const f of features(graph)) {
    const id = idOf(f);
    if (id !== null && mapping.has(id)) setAttr(f, 'ID', mapping.get(id));
    const parents = parentsOf(f);
    if (parents.some((p) => mapping.has(p))) setAttr(f, 'Parent', parents.map((p) => mapping.get(p) ?? p).join(','));
  }
}

export function renameSequences(graph, mapping) {
  for (const line of graph.lines) {
    if (line.kind === 'feature') { line.feature.seqId = mapping.get(line.feature.seqId) ?? line.feature.seqId; continue; }
    const region = line.text.match(/^##sequence-region\s+(\S+)/);
    if (region && mapping.has(region[1])) line.text = line.text.replace(region[1], mapping.get(region[1]));
  }
}

export function withInsertions(graph, { before = new Map(), after = new Map() }) {
  const wrap = (fs) => (fs ?? []).map((feature) => ({ kind: 'feature', feature }));
  const lines = graph.lines.flatMap((line) =>
    (line.kind === 'feature' ? [...wrap(before.get(line.feature)), line, ...wrap(after.get(line.feature))] : [line]));
  return { ...graph, lines };
}

export const withoutFeatures = (graph, drop) =>
  ({ ...graph, lines: graph.lines.filter((l) => l.kind !== 'feature' || !drop.has(l.feature)) });

/** Header lines, `###`, and the features and sequence-region blocks of the chosen sequences. */
export function subsetGff(graph, seqIds) {
  let block = null;
  const lines = graph.lines.filter((line) => {
    if (line.kind === 'feature') return seqIds.has(line.feature.seqId);
    const region = line.text.match(/^##sequence-region\s+(\S+)/);
    if (region) block = region[1];
    return line.text === '###' || block === null || seqIds.has(block);
  });
  return { ...graph, lines };
}
```

- [ ] **Step 6: Run it to verify it passes**

Run: `node --test tests/genome-gff.test.js`
Expected: PASS, 11 tests.

- [ ] **Step 7: Commit**

```bash
git add shared/scripts/genome/gff.js shared/scripts/genome/feature-types.js tests/genome-helpers.js tests/genome-gff.test.js
git commit -m "Genome pipeline: GFF graph with byte-identical round trip; feature levels

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Streaming FASTA (`fasta.js`)

**Files:**
- Create: `shared/scripts/genome/fasta.js`
- Test: `tests/genome-fasta.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { readFastaIndex, writeFastaSubset } from '../shared/scripts/genome/fasta.js';
import { ECUN_FASTA, tempDir } from './genome-helpers.js';

const FASTA = '>chr1 first\nACGTACGTAC\nACGT\n>chr2 second\nAAAA\n>chr3\nCC\n';

test('readFastaIndex lists IDs and lengths from plain or gzipped FASTA', async () => {
  const dir = tempDir('fasta-');
  writeFileSync(join(dir, 'a.fna'), FASTA);
  writeFileSync(join(dir, 'a.fna.gz'), gzipSync(FASTA));
  const expected = [{ id: 'chr1', length: 14 }, { id: 'chr2', length: 4 }, { id: 'chr3', length: 2 }];
  assert.deepEqual(await readFastaIndex(join(dir, 'a.fna')), expected);
  assert.deepEqual(await readFastaIndex(join(dir, 'a.fna.gz')), expected);
});

test('CRLF FASTA reads as lines', async () => {
  const dir = tempDir('fasta-');
  writeFileSync(join(dir, 'crlf.fna'), '>a x\r\nAC\r\nGT\r\n');
  assert.deepEqual(await readFastaIndex(join(dir, 'crlf.fna')), [{ id: 'a', length: 4 }]);
});

test('writeFastaSubset keeps the chosen sequences, renamed in place', async () => {
  const dir = tempDir('fasta-');
  writeFileSync(join(dir, 'a.fna.gz'), gzipSync(FASTA));
  await writeFastaSubset(join(dir, 'a.fna.gz'), join(dir, 'out.fna'), new Set(['chr1', 'seq3']), new Map([['chr3', 'seq3']]));
  assert.equal(readFileSync(join(dir, 'out.fna'), 'utf-8'), '>chr1 first\nACGTACGTAC\nACGT\n>seq3\nCC\n');
});

test('a subset of every sequence copies the FASTA byte for byte', async () => {
  const out = join(tempDir('fasta-'), 'all.fna');
  await writeFastaSubset(ECUN_FASTA, out, new Set(['AL590449.1', 'AL590450.2']));
  assert.equal(readFileSync(out, 'utf-8'), gunzipSync(readFileSync(ECUN_FASTA)).toString('utf-8'));
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/genome-fasta.test.js`
Expected: FAIL with `Cannot find module '…/genome/fasta.js'`.

- [ ] **Step 3: Implement**

```js
import { createReadStream, createWriteStream } from 'node:fs';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';

function lines(path) {
  const raw = createReadStream(path);
  return createInterface({ input: path.endsWith('.gz') ? raw.pipe(createGunzip()) : raw, crlfDelay: Infinity });
}

export const fastaId = (header) => header.slice(1).split(/\s/)[0];

export async function readFastaIndex(path) {
  const seqs = [];
  let current = null;
  for await (const line of lines(path)) {
    if (line.startsWith('>')) { current = { id: fastaId(line), length: 0 }; seqs.push(current); }
    else if (current) current.length += line.trim().length;
  }
  return seqs;
}

/** Copies the sequences whose (renamed) ID is in `ids`; a renamed header keeps its description. */
export async function writeFastaSubset(src, dest, ids, rename = new Map()) {
  const out = createWriteStream(dest);
  let keep = false;
  for await (const line of lines(src)) {
    let text = line;
    if (line.startsWith('>')) {
      const id = fastaId(line);
      const newId = rename.get(id) ?? id;
      keep = ids.has(newId);
      text = `>${newId}${line.slice(1 + id.length)}`;
    }
    if (keep && !out.write(`${text}\n`)) await once(out, 'drain');
  }
  out.end();
  await once(out, 'finish');
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test tests/genome-fasta.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add shared/scripts/genome/fasta.js tests/genome-fasta.test.js
git commit -m "Genome pipeline: streaming FASTA index and subset

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Assembly report (`assembly-report.js`)

**Files:**
- Create: `shared/scripts/genome/assembly-report.js`
- Test: `tests/genome-assembly-report.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classifySequence, findReportRow, parseAssemblyReport } from '../shared/scripts/genome/assembly-report.js';
import { ECUN_REPORT } from './genome-helpers.js';

test('parseAssemblyReport reads the NCBI report by header name, CRLF and all', () => {
  const report = parseAssemblyReport(readFileSync(ECUN_REPORT, 'utf-8'));
  assert.deepEqual(report.rows.map((r) => [r.sequenceName, r.role, r.locationType, r.genbank, r.refseq]), [
    ['X', 'assembled-molecule', 'Chromosome', 'AL590449.1', 'NC_003236.1'],
    ['XI', 'assembled-molecule', 'Chromosome', 'AL590450.2', 'NC_003237.2']
  ]);
  assert.equal(findReportRow(report, 'NC_003237.2').index, 1);
  assert.equal(findReportRow(report, 'AL590449.1').row.sequenceName, 'X');
  assert.equal(findReportRow(report, 'na'), null);
  assert.equal(findReportRow(report, 'AL000000.1'), null);
});

test('a report with no Sequence-Name header is refused', () => {
  assert.throws(() => parseAssemblyReport('# Assembly name: x\nI\tassembled-molecule\n'), /no "# Sequence-Name" header line/);
});

test('classifySequence ranks by role, location type and accession', () => {
  const row = (role, locationType, genbank) => ({ role, locationType, genbank });
  assert.deepEqual(classifySequence(row('assembled-molecule', 'Chromosome', 'CM000001.1')), { rank: 'chromosome' });
  assert.deepEqual(classifySequence(row('unplaced-scaffold', 'na', 'KZ000002.1')), { rank: 'supercontig' });
  assert.deepEqual(classifySequence(row('unplaced-scaffold', 'na', 'AAEX03000001.1')), { rank: 'contig' });
  assert.deepEqual(classifySequence(row('unlocalized-scaffold', 'Chromosome', 'JAAABC010000001.1')), { rank: 'contig' });
  assert.deepEqual(classifySequence(row('assembled-molecule', 'Mitochondrion', 'CM000003.1')),
    { rank: 'organelle', organelle: 'mitochondrion', soTerm: 'mitochondrial_chromosome' });
  assert.deepEqual(classifySequence(row('assembled-molecule', 'Apicoplast', 'CM000004.1')),
    { rank: 'organelle', organelle: 'apicoplast', soTerm: 'apicoplast_chromosome' });
  assert.deepEqual(classifySequence(row('unplaced-scaffold', 'na', 'na')), { problem: 'missingAccession' });
  assert.deepEqual(classifySequence(row('mystery-role', 'na', 'KZ000002.1')), { problem: 'unknownRole' });
  assert.deepEqual(classifySequence(row('assembled-molecule', 'Linkage Group', 'CM000005.1')), { problem: 'unknownLocationType' });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/genome-assembly-report.test.js`
Expected: FAIL with `Cannot find module '…/genome/assembly-report.js'`.

- [ ] **Step 3: Implement**

```js
const COLUMNS = {
  'Sequence-Name': 'sequenceName',
  'Sequence-Role': 'role',
  'Assigned-Molecule': 'assignedMolecule',
  'Assigned-Molecule-Location/Type': 'locationType',
  'GenBank-Accn': 'genbank',
  'RefSeq-Accn': 'refseq',
  'Sequence-Length': 'length'
};
const ORGANELLES = {
  Mitochondrion: { organelle: 'mitochondrion', soTerm: 'mitochondrial_chromosome' },
  Apicoplast: { organelle: 'apicoplast', soTerm: 'apicoplast_chromosome' },
  Chloroplast: { organelle: 'chloroplast', soTerm: 'chloroplast_chromosome' }
};
const NUCLEAR_ROLES = new Set(['assembled-molecule', 'unlocalized-scaffold', 'unplaced-scaffold', 'alt-scaffold', 'fix-patch', 'novel-patch']);
const NUCLEAR_LOCATIONS = new Set(['Chromosome', 'na']);
const WGS_CONTIG = /^[A-Z]{4,6}\d{8,}(\.\d+)?$/;

export function parseAssemblyReport(text) {
  const lines = text.split(/\r?\n/);
  const header = lines.find((l) => l.startsWith('# Sequence-Name'));
  if (!header) throw new Error('the assembly report has no "# Sequence-Name" header line');
  const names = header.slice(2).split('\t');
  const rows = lines.filter((l) => l && !l.startsWith('#')).map((l) => {
    const cells = l.split('\t');
    const row = {};
    names.forEach((name, i) => { if (COLUMNS[name]) row[COLUMNS[name]] = cells[i]; });
    return row;
  });
  const byAccession = new Map();
  rows.forEach((row, index) => {
    for (const acc of [row.genbank, row.refseq]) if (acc && acc !== 'na') byAccession.set(acc, { row, index });
  });
  return { rows, byAccession };
}

export const findReportRow = (report, seqId) => report.byAccession.get(seqId) ?? null;

export function classifySequence(row) {
  if (!row.genbank || row.genbank === 'na') return { problem: 'missingAccession' };
  if (ORGANELLES[row.locationType]) return { rank: 'organelle', ...ORGANELLES[row.locationType] };
  if (!NUCLEAR_ROLES.has(row.role)) return { problem: 'unknownRole' };
  if (!NUCLEAR_LOCATIONS.has(row.locationType)) return { problem: 'unknownLocationType' };
  if (row.role === 'assembled-molecule') return row.locationType === 'Chromosome' ? { rank: 'chromosome' } : { problem: 'unknownLocationType' };
  return { rank: WGS_CONTIG.test(row.genbank) ? 'contig' : 'supercontig' };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test tests/genome-assembly-report.test.js`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add shared/scripts/genome/assembly-report.js tests/genome-assembly-report.test.js
git commit -m "Genome pipeline: assembly report parse and rank

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Partitions (`partitions.js`)

**Files:**
- Create: `shared/scripts/genome/partitions.js`
- Modify: `tests/genome-helpers.js` (append `reportText`, `TINY_REPORT`)
- Test: `tests/genome-partitions.test.js`

- [ ] **Step 1: Append the report builder to `tests/genome-helpers.js`**

```js
const REPORT_HEADER = '# Sequence-Name\tSequence-Role\tAssigned-Molecule\tAssigned-Molecule-Location/Type\tGenBank-Accn\tRelationship\tRefSeq-Accn\tAssembly-Unit\tSequence-Length\tUCSC-style-name';

/** An NCBI assembly report (CRLF) from [name, role, locationType, genbank, refseq?] rows. */
export function reportText(rows) {
  const body = rows.map(([name, role, location, genbank, refseq = 'na']) =>
    [name, role, location === 'Chromosome' ? name : 'na', location, genbank, '=', refseq, 'Primary Assembly', '1000', 'na'].join('\t'));
  return [`# Assembly name:  TINY1`, REPORT_HEADER, ...body].join('\r\n') + '\r\n';
}

export const TINY_REPORT = reportText([
  ['chr1', 'assembled-molecule', 'Chromosome', CM, 'NC_000001.1'],
  ['scaffold2', 'unplaced-scaffold', 'na', KZ, 'NW_000002.1']
]);
```

- [ ] **Step 2: Write the failing test** (`tests/genome-partitions.test.js`)

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAssemblyReport } from '../shared/scripts/genome/assembly-report.js';
import { chromosomeMapText, isChromosomePrimary, planPartitions, publicPartition, readPartitionsTsv } from '../shared/scripts/genome/partitions.js';
import { reportText } from './genome-helpers.js';

const plan = (rows, sequenceIds, options = {}) => planPartitions({ sequenceIds, report: parseAssemblyReport(reportText(rows)), ...options });
const summary = (p) => p.partitions.map((x) => [x.dir, x.sequences.map((s) => s.id)]);
const CHR = ['1', 'assembled-molecule', 'Chromosome', 'CM000001.1'];
const SUPER = ['u2', 'unplaced-scaffold', 'na', 'KZ000002.1'];
const CONTIG = ['u1', 'unplaced-scaffold', 'na', 'AAEX03000001.1'];

test('chromosome primary with supercontig and contig secondaries', () => {
  const p = plan([CHR, CONTIG, SUPER], ['AAEX03000001.1', 'KZ000002.1', 'CM000001.1']);
  assert.deepEqual(summary(p), [
    ['final/primary_chromosome', ['CM000001.1']],
    ['final/secondary_supercontig', ['KZ000002.1']],
    ['final/secondary_contig', ['AAEX03000001.1']]
  ]);
  assert.deepEqual(p.problems, []);
  assert.deepEqual(publicPartition(p.partitions[0]), { role: 'primary', soTerm: 'chromosome', organelle: null, sequenceCount: 1, dir: 'final/primary_chromosome' });
  assert.equal(isChromosomePrimary(p.partitions[0]), true);
  assert.equal(isChromosomePrimary(p.partitions[1]), false);
});

test('supercontig primary with contig secondary', () => {
  assert.deepEqual(summary(plan([CONTIG, SUPER], ['KZ000002.1', 'AAEX03000001.1'])), [
    ['final/primary_supercontig', ['KZ000002.1']],
    ['final/secondary_contig', ['AAEX03000001.1']]
  ]);
});

test('contig only', () => {
  assert.deepEqual(summary(plan([CONTIG], ['AAEX03000001.1'])), [['final/primary_contig', ['AAEX03000001.1']]]);
});

test('each organelle is its own partition', () => {
  const p = plan([CHR, ['MT', 'assembled-molecule', 'Mitochondrion', 'CM000003.1'], ['API', 'assembled-molecule', 'Apicoplast', 'CM000004.1']],
    ['CM000001.1', 'CM000003.1', 'CM000004.1']);
  assert.deepEqual(summary(p), [
    ['final/primary_chromosome', ['CM000001.1']],
    ['final/organelle_apicoplast', ['CM000004.1']],
    ['final/organelle_mitochondrion', ['CM000003.1']]
  ]);
  assert.deepEqual(publicPartition(p.partitions[2]), { role: 'organelle', soTerm: 'mitochondrial_chromosome', organelle: 'mitochondrion', sequenceCount: 1, dir: 'final/organelle_mitochondrion' });
});

test('partitions.tsv overrides any sequence', () => {
  const overrides = readPartitionsTsv('sequence\trole\tsoTerm\torganelle\nAAEX03000001.1\tsecondary\tsupercontig\t\n');
  assert.deepEqual(summary(plan([CHR, CONTIG, SUPER], ['CM000001.1', 'AAEX03000001.1', 'KZ000002.1'], { overrides })), [
    ['final/primary_chromosome', ['CM000001.1']],
    ['final/secondary_supercontig', ['AAEX03000001.1', 'KZ000002.1']]
  ]);
});

test('report problems: missing accession, unknown role or location type, absent sequence, two primaries', () => {
  const p = plan([CHR, ['u1', 'unplaced-scaffold', 'na', 'na', 'NW_000009.1'], ['u2', 'mystery-role', 'na', 'KZ000002.1'], ['lg', 'assembled-molecule', 'Linkage Group', 'CM000005.1']],
    ['CM000001.1', 'NW_000009.1', 'KZ000002.1', 'CM000005.1', 'ZZ999999.1']);
  assert.deepEqual(p.problems, [
    { kind: 'missingAccession', sequence: 'NW_000009.1' },
    { kind: 'unknownRole', sequence: 'KZ000002.1' },
    { kind: 'unknownLocationType', sequence: 'CM000005.1' },
    { kind: 'notInReport', sequence: 'ZZ999999.1' }
  ]);
  const overrides = readPartitionsTsv('sequence\trole\tsoTerm\torganelle\nAAEX03000001.1\tprimary\tcontig\t\n');
  assert.deepEqual(plan([CHR, CONTIG], ['CM000001.1', 'AAEX03000001.1'], { overrides }).problems, [{ kind: 'multiplePrimary', sequence: 'chromosome, contig' }]);
});

test('a renamed sequence keeps its report row and order', () => {
  const p = plan([CHR], ['CM000001.1'], { renames: new Map([['CM000001.1', 'chr1']]) });
  assert.deepEqual(p.partitions[0].sequences, [{ id: 'chr1', name: '1' }]);
});

test('chromosomeMapText lists id, Sequence-Name and order', () => {
  const p = plan([CHR, ['2', 'assembled-molecule', 'Chromosome', 'CM000002.1']], ['CM000002.1', 'CM000001.1']);
  assert.equal(chromosomeMapText(p.partitions[0]), 'CM000001.1\t1\t1\nCM000002.1\t2\t2\n');
});

test('readPartitionsTsv refuses a bad header, role or organelle line', () => {
  assert.throws(() => readPartitionsTsv('seq\trole\n'), /partitions\.tsv header must be/);
  assert.throws(() => readPartitionsTsv('sequence\trole\tsoTerm\torganelle\nX\tmain\tchromosome\t\n'), /partitions\.tsv line 2: role must be one of primary, secondary, organelle/);
  assert.throws(() => readPartitionsTsv('sequence\trole\tsoTerm\torganelle\nX\torganelle\tmitochondrial_chromosome\t\n'), /partitions\.tsv line 2: an organelle partition needs its organelle/);
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `node --test tests/genome-partitions.test.js`
Expected: FAIL with `Cannot find module '…/genome/partitions.js'`.

- [ ] **Step 4: Implement**

```js
import { classifySequence, findReportRow } from './assembly-report.js';

const NUCLEAR_RANKS = ['chromosome', 'supercontig', 'contig'];
const ROLES = ['primary', 'secondary', 'organelle'];
const HEADER = 'sequence\trole\tsoTerm\torganelle';

export function readPartitionsTsv(text) {
  const [header, ...rows] = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (header !== HEADER) throw new Error('partitions.tsv header must be "sequence\\trole\\tsoTerm\\torganelle"');
  return rows.map((line, i) => {
    const where = `partitions.tsv line ${i + 2}`;
    const [sequence, role, soTerm, organelle = ''] = line.split('\t');
    if (!sequence) throw new Error(`${where}: sequence is empty`);
    if (!ROLES.includes(role)) throw new Error(`${where}: role must be one of ${ROLES.join(', ')}`);
    if (!soTerm) throw new Error(`${where}: soTerm is empty`);
    if (role === 'organelle' && !organelle) throw new Error(`${where}: an organelle partition needs its organelle`);
    return { sequence, role, soTerm, organelle: role === 'organelle' ? organelle : null };
  });
}

const dirOf = ({ role, soTerm, organelle }) => (role === 'organelle' ? `final/organelle_${organelle}` : `final/${role}_${soTerm}`);
const byOrder = (a, b) => (a.order === b.order ? 0 : a.order < b.order ? -1 : 1);
const rankOf = (p) => (p.role === 'organelle' ? NUCLEAR_RANKS.length : NUCLEAR_RANKS.indexOf(p.soTerm));

/** Sequence IDs are the input IDs; `renames` maps them to their final IDs. */
export function planPartitions({ sequenceIds, report, overrides = [], renames = new Map() }) {
  const overrideOf = new Map(overrides.map((o) => [o.sequence, o]));
  const placed = [];
  const problems = [];
  for (const id of sequenceIds) {
    const found = findReportRow(report, id);
    const seq = { id: renames.get(id) ?? id, name: found?.row.sequenceName ?? id, order: found?.index ?? Infinity };
    const override = overrideOf.get(id) ?? overrideOf.get(seq.id);
    if (override) { placed.push({ ...seq, role: override.role, soTerm: override.soTerm, organelle: override.organelle }); continue; }
    if (!found) { problems.push({ kind: 'notInReport', sequence: id }); continue; }
    const c = classifySequence(found.row);
    if (c.problem) { problems.push({ kind: c.problem, sequence: id }); continue; }
    placed.push(c.rank === 'organelle'
      ? { ...seq, role: 'organelle', soTerm: c.soTerm, organelle: c.organelle }
      : { ...seq, rank: c.rank });
  }
  const primaryRank = NUCLEAR_RANKS.find((r) => placed.some((p) => p.rank === r));
  for (const p of placed) {
    if (p.rank) Object.assign(p, { role: p.rank === primaryRank ? 'primary' : 'secondary', soTerm: p.rank, organelle: null });
  }
  const groups = new Map();
  for (const p of [...placed].sort(byOrder)) {
    const key = `${p.role}\t${p.soTerm}\t${p.organelle}`;
    if (!groups.has(key)) groups.set(key, { role: p.role, soTerm: p.soTerm, organelle: p.organelle, sequences: [] });
    groups.get(key).sequences.push({ id: p.id, name: p.name });
  }
  const partitions = [...groups.values()].map((g) => ({ ...g, dir: dirOf(g) }))
    .sort((a, b) => ROLES.indexOf(a.role) - ROLES.indexOf(b.role) || rankOf(a) - rankOf(b) || String(a.organelle).localeCompare(String(b.organelle)));
  const primaries = partitions.filter((p) => p.role === 'primary');
  if (primaries.length > 1) problems.push({ kind: 'multiplePrimary', sequence: primaries.map((p) => p.soTerm).join(', ') });
  if (partitions.length && !primaries.length) problems.push({ kind: 'noPrimary', sequence: '' });
  return { partitions, problems };
}

export const publicPartition = (p) =>
  ({ role: p.role, soTerm: p.soTerm, organelle: p.organelle, sequenceCount: p.sequences.length, dir: p.dir });

export const isChromosomePrimary = (p) => p.role === 'primary' && p.soTerm === 'chromosome';

export const chromosomeMapText = (p) => p.sequences.map((s, i) => `${s.id}\t${s.name}\t${i + 1}\n`).join('');
```

- [ ] **Step 5: Run it to verify it passes**

Run: `node --test tests/genome-partitions.test.js`
Expected: PASS, 9 tests.

- [ ] **Step 6: Commit**

```bash
git add shared/scripts/genome/partitions.js tests/genome-helpers.js tests/genome-partitions.test.js
git commit -m "Genome pipeline: partition plan from the assembly report and partitions.tsv

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Read the ISF map (`isf-map.js`, part 1)

**Files:**
- Create: `shared/scripts/genome/isf-map.js`, `tests/fixtures/genome/isf-map-mini.xml`
- Test: `tests/genome-isf-map.test.js`

- [ ] **Step 1: Create the mini map fixture** (`tests/fixtures/genome/isf-map-mini.xml`, cut from ApiCommonData's `genemRNAExonCDS2Gus.xml` to what the tiny genome reaches; `coding_gene` deliberately lacks `is_ordered`)

```xml
<!--
Cut of ApiCommonData Load/lib/xml/isf/genemRNAExonCDS2Gus.xml for unit tests.
-->
<mapping>
  <bioperlSeqPreprocessor class="ApiCommonData::Load::genemRNAExonCDS2BioperlTree"/>
  <gusSkeletonMaker class="ApiCommonData::Load::GusSkeletonMaker" method="makeGeneSkeleton"/>

  <feature name="coding_gene" so="protein_coding">
    <qualifier name="ID" handler="api" method="sourceIdAndTranscriptSeqAndTranslatedAAFeat"/>
    <qualifier name="Name" ignore="true"/>
    <qualifier name="gbkey" ignore="true"/>
    <qualifier name="gene" ignore="true"/>
    <qualifier name="gene_biotype" ignore="true"/>
    <qualifier name="gene_synonym" ignore="true"/>
    <qualifier name="pseudo" handler="api" method="setPseudo"/>
    <qualifier name="partial" handler="api" method="setPartial"/>
  </feature>
  <feature name="mRNA" so="mRNA">
    <qualifier name="ID" column="source_id"/>
    <qualifier name="gbkey" ignore="true"/>
    <qualifier name="pseudo" handler="api" method="setPseudo"/>
  </feature>
  <feature name="tRNA_gene" so="tRNA_encoding">
    <qualifier name="ID" handler="api" method="sourceIdAndTranscriptSeqAndTranslatedAAFeat"/>
    <qualifier name="Name" ignore="true"/>
    <qualifier name="gbkey" ignore="true"/>
    <qualifier name="gene" ignore="true"/>
    <qualifier name="gene_biotype" ignore="true"/>
  </feature>
  <feature name="tRNA" so="tRNA">
    <qualifier name="ID" column="source_id"/>
    <qualifier name="Note" ignore="true"/>
    <qualifier name="gbkey" ignore="true"/>
    <qualifier name="gene" ignore="true"/>
    <qualifier name="product" ignore="true"/>
  </feature>
  <feature name="snRNA_gene" so="snRNA_encoding">
    <qualifier name="ID" handler="api" method="sourceIdAndTranscriptSeqAndTranslatedAAFeat"/>
    <qualifier name="gbkey" ignore="true"/>
    <qualifier name="product" ignore="true"/>
  </feature>
  <feature name="snRNA" so="snRNA">
    <qualifier name="ID" column="source_id"/>
    <qualifier name="gbkey" ignore="true"/>
    <qualifier name="product" ignore="true"/>
  </feature>
  <feature name="exon" table="DoTS::ExonFeature" so="coding_exon">
    <qualifier name="CodingStart" ignore="true"/>
    <qualifier name="CodingEnd" ignore="true"/>
    <qualifier name="ID" ignore="true"/>
  </feature>
  <feature name="three_prime_utr" table="DoTS::UTRFeature" ignore="true">
    <qualifier name="ID" column="source_id"/>
  </feature>
  <feature name="five_prime_UTR" table="DoTS::UTRFeature" ignore="true"/>

<!--
  <feature name="commented_out" so="gene">
-->
</mapping>
```

- [ ] **Step 2: Write the failing test** (`tests/genome-isf-map.test.js`)

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EXPECTED_PREPROCESSOR, readIsfMap } from '../shared/scripts/genome/isf-map.js';
import { genomeFixtures } from './genome-helpers.js';

const MINI_MAP_XML = readFileSync(join(genomeFixtures, 'isf-map-mini.xml'), 'utf-8');
const ACD = process.env.APICOMMONDATA_DIR;

test('readIsfMap reads features, their qualifiers and the feature-level ignore', () => {
  const map = readIsfMap(MINI_MAP_XML);
  assert.equal(map.preprocessor, EXPECTED_PREPROCESSOR);
  assert.deepEqual([...map.features.keys()], ['coding_gene', 'mRNA', 'tRNA_gene', 'tRNA', 'snRNA_gene', 'snRNA', 'exon', 'three_prime_utr', 'five_prime_UTR']);
  assert.deepEqual([...map.features.get('mRNA').qualifiers], ['ID', 'gbkey', 'pseudo']);
  assert.equal(map.features.get('coding_gene').ignore, false);
  assert.equal(map.features.get('three_prime_utr').ignore, true);
  assert.deepEqual([...map.features.get('five_prime_UTR').qualifiers], []);
  assert.equal(map.features.has('commented_out'), false);
});

test('a map naming another preprocessor is refused; only one is ported', () => {
  const other = MINI_MAP_XML.replace('genemRNAExonCDS2BioperlTree', 'GeneDBBioperlTree');
  assert.throws(() => readIsfMap(other), /names preprocessor ApiCommonData::Load::GeneDBBioperlTree; only ApiCommonData::Load::genemRNAExonCDS2BioperlTree is ported/);
});

test('the real ApiCommonData map parses', { skip: !ACD && 'APICOMMONDATA_DIR is not set; point it at an ApiCommonData checkout' }, () => {
  const map = readIsfMap(readFileSync(join(ACD, 'Load/lib/xml/isf/genemRNAExonCDS2Gus.xml'), 'utf-8'));
  assert.ok(map.features.size >= 60, `only ${map.features.size} features`);
  assert.deepEqual([...map.features.get('gap').qualifiers], ['ID', 'estimated_length', 'gap_type']);
  assert.equal(map.features.get('coding_gene').qualifiers.has('is_ordered'), false);
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `node --test tests/genome-isf-map.test.js`
Expected: FAIL with `Cannot find module '…/genome/isf-map.js'`.

- [ ] **Step 4: Implement the reader** (`shared/scripts/genome/isf-map.js`; Task 7 appends the port)

```js
export const EXPECTED_PREPROCESSOR = 'ApiCommonData::Load::genemRNAExonCDS2BioperlTree';
/** Keys preprocessGFF3 adds (PMIDs and previous IDs pulled out of product and comment). */
export const ALLOWED_EXTRA_KEYS = new Set(['Dbxref', 'previous_systematic_id']);

const attrOf = (text, name) => text.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`))?.[1] ?? null;

export function readIsfMap(xml) {
  const text = xml.replace(/<!--[\s\S]*?-->/g, '');
  const preprocessor = text.match(/<bioperlSeqPreprocessor\s+class="([^"]+)"/)?.[1] ?? null;
  if (preprocessor !== EXPECTED_PREPROCESSOR) throw new Error(`the map names preprocessor ${preprocessor}; only ${EXPECTED_PREPROCESSOR} is ported`);
  const byName = new Map();
  for (const [, attrs, body = ''] of text.matchAll(/<feature\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/feature>)/g)) {
    const qualifiers = new Set([...body.matchAll(/<qualifier\s+([^>]*?)\/?>/g)].map(([, q]) => attrOf(q, 'name')));
    byName.set(attrOf(attrs, 'name'), { ignore: attrOf(attrs, 'ignore') === 'true', qualifiers });
  }
  return { preprocessor, features: byName };
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `node --test tests/genome-isf-map.test.js`
Expected: PASS, 2 tests, 1 skipped without `APICOMMONDATA_DIR` (3 pass with `APICOMMONDATA_DIR=/home/jbrestel/workspaces/src/ApiCommonData`).

- [ ] **Step 6: Commit**

```bash
git add shared/scripts/genome/isf-map.js tests/fixtures/genome/isf-map-mini.xml tests/genome-isf-map.test.js
git commit -m "Genome pipeline: read the ISF map

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Port of ISF's tree reshaping (`isfTrees`)

**Files:**
- Modify: `shared/scripts/genome/isf-map.js` (append), `tests/genome-helpers.js` (append `parseBioperlTree`, `treeShape`, `byId`)
- Test: `tests/genome-isf-map.test.js` (append)

This is the one place D copies production logic. Every rule of `ApiCommonData::Load::genemRNAExonCDS2BioperlTree` (`Load/lib/perl/genemRNAExonCDS2BioperlTree.pm`) that decides types, IDs, kept qualifier keys or coordinates is ported; ISF's coding-coordinate arithmetic (`CodingStart`/`CodingEnd` values) and its `die`s are not (the structural checks catch those shapes first). Each GFF line is one BioPerl feature (ISF does not merge lines sharing an ID); a child attaches to the first line carrying its Parent ID.

The rules, in Perl order (`preprocess`, lines 44–206):

| # | Top-level feature | Result |
|---|---|---|
| 1 | `protein_coding_gene`, `ncRNA_gene` | treated as `gene` |
| 2 | `pseudogene` | treated as `gene`, gains `pseudo` |
| 3 | `repeat_region` | kept; `microsatellite` if it has `satellite`; ID defaults to the sequence |
| 4 | `STS` | kept; ID defaults to the sequence |
| 5 | parentless `tRNA`, `rRNA`, `snRNA`, `snoRNA` | `<type>_gene` (ID = feature ID, its keys minus `ID`/`Parent`/`Derives_from`, plus `ID`) → `<type>` transcript with ID `<ID>.<type>` and only `ID` → one exon per location |
| 6 | `gene` whose `Note` or `description` matches `/pseudogene/i` | gains `pseudo` |
| 7 | `gene` with `pseudo` and no children | `pseudogene` (all its keys) → `pseudogenic_transcript` `<ID>.mRNA` (`ID`, `pseudo`) → exon |
| 8 | other `gene` | `traverse` (below); no RNA child → dropped |
| 9 | `gap`, `direct_repeat`, `three_prime_utr`, `transposable_element`, `five_prime_utr`, `splice_acceptor_site` | kept as is |
| 10 | anything else (`region`, parentless `SRP_RNA`, `ribozyme`, …) | dropped |

`traverse` (lines 212–484), children sorted by start then end; only `ISF_RNA_TYPES` children count:

| # | Child type | Becomes |
|---|---|---|
| 11 | `misc_RNA` | `ncRNA` |
| 12 | `lnc_RNA` | `lncRNA` |
| 13 | `srpRNA`, `SRP.RNA` | `SRP_RNA` |
| 14 | `pseudogenic_transcript` | coding, gains `pseudo` |
| 15 | `V_gene_segment`, `C_gene_segment` | `misc_feature` |
| 16 | `mRNA` | coding |
| 17 | `transcript` | its first `biotype` value, else first `gbkey` value, else coding (no further renames) |
| 18 | first RNA | gene becomes `<type>_gene` (`coding` → `coding_gene`), ID and keys from the gene minus `ID`/`Parent`/`Derives_from`, plus `ID` |
| 19 | a later coding RNA | upgrades the gene to `coding_gene` |
| 20 | each RNA | transcript `mRNA` for coding, else `<type>`; ID = RNA ID; keys = RNA keys minus `ID`/`Parent`/`Derives_from`, plus `ID`; gains `pseudo`/`partial` when the gene has `pseudo`/`Pseudo`/`partial`/`Partial` and it has neither form |
| 21 | RNA children `exon` | exons (sorted by start); none → one exon per RNA location |
| 22 | RNA children `five_prime_utr`, `three_prime_utr`, `splice_acceptor_site` (any case) | top-level, lower-cased type, the child's keys minus `ID`/`Parent`/`Derives_from` |
| 23 | gene span | widened to cover each transcript |
| 24 | gene ID | `:pseudogene` removed |
| 25 | `coding_gene` | a transcript with `pseudo` or of type `pseudogenic_transcript` becomes `pseudogenic_transcript`; all pseudo → gene becomes `pseudogene` |

- [ ] **Step 1: Append the tree parser and shapes to `tests/genome-helpers.js`**

```js
/** ISF's --bioperlTreeOutput as nested { type, id, start, end, strand, keys, children }. */
export function parseBioperlTree(text) {
  const roots = [];
  const stack = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const head = line.match(/^( *)< (\S+) >$/);
    if (head) {
      const depth = head[1].length / 2;
      const node = { type: head[2], id: null, keys: [], children: [] };
      stack.length = depth;
      if (depth === 0) roots.push(node); else stack[depth - 1].children.push(node);
      stack[depth] = node;
      continue;
    }
    const node = stack.at(-1);
    const loc = line.match(/^\s*(\d+)-(\d+) strand:(-?\d+)$/);
    if (loc) { Object.assign(node, { start: Number(loc[1]), end: Number(loc[2]), strand: Number(loc[3]) }); continue; }
    if (/ gus source_id: /.test(line)) continue;
    const qualifier = line.match(/^\s*([^:\s]+): ?(.*)$/);
    if (!qualifier) continue;
    if (!node.keys.includes(qualifier[1])) node.keys.push(qualifier[1]);
    if (qualifier[1] === 'ID') node.id = qualifier[2];
  }
  return roots;
}

/** What the port must reproduce: types, IDs, coordinates, and qualifier keys except on exons. */
export const treeShape = (t) => ({
  type: t.type,
  id: t.type === 'exon' ? null : t.id,
  start: t.start,
  end: t.end,
  strand: t.strand,
  keys: t.type === 'exon' ? null : [...t.keys].sort(),
  children: t.children.map(treeShape)
});
export const byId = (a, b) => a.id.localeCompare(b.id);
```

- [ ] **Step 2: Append the failing tests to `tests/genome-isf-map.test.js`**

Add to the imports: `import { isfTrees } from '../shared/scripts/genome/isf-map.js';` (merge into the existing import line), `import { parseGff } from '../shared/scripts/genome/gff.js';`, `import { readText } from '../shared/scripts/genome/workdir.js';`, and from `./genome-helpers.js` also `byId, gffLine, gffText, parseBioperlTree, TINY_GFF, treeShape`.

```js
test('isfTrees on the raw tiny genome: CDS-only genes and the region are dropped', () => {
  const { trees, dropped } = isfTrees(parseGff(TINY_GFF));
  assert.deepEqual(trees.map((t) => [t.type, t.id]), [['tRNA_gene', 'gene-TST_0030'], ['snRNA_gene', 'rna-CM000001.1:1200..1300']]);
  assert.deepEqual(trees[0].keys, ['ID', 'Name', 'gbkey', 'gene', 'gene_biotype']);
  assert.deepEqual(trees[0].children.map((t) => [t.type, t.id, t.keys]), [['tRNA', 'rna-TST_0030', ['ID', 'Note', 'gbkey', 'product']]]);
  assert.deepEqual(trees[1].keys, ['ID', 'gbkey', 'product']);
  assert.deepEqual(trees[1].children.map((t) => [t.type, t.id, t.keys]), [['snRNA', 'rna-CM000001.1:1200..1300.snRNA', ['ID']]]);
  assert.deepEqual(dropped.map((d) => [d.type, d.id]), [
    ['region', 'CM000001.1:1..2000'], ['gene', 'gene-TST_0010'], ['gene', 'gene-TST_0020'], ['gene', 'gene-TST_0020'], ['gene', 'gene-TST_0040']
  ]);
});

test('isfTrees renames gene types from their transcripts, and makes childless pseudo genes pseudogenes', () => {
  const graph = parseGff(gffText(
    gffLine('c', 'gene', 1, 100, '+', 'ID=g1'),
    gffLine('c', 'mRNA', 1, 120, '+', 'ID=t1;Parent=g1'),
    gffLine('c', 'exon', 1, 120, '+', 'ID=e1;Parent=t1'),
    gffLine('c', 'gene', 200, 300, '+', 'ID=g2'),
    gffLine('c', 'transcript', 200, 300, '+', 'ID=t2;Parent=g2;gbkey=misc_RNA'),
    gffLine('c', 'gene', 400, 500, '-', 'ID=g3;Note=putative pseudogene'),
    gffLine('c', 'gap', 600, 700, '+', 'ID=gap1;estimated_length=101')
  ));
  const { trees, dropped } = isfTrees(graph);
  assert.deepEqual(trees.map((t) => [t.type, t.id, t.children.map((c) => c.type)]), [
    ['coding_gene', 'g1', ['mRNA']], ['misc_RNA_gene', 'g2', ['misc_RNA']], ['pseudogene', 'g3', ['pseudogenic_transcript']], ['gap', 'gap1', []]
  ]);
  assert.deepEqual([trees[0].start, trees[0].end], [1, 120]);
  assert.deepEqual(trees[1].children[0].children.map((e) => [e.type, e.start, e.end]), [['exon', 200, 300]]);
  assert.equal(trees[2].children[0].id, 'g3.mRNA');
  assert.deepEqual(trees[2].keys, ['ID', 'Note', 'pseudo']);
  assert.deepEqual(dropped, []);
});

test('isfTrees reproduces ISF\'s own bioperltree.out for the spike\'s input on chromosomes X and XI', () => {
  const graph = parseGff(readText(join(genomeFixtures, 'ecun/isf/isf-input.gff3.gz')));
  const expected = parseBioperlTree(readText(join(genomeFixtures, 'ecun/isf/bioperltree.out.gz'))).map(treeShape).sort(byId);
  const { trees, dropped } = isfTrees(graph);
  assert.equal(expected.length, 440);
  assert.deepEqual(trees.map(treeShape).sort(byId), expected);
  assert.deepEqual(dropped.map((d) => d.type), ['region', 'SRP_RNA', 'region', 'RNase_MRP_RNA']);
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `node --test tests/genome-isf-map.test.js`
Expected: FAIL with `SyntaxError: The requested module '../shared/scripts/genome/isf-map.js' does not provide an export named 'isfTrees'`.

- [ ] **Step 4: Append the port to `shared/scripts/genome/isf-map.js`**

Add at the top of the file:

```js
import { decode, features, getValues, idOf, parentsOf } from './gff.js';
import { ISF_RNA_TYPES } from './feature-types.js';
```

Append:

```js
const STANDALONE_RNA = new Set(['tRNA', 'rRNA', 'snRNA', 'snoRNA']);
const KEPT_AS_IS = new Set(['gap', 'direct_repeat', 'three_prime_utr', 'transposable_element', 'five_prime_utr', 'splice_acceptor_site']);
const UTR_TYPES = new Set(['five_prime_utr', 'three_prime_utr', 'splice_acceptor_site']);
const NOT_COPIED = new Set(['ID', 'Parent', 'Derives_from']);
const STRAND = { '+': 1, '-': -1 };

const copied = (keys) => [...keys].filter((k) => !NOT_COPIED.has(k));
const node = (type, src, id, keys) => ({
  type, id, gffType: src.type, seqId: src.seqId, start: src.start, end: src.end, strand: src.strand,
  keys: [...new Set(keys)].sort(), children: []
});
const exonOf = (src) => node('exon', src, null, ['CodingEnd', 'CodingStart']);

function sourceNodes(graph) {
  const nodes = features(graph).map((f) => ({
    type: f.type, id: idOf(f), seqId: f.seqId, start: f.start, end: f.end, strand: STRAND[f.strand] ?? 0,
    keys: f.attrs.map(([k]) => k), parents: parentsOf(f),
    attr: (key) => { const [v] = getValues(f, key); return v === undefined ? null : decode(v); }
  }));
  const firstById = new Map();
  for (const n of nodes) if (n.id !== null && !firstById.has(n.id)) firstById.set(n.id, n);
  const kids = new Map();
  const top = [];
  const orphans = new Set();
  for (const n of nodes) {
    if (!n.parents.length) { top.push(n); continue; }
    for (const p of n.parents) {
      const parent = firstById.get(p);
      if (!parent) { orphans.add(n); continue; }
      if (!kids.has(parent)) kids.set(parent, []);
      kids.get(parent).push(n);
    }
  }
  return { top, orphans: [...orphans], childrenOf: (n) => kids.get(n) ?? [] };
}

function rnaType(rna, rnaKeys) {
  let type = rna.type;
  if (type === 'misc_RNA') type = 'ncRNA';
  if (type === 'lnc_RNA') type = 'lncRNA';
  if (type === 'srpRNA' || type === 'SRP.RNA') type = 'SRP_RNA';
  if (type === 'pseudogenic_transcript') { rnaKeys.add('pseudo'); type = 'coding'; }
  if (type === 'V_gene_segment' || type === 'C_gene_segment') type = 'misc_feature';
  if (type === 'mRNA') type = 'coding';
  if (type === 'transcript') type = rna.attr('biotype') ?? rna.attr('gbkey') ?? 'coding';
  return type;
}

function traverse(gene, geneKeys, childrenOf) {
  let out = null;
  const utrs = [];
  for (const rna of [...childrenOf(gene)].sort((a, b) => a.start - b.start || a.end - b.end)) {
    if (!ISF_RNA_TYPES.has(rna.type)) continue;
    const rnaKeys = new Set(rna.keys);
    const type = rnaType(rna, rnaKeys);
    if (!out) out = node(`${type}_gene`, gene, gene.id, ['ID', ...copied(geneKeys)]);
    else if (type === 'coding' && out.type !== 'coding_gene') out.type = 'coding_gene';
    const transcript = node(type === 'coding' ? 'mRNA' : type, rna, rna.id, ['ID', ...copied(rnaKeys)]);
    for (const [flag, alt] of [['pseudo', 'Pseudo'], ['partial', 'Partial']]) {
      const has = (keys) => keys.includes(flag) || keys.includes(alt);
      if (has(out.keys) && !has(transcript.keys)) transcript.keys = [...transcript.keys, flag].sort();
    }
    for (const sub of [...childrenOf(rna)].sort((a, b) => a.start - b.start)) {
      if (sub.type === 'exon') transcript.children.push(exonOf(sub));
      else if (UTR_TYPES.has(sub.type.toLowerCase())) utrs.push(node(sub.type.toLowerCase(), sub, null, copied(sub.keys)));
    }
    if (!transcript.children.length) transcript.children.push(exonOf(rna));
    out.start = Math.min(out.start, transcript.start);
    out.end = Math.max(out.end, transcript.end);
    out.children.push(transcript);
  }
  if (out) {
    out.id = out.id.replace(':pseudogene', '');
    if (out.type === 'coding_gene') {
      let coding = false;
      let pseudo = false;
      for (const t of out.children) {
        if (t.keys.includes('pseudo') || t.type === 'pseudogenic_transcript') { pseudo = true; t.type = 'pseudogenic_transcript'; }
        else coding = true;
      }
      if (pseudo && !coding) out.type = 'pseudogene';
    }
  }
  return { gene: out, utrs };
}

function pseudogeneTree(n, keys) {
  const gene = node('pseudogene', n, n.id, [...keys]);
  const transcript = node('pseudogenic_transcript', n, `${n.id}.mRNA`, ['ID', 'pseudo']);
  transcript.children.push(exonOf(n));
  gene.children.push(transcript);
  return gene;
}

function standaloneRnaTree(n, type, keys) {
  const gene = node(`${type}_gene`, n, n.id, ['ID', ...copied(keys)]);
  const transcript = node(type, n, `${n.id}.${type}`, ['ID']);
  transcript.children.push(exonOf(n));
  gene.children.push(transcript);
  return gene;
}

/** The trees ISF builds from a GFF (types, IDs, kept keys, coordinates) and the features it drops. */
export function isfTrees(graph) {
  const { top, orphans, childrenOf } = sourceNodes(graph);
  const trees = [];
  const dropped = [...orphans];
  for (const n of top) {
    let type = n.type;
    const keys = new Set(n.keys);
    if (type === 'protein_coding_gene' || type === 'ncRNA_gene') type = 'gene';
    if (type === 'pseudogene') { type = 'gene'; keys.add('pseudo'); }
    if (type === 'repeat_region' || type === 'STS') {
      const name = type === 'repeat_region' && keys.has('satellite') ? 'microsatellite' : type;
      trees.push(node(name, n, n.id ?? n.seqId, [...keys, 'ID']));
    } else if (STANDALONE_RNA.has(type)) {
      trees.push(standaloneRnaTree(n, type, keys));
    } else if (type === 'gene') {
      if (/pseudogene/i.test(n.attr('Note') ?? '') || /pseudogene/i.test(n.attr('description') ?? '')) keys.add('pseudo');
      if (keys.has('pseudo') && !childrenOf(n).length) { trees.push(pseudogeneTree(n, keys)); continue; }
      const { gene, utrs } = traverse(n, keys, childrenOf);
      if (gene) trees.push(gene); else dropped.push(n);
      trees.push(...utrs);
    } else if (KEPT_AS_IS.has(type)) {
      trees.push(node(type, n, n.id, [...keys]));
    } else {
      dropped.push(n);
    }
  }
  return { trees, dropped };
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `node --test tests/genome-isf-map.test.js`
Expected: PASS, 5 tests (plus the real-map test with `APICOMMONDATA_DIR`).

- [ ] **Step 6: Commit**

```bash
git add shared/scripts/genome/isf-map.js tests/genome-helpers.js tests/genome-isf-map.test.js
git commit -m "Genome pipeline: port of genemRNAExonCDS2BioperlTree's tree reshaping

Matches ISF's bioperltree.out for the spike's input on E. cuniculi X and XI.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: ID policy, phase 1 (`ids.js`, part 1)

**Files:**
- Create: `shared/scripts/genome/ids.js`
- Modify: `tests/genome-helpers.js` (append `TINY_IDS_DEFAULT`)
- Test: `tests/genome-ids.test.js`

Implements resolved spec questions 1–3: gene = `locus_tag`, else the ID without `gene-`; an **mRNA** = its ID without `rna-`; every other transcript keeps its NCBI ID; protein = `protein_id`; every `Parent` follows. `ids.tsv` lines (always keyed by input IDs) apply in the same pass, after the policy and before the collision check. The result also carries `inputIdOf` (settled ID → input ID), so later errors can name the `ids.tsv` line that fixes them. Task 9 adds sequence lines and the `ids.tsv` errors.

- [ ] **Step 1: Write the failing test**

Append to `tests/genome-helpers.js` (the build test reuses it):

```js
export const TINY_IDS_DEFAULT = [
  'level\told\tnew',
  'gene\tgene-TST_0010\tTST_0010',
  'gene\tgene-TST_0020\tTST_0020',
  'gene\tgene-TST_0030\tTST_0030',
  'gene\tgene-TST_0040\tTST_0040',
  'protein\tcds-PRT1.1\tPRT1.1',
  'protein\tcds-PRT2.1\tPRT2.1',
  'protein\tcds-PRT4.1\tPRT4.1',
  ''
].join('\n');
```

`tests/genome-ids.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyIdPolicy, idsTsvText, readIdsTsv } from '../shared/scripts/genome/ids.js';
import { parseGff, serializeGff } from '../shared/scripts/genome/gff.js';
import { gffLine, gffText, TINY_COLLIDING_GFF, TINY_GFF, TINY_IDS_DEFAULT } from './genome-helpers.js';

test('ncbiDefault: genes without gene-, proteins by protein_id, non-mRNA transcripts unchanged; every Parent follows', () => {
  const { graph, defaults, collisions, applied, inputIdOf } = applyIdPolicy(parseGff(TINY_GFF), { policy: 'ncbiDefault' });
  assert.deepEqual(collisions, []);
  assert.equal(applied, 0);
  assert.equal(idsTsvText(defaults), TINY_IDS_DEFAULT);
  assert.equal(inputIdOf.get('TST_0010'), 'gene-TST_0010');
  const text = serializeGff(graph);
  assert.match(text, /\tID=PRT1\.1;Parent=TST_0010;/);
  assert.match(text, /\tID=rna-TST_0030;Parent=TST_0030;/);
  assert.match(text, /\tID=exon-TST_0030-1;Parent=rna-TST_0030;/);
  assert.match(text, /\tID=rna-CM000001\.1:1200\.\.1300;gbkey=ncRNA;/);
  assert.match(TINY_GFF, /ID=gene-TST_0010;/);
});

test('a locus_tag wins over the gene- ID; an mRNA loses rna-, a tRNA keeps it', () => {
  const graph = parseGff(gffText(
    gffLine('c', 'gene', 1, 9, '+', 'ID=gene-abc;locus_tag=ABC_0001'),
    gffLine('c', 'mRNA', 1, 9, '+', 'ID=rna-XM_000001.1;Parent=gene-abc'),
    gffLine('c', 'CDS', 1, 9, '+', 'ID=cds-X1;Parent=rna-XM_000001.1;protein_id=X1.1'),
    gffLine('c', 'gene', 20, 29, '+', 'ID=gene-t1'),
    gffLine('c', 'tRNA', 20, 29, '+', 'ID=rna-t1;Parent=gene-t1')
  ));
  assert.equal(serializeGff(applyIdPolicy(graph, { policy: 'ncbiDefault' }).graph), gffText(
    gffLine('c', 'gene', 1, 9, '+', 'ID=ABC_0001;locus_tag=ABC_0001'),
    gffLine('c', 'mRNA', 1, 9, '+', 'ID=XM_000001.1;Parent=ABC_0001'),
    gffLine('c', 'CDS', 1, 9, '+', 'ID=X1.1;Parent=XM_000001.1;protein_id=X1.1'),
    gffLine('c', 'gene', 20, 29, '+', 'ID=t1'),
    gffLine('c', 'tRNA', 20, 29, '+', 'ID=rna-t1;Parent=t1')
  ));
});

test('none leaves IDs alone and writes no defaults', () => {
  const r = applyIdPolicy(parseGff(TINY_GFF), { policy: 'none' });
  assert.equal(serializeGff(r.graph), TINY_GFF);
  assert.equal(idsTsvText(r.defaults), 'level\told\tnew\n');
});

test('two features resolving to one ID are a collision naming both', () => {
  const { collisions } = applyIdPolicy(parseGff(TINY_COLLIDING_GFF), { policy: 'ncbiDefault' });
  assert.deepEqual(collisions, [{ id: 'TST_0050', olds: [{ id: 'gene-TST_0050', level: 'gene', type: 'gene' }, { id: 'rna-TST_0050', level: 'transcript', type: 'mRNA' }] }]);
});

test('an ids.tsv line keyed by an input ID settles the collision inside the policy pass', () => {
  const { entries } = readIdsTsv('level\told\tnew\ntranscript\trna-TST_0050\tTST_0050.1\n');
  const r = applyIdPolicy(parseGff(TINY_COLLIDING_GFF), { policy: 'ncbiDefault', overrides: entries });
  assert.deepEqual(r.collisions, []);
  assert.equal(r.applied, 1);
  const text = serializeGff(r.graph);
  assert.match(text, /\tmRNA\t1400\t1500\t\.\t\+\t\.\tID=TST_0050\.1;Parent=TST_0050;gbkey=mRNA\n/);
  assert.match(text, /\tID=PRT5\.1;Parent=TST_0050\.1;/);
  assert.equal(r.inputIdOf.get('TST_0050.1'), 'rna-TST_0050');
  assert.ok(r.defaults.some((d) => d.old === 'rna-TST_0050' && d.new === 'TST_0050'));
});

test('an unknown policy is refused', () => {
  assert.throws(() => applyIdPolicy(parseGff(TINY_GFF), { policy: 'veupathdb' }), /idPolicy must be one of ncbiDefault, none/);
});
```

(`readIdsTsv` is implemented here too, since overrides need it; Task 9 adds its error tests.)

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/genome-ids.test.js`
Expected: FAIL with `Cannot find module '…/genome/ids.js'`.

- [ ] **Step 3: Implement** (`shared/scripts/genome/ids.js`)

```js
import { cloneGraph, featureGroups, getAttr, renameIds, renameSequences } from './gff.js';
import { levelOf } from './feature-types.js';

export const LEVELS = ['sequence', 'gene', 'transcript', 'protein'];
export const ID_POLICIES = ['ncbiDefault', 'none'];
const HEADER = 'level\told\tnew';

export function readIdsTsv(text) {
  const [header, ...lines] = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (header !== HEADER) return { entries: [], errors: ['ids.tsv header must be "level\\told\\tnew"'] };
  const entries = [];
  const errors = [];
  const seen = new Set();
  lines.forEach((text, i) => {
    const line = i + 2;
    const [level, old, nu] = text.split('\t');
    if (!LEVELS.includes(level)) errors.push(`ids.tsv line ${line}: level must be one of ${LEVELS.join(', ')}`);
    else if (!old || !nu) errors.push(`ids.tsv line ${line}: needs level, old and new`);
    else if (seen.has(old)) errors.push(`ids.tsv line ${line}: old ${old} is repeated`);
    else { seen.add(old); entries.push({ level, old, new: nu, line }); }
  });
  return { entries, errors };
}

export const idsTsvText = (rows) => [HEADER, ...rows.map((r) => `${r.level}\t${r.old}\t${r.new}`), ''].join('\n');

const strip = (id, prefix) => (id.startsWith(prefix) ? id.slice(prefix.length) : id);

function ncbiDefaultRows(groups) {
  const renamed = (level, pick) => groups.filter((g) => pick(g)).map((g) => ({ level, old: g.id, new: newIdOf(g) }));
  const newIdOf = (g) => {
    if (levelOf(g.type) === 'gene') return getAttr(g.lines[0], 'locus_tag') ?? strip(g.id, 'gene-');
    if (g.type === 'mRNA') return strip(g.id, 'rna-');
    return getAttr(g.lines[0], 'protein_id') ?? g.id;
  };
  return [
    ...renamed('gene', (g) => levelOf(g.type) === 'gene'),
    ...renamed('transcript', (g) => g.type === 'mRNA'),
    ...renamed('protein', (g) => levelOf(g.type) === 'protein')
  ].filter((r) => r.old !== r.new);
}

/** Renames by the settled mapping; collisions are reported, not thrown, so survey can show them. */
function settle(graph, groups, mapping, sequenceRenames) {
  const owners = new Map();
  for (const g of groups) {
    const id = mapping.get(g.id) ?? g.id;
    if (!owners.has(id)) owners.set(id, []);
    owners.get(id).push({ id: g.id, level: levelOf(g.type), type: g.type });
  }
  const collisions = [...owners].filter(([, olds]) => olds.length > 1).map(([id, olds]) => ({ id, olds }));
  const out = cloneGraph(graph);
  renameIds(out, mapping);
  renameSequences(out, sequenceRenames);
  const inputIdOf = new Map([...mapping, ...sequenceRenames].map(([old, nu]) => [nu, old]));
  return { graph: out, collisions, sequenceRenames, inputIdOf };
}

/** Phase 1: the policy's IDs, then ids.tsv lines keyed by input IDs, then the collision check. */
export function applyIdPolicy(graph, { policy, overrides = [] }) {
  if (!ID_POLICIES.includes(policy)) throw new Error(`idPolicy must be one of ${ID_POLICIES.join(', ')}`);
  const groups = featureGroups(graph).filter((g) => g.id !== null);
  const defaults = policy === 'ncbiDefault' ? ncbiDefaultRows(groups) : [];
  const mapping = new Map(defaults.map((r) => [r.old, r.new]));
  const inputLevel = new Map(groups.map((g) => [g.id, levelOf(g.type)]));
  const applied = overrides.filter((o) => inputLevel.get(o.old) === o.level);
  for (const o of applied) mapping.set(o.old, o.new);
  return { ...settle(graph, groups, mapping, new Map()), defaults, errors: [], applied: applied.length };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test tests/genome-ids.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add shared/scripts/genome/ids.js tests/genome-helpers.js tests/genome-ids.test.js
git commit -m "Genome pipeline: ncbiDefault and none ID policies with ids.tsv overrides by input ID

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: `ids.tsv` errors and sequence lines (`ids.js`, part 2)

**Files:**
- Modify: `shared/scripts/genome/ids.js` (replace `applyIdPolicy`)
- Test: `tests/genome-ids.test.js` (append)

The spec's three `ids.tsv` errors: an `old` not present (not an input ID at that level), a repeated `old` (caught by `readIdsTsv`), a `new` that clashes within its level. A `sequence` line renames the GFF seqIds and `##sequence-region` lines here; `build` passes `sequenceRenames` on to the FASTA and the partition plan (report rows). Any error returns the input graph untouched.

- [ ] **Step 1: Append the failing tests**

Add `CM, KZ` to the `./genome-helpers.js` import.

```js
test('readIdsTsv reports a bad header, a bad level, a short line and a repeated old', () => {
  assert.deepEqual(readIdsTsv('old\tnew\n').errors, ['ids.tsv header must be "level\\told\\tnew"']);
  const { entries, errors } = readIdsTsv('level\told\tnew\ngene\tgene-A\tA\nexon\te1\tE1\ngene\tgene-B\ntranscript\tgene-A\tA2\n');
  assert.deepEqual(entries.map((e) => [e.level, e.old, e.new, e.line]), [['gene', 'gene-A', 'A', 2]]);
  assert.deepEqual(errors, [
    'ids.tsv line 3: level must be one of sequence, gene, transcript, protein',
    'ids.tsv line 4: needs level, old and new',
    'ids.tsv line 5: old gene-A is repeated'
  ]);
});

const policyWith = (tsv) => applyIdPolicy(parseGff(TINY_GFF), { policy: 'ncbiDefault', overrides: readIdsTsv(tsv).entries, sequenceIds: [CM, KZ] });

test('ids.tsv errors: an old that is not an input ID at its level, a new taken within its level; nothing changes', () => {
  const graph = parseGff(TINY_GFF);
  const { entries } = readIdsTsv('level\told\tnew\ntranscript\tgene-TST_0010\tX\ngene\tnothing\tY\ngene\tgene-TST_0040\tTST_0020\n');
  const r = applyIdPolicy(graph, { policy: 'ncbiDefault', overrides: entries });
  assert.deepEqual(r.errors, [
    'ids.tsv line 2: transcript gene-TST_0010 is not an input transcript ID (see the old column of ids.default.tsv)',
    'ids.tsv line 3: gene nothing is not an input gene ID (see the old column of ids.default.tsv)',
    'ids.tsv line 4: new gene ID TST_0020 is already taken'
  ]);
  assert.equal(r.applied, 0);
  assert.equal(r.graph, graph);
  assert.deepEqual(r.collisions, []);
});

test('a sequence line renames seqIds and sequence-region lines and maps back to the input ID', () => {
  const r = policyWith('level\told\tnew\nsequence\tKZ000002.1\tscaffold2\n');
  assert.deepEqual(r.errors, []);
  assert.equal(r.applied, 1);
  assert.deepEqual([...r.sequenceRenames], [[KZ, 'scaffold2']]);
  assert.equal(r.inputIdOf.get('scaffold2'), KZ);
  const text = serializeGff(r.graph);
  assert.match(text, /^##sequence-region scaffold2 1 600$/m);
  assert.match(text, /^scaffold2\tEMBL\tgene\t10\t300\t\.\t\+\t\.\tID=TST_0040;/m);
});

test('sequence line errors: not an input sequence, a new already taken', () => {
  assert.deepEqual(policyWith('level\told\tnew\nsequence\tZZ1\tz\nsequence\tKZ000002.1\tCM000001.1\n').errors, [
    'ids.tsv line 2: sequence ZZ1 is not an input sequence ID (see the old column of ids.default.tsv)',
    'ids.tsv line 3: new sequence ID CM000001.1 is already taken'
  ]);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/genome-ids.test.js`
Expected: FAIL — the first new test gets `r.errors` = `[]` (Task 8's `applyIdPolicy` ignores lines it cannot apply), and the sequence test gets `r.applied` = 0.

- [ ] **Step 3: Replace `applyIdPolicy` in `shared/scripts/genome/ids.js`**

Add `seqIdsOf` to the `./gff.js` import, then replace the whole `applyIdPolicy` function with:

```js
/**
 * Phase 1: the policy's IDs, then ids.tsv lines keyed by input IDs (features and sequences),
 * then the collision check. Any ids.tsv error returns the input graph untouched.
 */
export function applyIdPolicy(graph, { policy, overrides = [], sequenceIds = seqIdsOf(graph) }) {
  if (!ID_POLICIES.includes(policy)) throw new Error(`idPolicy must be one of ${ID_POLICIES.join(', ')}`);
  const groups = featureGroups(graph).filter((g) => g.id !== null);
  const defaults = policy === 'ncbiDefault' ? ncbiDefaultRows(groups) : [];
  const mapping = new Map(defaults.map((r) => [r.old, r.new]));
  const inputLevel = new Map(groups.map((g) => [g.id, levelOf(g.type)]));
  const sequences = new Set(sequenceIds);
  const sequenceRenames = new Map();
  const errors = [];
  const applied = [];
  for (const o of overrides) {
    const present = o.level === 'sequence' ? sequences.has(o.old) : inputLevel.get(o.old) === o.level;
    if (!present) {
      errors.push(`ids.tsv line ${o.line}: ${o.level} ${o.old} is not an input ${o.level} ID (see the old column of ids.default.tsv)`);
      continue;
    }
    (o.level === 'sequence' ? sequenceRenames : mapping).set(o.old, o.new);
    applied.push(o);
  }
  const holders = new Map();
  const hold = (level, input, settled) => {
    const key = `${level}\t${settled}`;
    if (!holders.has(key)) holders.set(key, []);
    holders.get(key).push(input);
  };
  for (const g of groups) hold(inputLevel.get(g.id), g.id, mapping.get(g.id) ?? g.id);
  for (const s of sequences) hold('sequence', s, sequenceRenames.get(s) ?? s);
  for (const o of applied) {
    if (holders.get(`${o.level}\t${o.new}`).some((id) => id !== o.old)) errors.push(`ids.tsv line ${o.line}: new ${o.level} ID ${o.new} is already taken`);
  }
  if (errors.length) return { graph, defaults, collisions: [], errors, applied: 0, sequenceRenames: new Map(), inputIdOf: new Map() };
  return { ...settle(graph, groups, mapping, sequenceRenames), defaults, errors, applied: applied.length };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test tests/genome-ids.test.js`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add shared/scripts/genome/ids.js tests/genome-ids.test.js
git commit -m "Genome pipeline: ids.tsv errors and sequence renames in the ID pass

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Created-ID guard, `collapseSplitGenes`, `stripAttributes`

**Files:**
- Create: `shared/scripts/genome/transforms/claim-ids.js`, `shared/scripts/genome/transforms/collapse-split-genes.js`, `shared/scripts/genome/transforms/strip-attributes.js`
- Test: `tests/genome-transforms.test.js`

Every transform is pure: `(graph, args) → { graph, changes }`, cloning its input. A change is `{ id, created?, from? }` where `id` is the affected feature's ID before the transform, and `from` (`{ level, id }`) names the settled ID the created IDs derive from — the thing an `ids.tsv` line must rename (by its input ID) to change them. Created IDs cannot be overridden directly.

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { features, idOf, parseGff, serializeGff } from '../shared/scripts/genome/gff.js';
import { claimIds } from '../shared/scripts/genome/transforms/claim-ids.js';
import { collapseSplitGenes } from '../shared/scripts/genome/transforms/collapse-split-genes.js';
import { stripAttributes, stripAttributesProblems } from '../shared/scripts/genome/transforms/strip-attributes.js';
import { gffLine, gffText, TINY_GFF } from './genome-helpers.js';

test('claimIds refuses an ID that exists or was already claimed', () => {
  const claim = claimIds(parseGff(gffText(gffLine('c', 'gene', 1, 9, '+', 'ID=a'))), 'someTransform');
  assert.throws(() => claim('a', 'x'), (e) => e.code === 'ID_COLLISION' && e.id === 'a' && e.source === 'x' && e.message === 'someTransform: created ID a (for x) already exists');
  assert.equal(claim('b', 'x'), 'b');
  assert.throws(() => claim('b', 'y'), /created ID b \(for y\) already exists/);
});

test('collapseSplitGenes makes one gene line spanning the lines it replaces', () => {
  const graph = parseGff(TINY_GFF);
  const { graph: out, changes } = collapseSplitGenes(graph);
  assert.deepEqual(changes, [{ id: 'gene-TST_0020', removedLines: 1 }]);
  assert.deepEqual(features(out).filter((f) => idOf(f) === 'gene-TST_0020').map((f) => [f.start, f.end, f.strand]), [[500, 900, '-']]);
  assert.equal(features(graph).filter((f) => idOf(f) === 'gene-TST_0020').length, 2);
});

test('collapseSplitGenes refuses gene lines on different strands', () => {
  const graph = parseGff(gffText(gffLine('c', 'gene', 1, 9, '+', 'ID=g'), gffLine('c', 'gene', 20, 29, '-', 'ID=g')));
  assert.throws(() => collapseSplitGenes(graph), (e) => e.code === 'SPLIT_ACROSS' && /collapseSplitGenes: gene g has lines on different sequences or strands/.test(e.message));
});

test('collapseSplitGenes changes nothing without split genes', () => {
  assert.deepEqual(collapseSplitGenes(parseGff(gffText(gffLine('c', 'gene', 1, 9, '+', 'ID=g')))).changes, []);
});

test('stripAttributes removes keys from features of one type', () => {
  const { graph, changes } = stripAttributes(parseGff(TINY_GFF), { type: 'gene', keys: ['is_ordered'] });
  assert.deepEqual(changes, [{ id: 'gene-TST_0020' }]);
  assert.doesNotMatch(serializeGff(graph), /is_ordered/);
  assert.match(TINY_GFF, /is_ordered/);
  assert.deepEqual(stripAttributes(parseGff(TINY_GFF), { type: 'gap', keys: ['gbkey'] }).changes, []);
});

test('stripAttributesProblems checks type and keys', () => {
  assert.deepEqual(stripAttributesProblems({ type: 'gene', keys: ['is_ordered'] }), []);
  assert.deepEqual(stripAttributesProblems({}), ['args.type must be a feature type', 'args.keys must be a non-empty list of attribute keys']);
  assert.deepEqual(stripAttributesProblems({ type: 'gene', keys: ['ID'], extra: 1 }), ['args.keys must not include ID or Parent', 'unknown args: extra']);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/genome-transforms.test.js`
Expected: FAIL with `Cannot find module '…/genome/transforms/claim-ids.js'`.

- [ ] **Step 3: Implement `shared/scripts/genome/transforms/claim-ids.js`**

```js
import { features, idOf } from '../gff.js';

/** A created ID that already exists is an error; the fix is an ids.tsv line renaming a source, never a suffix. */
export function claimIds(graph, transform) {
  const taken = new Set(features(graph).map(idOf).filter((id) => id !== null));
  return (id, forId) => {
    if (taken.has(id)) throw Object.assign(new Error(`${transform}: created ID ${id} (for ${forId}) already exists`), { code: 'ID_COLLISION', id, source: forId });
    taken.add(id);
    return id;
  };
}
```

- [ ] **Step 4: Implement `shared/scripts/genome/transforms/collapse-split-genes.js`**

```js
import { cloneGraph, featureGroups, withoutFeatures } from '../gff.js';
import { levelOf } from '../feature-types.js';

export function collapseSplitGenes(input) {
  const graph = cloneGraph(input);
  const drop = new Set();
  const changes = [];
  for (const g of featureGroups(graph)) {
    if (levelOf(g.type) !== 'gene' || g.id === null || g.lines.length < 2) continue;
    const [first, ...rest] = g.lines;
    if (rest.some((f) => f.seqId !== first.seqId || f.strand !== first.strand)) {
      throw Object.assign(new Error(`collapseSplitGenes: gene ${g.id} has lines on different sequences or strands`), { code: 'SPLIT_ACROSS', id: g.id });
    }
    first.start = Math.min(...g.lines.map((f) => f.start));
    first.end = Math.max(...g.lines.map((f) => f.end));
    rest.forEach((f) => drop.add(f));
    changes.push({ id: g.id, removedLines: rest.length });
  }
  return { graph: withoutFeatures(graph, drop), changes };
}
```

- [ ] **Step 5: Implement `shared/scripts/genome/transforms/strip-attributes.js`**

```js
import { cloneGraph, deleteAttrs, features, idOf } from '../gff.js';

export function stripAttributesProblems(args) {
  const problems = [];
  if (typeof args.type !== 'string' || !args.type) problems.push('args.type must be a feature type');
  if (!Array.isArray(args.keys) || !args.keys.length || args.keys.some((k) => typeof k !== 'string' || !k)) problems.push('args.keys must be a non-empty list of attribute keys');
  else if (args.keys.includes('ID') || args.keys.includes('Parent')) problems.push('args.keys must not include ID or Parent');
  const unknown = Object.keys(args).filter((k) => k !== 'type' && k !== 'keys');
  if (unknown.length) problems.push(`unknown args: ${unknown.join(', ')}`);
  return problems;
}

export function stripAttributes(input, { type, keys }) {
  const graph = cloneGraph(input);
  const changed = new Set();
  for (const f of features(graph)) {
    if (f.type === type && deleteAttrs(f, keys)) changed.add(idOf(f) ?? `${f.seqId}:${f.start}..${f.end}`);
  }
  return { graph, changes: [...changed].map((id) => ({ id })) };
}
```

- [ ] **Step 6: Run it to verify it passes**

Run: `node --test tests/genome-transforms.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 7: Commit**

```bash
git add shared/scripts/genome/transforms tests/genome-transforms.test.js
git commit -m "Genome pipeline: created-ID guard, collapseSplitGenes, stripAttributes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: `addMrnaToGeneCds` and `addExonPerCds`

**Files:**
- Create: `shared/scripts/genome/transforms/add-mrna-to-gene-cds.js`, `shared/scripts/genome/transforms/add-exon-per-cds.js`
- Test: `tests/genome-transforms.test.js` (append)

- [ ] **Step 1: Append the failing tests**

Add imports: `import { applyIdPolicy } from '../shared/scripts/genome/ids.js';`, `import { addMrnaToGeneCds } from '../shared/scripts/genome/transforms/add-mrna-to-gene-cds.js';`, `import { addExonPerCds } from '../shared/scripts/genome/transforms/add-exon-per-cds.js';`.

```js
const settled = () => applyIdPolicy(collapseSplitGenes(parseGff(TINY_GFF)).graph, { policy: 'ncbiDefault' }).graph;

test('addMrnaToGeneCds gives a CDS-only gene an mRNA and moves its CDSs under it', () => {
  const { graph, changes } = addMrnaToGeneCds(settled());
  assert.deepEqual(changes, [
    { id: 'TST_0010', created: ['TST_0010_mRNA'], from: { level: 'gene', id: 'TST_0010' } },
    { id: 'TST_0020', created: ['TST_0020_mRNA'], from: { level: 'gene', id: 'TST_0020' } },
    { id: 'TST_0040', created: ['TST_0040_mRNA'], from: { level: 'gene', id: 'TST_0040' } }
  ]);
  const text = serializeGff(graph);
  assert.match(text, /\tgene\t100\t400\t[^\n]*\nCM000001\.1\tEMBL\tmRNA\t100\t400\t\.\t\+\t\.\tID=TST_0010_mRNA;Parent=TST_0010\n/);
  assert.match(text, /\tCDS\t100\t200\t\.\t\+\t0\tID=PRT1\.1;Parent=TST_0010_mRNA;/);
  assert.match(text, /\tmRNA\t500\t900\t\.\t-\t\.\tID=TST_0020_mRNA;Parent=TST_0020\n/);
});

test('addMrnaToGeneCds leaves genes that already have an RNA', () => {
  const graph = parseGff(gffText(gffLine('c', 'gene', 1, 9, '+', 'ID=g'), gffLine('c', 'tRNA', 1, 9, '+', 'ID=t;Parent=g')));
  assert.deepEqual(addMrnaToGeneCds(graph).changes, []);
});

test('addMrnaToGeneCds refuses a created ID that already exists', () => {
  const graph = parseGff(gffText(gffLine('c', 'gene', 1, 9, '+', 'ID=g'), gffLine('c', 'CDS', 1, 9, '+', 'ID=c;Parent=g'), gffLine('c', 'gene', 20, 29, '+', 'ID=g_mRNA')));
  assert.throws(() => addMrnaToGeneCds(graph), (e) => e.code === 'ID_COLLISION' && /addMrnaToGeneCds: created ID g_mRNA \(for g\) already exists/.test(e.message));
});

test('addExonPerCds adds one exon per CDS segment, numbered 5′ to 3′', () => {
  const { graph, changes } = addExonPerCds(addMrnaToGeneCds(settled()).graph);
  assert.deepEqual(changes, [
    { id: 'TST_0010_mRNA', created: ['TST_0010_mRNA_exon1', 'TST_0010_mRNA_exon2'], from: { level: 'transcript', id: 'TST_0010_mRNA' } },
    { id: 'TST_0020_mRNA', created: ['TST_0020_mRNA_exon1', 'TST_0020_mRNA_exon2'], from: { level: 'transcript', id: 'TST_0020_mRNA' } },
    { id: 'TST_0040_mRNA', created: ['TST_0040_mRNA_exon1'], from: { level: 'transcript', id: 'TST_0040_mRNA' } }
  ]);
  const minus = features(graph).filter((f) => f.type === 'exon' && idOf(f).startsWith('TST_0020'));
  assert.deepEqual(minus.map((f) => [idOf(f), f.start, f.end]), [['TST_0020_mRNA_exon1', 800, 900], ['TST_0020_mRNA_exon2', 500, 700]]);
  assert.match(serializeGff(graph), /ID=TST_0010_mRNA;Parent=TST_0010\nCM000001\.1\tEMBL\texon\t100\t200\t\.\t\+\t\.\tID=TST_0010_mRNA_exon1;Parent=TST_0010_mRNA\n/);
});

test('addExonPerCds skips transcripts that have exons or no CDS', () => {
  assert.deepEqual(addExonPerCds(settled()).changes, []);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/genome-transforms.test.js`
Expected: FAIL with `Cannot find module '…/transforms/add-mrna-to-gene-cds.js'`.

- [ ] **Step 3: Implement `shared/scripts/genome/transforms/add-mrna-to-gene-cds.js`**

```js
import { cloneGraph, featureGroups, indexGraph, newFeature, parentsOf, setRawAttr, withInsertions } from '../gff.js';
import { levelOf } from '../feature-types.js';
import { claimIds } from './claim-ids.js';

export function addMrnaToGeneCds(input) {
  const graph = cloneGraph(input);
  const { childrenOf } = indexGraph(graph);
  const claim = claimIds(graph, 'addMrnaToGeneCds');
  const after = new Map();
  const changes = [];
  for (const g of featureGroups(graph)) {
    if (levelOf(g.type) !== 'gene' || g.id === null) continue;
    const kids = childrenOf(g.id);
    const cds = kids.filter((f) => f.type === 'CDS');
    if (!cds.length || kids.some((f) => levelOf(f.type) === 'transcript')) continue;
    const mrnaId = claim(`${g.id}_mRNA`, g.id);
    const [first] = g.lines;
    after.set(g.lines.at(-1), [newFeature({
      seqId: first.seqId, source: first.source, type: 'mRNA',
      start: Math.min(...g.lines.map((f) => f.start)), end: Math.max(...g.lines.map((f) => f.end)), strand: first.strand,
      attrs: [['ID', mrnaId], ['Parent', g.id]]
    })]);
    for (const f of cds) setRawAttr(f, 'Parent', parentsOf(f).map((p) => (p === g.id ? mrnaId : p)).join(','));
    changes.push({ id: g.id, created: [mrnaId], from: { level: 'gene', id: g.id } });
  }
  return { graph: withInsertions(graph, { after }), changes };
}
```

- [ ] **Step 4: Implement `shared/scripts/genome/transforms/add-exon-per-cds.js`**

```js
import { cloneGraph, featureGroups, idOf, indexGraph, newFeature, withInsertions } from '../gff.js';
import { levelOf } from '../feature-types.js';
import { claimIds } from './claim-ids.js';

export function addExonPerCds(input) {
  const graph = cloneGraph(input);
  const { childrenOf } = indexGraph(graph);
  const claim = claimIds(graph, 'addExonPerCds');
  const after = new Map();
  const changes = [];
  for (const g of featureGroups(graph)) {
    if (levelOf(g.type) !== 'transcript' || g.id === null) continue;
    const kids = childrenOf(g.id);
    const cds = kids.filter((f) => f.type === 'CDS');
    if (!cds.length || kids.some((f) => f.type === 'exon')) continue;
    const minus = g.lines[0].strand === '-';
    const ordered = [...cds].sort((a, b) => (minus ? b.start - a.start : a.start - b.start));
    const exons = ordered.map((c, i) => newFeature({
      seqId: c.seqId, source: c.source, type: 'exon', start: c.start, end: c.end, strand: c.strand,
      attrs: [['ID', claim(`${g.id}_exon${i + 1}`, g.id)], ['Parent', g.id]]
    }));
    after.set(g.lines.at(-1), exons);
    changes.push({ id: g.id, created: exons.map(idOf), from: { level: 'transcript', id: g.id } });
  }
  return { graph: withInsertions(graph, { after }), changes };
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `node --test tests/genome-transforms.test.js`
Expected: PASS, 11 tests.

- [ ] **Step 6: Commit**

```bash
git add shared/scripts/genome/transforms tests/genome-transforms.test.js
git commit -m "Genome pipeline: addMrnaToGeneCds and addExonPerCds

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: `parentOrphanRnas` and the transform registry

**Files:**
- Create: `shared/scripts/genome/transforms/parent-orphan-rnas.js`, `shared/scripts/genome/transforms/index.js`
- Test: `tests/genome-transforms.test.js` (append)

- [ ] **Step 1: Append the failing tests**

Add imports: `import { parentOrphanRnas } from '../shared/scripts/genome/transforms/parent-orphan-rnas.js';`, `import { CANONICAL_ORDER, runTransforms, transformProblems } from '../shared/scripts/genome/transforms/index.js';`.

```js
test('parentOrphanRnas gives a parentless RNA a coordinate ID and a new gene', () => {
  const { graph, changes } = parentOrphanRnas(parseGff(TINY_GFF));
  assert.deepEqual(changes, [{
    id: 'rna-CM000001.1:1200..1300',
    created: ['gene_CM000001.1_1200_1300', 'rna_CM000001.1_1200_1300_snRNA'],
    from: { level: 'sequence', id: 'CM000001.1' }
  }]);
  assert.match(serializeGff(graph), new RegExp([
    'CM000001\\.1\\tEMBL\\tgene\\t1200\\t1300\\t\\.\\t\\+\\t\\.\\tID=gene_CM000001\\.1_1200_1300',
    'CM000001\\.1\\tEMBL\\tsnRNA\\t1200\\t1300\\t\\.\\t\\+\\t\\.\\tID=rna_CM000001\\.1_1200_1300_snRNA;Parent=gene_CM000001\\.1_1200_1300;gbkey=ncRNA;product=U4 snRNA',
    'CM000001\\.1\\tEMBL\\texon\\t1200\\t1300\\t\\.\\t\\+\\t\\.\\tID=exon-CM000001\\.1:1200\\.\\.1300-1;Parent=rna_CM000001\\.1_1200_1300_snRNA;'
  ].join('\\n')));
});

test('runTransforms runs the recipe in order, maps each created ID to its source and warns on a transform that changes nothing', () => {
  const r = runTransforms(parseGff(TINY_GFF), [{ name: 'collapseSplitGenes' }, { name: 'parentOrphanRnas' }, { name: 'stripAttributes', args: { type: 'gap', keys: ['gbkey'] } }]);
  assert.deepEqual(r.results, [
    { name: 'collapseSplitGenes', changes: 1, sample: ['gene-TST_0020'] },
    { name: 'parentOrphanRnas', changes: 1, sample: ['rna-CM000001.1:1200..1300'] },
    { name: 'stripAttributes', args: { type: 'gap', keys: ['gbkey'] }, changes: 0, sample: [] }
  ]);
  assert.deepEqual(r.warnings, ['stripAttributes changed nothing; the recipe declares a transform this genome does not need']);
  assert.deepEqual([...r.created], [
    ['gene_CM000001.1_1200_1300', { level: 'sequence', id: 'CM000001.1' }],
    ['rna_CM000001.1_1200_1300_snRNA', { level: 'sequence', id: 'CM000001.1' }]
  ]);
});

test('transformProblems names unknown transforms and bad args', () => {
  assert.deepEqual(CANONICAL_ORDER, ['collapseSplitGenes', 'addMrnaToGeneCds', 'addExonPerCds', 'parentOrphanRnas', 'stripAttributes']);
  assert.deepEqual(transformProblems([{ name: 'addMrnaToGeneCds' }, { name: 'renameEverything' }, { name: 'addExonPerCds', args: { x: 1 } }, { name: 'stripAttributes', args: { type: 'gene' } }]), [
    'transforms[1]: unknown transform renameEverything; known: collapseSplitGenes, addMrnaToGeneCds, addExonPerCds, parentOrphanRnas, stripAttributes',
    'transforms[2] addExonPerCds: takes no args',
    'transforms[3] stripAttributes: args.keys must be a non-empty list of attribute keys'
  ]);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/genome-transforms.test.js`
Expected: FAIL with `Cannot find module '…/transforms/parent-orphan-rnas.js'`.

- [ ] **Step 3: Implement `shared/scripts/genome/transforms/parent-orphan-rnas.js`**

```js
import { cloneGraph, featureGroups, newFeature, parentsOf, renameIds, setRawAttr, withInsertions } from '../gff.js';
import { levelOf } from '../feature-types.js';
import { claimIds } from './claim-ids.js';

export function parentOrphanRnas(input) {
  const graph = cloneGraph(input);
  const claim = claimIds(graph, 'parentOrphanRnas');
  const before = new Map();
  const rename = new Map();
  const changes = [];
  for (const g of featureGroups(graph)) {
    if (levelOf(g.type) !== 'transcript' || g.lines.some((f) => parentsOf(f).length)) continue;
    const [first] = g.lines;
    const start = Math.min(...g.lines.map((f) => f.start));
    const end = Math.max(...g.lines.map((f) => f.end));
    const label = g.id ?? `${first.seqId}:${start}..${end}`;
    const geneId = claim(`gene_${first.seqId}_${start}_${end}`, first.seqId);
    const rnaId = claim(`rna_${first.seqId}_${start}_${end}_${g.type}`, first.seqId);
    before.set(first, [newFeature({ seqId: first.seqId, source: first.source, type: 'gene', start, end, strand: first.strand, attrs: [['ID', geneId]] })]);
    for (const f of g.lines) {
      if (g.id === null) setRawAttr(f, 'ID', rnaId);
      setRawAttr(f, 'Parent', geneId);
    }
    if (g.id !== null) rename.set(g.id, rnaId);
    changes.push({ id: label, created: [geneId, rnaId], from: { level: 'sequence', id: first.seqId } });
  }
  renameIds(graph, rename);
  return { graph: withInsertions(graph, { before }), changes };
}
```

- [ ] **Step 4: Implement `shared/scripts/genome/transforms/index.js`**

```js
import { addExonPerCds } from './add-exon-per-cds.js';
import { addMrnaToGeneCds } from './add-mrna-to-gene-cds.js';
import { collapseSplitGenes } from './collapse-split-genes.js';
import { parentOrphanRnas } from './parent-orphan-rnas.js';
import { stripAttributes, stripAttributesProblems } from './strip-attributes.js';

const noArgs = (args) => (Object.keys(args).length ? ['takes no args'] : []);

/** In canonical order: the order survey suggests them in. */
export const TRANSFORMS = {
  collapseSplitGenes: { run: collapseSplitGenes, argProblems: noArgs },
  addMrnaToGeneCds: { run: addMrnaToGeneCds, argProblems: noArgs },
  addExonPerCds: { run: addExonPerCds, argProblems: noArgs },
  parentOrphanRnas: { run: parentOrphanRnas, argProblems: noArgs },
  stripAttributes: { run: stripAttributes, argProblems: stripAttributesProblems }
};
export const CANONICAL_ORDER = Object.keys(TRANSFORMS);

export function transformProblems(steps) {
  return steps.flatMap((step, i) => {
    const transform = TRANSFORMS[step?.name];
    if (!transform) return [`transforms[${i}]: unknown transform ${step?.name}; known: ${CANONICAL_ORDER.join(', ')}`];
    return transform.argProblems(step.args ?? {}).map((p) => `transforms[${i}] ${step.name}: ${p}`);
  });
}

/** `created` maps each created ID to the settled `{ level, id }` it derives from. */
export function runTransforms(graph, steps) {
  let current = graph;
  const results = [];
  const warnings = [];
  const created = new Map();
  for (const step of steps) {
    const { graph: next, changes } = TRANSFORMS[step.name].run(current, step.args ?? {});
    current = next;
    for (const change of changes) for (const id of change.created ?? []) created.set(id, change.from);
    if (!changes.length) warnings.push(`${step.name} changed nothing; the recipe declares a transform this genome does not need`);
    results.push({ name: step.name, ...(step.args && { args: step.args }), changes: changes.length, sample: changes.slice(0, 20).map((c) => c.id) });
  }
  return { graph: current, results, warnings, created };
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `node --test tests/genome-transforms.test.js`
Expected: PASS, 14 tests.

- [ ] **Step 6: Commit**

```bash
git add shared/scripts/genome/transforms tests/genome-transforms.test.js
git commit -m "Genome pipeline: parentOrphanRnas and the transform registry

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Checks (`checks.js`)

**Files:**
- Create: `shared/scripts/genome/checks.js`
- Test: `tests/genome-checks.test.js`

A finding is `{ group, check, severity, count, sample (≤ 20), message, fix }`; `fix` is `{ transforms }`, `{ ids }` (ids.tsv lines) or `{ partitions }` (partitions.tsv lines), or `null`. Order: structure, unhandled types, attributes, IDs, sequences. `ids.tsv` lines are always keyed by input IDs, so `runChecks` takes `inputIdOf` (settled → input, from `applyIdPolicy`) to write them, and `synthesized` (created ID → the settled `{ level, id }` it derives from, from `runTransforms`) so a bad created ID points at the source to rename.

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseAssemblyReport } from '../shared/scripts/genome/assembly-report.js';
import { collisionFinding, formatFinding, runChecks } from '../shared/scripts/genome/checks.js';
import { parseGff } from '../shared/scripts/genome/gff.js';
import { applyIdPolicy } from '../shared/scripts/genome/ids.js';
import { readIsfMap } from '../shared/scripts/genome/isf-map.js';
import { planPartitions } from '../shared/scripts/genome/partitions.js';
import { runTransforms } from '../shared/scripts/genome/transforms/index.js';
import { CM, genomeFixtures, gffLine, gffText, KZ, TINY_GFF, TINY_REPORT } from './genome-helpers.js';

const MINI_MAP = readIsfMap(readFileSync(join(genomeFixtures, 'isf-map-mini.xml'), 'utf-8'));
const TINY_PLAN = planPartitions({ sequenceIds: [CM, KZ], report: parseAssemblyReport(TINY_REPORT) });
const NO_PLAN = { partitions: [], problems: [] };
const tiny = (graph, extra = {}) => runChecks({ graph, isfMap: MINI_MAP, fastaIds: new Set([CM, KZ]), plan: TINY_PLAN, ...extra });
const small = (gff, extra = {}) => runChecks({ graph: parseGff(gff), isfMap: MINI_MAP, fastaIds: new Set(['c']), plan: NO_PLAN, ...extra });
const find = (findings, check) => findings.find((f) => f.check === check);
const STRUCTURAL = [{ name: 'collapseSplitGenes' }, { name: 'addMrnaToGeneCds' }, { name: 'addExonPerCds' }, { name: 'parentOrphanRnas' }];

test('the raw tiny genome: structure errors, dropped features, partition counts', () => {
  const f = tiny(parseGff(TINY_GFF));
  assert.deepEqual(f.map((x) => [x.group, x.check, x.severity, x.count]), [
    ['structure', 'geneCdsNoRna', 'error', 3],
    ['structure', 'repeatedGeneLines', 'error', 1],
    ['structure', 'parentlessRna', 'error', 1],
    ['structure', 'unhandledType', 'warning', 5],
    ['sequences', 'partitionCounts', 'info', 2]
  ]);
  assert.deepEqual(find(f, 'geneCdsNoRna').sample, ['gene-TST_0010', 'gene-TST_0020', 'gene-TST_0040']);
  assert.deepEqual(find(f, 'geneCdsNoRna').fix, { transforms: [{ name: 'addMrnaToGeneCds' }, { name: 'addExonPerCds' }] });
  assert.deepEqual(find(f, 'repeatedGeneLines').fix, { transforms: [{ name: 'collapseSplitGenes' }] });
  assert.deepEqual(find(f, 'parentlessRna').sample, ['rna-CM000001.1:1200..1300']);
  assert.equal(find(f, 'unhandledType').message, 'ISF drops these features: region 1, gene 4');
  assert.equal(find(f, 'partitionCounts').message, 'primary_chromosome: 1, secondary_supercontig: 1');
});

test('after the policy and structural transforms only an unmapped key remains, with its strip', () => {
  const policy = applyIdPolicy(parseGff(TINY_GFF), { policy: 'ncbiDefault' });
  const run = runTransforms(policy.graph, STRUCTURAL);
  const f = tiny(run.graph, { synthesized: run.created, inputIdOf: policy.inputIdOf });
  assert.deepEqual(f.map((x) => x.check), ['unhandledType', 'attributeNotInMap', 'partitionCounts']);
  assert.deepEqual(find(f, 'attributeNotInMap'), {
    group: 'attributes', check: 'attributeNotInMap', severity: 'error', count: 1, sample: ['TST_0020'],
    message: 'gene (ISF coding_gene) carries keys the map does not list: is_ordered',
    fix: { transforms: [{ name: 'stripAttributes', args: { type: 'gene', keys: ['is_ordered'] } }] }
  });
});

test('Dbxref and previous_systematic_id are allowed on any mapped feature', () => {
  const f = small(gffText(
    gffLine('c', 'gene', 1, 9, '+', 'ID=g;Dbxref=x;previous_systematic_id=y;foo=1'),
    gffLine('c', 'mRNA', 1, 9, '+', 'ID=t;Parent=g'),
    gffLine('c', 'exon', 1, 9, '+', 'ID=e;Parent=t')
  ));
  assert.equal(find(f, 'attributeNotInMap').message, 'gene (ISF coding_gene) carries keys the map does not list: foo');
});

test('ISF types the map lacks are dropped features too', () => {
  const f = small(gffText(gffLine('c', 'gene', 1, 9, '+', 'ID=g'), gffLine('c', 'ncRNA', 1, 9, '+', 'ID=t;Parent=g'), gffLine('c', 'exon', 1, 9, '+', 'ID=e;Parent=t')));
  assert.equal(find(f, 'unhandledType').message, 'ISF drops these features: ncRNA_gene (not in the map) 1, ncRNA (not in the map) 1');
  assert.deepEqual(find(f, 'unhandledType').sample, ['g', 't']);
});

test('transcript with CDS and no exons; gene with no children', () => {
  const f = small(gffText(gffLine('c', 'gene', 1, 9, '+', 'ID=g'), gffLine('c', 'mRNA', 1, 9, '+', 'ID=t;Parent=g'), gffLine('c', 'CDS', 1, 9, '+', 'ID=p;Parent=t'), gffLine('c', 'gene', 20, 29, '+', 'ID=lonely')));
  assert.deepEqual(find(f, 'transcriptCdsNoExon').sample, ['t']);
  assert.deepEqual(find(f, 'childlessGene'), { group: 'structure', check: 'childlessGene', severity: 'warning', count: 1, sample: ['lonely'], message: 'genes with no children; ISF drops them', fix: null });
});

test('duplicate IDs, created IDs with ":" or "-", and transcripts with several protein_ids', () => {
  const dup = small(gffText(gffLine('c', 'gene', 1, 9, '+', 'ID=X'), gffLine('c', 'tRNA', 20, 29, '+', 'ID=X')), { inputIdOf: new Map([['Y', 'rna-Y']]) });
  assert.deepEqual(find(dup, 'duplicateId'), {
    group: 'ids', check: 'duplicateId', severity: 'error', count: 1, sample: ['X'],
    message: 'IDs used by several features: X (gene, tRNA)', fix: { ids: ['transcript\tX\t<new id>'] }
  });
  const renamedDup = small(gffText(gffLine('c', 'gene', 1, 9, '+', 'ID=Y'), gffLine('c', 'mRNA', 20, 29, '+', 'ID=Y')), { inputIdOf: new Map([['Y', 'rna-Y']]) });
  assert.deepEqual(find(renamedDup, 'duplicateId').fix, { ids: ['transcript\trna-Y\t<new id>'] });
  const fromSequence = { level: 'sequence', id: 'scaffold-1' };
  const punct = small(gffText(gffLine('c', 'gene', 1, 9, '+', 'ID=g'), gffLine('c', 'tRNA', 1, 9, '+', 'ID=rna_scaffold-1_1_9_tRNA;Parent=g')),
    { synthesized: new Map([['rna_scaffold-1_1_9_tRNA', fromSequence], ['absent_id', fromSequence]]), inputIdOf: new Map([['scaffold-1', 'NW_000001.1']]) });
  assert.deepEqual(find(punct, 'synthesizedIdPunctuation'), {
    group: 'ids', check: 'synthesizedIdPunctuation', severity: 'error', count: 1, sample: ['rna_scaffold-1_1_9_tRNA'],
    message: 'created IDs containing ":" or "-"; rename what they are made from',
    fix: { ids: ['sequence\tNW_000001.1\t<new id>'] }
  });
  const multi = small(gffText(
    gffLine('c', 'gene', 1, 30, '+', 'ID=g'), gffLine('c', 'mRNA', 1, 30, '+', 'ID=t;Parent=g'),
    gffLine('c', 'exon', 1, 9, '+', 'ID=e1;Parent=t'), gffLine('c', 'exon', 20, 30, '+', 'ID=e2;Parent=t'),
    gffLine('c', 'CDS', 1, 9, '+', 'ID=c1;Parent=t;protein_id=P1'), gffLine('c', 'CDS', 20, 30, '+', 'ID=c2;Parent=t;protein_id=P2')
  ));
  assert.deepEqual(find(multi, 'multipleProteinIds').sample, ['t']);
});

test('sequence checks: GFF sequences missing from the FASTA, and report problems with partitions.tsv templates', () => {
  assert.deepEqual(find(tiny(parseGff(TINY_GFF), { fastaIds: new Set([CM]) }), 'seqIdNotInFasta').sample, [KZ]);
  const f = small(gffText(gffLine('c', 'gene', 1, 9, '+', 'ID=g')), { plan: { partitions: [], problems: [{ kind: 'notInReport', sequence: 'ZZ1' }] } });
  assert.deepEqual(find(f, 'notInReport'), {
    group: 'sequences', check: 'notInReport', severity: 'error', count: 1, sample: ['ZZ1'],
    message: 'sequences missing from the assembly report', fix: { partitions: ['ZZ1\t<role>\t<soTerm>\t<organelle>'] }
  });
});

test('collisionFinding names both features and the ids.tsv line for the second', () => {
  const f = collisionFinding([{ id: 'T1', olds: [{ id: 'gene-T1', level: 'gene', type: 'gene' }, { id: 'rna-T1', level: 'transcript', type: 'tRNA' }] }]);
  assert.equal(f.message, 'the ID policy gives one ID to several features: T1 ← gene-T1 and rna-T1');
  assert.deepEqual(f.fix, { ids: ['transcript\trna-T1\t<new id>'] });
});

test('formatFinding prints one line', () => {
  assert.equal(formatFinding({ stage: 'raw', severity: 'error', group: 'structure', check: 'repeatedGeneLines', count: 1, sample: ['g'], message: 'm' }),
    'raw error structure/repeatedGeneLines (1): m [g]');
  assert.equal(formatFinding({ severity: 'info', group: 'sequences', check: 'partitionCounts', count: 1, sample: [], message: 'x' }),
    'info sequences/partitionCounts (1): x');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/genome-checks.test.js`
Expected: FAIL with `Cannot find module '…/genome/checks.js'`.

- [ ] **Step 3: Implement**

```js
import { featureGroups, getValues, indexGraph, parentsOf, seqIdsOf } from './gff.js';
import { levelOf } from './feature-types.js';
import { ALLOWED_EXTRA_KEYS, isfTrees } from './isf-map.js';

const SAMPLE = 20;
const finding = (group, check, severity, ids, message, fix = null) =>
  ({ group, check, severity, count: ids.length, sample: ids.slice(0, SAMPLE), message, fix });
const labelOf = (x) => x.id ?? `${x.seqId}:${x.start}..${x.end}`;
const groupLabel = (g) => g.id ?? labelOf(g.lines[0]);
function tally(items) {
  const counts = new Map();
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1);
  return [...counts].map(([item, n]) => `${item} ${n}`).join(', ');
}
function walk(trees, visit) {
  for (const t of trees) { visit(t); walk(t.children, visit); }
}

export const formatFinding = (f) =>
  `${f.stage ? `${f.stage} ` : ''}${f.severity} ${f.group}/${f.check} (${f.count}): ${f.message}${f.sample.length ? ` [${f.sample.join(', ')}]` : ''}`;

export function runChecks({ graph, isfMap, fastaIds, plan, synthesized = new Map(), inputIdOf = new Map() }) {
  const groups = featureGroups(graph);
  const { childrenOf } = indexGraph(graph);
  const { trees, dropped } = isfTrees(graph);
  return [
    ...structureFindings(groups, childrenOf),
    ...unhandledFindings(trees, dropped, isfMap),
    ...attributeFindings(trees, isfMap),
    ...idFindings(groups, childrenOf, synthesized, (id) => inputIdOf.get(id) ?? id),
    ...sequenceFindings(graph, fastaIds, plan)
  ];
}

function structureFindings(groups, childrenOf) {
  const kids = (g) => (g.id === null ? [] : childrenOf(g.id));
  const genes = groups.filter((g) => levelOf(g.type) === 'gene');
  const transcripts = groups.filter((g) => levelOf(g.type) === 'transcript');
  const hasCds = (g) => kids(g).some((f) => f.type === 'CDS');
  return [
    finding('structure', 'geneCdsNoRna', 'error',
      genes.filter((g) => hasCds(g) && !kids(g).some((f) => levelOf(f.type) === 'transcript')).map(groupLabel),
      'genes with CDS children and no RNA; ISF drops them', { transforms: [{ name: 'addMrnaToGeneCds' }, { name: 'addExonPerCds' }] }),
    finding('structure', 'transcriptCdsNoExon', 'error',
      transcripts.filter((g) => hasCds(g) && !kids(g).some((f) => f.type === 'exon')).map(groupLabel),
      'transcripts with CDS and no exons; ISF loads them as one exon or dies', { transforms: [{ name: 'addExonPerCds' }] }),
    finding('structure', 'repeatedGeneLines', 'error', genes.filter((g) => g.lines.length > 1).map(groupLabel),
      'genes repeated over several lines with one ID', { transforms: [{ name: 'collapseSplitGenes' }] }),
    finding('structure', 'parentlessRna', 'error', transcripts.filter((g) => g.lines.every((f) => !parentsOf(f).length)).map(groupLabel),
      'RNAs with no parent gene', { transforms: [{ name: 'parentOrphanRnas' }] }),
    finding('structure', 'childlessGene', 'warning', genes.filter((g) => !kids(g).length).map(groupLabel), 'genes with no children; ISF drops them')
  ].filter((f) => f.count);
}

function unhandledFindings(trees, dropped, isfMap) {
  const lost = dropped.map((d) => ({ type: d.type, label: labelOf(d) }));
  walk(trees, (n) => { if (!isfMap.features.has(n.type)) lost.push({ type: `${n.type} (not in the map)`, label: labelOf(n) }); });
  if (!lost.length) return [];
  return [finding('structure', 'unhandledType', 'warning', lost.map((l) => l.label), `ISF drops these features: ${tally(lost.map((l) => l.type))}`)];
}

function attributeFindings(trees, isfMap) {
  const bad = new Map();
  walk(trees, (n) => {
    const spec = isfMap.features.get(n.type);
    if (!spec || spec.ignore) return;
    const keys = n.keys.filter((k) => !spec.qualifiers.has(k) && !ALLOWED_EXTRA_KEYS.has(k));
    if (!keys.length) return;
    if (!bad.has(n.gffType)) bad.set(n.gffType, { isfTypes: new Set(), keys: new Set(), ids: [] });
    const entry = bad.get(n.gffType);
    entry.isfTypes.add(n.type);
    keys.forEach((k) => entry.keys.add(k));
    entry.ids.push(labelOf(n));
  });
  return [...bad].map(([gffType, entry]) => {
    const keys = [...entry.keys].sort();
    return finding('attributes', 'attributeNotInMap', 'error', entry.ids,
      `${gffType} (ISF ${[...entry.isfTypes].join(', ')}) carries keys the map does not list: ${keys.join(', ')}`,
      { transforms: [{ name: 'stripAttributes', args: { type: gffType, keys } }] });
  });
}

/** IDs carried by more than one feature group (groups differ in ID or type). */
export function duplicateIds(groups) {
  const owners = new Map();
  for (const g of groups) {
    if (g.id === null) continue;
    if (!owners.has(g.id)) owners.set(g.id, []);
    owners.get(g.id).push(g.type);
  }
  return [...owners].filter(([, types]) => types.length > 1).map(([id, types]) => ({ id, types }));
}

const levelName = (type) => levelOf(type) ?? type;

function idFindings(groups, childrenOf, synthesized, inputOf) {
  const dups = duplicateIds(groups);
  const present = new Set(groups.filter((g) => g.id !== null).map((g) => g.id));
  const punct = [...synthesized.keys()].filter((id) => present.has(id) && /[:-]/.test(id));
  const sources = [...new Set(punct.map((id) => synthesized.get(id)).map((from) => `${from.level}\t${inputOf(from.id)}\t<new id>`))];
  const proteinIds = (g) => new Set(childrenOf(g.id).filter((f) => f.type === 'CDS').flatMap((f) => getValues(f, 'protein_id')));
  const multi = groups.filter((g) => g.id !== null && levelOf(g.type) === 'transcript' && proteinIds(g).size > 1).map((g) => g.id);
  return [
    finding('ids', 'duplicateId', 'error', dups.map((d) => d.id),
      `IDs used by several features: ${dups.slice(0, SAMPLE).map((d) => `${d.id} (${d.types.join(', ')})`).join('; ')}`,
      { ids: dups.map((d) => `${levelName(d.types.at(-1))}\t${inputOf(d.id)}\t<new id>`) }),
    finding('ids', 'synthesizedIdPunctuation', 'error', punct, 'created IDs containing ":" or "-"; rename what they are made from', { ids: sources }),
    finding('ids', 'multipleProteinIds', 'error', multi, 'transcripts whose CDSs carry more than one protein_id')
  ].filter((f) => f.count);
}

/** The phase-1 collisions of an ID policy, as a duplicateId finding naming input IDs. */
export const collisionFinding = (collisions) => finding('ids', 'duplicateId', 'error', collisions.map((c) => c.id),
  `the ID policy gives one ID to several features: ${collisions.slice(0, SAMPLE).map((c) => `${c.id} ← ${c.olds.map((o) => o.id).join(' and ')}`).join('; ')}`,
  { ids: collisions.flatMap((c) => c.olds.slice(1).map((o) => `${o.level ?? o.type}\t${o.id}\t<new id>`)) });

const PROBLEMS = {
  notInReport: 'sequences missing from the assembly report',
  missingAccession: 'sequences with no GenBank accession in the assembly report',
  unknownRole: 'sequences with a Sequence-Role this pipeline does not rank',
  unknownLocationType: 'sequences with a location type this pipeline does not rank',
  multiplePrimary: 'more than one primary partition',
  noPrimary: 'no primary partition',
  duplicateAccession: 'accessions on more than one assembly report row',
  unusedOverride: 'partitions.tsv rows for sequences not in the GFF or FASTA',
  conflictingSoTerm: 'organelle partitions whose sequences have different soTerms'
};

function sequenceFindings(graph, fastaIds, plan) {
  const out = [finding('sequences', 'seqIdNotInFasta', 'error', seqIdsOf(graph).filter((id) => !fastaIds.has(id)), 'GFF sequences missing from the FASTA')];
  for (const [kind, message] of Object.entries(PROBLEMS)) {
    const hits = plan.problems.filter((p) => p.kind === kind).map((p) => p.sequence);
    out.push(finding('sequences', kind, 'error', hits, message, { partitions: hits.map((s) => `${s}\t<role>\t<soTerm>\t<organelle>`) }));
  }
  out.push(finding('sequences', 'partitionCounts', 'info', plan.partitions.map((p) => p.dir),
    plan.partitions.map((p) => `${p.dir.slice('final/'.length)}: ${p.sequences.length}`).join(', ')));
  return out.filter((f) => f.count);
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test tests/genome-checks.test.js`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add shared/scripts/genome/checks.js tests/genome-checks.test.js
git commit -m "Genome pipeline: the checks survey and build share

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Running `preprocessGFF3` (`preprocess-gff3.js`)

**Files:**
- Create: `shared/scripts/genome/preprocess-gff3.js`
- Modify: `tests/genome-helpers.js` (append `withoutBioSeqIO`, `perlMissing`)
- Test: `tests/genome-preprocess-gff3.test.js`

Process execution goes through `defaultExec` from `shared/scripts/lib/tools/exec.js` (`execFileSync`, utf-8, piped stdio), injectable as `exec`. The golden and the real-script test never modify the ApiCommonData checkout: `withoutBioSeqIO` copies `preprocessGFF3` into a temp dir with its `use Bio::SeqIO;` line removed, and the copy is passed as `--preprocessGFF3`.

- [ ] **Step 1: Append to `tests/genome-helpers.js`**

Add `import { readFileSync, writeFileSync } from 'node:fs';` and `import { spawnSync } from 'node:child_process';` to the helper imports (merge with the existing `node:fs` import).

```js
/** A copy of preprocessGFF3 without its unused `use Bio::SeqIO;`, so it runs on core perl. */
export function withoutBioSeqIO(script, dir) {
  const dest = join(dir, 'preprocessGFF3');
  writeFileSync(dest, readFileSync(script, 'utf-8').replace(/^use Bio::SeqIO;\s*\n/m, ''));
  return dest;
}

export const perlMissing = spawnSync('perl', ['-v']).status !== 0 && 'perl is not on PATH';
```

- [ ] **Step 2: Write the failing test** (`tests/genome-preprocess-gff3.test.js`)

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { apiCommonDataCommit, BIO_SEQIO_FIX, compileProblem, runPreprocessGFF3, SCRIPT_PATH } from '../shared/scripts/genome/preprocess-gff3.js';
import { gffLine, gffText, perlMissing, tempDir, withoutBioSeqIO } from './genome-helpers.js';

const ACD = process.env.APICOMMONDATA_DIR;
const failing = (stderr, code) => () => { throw Object.assign(new Error('Command failed'), { stderr, status: 2, ...(code && { code }) }); };

test('compileProblem is null for a script that compiles and returns what perl printed otherwise', () => {
  const calls = [];
  assert.equal(compileProblem('/x/preprocessGFF3', { exec: (cmd, args) => { calls.push([cmd, ...args]); return ''; } }), null);
  assert.deepEqual(calls, [['perl', '-c', '/x/preprocessGFF3']]);
  assert.match(compileProblem('/x', { exec: failing("Can't locate Bio/SeqIO.pm in @INC") }), /Can't locate Bio\/SeqIO\.pm/);
});

test('a missing perl throws instead of reporting a compile problem', () => {
  assert.throws(() => compileProblem('/x', { exec: failing('', 'ENOENT') }), /perl is not on PATH/);
});

test('BIO_SEQIO_FIX names the line to remove and the --preprocessGFF3 escape hatch', () => {
  assert.match(BIO_SEQIO_FIX, /`use Bio::SeqIO;`/);
  assert.match(BIO_SEQIO_FIX, /--preprocessGFF3/);
});

test('runPreprocessGFF3 passes input and output and refuses empty output', () => {
  const dir = tempDir('preprocess-');
  const calls = [];
  const out = join(dir, 'out.gff');
  runPreprocessGFF3('/s', '/in.gff3', out, { exec: (cmd, args) => { calls.push([cmd, ...args]); writeFileSync(out, 'x\n'); } });
  assert.deepEqual(calls, [['perl', '/s', '--input_gff', '/in.gff3', '--output_gff', out]]);
  assert.throws(() => runPreprocessGFF3('/s', '/in.gff3', join(dir, 'none.gff'), { exec: () => '' }), /preprocessGFF3 wrote nothing to .*none\.gff/);
  assert.throws(() => runPreprocessGFF3('/s', '/in.gff3', out, { exec: failing('boom') }), /preprocessGFF3 failed on \/in\.gff3: boom/);
});

test('apiCommonDataCommit reads HEAD of a git checkout and refuses anything else', () => {
  const dir = tempDir('acd-');
  execFileSync('git', ['init', '-q', dir]);
  writeFileSync(join(dir, 'f'), 'x');
  execFileSync('git', ['-C', dir, 'add', '.']);
  execFileSync('git', ['-C', dir, '-c', 'user.email=t@apidb.org', '-c', 'user.name=T', 'commit', '-q', '-m', 'x']);
  assert.equal(apiCommonDataCommit(dir), execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim());
  assert.throws(() => apiCommonDataCommit(tempDir('not-git-')), /is not a git checkout/);
});

test('the real preprocessGFF3 without its Bio::SeqIO line rewrites attributes GFF2-style',
  { skip: (!ACD && 'APICOMMONDATA_DIR is not set; point it at an ApiCommonData checkout') || perlMissing }, () => {
    const dir = tempDir('preprocess-real-');
    const script = withoutBioSeqIO(join(ACD, SCRIPT_PATH), dir);
    assert.equal(compileProblem(script), null);
    writeFileSync(join(dir, 'in.gff3'), gffText(gffLine('c', 'gene', 1, 9, '+', 'ID=g1;Note=a%2C b')));
    runPreprocessGFF3(script, join(dir, 'in.gff3'), join(dir, 'out.gff'));
    assert.equal(readFileSync(join(dir, 'out.gff'), 'utf-8'), 'c\tEMBL\tgene\t1\t9\t.\t+\t.\tID "g1";Note "a, b";\n');
  });
```

- [ ] **Step 3: Run it to verify it fails**

Run: `node --test tests/genome-preprocess-gff3.test.js`
Expected: FAIL with `Cannot find module '…/genome/preprocess-gff3.js'`.

- [ ] **Step 4: Implement**

```js
import { existsSync, statSync } from 'node:fs';
import { defaultExec, failureOutput } from '../lib/tools/exec.js';

export const MAP_PATH = 'Load/lib/xml/isf/genemRNAExonCDS2Gus.xml';
export const SCRIPT_PATH = 'Load/bin/preprocessGFF3';
export const BIO_SEQIO_FIX = 'preprocessGFF3 needs only core Perl modules once its unused `use Bio::SeqIO;` line is removed '
  + '(a separate ApiCommonData change); until then install BioPerl, or pass --preprocessGFF3 <a copy without that line>';

/** null when the script compiles, else what perl printed. Throws when perl itself is missing. */
export function compileProblem(script, { exec = defaultExec, perl = 'perl' } = {}) {
  try {
    exec(perl, ['-c', script]);
    return null;
  } catch (e) {
    if (e.code === 'ENOENT') throw new Error(`${perl} is not on PATH`);
    return failureOutput(e);
  }
}

export function runPreprocessGFF3(script, input, output, { exec = defaultExec, perl = 'perl' } = {}) {
  try {
    exec(perl, [script, '--input_gff', input, '--output_gff', output]);
  } catch (e) {
    throw new Error(`preprocessGFF3 failed on ${input}: ${failureOutput(e)}`);
  }
  if (!existsSync(output) || statSync(output).size === 0) throw new Error(`preprocessGFF3 wrote nothing to ${output}`);
}

export function apiCommonDataCommit(dir, { exec = defaultExec } = {}) {
  try {
    return exec('git', ['-C', dir, 'rev-parse', 'HEAD']).trim();
  } catch (e) {
    throw new Error(`${dir} is not a git checkout: ${failureOutput(e)}`);
  }
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `node --test tests/genome-preprocess-gff3.test.js`
Expected: PASS, 5 tests, 1 skipped (6 pass with `APICOMMONDATA_DIR=/home/jbrestel/workspaces/src/ApiCommonData` and perl).

- [ ] **Step 6: Commit**

```bash
git add shared/scripts/genome/preprocess-gff3.js tests/genome-helpers.js tests/genome-preprocess-gff3.test.js
git commit -m "Genome pipeline: perl -c precheck and preprocessGFF3 runner

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: `fetch` (`commands/fetch.js`)

**Files:**
- Create: `shared/scripts/genome/commands/fetch.js`
- Modify: `tests/genome-helpers.js` (append the NCBI stub and tiny downloads)
- Test: `tests/genome-fetch.test.js`

The seam is `fetchBytes(url) → Promise<Buffer | null>` (`null` for 404); the default uses global `fetch`. The assembly directory comes from NCBI's FTP listing: `GCA_000091225.2` → `https://ftp.ncbi.nlm.nih.gov/genomes/all/GCA/000/091/225/`, whose listing names `GCA_000091225.2_ASM9122v2/`.

- [ ] **Step 1: Append to `tests/genome-helpers.js`**

Add `import { gzipSync } from 'node:zlib';` and `import { assemblyDirUrl, runFetch } from '../shared/scripts/genome/commands/fetch.js';` to the helper imports.

```js
export const TINY_ACCESSION = 'GCA_000000001.1';
export const TINY_ASSEMBLY = 'GCA_000000001.1_TINY1';
export const TINY_FASTA = `>${CM} Testus tinyus chromosome 1\n${'ACGT'.repeat(15)}\n${'ACGT'.repeat(15)}\n>${KZ} Testus tinyus scaffold2\n${'TTGA'.repeat(15)}\n`;
export const FIXED_NOW = () => '2026-11-04T00:00:00.000Z';

export const tinyFiles = ({ gff = TINY_GFF, fasta = TINY_FASTA, report = TINY_REPORT } = {}) => ({
  [`${TINY_ASSEMBLY}_genomic.gff.gz`]: gzipSync(gff),
  [`${TINY_ASSEMBLY}_genomic.fna.gz`]: gzipSync(fasta),
  [`${TINY_ASSEMBLY}_assembly_report.txt`]: Buffer.from(report)
});

/** NCBI FTP over HTTPS, served from memory: the directory listing, then the assembly's files. */
export function stubNcbi(accession, assembly, files) {
  const dirUrl = assemblyDirUrl(accession);
  const fileBase = `${dirUrl}${assembly}/`;
  const requests = [];
  const fetchBytes = async (url) => {
    requests.push(url);
    if (url === dirUrl) return Buffer.from(`<html><body>\n<a href="../">../</a>\n<a href="${assembly}/">${assembly}/</a>\n</body></html>\n`);
    const name = url.startsWith(fileBase) ? url.slice(fileBase.length) : null;
    return name && files[name] ? Buffer.from(files[name]) : null;
  };
  return { fetchBytes, requests };
}

export async function fetchedWorkDir(options) {
  const workDir = tempDir('genome-work-');
  await runFetch({ workDir, accession: TINY_ACCESSION, fetchBytes: stubNcbi(TINY_ACCESSION, TINY_ASSEMBLY, tinyFiles(options)).fetchBytes, now: FIXED_NOW });
  return workDir;
}
```

- [ ] **Step 2: Write the failing test** (`tests/genome-fetch.test.js`)

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assemblyDirUrl, runFetch, verifyFetch } from '../shared/scripts/genome/commands/fetch.js';
import { PipelineError, sha256 } from '../shared/scripts/genome/workdir.js';
import { FIXED_NOW, fetchedWorkDir, stubNcbi, tempDir, TINY_ACCESSION, TINY_ASSEMBLY, TINY_GFF, TINY_REPORT, tinyFiles } from './genome-helpers.js';

const REPORT = `${TINY_ASSEMBLY}_assembly_report.txt`;
const GFF = `${TINY_ASSEMBLY}_genomic.gff.gz`;

test('assemblyDirUrl splits the accession digits the way NCBI FTP does', () => {
  assert.equal(assemblyDirUrl('GCA_000091225.2'), 'https://ftp.ncbi.nlm.nih.gov/genomes/all/GCA/000/091/225/');
  assert.equal(assemblyDirUrl('GCF_000002765.6'), 'https://ftp.ncbi.nlm.nih.gov/genomes/all/GCF/000/002/765/');
  assert.throws(() => assemblyDirUrl('PRJNA13833'), /PRJNA13833 is not an NCBI assembly accession/);
});

test('fetch downloads the GFF, FASTA and report and records each sha256', async () => {
  const workDir = tempDir('fetch-');
  const ncbi = stubNcbi(TINY_ACCESSION, TINY_ASSEMBLY, tinyFiles());
  const record = await runFetch({ workDir, accession: TINY_ACCESSION, fetchBytes: ncbi.fetchBytes, now: FIXED_NOW });
  assert.equal(record.accession, TINY_ACCESSION);
  assert.equal(record.assembly, TINY_ASSEMBLY);
  assert.equal(record.fetchedAt, FIXED_NOW());
  assert.deepEqual(Object.keys(record.files), ['gff', 'fasta', 'report']);
  assert.equal(record.files.gff.url, `${assemblyDirUrl(TINY_ACCESSION)}${TINY_ASSEMBLY}/${GFF}`);
  assert.equal(record.files.report.sha256, sha256(TINY_REPORT));
  assert.equal(readFileSync(join(workDir, 'fetch', REPORT), 'utf-8'), TINY_REPORT);
  assert.deepEqual(JSON.parse(readFileSync(join(workDir, 'fetch/fetch.json'), 'utf-8')), record);
  assert.ok(ncbi.requests.every((url) => url.startsWith('https://ftp.ncbi.nlm.nih.gov/genomes/all/GCA/000/000/001/')));
});

test('a re-run reuses local files and keeps the first record', async () => {
  const workDir = await fetchedWorkDir();
  const before = statSync(join(workDir, 'fetch', GFF)).mtimeMs;
  const record = await runFetch({ workDir, accession: TINY_ACCESSION, fetchBytes: stubNcbi(TINY_ACCESSION, TINY_ASSEMBLY, tinyFiles()).fetchBytes, now: () => 'later' });
  assert.equal(record.fetchedAt, FIXED_NOW());
  assert.equal(statSync(join(workDir, 'fetch', GFF)).mtimeMs, before);
});

test('a remote file that drifted from fetch.json is an error naming the file', async () => {
  const workDir = await fetchedWorkDir();
  const drifted = stubNcbi(TINY_ACCESSION, TINY_ASSEMBLY, tinyFiles({ gff: TINY_GFF.replace('U4 snRNA', 'U6 snRNA') }));
  await assert.rejects(runFetch({ workDir, accession: TINY_ACCESSION, fetchBytes: drifted.fetchBytes }),
    (e) => e instanceof PipelineError && e.file === GFF && /NCBI's copy changed since 2026-11-04T00:00:00\.000Z/.test(e.problem));
});

test('an assembly with no annotation GFF is an error', async () => {
  const files = tinyFiles();
  delete files[GFF];
  await assert.rejects(runFetch({ workDir: tempDir('fetch-'), accession: TINY_ACCESSION, fetchBytes: stubNcbi(TINY_ACCESSION, TINY_ASSEMBLY, files).fetchBytes }),
    /fetch: .*genomic\.gff\.gz: GCA_000000001\.1 has no annotation GFF/);
});

test('an accession NCBI does not list is an error', async () => {
  await assert.rejects(runFetch({ workDir: tempDir('fetch-'), accession: 'GCA_000000009.1', fetchBytes: stubNcbi(TINY_ACCESSION, TINY_ASSEMBLY, tinyFiles()).fetchBytes }),
    /fetch: https:\/\/ftp\.ncbi\.nlm\.nih\.gov\/genomes\/all\/GCA\/000\/000\/009\/: lists no assembly directory for GCA_000000009\.1/);
});

test('verifyFetch returns the record and paths, and refuses a local file changed after fetch', async () => {
  const workDir = await fetchedWorkDir();
  const { record, paths } = verifyFetch(workDir, 'survey');
  assert.equal(record.assembly, TINY_ASSEMBLY);
  assert.equal(paths.report, join(workDir, 'fetch', REPORT));
  writeFileSync(join(workDir, 'fetch', REPORT), 'edited');
  assert.throws(() => verifyFetch(workDir, 'survey'), /^survey: .*assembly_report\.txt: does not match fetch\/fetch\.json\nNext: delete it and run fetch again$/);
  assert.throws(() => verifyFetch(tempDir('empty-'), 'build'), /fetch\.json: is missing\nNext: run fetch <assemblyAccession> first/);
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `node --test tests/genome-fetch.test.js`
Expected: FAIL with `Cannot find module '…/genome/commands/fetch.js'`.

- [ ] **Step 4: Implement**

```js
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PipelineError, readJson, sha256, sha256File, workPaths, writeJson } from '../workdir.js';

export const NCBI_FTP = 'https://ftp.ncbi.nlm.nih.gov/genomes/all';
const ACCESSION = /^(GC[AF])_(\d{3})(\d{3})(\d{3})\.\d+$/;
const FILES = { gff: '_genomic.gff.gz', fasta: '_genomic.fna.gz', report: '_assembly_report.txt' };

export function assemblyDirUrl(accession) {
  const m = accession.match(ACCESSION);
  if (!m) throw new Error(`${accession} is not an NCBI assembly accession (GCA_ or GCF_ plus nine digits and a version)`);
  return `${NCBI_FTP}/${m[1]}/${m[2]}/${m[3]}/${m[4]}/`;
}

export async function defaultFetchBytes(url) {
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET ${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function assemblyDir(accession, dirUrl, fetchBytes) {
  const listing = await fetchBytes(dirUrl);
  const names = listing
    ? [...listing.toString('utf-8').matchAll(/href="([^"]+?)\/?"/g)].map(([, n]) => n).filter((n) => n.startsWith(`${accession}_`))
    : [];
  if (names.length !== 1) throw new PipelineError('fetch', dirUrl, `lists no assembly directory for ${accession}`, 'check the accession, including its version');
  return names[0];
}

/** Downloads into fetch/; a re-run keeps local files and the first record, and refuses drift. */
export async function runFetch({ workDir, accession, fetchBytes = defaultFetchBytes, now = () => new Date().toISOString() }) {
  const p = workPaths(workDir);
  const previous = existsSync(p.fetchJson) ? JSON.parse(readFileSync(p.fetchJson, 'utf-8')) : null;
  if (previous && previous.accession !== accession) {
    throw new PipelineError('fetch', p.fetchJson, `holds ${previous.accession}, not ${accession}`, 'use a fresh --workDir for another assembly');
  }
  const dirUrl = assemblyDirUrl(accession);
  const assembly = await assemblyDir(accession, dirUrl, fetchBytes);
  mkdirSync(p.fetchDir, { recursive: true });
  const files = {};
  for (const [role, suffix] of Object.entries(FILES)) {
    const name = `${assembly}${suffix}`;
    const url = `${dirUrl}${assembly}/${name}`;
    const local = join(p.fetchDir, name);
    const body = await fetchBytes(url);
    if (!body && role === 'gff') throw new PipelineError('fetch', url, `${accession} has no annotation GFF`, 'this pipeline needs an annotated assembly; check for an annotated GCF_ (RefSeq) or newer GCA_ version');
    if (!body) throw new PipelineError('fetch', url, 'is missing on NCBI', 'check the accession');
    const digest = sha256(body);
    const recorded = previous?.files?.[role];
    if (recorded && recorded.sha256 !== digest) {
      throw new PipelineError('fetch', name, `NCBI's copy changed since ${previous.fetchedAt} (sha256 ${recorded.sha256} → ${digest})`, 'start a fresh --workDir to build from the new version');
    }
    if (!existsSync(local)) writeFileSync(local, body);
    else if (sha256File(local) !== digest) throw new PipelineError('fetch', local, 'differs from NCBI\'s copy', `delete ${local} and run fetch again`);
    files[role] = { name, url, sha256: digest };
  }
  const record = previous ?? { accession, assembly, fetchedAt: now(), files };
  writeJson(p.fetchJson, record);
  return record;
}

/** The fetch record and local paths, after checking every file against its sha256. */
export function verifyFetch(workDir, command) {
  const p = workPaths(workDir);
  const record = readJson(p.fetchJson, command, 'run fetch <assemblyAccession> first');
  const paths = {};
  for (const [role, file] of Object.entries(record.files)) {
    const path = join(p.fetchDir, file.name);
    if (!existsSync(path)) throw new PipelineError(command, path, 'is missing', 'run fetch again');
    if (sha256File(path) !== file.sha256) throw new PipelineError(command, path, 'does not match fetch/fetch.json', 'delete it and run fetch again');
    paths[role] = path;
  }
  return { record, paths };
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `node --test tests/genome-fetch.test.js`
Expected: PASS, 7 tests.

- [ ] **Step 6: Commit**

```bash
git add shared/scripts/genome/commands/fetch.js tests/genome-helpers.js tests/genome-fetch.test.js
git commit -m "Genome pipeline: fetch from NCBI FTP behind an injectable HTTP seam

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: `survey` (`commands/inputs.js`, `commands/survey.js`)

**Files:**
- Create: `shared/scripts/genome/commands/inputs.js`, `shared/scripts/genome/commands/survey.js`
- Modify: `tests/genome-helpers.js` (append the fake ApiCommonData)
- Test: `tests/genome-survey.test.js`

Implements spec question 5: raw findings carry `stage: "raw"`; the preview (the ID pass with `ncbiDefault` and `ids.tsv` if present, then the suggested structural transforms) carries `stage: "suggested"`. An `ids.tsv` error or a collision stops the preview and is its only finding.

- [ ] **Step 1: Append to `tests/genome-helpers.js`**

Add `cpSync`, `mkdirSync` to the `node:fs` import, `execFileSync` to the `node:child_process` import, and `import { MAP_PATH, SCRIPT_PATH } from '../shared/scripts/genome/preprocess-gff3.js';`.

```js
/** Stands in for preprocessGFF3: copies input to output without comment lines. Core perl only. */
export const FAKE_PREPROCESS = String.raw`use strict;
use Getopt::Long;
my ($in, $out);
GetOptions('input_gff=s' => \$in, 'output_gff=s' => \$out);
open(my $i, '<', $in) or die "no $in";
open(my $o, '>', $out) or die "no $out";
while (<$i>) { print $o $_ unless /^#/; }
`;

/** A git checkout laid out like ApiCommonData with the mini ISF map and a stand-in preprocessGFF3. */
export function fakeApiCommonData({ script = FAKE_PREPROCESS } = {}) {
  const dir = tempDir('apicommondata-');
  mkdirSync(join(dir, 'Load/lib/xml/isf'), { recursive: true });
  mkdirSync(join(dir, 'Load/bin'), { recursive: true });
  cpSync(join(genomeFixtures, 'isf-map-mini.xml'), join(dir, MAP_PATH));
  writeFileSync(join(dir, SCRIPT_PATH), script);
  execFileSync('git', ['init', '-q', dir]);
  execFileSync('git', ['-C', dir, 'add', '.']);
  execFileSync('git', ['-C', dir, '-c', 'user.email=t@apidb.org', '-c', 'user.name=T', 'commit', '-q', '-m', 'fake ApiCommonData']);
  return dir;
}
```

- [ ] **Step 2: Write the failing test** (`tests/genome-survey.test.js`)

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runSurvey } from '../shared/scripts/genome/commands/survey.js';
import { sha256, sha256File } from '../shared/scripts/genome/workdir.js';
import { fakeApiCommonData, fetchedWorkDir, FIXED_NOW, TINY_ASSEMBLY, TINY_COLLIDING_GFF, TINY_REPORT } from './genome-helpers.js';

const fetchShas = (workDir) => readdirSync(join(workDir, 'fetch')).map((name) => [name, sha256File(join(workDir, 'fetch', name))]);

test('survey writes findings, a suggested recipe and partitions, and never touches its inputs', async () => {
  const workDir = await fetchedWorkDir();
  const before = fetchShas(workDir);
  const survey = await runSurvey({ workDir, apiCommonData: fakeApiCommonData(), now: FIXED_NOW });
  assert.deepEqual(survey.findings.map((f) => [f.stage, f.check, f.count]), [
    ['raw', 'geneCdsNoRna', 3], ['raw', 'repeatedGeneLines', 1], ['raw', 'parentlessRna', 1], ['raw', 'unhandledType', 5], ['raw', 'partitionCounts', 2],
    ['suggested', 'unhandledType', 1], ['suggested', 'attributeNotInMap', 1], ['suggested', 'partitionCounts', 2]
  ]);
  assert.deepEqual(survey.suggestedRecipe, {
    idPolicy: 'ncbiDefault',
    transforms: [
      { name: 'collapseSplitGenes' }, { name: 'addMrnaToGeneCds' }, { name: 'addExonPerCds' }, { name: 'parentOrphanRnas' },
      { name: 'stripAttributes', args: { type: 'gene', keys: ['is_ordered'] } }
    ]
  });
  assert.deepEqual(survey.partitions, [
    { role: 'primary', soTerm: 'chromosome', organelle: null, sequenceCount: 1, dir: 'final/primary_chromosome' },
    { role: 'secondary', soTerm: 'supercontig', organelle: null, sequenceCount: 1, dir: 'final/secondary_supercontig' }
  ]);
  assert.equal(survey.accession, 'GCA_000000001.1');
  assert.equal(survey.surveyedAt, FIXED_NOW());
  assert.deepEqual(survey.inputs.report, { name: `${TINY_ASSEMBLY}_assembly_report.txt`, sha256: sha256(TINY_REPORT) });
  assert.deepEqual(JSON.parse(readFileSync(join(workDir, 'survey.json'), 'utf-8')), survey);
  assert.deepEqual(fetchShas(workDir), before);
});

test('survey shows a policy collision with the ids.tsv line that settles it, then previews with ids.tsv', async () => {
  const workDir = await fetchedWorkDir({ gff: TINY_COLLIDING_GFF });
  const apiCommonData = fakeApiCommonData();
  const first = await runSurvey({ workDir, apiCommonData, now: FIXED_NOW });
  const suggested = first.findings.filter((f) => f.stage === 'suggested');
  assert.deepEqual(suggested.map((f) => f.check), ['duplicateId']);
  assert.equal(suggested[0].message, 'the ID policy gives one ID to several features: TST_0050 ← gene-TST_0050 and rna-TST_0050');
  assert.deepEqual(suggested[0].fix, { ids: ['transcript\trna-TST_0050\t<new id>'] });
  writeFileSync(join(workDir, 'ids.tsv'), 'level\told\tnew\ntranscript\trna-TST_0050\tTST_0050.1\n');
  const second = await runSurvey({ workDir, apiCommonData, now: FIXED_NOW });
  assert.equal(second.findings.some((f) => f.check === 'duplicateId'), false);
  assert.equal(second.suggestedRecipe.ids, 'ids.tsv');
  writeFileSync(join(workDir, 'ids.tsv'), 'level\told\tnew\ngene\tTST_0050\tX\n');
  const third = await runSurvey({ workDir, apiCommonData, now: FIXED_NOW });
  assert.deepEqual(third.findings.filter((f) => f.stage === 'suggested').map((f) => [f.check, f.message]), [
    ['idsTsvLine', 'ids.tsv line 2: gene TST_0050 is not an input gene ID (see the old column of ids.default.tsv)']
  ]);
});

test('survey needs --apiCommonData and an intact fetch', async () => {
  const workDir = await fetchedWorkDir();
  await assert.rejects(runSurvey({ workDir }), /survey: --apiCommonData: is required\nNext: pass --apiCommonData <an ApiCommonData checkout>/);
  writeFileSync(join(workDir, 'fetch', `${TINY_ASSEMBLY}_genomic.fna.gz`), 'x');
  await assert.rejects(runSurvey({ workDir, apiCommonData: fakeApiCommonData() }), /genomic\.fna\.gz: does not match fetch\/fetch\.json/);
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `node --test tests/genome-survey.test.js`
Expected: FAIL with `Cannot find module '…/genome/commands/survey.js'`.

- [ ] **Step 4: Implement `shared/scripts/genome/commands/inputs.js`**

```js
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseAssemblyReport } from '../assembly-report.js';
import { readFastaIndex } from '../fasta.js';
import { parseGff, seqIdsOf } from '../gff.js';
import { readIdsTsv } from '../ids.js';
import { readIsfMap } from '../isf-map.js';
import { readPartitionsTsv } from '../partitions.js';
import { MAP_PATH } from '../preprocess-gff3.js';
import { PipelineError, readText } from '../workdir.js';

export function loadIsfMap(apiCommonData, command) {
  if (!apiCommonData) throw new PipelineError(command, '--apiCommonData', 'is required', 'pass --apiCommonData <an ApiCommonData checkout>');
  const path = join(apiCommonData, MAP_PATH);
  if (!existsSync(path)) throw new PipelineError(command, path, 'is missing', 'point --apiCommonData at an ApiCommonData checkout');
  try {
    return readIsfMap(readText(path));
  } catch (e) {
    throw new PipelineError(command, path, e.message, 'point --apiCommonData at a checkout whose map names genemRNAExonCDS2BioperlTree');
  }
}

export async function loadInputs(fetched) {
  const graph = parseGff(readText(fetched.paths.gff));
  const fastaIds = (await readFastaIndex(fetched.paths.fasta)).map((s) => s.id);
  const report = parseAssemblyReport(readText(fetched.paths.report), fetched.paths.report);
  return { graph, fastaIds, sequenceIds: [...new Set([...fastaIds, ...seqIdsOf(graph)])], report };
}

export function readIdsFile(path, command) {
  if (!existsSync(path)) throw new PipelineError(command, path, 'is missing', 'create it, or drop "ids" from recipe.json');
  const parsed = readIdsTsv(readText(path));
  if (parsed.errors.length) throw new PipelineError(command, path, parsed.errors.join('; '), 'fix those ids.tsv lines');
  return parsed;
}

export function readPartitionsFile(path, command) {
  if (!existsSync(path)) throw new PipelineError(command, path, 'is missing', 'create it, or drop "partitions" from recipe.json');
  try {
    return readPartitionsTsv(readText(path));
  } catch (e) {
    throw new PipelineError(command, path, e.message, 'fix that partitions.tsv line');
  }
}

export const inputsOf = (record) =>
  Object.fromEntries(Object.entries(record.files).map(([role, f]) => [role, { name: f.name, sha256: f.sha256 }]));
```

- [ ] **Step 5: Implement `shared/scripts/genome/commands/survey.js`**

```js
import { existsSync } from 'node:fs';
import { collisionFinding, runChecks } from '../checks.js';
import { applyIdPolicy } from '../ids.js';
import { planPartitions, publicPartition } from '../partitions.js';
import { CANONICAL_ORDER, runTransforms } from '../transforms/index.js';
import { workPaths, writeJson } from '../workdir.js';
import { verifyFetch } from './fetch.js';
import { inputsOf, loadInputs, loadIsfMap, readIdsFile, readPartitionsFile } from './inputs.js';

/** The suggested build in memory: ID pass (policy + ids.tsv), suggested structural transforms, checks. */
function preview(inputs, idLines, partitionLines, structural, isfMap) {
  const policy = applyIdPolicy(inputs.graph, { policy: 'ncbiDefault', overrides: idLines, sequenceIds: inputs.sequenceIds });
  if (policy.errors.length) {
    return { ran: false, findings: [{ group: 'ids', check: 'idsTsvLine', severity: 'error', count: policy.errors.length, sample: [], message: policy.errors.join('; '), fix: null }] };
  }
  if (policy.collisions.length) return { ran: false, findings: [collisionFinding(policy.collisions)] };
  const renames = policy.sequenceRenames;
  const plan = planPartitions({ sequenceIds: inputs.sequenceIds, report: inputs.report, overrides: partitionLines, renames });
  const fastaIds = new Set(inputs.fastaIds.map((id) => renames.get(id) ?? id));
  try {
    const run = runTransforms(policy.graph, structural);
    return { ran: true, findings: runChecks({ graph: run.graph, isfMap, fastaIds, plan, synthesized: run.created, inputIdOf: policy.inputIdOf }) };
  } catch (e) {
    return { ran: false, findings: [{ group: 'structure', check: 'previewFailed', severity: 'error', count: 1, sample: [], message: e.message, fix: null }] };
  }
}

/** Findings on the raw graph and on a preview of the suggested recipe; never modifies inputs. */
export async function runSurvey({ workDir, apiCommonData, now = () => new Date().toISOString() }) {
  const p = workPaths(workDir);
  const isfMap = loadIsfMap(apiCommonData, 'survey');
  const fetched = verifyFetch(workDir, 'survey');
  const inputs = await loadInputs(fetched);
  const hasIds = existsSync(p.idsTsv);
  const hasPartitions = existsSync(p.partitionsTsv);
  const ids = hasIds ? readIdsFile(p.idsTsv, 'survey') : { entries: [] };
  const overrides = hasPartitions ? readPartitionsFile(p.partitionsTsv, 'survey') : [];
  const plan = planPartitions({ sequenceIds: inputs.sequenceIds, report: inputs.report, overrides });

  const raw = runChecks({ graph: inputs.graph, isfMap, fastaIds: new Set(inputs.fastaIds), plan });
  const structural = CANONICAL_ORDER
    .filter((name) => name !== 'stripAttributes' && raw.some((f) => f.fix?.transforms?.some((t) => t.name === name)))
    .map((name) => ({ name }));
  const suggested = preview(inputs, ids.entries, overrides, structural, isfMap);
  const strips = (suggested.ran ? suggested.findings : raw)
    .filter((f) => f.check === 'attributeNotInMap')
    .flatMap((f) => f.fix.transforms);

  const survey = {
    accession: fetched.record.accession,
    inputs: inputsOf(fetched.record),
    surveyedAt: now(),
    findings: [...raw.map((f) => ({ stage: 'raw', ...f })), ...suggested.findings.map((f) => ({ stage: 'suggested', ...f }))],
    suggestedRecipe: {
      idPolicy: 'ncbiDefault',
      transforms: [...structural, ...strips],
      ...(hasIds && { ids: 'ids.tsv' }),
      ...(hasPartitions && { partitions: 'partitions.tsv' })
    },
    partitions: plan.partitions.map(publicPartition)
  };
  writeJson(p.surveyJson, survey);
  return survey;
}
```

- [ ] **Step 6: Run it to verify it passes**

Run: `node --test tests/genome-survey.test.js`
Expected: PASS, 3 tests.

- [ ] **Step 7: Commit**

```bash
git add shared/scripts/genome/commands/inputs.js shared/scripts/genome/commands/survey.js tests/genome-helpers.js tests/genome-survey.test.js
git commit -m "Genome pipeline: survey with a preview of the suggested recipe

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 17: `build` (`commands/build.js`)

**Files:**
- Create: `shared/scripts/genome/commands/build.js`
- Modify: `tests/genome-helpers.js` (append `TINY_RECIPE`, `TINY_NORMALIZED`, `surveyedWorkDir`)
- Test: `tests/genome-build.test.js`

Phases in fixed order, after refusing an input GFF with duplicate IDs: (1) IDs — the policy, then every `ids.tsv` line (input IDs, features and sequences), then the collision check; writes `ids.default.tsv` first, so a curator can read input IDs even when the pass fails; (2) the recipe's structural transforms (a created-ID collision names the input IDs whose `ids.tsv` line would fix it); (3) partition, after all renames. Then the checks; any `error` refuses before `build/` is written.

- [ ] **Step 1: Append to `tests/genome-helpers.js`**

Add `import { runSurvey } from '../shared/scripts/genome/commands/survey.js';`.

```js
export const TINY_RECIPE = {
  idPolicy: 'ncbiDefault',
  transforms: [
    { name: 'collapseSplitGenes' }, { name: 'addMrnaToGeneCds' }, { name: 'addExonPerCds' }, { name: 'parentOrphanRnas' },
    { name: 'stripAttributes', args: { type: 'gene', keys: ['is_ordered'] } }
  ]
};

export const TINY_NORMALIZED = [
  '##gff-version 3',
  `##sequence-region ${CM} 1 2000`,
  gffLine(CM, 'region', 1, 2000, '+', `ID=${CM}:1..2000;gbkey=Src;mol_type=genomic DNA`),
  gffLine(CM, 'gene', 100, 400, '+', 'ID=TST_0010;Name=TST_0010;gbkey=Gene;gene=TST_0010;gene_biotype=protein_coding'),
  gffLine(CM, 'mRNA', 100, 400, '+', 'ID=TST_0010_mRNA;Parent=TST_0010'),
  gffLine(CM, 'exon', 100, 200, '+', 'ID=TST_0010_mRNA_exon1;Parent=TST_0010_mRNA'),
  gffLine(CM, 'exon', 300, 400, '+', 'ID=TST_0010_mRNA_exon2;Parent=TST_0010_mRNA'),
  gffLine(CM, 'CDS', 100, 200, '+', 'ID=PRT1.1;Parent=TST_0010_mRNA;Dbxref=NCBI_GP:PRT1.1,UniProtKB/TrEMBL:Q00001;gbkey=CDS;product=hypothetical protein;protein_id=PRT1.1'),
  gffLine(CM, 'CDS', 300, 400, '+', 'ID=PRT1.1;Parent=TST_0010_mRNA;Dbxref=NCBI_GP:PRT1.1,UniProtKB/TrEMBL:Q00001;gbkey=CDS;product=hypothetical protein;protein_id=PRT1.1'),
  gffLine(CM, 'gene', 500, 900, '-', 'ID=TST_0020;Name=TST_0020;gbkey=Gene;gene=TST_0020;gene_biotype=protein_coding'),
  gffLine(CM, 'mRNA', 500, 900, '-', 'ID=TST_0020_mRNA;Parent=TST_0020'),
  gffLine(CM, 'exon', 800, 900, '-', 'ID=TST_0020_mRNA_exon1;Parent=TST_0020_mRNA'),
  gffLine(CM, 'exon', 500, 700, '-', 'ID=TST_0020_mRNA_exon2;Parent=TST_0020_mRNA'),
  gffLine(CM, 'CDS', 800, 900, '-', 'ID=PRT2.1;Parent=TST_0020_mRNA;gbkey=CDS;protein_id=PRT2.1'),
  gffLine(CM, 'CDS', 500, 700, '-', 'ID=PRT2.1;Parent=TST_0020_mRNA;gbkey=CDS;protein_id=PRT2.1'),
  gffLine(CM, 'gene', 1000, 1072, '+', 'ID=TST_0030;Name=TST_0030;gbkey=Gene;gene=TST_0030;gene_biotype=tRNA'),
  gffLine(CM, 'tRNA', 1000, 1072, '+', 'ID=rna-TST_0030;Parent=TST_0030;Note=tRNA-Leu%2C anticodon TAG;gbkey=tRNA;product=tRNA-Leu'),
  gffLine(CM, 'exon', 1000, 1072, '+', 'ID=exon-TST_0030-1;Parent=rna-TST_0030;gbkey=tRNA;product=tRNA-Leu'),
  gffLine(CM, 'gene', 1200, 1300, '+', `ID=gene_${CM}_1200_1300`),
  gffLine(CM, 'snRNA', 1200, 1300, '+', `ID=rna_${CM}_1200_1300_snRNA;Parent=gene_${CM}_1200_1300;gbkey=ncRNA;product=U4 snRNA`),
  gffLine(CM, 'exon', 1200, 1300, '+', `ID=exon-${CM}:1200..1300-1;Parent=rna_${CM}_1200_1300_snRNA;gbkey=ncRNA;product=U4 snRNA`),
  `##sequence-region ${KZ} 1 600`,
  gffLine(KZ, 'gene', 10, 300, '+', 'ID=TST_0040;Name=TST_0040;gbkey=Gene;gene=TST_0040;gene_biotype=protein_coding'),
  gffLine(KZ, 'mRNA', 10, 300, '+', 'ID=TST_0040_mRNA;Parent=TST_0040'),
  gffLine(KZ, 'exon', 10, 300, '+', 'ID=TST_0040_mRNA_exon1;Parent=TST_0040_mRNA'),
  gffLine(KZ, 'CDS', 10, 300, '+', 'ID=PRT4.1;Parent=TST_0040_mRNA;gbkey=CDS;protein_id=PRT4.1'),
  '###'
].join('\n') + '\n';

/** A fetched and surveyed tiny work area with its fake ApiCommonData. */
export async function surveyedWorkDir(options) {
  const workDir = await fetchedWorkDir(options);
  const apiCommonData = fakeApiCommonData();
  await runSurvey({ workDir, apiCommonData, now: FIXED_NOW });
  return { workDir, apiCommonData };
}

export const writeRecipe = (workDir, recipe = TINY_RECIPE) => writeFileSync(join(workDir, 'recipe.json'), JSON.stringify(recipe));
```

- [ ] **Step 2: Write the failing test** (`tests/genome-build.test.js`)

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runBuild } from '../shared/scripts/genome/commands/build.js';
import { sha256 } from '../shared/scripts/genome/workdir.js';
import {
  CM, FIXED_NOW, gffLine, KZ, surveyedWorkDir, TINY_COLLIDING_GFF, TINY_GFF, TINY_IDS_DEFAULT, TINY_NORMALIZED, TINY_RECIPE, writeRecipe
} from './genome-helpers.js';

const read = (workDir, path) => readFileSync(join(workDir, path), 'utf-8');

test('build writes the normalized GFF, partitions, ids.default.tsv and build/build.json', async () => {
  const { workDir, apiCommonData } = await surveyedWorkDir();
  writeRecipe(workDir);
  const record = await runBuild({ workDir, apiCommonData, now: FIXED_NOW });
  assert.equal(read(workDir, 'build/normalized.gff3'), TINY_NORMALIZED);
  assert.equal(read(workDir, 'ids.default.tsv'), TINY_IDS_DEFAULT);
  assert.deepEqual(record.transforms.map((t) => [t.name, t.changes]), [
    ['collapseSplitGenes', 1], ['addMrnaToGeneCds', 3], ['addExonPerCds', 3], ['parentOrphanRnas', 1], ['stripAttributes', 1]
  ]);
  assert.deepEqual(record.transforms[1].sample, ['TST_0010', 'TST_0020', 'TST_0040']);
  assert.deepEqual(record.idPolicy, { name: 'ncbiDefault', renamed: 7 });
  assert.equal(record.recipe.sha256, sha256(JSON.stringify(TINY_RECIPE)));
  assert.equal(record.normalized.sha256, sha256(TINY_NORMALIZED));
  assert.deepEqual(record.warnings, []);
  assert.equal(record.ids, null);
  assert.deepEqual(record.findings.map((f) => [f.check, f.count]), [['unhandledType', 1], ['partitionCounts', 2]]);
  assert.deepEqual(record.partitions, [
    { role: 'primary', soTerm: 'chromosome', organelle: null, sequenceCount: 1, dir: 'final/primary_chromosome', featureCount: 19 },
    { role: 'secondary', soTerm: 'supercontig', organelle: null, sequenceCount: 1, dir: 'final/secondary_supercontig', featureCount: 4 }
  ]);
  assert.equal(read(workDir, 'build/primary_chromosome/chromosomeMap.txt'), 'CM000001.1\tchr1\t1\n');
  assert.equal(existsSync(join(workDir, 'build/secondary_supercontig/chromosomeMap.txt')), false);
  assert.equal(read(workDir, 'build/secondary_supercontig/genome.fasta'), `>KZ000002.1 Testus tinyus scaffold2\n${'TTGA'.repeat(15)}\n`);
  assert.equal(read(workDir, 'build/secondary_supercontig/genome.gff3'),
    ['##gff-version 3', ...TINY_NORMALIZED.split('\n').filter((l) => l.startsWith('##sequence-region KZ') || l.startsWith('KZ000002.1')), '###', ''].join('\n'));
  assert.deepEqual(JSON.parse(read(workDir, 'build/build.json')), record);
});

test('a transform that changes nothing is a warning in the record', async () => {
  const { workDir, apiCommonData } = await surveyedWorkDir();
  writeRecipe(workDir, { ...TINY_RECIPE, transforms: [...TINY_RECIPE.transforms, { name: 'stripAttributes', args: { type: 'gap', keys: ['gbkey'] } }] });
  const record = await runBuild({ workDir, apiCommonData, now: FIXED_NOW });
  assert.deepEqual(record.warnings, ['stripAttributes changed nothing; the recipe declares a transform this genome does not need']);
});

test('build refuses while errors remain and writes no build/', async () => {
  const { workDir, apiCommonData } = await surveyedWorkDir();
  writeRecipe(workDir, { idPolicy: 'ncbiDefault', transforms: [{ name: 'collapseSplitGenes' }, { name: 'parentOrphanRnas' }] });
  await assert.rejects(runBuild({ workDir, apiCommonData }), (e) => /the result still has errors:\n.*error structure\/geneCdsNoRna \(3\)/.test(e.problem) && /then run build again/.test(e.next));
  assert.equal(existsSync(join(workDir, 'build')), false);
});

test('build needs a survey of the same inputs and a valid recipe', async () => {
  const { workDir, apiCommonData } = await surveyedWorkDir();
  await assert.rejects(runBuild({ workDir, apiCommonData }), /recipe\.json: is missing\nNext: copy suggestedRecipe from survey\.json/);
  writeRecipe(workDir, { idPolicy: 'veupathdb', transforms: [{ name: 'renameEverything' }], extra: 1 });
  await assert.rejects(runBuild({ workDir, apiCommonData }),
    /recipe\.json: idPolicy must be one of ncbiDefault, none; transforms\[0\]: unknown transform renameEverything; .*; unknown keys: extra/);
  writeRecipe(workDir);
  const survey = JSON.parse(read(workDir, 'survey.json'));
  writeFileSync(join(workDir, 'survey.json'), JSON.stringify({ ...survey, inputs: { ...survey.inputs, gff: { ...survey.inputs.gff, sha256: 'x' } } }));
  await assert.rejects(runBuild({ workDir, apiCommonData }), /survey\.json: was written for a different gff file\nNext: run survey again/);
});

test('a policy collision stops build naming both features; an ids.tsv line by input ID settles it', async () => {
  const { workDir, apiCommonData } = await surveyedWorkDir({ gff: TINY_COLLIDING_GFF });
  writeRecipe(workDir);
  await assert.rejects(runBuild({ workDir, apiCommonData }),
    (e) => e.problem === 'ncbiDefault gives one ID to several features: TST_0050 ← gene-TST_0050 and rna-TST_0050' && e.next.includes('transcript\trna-TST_0050\t<new id>'));
  writeFileSync(join(workDir, 'ids.tsv'), 'level\told\tnew\ntranscript\trna-TST_0050\tTST_0050.1\n');
  writeRecipe(workDir, { ...TINY_RECIPE, ids: 'ids.tsv' });
  const record = await runBuild({ workDir, apiCommonData, now: FIXED_NOW });
  assert.equal(record.ids.applied, 1);
  assert.equal(record.ids.sha256, sha256('level\told\tnew\ntranscript\trna-TST_0050\tTST_0050.1\n'));
  const normalized = read(workDir, 'build/normalized.gff3');
  assert.match(normalized, /\tmRNA\t1400\t1500\t\.\t\+\t\.\tID=TST_0050\.1;Parent=TST_0050;gbkey=mRNA\n/);
  assert.match(normalized, /\tCDS\t1400\t1500\t\.\t\+\t0\tID=PRT5\.1;Parent=TST_0050\.1;/);
});

test('a created-ID collision names the input IDs whose ids.tsv line would fix it', async () => {
  const gff = TINY_GFF.replace(`##sequence-region ${KZ}`, [
    gffLine(CM, 'gene', 1400, 1500, '+', 'ID=gene-TST_0060;Name=TST_0060;gbkey=Gene;gene=TST_0060;gene_biotype=protein_coding'),
    gffLine(CM, 'CDS', 1400, 1500, '+', 'ID=cds-PRT6.1;Parent=gene-TST_0060;gbkey=CDS;protein_id=PRT6.1'),
    gffLine(CM, 'gene', 1600, 1700, '+', 'ID=gene-TST_0060_mRNA;Name=TST_0060_mRNA;gbkey=Gene;gene_biotype=other'),
    `##sequence-region ${KZ}`
  ].join('\n'));
  const { workDir, apiCommonData } = await surveyedWorkDir({ gff });
  writeRecipe(workDir);
  await assert.rejects(runBuild({ workDir, apiCommonData }), (e) =>
    e.problem === 'addMrnaToGeneCds: created ID TST_0060_mRNA (for TST_0060) already exists'
    && e.next === 'add an ids.tsv line renaming gene-TST_0060_mRNA (which already has TST_0060_mRNA) or gene-TST_0060 (which it is made from), by input ID');
});

test('an ids.tsv sequence line renames the GFF, the FASTA and the partition', async () => {
  const { workDir, apiCommonData } = await surveyedWorkDir();
  writeFileSync(join(workDir, 'ids.tsv'), 'level\told\tnew\nsequence\tKZ000002.1\tscaffold2\n');
  writeRecipe(workDir, { ...TINY_RECIPE, ids: 'ids.tsv' });
  const record = await runBuild({ workDir, apiCommonData, now: FIXED_NOW });
  assert.equal(record.ids.applied, 1);
  assert.match(read(workDir, 'build/secondary_supercontig/genome.gff3'), /^##sequence-region scaffold2 1 600\nscaffold2\tEMBL\tgene\t10\t300\t/m);
  assert.match(read(workDir, 'build/secondary_supercontig/genome.fasta'), /^>scaffold2 Testus tinyus scaffold2\n/);
});

test('ids.tsv errors stop build', async () => {
  const { workDir, apiCommonData } = await surveyedWorkDir();
  writeFileSync(join(workDir, 'ids.tsv'), 'level\told\tnew\ngene\tnot-there\tX\n');
  writeRecipe(workDir, { ...TINY_RECIPE, ids: 'ids.tsv' });
  await assert.rejects(runBuild({ workDir, apiCommonData }), /ids\.tsv: ids\.tsv line 2: gene not-there is not an input gene ID \(see the old column of ids\.default\.tsv\)\nNext: fix those ids\.tsv lines/);
  assert.equal(read(workDir, 'ids.default.tsv'), TINY_IDS_DEFAULT);
  assert.equal(existsSync(join(workDir, 'build')), false);
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `node --test tests/genome-build.test.js`
Expected: FAIL with `Cannot find module '…/genome/commands/build.js'`.

- [ ] **Step 4: Implement**

```js
import { existsSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import { duplicateIds, formatFinding, runChecks } from '../checks.js';
import { writeFastaSubset } from '../fasta.js';
import { featureGroups, features, serializeGff, subsetGff } from '../gff.js';
import { applyIdPolicy, ID_POLICIES, idsTsvText } from '../ids.js';
import { chromosomeMapText, isChromosomePrimary, planPartitions, publicPartition } from '../partitions.js';
import { runTransforms, transformProblems } from '../transforms/index.js';
import { PipelineError, readJson, readText, sha256, sha256File, workPaths, writeJson, writeText } from '../workdir.js';
import { verifyFetch } from './fetch.js';
import { inputsOf, loadInputs, loadIsfMap, readIdsFile, readPartitionsFile } from './inputs.js';

const RECIPE_KEYS = ['idPolicy', 'transforms', 'ids', 'partitions'];

function recipeProblems(recipe) {
  if (!recipe || typeof recipe !== 'object' || Array.isArray(recipe)) return ['must be a JSON object'];
  const problems = [];
  if (!ID_POLICIES.includes(recipe.idPolicy)) problems.push(`idPolicy must be one of ${ID_POLICIES.join(', ')}`);
  if (!Array.isArray(recipe.transforms)) problems.push('transforms must be a list');
  else problems.push(...transformProblems(recipe.transforms));
  for (const key of ['ids', 'partitions']) {
    if (recipe[key] !== undefined && (typeof recipe[key] !== 'string' || !recipe[key])) problems.push(`${key} must name a file in the work directory`);
  }
  const unknown = Object.keys(recipe).filter((k) => !RECIPE_KEYS.includes(k));
  if (unknown.length) problems.push(`unknown keys: ${unknown.join(', ')}`);
  return problems;
}

function readRecipe(p) {
  if (!existsSync(p.recipeJson)) throw new PipelineError('build', p.recipeJson, 'is missing', 'copy suggestedRecipe from survey.json into recipe.json and edit it');
  const text = readText(p.recipeJson);
  let recipe;
  try {
    recipe = JSON.parse(text);
  } catch (e) {
    throw new PipelineError('build', p.recipeJson, `is not JSON: ${e.message}`, 'fix recipe.json');
  }
  const problems = recipeProblems(recipe);
  if (problems.length) throw new PipelineError('build', p.recipeJson, problems.join('; '), 'fix recipe.json');
  return { recipe, text };
}

function checkSurvey(p, fetched) {
  const survey = readJson(p.surveyJson, 'build', 'run survey first');
  for (const [role, file] of Object.entries(fetched.record.files)) {
    if (survey.inputs?.[role]?.sha256 !== file.sha256) throw new PipelineError('build', p.surveyJson, `was written for a different ${role} file`, 'run survey again');
  }
}

/** Phase 1: policy, every ids.tsv line, collision check. */
function settleIds(inputs, recipe, ids, idsPath, p) {
  const policy = applyIdPolicy(inputs.graph, { policy: recipe.idPolicy, overrides: ids.entries, sequenceIds: inputs.sequenceIds });
  writeText(p.idsDefault, idsTsvText(policy.defaults));
  if (policy.errors.length) throw new PipelineError('build', idsPath, policy.errors.join('; '), 'fix those ids.tsv lines');
  if (policy.collisions.length) {
    const pairs = policy.collisions.slice(0, 20).map((c) => `${c.id} ← ${c.olds.map((o) => o.id).join(' and ')}`).join('; ');
    const lines = policy.collisions.flatMap((c) => c.olds.slice(1).map((o) => `${o.level}\t${o.id}\t<new id>`));
    throw new PipelineError('build', p.recipeJson, `${recipe.idPolicy} gives one ID to several features: ${pairs}`,
      `add ids.tsv lines renaming one of each by its input ID (and "ids": "ids.tsv" in recipe.json): ${lines.join(' | ')}`);
  }
  return policy;
}

/** Phase 2; a created-ID collision names, by input ID, the feature holding the ID and the source it was made from. */
function transform(graph, recipe, p, inputOf) {
  try {
    return runTransforms(graph, recipe.transforms);
  } catch (e) {
    const next = e.code === 'ID_COLLISION'
      ? `add an ids.tsv line renaming ${inputOf(e.id)} (which already has ${e.id}) or ${inputOf(e.source)} (which it is made from), by input ID`
      : 'this needs a hand fix to the input GFF, or drop the transform';
    throw new PipelineError('build', p.recipeJson, e.message, next);
  }
}

export async function runBuild({ workDir, apiCommonData, now = () => new Date().toISOString() }) {
  const p = workPaths(workDir);
  const isfMap = loadIsfMap(apiCommonData, 'build');
  const fetched = verifyFetch(workDir, 'build');
  checkSurvey(p, fetched);
  const { recipe, text: recipeText } = readRecipe(p);
  const idsPath = recipe.ids ? join(workDir, recipe.ids) : null;
  const partitionsPath = recipe.partitions ? join(workDir, recipe.partitions) : null;
  const ids = idsPath ? readIdsFile(idsPath, 'build') : { entries: [] };
  const overrides = partitionsPath ? readPartitionsFile(partitionsPath, 'build') : [];
  const inputs = await loadInputs(fetched);

  const rawDuplicates = duplicateIds(featureGroups(inputs.graph));
  if (rawDuplicates.length) {
    throw new PipelineError('build', fetched.paths.gff, `has IDs used by several features: ${rawDuplicates.slice(0, 20).map((d) => d.id).join(', ')}`,
      'the input GFF needs unique IDs; take it up with the annotation provider');
  }

  const policy = settleIds(inputs, recipe, ids, idsPath, p);
  const run = transform(policy.graph, recipe, p, (id) => policy.inputIdOf.get(id) ?? id);
  const { graph } = run;
  const renames = policy.sequenceRenames;

  const plan = planPartitions({ sequenceIds: inputs.sequenceIds, report: inputs.report, overrides, renames });
  const findings = runChecks({
    graph, isfMap, fastaIds: new Set(inputs.fastaIds.map((id) => renames.get(id) ?? id)), plan,
    synthesized: run.created, inputIdOf: policy.inputIdOf
  });
  const errors = findings.filter((f) => f.severity === 'error');
  if (errors.length) {
    throw new PipelineError('build', p.buildDir, `the result still has errors:\n${errors.map(formatFinding).join('\n')}`,
      'add the fixes those findings suggest to recipe.json, ids.tsv or partitions.tsv, then run build again');
  }

  rmSync(p.buildDir, { recursive: true, force: true });
  const normalizedText = serializeGff(graph);
  writeText(p.normalized, normalizedText);
  const partitions = [];
  for (const part of plan.partitions) {
    const dir = join(p.buildDir, basename(part.dir));
    const sequenceIds = new Set(part.sequences.map((s) => s.id));
    const subset = subsetGff(graph, sequenceIds);
    writeText(join(dir, 'genome.gff3'), serializeGff(subset));
    await writeFastaSubset(fetched.paths.fasta, join(dir, 'genome.fasta'), sequenceIds, renames);
    if (isChromosomePrimary(part)) writeText(join(dir, 'chromosomeMap.txt'), chromosomeMapText(part));
    partitions.push({ ...publicPartition(part), featureCount: features(subset).length });
  }

  const record = {
    accession: fetched.record.accession,
    inputs: inputsOf(fetched.record),
    recipe: { sha256: sha256(recipeText) },
    idPolicy: { name: recipe.idPolicy, renamed: policy.defaults.length },
    transforms: run.results,
    warnings: run.warnings,
    ids: idsPath ? { file: recipe.ids, sha256: sha256File(idsPath), applied: policy.applied } : null,
    partitionsTsv: partitionsPath ? { file: recipe.partitions, sha256: sha256File(partitionsPath) } : null,
    normalized: { path: 'build/normalized.gff3', sha256: sha256(normalizedText) },
    findings,
    partitions,
    builtAt: now()
  };
  writeJson(p.buildJson, record);
  return record;
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `node --test tests/genome-build.test.js`
Expected: PASS, 8 tests.

- [ ] **Step 6: Commit**

```bash
git add shared/scripts/genome/commands/build.js tests/genome-helpers.js tests/genome-build.test.js
git commit -m "Genome pipeline: build in three fixed phases, refusing while errors remain

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 18: `finalize` (`commands/finalize.js`)

**Files:**
- Create: `shared/scripts/genome/commands/finalize.js`
- Test: `tests/genome-finalize.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { runBuild } from '../shared/scripts/genome/commands/build.js';
import { runFinalize } from '../shared/scripts/genome/commands/finalize.js';
import { sha256 } from '../shared/scripts/genome/workdir.js';
import {
  CM, FAKE_PREPROCESS, fakeApiCommonData, FIXED_NOW, KZ, perlMissing, reportText, surveyedWorkDir, tempDir,
  TINY_FASTA, TINY_NORMALIZED, writeRecipe
} from './genome-helpers.js';

const read = (workDir, path) => readFileSync(join(workDir, path), 'utf-8');
const withoutComments = (text) => text.split('\n').filter((l) => !l.startsWith('#')).join('\n');

async function built(options) {
  const ctx = await surveyedWorkDir(options);
  writeRecipe(ctx.workDir);
  await runBuild({ ...ctx, now: FIXED_NOW });
  return ctx;
}

test('finalize runs preprocessGFF3 per partition and writes genome-build.json', { skip: perlMissing }, async () => {
  const { workDir, apiCommonData } = await built();
  const record = await runFinalize({ workDir, apiCommonData, now: FIXED_NOW });
  assert.equal(read(workDir, 'final/primary_chromosome/genome.gff'), withoutComments(read(workDir, 'build/primary_chromosome/genome.gff3')));
  assert.equal(read(workDir, 'final/primary_chromosome/genome.fasta'), read(workDir, 'build/primary_chromosome/genome.fasta'));
  assert.equal(read(workDir, 'final/primary_chromosome/chromosomeMap.txt'), 'CM000001.1\tchr1\t1\n');
  assert.equal(existsSync(join(workDir, 'final/secondary_supercontig/chromosomeMap.txt')), false);
  assert.ok(existsSync(join(workDir, 'final/secondary_supercontig/genome.gff')));
  assert.equal(record.apiCommonData.commit, execFileSync('git', ['-C', apiCommonData, 'rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim());
  assert.equal(record.apiCommonData.preprocessGFF3.sha256, sha256(FAKE_PREPROCESS));
  assert.equal(record.normalized.sha256, sha256(TINY_NORMALIZED));
  assert.equal(record.finalizedAt, FIXED_NOW());
  assert.equal(record.builtAt, FIXED_NOW());
  assert.deepEqual(JSON.parse(read(workDir, 'genome-build.json')), record);
});

test('--preprocessGFF3 runs a patched copy and records its sha256', { skip: perlMissing }, async () => {
  const { workDir, apiCommonData } = await built();
  const patched = join(tempDir('patched-'), 'preprocessGFF3');
  writeFileSync(patched, `${FAKE_PREPROCESS}# patched\n`);
  const record = await runFinalize({ workDir, apiCommonData, preprocessGFF3: patched, now: FIXED_NOW });
  assert.equal(record.apiCommonData.preprocessGFF3.sha256, sha256(`${FAKE_PREPROCESS}# patched\n`));
});

test('finalize names the Bio::SeqIO fix when preprocessGFF3 does not compile', { skip: perlMissing }, async () => {
  const { workDir } = await built();
  const broken = fakeApiCommonData({ script: `use Nonexistent::ModuleForThisTest;\n${FAKE_PREPROCESS}` });
  await assert.rejects(runFinalize({ workDir, apiCommonData: broken }),
    (e) => /preprocessGFF3$/.test(e.file) && /^does not compile:\n/.test(e.problem) && /`use Bio::SeqIO;`/.test(e.next));
});

test('a partition with no features gets its FASTA and no GFF', { skip: perlMissing }, async () => {
  const report = reportText([
    ['chr1', 'assembled-molecule', 'Chromosome', CM], ['scaffold2', 'unplaced-scaffold', 'na', KZ], ['MT', 'assembled-molecule', 'Mitochondrion', 'CM000003.1']
  ]);
  const { workDir, apiCommonData } = await built({ fasta: `${TINY_FASTA}>CM000003.1 mitochondrion\nACGTACGT\n`, report });
  const record = await runFinalize({ workDir, apiCommonData, now: FIXED_NOW });
  assert.deepEqual(record.partitions.at(-1), { role: 'organelle', soTerm: 'mitochondrial_chromosome', organelle: 'mitochondrion', sequenceCount: 1, dir: 'final/organelle_mitochondrion', featureCount: 0 });
  assert.equal(read(workDir, 'final/organelle_mitochondrion/genome.fasta'), '>CM000003.1 mitochondrion\nACGTACGT\n');
  assert.equal(existsSync(join(workDir, 'final/organelle_mitochondrion/genome.gff')), false);
});

test('finalize refuses a normalized GFF that drifted from build.json, and needs a build', async () => {
  await assert.rejects(runFinalize({ workDir: tempDir('empty-'), apiCommonData: '/nowhere' }), /build\.json: is missing\nNext: run build first/);
  const { workDir, apiCommonData } = await built();
  appendFileSync(join(workDir, 'build/normalized.gff3'), '# edited\n');
  await assert.rejects(runFinalize({ workDir, apiCommonData }), /normalized\.gff3: does not match build\/build\.json\nNext: run build again/);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/genome-finalize.test.js`
Expected: FAIL with `Cannot find module '…/genome/commands/finalize.js'`.

- [ ] **Step 3: Implement**

```js
import { copyFileSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { defaultExec } from '../../lib/tools/exec.js';
import { isChromosomePrimary } from '../partitions.js';
import { apiCommonDataCommit, BIO_SEQIO_FIX, compileProblem, runPreprocessGFF3, SCRIPT_PATH } from '../preprocess-gff3.js';
import { PipelineError, readJson, sha256File, workPaths, writeJson } from '../workdir.js';

function resolveScript(apiCommonData, preprocessGFF3, exec) {
  if (!apiCommonData) throw new PipelineError('finalize', '--apiCommonData', 'is required', 'pass --apiCommonData <an ApiCommonData checkout>');
  const script = preprocessGFF3 ?? join(apiCommonData, SCRIPT_PATH);
  if (!existsSync(script)) throw new PipelineError('finalize', script, 'is missing', 'point --apiCommonData at an ApiCommonData checkout');
  let problem;
  try {
    problem = compileProblem(script, { exec });
  } catch (e) {
    throw new PipelineError('finalize', 'perl', e.message, 'install perl or put it on PATH');
  }
  if (problem) throw new PipelineError('finalize', script, `does not compile:\n${problem}`, BIO_SEQIO_FIX);
  try {
    return { script, commit: apiCommonDataCommit(apiCommonData, { exec }) };
  } catch (e) {
    throw new PipelineError('finalize', apiCommonData, e.message, 'point --apiCommonData at a git checkout of ApiCommonData');
  }
}

/** preprocessGFF3 per partition into final/, then genome-build.json. */
export async function runFinalize({ workDir, apiCommonData, preprocessGFF3, exec = defaultExec, now = () => new Date().toISOString() }) {
  const p = workPaths(workDir);
  const build = readJson(p.buildJson, 'finalize', 'run build first');
  if (!existsSync(p.normalized) || sha256File(p.normalized) !== build.normalized.sha256) {
    throw new PipelineError('finalize', p.normalized, 'does not match build/build.json', 'run build again');
  }
  const { script, commit } = resolveScript(apiCommonData, preprocessGFF3, exec);
  rmSync(p.finalDir, { recursive: true, force: true });
  for (const part of build.partitions) {
    const src = join(p.buildDir, basename(part.dir));
    const dest = join(workDir, part.dir);
    mkdirSync(dest, { recursive: true });
    const expected = ['genome.fasta'];
    if (part.featureCount > 0) {
      try {
        runPreprocessGFF3(script, join(src, 'genome.gff3'), join(dest, 'genome.gff'), { exec });
      } catch (e) {
        throw new PipelineError('finalize', join(src, 'genome.gff3'), e.message, 'fix the script or the build, then run finalize again');
      }
      expected.push('genome.gff');
    }
    copyFileSync(join(src, 'genome.fasta'), join(dest, 'genome.fasta'));
    if (isChromosomePrimary(part)) {
      copyFileSync(join(src, 'chromosomeMap.txt'), join(dest, 'chromosomeMap.txt'));
      expected.push('chromosomeMap.txt');
    }
    for (const name of expected) {
      const path = join(dest, name);
      if (!existsSync(path) || statSync(path).size === 0) throw new PipelineError('finalize', path, 'is missing or empty', 'run build and finalize again');
    }
  }
  const record = { ...build, apiCommonData: { commit, preprocessGFF3: { sha256: sha256File(script) } }, finalizedAt: now() };
  writeJson(p.genomeBuildJson, record);
  return record;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test tests/genome-finalize.test.js`
Expected: PASS, 5 tests (4 skip if perl is missing).

- [ ] **Step 5: Commit**

```bash
git add shared/scripts/genome/commands/finalize.js tests/genome-finalize.test.js
git commit -m "Genome pipeline: finalize runs preprocessGFF3 per partition and writes genome-build.json

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 19: CLI (`genome-pipeline.js`)

**Files:**
- Create: `shared/scripts/genome/genome-pipeline.js` (executable)
- Test: `tests/genome-pipeline-cli.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fakeApiCommonData, fetchedWorkDir, perlMissing, tempDir, writeRecipe } from './genome-helpers.js';

const CLI = new URL('../shared/scripts/genome/genome-pipeline.js', import.meta.url).pathname;
const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf-8' });

test('no command prints usage and exits 1', () => {
  const r = cli();
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Usage: node genome-pipeline\.js fetch <assemblyAccession> --workDir <dir>/);
});

test('--workDir is required, and fetch takes exactly one accession', () => {
  assert.match(cli('survey').stderr, /--workDir is required/);
  const r = cli('fetch', '--workDir', tempDir('cli-'));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /fetch takes one assembly accession/);
});

test('a command failure prints the PipelineError and exits 1', () => {
  const r = cli('survey', '--workDir', tempDir('cli-'));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^Error: survey: --apiCommonData: is required\nNext: pass --apiCommonData <an ApiCommonData checkout>/);
});

test('survey, build and finalize run from the command line', { skip: perlMissing }, async () => {
  const workDir = await fetchedWorkDir();
  const apiCommonData = fakeApiCommonData();
  let r = cli('survey', '--workDir', workDir, '--apiCommonData', apiCommonData);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^suggested error attributes\/attributeNotInMap \(1\): gene \(ISF coding_gene\) carries keys the map does not list: is_ordered \[TST_0020\]$/m);
  assert.match(r.stdout, /^Wrote .*survey\.json$/m);
  writeRecipe(workDir);
  r = cli('build', '--workDir', workDir, '--apiCommonData', apiCommonData);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^ {2}addMrnaToGeneCds: 3$/m);
  r = cli('finalize', '--workDir', workDir, '--apiCommonData', apiCommonData);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^ {2}final\/primary_chromosome: 1 sequences$/m);
  assert.match(r.stdout, /^Wrote .*genome-build\.json$/m);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/genome-pipeline-cli.test.js`
Expected: FAIL — the first test's `r.status` is 1 but stderr has `Cannot find module` rather than the usage text.

- [ ] **Step 3: Implement**

```js
#!/usr/bin/env node
/**
 * genome-pipeline.js - NCBI annotated genome in, ISF-ready partitions and genome-build.json out.
 * Spec: docs/superpowers/specs/2026-11-04-gff-pipeline-design.md
 */
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { formatFinding } from './checks.js';
import { runBuild } from './commands/build.js';
import { runFetch } from './commands/fetch.js';
import { runFinalize } from './commands/finalize.js';
import { runSurvey } from './commands/survey.js';

const USAGE = [
  'Usage: node genome-pipeline.js fetch <assemblyAccession> --workDir <dir>',
  '       node genome-pipeline.js survey --workDir <dir> --apiCommonData <ApiCommonData checkout>',
  '       node genome-pipeline.js build --workDir <dir> --apiCommonData <ApiCommonData checkout>',
  '       node genome-pipeline.js finalize --workDir <dir> --apiCommonData <ApiCommonData checkout> [--preprocessGFF3 <script>]'
].join('\n');

function fail(message) {
  console.error(message);
  process.exit(1);
}

const print = (lines) => console.log(lines.join('\n'));

async function main() {
  const { values, positionals } = parseArgs({
    options: { workDir: { type: 'string' }, apiCommonData: { type: 'string' }, preprocessGFF3: { type: 'string' } },
    allowPositionals: true
  });
  const [command, ...rest] = positionals;
  if (!['fetch', 'survey', 'build', 'finalize'].includes(command)) fail(USAGE);
  const { workDir, apiCommonData, preprocessGFF3 } = values;
  if (!workDir) fail(`--workDir is required.\n${USAGE}`);

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
  } else {
    const record = await runFinalize({ workDir, apiCommonData, preprocessGFF3 });
    print([...record.partitions.map((part) => `  ${part.dir}: ${part.sequenceCount} sequences`), `Wrote ${join(workDir, 'genome-build.json')}`]);
  }
}

main().catch((err) => fail(`Error: ${err.message}`));
```

Run: `chmod +x shared/scripts/genome/genome-pipeline.js`

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test tests/genome-pipeline-cli.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add shared/scripts/genome/genome-pipeline.js tests/genome-pipeline-cli.test.js
git commit -m "Genome pipeline: fetch, survey, build and finalize CLI

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 20: Golden E. cuniculi test

**Files:**
- Modify: `tests/genome-helpers.js` (append `normalizeDbxrefs`)
- Test: `tests/genome-golden.test.js`
- Create (generated, then reviewed): `tests/fixtures/genome/ecun/expected/survey.json`, `tests/fixtures/genome/ecun/expected/genome-build.json`, `tests/fixtures/genome/ecun/expected/final/primary_chromosome/genome.gff.gz`

Inputs already in the worktree: `tests/fixtures/genome/ecun/fetch/*`, `recipe.json`, `ids.tsv` (`gene	gene-ECU11_0375-2	ECU11_0375_2`: the only gene ID with a `-` after `ncbiDefault`, given an underscore form; nothing collides under the resolved policy, so this line exercises a plain curator override), `isf/bioperltree.out.gz`. The test runs with `APICOMMONDATA_DIR` (the real map) and host `perl`, and runs a temp copy of the checkout's `preprocessGFF3` without `use Bio::SeqIO;` via `--preprocessGFF3`; the checkout is never modified. It masks the ApiCommonData commit and script sha256 in `genome-build.json` (they move with the checkout); the clock is fixed, so no timestamp masking is needed. `preprocessGFF3` output is compared after `normalizeDbxrefs` (Perl hash order of PMID `Dbxref`s and `previous_systematic_id`s).

- [ ] **Step 1: Append to `tests/genome-helpers.js`**

```js
/** Sorts the Dbxref and previous_systematic_id segments of each preprocessGFF3 line, which Perl emits in hash order. */
export function normalizeDbxrefs(gffText) {
  return gffText.split('\n').map((line) => {
    const cols = line.split('\t');
    if (cols.length !== 9) return line;
    const segs = cols[8].split(';');
    const at = segs.flatMap((s, i) => (/^(Dbxref|previous_systematic_id)\s/.test(s) ? [i] : []));
    const sorted = at.map((i) => segs[i].replace(/^(\S+)\s+/, '$1 ')).sort();
    at.forEach((i, n) => { segs[i] = sorted[n]; });
    cols[8] = segs.join(';');
    return cols.join('\t');
  }).join('\n');
}
```

- [ ] **Step 2: Write the test** (`tests/genome-golden.test.js`)

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { runBuild } from '../shared/scripts/genome/commands/build.js';
import { runFetch } from '../shared/scripts/genome/commands/fetch.js';
import { runFinalize } from '../shared/scripts/genome/commands/finalize.js';
import { runSurvey } from '../shared/scripts/genome/commands/survey.js';
import { parseGff } from '../shared/scripts/genome/gff.js';
import { isfTrees } from '../shared/scripts/genome/isf-map.js';
import { MAP_PATH, SCRIPT_PATH } from '../shared/scripts/genome/preprocess-gff3.js';
import { readText } from '../shared/scripts/genome/workdir.js';
import {
  ECUN_FASTA, ECUN_GFF, ECUN_REPORT, FIXED_NOW, genomeFixtures, normalizeDbxrefs, parseBioperlTree, perlMissing,
  stubNcbi, tempDir, withoutBioSeqIO
} from './genome-helpers.js';

const ACD = process.env.APICOMMONDATA_DIR;
const UPDATE = process.env.UPDATE_GOLDEN === '1';
const ECUN = join(genomeFixtures, 'ecun');
const EXPECTED = join(ECUN, 'expected');

function skipReason() {
  if (!ACD) return 'APICOMMONDATA_DIR is not set; point it at an ApiCommonData checkout to run the golden genome';
  if (!existsSync(join(ACD, MAP_PATH))) return `${ACD} has no ${MAP_PATH}`;
  return perlMissing;
}

/** Compares with the checked-in file, or rewrites it under UPDATE_GOLDEN=1. */
function golden(name, actual) {
  const path = join(EXPECTED, name);
  if (UPDATE) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, name.endsWith('.gz') ? gzipSync(actual) : actual);
    return;
  }
  const expected = readText(path);
  if (actual === expected) return;
  const a = actual.split('\n');
  const e = expected.split('\n');
  const line = a.findIndex((l, i) => l !== e[i]);
  assert.fail(`${name} differs from the golden at line ${line + 1}:\n  got:      ${a[line]}\n  expected: ${e[line]}\nIf intended, re-run with UPDATE_GOLDEN=1 and review the diff.`);
}

const shapeNoIds = (t) => `${t.type}:${t.start}-${t.end}:${t.strand}[${t.children.map(shapeNoIds).join(',')}]`;
const counts = (findings, stage) => findings.filter((f) => f.stage === stage).map((f) => [f.check, f.count]);
const masked = (record) => ({ ...record, apiCommonData: { commit: '<masked>', preprocessGFF3: { sha256: '<masked>' } } });

test('normalizeDbxrefs sorts the Dbxref segments of each line', () => {
  assert.equal(normalizeDbxrefs('c\tE\tgene\t1\t9\t.\t+\t.\tID "g";Dbxref  "PMID:2";Name "n";Dbxref "PMID:1";\n#x'),
    'c\tE\tgene\t1\t9\t.\t+\t.\tID "g";Dbxref "PMID:1";Name "n";Dbxref "PMID:2";\n#x');
});

test('golden: E. cuniculi GB-M1 chromosomes X and XI through fetch, survey, build and finalize', { skip: skipReason() }, async () => {
  const workDir = tempDir('golden-ecun-');
  const files = Object.fromEntries([ECUN_GFF, ECUN_FASTA, ECUN_REPORT].map((p) => [basename(p), readFileSync(p)]));
  await runFetch({ workDir, accession: 'GCA_000091225.2', fetchBytes: stubNcbi('GCA_000091225.2', 'GCA_000091225.2_ASM9122v2', files).fetchBytes, now: FIXED_NOW });
  cpSync(join(ECUN, 'recipe.json'), join(workDir, 'recipe.json'));
  cpSync(join(ECUN, 'ids.tsv'), join(workDir, 'ids.tsv'));

  const survey = await runSurvey({ workDir, apiCommonData: ACD, now: FIXED_NOW });
  assert.deepEqual(counts(survey.findings, 'raw'), [['geneCdsNoRna', 428], ['repeatedGeneLines', 1], ['parentlessRna', 6], ['unhandledType', 434], ['partitionCounts', 1]]);
  assert.deepEqual(counts(survey.findings, 'suggested'), [['unhandledType', 2], ['attributeNotInMap', 1], ['partitionCounts', 1]]);
  assert.equal(survey.findings[3].message, 'ISF drops these features: region 2, gene 430, SRP_RNA 1, RNase_MRP_RNA 1');
  assert.deepEqual(survey.findings[1].sample, ['gene-ECU10_0805']);
  assert.deepEqual(survey.findings.find((f) => f.check === 'attributeNotInMap').sample, ['ECU10_0805']);
  assert.deepEqual(survey.suggestedRecipe, JSON.parse(readFileSync(join(ECUN, 'recipe.json'), 'utf-8')));
  golden('survey.json', readFileSync(join(workDir, 'survey.json'), 'utf-8'));

  const build = await runBuild({ workDir, apiCommonData: ACD, now: FIXED_NOW });
  assert.deepEqual(build.transforms.map((t) => [t.name, t.changes]), [
    ['collapseSplitGenes', 1], ['addMrnaToGeneCds', 428], ['addExonPerCds', 428], ['parentOrphanRnas', 6], ['stripAttributes', 1]
  ]);
  assert.deepEqual(build.idPolicy, { name: 'ncbiDefault', renamed: 864 });
  assert.equal(build.ids.applied, 1);
  assert.deepEqual(build.warnings, []);
  assert.deepEqual(build.findings.map((f) => [f.check, f.count]), [['unhandledType', 2], ['partitionCounts', 1]]);
  const idsDefault = readFileSync(join(workDir, 'ids.default.tsv'), 'utf-8').split('\n');
  assert.equal(idsDefault.length, 866);
  for (const row of ['gene\tgene-ECU11_0375\tECU11_0375', 'gene\tgene-ECU11_0375-2\tECU11_0375-2', 'protein\tcds-SKD10708.1\tSKD10708.1']) {
    assert.ok(idsDefault.includes(row), row);
  }
  assert.equal(idsDefault.some((row) => row.startsWith('transcript\t')), false);
  const normalized = readFileSync(join(workDir, 'build/normalized.gff3'), 'utf-8');
  const lines = normalized.split('\n');
  assert.equal(lines.filter((l) => l && !l.startsWith('#')).length, 1777);
  for (const line of [
    'AL590449.1\tEMBL\tgene\t109856\t110296\t.\t-\t.\tID=ECU10_0805;Name=ECU10_0805;gbkey=Gene;gene=ECU10_0805;gene_biotype=protein_coding',
    'AL590449.1\tEMBL\tmRNA\t109856\t110296\t.\t-\t.\tID=ECU10_0805_mRNA;Parent=ECU10_0805',
    'AL590449.1\tEMBL\texon\t110270\t110296\t.\t-\t.\tID=ECU10_0805_mRNA_exon1;Parent=ECU10_0805_mRNA',
    'AL590449.1\tEMBL\texon\t109856\t110061\t.\t-\t.\tID=ECU10_0805_mRNA_exon3;Parent=ECU10_0805_mRNA',
    'AL590449.1\tEMBL\tgene\t138959\t139146\t.\t+\t.\tID=gene_AL590449.1_138959_139146',
    'AL590449.1\tEMBL\tSRP_RNA\t138959\t139146\t.\t+\t.\tID=rna_AL590449.1_138959_139146_SRP_RNA;Parent=gene_AL590449.1_138959_139146;gbkey=ncRNA;product=SRP RNA',
    'AL590450.2\tEMBL\tgene\t53325\t53558\t.\t+\t.\tID=ECU11_0375;Name=ECU11_0375;gbkey=Gene;gene=ECU11_0375;gene_biotype=protein_coding',
    'AL590450.2\tEMBL\tmRNA\t53325\t53558\t.\t+\t.\tID=ECU11_0375_mRNA;Parent=ECU11_0375',
    'AL590450.2\tEMBL\tgene\t53670\t53750\t.\t-\t.\tID=ECU11_0375_2;Name=ECU11_0375;gbkey=Gene;gene=ECU11_0375;gene_biotype=tRNA',
    'AL590450.2\tEMBL\ttRNA\t53670\t53750\t.\t-\t.\tID=rna-ECU11_0375;Parent=ECU11_0375_2;Note=tRNA found by tRNAscan-SE%2C tRNA type: Leu%2C Anticodon: TAG%2C Score: 59.63;gbkey=tRNA;gene=ECU11_0375;product=tRNA-Leu'
  ]) assert.ok(lines.includes(line), line);

  const { trees, dropped } = isfTrees(parseGff(normalized));
  const types = {};
  for (const t of trees) types[t.type] = (types[t.type] ?? 0) + 1;
  assert.deepEqual(types, { coding_gene: 428, tRNA_gene: 8, snRNA_gene: 3, SRP_RNA_gene: 1, snoRNA_gene: 1, RNase_MRP_RNA_gene: 1 });
  assert.deepEqual(dropped.map((d) => d.type), ['region', 'region']);
  const remaining = trees.map(shapeNoIds);
  for (const shape of parseBioperlTree(readText(join(ECUN, 'isf/bioperltree.out.gz'))).map(shapeNoIds)) {
    const i = remaining.indexOf(shape);
    assert.ok(i >= 0, `ISF built ${shape} from the spike's GFF; the pipeline's build has no such tree`);
    remaining.splice(i, 1);
  }
  assert.deepEqual(remaining.map((s) => s.split(':')[0]), ['SRP_RNA_gene', 'RNase_MRP_RNA_gene']);

  const script = withoutBioSeqIO(join(ACD, SCRIPT_PATH), tempDir('golden-preprocess-'));
  const record = await runFinalize({ workDir, apiCommonData: ACD, preprocessGFF3: script, now: FIXED_NOW });
  const final = join(workDir, 'final/primary_chromosome');
  assert.equal(readFileSync(join(final, 'chromosomeMap.txt'), 'utf-8'), 'AL590449.1\tX\t1\nAL590450.2\tXI\t2\n');
  assert.equal(readFileSync(join(final, 'genome.fasta'), 'utf-8'), readText(ECUN_FASTA));
  const gff = readFileSync(join(final, 'genome.gff'), 'utf-8');
  assert.equal(gff.split('\n').filter(Boolean).length, 1777);
  assert.ok(gff.includes('AL590449.1\tEMBL\tgene\t109856\t110296\t.\t-\t.\tID "ECU10_0805";Name "ECU10_0805";gbkey "Gene";gene "ECU10_0805";gene_biotype "protein_coding";\n'));
  golden('final/primary_chromosome/genome.gff.gz', normalizeDbxrefs(gff));
  golden('genome-build.json', `${JSON.stringify(masked(record), null, 2)}\n`);
});
```

The `types` object's key order follows first appearance in file order: X's first tree is a coding gene, its tRNA genes and the SRP gene precede XI's snRNA, snoRNA and RNase MRP genes. `assert.deepEqual` ignores key order, so this does not matter.

- [ ] **Step 3: Run it without ApiCommonData to see it skip**

Run: `node --test tests/genome-golden.test.js`
Expected: 1 pass (`normalizeDbxrefs`), 1 skipped with `APICOMMONDATA_DIR is not set; point it at an ApiCommonData checkout to run the golden genome`.

- [ ] **Step 4: Generate the goldens**

Run: `UPDATE_GOLDEN=1 APICOMMONDATA_DIR=/home/jbrestel/workspaces/src/ApiCommonData node --test tests/genome-golden.test.js`
Expected: PASS, 2 tests; three files written under `tests/fixtures/genome/ecun/expected/`. Every explicit assertion above still ran, so a wrong count fails here, before any golden is trusted.

- [ ] **Step 5: Review the generated goldens**

Run: `git -C /home/jbrestel/workspaces/src/dataset-curator-gff-pipeline status --short tests/fixtures/genome/ecun/expected`
Expected: the three new files. Read `expected/survey.json` and `expected/genome-build.json` in full: findings and transform counts as asserted, `apiCommonData` masked, `partitions` = one `final/primary_chromosome` with `sequenceCount: 2` and `featureCount: 1777`. Spot-check `zcat tests/fixtures/genome/ecun/expected/final/primary_chromosome/genome.gff.gz | grep -m 3 ECU10_0805`.

- [ ] **Step 6: Run it again against the goldens**

Run: `APICOMMONDATA_DIR=/home/jbrestel/workspaces/src/ApiCommonData node --test tests/genome-golden.test.js`
Expected: PASS, 2 tests.

- [ ] **Step 7: Commit**

```bash
git add tests/genome-helpers.js tests/genome-golden.test.js tests/fixtures/genome/ecun
git commit -m "Genome pipeline: golden E. cuniculi X and XI through all four commands

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 21: Docs and version 3.1.0

**Files:**
- Modify: `docs/development.md` (new section after "Shared Library"'s dataset-type contract, before "### Tests")
- Modify: `package.json`, `.claude-plugin/plugin.json`

- [ ] **Step 1: Add the section to `docs/development.md`** (insert immediately before the line `### Tests`)

```markdown
### Genome pipeline (`shared/scripts/genome/`)

NCBI annotated genome in, ISF-ready partitions out
(spec: `docs/superpowers/specs/2026-11-04-gff-pipeline-design.md`). No skill
calls it yet, so nothing here is listed in `sharedFiles` or synced.

    node shared/scripts/genome/genome-pipeline.js fetch <GCA_/GCF_ accession> --workDir <dir>
    node shared/scripts/genome/genome-pipeline.js survey   --workDir <dir> --apiCommonData <checkout>
    node shared/scripts/genome/genome-pipeline.js build    --workDir <dir> --apiCommonData <checkout>
    node shared/scripts/genome/genome-pipeline.js finalize --workDir <dir> --apiCommonData <checkout> [--preprocessGFF3 <script>]

`survey` writes `survey.json` with raw findings and a preview of its
`suggestedRecipe`; the curator copies that into `recipe.json`. `build` writes
`ids.default.tsv`, `build/` and `build/build.json`; `finalize` writes
`final/<partition>/` and `genome-build.json`. `ids.tsv` lines always name an
input ID as NCBI wrote it (the `old` column of `ids.default.tsv`) and apply in
the ID pass, before the transforms; IDs a transform creates follow from them.

| Module | Purpose |
|---|---|
| `gff.js` | GFF3 ⇄ graph; all line-level GFF code |
| `feature-types.js` | Gene, transcript and protein levels |
| `fasta.js` | Streaming FASTA index and subset |
| `assembly-report.js`, `partitions.js` | Report ranks and the partition plan |
| `isf-map.js` | ISF map reader and the port of `genemRNAExonCDS2BioperlTree` |
| `ids.js` | ID policies and `ids.tsv` |
| `transforms/` | One pure transform per file and the registry |
| `checks.js` | Checks shared by `survey` and `build` |
| `preprocess-gff3.js` | `perl -c` precheck and running `preprocessGFF3` |
| `commands/` | `fetch`, `survey`, `build`, `finalize` |

`preprocessGFF3` needs only core Perl once its unused `use Bio::SeqIO;` is
removed in ApiCommonData; until then pass a copy without it as
`--preprocessGFF3`. The golden test (`tests/genome-golden.test.js`) needs
`APICOMMONDATA_DIR` and `perl`, and skips without them; regenerate its expected
files with `UPDATE_GOLDEN=1` and review the diff.
```

- [ ] **Step 2: Bump the version**

In `package.json` change `"version": "3.0.0"` to `"version": "3.1.0"`. In `.claude-plugin/plugin.json` change `"version": "3.0.0"` to `"version": "3.1.0"`.

- [ ] **Step 3: Run the whole suite**

Run: `yarn --cwd /home/jbrestel/workspaces/src/dataset-curator-gff-pipeline test`
Expected (the script runs `node --test --test-global-setup=tests/globalSetup.js tests/*.test.js`): all tests pass; the genome golden and real-ApiCommonData tests report as skipped without `APICOMMONDATA_DIR`. `tests/import-graph.test.js` passes (no cycles under `shared/scripts/genome/`).

Run: `APICOMMONDATA_DIR=/home/jbrestel/workspaces/src/ApiCommonData yarn --cwd /home/jbrestel/workspaces/src/dataset-curator-gff-pipeline test`
Expected: all tests pass, none skipped among the genome tests.

- [ ] **Step 4: Confirm sync leaves the new directory alone**

Run: `yarn --cwd /home/jbrestel/workspaces/src/dataset-curator-gff-pipeline sync-shared`
Expected: ends with `Sync complete: … files synced, 0 errors`; `git status --short skills` shows no changes.

- [ ] **Step 5: Commit**

```bash
git add docs/development.md package.json .claude-plugin/plugin.json
git commit -m "GFF pipeline (3.1.0)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Self-review against the spec

| Spec requirement | Task |
|---|---|
| NCBI inputs only; partition discovery behind one module, `partitions.tsv` | 4, 5, 15 |
| Detect then declare: `survey` suggests, only `recipe.json` runs | 16, 17 |
| Locus-tag IDs, `ids.tsv` overrides, collisions are errors (no suffix) | 8, 9, 10, 17 (spec questions 1–3) |
| `preprocessGFF3` from the checkout with host perl; `perl -c` precheck naming `use Bio::SeqIO` | 14, 18 |
| D knows nothing of proposals; neutral `partitions[]` | 5, 17, 18 |
| Each command checks predecessor outputs and checksums | 15 (`verifyFetch`), 16, 17 (survey inputs), 18 (normalized sha) |
| Work area layout | 1 |
| `genome-build.json` contents | 17, 18 (spec question 6) |
| `fetch`: reuse, drift error naming the file, no annotation GFF | 15 |
| `survey`: findings + suggested recipe, never modifies inputs | 16 |
| `build`: three phases in order (IDs with `ids.tsv` and collision check, transforms, partition); re-check; refuse `build/` on error | 8, 9, 17 |
| Created-ID collision names the input ID whose `ids.tsv` line fixes it; created IDs follow settled IDs | 10, 11, 12, 13, 17 |
| `finalize`: per-partition GFF, FASTA copy, `chromosomeMap.txt`, non-empty checks; checksums on `build/normalized.gff3` | 18 |
| Transforms table, created ID formats, `_` only, zero-change warning, created-ID collision | 10–12 |
| `ids.tsv` format, levels, `old` = input ID, applied in phase 1, sequence rename reaching FASTA and report; its three errors | 8, 9, 17 |
| Partition ranks, primary/secondary/organelle, report errors, `chromosomeMap.txt` | 4, 5 |
| Every check and severity; findings with count, ≤ 20 samples, fix | 13 |
| ISF map + type-rename port, `Dbxref`/`previous_systematic_id` allowed | 6, 7, 13 |
| Errors name command, file and next step | 1 and every command |
| Testing: GFF round trip; each transform; IDs; partition fixtures; each check; stubbed fetch; golden with Dbxref sort, skip; port vs `bioperltree.out` | 2, 10–12, 8–9, 5, 13, 15, 20, 7 |
| Minor version bump | 21 |


