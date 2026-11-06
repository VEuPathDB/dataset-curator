# verify-genome (sub-project F) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn D's, C's and E's records into a genome proposal's dataset entries, organism constants and organism props by pull request; validate and deliver a genome from its work area; create a new genome's organism file at load; and guide a data loader through it with a `verify-genome` skill.

**Architecture:** The genome type gains small modules under `shared/scripts/dataset-types/genome-assembly/` (records reader, entries, amendment, delivery hook, organism file) that the type module re-exports as hooks, plus six validators of two kinds (`preprocess` reads the work area, `content` reads the proposal). A generic `amend-proposal.js` writes the amendment on the proposal branch; publish and merge reuse the propose path. Load creates the organism file through a type hook, `newOrganismFiles`.

**Tech Stack:** Node 18 ES modules, `node:test`, no new dependencies.

Spec: `docs/superpowers/specs/2026-11-05-verify-genome-design.md`.

## Amendments

(Decisions made during execution go here, newest last. Each names the task, what changed and why.)

1. **Task 1, golden:** regenerated with `APICOMMONDATA_DIR` set; only `featureTypes` and `maxIntron` were added (1777 features, longest intron 45).
2. **Tasks 2–3 review (6f4ed4d):** `preprocessedProblems` reports a deleted loaded file instead of throwing ENOENT; `packageVersion` catches only ENOENT and needs a string version; Phase 1 `--overrides` refuse the amended organism keys (the amendment owns them).
3. **Tasks 3–4 review (d79eb35):** `organismValueProblems` is shared by `preprocessedAmendment` and the `organismRecord` validator, so the amendment never writes what the validator rejects; `readPreprocessed` refuses a record that changes between hash and parse (all three records); a null functional `url` becomes `""` for every class. A malformed-`package.json` test is not possible: Node's loader rejects it first.
4. **Task 5:** the plan's dnaseq markReady test needed a staged `dataset.json` (test-only fix).
5. **Task 6:** a genome now has validators, so the old genome `prepareDelivery` test needed a genome report on its ticket (test-only fix).
6. **Tasks 5–6 review (f8c5f73):** `ids` skips missing files (`records` reports them; a missing `transcriptInfoAndIds` makes `ids` return nothing); `recordsOrNull` catches only `PipelineError`; `organismRecord` messages never print `undefined` and name a too-new schema version.
7. **Task 8:** a genome with entries and no work area now fails with "No preprocessing work area"; the old empty-`final/` test was renamed to that.
8. **Tasks 7–8 review (19af520), replaces decision 11:** the hook keeps no module state. `collectPreprocessed` passes a fresh `cache` per call and de-duplicates problem strings (first location wins); a features partition without trial `transcriptInfoAndIds` is a problem.
9. **Task 9 review (ce6876f):** `newOrganismProblems` takes project-file contents, so load and build fitness share it; build fitness reports new-organism refusals at verify (`--against`) instead of skipping them. New refusals: a second reference strain of a species, a named reference strain that is not one, an empty `familyRepOrganismAbbrev`, record vs constants `genomeSource`/`genomeVersion`, missing amended props before the `orthomclAbbrev` clash check.
11. **Final review (e6d0d69, 709d0e9, 4c92689, d7a4c54):** a Phase 1 re-write keeps the amended props, record schema version 2, and an amended `familyRepOrganismAbbrev` when Phase 1 derives it empty; `delivery.json` records the report's `preprocess` and mark-ready refuses a delivery from another validation; `--organism familyRepOrganismAbbrev=` is accepted and an empty rep is refused unless `isFamilyRepresentative=true`; `runValidators` refuses a validator without a known `kind`; build fitness needs both organism-file hooks; `genome/record.js` reads `package.json` lazily (`generator()`); SKILL.md states the push exception, GenBank only, and corrected survey/ID/undo steps.
12. **Scope (John, 2026-11-06):** F is GenBank-annotated only. Provider-GFF annotation (sequence still from GenBank) is the next sub-project, G. All existing v1 genome proposals are GenBank-style and go through verify-genome. The `maxIntronSize` floor of 1000 stays.
13. **Tests (29e85b6):** genome test helpers remove their temp dirs; repo-style helpers in `tests/helpers.js` still leak (follow-up).
10. **Task 10, open:** the resume check compares the entries label (single name or "N datasets"), so a same-count change to the entries is not caught. Follow-up candidate: compare master's entries with the load commit's tree.

## Decisions made while planning

1. **`fasta_secondary_genome` needs no empty `chromosomeMap.txt`.** GusAppFramework `Supported/plugin/perl/LoadFastaSequences.pm` declares `chromosomeMapFile` with `reqd => 0, mustExist => 0` (lines 258-265) and opens it only when `SOTermName eq 'chromosome'` (lines 402-405, 926-929). The genome hook delivers `chromosomeMap.txt` only when the partition has one; the hook never returns `{ path, text }`, so `collectPreprocessed` is not changed for text.
2. **Phase 1 keeps writing organism record schema version 1.** `ORGANISM_RECORD_SCHEMA_VERSION` becomes 2 and means "amended"; it lives in `genome-assembly/amendment.js` (re-exported by `genome-assembly.js`). `deriveOrganismRecord` writes `PHASE1_RECORD_SCHEMA_VERSION = 1`, so a v1 record is exactly an unamended one and existing Phase 1 tests stay as they are.
3. **Entries carry `ncbiTaxonId: "$$ncbiTaxonId$$"`.** It is a prop of every sequence and features class and not an identity prop, so `entryPropErrors` requires it; the spec's entry table omits it. `geneName` and `dbxref_simple` get `genomeVersion: "$$genomeVersion$$"` from the defaults table.
4. **Entry sources:** sequence entries `{ type: "url", urls: [fasta url, report url] }`; features and functional entries `[gff url]`, all from `fetch/fetch.json`.
5. **Functional defaults** (`FUNCTIONAL_DEFAULTS` in `genome-assembly/entries.js`): `aliases` as FungiDB's gbProteinId datasets (`columnSpec primary_identifier`, NCBI protein URL, `urlUsesSecondaryId false`, `target NAFeature`, `idType alternate id`, `viewName Transcript`); `dbxref_simple` `columnSpec primary_identifier`, `target NAFeature`, `url ""`, `urlUsesSecondaryId false`, `genomeVersion $$genomeVersion$$`, `viewName GeneFeature`. A record prop wins where `functional.json` has one; a `null` URL becomes `""`; record props that are not class props (`prefixes`) are dropped. A test pins each default's keys to its class's props.
6. **`isHugeGenome`** reads `assembly_stats.total_sequence_length` from `inputs/<accession>_dataset_report.json` (the same report `functAnnotVersion` reads). Without it the amendment refuses unless `--organism isHugeGenome=…` is given.
7. **Re-running the amendment:** a given `--organism` value always wins; `orthomclAbbrev`, `familyNcbiTaxonIds` and `familyNameForFiles` otherwise keep the record's value; every other owned prop is re-derived (an earlier `--organism isCore=true` must be given again). Constants merge into the record's `constants`, keeping keys the amendment does not own.
8. **`amend-proposal.js` refuses a proposal whose annotation source is not `genbank`, and a work area of another accession.** D fetches NCBI annotation only, so a provider or no annotation cannot be amended from it.
9. **`maxIntron` is computed from `build/<p>/genome.gff3`, `featureTypes` from the final GFF.** The final GFF is `preprocessGFF3` output with GFF2-style attributes (`ID "x";`), which `parseGff` cannot read; column 3 is all `featureTypes` needs. Both files hold the same feature lines (the golden genome: 1777 each).
10. **`report.preprocess` is written through a `ctx.extras` object** that `validateProposal` passes to every validator and spreads into the report; only the `records` validator writes to it. The delivery hook refuses a report without `preprocess` ("validate again").
11. **The delivery hook reads and checks the records once per delivery:** it memoizes on the report object (one per `prepareDelivery` run) and reports the shared problems under the first location only.
12. **`pipelineFindings` reports E's error findings too.** `checkFunctionalCurrent` does not look at findings, so an E error (such as `noProducts`) would otherwise pass unseen.
13. **Preprocess validators other than `records` return nothing when the records cannot be read;** `records` reports that once.
14. **`merge-proposal.js` merges a proposal whose ticket is at Preprocessing (`verifying`) and keeps that status.** The spec's flow (claim, then amend and merge) is refused otherwise.
15. **A non-reference strain's organism dataset is appended at the end of `<Project>.xml`**, after its reference strain; classes.xml says reference strains must precede other strains. A reference strain's blocks go after the top-level constants, as the spec says.
16. **A resumed load settles against the rebuild branch, not HEAD,** because its own load commit created the organism file; and a resume is refused when the committed entries label (`N datasets` or the one name) differs from master's.
17. **A's carry-over "a second entry clashes" and the `DISTINCT_NAME` advice are tested at load as `assertValidEntries` refusals** (a shared `datasetName`; a shared delivery directory with the numeric-suffix advice). A new genome's organism file never exists before load, and `namePatternClash` never applies to genomes, so the organism-file clash path is unreachable for them.
18. **`buildFitness` expects no organism file for a new organism of a type with `newOrganismFiles`.**
19. **`genome/record.js` finds `package.json` from both `shared/scripts/genome/` and `skills/<name>/scripts/genome/`**, so `genome-pipeline.js` runs from the skill copy.
20. **The genome reader modules are synced into every skill that carries `genome-assembly.js`** (the four propose skills, `load-proposals`, `verify-bulk-rnaseq`), because the type module's hooks import them. `lib/file-hash.js` and `lib/tools/exec.js` are added to the propose skills for the same reason.
21. **The genome delivery hook is tested through `collectPreprocessed` with the real genome type**, not through a full genome `prepareDelivery` run; the acceptance run covers the rest.
22. **Feature-partition file names come from `trial.json` `outputs` keys** (`transcriptInfoAndIds`), so no file name is redefined outside C.
23. **The organism file's boilerplate is, in order:** `validateOrganismInfo` (with `speciesNcbiTaxonId` and `genomeVersion`, as every FungiDB file has), `ECAssocFromUniprot`, `referenceStrain-dbEST` (reference strains only), `transcriptsFromReferenceStrain`: the order of `FungiDB/abraATCC96836.xml` (VEuPathDatasets f9c7e49c5).
24. **"Secondaries only beside a primary" is covered by the exactly-one-primary check**, so it has no check of its own.
25. **The `ids` validator reads GAF IDs from column 2** (E writes `<source>` in column 1).

## Conventions for every task

- Work only in `/home/jbrestel/workspaces/src/dataset-curator-verify-genome` (branch `feature/verify-genome`; below, `W`). Use absolute paths, `git -C W` and `yarn --cwd W`; never `cd`.
- Run only the task's test files plus the import-graph test:
  `node --test --test-reporter=dot --test-global-setup=W/tests/globalSetup.js W/tests/<file>.test.js W/tests/import-graph.test.js`
  (write `W` out in full). The full suite (`yarn --cwd W test`) runs only at the checkpoints in Tasks 6, 10 and 11.
- No command substitution, no `;` chains, one command per step. Stage with `git -C W add <paths>`, then commit in a separate call. Every commit message ends with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- When a task registers files in `package.json` `sharedFiles`, run `node W/bin/sync-shared.js` before staging and stage the `skills/` copies it writes. The pre-commit hook runs it again.
- No large fixture files: tests build work areas in temp dirs (`tests/genome-work-area.js`).
- Comments only where the code is not self-explanatory, 2-3 lines at most, no examples that go stale.
- Every refusal has a test that fails without its check.
- If a step's expected result does not happen and the plan does not say why, stop and report (status BLOCKED) rather than working around it.

## File structure

| File | Responsibility |
|---|---|
| `shared/scripts/genome/partition-shape.js` (new) | `featureTypesOf(gffText)`, `maxIntronOf(graph)` |
| `shared/scripts/genome/commands/finalize.js` | adds `featureTypes` and `maxIntron` to each partition of `genome-build.json` |
| `shared/scripts/genome/record.js` | package version from either layout |
| `shared/scripts/dataset-types/genome-assembly/preprocess.js` (new) | `readPreprocessed(workArea)`, `preprocessedProblems(records, workArea)` |
| `shared/scripts/dataset-types/genome-assembly/entries.js` (new) | class tables, `FUNCTIONAL_DEFAULTS`, `entriesFrom(records)`, `partitionOf(entry, partitions)` |
| `shared/scripts/dataset-types/genome-assembly/amendment.js` (new) | `preprocessedAmendment(...)`, `constantsFrom`, `reportOf`, `ORGANISM_RECORD_SCHEMA_VERSION` |
| `shared/scripts/dataset-types/genome-assembly/delivery.js` (new) | the `preprocessedFiles` hook |
| `shared/scripts/dataset-types/genome-assembly/organism-file.js` (new) | the `newOrganismFiles` hook, `insertAfterConstants`, `ORGANISM_FILE_BOILERPLATE` |
| `shared/scripts/dataset-types/genome-assembly/validators/*.js` (new) | `records`, `matchesBuild`, `ids`, `pipelineFindings`, `entryShape`, `organismRecord`, `index.js` |
| `shared/scripts/dataset-types/genome-assembly.js` | re-exports the hooks; Phase 1 record version |
| `shared/scripts/dataset-types/_common.js` | `AMENDED_ORGANISM_KEYS`; `ORGANISM_RECORD_KEYS` gains them |
| `shared/scripts/dataset-types/validators.js` | registers the genome validators |
| `shared/scripts/lib/amend-ops.js` (new), `shared/scripts/amend-proposal.js` (new) | the amendment on the proposal branch |
| `shared/scripts/lib/merge-ops.js` | merges at Preprocessing |
| `shared/scripts/lib/validation.js` | validator kinds; provenance line in the delivery comment |
| `shared/scripts/lib/validation-ops.js` | `workArea` and `extras` for validators; content validators only at load |
| `shared/scripts/lib/preprocessed.js` | refuses a symlinked work area; passes the report to the hook |
| `shared/scripts/lib/delivery-ops.js` | passes the report; records `againstCommit` |
| `shared/scripts/lib/verification-ops.js` | reads classes at `againstCommit` |
| `shared/scripts/lib/git-ops.js` | `diff(ref, path)`, `commitOf(ref)` |
| `shared/scripts/lib/dataset-classes.js` | `classPropsOf`, `readClassProps` |
| `shared/scripts/lib/project-organisms.js` | `organismDatasetProps(xml)` |
| `shared/scripts/lib/load-ops.js` | creates a new organism's files; resume fixes |
| `shared/scripts/lib/build-fitness.js` | no missing-file error for a new organism |
| `shared/scripts/load-proposal.js` | dry run names created files |
| `skills/verify-genome/SKILL.md` (new) | the genome parts of verification |
| `tests/genome-work-area.js` (new) | fixture work area and proposal builders |

---

### Task 1: `finalize` records feature types and the longest intron

**Files:**
- Create: `shared/scripts/genome/partition-shape.js`
- Modify: `shared/scripts/genome/commands/finalize.js`
- Modify: `tests/genome-finalize.test.js`
- Create: `tests/genome-partition-shape.test.js`
- Modify (regenerated): `tests/fixtures/genome/ecun/expected/genome-build.json`

- [ ] **Step 1: Write the failing unit tests** — `tests/genome-partition-shape.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { featureTypesOf, maxIntronOf } from '../shared/scripts/genome/partition-shape.js';
import { parseGff } from '../shared/scripts/genome/gff.js';
import { gffLine } from './genome-helpers.js';

test('featureTypesOf counts column 3 of feature lines in either attribute syntax, sorted by type', () => {
  const text = [
    '##gff-version 3',
    'c\tE\tgene\t1\t9\t.\t+\t.\tID "g1";',
    'c\tE\tmRNA\t1\t9\t.\t+\t.\tID=m1;Parent=g1',
    'c\tE\texon\t1\t3\t.\t+\t.\tParent=m1',
    'c\tE\texon\t7\t9\t.\t+\t.\tParent=m1',
    ''
  ].join('\n');
  assert.deepEqual(featureTypesOf(text), { exon: 2, gene: 1, mRNA: 1 });
  assert.deepEqual(Object.keys(featureTypesOf(text)), ['exon', 'gene', 'mRNA']);
  assert.deepEqual(featureTypesOf(''), {});
});

test('maxIntronOf takes the longest gap between consecutive exons of one parent, in any line order', () => {
  const gff = [
    gffLine('c', 'exon', 500, 600, '-', 'ID=e2;Parent=t1'),
    gffLine('c', 'exon', 100, 200, '-', 'ID=e1;Parent=t1'),
    gffLine('c', 'exon', 1000, 1100, '+', 'ID=e3;Parent=t2'),
    gffLine('c', 'exon', 1150, 1200, '+', 'ID=e4;Parent=t2'),
    gffLine('c', 'CDS', 100, 1200, '+', 'ID=p1;Parent=t2')
  ].join('\n') + '\n';
  assert.equal(maxIntronOf(parseGff(gff)), 299);
  assert.equal(maxIntronOf(parseGff(`${gffLine('c', 'exon', 1, 9, '+', 'ID=e;Parent=t')}\n`)), 0);
});
```

- [ ] **Step 2: Run** `node --test --test-reporter=dot --test-global-setup=W/tests/globalSetup.js W/tests/genome-partition-shape.test.js`; expect FAIL (module not found).

- [ ] **Step 3: Implement** — `shared/scripts/genome/partition-shape.js`:

```js
import { features, parentsOf } from './gff.js';

/** { <GFF type>: count } over the feature lines of a GFF, sorted by type; column 3 only, so either attribute syntax reads. */
export function featureTypesOf(gffText) {
  const counts = {};
  for (const line of gffText.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const type = line.split('\t')[2];
    if (type) counts[type] = (counts[type] ?? 0) + 1;
  }
  return Object.fromEntries(Object.keys(counts).sort().map((type) => [type, counts[type]]));
}

/** The longest gap between consecutive exons of one parent, in bases, or 0. */
export function maxIntronOf(graph) {
  const exons = new Map();
  for (const f of features(graph)) {
    if (f.type !== 'exon') continue;
    for (const parent of parentsOf(f)) exons.set(parent, [...(exons.get(parent) ?? []), f]);
  }
  let max = 0;
  for (const list of exons.values()) {
    const sorted = [...list].sort((a, b) => a.start - b.start);
    for (let i = 1; i < sorted.length; i++) max = Math.max(max, sorted[i].start - sorted[i - 1].end - 1);
  }
  return max;
}
```

- [ ] **Step 4: Run** the Step 2 command; expect PASS.

- [ ] **Step 5: Write the failing finalize test** — append to `tests/genome-finalize.test.js` (add `featureTypesOf` from `../shared/scripts/genome/partition-shape.js` to the imports):

```js
test('finalize records each partition\'s feature types and longest intron in genome-build.json', { skip: perlMissing }, async () => {
  const { workDir, apiCommonData } = await built();
  const record = await runFinalize({ workDir, apiCommonData, now: FIXED_NOW });
  const [primary, secondary] = record.partitions;
  assert.deepEqual(primary.featureTypes, featureTypesOf(read(workDir, 'final/primary_chromosome/genome.gff')));
  assert.equal(primary.featureTypes.tRNA, 1);
  assert.equal(primary.featureTypes.exon, 6);
  assert.equal(primary.maxIntron, 99);
  assert.deepEqual(secondary.featureTypes, { CDS: 1, exon: 1, gene: 1, mRNA: 1 });
  assert.equal(secondary.maxIntron, 0);
  assert.deepEqual(JSON.parse(read(workDir, 'genome-build.json')).partitions[0].featureTypes, primary.featureTypes);
});
```

In the existing test `a partition with nothing for ISF, here only a region line, gets its FASTA and no GFF`, the `deepEqual` of `last` gains the two new fields; replace its expected object with:

```js
  assert.deepEqual(last, {
    role: 'organelle', soTerm: 'mitochondrial_chromosome', organelle: 'mitochondrion', sequenceCount: 1, dir: 'final/organelle_mitochondrion',
    featureCount: 0, gffLines: 1, final: { gff: null, fasta: 'genome.fasta', chromosomeMap: null }, featureTypes: {}, maxIntron: 0
  });
```

- [ ] **Step 6: Run** `node --test --test-reporter=dot --test-global-setup=W/tests/globalSetup.js W/tests/genome-finalize.test.js`; expect the new test and the organelle test to FAIL (no `featureTypes`). If `perl` is missing both are skipped: then stop and report, since this task cannot be verified.

- [ ] **Step 7: Implement** in `shared/scripts/genome/commands/finalize.js`:

Imports: add `readFileSync` to the `node:fs` import; add `import { parseGff } from '../gff.js';` and `import { featureTypesOf, maxIntronOf } from '../partition-shape.js';`.

At the end of `finalizePartition`, after the loop that checks each staged file, add:

```js
  const gff = final.gff ? readFileSync(join(dest, final.gff), 'utf-8') : null;
  return {
    featureTypes: gff === null ? {} : featureTypesOf(gff),
    // The final GFF has preprocessGFF3's GFF2-style attributes; the build GFF3 holds the same features.
    maxIntron: gff === null ? 0 : maxIntronOf(parseGff(readFileSync(join(src, BUILD_FILES.gff3), 'utf-8')))
  };
```

Update its doc comment to: `/** Writes exactly the files build named in \`part.final\`, checks each is there and non-empty, and returns the partition's featureTypes and maxIntron. */`

In `runFinalize`, replace

```js
    for (const part of build.partitions) finalizePartition(part, { script, exec, buildDir: p.buildDir, outDir, workDir });
```

with

```js
    const shapes = build.partitions.map((part) => finalizePartition(part, { script, exec, buildDir: p.buildDir, outDir, workDir }));
```

and in `record`, right after `...build,`:

```js
      partitions: build.partitions.map((part, i) => ({ ...part, ...shapes[i] })),
```

- [ ] **Step 8: Run** `node --test --test-reporter=dot --test-global-setup=W/tests/globalSetup.js W/tests/genome-finalize.test.js W/tests/genome-partition-shape.test.js W/tests/import-graph.test.js`; expect PASS.

- [ ] **Step 9: Regenerate the golden record:**
  `APICOMMONDATA_DIR=/home/jbrestel/workspaces/src/ApiCommonData UPDATE_GOLDEN=1 node --test --test-global-setup=W/tests/globalSetup.js W/tests/genome-golden.test.js`
  If the output says the golden test was skipped, record the skip reason under Amendments and go to Step 11.

- [ ] **Step 10: Review the golden change:** `git -C W diff --stat` must list only `tests/fixtures/genome/ecun/expected/genome-build.json`, and `git -C W diff tests/fixtures/genome/ecun/expected/genome-build.json` must show only added `featureTypes` and `maxIntron` keys in the one partition. Then run `APICOMMONDATA_DIR=/home/jbrestel/workspaces/src/ApiCommonData node --test --test-global-setup=W/tests/globalSetup.js W/tests/genome-golden.test.js`; expect PASS.

- [ ] **Step 11: Commit.**
  `git -C W add shared/scripts/genome/partition-shape.js shared/scripts/genome/commands/finalize.js tests/genome-partition-shape.test.js tests/genome-finalize.test.js tests/fixtures/genome/ecun/expected/genome-build.json`
  `git -C W commit -m "finalize records feature types and the longest intron per partition"` (with the Co-Authored-By trailer; drop the golden path from `add` if Step 9 was skipped).

---

### Task 2: Read a work area's records

**Files:**
- Modify: `shared/scripts/genome/record.js`
- Create: `shared/scripts/dataset-types/genome-assembly/preprocess.js`
- Create: `tests/genome-work-area.js` (test helper)
- Create: `tests/genome-record-version.test.js`, `tests/genome-preprocess.test.js`

No skill imports `preprocess.js` yet; Task 3 registers it.

- [ ] **Step 1: Write the work-area helper** — `tests/genome-work-area.js`:

```js
/** A genome work area as D, C and E leave it, and GCA_000001.1 as Phase 1 and the amendment leave it, built in temp dirs. */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { fixtures } from './helpers.js';

export const ACCESSION = 'GCA_000001.1';
const sha = (text) => createHash('sha256').update(text).digest('hex');
const GENERATOR = { name: 'dataset-curator genome-pipeline', version: '4.0.0' };
const NCBI = 'https://ftp.ncbi.nlm.nih.gov/genomes/all/GCA/000/000/001/GCA_000001.1_Tfak/GCA_000001.1_Tfak';
export const FETCH_URLS = { gff: `${NCBI}_genomic.gff.gz`, fasta: `${NCBI}_genomic.fna.gz`, report: `${NCBI}_assembly_report.txt` };

export const editJson = (path, edit) => writeFileSync(path, JSON.stringify(edit(JSON.parse(readFileSync(path, 'utf-8'))), null, 2) + '\n');

const gff = (rows) => `##gff-version 3\n${rows.map((r) => r.join('\t')).join('\n')}\n`;

/** A chromosome primary with two genes, a contig secondary with one, and a mitochondrion ISF loads nothing from. */
export const PARTITIONS = [
  {
    role: 'primary', soTerm: 'chromosome', organelle: null, sequenceCount: 1, dir: 'final/primary_chromosome', featureCount: 2, gffLines: 6,
    final: { gff: 'genome.gff', fasta: 'genome.fasta', chromosomeMap: 'chromosomeMap.txt' }, featureTypes: { exon: 2, gene: 2, mRNA: 1, tRNA: 1 }, maxIntron: 599,
    gff3: gff([
      ['CM1', 'EMBL', 'gene', '100', '900', '.', '+', '.', 'ID=TST_0010'],
      ['CM1', 'EMBL', 'mRNA', '100', '900', '.', '+', '.', 'ID=TST_0010_mRNA;Parent=TST_0010'],
      ['CM1', 'EMBL', 'exon', '100', '200', '.', '+', '.', 'ID=e1;Parent=TST_0010_mRNA'],
      ['CM1', 'EMBL', 'exon', '800', '900', '.', '+', '.', 'ID=e2;Parent=TST_0010_mRNA'],
      ['CM1', 'EMBL', 'gene', '1000', '1072', '.', '+', '.', 'ID=TST_0030'],
      ['CM1', 'EMBL', 'tRNA', '1000', '1072', '.', '+', '.', 'ID=TST_0030_tRNA;Parent=TST_0030']
    ]),
    fasta: '>CM1\nACGT\n', chromosomeMap: 'CM1\t1\t1\n', transcripts: [['TST_0010', 'TST_0010_mRNA'], ['TST_0030', 'TST_0030_tRNA']]
  },
  {
    role: 'secondary', soTerm: 'contig', organelle: null, sequenceCount: 1, dir: 'final/secondary_contig', featureCount: 1, gffLines: 2,
    final: { gff: 'genome.gff', fasta: 'genome.fasta', chromosomeMap: null }, featureTypes: { gene: 1, mRNA: 1 }, maxIntron: 0,
    gff3: gff([
      ['JA1', 'EMBL', 'gene', '10', '300', '.', '+', '.', 'ID=TST_0040'],
      ['JA1', 'EMBL', 'mRNA', '10', '300', '.', '+', '.', 'ID=TST_0040_mRNA;Parent=TST_0040']
    ]),
    fasta: '>JA1\nTTGA\n', transcripts: [['TST_0040', 'TST_0040_mRNA']]
  },
  {
    role: 'organelle', soTerm: 'mitochondrial_chromosome', organelle: 'mitochondrion', sequenceCount: 1, dir: 'final/organelle_mitochondrion', featureCount: 0, gffLines: 0,
    final: { gff: null, fasta: 'genome.fasta', chromosomeMap: null }, featureTypes: {}, maxIntron: 0, fasta: '>MT1\nAAAA\n', transcripts: []
  }
];

export const FUNCTIONAL = [
  { datasetClass: 'productNames', name: 'GenBank', file: 'products.txt', level: 'transcript', text: 'TST_0010_mRNA\thypothetical protein\t1\nTST_0040_mRNA\tkinase\t1\n', props: {} },
  { datasetClass: 'geneName', name: 'GenBank', file: 'geneName.txt', level: 'gene', text: 'TST_0010\tabcA\n', props: {} },
  {
    datasetClass: 'dbxref_simple', name: 'uniprot_from_annotation', file: 'mapping.txt', level: 'transcript', text: 'TST_0010_mRNA\tQ00001\n',
    props: { prefixes: ['UniProtKB/TrEMBL'], url: 'http://www.uniprot.org/uniprot/EXTERNAL_ID_HERE', target: 'NAFeature', viewName: 'Transcript' }
  },
  {
    datasetClass: 'dbxref_simple', name: 'ensemblgenomes_gn_from_annotation', file: 'mapping.txt', level: 'gene', text: 'TST_0010\tECU_0010\n',
    props: { prefixes: ['EnsemblGenomes-Gn'], url: null, target: 'NAFeature', viewName: 'GeneFeature' }
  }
];

const partitionRecord = ({ role, soTerm, organelle, sequenceCount, dir, featureCount, gffLines, final, featureTypes, maxIntron }) =>
  ({ role, soTerm, organelle, sequenceCount, dir, featureCount, gffLines, final, featureTypes, maxIntron });

/**
 * A finalized, trialled and functionally extracted work area for GCA_000001.1, at `at` or in a new temp dir.
 * trial overrides fields of trial.json; partitions and functionalDatasets replace the defaults above.
 */
export function genomeWorkArea({ at, trial = {}, partitions = PARTITIONS, functionalDatasets = FUNCTIONAL, buildFindings = [], buildWarnings = [], functionalFindings = [] } = {}) {
  const workArea = at ?? join(mkdtempSync(join(tmpdir(), 'work-area-')), 'preprocess');
  const write = (rel, text) => {
    mkdirSync(dirname(join(workArea, rel)), { recursive: true });
    writeFileSync(join(workArea, rel), text);
    return sha(text);
  };
  write('fetch/fetch.json', JSON.stringify({
    accession: ACCESSION, assembly: 'GCA_000001.1_Tfak', fetchedAt: '2026-11-05T00:00:00.000Z',
    files: Object.fromEntries(Object.entries(FETCH_URLS).map(([role, url]) => [role, { name: url.split('/').at(-1), url, sha256: sha(role) }]))
  }, null, 2));
  const loaded = {};
  const outputs = {};
  const records = partitions.map((p) => {
    const name = p.dir.split('/').at(-1);
    const finalFile = (key, text) => (p.final[key] ? write(`${p.dir}/${p.final[key]}`, text) : null);
    loaded[name] = { gff: finalFile('gff', p.gff3 ?? ''), fasta: finalFile('fasta', p.fasta), chromosomeMap: finalFile('chromosomeMap', p.chromosomeMap ?? '') };
    const gff3 = p.featureCount > 0 ? write(`build/${name}/genome.gff3`, p.gff3) : null;
    if (p.featureCount > 0) {
      outputs[name] = { transcriptInfoAndIds: write(`${p.dir}/transcriptInfoAndIds`, p.transcripts.map(([gene, transcript]) => `${gene}\tACGT\t1\t1-4\t${transcript}\n`).join('')) };
    }
    return { ...partitionRecord(p), buildFiles: { gff3, fasta: sha(p.fasta), chromosomeMap: p.final.chromosomeMap ? sha(p.chromosomeMap) : null } };
  });
  const genomeBuildSha = write('genome-build.json', JSON.stringify({
    schemaVersion: 1, generator: GENERATOR, source: 'ncbi', accession: ACCESSION, findings: buildFindings, warnings: buildWarnings, partitions: records,
    apiCommonData: { commit: 'c0ffee', dirty: false, isfMap: { path: 'Load/lib/xml/isf/genemRNAExonCDS2Gus.xml', sha256: 'm'.repeat(64) } }
  }, null, 2));
  write('trial/trial.json', JSON.stringify({
    schemaVersion: 2, generator: GENERATOR, result: 'passed', genomeBuild: { sha256: genomeBuildSha }, loaded, outputs,
    image: { name: 'gus_isf:local', digest: 'sha256:d', apiCommonDataCommit: 'c0ffee', modelTag: 'gus_isf-model:t', schemaFingerprint: 'f' },
    database: 'UniDB_test', release: '20261105T000000', taxonId: '999001', trialDatabases: {}, startedAt: '2026-11-05T00:00:00.000Z',
    steps: [], findings: [], profile: {}, kept: false, undone: true, ...trial
  }, null, 2));
  const datasets = functionalDatasets.map((d) => {
    const file = `final/function/${d.datasetClass}/${d.name}/${d.file}`;
    const rows = d.text.split('\n').filter(Boolean);
    return {
      datasetClass: d.datasetClass, name: d.name, file, rows: rows.length, sha256: write(file, d.text),
      ids: { level: d.level, count: new Set(rows.map((r) => r.split('\t')[0])).size }, props: d.props
    };
  });
  write('functional.json', JSON.stringify({
    schemaVersion: 1, generator: GENERATOR, genomeBuild: { sha256: genomeBuildSha }, source: 'GenBank', taxonId: '999001', gafDate: '20261105',
    datasets, findings: functionalFindings
  }, null, 2));
  return workArea;
}

/** The organism record Phase 1 writes for GCA_000001.1 into a FungiDB whose tfakST1 is the species' reference and the family's representative. */
export const PHASE1_RECORD = {
  schemaVersion: 1, checkedAgainst: 'origin/rebuild02', organismFullName: 'Testus fakeus ST-1', organismNameForFiles: 'TfakeusST-1',
  strainAbbrev: 'ST-1', speciesNcbiTaxonId: '999000', hasTemporaryNcbiTaxonId: 'false', genomeSource: 'GenBank', genomeVersion: '2024-03-05',
  isAnnotatedGenome: 'true', taxonFilterForNRProteinsAlignedToGenome: 'Testus', isReferenceStrain: 'false',
  referenceStrainOrganismAbbrev: 'tfakST1', familyRepOrganismAbbrev: 'tfakST1'
};

/**
 * GCA_000001.1 as Phase 1 leaves it, in a new temp dir: no entries and a version 1 organism record. record overrides
 * record fields; report overrides fields of the assembly report, which gains a total sequence length of 12 Mb.
 */
export function genomeProposal({ record = {}, report = {} } = {}) {
  const dir = join(mkdtempSync(join(tmpdir(), 'genome-proposal-')), ACCESSION);
  cpSync(join(fixtures, 'proposals', ACCESSION), dir, { recursive: true });
  editJson(join(dir, 'inputs', `${ACCESSION}_dataset_report.json`), (r) => ({
    reports: [{ ...r.reports[0], assembly_stats: { ...r.reports[0].assembly_stats, total_sequence_length: '12000000' }, ...report }]
  }));
  writeFileSync(join(dir, 'curated', 'organism.json'), JSON.stringify({ ...PHASE1_RECORD, ...record }, null, 2) + '\n');
  writeFileSync(join(dir, 'curated', 'datasets.json'), JSON.stringify({ schemaVersion: 2, datasets: [] }, null, 2) + '\n');
  return { dir, manifest: JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf-8')) };
}
```

- [ ] **Step 2: Write the failing tests.**

`tests/genome-record-version.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { GENERATOR } from '../shared/scripts/genome/record.js';

const repoVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8')).version;

test('the generator version is the package version, from shared/scripts and from a skill copy', async () => {
  assert.equal(GENERATOR.version, repoVersion);
  const root = mkdtempSync(join(tmpdir(), 'plugin-'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '9.9.9', type: 'module' }));
  const copy = join(root, 'skills/verify-genome/scripts/genome');
  mkdirSync(copy, { recursive: true });
  cpSync(fileURLToPath(new URL('../shared/scripts/genome/record.js', import.meta.url)), join(copy, 'record.js'));
  const { GENERATOR: fromSkill } = await import(pathToFileURL(join(copy, 'record.js')).href);
  assert.equal(fromSkill.version, '9.9.9');
});
```

`tests/genome-preprocess.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { readPreprocessed, preprocessedProblems } from '../shared/scripts/dataset-types/genome-assembly/preprocess.js';
import { genomeWorkArea, editJson, ACCESSION, FETCH_URLS } from './genome-work-area.js';

const shaOf = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const RERUN_TRIAL = 'the data loader runs genome-pipeline.js trial --undo, then trial';

test('readPreprocessed reads the four records and the sha256 of the three a delivery depends on', () => {
  const workArea = genomeWorkArea();
  const records = readPreprocessed(workArea);
  assert.equal(records.genomeBuild.accession, ACCESSION);
  assert.equal(records.trial.result, 'passed');
  assert.equal(records.functional.datasets.length, 4);
  assert.equal(records.fetch.files.gff.url, FETCH_URLS.gff);
  assert.deepEqual(records.sha256, {
    genomeBuild: shaOf(join(workArea, 'genome-build.json')),
    trial: shaOf(join(workArea, 'trial/trial.json')),
    functional: shaOf(join(workArea, 'functional.json'))
  });
});

test('readPreprocessed refuses a missing record, naming the file and the step that writes it', () => {
  for (const [file, message] of [
    ['genome-build.json', /genome-build\.json: is missing\nNext: run finalize first/],
    ['trial/trial.json', /trial\/trial\.json: is missing\nNext: the data loader runs genome-pipeline\.js trial/],
    ['functional.json', /functional\.json: is missing\nNext: run functional/],
    ['fetch/fetch.json', /fetch\/fetch\.json: is missing\nNext: run genome-pipeline\.js fetch/]
  ]) {
    const workArea = genomeWorkArea();
    rmSync(join(workArea, file));
    assert.throws(() => readPreprocessed(workArea), message, file);
  }
});

test('readPreprocessed refuses an unknown schema version and an incomplete fetch record', () => {
  for (const [file, message] of [
    ['genome-build.json', /has schemaVersion 9, not 1/],
    ['trial/trial.json', /has schemaVersion 9, not 2/],
    ['functional.json', /has schemaVersion 9, not 1/]
  ]) {
    const workArea = genomeWorkArea();
    editJson(join(workArea, file), (r) => ({ ...r, schemaVersion: 9 }));
    assert.throws(() => readPreprocessed(workArea), message, file);
  }
  const workArea = genomeWorkArea();
  editJson(join(workArea, 'fetch/fetch.json'), (r) => ({ ...r, files: { gff: r.files.gff } }));
  assert.throws(() => readPreprocessed(workArea), /fetch\.json: is incomplete: it needs files\.gff, files\.fasta and files\.report with their url/);
});

const problemsOf = (workArea) => preprocessedProblems(readPreprocessed(workArea), workArea);

test('a fresh work area, or one whose trial rows were kept, has no problems', () => {
  assert.deepEqual(problemsOf(genomeWorkArea()), []);
  assert.deepEqual(problemsOf(genomeWorkArea({ trial: { undone: false, kept: true } })), []);
});

test('a trial that did not pass, or ran on another build, is a problem', () => {
  assert.deepEqual(problemsOf(genomeWorkArea({ trial: { result: 'failed' } })), [`trial/trial.json: the trial result is "failed", not "passed"; ${RERUN_TRIAL}`]);
  assert.deepEqual(problemsOf(genomeWorkArea({ trial: { genomeBuild: { sha256: 'old' } } })), [`trial/trial.json is for an older genome-build.json; ${RERUN_TRIAL}`]);
  assert.deepEqual(problemsOf(genomeWorkArea({ trial: { undone: false } })), ['trial/trial.json: the trial rows are neither undone nor kept; the data loader runs genome-pipeline.js trial --undo']);
});

test('a final file the trial did not load, or a transcriptInfoAndIds it did not produce, is a problem', () => {
  const edited = genomeWorkArea();
  appendFileSync(join(edited, 'final/primary_chromosome/genome.gff'), '#\n');
  appendFileSync(join(edited, 'final/secondary_contig/transcriptInfoAndIds'), 'x\n');
  assert.deepEqual(problemsOf(edited), [
    `final/primary_chromosome/genome.gff is not the file the trial loaded; ${RERUN_TRIAL}`,
    `final/secondary_contig/transcriptInfoAndIds is not the file the trial produced; ${RERUN_TRIAL}`
  ]);
  assert.deepEqual(problemsOf(genomeWorkArea({ trial: { outputs: {} } })), [
    `trial/trial.json records no transcriptInfoAndIds for primary_chromosome; ${RERUN_TRIAL}`,
    `trial/trial.json records no transcriptInfoAndIds for secondary_contig; ${RERUN_TRIAL}`
  ]);
});

test('a stale functional.json is a problem', () => {
  const edited = genomeWorkArea();
  appendFileSync(join(edited, 'final/function/productNames/GenBank/products.txt'), 'x\ty\t1\n');
  assert.deepEqual(problemsOf(edited), ['final/function/productNames/GenBank/products.txt does not match functional.json; run genome-pipeline.js functional again']);
  const older = genomeWorkArea();
  editJson(join(older, 'functional.json'), (r) => ({ ...r, genomeBuild: { sha256: 'old' } }));
  assert.deepEqual(problemsOf(older), ['functional.json is for an older genome-build.json; run genome-pipeline.js functional again']);
});
```

- [ ] **Step 3: Run** `node --test --test-reporter=dot --test-global-setup=W/tests/globalSetup.js W/tests/genome-record-version.test.js W/tests/genome-preprocess.test.js`; expect FAIL (`preprocess.js` not found; the skill copy cannot read `skills/package.json`).

- [ ] **Step 4: Implement.**

In `shared/scripts/genome/record.js`, replace the `GENERATOR` definition with:

```js
/** package.json is three levels up from shared/scripts/genome and four from skills/<name>/scripts/genome. */
function packageVersion() {
  for (const rel of ['../../../package.json', '../../../../package.json']) {
    try {
      return JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf-8')).version;
    } catch { /* try the next location */ }
  }
  throw new Error('Cannot read package.json; run genome-pipeline.js from shared/scripts or from a skill');
}

export const GENERATOR = Object.freeze({ name: 'dataset-curator genome-pipeline', version: packageVersion() });
```

`shared/scripts/dataset-types/genome-assembly/preprocess.js`:

```js
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { sha256File } from '../../lib/file-hash.js';
import { readGenomeBuild, partitionName } from '../../genome/genome-build.js';
import { PipelineError, readJson, workPaths } from '../../genome/workdir.js';
import { readTrialRecord, trialPaths } from '../../genome/trial/record.js';
import { checkFunctionalCurrent, functionalPaths, readFunctionalRecord } from '../../genome/functional/record.js';

const COMMAND = 'verify';
const RERUN_TRIAL = 'the data loader runs genome-pipeline.js trial --undo, then trial';

function readFetchRecord(workArea) {
  const { fetchJson } = workPaths(workArea);
  const record = readJson(fetchJson, COMMAND, 'run genome-pipeline.js fetch');
  if (!['gff', 'fasta', 'report'].every((role) => typeof record?.files?.[role]?.url === 'string')) {
    throw new PipelineError(COMMAND, fetchJson, 'is incomplete: it needs files.gff, files.fasta and files.report with their url', 'delete fetch/fetch.json and run fetch again');
  }
  return record;
}

/**
 * The work area's records, each refused when missing or of an unknown schema version:
 * { genomeBuild, trial, functional, fetch, sha256: { genomeBuild, trial, functional } }.
 */
export function readPreprocessed(workArea) {
  const { build: genomeBuild, sha256: genomeBuildSha } = readGenomeBuild(workArea, COMMAND);
  const { trialJson } = trialPaths(workArea);
  const trial = readTrialRecord(trialJson);
  if (!trial) throw new PipelineError(COMMAND, trialJson, 'is missing', 'the data loader runs genome-pipeline.js trial');
  const functional = readFunctionalRecord(workArea, COMMAND);
  const fetch = readFetchRecord(workArea);
  return {
    genomeBuild, trial, functional, fetch,
    sha256: { genomeBuild: genomeBuildSha, trial: sha256File(trialJson), functional: sha256File(functionalPaths(workArea).functionalJson) }
  };
}

/** What makes the work area undeliverable, each with the step that fixes it; the records validator and the delivery hook both use it. */
export function preprocessedProblems(records, workArea) {
  const { genomeBuild, trial, functional, sha256 } = records;
  const problems = [];
  if (trial.result !== 'passed') problems.push(`trial/trial.json: the trial result is "${trial.result}", not "passed"; ${RERUN_TRIAL}`);
  if (trial.genomeBuild.sha256 !== sha256.genomeBuild) problems.push(`trial/trial.json is for an older genome-build.json; ${RERUN_TRIAL}`);
  for (const part of genomeBuild.partitions) {
    const name = partitionName(part);
    const loaded = trial.loaded[name] ?? {};
    for (const [key, file] of Object.entries(part.final).filter(([, f]) => f)) {
      const path = join(part.dir, file);
      if (loaded[key] !== sha256File(join(workArea, path))) problems.push(`${path} is not the file the trial loaded; ${RERUN_TRIAL}`);
    }
    const produced = trial.outputs[name] ?? {};
    if (part.featureCount > 0 && !Object.keys(produced).length) problems.push(`trial/trial.json records no transcriptInfoAndIds for ${name}; ${RERUN_TRIAL}`);
    for (const [file, digest] of Object.entries(produced)) {
      const path = join(part.dir, file);
      const at = join(workArea, path);
      if (!existsSync(at) || sha256File(at) !== digest) problems.push(`${path} is not the file the trial produced; ${RERUN_TRIAL}`);
    }
  }
  problems.push(...checkFunctionalCurrent(functional, workArea, sha256.genomeBuild).map((p) => `${p}; run genome-pipeline.js functional again`));
  if (!trial.undone && !trial.kept) problems.push('trial/trial.json: the trial rows are neither undone nor kept; the data loader runs genome-pipeline.js trial --undo');
  return problems;
}
```

- [ ] **Step 5: Run** `node --test --test-reporter=dot --test-global-setup=W/tests/globalSetup.js W/tests/genome-record-version.test.js W/tests/genome-preprocess.test.js W/tests/genome-build-record.test.js W/tests/import-graph.test.js`; expect PASS.

- [ ] **Step 6: Commit.**
  `git -C W add shared/scripts/genome/record.js shared/scripts/dataset-types/genome-assembly/preprocess.js tests/genome-work-area.js tests/genome-record-version.test.js tests/genome-preprocess.test.js`
  `git -C W commit -m "Read a genome work area's records and what makes them undeliverable"` (with the trailer).

---

### Task 3: The amendment: entries, constants and organism props

**Files:**
- Create: `shared/scripts/dataset-types/genome-assembly/entries.js`, `shared/scripts/dataset-types/genome-assembly/amendment.js`
- Modify: `shared/scripts/dataset-types/_common.js` (`ORGANISM_RECORD_KEYS`), `shared/scripts/dataset-types/genome-assembly.js`
- Modify: `tests/genome-work-area.js` (add `amendedProposal`), `package.json` (`sharedFiles`)
- Create: `tests/genome-amendment.test.js`

- [ ] **Step 1: Add the amended-proposal helper** — append to `tests/genome-work-area.js` (and add `import * as genome from '../shared/scripts/dataset-types/genome-assembly.js';` to its imports):

```js
/** genomeProposal with preprocessedAmendment's output from workArea written into it, as amend-proposal.js writes it. */
export function amendedProposal(workArea, { given = { orthomclAbbrev: 'tfak' }, ...options } = {}) {
  const { dir, manifest } = genomeProposal(options);
  const amendment = genome.preprocessedAmendment({ workArea, proposalDir: dir, manifest, given });
  editJson(join(dir, 'curated', 'organism.json'), (r) => ({ ...r, ...amendment.organism, schemaVersion: 2, constants: { ...r.constants, ...amendment.constants } }));
  writeFileSync(join(dir, 'curated', 'datasets.json'), JSON.stringify({ schemaVersion: 2, datasets: amendment.entries }, null, 2) + '\n');
  return { dir, manifest, amendment };
}
```

- [ ] **Step 2: Write the failing tests** — `tests/genome-amendment.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as genome from '../shared/scripts/dataset-types/genome-assembly.js';
import { assertValidEntries } from '../shared/scripts/dataset-types/_common.js';
import { entriesFrom, FUNCTIONAL_DEFAULTS } from '../shared/scripts/dataset-types/genome-assembly/entries.js';
import { readPreprocessed } from '../shared/scripts/dataset-types/genome-assembly/preprocess.js';
import { parseDatasetClass, IDENTITY_PROPS } from '../shared/scripts/lib/dataset-classes.js';
import { fixtures } from './helpers.js';
import { genomeWorkArea, genomeProposal, amendedProposal, editJson, FETCH_URLS, PARTITIONS } from './genome-work-area.js';

const classes = readFileSync(join(fixtures, 'classes.xml'), 'utf-8');
const classOf = (className) => parseDatasetClass(classes, className);
const amend = (workArea, { given = { orthomclAbbrev: 'tfak' }, ...options } = {}) => {
  const { dir, manifest } = genomeProposal(options);
  return genome.preprocessedAmendment({ workArea, proposalDir: dir, manifest, given });
};
const SEQUENCE_SOURCE = { type: 'url', urls: [FETCH_URLS.fasta, FETCH_URLS.report] };
const GFF_SOURCE = { type: 'url', urls: [FETCH_URLS.gff] };

test('entriesFrom gives sequences, then features where ISF loads anything, then the functional datasets', () => {
  const entries = entriesFrom(readPreprocessed(genomeWorkArea()));
  assert.deepEqual(entries.map((e) => [e.datasetClass, e.name, e.version]), [
    ['fasta_primary_genome_sequence', '$$genomeSource$$', '$$genomeVersion$$'],
    ['fasta_secondary_genome', '$$genomeSource$$', '$$genomeVersion$$'],
    ['fasta_organelle_genome', '$$genomeSource$$', '$$genomeVersion$$'],
    ['NoPreprocess_primary_genome_features', '$$genomeSource$$', '$$genomeVersion$$'],
    ['NoPreprocess_secondary_genome_features', '$$genomeSource$$', '$$genomeVersion$$'],
    ['productNames', 'GenBank', '$$functAnnotVersion$$'],
    ['geneName', 'GenBank', '$$functAnnotVersion$$'],
    ['dbxref_simple', 'uniprot_from_annotation', '$$functAnnotVersion$$'],
    ['dbxref_simple', 'ensemblgenomes_gn_from_annotation', '$$functAnnotVersion$$']
  ]);
  assert.deepEqual(entries[0], {
    datasetClass: 'fasta_primary_genome_sequence', name: '$$genomeSource$$', version: '$$genomeVersion$$',
    props: { ncbiTaxonId: '$$ncbiTaxonId$$', table: 'DoTS::ExternalNASequence', soTerm: 'chromosome', sourceIdRegex: '^>(\\S+)', releaseDate: '' },
    source: SEQUENCE_SOURCE
  });
  assert.deepEqual(entries[1].props, { ncbiTaxonId: '$$ncbiTaxonId$$', table: 'DoTS::ExternalNASequence', soTerm: 'contig', sourceIdRegex: '^>(\\S+)' });
  assert.deepEqual(entries[2].props, { ncbiTaxonId: '$$ncbiTaxonId$$', table: 'DoTS::ExternalNASequence', soTerm: 'mitochondrial_chromosome', sourceIdRegex: '^>(\\S+)', organelle: 'mitochondrion' });
  assert.deepEqual(entries[3].props, { ncbiTaxonId: '$$ncbiTaxonId$$', soTerm: 'chromosome', source: '$$genomeSource$$', mapFile: 'genemRNAExonCDS2Gus.xml' });
  assert.deepEqual(entries[4].props, { ncbiTaxonId: '$$ncbiTaxonId$$', soTerm: 'contig', mapFile: 'genemRNAExonCDS2Gus.xml' });
  assert.deepEqual(entries[3].source, GFF_SOURCE);
  assert.deepEqual(entries[5].props, {});
  assert.deepEqual(entries[6].props, { genomeVersion: '$$genomeVersion$$' });
  assert.deepEqual(entries[7].props, {
    columnSpec: 'primary_identifier', target: 'NAFeature', url: 'http://www.uniprot.org/uniprot/EXTERNAL_ID_HERE', urlUsesSecondaryId: 'false',
    genomeVersion: '$$genomeVersion$$', viewName: 'Transcript'
  });
  assert.equal(entries[8].props.url, '');
  assert.equal(entries[8].props.viewName, 'GeneFeature');
  assert.deepEqual(entries[8].source, GFF_SOURCE);
});

test('each functional default names exactly its class\'s props other than identity', () => {
  for (const [className, defaults] of Object.entries(FUNCTIONAL_DEFAULTS)) {
    assert.deepEqual(Object.keys(defaults).sort(), classOf(className).props.filter((p) => !IDENTITY_PROPS.includes(p)).sort(), className);
  }
});

test('an amended proposal validates against classes.xml', () => {
  const { dir, manifest } = amendedProposal(genomeWorkArea());
  assert.equal(assertValidEntries(dir, manifest, genome, { classOf }).length, 9);
});

test('preprocessedAmendment derives the constants and organism props, each with its source', () => {
  const a = amend(genomeWorkArea());
  assert.deepEqual(a.constants, { genomeSource: 'GenBank', genomeVersion: '2024-03-05', functAnnotVersion: '2024-04-01' });
  assert.deepEqual(a.organism, {
    annotationIncludesTRNAs: 'true', maxIntronSize: '1000', isHugeGenome: 'false', isNotEbiGenome: 'true', isCore: 'false', runExportPred: 'false',
    isFamilyRepresentative: 'false', familyNcbiTaxonIds: '', familyNameForFiles: '', orthomclAbbrev: 'tfak'
  });
  assert.equal(a.entries.length, 9);
  assert.equal(a.sources['constants.genomeVersion'], 'curated/organism.json genomeVersion');
  assert.equal(a.sources['constants.functAnnotVersion'], 'report annotation_info.release_date');
  assert.equal(a.sources['organism.annotationIncludesTRNAs'], 'genome-build.json featureTypes: 1 tRNA');
  assert.equal(a.sources['organism.maxIntronSize'], 'genome-build.json maxIntron 599, rounded up to a multiple of 500, at least 1000');
  assert.equal(a.sources['organism.isHugeGenome'], 'report assembly_stats.total_sequence_length 12000000');
  assert.equal(a.sources['organism.isCore'], 'rule');
  assert.equal(a.sources['organism.isFamilyRepresentative'], 'curated/organism.json familyRepOrganismAbbrev "tfakST1"');
  assert.equal(a.sources['organism.orthomclAbbrev'], 'given (--organism orthomclAbbrev)');
});

test('derived props follow the build and the report', () => {
  const primaryWith = (over) => PARTITIONS.map((p, i) => (i === 0 ? { ...p, ...over } : p));
  const plain = amend(genomeWorkArea({ partitions: primaryWith({ featureTypes: { exon: 2, gene: 2, mRNA: 1 }, maxIntron: 1234 }) }));
  assert.equal(plain.organism.annotationIncludesTRNAs, 'false');
  assert.equal(plain.organism.maxIntronSize, '1500');
  assert.equal(amend(genomeWorkArea(), { report: { assembly_stats: { total_sequence_length: '1000000001' } } }).organism.isHugeGenome, 'true');
  const undated = amend(genomeWorkArea(), { report: { annotation_info: undefined } });
  assert.equal(undated.constants.functAnnotVersion, '2024-03-05');
  assert.equal(undated.sources['constants.functAnnotVersion'], 'genomeVersion (the report has no annotation_info.release_date)');
});

test('a given value overrides anything, and the record keeps the values it was asked for', () => {
  const workArea = genomeWorkArea();
  const given = amend(workArea, { given: { orthomclAbbrev: 'tfak', isCore: 'true', maxIntronSize: '5000' } });
  assert.equal(given.organism.isCore, 'true');
  assert.equal(given.organism.maxIntronSize, '5000');
  assert.equal(given.sources['organism.isCore'], 'given (--organism isCore)');
  const kept = amend(workArea, { given: {}, record: { orthomclAbbrev: 'tfkp', familyNameForFiles: 'Testaceae' } });
  assert.equal(kept.organism.orthomclAbbrev, 'tfkp');
  assert.equal(kept.organism.familyNameForFiles, 'Testaceae');
  assert.equal(kept.sources['organism.orthomclAbbrev'], 'curated/organism.json');
});

test('preprocessedAmendment refuses organism props it cannot settle, naming the fix', () => {
  const workArea = genomeWorkArea();
  assert.throws(() => amend(workArea, { given: {} }), /orthomclAbbrev is never derived; pass --organism orthomclAbbrev=<4 to 8 lowercase letters>/);
  assert.throws(() => amend(workArea, { given: { orthomclAbbrev: 'tfak', colour: 'red' } }), /--organism takes annotationIncludesTRNAs, .*; not colour/);
  assert.throws(() => amend(workArea, { record: { familyRepOrganismAbbrev: '' } }),
    /this organism represents its family; pass --organism familyNcbiTaxonIds=<taxon ids> and --organism familyNameForFiles=<name>/);
  const rep = amend(workArea, { record: { familyRepOrganismAbbrev: 'tfakST-1' }, given: { orthomclAbbrev: 'tfak', familyNcbiTaxonIds: '999000', familyNameForFiles: 'Testus' } });
  assert.equal(rep.organism.isFamilyRepresentative, 'true');
  assert.throws(() => amend(workArea, { report: { assembly_stats: {} } }), /no assembly_stats\.total_sequence_length; pass --organism isHugeGenome=true or false/);
  assert.throws(() => amend(workArea, { record: { isAnnotatedGenome: 'false' } }),
    /GCA_000001\.1 has annotation source "none"; genome preprocessing builds entries from the GenBank or RefSeq annotation only/);
});

test('preprocessedAmendment refuses an undeliverable work area, another accession\'s, an older finalize and an unknown functional class', () => {
  assert.throws(() => amend(genomeWorkArea({ trial: { result: 'failed' } })), /cannot amend GCA_000001\.1:\n  - trial\/trial\.json: the trial result is "failed"/);
  const other = genomeWorkArea();
  editJson(join(other, 'genome-build.json'), (b) => ({ ...b, accession: 'GCA_000002.1' }));
  assert.throws(() => amend(other), /holds GCA_000002\.1, not GCA_000001\.1/);
  const older = genomeWorkArea({ partitions: PARTITIONS.map(({ featureTypes, maxIntron, ...p }) => p) });
  assert.throws(() => amend(older), /genome-build\.json has no featureTypes or maxIntron/);
  const unknown = genomeWorkArea({ functionalDatasets: [{ datasetClass: 'ECAssocGeneFeatureMappings', name: 'GenBank', file: 'ec.txt', level: 'gene', text: 'TST_0010\t1.1.1.1\n', props: {} }] });
  assert.throws(() => amend(unknown), /functional\.json has a ECAssocGeneFeatureMappings dataset, which has no defaults/);
});
```

- [ ] **Step 3: Run** `node --test --test-reporter=dot --test-global-setup=W/tests/globalSetup.js W/tests/genome-amendment.test.js`; expect FAIL (modules not found).

- [ ] **Step 4: Implement.**

In `shared/scripts/dataset-types/_common.js`, replace the `ORGANISM_RECORD_KEYS` definition with:

```js
/** Organism props preprocessing adds (amend-proposal.js); a record holding them is schema version 2. */
export const AMENDED_ORGANISM_KEYS = [
  'annotationIncludesTRNAs', 'maxIntronSize', 'isHugeGenome', 'isNotEbiGenome', 'isCore', 'runExportPred',
  'isFamilyRepresentative', 'familyNcbiTaxonIds', 'familyNameForFiles', 'orthomclAbbrev'
];
/** The curated organism record of a genome proposal; curators override these under "organism". */
export const ORGANISM_RECORD_KEYS = [
  'organismFullName', 'organismNameForFiles', 'strainAbbrev', 'speciesNcbiTaxonId', 'hasTemporaryNcbiTaxonId',
  'genomeSource', 'genomeVersion', 'isAnnotatedGenome', 'taxonFilterForNRProteinsAlignedToGenome',
  'isReferenceStrain', 'referenceStrainOrganismAbbrev', 'familyRepOrganismAbbrev', ...AMENDED_ORGANISM_KEYS
];
```

`shared/scripts/dataset-types/genome-assembly/entries.js`:

```js
export const MAP_FILE = 'genemRNAExonCDS2Gus.xml';
const SOURCE_ID_REGEX = '^>(\\S+)';
const GENOME_SOURCE = '$$genomeSource$$';
const GENOME_VERSION = '$$genomeVersion$$';
const SEQUENCE_CLASS = { primary: 'fasta_primary_genome_sequence', secondary: 'fasta_secondary_genome', organelle: 'fasta_organelle_genome' };
const FEATURES_CLASS = {
  primary: 'NoPreprocess_primary_genome_features', secondary: 'NoPreprocess_secondary_genome_features', organelle: 'NoPreprocess_organelle_genome_features'
};

export const isSequenceClass = (datasetClass) => Object.values(SEQUENCE_CLASS).includes(datasetClass);
export const isFeaturesClass = (datasetClass) => Object.values(FEATURES_CLASS).includes(datasetClass);
/** primary, secondary or organelle for a sequence or features class; undefined for any other. */
export const roleOf = (datasetClass) => Object.keys(SEQUENCE_CLASS).find((role) => SEQUENCE_CLASS[role] === datasetClass || FEATURES_CLASS[role] === datasetClass);

/** Each functional class's props other than identity, with the value used when functional.json gives none. */
export const FUNCTIONAL_DEFAULTS = {
  productNames: {},
  GeneOntologyAssociations: {},
  EnzymeCommissionAssociations: {},
  dbxref_synonym: {},
  comments: {},
  geneName: { genomeVersion: GENOME_VERSION },
  aliases: {
    columnSpec: 'primary_identifier', url: 'http://www.ncbi.nlm.nih.gov/protein/EXTERNAL_ID_HERE', urlUsesSecondaryId: 'false',
    target: 'NAFeature', idType: 'alternate id', viewName: 'Transcript'
  },
  dbxref_simple: { columnSpec: 'primary_identifier', target: 'NAFeature', url: '', urlUsesSecondaryId: 'false', genomeVersion: GENOME_VERSION, viewName: 'GeneFeature' }
};

function sequenceEntry(part, urls) {
  const props = {
    ncbiTaxonId: '$$ncbiTaxonId$$', table: 'DoTS::ExternalNASequence', soTerm: part.soTerm, sourceIdRegex: SOURCE_ID_REGEX,
    ...(part.role === 'primary' ? { releaseDate: '' } : {}),
    ...(part.role === 'organelle' ? { organelle: part.organelle } : {})
  };
  return { datasetClass: SEQUENCE_CLASS[part.role], name: GENOME_SOURCE, version: GENOME_VERSION, props, source: { type: 'url', urls } };
}

function featuresEntry(part, urls) {
  const props = { ncbiTaxonId: '$$ncbiTaxonId$$', soTerm: part.soTerm, ...(part.role === 'primary' ? { source: GENOME_SOURCE } : {}), mapFile: MAP_FILE };
  return { datasetClass: FEATURES_CLASS[part.role], name: GENOME_SOURCE, version: GENOME_VERSION, props, source: { type: 'url', urls } };
}

function functionalEntry(dataset, urls) {
  const defaults = FUNCTIONAL_DEFAULTS[dataset.datasetClass];
  if (!defaults) throw new Error(`functional.json has a ${dataset.datasetClass} dataset, which has no defaults in genome-assembly/entries.js`);
  const props = Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, dataset.props?.[key] ?? value]));
  return { datasetClass: dataset.datasetClass, name: dataset.name, version: '$$functAnnotVersion$$', props, source: { type: 'url', urls } };
}

/** The dataset entries a work area's records give: sequences, then features where ISF loads anything, then functional datasets. */
export function entriesFrom(records) {
  const { files } = records.fetch;
  const partitions = records.genomeBuild.partitions;
  return [
    ...partitions.map((part) => sequenceEntry(part, [files.fasta.url, files.report.url])),
    ...partitions.filter((part) => part.featureCount > 0).map((part) => featuresEntry(part, [files.gff.url])),
    ...records.functional.datasets.map((dataset) => functionalEntry(dataset, [files.gff.url]))
  ];
}

/** The partition a sequence or features entry loads: its role and soTerm, and its organelle when it names one; else null. */
export function partitionOf(entry, partitions) {
  const role = roleOf(entry.datasetClass);
  return partitions.find((p) => p.role === role && p.soTerm === entry.props.soTerm
    && (entry.props.organelle === undefined || p.organelle === entry.props.organelle)) ?? null;
}
```

`shared/scripts/dataset-types/genome-assembly/amendment.js`:

```js
import { readCuratedJson, readInputJson, ORGANISM_RECORD_FILENAME, AMENDED_ORGANISM_KEYS } from '../_common.js';
import { entriesFrom } from './entries.js';
import { preprocessedProblems, readPreprocessed } from './preprocess.js';

export const ORGANISM_RECORD_SCHEMA_VERSION = 2;
const HUGE_GENOME = 1_000_000_000;
const RULES = { isNotEbiGenome: 'true', isCore: 'false', runExportPred: 'false' };
const ASKED = ['familyNcbiTaxonIds', 'familyNameForFiles', 'orthomclAbbrev'];

export const reportOf = (proposalDir, manifest) => readInputJson(proposalDir, `${manifest.accession}_dataset_report.json`).reports?.[0] ?? {};

/** The constants the entries reference: the genome's source and version from the record, the annotation's date from the report. */
export function constantsFrom(record, report) {
  const released = report.annotation_info?.release_date;
  return {
    constants: { genomeSource: record.genomeSource, genomeVersion: record.genomeVersion, functAnnotVersion: released || record.genomeVersion },
    sources: {
      genomeSource: 'curated/organism.json genomeSource',
      genomeVersion: 'curated/organism.json genomeVersion',
      functAnnotVersion: released ? 'report annotation_info.release_date' : 'genomeVersion (the report has no annotation_info.release_date)'
    }
  };
}

/** Each amended prop as [value, source]: derived from the build or the report, by rule, kept from the record, or given. */
function organismFrom({ records, record, report, proposed, given }) {
  const problems = [];
  const parts = records.genomeBuild.partitions;
  if (parts.some((p) => p.featureTypes === undefined || p.maxIntron === undefined)) {
    problems.push('genome-build.json has no featureTypes or maxIntron (an older finalize wrote it); run genome-pipeline.js finalize, trial and functional again');
  }
  const tRNAs = parts.reduce((n, p) => n + (p.featureTypes?.tRNA ?? 0), 0);
  const longest = Math.max(0, ...parts.map((p) => p.maxIntron ?? 0));
  const total = Number(report.assembly_stats?.total_sequence_length);
  const rep = record.familyRepOrganismAbbrev ?? '';
  const values = {
    annotationIncludesTRNAs: [String(tRNAs > 0), `genome-build.json featureTypes: ${tRNAs} tRNA`],
    maxIntronSize: [String(Math.max(1000, Math.ceil(longest / 500) * 500)), `genome-build.json maxIntron ${longest}, rounded up to a multiple of 500, at least 1000`],
    ...(total > 0 ? { isHugeGenome: [String(total > HUGE_GENOME), `report assembly_stats.total_sequence_length ${total}`] } : {}),
    ...Object.fromEntries(Object.entries(RULES).map(([k, v]) => [k, [v, 'rule']])),
    isFamilyRepresentative: [String(!rep || rep === proposed), `curated/organism.json familyRepOrganismAbbrev "${rep}"`],
    ...Object.fromEntries(ASKED.filter((k) => typeof record[k] === 'string').map((k) => [k, [record[k], 'curated/organism.json']])),
    ...Object.fromEntries(Object.entries(given).map(([k, v]) => [k, [v, `given (--organism ${k})`]]))
  };
  for (const k of ['familyNcbiTaxonIds', 'familyNameForFiles']) values[k] ??= ['', 'not given'];
  if (!values.isHugeGenome) problems.push('the assembly report has no assembly_stats.total_sequence_length; pass --organism isHugeGenome=true or false');
  if (!values.orthomclAbbrev) problems.push('orthomclAbbrev is never derived; pass --organism orthomclAbbrev=<4 to 8 lowercase letters>');
  if (values.isFamilyRepresentative[0] === 'true' && !(values.familyNcbiTaxonIds[0] && values.familyNameForFiles[0])) {
    problems.push('this organism represents its family; pass --organism familyNcbiTaxonIds=<taxon ids> and --organism familyNameForFiles=<name>');
  }
  const settled = AMENDED_ORGANISM_KEYS.filter((k) => values[k]);
  return {
    organism: Object.fromEntries(settled.map((k) => [k, values[k][0]])),
    sources: Object.fromEntries(settled.map((k) => [k, values[k][1]])),
    problems
  };
}

const prefixed = (prefix, sources) => Object.fromEntries(Object.entries(sources).map(([k, v]) => [`${prefix}.${k}`, v]));

/**
 * What amend-proposal.js writes: { entries, constants, organism, sources } from the work area's records and the proposal's
 * organism record and assembly report; sources names where each constant and organism prop came from. Refuses an unknown
 * --organism key, a non-GenBank annotation, another accession's or an undeliverable work area, and props it cannot settle.
 */
export function preprocessedAmendment({ workArea, proposalDir, manifest, given = {}, annotation }) {
  const unknown = Object.keys(given).filter((k) => !AMENDED_ORGANISM_KEYS.includes(k));
  if (unknown.length) throw new Error(`--organism takes ${AMENDED_ORGANISM_KEYS.join(', ')}; not ${unknown.join(', ')}`);
  if (annotation.source !== 'genbank') {
    throw new Error(`${manifest.accession} has annotation source "${annotation.source}"; genome preprocessing builds entries from the GenBank or RefSeq annotation only`);
  }
  const records = readPreprocessed(workArea);
  if (records.genomeBuild.accession !== manifest.accession) throw new Error(`The work area ${workArea} holds ${records.genomeBuild.accession}, not ${manifest.accession}`);
  const problems = preprocessedProblems(records, workArea);
  if (problems.length) throw new Error(`The work area ${workArea} cannot amend ${manifest.accession}:\n  - ${problems.join('\n  - ')}`);
  const record = readCuratedJson(proposalDir, ORGANISM_RECORD_FILENAME);
  const report = reportOf(proposalDir, manifest);
  const organism = organismFrom({ records, record, report, proposed: manifest.organisms[0].proposedOrganismAbbrev, given });
  if (organism.problems.length) throw new Error(`The organism record of ${manifest.accession} cannot be amended:\n  - ${organism.problems.join('\n  - ')}`);
  const constants = constantsFrom(record, report);
  return {
    entries: entriesFrom(records),
    constants: constants.constants,
    organism: organism.organism,
    sources: { ...prefixed('constants', constants.sources), ...prefixed('organism', organism.sources) }
  };
}
```

In `shared/scripts/dataset-types/genome-assembly.js`:

- Add the import `import { preprocessedAmendment as amendmentOf, ORGANISM_RECORD_SCHEMA_VERSION } from './genome-assembly/amendment.js';`.
- Replace `export const ORGANISM_RECORD_SCHEMA_VERSION = 1;` with:

```js
export { ORGANISM_RECORD_SCHEMA_VERSION };
/** Phase 1 writes the record without the props preprocessing adds; amend-proposal.js raises it to ORGANISM_RECORD_SCHEMA_VERSION. */
const PHASE1_RECORD_SCHEMA_VERSION = 1;
```

- In `deriveOrganismRecord`, change `schemaVersion: ORGANISM_RECORD_SCHEMA_VERSION,` to `schemaVersion: PHASE1_RECORD_SCHEMA_VERSION,`.
- After `annotationOf`, add:

```js
/** amend-proposal.js: the work area's entries, constants and organism props for this proposal (genome-assembly/amendment.js). */
export const preprocessedAmendment = (args) => amendmentOf({ ...args, annotation: annotationOf(args.proposalDir) });
```

- [ ] **Step 5: Register the shared files.** In `package.json` `sharedFiles`:
  - Add these entries, each listing `"propose-genome-assembly", "propose-bulk-rnaseq", "propose-dnaseq", "propose-chipseq", "load-proposals", "verify-bulk-rnaseq"`: `scripts/dataset-types/genome-assembly/amendment.js`, `scripts/dataset-types/genome-assembly/entries.js`, `scripts/dataset-types/genome-assembly/preprocess.js`, `scripts/genome/genome-build.js`, `scripts/genome/record.js`, `scripts/genome/workdir.js`, `scripts/genome/trial/record.js`, `scripts/genome/trial/gus.js`, `scripts/genome/functional/record.js`.
  - Add `"propose-genome-assembly", "propose-bulk-rnaseq", "propose-dnaseq", "propose-chipseq"` to the lists of `scripts/lib/file-hash.js` and `scripts/lib/tools/exec.js`.
  Then run `node W/bin/sync-shared.js` (expect `0 errors`).

- [ ] **Step 6: Run** `node --test --test-reporter=dot --test-global-setup=W/tests/globalSetup.js W/tests/genome-amendment.test.js W/tests/dataset-types.test.js W/tests/skill-imports.test.js W/tests/sync-shared.test.js W/tests/import-graph.test.js`; expect PASS. `dataset-types.test.js` proves Phase 1 still writes schema version 1.

- [ ] **Step 7: Commit.**
  `git -C W add shared/scripts/dataset-types skills package.json tests/genome-work-area.js tests/genome-amendment.test.js`
  `git -C W commit -m "Genome amendment: entries, constants and organism props from the work area"` (with the trailer).

---

### Task 4: `amend-proposal.js`, and merging an amendment at Preprocessing

**Files:**
- Create: `shared/scripts/lib/amend-ops.js`, `shared/scripts/amend-proposal.js`
- Modify: `shared/scripts/lib/git-ops.js` (`diff`), `shared/scripts/lib/merge-ops.js`
- Create: `tests/amend-ops.test.js`
- Modify: `tests/proposal-ops.test.js` (mergeProposal tests)

The skill that runs `amend-proposal.js` is created in Task 11, which registers these files.

- [ ] **Step 1: Write the failing amend tests** — `tests/amend-ops.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createGit } from '../shared/scripts/lib/git-ops.js';
import { amendProposal } from '../shared/scripts/lib/amend-ops.js';
import { fixtures, initRepo } from './helpers.js';
import { genomeWorkArea, genomeProposal, editJson, ACCESSION } from './genome-work-area.js';

const TICKET = { system: 'github', id: '42', url: 'https://r/issues/42' };
const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf-8' });
const curated = (repo, file) => JSON.parse(readFileSync(join(repo, 'Proposals', ACCESSION, 'curated', file), 'utf-8'));

/** GCA_000001.1 merged with a ticket and a curator constant, checked out on proposal/GCA_000001.1, and a work area under a validation root. */
function setup({ workArea = true } = {}) {
  const { repo } = initRepo('amend-ops-');
  const dir = join(repo, 'Proposals', ACCESSION);
  cpSync(genomeProposal().dir, dir, { recursive: true });
  editJson(join(dir, 'manifest.json'), (m) => ({ ...m, ticket: TICKET }));
  editJson(join(dir, 'curated/organism.json'), (r) => ({ ...r, constants: { source: 'GenBank' } }));
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'merge GCA_000001.1');
  git(repo, 'push', '-q');
  git(repo, 'checkout', '-q', '-b', `proposal/${ACCESSION}`);
  const root = mkdtempSync(join(tmpdir(), 'validation-root-'));
  if (workArea) genomeWorkArea({ at: join(root, 'annotated-genome-validation/proposals', ACCESSION, 'preprocess') });
  return { repo, root, gitOps: createGit(repo) };
}

const amend = (s, given = { orthomclAbbrev: 'tfak' }, proposalId = ACCESSION) =>
  amendProposal({ git: s.gitOps, repoPath: s.repo, workspace: s.root, proposalId, given });

test('amendProposal writes the entries and the amended record, keeping curator keys and constants, and diffs against master', async () => {
  const s = setup();
  const result = await amend(s);
  const record = curated(s.repo, 'organism.json');
  assert.equal(record.schemaVersion, 2);
  assert.equal(record.organismFullName, 'Testus fakeus ST-1');
  assert.equal(record.orthomclAbbrev, 'tfak');
  assert.deepEqual(record.constants, { source: 'GenBank', genomeSource: 'GenBank', genomeVersion: '2024-03-05', functAnnotVersion: '2024-04-01' });
  assert.equal(curated(s.repo, 'datasets.json').datasets.length, 9);
  assert.deepEqual(result.entries, curated(s.repo, 'datasets.json').datasets);
  assert.equal(result.sources['organism.orthomclAbbrev'], 'given (--organism orthomclAbbrev)');
  assert.match(result.diff, /Proposals\/GCA_000001\.1\/curated\/datasets\.json/);
  assert.match(result.diff, /\+  "schemaVersion": 2,/);
});

test('a re-run replaces what the amendment owns and keeps the rest', async () => {
  const s = setup();
  await amend(s);
  editJson(join(s.repo, 'Proposals', ACCESSION, 'curated/organism.json'), (r) => ({ ...r, organismFullName: 'Testus fakeus strain ST-1' }));
  await amend(s, { isCore: 'true' });
  const record = curated(s.repo, 'organism.json');
  assert.equal(record.organismFullName, 'Testus fakeus strain ST-1');
  assert.equal(record.isCore, 'true');
  assert.equal(record.orthomclAbbrev, 'tfak');
  assert.equal(curated(s.repo, 'datasets.json').datasets.length, 9);
});

test('amendProposal refuses another branch, a type without the hook, and a missing work area, writing nothing', async () => {
  const s = setup();
  git(s.repo, 'checkout', '-q', 'master');
  await assert.rejects(amend(s), /Expected to be on proposal\/GCA_000001\.1, but on "master"/);
  assert.equal(curated(s.repo, 'organism.json').schemaVersion, 1);

  const rna = setup();
  cpSync(join(fixtures, 'proposals/PRJNA000002'), join(rna.repo, 'Proposals/PRJNA000002'), { recursive: true });
  git(rna.repo, 'checkout', '-q', '-b', 'proposal/PRJNA000002');
  await assert.rejects(amend(rna, {}, 'PRJNA000002'), /bulk-rnaseq proposals are not amended from preprocessing/);

  const bare = setup({ workArea: false });
  await assert.rejects(amend(bare), /No preprocessing work area for GCA_000001\.1 at .*annotated-genome-validation\/proposals\/GCA_000001\.1\/preprocess; run preprocessing there first/);
  assert.equal(curated(bare.repo, 'organism.json').schemaVersion, 1);
});

test('amendProposal validates the amended proposal against classes.xml before writing', async () => {
  const s = setup();
  const classes = join(s.repo, 'Model/lib/xml/datasetClass/classes.xml');
  writeFileSync(classes, readFileSync(classes, 'utf-8').replace(/<datasetClass class="geneName"[\s\S]*?<\/datasetClass>/, ''));
  await assert.rejects(amend(s), /geneName GenBank: Dataset class "geneName" not found/);
  assert.deepEqual(curated(s.repo, 'datasets.json').datasets, []);
  assert.equal(curated(s.repo, 'organism.json').schemaVersion, 1);
});
```

- [ ] **Step 2: Run** `node --test --test-reporter=dot --test-global-setup=W/tests/globalSetup.js W/tests/amend-ops.test.js`; expect FAIL (module not found).

- [ ] **Step 3: Implement.**

In `shared/scripts/lib/git-ops.js`, next to `showFile`:

```js
    /** The working tree's changes to path against ref, as a unified diff ('' when none). */
    diff: (ref, path) => git('diff', '--no-color', ref, '--', path),
```

`shared/scripts/lib/amend-ops.js`:

```js
import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { read as readManifest, announce, proposalBranch, proposalRelativePath, PROPOSALS_DIR } from './manifest.js';
import { readContactIds, contactsPath } from './contacts.js';
import { assertOnBranch } from './guards.js';
import { memoClassOf } from './dataset-classes.js';
import { typeDirOf, workAreaOf } from './validation-workspace.js';
import { loadDatasetType } from '../dataset-types/index.js';
import {
  assertValidEntries, renderDatasets, readCuratedJson, DATASETS_FILENAME, DATASETS_SCHEMA_VERSION, ORGANISM_RECORD_FILENAME
} from '../dataset-types/_common.js';

/**
 * Writes what preprocessing settled into Proposals/<proposalId>/ on proposal/<proposalId>: curated/datasets.json,
 * and in curated/organism.json the constants and organism props the type's preprocessedAmendment owns, keeping every
 * other record key and constant. The result is validated in a scratch copy first, so a refusal writes nothing.
 * Returns { dir, entries, constants, organism (the whole record), sources, diff (against origin/master) }.
 */
export async function amendProposal({ git, repoPath, workspace, proposalId, given = {} }) {
  assertOnBranch(git, proposalBranch(proposalId), 'node scripts/start-proposal.js <accession> --type <datasetType>');
  const dir = join(repoPath, PROPOSALS_DIR, proposalId);
  const manifest = readManifest(dir, { contactIds: readContactIds(contactsPath(repoPath)) });
  announce(proposalId, manifest);
  const datasetType = await loadDatasetType(manifest.datasetType);
  if (!datasetType.preprocessedAmendment) throw new Error(`${manifest.datasetType} proposals are not amended from preprocessing; amend-proposal.js has nothing to write`);
  const t = typeDirOf(workspace, manifest.datasetType);
  if (t.error) throw new Error(t.error);
  const workArea = workAreaOf(t.typeDir, proposalId);
  if (!existsSync(workArea)) throw new Error(`No preprocessing work area for ${proposalId} at ${workArea}; run preprocessing there first`);

  const amendment = datasetType.preprocessedAmendment({ workArea, proposalDir: dir, manifest, given });
  const record = readCuratedJson(dir, ORGANISM_RECORD_FILENAME);
  const organism = {
    ...record, ...amendment.organism, schemaVersion: datasetType.ORGANISM_RECORD_SCHEMA_VERSION, constants: { ...record.constants, ...amendment.constants }
  };
  const files = {
    [DATASETS_FILENAME]: JSON.stringify({ schemaVersion: DATASETS_SCHEMA_VERSION, datasets: amendment.entries }, null, 2) + '\n',
    [ORGANISM_RECORD_FILENAME]: JSON.stringify(organism, null, 2) + '\n'
  };
  const scratch = mkdtempSync(join(tmpdir(), 'amend-'));
  try {
    const staged = join(scratch, proposalId);
    cpSync(dir, staged, { recursive: true });
    for (const [name, text] of Object.entries(files)) writeFileSync(join(staged, 'curated', name), text);
    const classOf = memoClassOf(repoPath);
    assertValidEntries(staged, manifest, datasetType, { classOf });
    renderDatasets(staged, manifest, datasetType, classOf);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, 'curated', name), text);
  return { dir, ...amendment, organism, diff: git.diff('origin/master', `${proposalRelativePath(proposalId)}/curated`) };
}
```

`shared/scripts/amend-proposal.js`:

```js
#!/usr/bin/env node
/**
 * amend-proposal.js - Writes what preprocessing settled into a proposal on its
 * proposal/<proposal> branch (start-proposal.js, update mode): the dataset
 * entries, and the organism constants and props in curated/organism.json, from
 * the work area under the validation workspace. Prints each derived value with
 * its source, then the diff against master. Publish with publish-proposal.js.
 *
 * Usage: node amend-proposal.js --workspace <root> [--organism key=value ...] <proposal>
 */
import { parseArgs } from 'node:util';
import { openWorkspace } from './lib/config.js';
import { createGit } from './lib/git-ops.js';
import { amendProposal } from './lib/amend-ops.js';
import { entryLabel } from './dataset-types/_common.js';
import { ASK } from './lib/validation-env.js';

const USAGE = 'Usage: node amend-proposal.js --workspace <root> [--organism key=value ...] <proposal>';

async function main() {
  const { values, positionals } = parseArgs({
    options: { workspace: { type: 'string' }, organism: { type: 'string', multiple: true, default: [] } }, allowPositionals: true
  });
  const [proposalId] = positionals;
  if (!proposalId || positionals.length !== 1) { console.error(USAGE); process.exit(1); }
  if (!values.workspace) { console.error(`--workspace is required: ${ASK}.\n${USAGE}`); process.exit(1); }
  const given = {};
  for (const pair of values.organism) {
    const at = pair.indexOf('=');
    if (at < 1) { console.error(`--organism must be key=value, got "${pair}"`); process.exit(1); }
    if (Object.hasOwn(given, pair.slice(0, at))) { console.error(`--organism names ${pair.slice(0, at)} twice`); process.exit(1); }
    given[pair.slice(0, at)] = pair.slice(at + 1);
  }
  const config = openWorkspace();
  const result = await amendProposal({ git: createGit(config.repoPath), repoPath: config.repoPath, workspace: values.workspace, proposalId, given });
  for (const e of result.entries) console.log(`Dataset: ${entryLabel(e)} ${e.version}`);
  for (const [key, source] of Object.entries(result.sources)) {
    const [section, name] = key.split('.');
    console.log(`${key} = ${JSON.stringify(result[section][name])}  (${source})`);
  }
  console.log(result.diff ? `\n${result.diff}` : '\nNo change against origin/master.');
  console.log(`\nNext: review the diff with the user, then node scripts/publish-proposal.js ${proposalId}`);
}

main().catch(err => { console.error(`Error: ${err.message}`); process.exit(1); });
```

- [ ] **Step 4: Run** `node --test --test-reporter=dot --test-global-setup=W/tests/globalSetup.js W/tests/amend-ops.test.js W/tests/git-ops.test.js W/tests/import-graph.test.js`; expect PASS.

- [ ] **Step 5: Change the mergeProposal tests** in `tests/proposal-ops.test.js`. Replace the test `mergeProposal refuses a ticket that is neither Initial draft nor Proposed, before merging` with:

```js
test('mergeProposal refuses a ticket past Preprocessing, before merging', async () => {
  const { git, gh } = await publishedProposal();
  for (const [status, option] of [['ready', 'Ready to load'], ['revision', 'Needs revision'], ['loading', 'Loading in progress']]) {
    const ticket = stubTicket({ status });
    await assert.rejects(mergeProposal({ git, ticket, proposalId: 'GCA_000001.1' }),
      new RegExp(`The ticket https://r/issues/42 is at "${option}"; merge-proposal merges only "Initial draft", "Proposed" or "Preprocessing" proposals`));
    assert.equal(ticket.calls.some(c => c[0] === 'setStatus' || c[0] === 'comment'), false);
  }
  assert.equal(gh.calls.some(a => a[1] === 'merge'), false);
});

test('mergeProposal merges an amendment made during Preprocessing and leaves the status', async () => {
  const gh = stubGh();
  const { git } = await preparedProposal({ planted: { ...plantedManifest, ticket: TICKET }, gh });
  await publishProposal({ git, ticket: stubTicket({ status: 'verifying' }), repoPath: git.repoPath, proposalId: 'GCA_000001.1' });
  const ticket = stubTicket({ status: 'verifying' });
  await mergeProposal({ git, ticket, proposalId: 'GCA_000001.1' });
  assert.equal(gh.calls.filter(a => a[1] === 'merge').length, 1);
  assert.deepEqual(ticket.notes, [`Merged ${PR7}`]);
  assert.equal(ticket.calls.some(c => c[0] === 'setStatus'), false);
});
```

- [ ] **Step 6: Run** `node --test --test-reporter=dot --test-global-setup=W/tests/globalSetup.js W/tests/proposal-ops.test.js`; expect the two tests to FAIL (Preprocessing is refused; the message lists two statuses).

- [ ] **Step 7: Implement** in `shared/scripts/lib/merge-ops.js`:

```js
// The PRs merge-proposal merges: a first version, an update of a dataset not yet verified, or a preprocessing amendment.
const MERGEABLE_STATUSES = ['draft', 'proposed', 'verifying'];
// A merged update keeps a status that already means "on master, being reviewed".
const KEEPS_STATUS = ['proposed', 'verifying'];
```

replacing the old `MERGEABLE_STATUSES` lines; the refusal message becomes

```js
    throw new Error(`The ticket ${ref.url} is at "${ticket.statusOption(status)}"; merge-proposal merges only ${MERGEABLE_STATUSES.map(s => `"${ticket.statusOption(s)}"`).join(', ').replace(/, ([^,]*)$/, ' or $1')} proposals`);
```

and the last status line becomes `if (!KEEPS_STATUS.includes(status)) await ticket.setStatus(ref, 'proposed');`. Update the `mergeProposal` doc comment: "and moves its ticket to `proposed` unless it is already `proposed` or `verifying` (a preprocessing amendment)".

- [ ] **Step 8: Run** `node --test --test-reporter=dot --test-global-setup=W/tests/globalSetup.js W/tests/proposal-ops.test.js W/tests/import-graph.test.js`; expect PASS.

- [ ] **Step 9: Commit.**
  `git -C W add shared/scripts/lib/amend-ops.js shared/scripts/amend-proposal.js shared/scripts/lib/git-ops.js shared/scripts/lib/merge-ops.js tests/amend-ops.test.js tests/proposal-ops.test.js skills`
  `git -C W commit -m "amend-proposal.js writes a preprocessing amendment; merge-proposal merges it at Preprocessing"` (with the trailer).

---

### Task 5: Validator kinds and the genome content validators

**Files:**
- Modify: `shared/scripts/lib/validation.js` (`VALIDATOR_KINDS`, `runValidators`), `shared/scripts/lib/build-fitness.js`, the four bulk-rnaseq validators (`shared/scripts/dataset-types/bulk-rnaseq/validators/{library-type,consistency,perl-parse,stf}.js`), `shared/scripts/dataset-types/validators.js`, `package.json`
- Create: `shared/scripts/dataset-types/genome-assembly/validators/{index,entry-shape,organism-record}.js`
- Create: `tests/genome-validators.test.js`
- Modify: `tests/validation.test.js`, `tests/validators-bulk-rnaseq.test.js`, `tests/validation-ops.test.js`, `tests/proposal-ops.test.js`

Registering genome validators makes mark-ready need a report and a workspace for genomes, which several existing tests assumed it did not; Step 7 updates them.

- [ ] **Step 1: Write the failing tests.**

Append to `tests/validation.test.js` (add `VALIDATOR_KINDS` to the existing `validation.js` import, and add `import { DATASET_TYPES } from '../shared/scripts/dataset-types/index.js';`, `import { validatorsFor } from '../shared/scripts/dataset-types/validators.js';`, `import { buildFitnessValidator } from '../shared/scripts/lib/build-fitness.js';`):

```js
test('runValidators refuses a preprocess validator without a work area, before running any', async () => {
  let ran = false;
  const validators = [
    { name: 'first', kind: 'content', tools: [], run: async () => { ran = true; return []; } },
    { name: 'reads', kind: 'preprocess', tools: [], run: async () => [] }
  ];
  await assert.rejects(runValidators(validators, {}, () => ({})), /reads read the preprocessing work area, but none was given/);
  assert.equal(ran, false);
  assert.deepEqual(await runValidators(validators, { workArea: '/w' }, () => ({})), []);
});

test('every registered validator declares whether it reads the work area or the proposal', () => {
  for (const type of Object.keys(DATASET_TYPES)) {
    for (const v of validatorsFor(type)) assert.ok(VALIDATOR_KINDS.includes(v.kind), `${type} ${v.name}: ${v.kind}`);
  }
  assert.equal(buildFitnessValidator.kind, 'content');
});
```

`tests/genome-validators.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { validatorsFor } from '../shared/scripts/dataset-types/validators.js';
import { datasetsOf } from '../shared/scripts/dataset-types/_common.js';
import { entryShape, entryShapeProblems } from '../shared/scripts/dataset-types/genome-assembly/validators/entry-shape.js';
import { organismRecord } from '../shared/scripts/dataset-types/genome-assembly/validators/organism-record.js';
import { genomeWorkArea, amendedProposal } from './genome-work-area.js';

const messages = async (validator, { dir, manifest }, ctx = {}) => (await validator.run({ proposalDir: dir, manifest, ...ctx })).map((f) => f.message);
const AMEND = 'run amend-proposal.js and publish';

test('genome-assembly registers its content validators', () => {
  assert.deepEqual(validatorsFor('genome-assembly').map((v) => [v.name, v.kind]), [['entryShape', 'content'], ['organismRecord', 'content']]);
});

test('entryShape passes an amended genome', async () => {
  assert.deepEqual(await messages(entryShape, amendedProposal(genomeWorkArea())), []);
});

test('entryShape refuses each shape a genome cannot load', () => {
  const { dir, manifest } = amendedProposal(genomeWorkArea());
  const [primary, contig, mito, primaryFeatures, contigFeatures, products] = datasetsOf(dir, manifest);
  const annotated = (list) => entryShapeProblems(list, { source: 'genbank' });
  assert.deepEqual(annotated([contig, contigFeatures, products]), [`a genome needs exactly one fasta_primary_genome_sequence entry; this one has 0; ${AMEND}`]);
  assert.deepEqual(annotated([primary, primary, primaryFeatures, products]), [`a genome needs exactly one fasta_primary_genome_sequence entry; this one has 2; ${AMEND}`]);
  assert.deepEqual(annotated([primary, contig, contig, primaryFeatures, products]), ['two fasta_secondary_genome entries have soTerm contig; each lower sequence type needs its own']);
  assert.deepEqual(annotated([primary, mito, mito, primaryFeatures, products]), ['two fasta_organelle_genome entries are for organelle mitochondrion']);
  assert.deepEqual(annotated([primary, contigFeatures, primaryFeatures, products]),
    ['NoPreprocess_secondary_genome_features $$genomeSource$$ (contig) has no secondary sequence entry with soTerm contig']);
  assert.deepEqual(annotated([primary, primaryFeatures]), [`an annotated genome needs a productNames entry; ${AMEND}`]);
  assert.deepEqual(annotated([primary, products]), [`an annotated genome needs at least one features entry; ${AMEND}`]);
  const unannotated = (list) => entryShapeProblems(list, { source: 'none' });
  assert.deepEqual(unannotated([primary, contig, mito]), []);
  assert.deepEqual(unannotated([primary, primaryFeatures]),
    ['an unannotated genome loads sequence entries only, not NoPreprocess_primary_genome_features $$genomeSource$$ (chromosome)']);
});

test('organismRecord passes an amended record', async () => {
  assert.deepEqual(await messages(organismRecord, amendedProposal(genomeWorkArea())), []);
});

test('organismRecord asks for an amendment of a Phase 1 record, and checks each amended prop', async () => {
  const proposal = amendedProposal(genomeWorkArea());
  const path = join(proposal.dir, 'curated/organism.json');
  const amended = JSON.parse(readFileSync(path, 'utf-8'));
  const check = async (record) => { writeFileSync(path, JSON.stringify(record)); return messages(organismRecord, proposal); };
  assert.deepEqual(await check({ ...amended, schemaVersion: 1 }), [`curated/organism.json is schema version 1, without the props preprocessing adds; ${AMEND}`]);
  const { isCore, ...withoutIsCore } = amended;
  assert.deepEqual(await check(withoutIsCore), [`curated/organism.json has no isCore; ${AMEND}`]);
  assert.deepEqual(await check({ ...amended, isHugeGenome: 'yes' }), ['isHugeGenome must be "true" or "false", not "yes"']);
  assert.deepEqual(await check({ ...amended, maxIntronSize: '0' }), ['maxIntronSize must be a positive integer, not "0"']);
  assert.deepEqual(await check({ ...amended, orthomclAbbrev: 'TFAK' }), ['orthomclAbbrev must be 4 to 8 lowercase letters, not "TFAK"']);
  assert.deepEqual(await check({ ...amended, genomeVersion: '2025-01-01' }),
    [`constant genomeVersion is "2024-03-05" but the organism record says "2025-01-01"; ${AMEND}`]);
  assert.deepEqual(await check({ ...amended, isFamilyRepresentative: 'true' }), [
    'a family representative needs familyNcbiTaxonIds; run amend-proposal.js --organism familyNcbiTaxonIds=... and publish',
    'a family representative needs familyNameForFiles; run amend-proposal.js --organism familyNameForFiles=... and publish'
  ]);
});
```

- [ ] **Step 2: Run** `node --test --test-reporter=dot --test-global-setup=W/tests/globalSetup.js W/tests/validation.test.js W/tests/genome-validators.test.js`; expect FAIL.

- [ ] **Step 3: Implement the kinds.**

In `shared/scripts/lib/validation.js`, above `runValidators`:

```js
/** preprocess validators read the work area (ctx.workArea) and run at verify only; content validators read the proposal and also run at load. */
export const VALIDATOR_KINDS = ['preprocess', 'content'];
```

and at the top of `runValidators`, before the loop:

```js
  const blind = validators.filter((v) => v.kind === 'preprocess' && !ctx.workArea).map((v) => v.name);
  if (blind.length) throw new Error(`${blind.join(', ')} read the preprocessing work area, but none was given`);
```

Add `kind: 'content',` after `name: NAME,` in each of `library-type.js`, `consistency.js`, `perl-parse.js`, `stf.js` (under `shared/scripts/dataset-types/bulk-rnaseq/validators/`). In `shared/scripts/lib/build-fitness.js` the export becomes `export const buildFitnessValidator = { name: NAME, kind: 'content', tools: [], run: (ctx) => buildFitness(ctx) };`.

- [ ] **Step 4: Implement the content validators.**

`shared/scripts/dataset-types/genome-assembly/validators/entry-shape.js`:

```js
import { datasetsOf, entryLabel } from '../../_common.js';
import { annotationOf } from '../../genome-assembly.js';
import { isFeaturesClass, isSequenceClass, roleOf } from '../entries.js';

const NAME = 'entryShape';
const AMEND = 'run amend-proposal.js and publish';
const repeated = (values) => [...new Set(values.filter((v, i) => values.indexOf(v) !== i))];

/** What keeps a genome's entries from loading: sequence partitions, features beside their sequences, and what its annotation needs. */
export function entryShapeProblems(entries, annotation) {
  const problems = [];
  const sequences = entries.filter((e) => isSequenceClass(e.datasetClass));
  const features = entries.filter((e) => isFeaturesClass(e.datasetClass));
  const ofRole = (role) => sequences.filter((e) => roleOf(e.datasetClass) === role);
  const primaries = ofRole('primary');
  if (primaries.length !== 1) problems.push(`a genome needs exactly one fasta_primary_genome_sequence entry; this one has ${primaries.length}; ${AMEND}`);
  for (const soTerm of repeated(ofRole('secondary').map((e) => e.props.soTerm))) {
    problems.push(`two fasta_secondary_genome entries have soTerm ${soTerm}; each lower sequence type needs its own`);
  }
  for (const organelle of repeated(ofRole('organelle').map((e) => e.props.organelle))) problems.push(`two fasta_organelle_genome entries are for organelle ${organelle}`);
  for (const f of features) {
    const role = roleOf(f.datasetClass);
    if (!ofRole(role).some((s) => s.props.soTerm === f.props.soTerm)) problems.push(`${entryLabel(f)} has no ${role} sequence entry with soTerm ${f.props.soTerm}`);
  }
  if (annotation.source === 'none') {
    const others = entries.filter((e) => !isSequenceClass(e.datasetClass));
    if (others.length) problems.push(`an unannotated genome loads sequence entries only, not ${others.map(entryLabel).join(', ')}`);
    return problems;
  }
  if (!entries.some((e) => e.datasetClass === 'productNames')) problems.push(`an annotated genome needs a productNames entry; ${AMEND}`);
  if (!features.length) problems.push(`an annotated genome needs at least one features entry; ${AMEND}`);
  return problems;
}

export const entryShape = {
  name: NAME,
  kind: 'content',
  tools: [],
  run: async ({ proposalDir, manifest }) => entryShapeProblems(datasetsOf(proposalDir, manifest), annotationOf(proposalDir))
    .map((message) => ({ validator: NAME, severity: 'error', message }))
};
```

`shared/scripts/dataset-types/genome-assembly/validators/organism-record.js`:

```js
import { readCuratedJson, constantsOf, ORGANISM_RECORD_FILENAME, AMENDED_ORGANISM_KEYS } from '../../_common.js';
import { ORGANISM_RECORD_SCHEMA_VERSION } from '../amendment.js';

const NAME = 'organismRecord';
const AMEND = 'run amend-proposal.js and publish';
const BOOLEANS = ['annotationIncludesTRNAs', 'isHugeGenome', 'isNotEbiGenome', 'isCore', 'runExportPred', 'isFamilyRepresentative'];
const isString = (v) => typeof v === 'string';

/** What keeps an organism record from rendering the organism dataset: an unamended record, a missing or malformed prop, or constants that disagree with it. */
export function organismRecordProblems(record, constants) {
  if (record.schemaVersion !== ORGANISM_RECORD_SCHEMA_VERSION) {
    return [`curated/organism.json is schema version ${record.schemaVersion}, without the props preprocessing adds; ${AMEND}`];
  }
  const problems = AMENDED_ORGANISM_KEYS.filter((k) => !isString(record[k])).map((k) => `curated/organism.json has no ${k}; ${AMEND}`);
  for (const k of BOOLEANS) {
    if (isString(record[k]) && record[k] !== 'true' && record[k] !== 'false') problems.push(`${k} must be "true" or "false", not "${record[k]}"`);
  }
  if (isString(record.maxIntronSize) && !/^[1-9]\d*$/.test(record.maxIntronSize)) problems.push(`maxIntronSize must be a positive integer, not "${record.maxIntronSize}"`);
  if (isString(record.orthomclAbbrev) && !/^[a-z]{4,8}$/.test(record.orthomclAbbrev)) problems.push(`orthomclAbbrev must be 4 to 8 lowercase letters, not "${record.orthomclAbbrev}"`);
  for (const k of ['genomeSource', 'genomeVersion']) {
    if (constants[k] !== record[k]) problems.push(`constant ${k} is "${constants[k] ?? ''}" but the organism record says "${record[k]}"; ${AMEND}`);
  }
  if (record.isFamilyRepresentative === 'true') {
    for (const k of ['familyNcbiTaxonIds', 'familyNameForFiles']) {
      if (!record[k]) problems.push(`a family representative needs ${k}; run amend-proposal.js --organism ${k}=... and publish`);
    }
  }
  return problems;
}

export const organismRecord = {
  name: NAME,
  kind: 'content',
  tools: [],
  run: async ({ proposalDir }) => organismRecordProblems(readCuratedJson(proposalDir, ORGANISM_RECORD_FILENAME), constantsOf(proposalDir))
    .map((message) => ({ validator: NAME, severity: 'error', message }))
};
```

`shared/scripts/dataset-types/genome-assembly/validators/index.js`:

```js
import { entryShape } from './entry-shape.js';
import { organismRecord } from './organism-record.js';

/** Run order matters: the report lists findings in this order. */
export const validators = [entryShape, organismRecord];
```

In `shared/scripts/dataset-types/validators.js`, add `import { validators as genomeAssembly } from './genome-assembly/validators/index.js';` and make the map `const VALIDATORS = { 'bulk-rnaseq': bulkRnaseq, 'genome-assembly': genomeAssembly };`.

- [ ] **Step 5: Register the shared files.** In `package.json` `sharedFiles`, add `scripts/dataset-types/genome-assembly/validators/index.js`, `scripts/dataset-types/genome-assembly/validators/entry-shape.js` and `scripts/dataset-types/genome-assembly/validators/organism-record.js`, each listing `"verify-bulk-rnaseq", "load-proposals"`. Run `node W/bin/sync-shared.js`.

- [ ] **Step 6: Run** `node --test --test-reporter=dot --test-global-setup=W/tests/globalSetup.js W/tests/validation.test.js W/tests/genome-validators.test.js W/tests/validators-bulk-rnaseq.test.js W/tests/validation-ops.test.js W/tests/proposal-ops.test.js W/tests/import-graph.test.js W/tests/skill-imports.test.js`. Expect the new tests to PASS and these existing ones to FAIL, because genomes now have validators: `validatorsFor registers the bulk-rnaseq validators and none for genomes yet`, `a type without validators is refused`, `contentValidation refuses a type with validators when no workspace was given, but lets a genome through`, `markReady ignores the workspace for a type without validators`, `verification commands treat a merged Initial draft as Proposed, with a notice`, `markReady verifies a merged proposal: notes it once and sets ready`. Any other failure: stop and report.

- [ ] **Step 7: Update those tests.**

`tests/validators-bulk-rnaseq.test.js`: rename the test to `validatorsFor registers the bulk-rnaseq validators` and delete its `assert.deepEqual(validatorsFor('genome-assembly'), []);` line (the genome registry is asserted in `genome-validators.test.js`).

`tests/validation-ops.test.js`:

```js
test('a type without validators is refused', async () => {
  const { repo, git } = setupMerged('PRJNA000010');
  await assert.rejects(validateProposal({ git, ticket: stubTicket(), repoPath: repo, proposalId: 'PRJNA000010' }),
    /No validators for datasetType "dnaseq"; verify PRJNA000010 by hand/);
});
```

In `contentValidation refuses a type with validators when no workspace was given, but lets a genome through`, rename it to `contentValidation refuses a type with validators when no workspace was given, but lets a type without validators through`, and change `datasetType: 'genome-assembly'` to `datasetType: 'chipseq'`.

Replace `markReady ignores the workspace for a type without validators` with:

```js
test('markReady ignores the workspace for a type without validators', async () => {
  const { git } = setupMerged('PRJNA000010');
  const ticket = stubTicket({ status: 'verifying' });
  const disposal = disposalStub({ refuse: true, failDispose: true });
  const delivery = deliveryStub(git, { tree: git.objectId('origin/master', 'Proposals/PRJNA000010') });
  const result = await markReady({ git, ticket, proposalId: 'PRJNA000010', workspace: disposal, delivery });
  assert.equal(result.status, 'ready');
  assert.deepEqual(disposal.calls, []);
  assert.equal(result.disposed, null);
  assert.equal(result.disposeError, null);
  assert.equal(result.noWorkspaceUnder, null);
});
```

`tests/proposal-ops.test.js`: add `import { formatReportComment } from '../shared/scripts/lib/validation.js';`, and above `// --- Initial draft at verification` add:

```js
/** A passing genome report for GCA_000001.1 as origin/master has it: mark-ready needs one for a type with validators. */
const genomeReport = (repo) => formatReportComment({
  schemaVersion: 1, accession: 'GCA_000001.1', proposalId: 'GCA_000001.1', datasetType: 'genome-assembly',
  proposalTree: execFileSync('git', ['-C', repo, 'rev-parse', 'origin/master:Proposals/GCA_000001.1'], { encoding: 'utf-8' }).trim(),
  against: null, workspace: '/ws', tools: {}, repos: {}, findings: [], verdict: 'pass'
});
/** A validation workspace holding nothing for the proposal. */
const NO_WORKSPACE = { assertDisposable() {}, where: () => ({ typeDir: '/ws', dir: '/ws/proposals/GCA_000001.1' }), dispose: () => null };
```

In `verification commands treat a merged Initial draft as Proposed, with a notice`, after `plantProposalOnMaster(...)` add `const report = genomeReport(repo);`, and change the `t2` and `t4` blocks to:

```js
  const t2 = stubTicket({ status: 'draft', existingComments: [report] });
  const ready = await markReady({ git: git(), ticket: t2, proposalId: 'GCA_000001.1', workspace: NO_WORKSPACE });
```

```js
  const t4 = stubTicket({ status: 'proposed', existingComments: [report] });
  assert.equal((await markReady({ git: git(), ticket: t4, proposalId: 'GCA_000001.1', workspace: NO_WORKSPACE })).notice, null);
```

Replace `markReady verifies a merged proposal: notes it once and sets ready` with:

```js
test('markReady verifies a merged proposal: notes the report and the note once, and sets ready', async () => {
  const { repo } = setupRepo();
  plantProposalOnMaster(repo, { ...plantedManifest, ticket: TICKET });
  const git = createGit(repo, { exec: stubGh().exec });
  const report = genomeReport(repo);
  const ticket = stubTicket({ status: 'proposed', existingComments: [report] });
  const result = await markReady({ git, ticket, proposalId: 'GCA_000001.1', note: ' reads resolve ', workspace: NO_WORKSPACE });
  assert.deepEqual(result.ticket, TICKET);
  assert.deepEqual(ticket.notes, [report, 'Verified: report pass (no tools)\nNote: reads resolve']);
  assert.deepEqual(ticket.calls.filter(c => c[0] === 'setStatus'), [['setStatus', '42', 'ready']]);

  const quiet = stubTicket({ status: 'proposed', existingComments: [report] });
  await markReady({ git, ticket: quiet, proposalId: 'GCA_000001.1', workspace: NO_WORKSPACE });
  assert.deepEqual(quiet.notes, [report, 'Verified: report pass (no tools)']);
  assert.deepEqual(quiet.calls.filter(c => c[0] === 'setStatus'), [['setStatus', '42', 'ready']]);

  const claimed = stubTicket({ status: 'verifying', existingComments: [report] });
  await markReady({ git, ticket: claimed, proposalId: 'GCA_000001.1', workspace: NO_WORKSPACE });
  assert.deepEqual(claimed.calls.filter(c => c[0] === 'setStatus'), [['setStatus', '42', 'ready']]);
});
```

- [ ] **Step 8: Run** the Step 6 command again; expect PASS.

- [ ] **Step 9: Commit.**
  `git -C W add shared/scripts skills package.json tests/validation.test.js tests/genome-validators.test.js tests/validators-bulk-rnaseq.test.js tests/validation-ops.test.js tests/proposal-ops.test.js`
  `git -C W commit -m "Validators declare a kind; genome entryShape and organismRecord content validators"` (with the trailer).

---

### Task 6: The genome preprocess validators

**Files:**
- Create: `shared/scripts/dataset-types/genome-assembly/validators/{records,ids,matches-build,pipeline-findings}.js`
- Modify: `shared/scripts/dataset-types/genome-assembly/validators/index.js`, `shared/scripts/lib/validation-ops.js`, `package.json`
- Modify: `tests/genome-validators.test.js`, `tests/validation-ops.test.js`

- [ ] **Step 1: Write the failing tests.** In `tests/genome-validators.test.js`, replace the test `genome-assembly registers its content validators` with:

```js
test('genome-assembly registers its validators, the work-area ones first', () => {
  assert.deepEqual(validatorsFor('genome-assembly').map((v) => [v.name, v.kind]), [
    ['records', 'preprocess'], ['matchesBuild', 'preprocess'], ['ids', 'preprocess'], ['pipelineFindings', 'preprocess'],
    ['entryShape', 'content'], ['organismRecord', 'content']
  ]);
});
```

and append (adding to the imports `appendFileSync, mkdtempSync` from `node:fs`, `tmpdir` from `node:os`, `runValidators` from `../shared/scripts/lib/validation.js`, `readPreprocessed` from `../shared/scripts/dataset-types/genome-assembly/preprocess.js`, `editJson` from `./genome-work-area.js`, and the four validators from their files):

```js
test('records passes a deliverable work area and keeps its record sha256s for the report', async () => {
  const workArea = genomeWorkArea();
  const extras = {};
  assert.deepEqual(await records.run({ workArea, extras }), []);
  assert.deepEqual(extras.preprocess, readPreprocessed(workArea).sha256);
});

test('records reports each problem that makes the work area undeliverable as an error', async () => {
  const findings = await records.run({ workArea: genomeWorkArea({ trial: { result: 'failed' } }), extras: {} });
  assert.deepEqual(findings.map((f) => [f.validator, f.severity]), [['records', 'error']]);
  assert.match(findings[0].message, /the trial result is "failed"/);
});

test('the other preprocess validators leave an unreadable work area to records', async () => {
  const { dir, manifest } = amendedProposal(genomeWorkArea());
  const empty = mkdtempSync(join(tmpdir(), 'empty-work-area-'));
  for (const v of [ids, matchesBuild, pipelineFindings]) assert.deepEqual(await v.run({ workArea: empty, proposalDir: dir, manifest }), [], v.name);
  const findings = await runValidators([records], { workArea: empty, extras: {} }, () => ({}));
  assert.match(findings[0].message, /^failed: verify: .*genome-build\.json: is missing/);
});

test('ids passes functional files whose IDs ISF loads, and names the rest with a sample', async () => {
  const workArea = genomeWorkArea();
  assert.deepEqual(await ids.run({ workArea }), []);
  appendFileSync(join(workArea, 'final/function/productNames/GenBank/products.txt'), 'TST_9999_mRNA\tghost\t1\nTST_0010\tgene id\t1\n');
  assert.deepEqual((await ids.run({ workArea })).map((f) => f.message),
    ['productNames GenBank: 2 transcript IDs are not in transcriptInfoAndIds, such as TST_9999_mRNA, TST_0010']);
});

test('ids reads protein IDs as <transcript>-p1 and GAF IDs from column 2', async () => {
  const workArea = genomeWorkArea({ functionalDatasets: [
    { datasetClass: 'EnzymeCommissionAssociations', name: 'GenBank', file: 'ec.txt', level: 'protein', text: 'TST_0010_mRNA-p1\t1.1.1.1\nTST_0010_mRNA\t1.1.1.2\n', props: {} },
    { datasetClass: 'GeneOntologyAssociations', name: 'GenBank', file: 'associations.gas', level: 'transcript', text: 'GenBank\tTST_0040_mRNA\tTST_0040_mRNA\t\tGO:0000001\n', props: {} }
  ] });
  assert.deepEqual((await ids.run({ workArea })).map((f) => f.message),
    ['EnzymeCommissionAssociations GenBank: 1 protein IDs are not in transcriptInfoAndIds, such as TST_0010_mRNA']);
});

test('matchesBuild passes a proposal amended from this build and refuses one amended from another', async () => {
  const workArea = genomeWorkArea();
  const MESSAGE = 'the proposal was amended from another build; re-run amend-proposal and publish';
  const p = amendedProposal(workArea);
  const ctx = { workArea, proposalDir: p.dir, manifest: p.manifest };
  assert.deepEqual(await matchesBuild.run(ctx), []);
  editJson(join(p.dir, 'curated/datasets.json'), (d) => ({ ...d, datasets: d.datasets.slice(0, -1) }));
  assert.deepEqual((await matchesBuild.run(ctx)).map((f) => f.message), [MESSAGE]);
  const other = amendedProposal(workArea);
  editJson(join(other.dir, 'curated/organism.json'), (r) => ({ ...r, constants: { ...r.constants, functAnnotVersion: '2020-01-01' } }));
  assert.deepEqual((await matchesBuild.run({ workArea, proposalDir: other.dir, manifest: other.manifest })).map((f) => f.message), [MESSAGE]);
});

test('pipelineFindings reports D, C and E findings at their own severities, tagged by step', async () => {
  const f = (group, check, severity, message, sample = []) => ({ group, check, severity, count: sample.length || 1, sample, message, fix: null });
  const workArea = genomeWorkArea({
    buildWarnings: ['addExonPerCds changed nothing; the recipe declares a transform this genome does not need'],
    buildFindings: [f('sequences', 'partitionCounts', 'info', 'chromosome 1')],
    trial: { findings: [f('qa', 'internalStop', 'warning', 'proteins with an internal stop codon', ['p1', 'p2'])] },
    functionalFindings: [f('functional', 'unknownDbxrefPrefix', 'warning', 'no URL for these prefixes', ['EnsemblGenomes-Gn'])]
  });
  assert.deepEqual((await pipelineFindings.run({ workArea })).map((x) => [x.severity, x.message]), [
    ['warning', '[build] addExonPerCds changed nothing; the recipe declares a transform this genome does not need'],
    ['info', '[build] sequences/partitionCounts (1): chromosome 1'],
    ['warning', '[trial] qa/internalStop (2): proteins with an internal stop codon [p1, p2]'],
    ['warning', '[functional] functional/unknownDbxrefPrefix (1): no URL for these prefixes [EnsemblGenomes-Gn]']
  ]);
});
```

Append to `tests/validation-ops.test.js` (add `import { readPreprocessed } from '../shared/scripts/dataset-types/genome-assembly/preprocess.js';` and `import { genomeWorkArea, amendedProposal } from './genome-work-area.js';`):

```js
/** A root whose annotated-genome-validation clones and builds nothing. */
function genomeRoot(t) {
  const root = removedAfter(t, mkdtempSync(join(tmpdir(), 'validation-root-')));
  const typeDir = join(root, 'annotated-genome-validation');
  mkdirSync(typeDir);
  writeFileSync(join(typeDir, 'env.json'), JSON.stringify({ schemaVersion: 2, repos: {}, executables: {} }));
  return { root, typeDir };
}

/** GCA_000001.1 amended from workArea and merged to origin/master with a ticket. */
function setupAmendedGenome(workArea) {
  const { repo } = initRepo('validation-ops-');
  const dir = join(repo, 'Proposals/GCA_000001.1');
  cpSync(amendedProposal(workArea).dir, dir, { recursive: true });
  const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf-8'));
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ ...m, ticket: TICKET }, null, 2) + '\n');
  execFileSync('git', ['-C', repo, 'add', '-A']);
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'merge GCA_000001.1']);
  execFileSync('git', ['-C', repo, 'push', '-q']);
  return { repo, git: createGit(repo, { exec: stubGh().exec }) };
}

test('validateProposal gives genome validators the work area and keeps its record sha256s in the report', async (t) => {
  const { root, typeDir } = genomeRoot(t);
  const workArea = genomeWorkArea({ at: join(typeDir, 'proposals/GCA_000001.1/preprocess') });
  const { repo, git } = setupAmendedGenome(workArea);
  const { report } = await validateProposal({ git, ticket: stubTicket(), repoPath: repo, proposalId: 'GCA_000001.1', workspace: root, post: false });
  assert.deepEqual(report.findings, []);
  assert.equal(report.verdict, 'pass');
  assert.deepEqual(report.preprocess, readPreprocessed(workArea).sha256);
});

test('contentValidation runs only content validators: a genome needs no work area at load', async (t) => {
  const { root } = genomeRoot(t);
  const { dir, manifest } = amendedProposal(genomeWorkArea());
  assert.deepEqual(await contentValidation({ workspace: root, rebuildBranch: 'rebuild70' })({ proposalDir: dir, manifest }), []);
});
```

- [ ] **Step 2: Run** `node --test --test-reporter=dot --test-global-setup=W/tests/globalSetup.js W/tests/genome-validators.test.js W/tests/validation-ops.test.js`; expect FAIL (modules not found).

- [ ] **Step 3: Implement the validators.**

`shared/scripts/dataset-types/genome-assembly/validators/records.js`:

```js
import { preprocessedProblems, readPreprocessed } from '../preprocess.js';

const NAME = 'records';

/** The work area's records, or null when they cannot be read; the records validator reports why. */
export function recordsOrNull(workArea) {
  try { return readPreprocessed(workArea); } catch { return null; }
}

export const records = {
  name: NAME,
  kind: 'preprocess',
  tools: [],
  run: async ({ workArea, extras }) => {
    const found = readPreprocessed(workArea);
    if (extras) extras.preprocess = found.sha256;
    return preprocessedProblems(found, workArea).map((message) => ({ validator: NAME, severity: 'error', message }));
  }
};
```

`shared/scripts/dataset-types/genome-assembly/validators/ids.js`:

```js
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { partitionName } from '../../../genome/genome-build.js';
import { recordsOrNull } from './records.js';

const NAME = 'ids';
const SAMPLE = 5;
/** GAF puts its source in column 1 and the feature ID in column 2. */
const idColumn = (datasetClass) => (datasetClass === 'GeneOntologyAssociations' ? 1 : 0);

/** Gene, transcript and protein IDs ISF loads, from each partition's transcriptInfoAndIds. */
function loadedIds(found, workArea) {
  const ids = { gene: new Set(), transcript: new Set(), protein: new Set() };
  for (const part of found.genomeBuild.partitions) {
    for (const file of Object.keys(found.trial.outputs[partitionName(part)] ?? {})) {
      for (const line of readFileSync(join(workArea, part.dir, file), 'utf-8').split('\n')) {
        if (!line) continue;
        const cols = line.split('\t');
        ids.gene.add(cols[0]);
        ids.transcript.add(cols[4]);
        ids.protein.add(`${cols[4]}-p1`);
      }
    }
  }
  return ids;
}

export const ids = {
  name: NAME,
  kind: 'preprocess',
  tools: [],
  run: async ({ workArea }) => {
    const found = recordsOrNull(workArea);
    if (!found) return [];
    const loaded = loadedIds(found, workArea);
    return found.functional.datasets.flatMap((d) => {
      const known = loaded[d.ids.level];
      const where = `${d.datasetClass} ${d.name}`;
      if (!known) return [{ validator: NAME, severity: 'error', message: `${where}: ID level "${d.ids.level}" is not gene, transcript or protein` }];
      const lines = readFileSync(join(workArea, d.file), 'utf-8').split('\n').filter((l) => l && !l.startsWith('!'));
      const missing = [...new Set(lines.map((l) => l.split('\t')[idColumn(d.datasetClass)]))].filter((id) => !known.has(id));
      return missing.length
        ? [{ validator: NAME, severity: 'error', message: `${where}: ${missing.length} ${d.ids.level} IDs are not in transcriptInfoAndIds, such as ${missing.slice(0, SAMPLE).join(', ')}` }]
        : [];
    });
  }
};
```

`shared/scripts/dataset-types/genome-assembly/validators/matches-build.js`:

```js
import { isDeepStrictEqual } from 'node:util';
import { constantsOf, datasetsOf, readCuratedJson, ORGANISM_RECORD_FILENAME } from '../../_common.js';
import { constantsFrom, reportOf } from '../amendment.js';
import { entriesFrom } from '../entries.js';
import { recordsOrNull } from './records.js';

const NAME = 'matchesBuild';
const MESSAGE = 'the proposal was amended from another build; re-run amend-proposal and publish';

export const matchesBuild = {
  name: NAME,
  kind: 'preprocess',
  tools: [],
  run: async ({ workArea, proposalDir, manifest }) => {
    const found = recordsOrNull(workArea);
    if (!found) return [];
    const expected = constantsFrom(readCuratedJson(proposalDir, ORGANISM_RECORD_FILENAME), reportOf(proposalDir, manifest)).constants;
    const constants = constantsOf(proposalDir);
    const same = isDeepStrictEqual(datasetsOf(proposalDir, manifest), entriesFrom(found))
      && Object.entries(expected).every(([k, v]) => constants[k] === v);
    return same ? [] : [{ validator: NAME, severity: 'error', message: MESSAGE }];
  }
};
```

`shared/scripts/dataset-types/genome-assembly/validators/pipeline-findings.js`:

```js
import { recordsOrNull } from './records.js';

const NAME = 'pipelineFindings';
const SEVERITIES = ['error', 'warning', 'info'];
const describe = (f) => `${f.group}/${f.check} (${f.count}): ${f.message}${f.sample?.length ? ` [${f.sample.join(', ')}]` : ''}`;
const tagged = (step, f) => ({ validator: NAME, severity: SEVERITIES.includes(f.severity) ? f.severity : 'warning', message: `[${step}] ${describe(f)}` });

export const pipelineFindings = {
  name: NAME,
  kind: 'preprocess',
  tools: [],
  run: async ({ workArea }) => {
    const found = recordsOrNull(workArea);
    if (!found) return [];
    const { genomeBuild, trial, functional } = found;
    return [
      ...(genomeBuild.warnings ?? []).map((w) => ({ validator: NAME, severity: 'warning', message: `[build] ${w}` })),
      ...(genomeBuild.findings ?? []).map((f) => tagged('build', f)),
      ...trial.findings.map((f) => tagged('trial', f)),
      ...functional.findings.map((f) => tagged('functional', f))
    ];
  }
};
```

`shared/scripts/dataset-types/genome-assembly/validators/index.js` becomes:

```js
import { records } from './records.js';
import { matchesBuild } from './matches-build.js';
import { ids } from './ids.js';
import { pipelineFindings } from './pipeline-findings.js';
import { entryShape } from './entry-shape.js';
import { organismRecord } from './organism-record.js';

/** Run order matters: records first, so the report's preprocess sha256s come from it. */
export const validators = [records, matchesBuild, ids, pipelineFindings, entryShape, organismRecord];
```

- [ ] **Step 4: Wire the work area into validation** in `shared/scripts/lib/validation-ops.js`:
  - Extend the import: `import { openVerifyWorkspace, openLoadWorkspace, typeDirOf, workAreaOf } from './validation-workspace.js';`.
  - In `validateProposal`, after `const tools = …`:

```js
  const t = typeDirOf(workspace, manifest.datasetType);
  const workArea = t.error ? null : workAreaOf(t.typeDir, proposalId);
  // Validators may add report fields here; the genome records validator adds preprocess.
  const extras = {};
```

  - Change the `ctx` to `const ctx = { proposalDir: join(scratch, relDir), manifest, git, against, exec, workArea, extras };`.
  - In `report`, after `repos: tools.repos(),` add `...extras,`.
  - In `contentValidation`, change the first line of the returned function to `const validators = validatorsFor(manifest.datasetType).filter((v) => v.kind === 'content');`.
  - Update `validateProposal`'s doc comment: "Validators that read the preprocessing work area get it as ctx.workArea (<type>-validation/proposals/<id>/preprocess/); a validator may add report fields through ctx.extras." Update `contentValidation`'s: "runs the content validators of the proposal's type".

- [ ] **Step 5: Register the shared files.** In `package.json` `sharedFiles`, add `scripts/dataset-types/genome-assembly/validators/records.js`, `scripts/dataset-types/genome-assembly/validators/ids.js`, `scripts/dataset-types/genome-assembly/validators/matches-build.js` and `scripts/dataset-types/genome-assembly/validators/pipeline-findings.js`, each listing `"verify-bulk-rnaseq", "load-proposals"`. Run `node W/bin/sync-shared.js`.

- [ ] **Step 6: Run** `node --test --test-reporter=dot --test-global-setup=W/tests/globalSetup.js W/tests/genome-validators.test.js W/tests/validation-ops.test.js W/tests/validation.test.js W/tests/import-graph.test.js W/tests/skill-imports.test.js`; expect PASS.

- [ ] **Step 7: Checkpoint: full suite.** `yarn --cwd W test`; expect 0 failures (skips from `VALIDATION_ROOT`, `APICOMMONDATA_DIR` or `perl` are fine). Fix a failure in the task that caused it before continuing.

- [ ] **Step 8: Commit.**
  `git -C W add shared/scripts skills package.json tests/genome-validators.test.js tests/validation-ops.test.js`
  `git -C W commit -m "Genome preprocess validators: records, matchesBuild, ids, pipelineFindings"` (with the trailer).

---

### Task 7: Delivery carry-overs: report to the hook, `againstCommit`, provenance line, symlinked work area

**Files:**
- Modify: `shared/scripts/lib/git-ops.js` (`commitOf`), `shared/scripts/lib/preprocessed.js`, `shared/scripts/lib/delivery-ops.js`, `shared/scripts/lib/verification-ops.js`, `shared/scripts/lib/validation.js`, `docs/development.md`
- Modify: `tests/preprocessed.test.js`, `tests/delivery-ops.test.js`, `tests/validation-ops.test.js`, `tests/validation.test.js`

- [ ] **Step 1: Write the failing tests.**

`tests/preprocessed.test.js` (the file's `area()` and `collect()` helpers exist):

```js
test('a work area that is a symbolic link is refused, even to a real directory', () => {
  const link = join(mkdtempSync(join(tmpdir(), 'linked-')), 'preprocess');
  symlinkSync(area(), link);
  assert.throws(() => collect(link, () => ({ files: [] })), /The preprocessing work area .*linked-[^/]*\/preprocess is a symbolic link; preprocess in the directory itself/);
});

test('collectPreprocessed hands the type the report it is given', () => {
  const workArea = area();
  const seen = [];
  const datasetType = { preprocessedFiles: (proposalDir, location, ctx) => { seen.push(ctx); return { files: [] }; } };
  const report = { proposalTree: 't' };
  collectPreprocessed({ datasetType, proposalDir: '/p', proposalId: 'GCA_1', locations: [LOC], workArea, report });
  assert.deepEqual(seen, [{ workArea, report }]);
});
```

`tests/delivery-ops.test.js` (the `withHook`, `workArea`, `prepare`, `setup` helpers exist):

```js
test('prepareDelivery hands the hook the current verification report and records the commit it prepared against', async () => {
  const s = setup();
  mkdirSync(workArea(s), { recursive: true });
  const { loadType, calls } = withHook(() => ({ files: [], problems: [] }));
  const { record } = await prepare(s, { loadType });
  assert.equal(calls[0].ctx.report.proposalTree, s.git.objectId('origin/master', 'Proposals/PRJNA000002'));
  assert.equal(record.againstCommit, execFileSync('git', ['-C', s.repo, 'rev-parse', 'origin/rebuild02'], { encoding: 'utf-8' }).trim());
  assert.equal(JSON.parse(readFileSync(join(s.typeDir, 'delivery/PRJNA000002/delivery.json'), 'utf-8')).againstCommit, record.againstCommit);
});
```

`tests/validation-ops.test.js`: give `deliveryStub` an `againstCommit` option:

```js
const deliveryStub = (git, { tree, none = false, against = 'origin/master', againstCommit } = {}) => ({
  read: () => none ? null : { record: { proposalTree: tree ?? git.objectId('origin/master', 'Proposals/PRJNA000002'), against, ...(againstCommit ? { againstCommit } : {}), settlement: [{ proposed: 'tfakST1', abbrev: 'tfakST1' }], build: '02', release: '2026-10', corpusStep: 'ssh yew x', handoff: 'Copy\n  rsync -a' }, sha: 'e'.repeat(64), dir: '/ws/delivery/PRJNA000002' }
});
```

and append:

```js
test('markReady reads classes at the commit the delivery was prepared at, even after the rebuild branch moves', async () => {
  const { repo, git } = setupMerged();
  execFileSync('git', ['-C', repo, 'push', '-q', 'origin', 'HEAD:rebuild02']);
  git.fetch();
  const prepared = execFileSync('git', ['-C', repo, 'rev-parse', 'origin/rebuild02'], { encoding: 'utf-8' }).trim();
  execFileSync('git', ['-C', repo, 'rm', '-q', CLASSES_RELATIVE_PATH]);
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'classes gone from the rebuild branch']);
  execFileSync('git', ['-C', repo, 'push', '-q', 'origin', 'HEAD:rebuild02']);
  execFileSync('git', ['-C', repo, 'reset', '-q', '--hard', 'HEAD~1']);
  git.fetch();
  const ticket = stubTicket({ status: 'verifying', existingComments: [formatReportComment(reportFor(git, 'pass'))] });
  const result = await markReady({ git, ticket, proposalId: 'PRJNA000002', workspace: disposalStub(), delivery: deliveryStub(git, { against: 'origin/rebuild02', againstCommit: prepared }) });
  assert.equal(result.status, 'ready');
});

test('markReady refuses a delivery prepared at a commit this clone lacks, before posting anything', async () => {
  const { git } = setupMerged();
  const ticket = stubTicket({ status: 'verifying', existingComments: [formatReportComment(reportFor(git, 'pass'))] });
  await assert.rejects(markReady({ git, ticket, proposalId: 'PRJNA000002', workspace: disposalStub(), delivery: deliveryStub(git, { against: 'origin/master', againstCommit: '0'.repeat(40) }) }),
    /The delivery of PRJNA000002 was prepared against origin\/master at 0{40}, which does not exist here; fetch it, or run prepare-delivery\.js again/);
  assert.equal(ticket.comments(), 0);
});
```

`tests/validation.test.js`:

```js
test('formatDeliveryComment adds one provenance line, naming a summary several directories share once', () => {
  const record = {
    proposalTree: 't', against: 'origin/rebuild02', settlement: [{ proposed: 'a', abbrev: 'a' }], build: '02', release: '2026-10', corpusStep: null, handoff: 'Copy',
    provenance: { 'P/a/x/final': { genomeBuild: 'g', trial: 't', database: 'UniDB' }, 'P/a/y/final': { genomeBuild: 'g', trial: 't', database: 'UniDB' } }
  };
  const text = formatDeliveryComment(record, 'e'.repeat(64));
  const lines = text.split('\n');
  assert.equal(lines[2], 'Provenance: genomeBuild g, trial t, database UniDB');
  assert.equal(lines.filter((l) => l.startsWith('Provenance:')).length, 1);
  assert.equal(latestDeliveryRecord([text]).record.build, '02');
  const { provenance, ...plain } = record;
  assert.equal(formatDeliveryComment(plain, 'e'.repeat(64)).includes('Provenance'), false);
});
```

- [ ] **Step 2: Run** `node --test --test-reporter=dot --test-global-setup=W/tests/globalSetup.js W/tests/preprocessed.test.js W/tests/delivery-ops.test.js W/tests/validation-ops.test.js W/tests/validation.test.js`; expect the new tests to FAIL.

- [ ] **Step 3: Implement.**

`shared/scripts/lib/git-ops.js`, beside `refExists`:

```js
    /** The commit ref names now. */
    commitOf: (ref) => git('rev-parse', '--verify', `${ref}^{commit}`),
```

`shared/scripts/lib/preprocessed.js`: add `lstatSync` to the `node:fs` import; the signature becomes `collectPreprocessed({ datasetType, proposalDir, proposalId, locations, workArea, rendered = {}, report = null })`; before the existing missing-work-area check add

```js
  let link = false;
  try { link = lstatSync(workArea).isSymbolicLink(); } catch { link = false; }
  if (link) throw new Error(`The preprocessing work area ${workArea} is a symbolic link; preprocess in the directory itself, not a link to it`);
```

and the hook call becomes `datasetType.preprocessedFiles(proposalDir, location, { workArea, report })`. Add to its doc comment: "report is the verification report prepare-delivery checked, handed to the type".

`shared/scripts/lib/delivery-ops.js`:
- Replace `if (validatorsFor(manifest.datasetType).length) await currentReport(git, ticket, ref, proposalId);` with `const report = validatorsFor(manifest.datasetType).length ? await currentReport(git, ticket, ref, proposalId) : null;`.
- In the `collectPreprocessed({...})` call add `report`.
- In `record`, right after `against,` add `againstCommit: git.commitOf(against),`.

`shared/scripts/lib/verification-ops.js` in `markReady`, replace the `classRef` lines and the refusal with:

```js
  // Classes come from the commit prepare-delivery checked them at, so a moved rebuild branch can't disagree.
  const classRef = prepared?.record.againstCommit ?? prepared?.record.against ?? 'origin/master';
  if (!git.refExists(classRef)) {
    const where = prepared?.record.againstCommit ? `${prepared.record.against} at ${classRef}` : classRef;
    throw new Error(`The delivery of ${proposalId} was prepared against ${where}, which does not exist here; fetch it, or run prepare-delivery.js again`);
  }
```

Update `markReady`'s doc comment: "entries are checked against classes.xml at the delivery's againstCommit (its against ref for an older record; origin/master when there is no delivery)".

`shared/scripts/lib/validation.js`, above `formatDeliveryComment`:

```js
/** One line naming what produced a preprocessed delivery; a summary several delivery directories share is named once. */
function provenanceLine(provenance) {
  const summaries = [...new Set(Object.values(provenance).map((p) => JSON.stringify(p)))].map((p) => JSON.parse(p));
  return `Provenance: ${summaries.map((p) => Object.entries(p).map(([k, v]) => `${k} ${v}`).join(', ')).join('; ')}`;
}
```

and in `formatDeliveryComment`, between the `**Delivery** …` line and the blank line:

```js
    ...(record.provenance && Object.keys(record.provenance).length ? [provenanceLine(record.provenance)] : []),
```

`docs/development.md`: in the hook table, change the `preprocessedFiles(dir, location, { workArea })` row's first cell to `preprocessedFiles(dir, location, { workArea, report })` and append to its text: "`report` is the current verification report (null for a type without validators). A symlinked work area is refused."

- [ ] **Step 4: Run** `node --test --test-reporter=dot --test-global-setup=W/tests/globalSetup.js W/tests/preprocessed.test.js W/tests/delivery-ops.test.js W/tests/delivery-roundtrip.test.js W/tests/validation-ops.test.js W/tests/validation.test.js W/tests/import-graph.test.js`; expect PASS. The roundtrip test proves an rnaseq delivery and its comment are unchanged but for `againstCommit`; if it pins `delivery.json` byte for byte, add `againstCommit` to its expectation the same way the new delivery-ops test reads it.

- [ ] **Step 5: Commit.**
  `git -C W add shared/scripts/lib docs/development.md tests/preprocessed.test.js tests/delivery-ops.test.js tests/validation-ops.test.js tests/validation.test.js tests/delivery-roundtrip.test.js skills`
  `git -C W commit -m "Delivery records its commit, names provenance on the ticket, refuses a symlinked work area"` (with the trailer).

---

### Task 8: The genome delivery hook

**Files:**
- Create: `shared/scripts/dataset-types/genome-assembly/delivery.js`
- Modify: `shared/scripts/dataset-types/genome-assembly.js`, `package.json`, `docs/development.md`
- Create: `tests/genome-delivery.test.js`

- [ ] **Step 1: Write the failing tests** — `tests/genome-delivery.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import * as genome from '../shared/scripts/dataset-types/genome-assembly.js';
import { entryDeliveries, datasetsOf, constantsOf } from '../shared/scripts/dataset-types/_common.js';
import { parseDatasetClass } from '../shared/scripts/lib/dataset-classes.js';
import { collectPreprocessed } from '../shared/scripts/lib/preprocessed.js';
import { readPreprocessed } from '../shared/scripts/dataset-types/genome-assembly/preprocess.js';
import { fixtures } from './helpers.js';
import { genomeWorkArea, amendedProposal, editJson } from './genome-work-area.js';

const classes = readFileSync(join(fixtures, 'classes.xml'), 'utf-8');
const classOf = (className) => parseDatasetClass(classes, className);

/** An amended proposal's entry locations, and a report that validated its work area as it is now. */
function delivering(options) {
  const workArea = genomeWorkArea(options);
  const { dir, manifest } = amendedProposal(workArea);
  const locations = entryDeliveries(manifest, datasetsOf(dir, manifest), { classOf, constants: constantsOf(dir), datasetType: genome });
  return { workArea, dir, locations, report: { preprocess: readPreprocessed(workArea).sha256 } };
}
const collect = (d, report = d.report) => collectPreprocessed({ datasetType: genome, proposalDir: d.dir, proposalId: 'GCA_000001.1', locations: d.locations, workArea: d.workArea, report });
const G = 'FungiDB/tfakST-1/genome';

test('the genome hook delivers each partition\'s files and each functional file under its entry, with provenance', () => {
  const d = delivering();
  const { sources, provenance } = collect(d);
  const from = (rel) => realpathSync(join(d.workArea, rel));
  assert.deepEqual(sources, {
    [`${G}/chromosome_GenBank_fasta/2024-03-05/final/genome.fasta`]: from('final/primary_chromosome/genome.fasta'),
    [`${G}/chromosome_GenBank_fasta/2024-03-05/final/chromosomeMap.txt`]: from('final/primary_chromosome/chromosomeMap.txt'),
    [`${G}/contig_GenBank_fasta/2024-03-05/final/genome.fasta`]: from('final/secondary_contig/genome.fasta'),
    [`${G}/mitochondrial_chromosome_GenBank_fasta/2024-03-05/final/genome.fasta`]: from('final/organelle_mitochondrion/genome.fasta'),
    [`${G}/chromosome_GenBank_gff3/2024-03-05/final/genome.gff`]: from('final/primary_chromosome/genome.gff'),
    [`${G}/chromosome_GenBank_gff3/2024-03-05/final/transcriptInfoAndIds`]: from('final/primary_chromosome/transcriptInfoAndIds'),
    [`${G}/contig_GenBank_gff3/2024-03-05/final/genome.gff`]: from('final/secondary_contig/genome.gff'),
    [`${G}/contig_GenBank_gff3/2024-03-05/final/transcriptInfoAndIds`]: from('final/secondary_contig/transcriptInfoAndIds'),
    'FungiDB/tfakST-1/function/GenBank_product_names/2024-04-01/final/products.txt': from('final/function/productNames/GenBank/products.txt'),
    'FungiDB/tfakST-1/function/GenBank_gene_names/2024-04-01/final/geneName.txt': from('final/function/geneName/GenBank/geneName.txt'),
    'FungiDB/tfakST-1/dbxref/uniprot_from_annotation/2024-04-01/final/mapping.txt': from('final/function/dbxref_simple/uniprot_from_annotation/mapping.txt'),
    'FungiDB/tfakST-1/dbxref/ensemblgenomes_gn_from_annotation/2024-04-01/final/mapping.txt': from('final/function/dbxref_simple/ensemblgenomes_gn_from_annotation/mapping.txt')
  });
  const summary = { ...d.report.preprocess, database: 'UniDB_test', release: '20261105T000000', generator: '4.0.0' };
  assert.deepEqual(Object.values(provenance), d.locations.map(() => summary));
});

test('the hook refuses a work area that changed since validation, naming it once per delivery, and a report without preprocessing', () => {
  const d = delivering();
  editJson(join(d.workArea, 'trial/trial.json'), (r) => ({ ...r, kept: true }));
  assert.throws(() => collect(d), (e) => (e.message.match(/the work area changed since validation; validate again/g) ?? []).length === 1);
  assert.throws(() => collect(delivering(), { proposalTree: 't' }), /the verification report records no preprocessing; validate again/);
});

test('the hook refuses an undeliverable or unreadable work area under the entry label', () => {
  const failed = delivering();
  editJson(join(failed.workArea, 'trial/trial.json'), (r) => ({ ...r, result: 'failed' }));
  assert.throws(() => collect(failed, { preprocess: readPreprocessed(failed.workArea).sha256 }),
    /GCA_000001\.1: the preprocessing work area cannot be delivered:\n  - fasta_primary_genome_sequence \$\$genomeSource\$\$ \(chromosome\): trial\/trial\.json: the trial result is "failed"/);
  const d = delivering();
  rmSync(join(d.workArea, 'functional.json'));
  assert.throws(() => collect(d), /functional\.json: is missing/);
});

test('the hook refuses an entry with no partition, no features, no functional dataset, or another file name', () => {
  const d = delivering();
  const at = (className) => d.locations.find((l) => l.entry.datasetClass === className);
  const withEntry = (location, entry) => ({ ...location, entry: { ...location.entry, ...entry } });
  const strays = [
    withEntry(at('fasta_secondary_genome'), { props: { ...at('fasta_secondary_genome').entry.props, soTerm: 'supercontig' } }),
    withEntry(at('fasta_organelle_genome'), { datasetClass: 'NoPreprocess_organelle_genome_features' }),
    withEntry(at('productNames'), { name: 'RefSeq' }),
    { ...at('geneName'), file: 'names.txt' }
  ];
  assert.throws(() => collect({ ...d, locations: strays }), (e) => [
    /no partition in genome-build\.json is secondary with soTerm supercontig; re-run amend-proposal\.js/,
    /partition organelle_mitochondrion has no features to load; re-run amend-proposal\.js/,
    /functional\.json has no productNames dataset named RefSeq; re-run amend-proposal\.js/,
    /functional\.json gives final\/function\/geneName\/GenBank\/geneName\.txt, but the class loads names\.txt/
  ].every((re) => re.test(e.message)));
});
```

- [ ] **Step 2: Run** `node --test --test-reporter=dot --test-global-setup=W/tests/globalSetup.js W/tests/genome-delivery.test.js`; expect FAIL (`preprocessedFiles` is not a genome hook, so `collectPreprocessed` throws calling it).

- [ ] **Step 3: Implement** — `shared/scripts/dataset-types/genome-assembly/delivery.js`:

```js
import { basename, join } from 'node:path';
import { partitionName } from '../../genome/genome-build.js';
import { preprocessedProblems, readPreprocessed } from './preprocess.js';
import { isFeaturesClass, isSequenceClass, partitionOf, roleOf } from './entries.js';

const RECORDS = ['genomeBuild', 'trial', 'functional'];
const AMEND_AGAIN = 're-run amend-proposal.js';
const checked = new WeakMap();

/** The records and the problems shared by every location; one prepare-delivery passes one report, so this runs once per delivery. */
function checkedRecords(workArea, report) {
  if (report && checked.has(report)) return checked.get(report);
  let result;
  try {
    const records = readPreprocessed(workArea);
    const problems = preprocessedProblems(records, workArea);
    const validated = report?.preprocess;
    if (!validated) problems.push('the verification report records no preprocessing; validate again');
    else if (RECORDS.some((k) => validated[k] !== records.sha256[k])) problems.push('the work area changed since validation; validate again');
    result = { records, problems, reported: false };
  } catch (e) {
    result = { records: null, problems: [e.message], reported: false };
  }
  if (report) checked.set(report, result);
  return result;
}

function partitionFiles(location, records, workArea) {
  const { entry } = location;
  const part = partitionOf(entry, records.genomeBuild.partitions);
  if (!part) return { problem: `no partition in genome-build.json is ${roleOf(entry.datasetClass)} with soTerm ${entry.props.soTerm}; ${AMEND_AGAIN}` };
  const from = (file) => join(workArea, part.dir, file);
  if (isSequenceClass(entry.datasetClass)) {
    if (location.file) return { files: [{ path: location.file, from: from(part.final.fasta) }] };
    return {
      files: [
        { path: 'genome.fasta', from: from(part.final.fasta) },
        ...(part.final.chromosomeMap ? [{ path: 'chromosomeMap.txt', from: from(part.final.chromosomeMap) }] : [])
      ]
    };
  }
  if (!part.final.gff) return { problem: `partition ${partitionName(part)} has no features to load; ${AMEND_AGAIN}` };
  return {
    files: [
      { path: 'genome.gff', from: from(part.final.gff) },
      ...Object.keys(records.trial.outputs[partitionName(part)] ?? {}).map((file) => ({ path: file, from: from(file) }))
    ]
  };
}

function functionalFiles(location, records, workArea) {
  const { entry } = location;
  const dataset = records.functional.datasets.find((d) => d.datasetClass === entry.datasetClass && d.name === entry.name);
  if (!dataset) return { problem: `functional.json has no ${entry.datasetClass} dataset named ${entry.name}; ${AMEND_AGAIN}` };
  if (basename(dataset.file) !== location.file) return { problem: `functional.json gives ${dataset.file}, but the class loads ${location.file}` };
  return { files: [{ path: location.file, from: join(workArea, dataset.file) }] };
}

/**
 * prepare-delivery: one entry location's files from the work area. Sequence and features entries take their
 * partition's final files (and the trial's transcriptInfoAndIds), functional entries their functional.json file.
 * Problems: the work area's preprocessedProblems, a work area changed since the report validated it, an entry with nothing to deliver.
 */
export function preprocessedFiles(proposalDir, location, { workArea, report = null }) {
  const shared = checkedRecords(workArea, report);
  const problems = shared.reported ? [] : [...shared.problems];
  shared.reported = Boolean(report);
  if (!shared.records) return { files: [], problems, provenance: null };
  const { records } = shared;
  const own = isSequenceClass(location.entry.datasetClass) || isFeaturesClass(location.entry.datasetClass)
    ? partitionFiles(location, records, workArea)
    : functionalFiles(location, records, workArea);
  return {
    files: own.files ?? [],
    problems: [...problems, ...(own.problem ? [own.problem] : [])],
    provenance: { ...records.sha256, database: records.trial.database, release: records.trial.release, generator: records.genomeBuild.generator?.version ?? null }
  };
}
```

In `shared/scripts/dataset-types/genome-assembly.js`, add `export { preprocessedFiles } from './genome-assembly/delivery.js';` beside the other hook.

`docs/development.md`, after the `preprocessedFiles` row, add:

```markdown
| `preprocessedAmendment({ workArea, proposalDir, manifest, given })` | 2 | optional; `{ entries, constants, organism, sources }` that `amend-proposal.js` writes into `curated/datasets.json` and `curated/organism.json` from the work area. Genome: `genome-assembly/amendment.js` |
```

- [ ] **Step 4: Register.** In `package.json` `sharedFiles`, add `scripts/dataset-types/genome-assembly/delivery.js` listing `"propose-genome-assembly", "propose-bulk-rnaseq", "propose-dnaseq", "propose-chipseq", "load-proposals", "verify-bulk-rnaseq"`. Run `node W/bin/sync-shared.js`.

- [ ] **Step 5: Run** `node --test --test-reporter=dot --test-global-setup=W/tests/globalSetup.js W/tests/genome-delivery.test.js W/tests/preprocessed.test.js W/tests/import-graph.test.js W/tests/skill-imports.test.js`; expect PASS.

- [ ] **Step 6: Commit.**
  `git -C W add shared/scripts/dataset-types skills package.json docs/development.md tests/genome-delivery.test.js`
  `git -C W commit -m "Genome delivery hook: partition and functional files from the work area"` (with the trailer).

---

### Task 9: Load creates a new genome's organism file

**Files:**
- Create: `shared/scripts/dataset-types/genome-assembly/organism-file.js`
- Modify: `shared/scripts/dataset-types/genome-assembly.js`, `shared/scripts/lib/dataset-classes.js`, `shared/scripts/lib/project-organisms.js`, `shared/scripts/lib/load-ops.js`, `shared/scripts/lib/build-fitness.js`, `shared/scripts/load-proposal.js`, `package.json`, `docs/development.md`
- Modify: `tests/fixtures/classes.xml` (add `organism`, `referenceStrain`)
- Create: `tests/genome-organism-file.test.js`
- Modify: `tests/load-ops.test.js`, `tests/build-fitness.test.js`

- [ ] **Step 1: Add the classes to the fixture.** In `tests/fixtures/classes.xml`, insert before `</datasetClasses>`:

```xml
  <datasetClass class="organism" category="organism" datasetFileHint="">
    <purpose>Cut from VEuPathDatasets classes.xml: its props in their order there, descriptions dropped.</purpose>
    <prop name="organismAbbrev"/>
    <prop name="projectName"/>
    <prop name="publicOrganismAbbrev"/>
    <prop name="organismFullName"/>
    <prop name="organismNameForFiles"/>
    <prop name="ncbiTaxonId"/>
    <prop name="speciesNcbiTaxonId"/>
    <prop name="isReferenceStrain"/>
    <prop name="referenceStrainOrganismAbbrev"/>
    <prop name="isFamilyRepresentative"/>
    <prop name="familyRepOrganismAbbrev"/>
    <prop name="familyNcbiTaxonIds"/>
    <prop name="familyNameForFiles"/>
    <prop name="isAnnotatedGenome"/>
    <prop name="hasTemporaryNcbiTaxonId"/>
    <prop name="orthomclAbbrev"/>
    <prop name="strainAbbrev"/>
    <prop name="genomeSource"/>
    <prop name="genomeVersion"/>
    <prop name="annotationIncludesTRNAs"/>
    <prop name="runExportPred"/>
    <prop name="taxonFilterForNRProteinsAlignedToGenome"/>
    <prop name="isHugeGenome"/>
    <prop name="maxIntronSize"/>
    <prop name="speciesNcbiTaxonId"/>
    <prop name="isNotEbiGenome"/>
    <prop name="isCore"/>
    <graphTemplateFile name="project.xml"/>
    <datasetLoader datasetName="${organismAbbrev}_RSRC" version="${genomeVersion}" plugin="ApiCommonData::Load::Plugin::LoadNothing" scope="organism" type="organism" subType="" organismAbbrev="">
      <manualGet fileOrDir="common/empty">
      </manualGet>
    </datasetLoader>
  </datasetClass>
  <datasetClass class="referenceStrain" category="" datasetFileHint="">
    <purpose></purpose>
    <prop name="organismAbbrev">&organismAbbrev;</prop>
    <prop name="isAnnotatedGenome">&isAnnotatedGenome;</prop>
    <graphTemplateFile name="project.xml"/>
  </datasetClass>
```

- [ ] **Step 2: Write the failing unit tests** — `tests/genome-organism-file.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as genome from '../shared/scripts/dataset-types/genome-assembly.js';
import { insertAfterConstants } from '../shared/scripts/dataset-types/genome-assembly/organism-file.js';
import { readClassProps, CLASSES_RELATIVE_PATH } from '../shared/scripts/lib/dataset-classes.js';
import { organismDatasetProps } from '../shared/scripts/lib/project-organisms.js';
import { fixtures } from './helpers.js';
import { genomeWorkArea, amendedProposal } from './genome-work-area.js';

/** A checkout holding the fixture classes.xml and FungiDB project file. */
function fixtureRepo() {
  const repo = mkdtempSync(join(tmpdir(), 'organism-file-'));
  mkdirSync(join(repo, 'Model/lib/xml/datasetClass'), { recursive: true });
  cpSync(join(fixtures, 'classes.xml'), join(repo, CLASSES_RELATIVE_PATH));
  mkdirSync(join(repo, 'Datasets/lib/xml/datasets/FungiDB'), { recursive: true });
  cpSync(join(fixtures, 'FungiDB.xml'), join(repo, 'Datasets/lib/xml/datasets/FungiDB.xml'));
  return repo;
}

test('readClassProps lists a class\'s props in order, a repeated one once', () => {
  const repo = fixtureRepo();
  const props = readClassProps(repo, 'organism');
  assert.equal(props.length, 26);
  assert.deepEqual(props.slice(0, 3), ['organismAbbrev', 'projectName', 'publicOrganismAbbrev']);
  assert.equal(props.filter((p) => p === 'speciesNcbiTaxonId').length, 1);
  assert.deepEqual(readClassProps(repo, 'referenceStrain'), ['organismAbbrev', 'isAnnotatedGenome']);
  assert.throws(() => readClassProps(repo, 'nope'), /Dataset class "nope" not found/);
});

test('organismDatasetProps reads each organism dataset of a project file, skipping commented-out ones', () => {
  const xml = readFileSync(join(fixtures, 'FungiDB.xml'), 'utf-8')
    .replace('</datasets>', '  <!-- <dataset class="organism"><prop name="organismAbbrev">gone</prop></dataset> -->\n</datasets>');
  assert.deepEqual(organismDatasetProps(xml).map((p) => [p.organismAbbrev, p.familyNcbiTaxonIds]), [['tfakST1', '998']]);
});

test('insertAfterConstants places a block after the last top-level constant, one blank line either side', () => {
  const xml = '<?xml version="1.0"?>\n<datasets>\n  <constant name="projectName" value="FungiDB"/>\n  <constant name="x" value="1"/>\n\n  <dataset class="organism">\n  </dataset>\n</datasets>\n';
  assert.equal(insertAfterConstants(xml, '  <dataset class="new">\n  </dataset>'),
    '<?xml version="1.0"?>\n<datasets>\n  <constant name="projectName" value="FungiDB"/>\n  <constant name="x" value="1"/>\n\n  <dataset class="new">\n  </dataset>\n\n  <dataset class="organism">\n  </dataset>\n</datasets>\n');
  assert.throws(() => insertAfterConstants('<datasets>\n</datasets>\n', 'x'), /has no top-level <constant>/);
});

test('newOrganismFiles refuses an organism whose file already exists', () => {
  const repo = fixtureRepo();
  writeFileSync(join(repo, 'Datasets/lib/xml/datasets/FungiDB/tfakST-1.xml'), '<datasets>\n</datasets>\n');
  const { dir, manifest } = amendedProposal(genomeWorkArea());
  const settled = { ...manifest, organisms: [{ ...manifest.organisms[0], organismAbbrev: 'tfakST-1' }] };
  assert.throws(() => genome.newOrganismFiles({ proposalDir: dir, manifest: settled, organism: 'tfakST-1', repoPath: repo }),
    /Datasets\/lib\/xml\/datasets\/FungiDB\/tfakST-1\.xml already exists; tfakST-1 is new in GCA_000001\.1, so it may already be loaded; ask before continuing/);
});
```

- [ ] **Step 3: Write the failing load and build-fitness tests.**

Append to `tests/load-ops.test.js` (add `import { PHASE1_RECORD } from './genome-work-area.js';`):

```js
// --- a new genome's organism file --------------------------------------------

const NCBI_URLS = { type: 'url', urls: ['https://ftp.ncbi.nlm.nih.gov/genomes/all/GCA/000/000/001/GCA_000001.1_Tfak/GCA_000001.1_Tfak_genomic.gff.gz'] };
const GENOME_ENTRIES = [
  { datasetClass: 'fasta_primary_genome_sequence', name: '$$genomeSource$$', version: '$$genomeVersion$$', props: { ncbiTaxonId: '$$ncbiTaxonId$$', table: 'DoTS::ExternalNASequence', soTerm: 'chromosome', sourceIdRegex: '^>(\\S+)', releaseDate: '' }, source: NCBI_URLS },
  { datasetClass: 'NoPreprocess_primary_genome_features', name: '$$genomeSource$$', version: '$$genomeVersion$$', props: { ncbiTaxonId: '$$ncbiTaxonId$$', soTerm: 'chromosome', source: '$$genomeSource$$', mapFile: 'genemRNAExonCDS2Gus.xml' }, source: NCBI_URLS },
  { datasetClass: 'productNames', name: 'GenBank', version: '$$functAnnotVersion$$', props: {}, source: NCBI_URLS }
];
const AMENDED_RECORD = {
  ...PHASE1_RECORD, schemaVersion: 2, annotationIncludesTRNAs: 'true', maxIntronSize: '1000', isHugeGenome: 'false', isNotEbiGenome: 'true',
  isCore: 'false', runExportPred: 'false', isFamilyRepresentative: 'false', familyNcbiTaxonIds: '', familyNameForFiles: '', orthomclAbbrev: 'tfak',
  constants: { genomeSource: 'GenBank', genomeVersion: '2024-03-05', functAnnotVersion: '2024-04-01' }
};
const REFERENCE_RECORD = { isReferenceStrain: 'true', referenceStrainOrganismAbbrev: undefined, speciesNcbiTaxonId: '999123', isFamilyRepresentative: 'true', familyRepOrganismAbbrev: '', familyNcbiTaxonIds: '999123', familyNameForFiles: 'Testaceae2' };

/** GCA_000001.1 on master as verification leaves it: three entries and an amended organism record. */
function amendedGenome({ record = {}, entries = GENOME_ENTRIES } = {}) {
  const setup = setupRepo();
  editMasterGenome(setup.repo, { record, entries });
  return setup;
}
function editMasterGenome(repo, { record = {}, entries = GENOME_ENTRIES }) {
  editOnMaster(repo, () => {
    const dir = join(repo, 'Proposals/GCA_000001.1/curated');
    writeFileSync(join(dir, 'datasets.json'), JSON.stringify({ schemaVersion: 2, datasets: entries }, null, 2) + '\n');
    writeFileSync(join(dir, 'organism.json'), JSON.stringify({ ...AMENDED_RECORD, ...record }, null, 2) + '\n');
  }, 'amend GCA_000001.1');
}
const genomeRecorded = (repo, opts) => recorded(repo, { accession: 'GCA_000001.1', settlement: [{ proposed: 'tfakST-1', abbrev: 'tfakST-1' }], ...opts });
const loadGenome = (git, repo, opts = {}) => loadProposal({ git, ticket: genomeRecorded(repo), repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, proposalId: 'GCA_000001.1', ...opts });
const LOADED = 'origin/load/GCA_000001.1';
const PROJECT_FILE = 'Datasets/lib/xml/datasets/FungiDB.xml';
const NEW_FILE = 'Datasets/lib/xml/datasets/FungiDB/tfakST-1.xml';
const organismBlock = (xml, abbrev) => new RegExp(`<dataset class="organism">\\n    <prop name="organismAbbrev">${abbrev}</prop>[\\s\\S]*?</dataset>`).exec(xml)?.[0];
const propsOf = (block) => [...block.matchAll(/<prop name="(\w+)">([^<]*)<\/prop>/g)].map(([, k, v]) => [k, v]);

test('a new genome load creates its organism file and appends a non-reference strain to the project file', async () => {
  const { repo } = amendedGenome();
  const gh = ghStub({ url: 'https://github.com/VEuPathDB/VEuPathDatasets/pull/30' });
  const git = createGit(repo, { exec: gh.exec });
  await loadGenome(git, repo);
  assert.deepEqual(loadCommitFiles(repo), [PROJECT_FILE, NEW_FILE, 'Model/lib/xml/datasetPresenters/FungiDB.xml']);
  assert.equal(git.headSubject(), 'Load GCA_000001.1: add tfakST-1_primary_genome_RSRC to FungiDB, 3 datasets to tfakST-1');

  const organismFile = git.showFile(LOADED, NEW_FILE);
  assert.ok(organismFile.startsWith([
    '<?xml version="1.0"?>', '<datasets>',
    '  <constant name="organismAbbrev" value="tfakST-1"/>', '  <constant name="strainAbbrev" value="ST-1"/>',
    '  <constant name="referenceStrainOrganismAbbrev" value="tfakST1"/>', '  <constant name="familyRepOrganismAbbrev" value="tfakST1"/>',
    '  <constant name="projectName" value="FungiDB"/>', '  <constant name="ncbiTaxonId" value="999001"/>', '  <constant name="speciesNcbiTaxonId" value="999000"/>',
    '  <constant name="genomeSource" value="GenBank"/>', '  <constant name="genomeVersion" value="2024-03-05"/>', '  <constant name="functAnnotVersion" value="2024-04-01"/>',
    '', '  <dataset class="validateOrganismInfo">'
  ].join('\n')), organismFile);
  assert.deepEqual([...organismFile.matchAll(/<dataset class="([^"]+)">/g)].map((m) => m[1]), [
    'validateOrganismInfo', 'ECAssocFromUniprot', 'transcriptsFromReferenceStrain',
    'fasta_primary_genome_sequence', 'NoPreprocess_primary_genome_features', 'productNames'
  ]);
  assert.ok(organismFile.endsWith('  </dataset>\n</datasets>\n'));

  const project = git.showFile(LOADED, PROJECT_FILE);
  assert.match(project, /<prop name="isAnnotatedGenome">true<\/prop>\n  <\/dataset>\n\n  <dataset class="organism">\n    <prop name="organismAbbrev">tfakST-1<\/prop>[\s\S]*<\/dataset>\n<\/datasets>\n$/);
  assert.equal((project.match(/<dataset class="referenceStrain">/g) ?? []).length, 1);
  assert.deepEqual(propsOf(organismBlock(project, 'tfakST-1')), [
    ['organismAbbrev', 'tfakST-1'], ['projectName', '$$projectName$$'], ['publicOrganismAbbrev', 'tfakST-1'], ['organismFullName', 'Testus fakeus ST-1'],
    ['organismNameForFiles', 'TfakeusST-1'], ['ncbiTaxonId', '999001'], ['speciesNcbiTaxonId', '999000'], ['isReferenceStrain', 'false'],
    ['referenceStrainOrganismAbbrev', 'tfakST1'], ['isFamilyRepresentative', 'false'], ['familyRepOrganismAbbrev', 'tfakST1'], ['familyNcbiTaxonIds', ''],
    ['familyNameForFiles', ''], ['isAnnotatedGenome', 'true'], ['hasTemporaryNcbiTaxonId', 'false'], ['orthomclAbbrev', 'tfak'], ['strainAbbrev', 'ST-1'],
    ['genomeSource', 'GenBank'], ['genomeVersion', '2024-03-05'], ['annotationIncludesTRNAs', 'true'], ['runExportPred', 'false'],
    ['taxonFilterForNRProteinsAlignedToGenome', 'Testus'], ['isHugeGenome', 'false'], ['maxIntronSize', '1000'], ['isNotEbiGenome', 'true'], ['isCore', 'false']
  ]);
  const body = prBodyOf(gh);
  assert.match(body, /^Organism file created: `Datasets\/lib\/xml\/datasets\/FungiDB\/tfakST-1\.xml`$/m);
  assert.match(body, /^Organism `tfakST-1` added to `Datasets\/lib\/xml\/datasets\/FungiDB\.xml`$/m);
  assert.equal(git.isClean(), true);
});

test('a reference strain\'s organism goes after the project constants with its referenceStrain, and its file loads dbEST', async () => {
  const { repo } = amendedGenome({ record: REFERENCE_RECORD });
  const git = createGit(repo, { exec: ghStub().exec });
  await loadGenome(git, repo);
  const project = git.showFile(LOADED, PROJECT_FILE);
  assert.match(project, /<constant name="projectName" value="FungiDB"\/>\n\n  <dataset class="organism">\n    <prop name="organismAbbrev">tfakST-1<\/prop>/);
  assert.match(project, /<dataset class="referenceStrain">\n    <prop name="organismAbbrev">tfakST-1<\/prop>\n    <prop name="isAnnotatedGenome">true<\/prop>\n  <\/dataset>\n\n  <dataset class="organism">\n    <prop name="organismAbbrev">tfakST1<\/prop>/);
  const props = Object.fromEntries(propsOf(organismBlock(project, 'tfakST-1')));
  assert.equal(props.referenceStrainOrganismAbbrev, 'tfakST-1');
  assert.equal(props.familyRepOrganismAbbrev, 'tfakST-1');
  const organismFile = git.showFile(LOADED, NEW_FILE);
  assert.match(organismFile, /<constant name="referenceStrainOrganismAbbrev" value="tfakST-1"\/>/);
  assert.deepEqual([...organismFile.matchAll(/<dataset class="([^"]+)">/g)].map((m) => m[1]).slice(0, 4),
    ['validateOrganismInfo', 'ECAssocFromUniprot', 'referenceStrain-dbEST', 'transcriptsFromReferenceStrain']);
});

test('a new genome is refused before any branch when the project already has it, lacks its reference strain, has its orthomclAbbrev, or its record is unamended', async () => {
  const cases = [
    [{}, (xml) => xml.replace('</datasets>', '  <dataset class="organism">\n    <prop name="organismAbbrev">tfakST-1</prop>\n  </dataset>\n</datasets>'),
      /tfakST-1 is already an organism in Datasets\/lib\/xml\/datasets\/FungiDB\.xml; it may already be loaded; ask before continuing/],
    [{ referenceStrainOrganismAbbrev: 'tfakNOPE' }, null,
      /tfakST-1's reference strain tfakNOPE is not an organism in Datasets\/lib\/xml\/datasets\/FungiDB\.xml; load the reference strain first, or amend the organism record/],
    [{}, (xml) => xml.replace('<prop name="isReferenceStrain">true</prop>', '<prop name="isReferenceStrain">true</prop>\n    <prop name="orthomclAbbrev">tfak</prop>'),
      /orthomclAbbrev tfak is already used by tfakST1 in Datasets\/lib\/xml\/datasets\/FungiDB\.xml; choose another with amend-proposal\.js --organism orthomclAbbrev=<abbrev> and publish/],
    [{ schemaVersion: 1 }, null, /curated\/organism\.json of GCA_000001\.1 has no preprocessing props \(schema version 1\); verify it with verify-genome first/]
  ];
  for (const [record, edit, message] of cases) {
    const { repo } = amendedGenome({ record });
    if (edit) {
      const path = join(repo, PROJECT_FILE);
      writeFileSync(path, edit(readFileSync(path, 'utf-8')));
      commitAll(repo, 'project file');
    }
    const git = createGit(repo);
    await assert.rejects(checkLoadPreconditions({ git, ticket: genomeRecorded(repo), repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, proposalId: 'GCA_000001.1' }), message);
    assert.equal(git.branchExists('load/GCA_000001.1'), false);
  }
});

test('once its load merges, a new genome renders again only to find its abbreviation taken', async () => {
  const { repo } = amendedGenome();
  const git = createGit(repo, { exec: ghStub().exec });
  await loadGenome(git, repo);
  execFileSync('git', ['-C', repo, 'checkout', '-q', 'rebuild02']);
  execFileSync('git', ['-C', repo, 'merge', '-q', '--ff-only', 'load/GCA_000001.1']);
  execFileSync('git', ['-C', repo, 'push', '-q', 'origin', 'rebuild02']);
  await assert.rejects(checkLoadPreconditions({ git: createGit(repo), ticket: genomeRecorded(repo), repoPath: repo, rebuildBranch: REBUILD, validate: noFindings, proposalId: 'GCA_000001.1' }),
    /tfakST-1: tfakST-1 already names FungiDB\/tfakST-1\.xml on this branch/);
});

test('a dry run names the organism file it would create and the project file it would change', async () => {
  const { repo } = amendedGenome();
  const git = createGit(repo);
  const dry = await loadGenome(git, repo, { dryRun: true });
  assert.equal(dry.dataset.organisms[0].created, true);
  assert.match(dry.dataset.organisms[0].datasetFile, /<constant name="organismAbbrev" value="tfakST-1"\/>/);
  assert.deepEqual(dry.dataset.projectFiles.map((p) => [p.organism, p.relFile]), [['tfakST-1', PROJECT_FILE]]);
  assert.equal(git.isClean(), true);
  assert.equal(existsSync(join(repo, NEW_FILE)), false);
});
```

Append to `tests/build-fitness.test.js` (add `import { genomeWorkArea, amendedProposal } from './genome-work-area.js';`):

```js
test('buildFitness expects no organism file for a genome\'s new organism: load writes it', async () => {
  const ctx = setup();
  const { dir, manifest } = amendedProposal(genomeWorkArea());
  assert.deepEqual(await buildFitness({ git: ctx.git, proposalDir: dir, manifest, against: 'origin/rebuild02' }), []);
});
```

- [ ] **Step 4: Run** `node --test --test-reporter=dot --test-global-setup=W/tests/globalSetup.js W/tests/genome-organism-file.test.js W/tests/load-ops.test.js W/tests/build-fitness.test.js`; expect the new tests to FAIL ("Dataset file missing", missing exports).

- [ ] **Step 5: Implement the readers.**

`shared/scripts/lib/dataset-classes.js`, after `parseDatasetClass`:

```js
/** A class's <prop> names in order, a repeated one once; for classes that deliver nothing, such as organism and referenceStrain. */
export function classPropsOf(xml, className) {
  const block = [...xml.matchAll(/<datasetClass\s+class="([^"]+)"[^>]*>([\s\S]*?)<\/datasetClass>/g)].find(([, name]) => name === className)?.[2];
  if (block === undefined) throw new Error(`Dataset class "${className}" not found in ${CLASSES_RELATIVE_PATH}`);
  return [...new Set([...block.split(/<datasetLoader\b/)[0].matchAll(/<prop\s+name="([^"]+)"/g)].map((m) => m[1]))];
}

export function readClassProps(repoPath, className) {
  const path = join(repoPath, CLASSES_RELATIVE_PATH);
  if (!existsSync(path)) throw new Error(`${CLASSES_RELATIVE_PATH} not found in ${repoPath}`);
  return classPropsOf(readFileSync(path, 'utf-8'), className);
}
```

`shared/scripts/lib/project-organisms.js`, replacing `readProjectOrganisms`:

```js
/** The props of each organism dataset of a project file, as written; commented-out ones are skipped. */
export function organismDatasetProps(xml) {
  const live = xml.replace(/<!--[\s\S]*?-->/g, '');
  return [...live.matchAll(ORGANISM_DATASET)].map(([, body]) => Object.fromEntries([...body.matchAll(PROP)].map(([, k, v]) => [k, v.trim()])));
}

/** The organism datasets of a project file; commented-out ones are skipped. */
export function readProjectOrganisms(xml) {
  return organismDatasetProps(xml).map((p) => ({
    organismAbbrev: p.organismAbbrev,
    speciesNcbiTaxonId: p.speciesNcbiTaxonId,
    isReferenceStrain: p.isReferenceStrain === 'true',
    isFamilyRepresentative: p.isFamilyRepresentative === 'true',
    familyNcbiTaxonIds: (p.familyNcbiTaxonIds ?? '').split(/[\s,]+/).filter(Boolean)
  }));
}
```

- [ ] **Step 6: Implement the hook** — `shared/scripts/dataset-types/genome-assembly/organism-file.js`:

```js
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { constantsOf, escapeXml, readCuratedJson, ORGANISM_RECORD_FILENAME } from '../_common.js';
import { projectOf } from '../../lib/manifest.js';
import { datasetFilePath, datasetFileRelativePath, insertDataset } from '../../lib/dataset-file.js';
import { organismDatasetProps, projectFileRelativePath } from '../../lib/project-organisms.js';
import { readClassProps } from '../../lib/dataset-classes.js';
import { ORGANISM_RECORD_SCHEMA_VERSION } from './amendment.js';

const DATASETS_DIR = 'Datasets/lib/xml/datasets';

/** Datasets a new organism file holds before its entries, in this order; referenceOnly ones for a reference strain only. */
export const ORGANISM_FILE_BOILERPLATE = [
  {
    datasetClass: 'validateOrganismInfo',
    props: {
      projectName: '$$projectName$$', organismAbbrev: '$$organismAbbrev$$', strainAbbrev: '$$strainAbbrev$$', ncbiTaxonId: '$$ncbiTaxonId$$',
      speciesNcbiTaxonId: '$$speciesNcbiTaxonId$$', genomeVersion: '$$genomeVersion$$'
    }
  },
  { datasetClass: 'ECAssocFromUniprot', props: { speciesNcbiTaxonId: '$$speciesNcbiTaxonId$$', organismAbbrev: '$$organismAbbrev$$', version: 'TODAY' } },
  { datasetClass: 'referenceStrain-dbEST', referenceOnly: true, props: { projectName: '$$projectName$$', organismAbbrev: '$$organismAbbrev$$', speciesNcbiTaxonId: '$$speciesNcbiTaxonId$$' } },
  { datasetClass: 'transcriptsFromReferenceStrain', props: { referenceStrainOrganismAbbrev: '$$referenceStrainOrganismAbbrev$$' } }
];

const constantLine = (name, value) => `  <constant name="${escapeXml(name)}" value="${escapeXml(value)}"/>`;
const datasetBlock = (datasetClass, props) =>
  `  <dataset class="${escapeXml(datasetClass)}">\n${Object.entries(props).map(([k, v]) => `    <prop name="${escapeXml(k)}">${escapeXml(v)}</prop>`).join('\n')}\n  </dataset>`;

/** Inserts block after a project file's last top-level <constant>, one blank line either side. */
export function insertAfterConstants(content, block) {
  const nl = content.includes('\r\n') ? '\r\n' : '\n';
  const firstDataset = content.search(/<dataset\b/);
  const head = firstDataset === -1 ? content : content.slice(0, firstDataset);
  const last = [...head.matchAll(/<constant\b[^>]*\/>[^\S\r\n]*(?:\r?\n)?/g)].at(-1);
  if (!last) throw new Error('The project file has no top-level <constant> to place the organism after');
  const at = last.index + last[0].length;
  return `${content.slice(0, at)}${nl}${block.replace(/\r?\n/g, nl)}${nl}${content.slice(at)}`;
}

const projectFiles = (repoPath) => readdirSync(join(repoPath, DATASETS_DIR)).filter((n) => n.endsWith('.xml'))
  .map((n) => ({ relFile: `${DATASETS_DIR}/${n}`, organisms: organismDatasetProps(readFileSync(join(repoPath, DATASETS_DIR, n), 'utf-8')) }));

function propsInOrder(classProps, values, className) {
  const missing = classProps.filter((p) => typeof values[p] !== 'string');
  if (missing.length) throw new Error(`curated/organism.json has no ${missing.join(', ')} for the ${className} dataset; run amend-proposal.js`);
  return Object.fromEntries(classProps.map((p) => [p, values[p]]));
}

function assertNewOrganism({ organism, record, projectXml, projectRel, repoPath }) {
  const files = projectFiles(repoPath);
  const holder = files.find((f) => f.organisms.some((p) => p.organismAbbrev === organism));
  if (holder) throw new Error(`${organism} is already an organism in ${holder.relFile}; it may already be loaded; ask before continuing`);
  if (record.isReferenceStrain !== 'true' && !organismDatasetProps(projectXml).some((p) => p.organismAbbrev === record.referenceStrainOrganismAbbrev)) {
    throw new Error(`${organism}'s reference strain ${record.referenceStrainOrganismAbbrev} is not an organism in ${projectRel}; load the reference strain first, or amend the organism record`);
  }
  const twin = files.flatMap((f) => f.organisms.map((p) => ({ ...p, relFile: f.relFile }))).find((p) => p.orthomclAbbrev === record.orthomclAbbrev);
  if (twin) {
    throw new Error(`orthomclAbbrev ${record.orthomclAbbrev} is already used by ${twin.organismAbbrev} in ${twin.relFile}; choose another with amend-proposal.js --organism orthomclAbbrev=<abbrev> and publish`);
  }
}

/**
 * Load, for a genome's new organism: its organism file (constants and boilerplate; load appends the entries) and its
 * project file with the organism dataset, plus referenceStrain for a reference strain. Refuses, before anything is written,
 * an existing organism file, an organism already in a project file, a reference strain the project lacks and a taken orthomclAbbrev.
 * Returns { organismFile, projectFile: { relFile, content, organism } }.
 */
export function newOrganismFiles({ proposalDir, manifest, organism, repoPath }) {
  const project = projectOf(manifest, organism);
  if (existsSync(datasetFilePath(repoPath, project, organism))) {
    throw new Error(`${datasetFileRelativePath(project, organism)} already exists; ${organism} is new in ${manifest.accession}, so it may already be loaded; ask before continuing`);
  }
  const record = readCuratedJson(proposalDir, ORGANISM_RECORD_FILENAME);
  if (record.schemaVersion !== ORGANISM_RECORD_SCHEMA_VERSION) {
    throw new Error(`curated/organism.json of ${manifest.accession} has no preprocessing props (schema version ${record.schemaVersion}); verify it with verify-genome first`);
  }
  const projectRel = projectFileRelativePath(project);
  if (!existsSync(join(repoPath, projectRel))) throw new Error(`Project file missing: ${projectRel}`);
  const projectXml = readFileSync(join(repoPath, projectRel), 'utf-8');
  assertNewOrganism({ organism, record, projectXml, projectRel, repoPath });

  const entry = manifest.organisms.find((o) => (o.organismAbbrev ?? o.proposedOrganismAbbrev) === organism);
  const isReference = record.isReferenceStrain === 'true';
  const referenceStrain = isReference ? organism : record.referenceStrainOrganismAbbrev;
  const familyRep = record.isFamilyRepresentative === 'true' ? organism : record.familyRepOrganismAbbrev;
  const strings = Object.fromEntries(Object.entries(record).filter(([, v]) => typeof v === 'string'));
  const values = {
    ...strings, organismAbbrev: organism, projectName: '$$projectName$$', publicOrganismAbbrev: organism, ncbiTaxonId: entry.ncbiTaxonId,
    referenceStrainOrganismAbbrev: referenceStrain, familyRepOrganismAbbrev: familyRep
  };
  const blocks = [
    datasetBlock('organism', propsInOrder(readClassProps(repoPath, 'organism'), values, 'organism')),
    ...(isReference ? [datasetBlock('referenceStrain', propsInOrder(readClassProps(repoPath, 'referenceStrain'), values, 'referenceStrain'))] : [])
  ].join('\n\n');
  // classes.xml: reference strains must precede other strains in the project file.
  const content = isReference ? insertAfterConstants(projectXml, blocks) : insertDataset(projectXml, blocks);

  const base = {
    organismAbbrev: organism, strainAbbrev: record.strainAbbrev, referenceStrainOrganismAbbrev: referenceStrain, familyRepOrganismAbbrev: familyRep,
    projectName: project, ncbiTaxonId: entry.ncbiTaxonId, speciesNcbiTaxonId: record.speciesNcbiTaxonId
  };
  const constants = { ...base, ...Object.fromEntries(Object.entries(constantsOf(proposalDir)).filter(([k]) => !Object.hasOwn(base, k))) };
  const boilerplate = ORGANISM_FILE_BOILERPLATE.filter((b) => isReference || !b.referenceOnly).map((b) => datasetBlock(b.datasetClass, b.props));
  const organismFile = ['<?xml version="1.0"?>', '<datasets>', ...Object.entries(constants).map(([k, v]) => constantLine(k, v)), '', boilerplate.join('\n\n'), '</datasets>', ''].join('\n');
  return { organismFile, projectFile: { relFile: projectRel, content, organism } };
}
```

In `shared/scripts/dataset-types/genome-assembly.js`, add `export { newOrganismFiles } from './genome-assembly/organism-file.js';`.

- [ ] **Step 7: Implement load.** In `shared/scripts/lib/load-ops.js`:
  - Imports: add `mkdirSync` to the `node:fs` import and `dirname` to the `node:path` import.
  - Above `renderDatasetParts`:

```js
/** Whether organism is one the proposal introduces (a genome's), whose organism file load writes. */
const isNewOrganism = (manifest, organism) => manifest.organisms.some((o) => (o.organismAbbrev ?? o.proposedOrganismAbbrev) === organism && o.source === 'new');
```

  - Replace `renderDatasetParts` with:

```js
/**
 * Every entry's <dataset> element (the same for every organism) and each organism's file. check refuses a missing
 * organism file or a datasetName it already has, and adds the constants the entries reference; a new organism of a type
 * with newOrganismFiles gets its organism file rendered and its project file changed (projectFiles) instead.
 */
async function renderDatasetParts(manifest, proposalDir, repoPath, { check, organismConstants = {}, classOf = memoClassOf(repoPath) }) {
  const datasetType = await loadDatasetType(manifest.datasetType);
  const entries = datasetsOf(proposalDir, manifest);
  if (!entries.length) return { dataset: null };
  const xml = renderDatasets(proposalDir, manifest, datasetType, classOf);
  const proposalConstants = constantsOf(proposalDir);
  const projectFiles = [];
  const organisms = organismsOf(manifest).map((organism) => {
    const project = projectOf(manifest, organism);
    const relFile = datasetFileRelativePath(project, organism);
    let datasetFile = null;
    let constantsAdded = [];
    let created = false;
    if (check) {
      if (isNewOrganism(manifest, organism) && datasetType.newOrganismFiles) {
        const made = datasetType.newOrganismFiles({ proposalDir, manifest, organism, repoPath });
        datasetFile = made.organismFile;
        projectFiles.push(made.projectFile);
        created = true;
      } else {
        const path = datasetFilePath(repoPath, project, organism);
        if (!existsSync(path)) throw new Error(`Dataset file missing: ${relFile}. Is ${organism} a ${project} organism on this build?`);
        datasetFile = readFileSync(path, 'utf-8');
      }
      const taken = entries.find((e) => entryDatasetExists(datasetFile, classOf(e.datasetClass), e));
      if (taken) throw new Error(`${relFile} already has a ${entryNamed(taken)}. It may already be loaded; ask before continuing.`);
      const { required, given } = loadConstants(datasetType, proposalConstants, organismConstants[organism]);
      const constants = withOrganismConstants(datasetFile, required, given, organism);
      datasetFile = constants.content;
      constantsAdded = constants.added;
    }
    return { organism, relFile, datasetFile, constantsAdded, ...(created ? { created } : {}) };
  });
  return { dataset: { xml, entries, organisms, projectFiles } };
}
```

  - In `loadProposal`, the `writes` list gains the project files, and each write makes its directory:

```js
      const writes = [{ relFile: presenterFileRelativePath(homeProject(manifest)), content: presenters.reduce((c, p) => insertPresenter(c, p.xml), presenterFile) },
        ...(dataset?.organisms ?? []).map((o) => ({ relFile: o.relFile, content: insertDataset(o.datasetFile, dataset.xml) })),
        ...(dataset?.projectFiles ?? []).map((p) => ({ relFile: p.relFile, content: p.content }))];
      for (const w of writes) {
        mkdirSync(dirname(join(repoPath, w.relFile)), { recursive: true });
        writeFileSync(join(repoPath, w.relFile), w.content);
      }
```

  - In the PR `body`, after the `Dataset:` lines:

```js
      ...(dataset?.organisms ?? []).filter((o) => o.created).map((o) => `Organism file created: \`${o.relFile}\``),
      ...(dataset?.projectFiles ?? []).map((p) => `Organism \`${p.organism}\` added to \`${p.relFile}\``),
```

`shared/scripts/lib/build-fitness.js`, inside the `manifest.organisms.forEach`:

```js
      if (!git.fileExistsOnRef(against, rel)) {
        if (o.source === 'new' && datasetType.newOrganismFiles) return;
        error(`${rel} is missing on ${against}`);
        return;
      }
```

and add to `buildFitness`'s doc comment: "(a new organism's file is not expected: load writes it)".

`shared/scripts/load-proposal.js`, in the dry-run block after the `constantsAdded` line:

```js
      for (const o of organisms.filter((o) => o.created)) console.error(`Dry run: would create ${o.relFile}`);
      for (const p of result.dataset.projectFiles ?? []) console.error(`Dry run: would add ${p.organism} to ${p.relFile}`);
```

`docs/development.md`, after the `preprocessedAmendment` row:

```markdown
| `newOrganismFiles({ proposalDir, manifest, organism, repoPath })` | 2 | optional; for a new organism at load: `{ organismFile, projectFile: { relFile, content, organism } }`, the organism file before its entries and the changed project file. Genome: `genome-assembly/organism-file.js` |
```

- [ ] **Step 8: Register.** In `package.json` `sharedFiles`, add `scripts/dataset-types/genome-assembly/organism-file.js` listing `"propose-genome-assembly", "propose-bulk-rnaseq", "propose-dnaseq", "propose-chipseq", "load-proposals", "verify-bulk-rnaseq"`. Run `node W/bin/sync-shared.js`.

- [ ] **Step 9: Run** `node --test --test-reporter=dot --test-global-setup=W/tests/globalSetup.js W/tests/genome-organism-file.test.js W/tests/load-ops.test.js W/tests/build-fitness.test.js W/tests/project-organisms.test.js W/tests/dataset-classes.test.js W/tests/genome-entries.test.js W/tests/import-graph.test.js W/tests/skill-imports.test.js`; expect PASS.

- [ ] **Step 10: Commit.**
  `git -C W add shared/scripts skills package.json docs/development.md tests/fixtures/classes.xml tests/genome-organism-file.test.js tests/load-ops.test.js tests/build-fitness.test.js`
  `git -C W commit -m "Load creates a new genome's organism file and its project-file blocks"` (with the trailer).

---

### Task 10: Multi-entry load tests and resuming a new genome's load

**Files:**
- Modify: `shared/scripts/lib/load-ops.js` (`settledOrStop`, `settledAsRecorded`, `checkLoadPreconditions`, `assertSettledAsCommitted`)
- Modify: `tests/load-ops.test.js`

- [ ] **Step 1: Write the failing tests** — append to `tests/load-ops.test.js`:

```js
test('a new genome load that failed after its commit resumes: its own organism file does not stop it', async () => {
  const { repo } = amendedGenome();
  const flaky = createGit(repo, { exec: ghStub({ url: 'https://github.com/x/y/pull/31', failCreates: 1 }).exec });
  await assert.rejects(loadGenome(flaky, repo));
  const gh = ghStub({ url: 'https://github.com/x/y/pull/31' });
  const result = await loadGenome(createGit(repo, { exec: gh.exec }), repo);
  assert.equal(result.resumed, true);
  assert.match(prBodyOf(gh), /^Dataset: `productNames GenBank` in `Datasets\/lib\/xml\/datasets\/FungiDB\/tfakST-1\.xml`$/m);
});

test('a resume is refused when master\'s entries no longer match the load commit', async () => {
  const { repo } = amendedGenome();
  const flaky = createGit(repo, { exec: ghStub({ url: 'https://github.com/x/y/pull/32', failCreates: 1 }).exec });
  await assert.rejects(loadGenome(flaky, repo));
  editMasterGenome(repo, { entries: GENOME_ENTRIES.slice(0, 2) });
  execFileSync('git', ['-C', repo, 'checkout', '-q', 'load/GCA_000001.1']);
  const gh = ghStub({ url: 'https://github.com/x/y/pull/32' });
  await assert.rejects(loadGenome(createGit(repo, { exec: gh.exec }), repo),
    /This load was committed with 3 datasets; the proposal on origin\/master now has 2 datasets\. Start over: /);
  assert.equal(gh.calls.some((a) => a[0] === 'pr' && a[1] === 'create'), false);
});

test('a load refuses two genome entries that load as one dataset, before any branch', async () => {
  const supercontig = { ...GENOME_ENTRIES[1], props: { ...GENOME_ENTRIES[1].props, soTerm: 'supercontig' } };
  const { repo } = amendedGenome({ entries: [...GENOME_ENTRIES, supercontig] });
  const git = createGit(repo);
  await assert.rejects(loadGenome(git, repo, { dryRun: true }),
    /NoPreprocess_primary_genome_features \$\$genomeSource\$\$ \(chromosome\) and NoPreprocess_primary_genome_features \$\$genomeSource\$\$ \(supercontig\) both load as tfakST-1_primary_genome_features_RSRC/);
  assert.equal(git.branchExists('load/GCA_000001.1'), false);
});

test('a load refuses two genome entries that deliver to one directory, advising a numeric suffix', async () => {
  const alias = (target) => ({ datasetClass: 'aliases', name: 'gbProteinId', version: '$$functAnnotVersion$$', props: { columnSpec: 'primary_identifier', url: '', urlUsesSecondaryId: 'false', target, idType: 'alternate id', viewName: 'Transcript' }, source: NCBI_URLS });
  const { repo } = amendedGenome({ entries: [...GENOME_ENTRIES, alias('NAFeature'), alias('NASequence')] });
  await assert.rejects(loadGenome(createGit(repo), repo, { dryRun: true }),
    /aliases gbProteinId and aliases gbProteinId both deliver to FungiDB\/tfakST-1\/alias\/gbProteinId\/2024-04-01\/final; delivery directories must be unique: make the names distinct, for example by appending a numeric suffix to one/);
});
```

- [ ] **Step 2: Run** `node --test --test-reporter=dot --test-global-setup=W/tests/globalSetup.js W/tests/load-ops.test.js`; expect the first two to FAIL (the resume stops on "tfakST-1 already names FungiDB/tfakST-1.xml"; the changed-entries resume is not refused). The last two may already pass: they pin A's validation at load.

- [ ] **Step 3: Implement** in `shared/scripts/lib/load-ops.js`:

`settledOrStop` and `settledAsRecorded` take the ref they settle on:

```js
function settledOrStop(git, manifest, settle, resolve, proposalId, ref = 'HEAD') {
  const { organisms, stops } = settlementOn(git, manifest, ref, settle);
```

(the rest of `settledOrStop` unchanged), and in `settledAsRecorded(git, manifest, recorded, settle, proposalId, ref = 'HEAD')` pass `ref` to its three `settledOrStop(...)` calls and replace `const own = settlementFor(git, manifest).organisms;` with `const own = settlementOn(git, manifest, ref).organisms;`.

In `checkLoadPreconditions`, the resume branch becomes:

```js
  if (isResume(git, proposalId, base)) {
    const recorded = await recordedDelivery(git, ticket, manifest, relDir, rebuildBranch, { proposalId, build, dryRun, settle });
    // The load commit may have created the organism file, so a resume settles on the rebuild branch it was cut from.
    const settled = settledAsRecorded(git, manifest, recorded, settle, proposalId, base);
```

Above `assertSettledAsCommitted`:

```js
/** The entries label the load commit names (the one name, or "N datasets"), or null. */
function datasetsLabelFromCommit(subject) {
  return /^Load \S+: add .+? to \S+, (.+) to \S+(?: \S+)*$/.exec(subject)?.[1] ?? null;
}
```

and at the end of `assertSettledAsCommitted`:

```js
  const committedLabel = datasetsLabelFromCommit(subject);
  if (committedLabel) {
    const now = entriesLabel(datasetsOf(relDir, manifest, { read: readerOnRef(git, 'origin/master') }));
    if (now !== committedLabel) throw new Error(`This load was committed with ${committedLabel}; the proposal on origin/master now has ${now}. Start over: ${startOver}`);
  }
```

Update its doc comment: "…the presenters, the dataset organisms and the entries label it names."

- [ ] **Step 4: Run** `node --test --test-reporter=dot --test-global-setup=W/tests/globalSetup.js W/tests/load-ops.test.js W/tests/import-graph.test.js`; expect PASS (the existing genome `--settle` resume tests prove settling on the rebuild branch changes nothing for a genome without entries).

- [ ] **Step 5: Checkpoint: full suite.** `yarn --cwd W test`; expect 0 failures (environment skips are fine).

- [ ] **Step 6: Commit.**
  `git -C W add shared/scripts/lib/load-ops.js tests/load-ops.test.js skills`
  `git -C W commit -m "Resume a new genome's load on its rebuild branch; refuse a resume whose entries changed"` (with the trailer).

---

### Task 11: The `verify-genome` skill, documents and 4.0.0

**Files:**
- Create: `skills/verify-genome/SKILL.md`
- Modify: `package.json` (`sharedFiles`, `version`), `.claude-plugin/plugin.json` (`version`), `CLAUDE.md`, `docs/development.md`, `skills/load-proposals/SKILL.md`

- [ ] **Step 1: Register everything the skill runs.** In `package.json` `sharedFiles`:
  - Add `"verify-genome"` to the list of every entry that lists `"verify-bulk-rnaseq"`.
  - Add `"verify-genome"` to the lists of `scripts/start-proposal.js`, `scripts/publish-proposal.js`, `scripts/merge-proposal.js`, `scripts/lib/merge-ops.js`, `scripts/lib/proposal-ops.js`.
  - Add `"verify-genome"` to the list of every `scripts/genome/…` entry that Task 3 added.
  - Add new entries, each listing `["verify-genome"]`: `scripts/amend-proposal.js`, `scripts/lib/amend-ops.js`, and every file under `shared/scripts/genome/` not yet registered: `scripts/genome/assembly-report.js`, `scripts/genome/checks.js`, `scripts/genome/commands/build.js`, `scripts/genome/commands/fetch.js`, `scripts/genome/commands/finalize.js`, `scripts/genome/commands/functional.js`, `scripts/genome/commands/inputs.js`, `scripts/genome/commands/survey.js`, `scripts/genome/commands/trial.js`, `scripts/genome/fasta.js`, `scripts/genome/feature-types.js`, `scripts/genome/functional/classes.js`, `scripts/genome/functional/dbxref-urls.js`, `scripts/genome/functional/ids.js`, `scripts/genome/functional/values.js`, `scripts/genome/genome-pipeline.js`, `scripts/genome/gff.js`, `scripts/genome/ids.js`, `scripts/genome/isf-map.js`, `scripts/genome/partition-shape.js`, `scripts/genome/partitions.js`, `scripts/genome/plan-build.js`, `scripts/genome/preprocess-gff3.js`, `scripts/genome/transforms/add-exon-per-cds.js`, `scripts/genome/transforms/add-mrna-to-gene-cds.js`, `scripts/genome/transforms/claim-ids.js`, `scripts/genome/transforms/collapse-split-genes.js`, `scripts/genome/transforms/index.js`, `scripts/genome/transforms/parent-orphan-rnas.js`, `scripts/genome/transforms/strip-attributes.js`, `scripts/genome/trial/model-image.js`, `scripts/genome/trial/qa.js`, `scripts/genome/trial/selectRows.pl`, `scripts/genome/trial/steps.js`.
  - Add `"verify-genome"` to `resources/proposal-workflow.md`, `resources/valid-projects.json`, `resources/curator.config.json` if the first bullet did not already.
  Set `"version"` to `"4.0.0"` in `package.json` and in `.claude-plugin/plugin.json`.

- [ ] **Step 2: Write `skills/verify-genome/SKILL.md`:**

````markdown
---
name: verify-genome
description: Data loading team - verify a merged annotated genome assembly proposal before it loads. Claims it, preprocesses its NCBI annotation in the proposal's work area (genome-pipeline.js fetch, survey, build, finalize; the data loader runs the trial ISF load; functional), asks about ID changes before and after the trial, amends the proposal with its dataset entries and organism props by pull request (amend-proposal, publish-proposal, merge-proposal), runs validate-proposal (pipeline records, functional IDs, the amendment against the build, pipeline findings, entry shape, organism record), prepares the manual delivery from the work area with prepare-delivery, reviews it with the user, then mark-ready or request-revision
---

# Verify an Annotated Genome Proposal

Follow [the verification procedure](resources/verify-procedure.md) step by
step. This page adds what is specific to annotated genomes: preprocessing,
which makes the files a genome loads, and the amendment, which writes what
preprocessing settled into the proposal.

## Workspace

This type's directory under the validation root is
`annotated-genome-validation/`. Its `env.json` names no repos and no build:

```json
{ "schemaVersion": 2, "repos": {}, "executables": {},
  "staging": { "host": "<ssh host>", "root": "<dataStaging root>" },
  "manualDelivery": { "host": "<ssh host>", "root": "<manualDelivery root>" } }
```

The proposal's work area is
`<root>/annotated-genome-validation/proposals/<PROPOSAL>/preprocess/`; below
it is `<work>`. Every `genome-pipeline.js` command takes it as `--workDir`.
**Never pass any other `--workDir`**: validation and prepare-delivery read only
this one, and mark-ready removes it.

Also ask the data loader for the ApiCommonData checkout (`<ApiCommonData>`).

## Order

1. Claim: `node scripts/start-verification.js <PROPOSAL>`.
2. Preprocess, with both ID prompts.
3. Amend the proposal by pull request.
4. Validate, prepare the delivery, review and decide, as the procedure says.

## Preprocess

```bash
node scripts/genome/genome-pipeline.js fetch <ACCESSION> --workDir <work>
node scripts/genome/genome-pipeline.js survey --workDir <work> --apiCommonData <ApiCommonData>
```

survey writes `<work>/survey.json` with its findings and a suggested
`recipe.json`. Show the user every finding, then write `<work>/recipe.json`
(the suggested one, unless the user changes it).

**ID prompt 1.** Ask the user: do any sequence, gene, transcript or protein IDs
need changing before the trial? `ids.default.tsv` (written by build) shows the
default IDs. A change is a line in `<work>/ids.tsv` (header `level old new`,
tab-separated; `old` as NCBI wrote it) and `"ids": "ids.tsv"` in `recipe.json`.
Needs are vague and occasional: ask, never assume.

```bash
node scripts/genome/genome-pipeline.js build --workDir <work> --apiCommonData <ApiCommonData>
node scripts/genome/genome-pipeline.js finalize --workDir <work> --apiCommonData <ApiCommonData>
```

**The trial is the data loader's to run**, never yours: it writes a shared
database. Give them the command, with the GUS image and `gus.config` they use
and the proposal's NCBI taxon id:

```bash
node scripts/genome/genome-pipeline.js trial --workDir <work> --image <image> --gusConfig <gus.config> --taxonId <taxon id>
```

It undoes its rows at the end; with `--keep` it leaves them until
`trial --undo`, which is also the data loader's to run. Wait for them to say
it passed, then:

```bash
node scripts/genome/genome-pipeline.js functional --workDir <work>
```

**ID prompt 2.** Show the user the built IDs (`final/<partition>/transcriptInfoAndIds`
and the functional files) and ask the same question. A change goes back to
`ids.tsv`, then build, finalize, the data loader's `trial --undo` and `trial`,
and functional.

## Amend

```bash
node scripts/start-proposal.js <ACCESSION> --type genome-assembly
node scripts/amend-proposal.js --workspace <root> --organism orthomclAbbrev=<abbrev> <PROPOSAL>
node scripts/publish-proposal.js <PROPOSAL>
node scripts/merge-proposal.js <PROPOSAL>
```

start-proposal must report `update` mode. If it refuses because
`proposal/<PROPOSAL>` still exists (merged branches are kept), confirm with
the user that its pull request merged, then run the delete commands it prints.

`orthomclAbbrev` is never derived: ask the user for it (4 to 8 lowercase
letters, not used by another organism). When the organism represents its
family (amend-proposal says so), also ask for
`--organism familyNcbiTaxonIds=<taxon ids>` and
`--organism familyNameForFiles=<name>`. Any other organism prop can be set the
same way when the user says so.

amend-proposal prints every derived value with its source and the diff against
master. Review them with the user before publishing. Merge only when the user
says the pull request was reviewed; merge-proposal keeps the ticket at
Preprocessing. A re-run replaces the entries and the props it owns and keeps
everything else in `curated/organism.json`.

## Validate

The validators read the work area (`records`: the pipeline records agree and
the trial passed; `matchesBuild`: master's entries and constants are the
work area's; `ids`: every functional ID is one ISF loads;
`pipelineFindings`: build, trial and functional findings) and the proposal
(`entryShape`, `organismRecord`). The report records the pipeline records'
sha256s; prepare-delivery refuses a work area that changed since.

## Review with the user

- Build warnings and findings (`[build]`).
- Trial QA findings and profile (`[trial]`).
- Functional warnings and info (`[functional]`).
- The derived organism props and their sources (amend-proposal's output).
- The entries against the partitions: one sequence entry per partition, one
  features entry per partition ISF loads anything from.
- Presenter text: `Proposals/<PROPOSAL>/curated/presenter.json` on `origin/master`.

## Prepare the delivery

prepare-delivery copies each entry's files from the work area into `final/`:
the partition's `genome.fasta` (and `chromosomeMap.txt` for a chromosome
primary), `genome.gff` and `transcriptInfoAndIds`, and each functional file.
`delivery.json` records the pipeline records' sha256s, the trial database and
release, and the generator version.

## After mark-ready

mark-ready removes `proposals/<PROPOSAL>/`, the work area with it. At load,
`load-proposal.js` writes the new organism's file and its organism dataset in
the project file.

## Rules

- Never run `trial` or `trial --undo`.
- Never pass a `--workDir` other than the proposal's work area.
- Never choose `orthomclAbbrev` or family props on the user's behalf.
````

- [ ] **Step 3: Documents.**

`CLAUDE.md`, in the repository tree, after the `verify-bulk-rnaseq/` line:

```
│   ├── verify-genome/                      # Verification: preprocess, amend, validate and deliver an annotated genome
```

and in "Who Are You Helping?" leave the text as is (it already says `verify-*`).

`docs/development.md`: in the hook table's `validationWorkspace` row, append: "Each validator declares `kind`: `preprocess` (reads `ctx.workArea`, runs at verify only) or `content` (reads the proposal, also runs at load); it may add report fields through `ctx.extras`."

`skills/load-proposals/SKILL.md`:
- Line 9: replace `(\`verify-bulk-rnaseq\`; genomes by hand for now)` with `(\`verify-bulk-rnaseq\`, \`verify-genome\`)`.
- In the workspace bullet, replace `genome assembly, \`annotated-genome-validation/\`, has no validators yet)` with `genome assembly uses \`annotated-genome-validation/loads/rebuild<RR>/\`, running only the validators that read the proposal)`.
- In Step 2, replace the sentence beginning `Genome and DNA-seq proposals have no` through `abbreviation is right.` with: `Genome assembly proposals are verified with the \`verify-genome\` skill the same way. DNA-seq proposals have no verify skill yet: check them by hand (the dry run in Step 3 is the automated part): presenter text reads sensibly, the reads are reachable, and the organism abbreviation is right.`
- In Step 2, replace `(RNA-seq and DNA-seq read the delivery record, so \`--workspace\` is required)` with `(RNA-seq, DNA-seq and genome assemblies with dataset entries read the delivery record, so \`--workspace\` is required)`.
- In Step 4, replace the paragraph `Load genome proposals before … with \`--settle\`.` with:

```markdown
Load genome proposals before the datasets that link to them. A genome with
dataset entries settles at preprocessing like RNA-seq (its delivery record
carries the settlement), and its load writes the new organism's file
(`Datasets/lib/xml/datasets/<Project>/<abbrev>.xml`: constants, the
boilerplate datasets, then the entries) and its organism dataset in
`<Project>.xml` (and `referenceStrain` for a reference strain). It refuses an
abbreviation already in a project file, a missing reference strain, and an
`orthomclAbbrev` another organism uses. A linked dataset loads only after its
genome's load PR has merged into `rebuild<RR>`: it resolves the organism by
the organism file's `ncbiTaxonId` and `strainAbbrev`.
```

- [ ] **Step 4: Sync and check.** `node W/bin/sync-shared.js` (expect `0 errors`), then `node W/bin/sync-shared.js --check` (expect `All shared copies match.`).

- [ ] **Step 5: Final checkpoint: full suite.** `yarn --cwd W test`; expect 0 failures (environment skips are fine). `skill-imports.test.js` proves every import in `skills/verify-genome/scripts` resolves; if it names a missing file, add that file's `sharedFiles` entry for `verify-genome` and sync again.

- [ ] **Step 6: Smoke the skill copy.** `node W/skills/verify-genome/scripts/genome/genome-pipeline.js` (expect the usage text and exit 1, not an import error) and `node W/skills/verify-genome/scripts/amend-proposal.js` (expect `Usage: node amend-proposal.js --workspace <root> [--organism key=value ...] <proposal>`).

- [ ] **Step 7: Commit.**
  `git -C W add skills package.json .claude-plugin/plugin.json CLAUDE.md docs/development.md`
  `git -C W commit -m "verify-genome skill (4.0.0)"` (with the trailer).

---

### Task 12: Acceptance: E. cuniculi GB-M1 end to end (manual)

Not an implementer task: John (or the controller with John) runs it. Findings go into **Amendments** at the top of this plan, each naming what failed, the fix, and the task whose code changed. No step here pushes to `master` or a `rebuild*` branch.

- [ ] **Step 1: Ask John** for: the VEuPathDatasets checkout and whether the proposal goes to its real `master` or a sandbox remote; the validation root; the ApiCommonData checkout; the rebuild branch; the GUS image and `gus.config` for the trial; the ticket. Never guess any of them.
- [ ] **Step 2: Phase 1.** Propose GCA_000091225.2 with `propose-genome-assembly` (or reuse a proposal John names); merge it; confirm `curated/datasets.json` is `[]` and `curated/organism.json` is schema version 1.
- [ ] **Step 3: Claim and preprocess** with the skill: fetch, survey (expect the golden's raw findings: `geneCdsNoRna`, `repeatedGeneLines`, `parentlessRna`), ID prompt 1, build, finalize. Check `genome-build.json`: every partition has `featureTypes` (with `tRNA`) and `maxIntron`.
- [ ] **Step 4: John runs `trial`.** Expect `result: passed`, no transcript with more than one protein, `transcriptInfoAndIds` with one row per loaded transcript, and `undone: true`.
- [ ] **Step 5: functional and ID prompt 2.** Expect `productNames` rows equal to the loaded transcripts and the dbxref datasets of the golden run.
- [ ] **Step 6: Amend, publish, merge.** Check the printed sources: `annotationIncludesTRNAs` true, `maxIntronSize` a multiple of 500, `isHugeGenome` false, `orthomclAbbrev` as given; entries: one sequence and one features entry per partition, then the functional entries.
- [ ] **Step 7: Validate** with `--against origin/rebuild<RR>`. Expect no errors; review every warning with John.
- [ ] **Step 8: Prepare the delivery.** Expect one `final/` per entry with the files the genome hook lists, `delivery.json` with `againstCommit` and `provenance`; inspect `chromosomeMap.txt` and `transcriptInfoAndIds` in the primary features directory.
- [ ] **Step 9: mark-ready**, then a load dry run on the rebuild branch: it must name the organism file it would create and the project file it would change. With John's go-ahead only, run the load and inspect the PR (organism file constants, boilerplate, entries; organism dataset placement in `<Project>.xml`).
- [ ] **Step 10:** Record every finding under Amendments and fix them in follow-up commits on `feature/verify-genome` (each with its own test).
