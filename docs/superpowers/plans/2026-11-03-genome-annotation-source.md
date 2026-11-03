# Genome Annotation Source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Genome proposals record where their annotation comes from (`genbank`, `provider`, `none`) in the manifest, and the ticket label, organism record, presenter text and injector all derive from it; dataStaging is keyed by proposal id for every type.

**Architecture:** One manifest field, `annotation`, validated in `lib/manifest.js`, derived in Phase 1 by a new `deriveAnnotation` hook on the genome type, and read everywhere else through one accessor, `annotationOf(proposalDir)`, which falls back for proposals written before the field existed. Provider files reuse `manifest.staging`. `writeProposal` carries `annotation` and `staging` forward across re-writes.

**Tech Stack:** Node 18 ES modules, `node:test`, yarn. Spec: `docs/superpowers/specs/2026-11-03-genome-annotation-source-design.md`.

**Conventions:** Edit only under `shared/` (never `skills/*/scripts` or `skills/*/resources` copies of shared files; the pre-commit hook syncs them). Run a single test file with `node --test tests/<file>.test.js`; the whole suite with `yarn test`. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Work on branch `feature/genome-annotation-source`.

---

## File map

| File | Change |
|---|---|
| `shared/scripts/lib/manifest.js` | `annotationErrors`; `stagingErrors` message says `<proposal id>` |
| `shared/scripts/dataset-types/_common.js` | `OVERRIDE_SECTIONS` gains `annotation`, `staging` |
| `shared/scripts/dataset-types/genome-assembly.js` | `deriveAnnotation`, `annotationOf`; organism record, ticket label, presenter derive and render read it |
| `shared/scripts/lib/proposal-ops.js` | carry `annotation`/`staging`; `MANIFEST_ORDER` |
| `shared/scripts/lib/delivery-ops.js` | staging path from proposal id |
| `tests/manifest.test.js`, `tests/dataset-types.test.js`, `tests/proposal-ops.test.js`, `tests/delivery-ops.test.js` | tests |
| `skills/propose-genome-assembly/SKILL.md`, `skills/propose-genome-assembly/resources/step-5-write-proposal.md` | annotation question and overrides |
| `skills/verify-bulk-rnaseq/SKILL.md`, `shared/resources/proposal-workflow.md`, `docs/development.md` | `dataStaging/<proposal id>/`, new hook docs |
| `package.json`, `.claude-plugin/plugin.json` | 2.8.0 |

---

### Task 1: Manifest validates `annotation`

**Files:**
- Modify: `shared/scripts/lib/manifest.js` (add `annotationErrors` above `validate`, call it next to `stagingErrors`)
- Test: `tests/manifest.test.js`

- [ ] **Step 1: Write the failing tests** (append to `tests/manifest.test.js`; `genome()` and `valid()` already exist at the top of the file)

```js
test('annotation is optional and takes genbank or none alone', () => {
  assert.deepEqual(validate(genome()), []);
  assert.deepEqual(validate({ ...genome(), annotation: { source: 'genbank' } }), []);
  assert.deepEqual(validate({ ...genome(), annotation: { source: 'none' } }), []);
  assert.deepEqual(validate({ ...genome(), annotation: { source: 'none', provider: 'JGI' } }),
    ['annotation.provider applies only when source is "provider"']);
  assert.deepEqual(validate({ ...genome(), annotation: { source: 'ncbi' } }),
    ['annotation.source must be one of genbank, provider, none']);
  assert.deepEqual(validate({ ...genome(), annotation: { source: 'genbank', gff: 'x' } }),
    ['annotation.gff is not an annotation field']);
  assert.deepEqual(validate({ ...genome(), annotation: 'genbank' }),
    ['annotation must be an object { source, provider?, version? }']);
});

test('a provider annotation needs provider, version and staged files', () => {
  const staged = { staging: [{ path: 'tfak.gff3' }] };
  assert.deepEqual(validate({ ...genome(), ...staged, annotation: { source: 'provider', provider: 'JGI', version: '2024-03' } }), []);
  assert.deepEqual(validate({ ...genome(), ...staged, annotation: { source: 'provider', provider: ' ' } }), [
    'annotation.provider is required when source is "provider"',
    'annotation.version is required when source is "provider"'
  ]);
  assert.deepEqual(validate({ ...genome(), annotation: { source: 'provider', provider: 'JGI', version: '1' } }),
    ['a provider annotation needs its files listed in manifest "staging", in dataStaging/<proposal id>/']);
});

test('annotation applies only to genome proposals', () => {
  assert.deepEqual(validate({ ...valid(), annotation: { source: 'genbank' } }),
    ['annotation applies to genome-assembly proposals, not bulk-rnaseq']);
});
```

Also update the existing staging test (around line 133–134): both `'staging[N].path must be a relative path inside dataStaging/<accession>/'` lines become `'... inside dataStaging/<proposal id>/'`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/manifest.test.js`
Expected: FAIL on the four tests above (annotation errors missing; staging message differs).

- [ ] **Step 3: Implement**

In `shared/scripts/lib/manifest.js`, change the message in `stagingErrors`:

```js
      errors.push(`${at}.path must be a relative path inside dataStaging/<proposal id>/`);
```

Add above `validate`:

```js
export const ANNOTATION_SOURCES = ['genbank', 'provider', 'none'];
const ANNOTATED_TYPES = ['genome-assembly'];
const PROVIDER_FIELDS = ['provider', 'version'];

/** Problems with where a genome's annotation comes from; empty when absent or well formed. */
function annotationErrors(m) {
  const a = m.annotation;
  if (a === undefined) return [];
  if (!ANNOTATED_TYPES.includes(m.datasetType)) return [`annotation applies to genome-assembly proposals, not ${m.datasetType}`];
  if (!a || typeof a !== 'object' || Array.isArray(a)) return ['annotation must be an object { source, provider?, version? }'];
  const errors = [];
  if (!ANNOTATION_SOURCES.includes(a.source)) errors.push(`annotation.source must be one of ${ANNOTATION_SOURCES.join(', ')}`);
  if (a.source === 'provider') {
    for (const k of PROVIDER_FIELDS) {
      if (typeof a[k] !== 'string' || !a[k].trim()) errors.push(`annotation.${k} is required when source is "provider"`);
    }
    if (!Array.isArray(m.staging) || !m.staging.length) {
      errors.push('a provider annotation needs its files listed in manifest "staging", in dataStaging/<proposal id>/');
    }
  } else {
    for (const k of PROVIDER_FIELDS.filter((k) => a[k] !== undefined)) errors.push(`annotation.${k} applies only when source is "provider"`);
  }
  for (const k of Object.keys(a).filter((k) => !['source', ...PROVIDER_FIELDS].includes(k))) errors.push(`annotation.${k} is not an annotation field`);
  return errors;
}
```

In `validate`, directly after `errors.push(...stagingErrors(m.staging));`:

```js
  errors.push(...annotationErrors(m));
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/manifest.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add shared/scripts/lib/manifest.js tests/manifest.test.js
git commit -m "Manifest: genome annotation source; staging under the proposal id

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Overrides accept `annotation` and `staging`

**Files:**
- Modify: `shared/scripts/dataset-types/_common.js:57` (`OVERRIDE_SECTIONS`)
- Test: `tests/dataset-types.test.js`

- [ ] **Step 1: Write the failing test** (append to `tests/dataset-types.test.js`)

```js
test('readOverrides takes annotation and staging at the top level', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'overrides-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'overrides.json');
  const o = { annotation: { source: 'provider', provider: 'JGI', version: '1' }, staging: [{ path: 'a.gff3' }] };
  writeFileSync(path, JSON.stringify(o));
  assert.deepEqual(readOverrides(path), o);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/dataset-types.test.js`
Expected: FAIL with `unknown keys annotation, staging`

- [ ] **Step 3: Implement**

```js
export const OVERRIDE_SECTIONS = ['name', 'version', 'presenter', 'dataset', 'organism', 'annotation', 'staging'];
```

Their shape is checked by manifest validation (Task 1), not here.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/dataset-types.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add shared/scripts/dataset-types/_common.js tests/dataset-types.test.js
git commit -m "Overrides take annotation and staging

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `deriveAnnotation` and `annotationOf`

**Files:**
- Modify: `shared/scripts/dataset-types/genome-assembly.js` (add after `deriveOrganism`)
- Test: `tests/dataset-types.test.js`

- [ ] **Step 1: Write the failing tests** (append; `genomeDir`, `copyOf`, `readJson` exist in the file)

```js
const reportInput = (t, { annotated }) => {
  const dir = copyOf(t, genomeDir);
  const path = join(dir, 'inputs', 'GCA_000001.1_dataset_report.json');
  const report = readJson(path);
  if (!annotated) delete report.reports[0].annotation_info;
  writeFileSync(path, JSON.stringify(report));
  return [path];
};

test('genome deriveAnnotation defaults from the report and checks the curator\'s choice', (t) => {
  assert.deepEqual(genome.deriveAnnotation(reportInput(t, { annotated: true }), 'GCA_000001.1'), { source: 'genbank' });
  assert.deepEqual(genome.deriveAnnotation(reportInput(t, { annotated: false }), 'GCA_000001.1'), { source: 'none' });
  assert.deepEqual(genome.deriveAnnotation(reportInput(t, { annotated: true }), 'GCA_000001.1', { source: 'none' }), { source: 'none' });
  assert.throws(() => genome.deriveAnnotation(reportInput(t, { annotated: false }), 'GCA_000001.1', { source: 'genbank' }),
    /GCA_000001\.1 has no GenBank annotation; set "annotation": \{ "source": "provider" \} or \{ "source": "none" \}/);
  const warnings = [];
  const provider = { source: 'provider', provider: 'JGI', version: '1' };
  assert.deepEqual(genome.deriveAnnotation(reportInput(t, { annotated: true }), 'GCA_000001.1', provider, (w) => warnings.push(w)), provider);
  assert.deepEqual(warnings, ['Warning: GCA_000001.1 has GenBank annotation; the provider annotation replaces it']);
});

function withManifest(t, extra) {
  const dir = copyOf(t, genomeDir);
  const path = join(dir, 'manifest.json');
  writeFileSync(path, JSON.stringify({ ...readJson(path), ...extra }));
  return dir;
}
const providerAnnotation = { annotation: { source: 'provider', provider: 'JGI', version: '2024-03' }, staging: [{ path: 'tfak.gff3' }] };

test('genome annotationOf reads the manifest, else the organism record, else the report', (t) => {
  assert.deepEqual(genome.annotationOf(withManifest(t, providerAnnotation)), providerAnnotation.annotation);
  assert.deepEqual(genome.annotationOf(genomeDir), { source: 'genbank' });
  const legacy = copyOf(t, genomeDir);
  writeFileSync(join(legacy, 'curated', genome.ORGANISM_RECORD_FILENAME), JSON.stringify({ isAnnotatedGenome: 'false' }));
  assert.deepEqual(genome.annotationOf(legacy), { source: 'none' });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/dataset-types.test.js`
Expected: FAIL with `genome.deriveAnnotation is not a function`

- [ ] **Step 3: Implement** in `genome-assembly.js`, after `deriveOrganism`:

```js
const hasGenBankAnnotation = (report) => Boolean(report?.annotation_info);

/** Phase 1: where the annotation comes from; the report's answer unless the curator chose. */
export function deriveAnnotation(inputs, accession, chosen, warn = () => {}) {
  const reportFile = inputs.find((f) => basename(f) === `${accession}_dataset_report.json`);
  const inGenBank = hasGenBankAnnotation(reportFile ? parseJson(reportFile).reports?.[0] : undefined);
  if (!chosen) return { source: inGenBank ? 'genbank' : 'none' };
  if (chosen.source === 'genbank' && !inGenBank) {
    throw new Error(`${accession} has no GenBank annotation; set "annotation": { "source": "provider" } or { "source": "none" } in --overrides`);
  }
  if (chosen.source === 'provider' && inGenBank) warn(`Warning: ${accession} has GenBank annotation; the provider annotation replaces it`);
  return chosen;
}

/**
 * The one reader of a proposal's annotation source. A proposal written before
 * manifest "annotation" existed falls back to its organism record, then its report.
 */
export function annotationOf(proposalDir) {
  const m = loadManifest(proposalDir);
  if (m.annotation) return m.annotation;
  const annotated = existsSync(join(proposalDir, 'curated', ORGANISM_RECORD_FILENAME))
    ? readCuratedJson(proposalDir, ORGANISM_RECORD_FILENAME).isAnnotatedGenome === 'true'
    : hasGenBankAnnotation(readInputJson(proposalDir, `${m.accession}_dataset_report.json`).reports?.[0]);
  return { source: annotated ? 'genbank' : 'none' };
}
```

`ORGANISM_RECORD_FILENAME` is declared below `deriveOrganism` as a `const`; move the `export const ORGANISM_RECORD_FILENAME = 'organism.json';` line above `deriveAnnotation` so it is defined before `annotationOf` reads it at call time (hoisting makes it work either way, but keep declarations before use).

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/dataset-types.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add shared/scripts/dataset-types/genome-assembly.js tests/dataset-types.test.js
git commit -m "Genome: deriveAnnotation and the annotationOf accessor

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Organism record and ticket label read `annotationOf`

**Files:**
- Modify: `shared/scripts/dataset-types/genome-assembly.js` (`deriveOrganismRecord`, `ticketLabelVariant`)
- Test: `tests/dataset-types.test.js`

- [ ] **Step 1: Write the failing tests**

Replace the last assertion of `'genome organism record takes curator overrides and refuses a non-reference strain without its reference'` (the `isAnnotatedGenome: 'yes'` one) with:

```js
  assert.throws(() => genome.deriveOrganismRecord(genomeDir, recordContext(), { isAnnotatedGenome: 'false' }),
    /isAnnotatedGenome follows manifest "annotation"; set "annotation": \{ "source": \.\.\. \} in --overrides instead/);
```

Append:

```js
test('genome organism record and ticket label follow the manifest annotation', (t) => {
  const none = withManifest(t, { annotation: { source: 'none' } });
  assert.equal(genome.deriveOrganismRecord(none, recordContext()).isAnnotatedGenome, 'false');
  assert.equal(genome.ticketLabelVariant(none), 'unannotated');
  const provider = withManifest(t, providerAnnotation);
  assert.equal(genome.deriveOrganismRecord(provider, recordContext()).isAnnotatedGenome, 'true');
  assert.equal(genome.ticketLabelVariant(provider), 'annotated');
  writeFileSync(join(provider, 'curated', genome.ORGANISM_RECORD_FILENAME), JSON.stringify({ isAnnotatedGenome: 'false' }));
  assert.equal(genome.ticketLabelVariant(provider), 'annotated');
});
```

The existing `'genome ticketLabelVariant reads the organism record, else the assembly report'` test stays as is: the fixture manifest has no `annotation`, so it exercises the fallback.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/dataset-types.test.js`
Expected: FAIL (record says `'true'` for `none`; override not refused)

- [ ] **Step 3: Implement**

In `deriveOrganismRecord`, at the top of the function body:

```js
  if (overrides.isAnnotatedGenome !== undefined) {
    throw new Error('isAnnotatedGenome follows manifest "annotation"; set "annotation": { "source": ... } in --overrides instead');
  }
```

and replace the record line

```js
    isAnnotatedGenome: String(Boolean(report.annotation_info)),
```

with

```js
    isAnnotatedGenome: String(annotationOf(proposalDir).source !== 'none'),
```

Replace `ticketLabelVariant` and its doc comment with:

```js
/** Publish: which typeLabels entry labels the ticket. */
export function ticketLabelVariant(proposalDir) {
  return annotationOf(proposalDir).source === 'none' ? 'unannotated' : 'annotated';
}
```

`isAnnotatedGenome` stays in `ORGANISM_RECORD_KEYS` (the record still carries it, and `readOverrides` still lets the key through so this refusal can name the right fix).

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/dataset-types.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add shared/scripts/dataset-types/genome-assembly.js tests/dataset-types.test.js
git commit -m "Genome organism record and ticket label follow the annotation source

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Presenter derive and render per source

**Files:**
- Modify: `shared/scripts/dataset-types/genome-assembly.js` (`derivePresenter`, `renderPresenter`)
- Test: `tests/dataset-types.test.js`

- [ ] **Step 1: Write the failing tests** (append)

```js
test('genome presenter for an unannotated genome: sequence only, UnannotatedGenome with no props', (t) => {
  const dir = withManifest(t, { annotation: { source: 'none' } });
  const p = genome.derivePresenter(dir);
  assert.equal(p.displayName, 'Genome Sequence');
  assert.match(p.summary, /^Genome Sequence of <i>/);
  assert.equal(p.history.annotationSource, '');
  assert.equal(p.history.annotationVersion, '');
  writeFileSync(join(dir, 'curated', 'presenter.json'), JSON.stringify(p));
  const xml = genome.renderPresenter(dir, { build: '02' });
  assert.match(xml, /<templateInjector projectName="FungiDB" className="org\.apidb\.apicommon\.model\.datasetInjector\.UnannotatedGenome"\/>/);
  assert.doesNotMatch(xml, /<prop /);
  editPresenter(dir, (q) => ({ ...q, injectorProps: { isCurated: 'true' } }));
  assert.throws(() => genome.renderPresenter(dir, { build: '02' }),
    /GCA_000001\.1 is unannotated: the UnannotatedGenome injector takes no props, but presenter\.json sets isCurated/);
});

test('genome presenter for a provider annotation names the provider and its version', (t) => {
  const dir = withManifest(t, providerAnnotation);
  const p = genome.derivePresenter(dir);
  assert.equal(p.displayName, 'Genome Sequence and Annotation');
  assert.equal(p.history.annotationSource, 'JGI');
  assert.equal(p.history.annotationVersion, '2024-03');
  writeFileSync(join(dir, 'curated', 'presenter.json'), JSON.stringify(p));
  assert.match(genome.renderPresenter(dir, { build: '02' }), /className="org\.apidb\.apicommon\.model\.datasetInjector\.AnnotatedGenome">/);
});
```

The existing `'genome derive builds the presenter record from manifest and inputs'` test and the `expected.xml` render test cover `genbank` unchanged.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/dataset-types.test.js`
Expected: FAIL (displayName is still "Genome Sequence and Annotation"; injector is AnnotatedGenome)

- [ ] **Step 3: Implement**

Add above `derivePresenter`:

```js
const ANNOTATED_TITLE = 'Genome Sequence and Annotation';
const SEQUENCE_TITLE = 'Genome Sequence';

function annotationHistory(annotation, report) {
  if (annotation.source === 'none') return { annotationSource: '', annotationVersion: '' };
  if (annotation.source === 'provider') return { annotationSource: annotation.provider, annotationVersion: annotation.version };
  const date = report.annotation_info?.release_date || report.assembly_info?.release_date || '';
  return {
    annotationSource: (report.source_database || '').includes('REFSEQ') ? 'RefSeq' : 'GenBank',
    annotationVersion: date ? formatDate(date) : ''
  };
}
```

In `derivePresenter`, delete the `isRefSeq` and `annotationDate` locals and add after `organismForSummary`:

```js
  const annotation = annotationOf(proposalDir);
  const title = annotation.source === 'none' ? SEQUENCE_TITLE : ANNOTATED_TITLE;
```

and in the returned record:

```js
    displayName: title,
    ...
    summary: `${title} of ${organismForSummary}`,
    ...
    history: {
      genomeSource: 'INSDC',
      genomeVersion: m.accession,
      ...annotationHistory(annotation, report)
    },
```

In `renderPresenter`, after `const pubmeds = ...`:

```js
  const projectName = homeProject(m);
  const injector = annotationOf(proposalDir).source === 'none'
    ? unannotatedInjector(m, projectName, p.injectorProps)
    : `    <templateInjector projectName="${projectName}" className="org.apidb.apicommon.model.datasetInjector.AnnotatedGenome">
${injectorProps(injectorDefaults, p.injectorProps)}
    </templateInjector>`;
```

replace the last three lines of the template (from `<templateInjector` through `</templateInjector>`) with `${injector}`, so the template ends:

```js
${pubmeds ? pubmeds + '\n' : ''}${injector}
  </datasetPresenter>`;
```

and add above `renderPresenter`:

```js
function unannotatedInjector(m, projectName, props = {}) {
  const set = Object.keys(props);
  if (set.length) throw new Error(`${m.accession} is unannotated: the UnannotatedGenome injector takes no props, but presenter.json sets ${set.join(', ')}`);
  return `    <templateInjector projectName="${projectName}" className="org.apidb.apicommon.model.datasetInjector.UnannotatedGenome"/>`;
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/dataset-types.test.js tests/render-proposal.test.js`
Expected: PASS (including the existing `expected.xml` comparison)

- [ ] **Step 5: Commit**

```bash
git add shared/scripts/dataset-types/genome-assembly.js tests/dataset-types.test.js
git commit -m "Genome presenter: text, history and injector per annotation source

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: `writeProposal` writes and carries `annotation` and `staging`

**Files:**
- Modify: `shared/scripts/lib/proposal-ops.js` (`readWorkingTreeExternalIds` → `readWorkingTreeManifest`, `MANIFEST_ORDER`, `writeProposal`)
- Test: `tests/proposal-ops.test.js`

- [ ] **Step 1: Write the failing tests** (append; `setupRepo`, `manifestInput`, `genomeInputs`, `inputFile`, `REBUILD`, `rnaFiles`, `rnaManifestInput`, `coldShock` exist)

```js
const providerOverrides = { annotation: { source: 'provider', provider: 'JGI', version: '2024-03' }, staging: [{ path: 'tfak.gff3' }] };

test('writeProposal records the annotation source, from the report or the curator, and carries it and staging forward', async () => {
  const { repo, root } = setupRepo();
  const git = createGit(repo);
  await startProposal({ git, ticket: stubTicket(), accession: 'GCA_000001.1', datasetType: 'genome-assembly' });
  const warnings = [];
  const write = (extra = {}) => writeProposal({ rebuildBranch: REBUILD, git, repoPath: repo, manifestInput, curator: 'someone@apidb.org', inputs: genomeInputs(root), curated: [], warn: (w) => warnings.push(w), ...extra });

  assert.deepEqual((await write()).manifest.annotation, { source: 'genbank' });

  const overrides = join(root, 'overrides.json');
  writeFileSync(overrides, JSON.stringify(providerOverrides));
  const provider = await write({ overrides });
  assert.deepEqual(provider.manifest.annotation, providerOverrides.annotation);
  assert.deepEqual(provider.manifest.staging, providerOverrides.staging);
  assert.equal(provider.organism.isAnnotatedGenome, 'true');
  assert.equal(provider.presenter.history.annotationSource, 'JGI');
  assert.ok(warnings.includes('Warning: GCA_000001.1 has GenBank annotation; the provider annotation replaces it'));

  const again = await write();
  assert.deepEqual(again.manifest.annotation, providerOverrides.annotation);
  assert.deepEqual(again.manifest.staging, providerOverrides.staging);
  const keys = Object.keys(JSON.parse(readFileSync(join(again.dir, 'manifest.json'), 'utf-8')));
  assert.equal(keys.indexOf('annotation'), keys.indexOf('organisms') + 1);
  assert.equal(keys.indexOf('staging'), keys.indexOf('skill') + 1);
});

test('writeProposal refuses a provider annotation without staged files, and genbank without GenBank annotation', async () => {
  const { repo, root } = setupRepo();
  const git = createGit(repo);
  await startProposal({ git, ticket: stubTicket(), accession: 'GCA_000001.1', datasetType: 'genome-assembly' });
  const write = (overridesObj, inputs = genomeInputs(root)) => {
    const overrides = join(root, 'overrides.json');
    writeFileSync(overrides, JSON.stringify(overridesObj));
    return writeProposal({ rebuildBranch: REBUILD, git, repoPath: repo, manifestInput, curator: 'someone@apidb.org', inputs, curated: [], overrides, warn: () => {} });
  };
  await assert.rejects(write({ annotation: providerOverrides.annotation }),
    /a provider annotation needs its files listed in manifest "staging", in dataStaging\/<proposal id>\//);

  const inputs = genomeInputs(root);
  const report = JSON.parse(readFileSync(inputs[0], 'utf-8'));
  delete report.reports[0].annotation_info;
  writeFileSync(inputs[0], JSON.stringify(report));
  await assert.rejects(write({ annotation: { source: 'genbank' } }, inputs), /GCA_000001\.1 has no GenBank annotation/);
});

test('an RNA-seq proposal refuses an annotation override', async () => {
  const { repo, root } = setupRepo();
  const git = createGit(repo);
  await startProposal({ git, ticket: stubTicket(), accession: 'PRJNA000003', datasetType: 'bulk-rnaseq' });
  await assert.rejects(writeProposal({
    rebuildBranch: REBUILD, git, repoPath: repo, manifestInput: rnaManifestInput, curator: 'someone@apidb.org', ...rnaFiles(root, { ...coldShock, annotation: { source: 'none' } })
  }), /bulk-rnaseq proposals take no "annotation" override; it applies to genome proposals/);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/proposal-ops.test.js`
Expected: FAIL (`manifest.annotation` undefined; no refusal)

- [ ] **Step 3: Implement** in `shared/scripts/lib/proposal-ops.js`

Replace `readWorkingTreeExternalIds`:

```js
const readWorkingTreeManifest = (manifestPath) => {
  try { return JSON.parse(readFileSync(manifestPath, 'utf-8')); }
  catch { return undefined; }
};
```

and its one use in `writeProposal` becomes `...(readWorkingTreeManifest(join(dir, MANIFEST_FILENAME))?.externalIds ?? {}),`.

Replace `MANIFEST_ORDER`:

```js
const MANIFEST_ORDER = [
  'schemaVersion', 'accession', 'externalIds', 'datasetType', 'organisms', 'annotation',
  ...IDENTITY_FIELDS, 'contacts', 'curator', 'createdAt', 'skill', 'staging', 'ticket'
];
```

In `writeProposal`, after `const datasetType = await loadDatasetType(manifestInput.datasetType);`:

```js
  if (overrideValues.annotation !== undefined && !datasetType.deriveAnnotation) {
    throw new Error(`${manifestInput.datasetType} proposals take no "annotation" override; it applies to genome proposals`);
  }
  // Curator choices outlive a re-write that omits them: the working tree's, else master's.
  const existing = readWorkingTreeManifest(join(dir, MANIFEST_FILENAME)) ?? manifestOn(git, 'origin/master', proposalId) ?? {};
  const carried = (key) => overrideValues[key] ?? existing[key];
  const staging = carried('staging');
```

and in the `manifest` literal, after `organisms: ...`:

```js
    ...(datasetType.deriveAnnotation ? { annotation: datasetType.deriveAnnotation(inputs, accession, carried('annotation'), warn) } : {}),
```

and after `skill: manifestInput.skill`:

```js
    ...(staging !== undefined ? { staging } : {}),
```

Leave the `externalIds` merge as it is (it already layers master, working tree and input).

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/proposal-ops.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add shared/scripts/lib/proposal-ops.js tests/proposal-ops.test.js
git commit -m "writeProposal records annotation and carries it and staging forward

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: dataStaging keyed by proposal id

**Files:**
- Modify: `shared/scripts/lib/delivery-ops.js` (`stagingSource`, `pullStaging`, their call site)
- Test: `tests/delivery-ops.test.js` (the three sibling tests, around lines 164–222)

- [ ] **Step 1: Rewrite the sibling tests to the new rule**

Replace the test `'a bulk-rnaseq sibling (another type holds the accession) is delivered under its id from its accession\'s staging'` with:

```js
test('a bulk-rnaseq sibling (another type holds the accession) is delivered under its id from its own staging', async () => {
  const s = setup({ proposalId: 'PRJNA000002_bulk-rnaseq', staging: [{ path: 'big.gff3' }] });
  mkdirSync(join(s.hosts, 'dataStaging/PRJNA000002_bulk-rnaseq'), { recursive: true });
  writeFileSync(join(s.hosts, 'dataStaging/PRJNA000002_bulk-rnaseq/big.gff3'), 'gff');
  const { dir, record } = await prepare(s);
  assert.equal(dir, join(s.typeDir, 'delivery/PRJNA000002_bulk-rnaseq'));
  assert.ok(existsSync(join(dir, FINAL, '../fromProvider/PRJNA000002_bulk-rnaseq/manifest.json')));
  assert.equal(record.staging.path, join(s.hosts, 'dataStaging/PRJNA000002_bulk-rnaseq'));
  assert.equal(record.accession, 'PRJNA000002');
  assert.equal(record.proposalId, 'PRJNA000002_bulk-rnaseq');
  const elsewhere = setup({ proposalId: 'PRJNA000002_bulk-rnaseq', staging: [{ path: 'big.gff3' }] });
  mkdirSync(join(elsewhere.hosts, 'dataStaging/PRJNA000002'), { recursive: true });
  writeFileSync(join(elsewhere.hosts, 'dataStaging/PRJNA000002/big.gff3'), 'gff');
  await assert.rejects(prepare(elsewhere), /dataStaging\/PRJNA000002_bulk-rnaseq is missing on local/);
});
```

Replace `'for a sibling, a listed path under the accession is delivered and one under its id is refused'` with:

```js
test('for a sibling, a listed path under its id is refused', async () => {
  const clash = setup({ proposalId: 'PRJNA000002_bulk-rnaseq', staging: [{ path: 'PRJNA000002_bulk-rnaseq/notes.txt' }] });
  mkdirSync(join(clash.hosts, 'dataStaging/PRJNA000002_bulk-rnaseq'), { recursive: true });
  await assert.rejects(prepare(clash), /staging lists PRJNA000002_bulk-rnaseq\/notes\.txt, which would collide with the proposal copy fromProvider\/PRJNA000002_bulk-rnaseq\//);
});
```

Replace `'siblings sharing a drop each deliver only their own listed files'` with:

```js
test('siblings each read their own drop', async () => {
  const rnaseq = setup({ proposalId: 'PRJNA000002_bulk-rnaseq', staging: [{ path: 'a.fq.gz' }] });
  const other = setup({ staging: [{ path: 'b.fq.gz' }] });
  for (const s of [rnaseq, other]) {
    for (const [id, file] of [['PRJNA000002_bulk-rnaseq', 'a.fq.gz'], ['PRJNA000002', 'b.fq.gz']]) {
      mkdirSync(join(s.hosts, 'dataStaging', id), { recursive: true });
      writeFileSync(join(s.hosts, 'dataStaging', id, file), file);
    }
  }
  const contents = async (s) => {
    const fromProvider = join((await prepare(s)).dir, FINAL, '../fromProvider');
    return readdirSync(fromProvider, { recursive: true }).filter((p) => !p.startsWith(s.proposalId)).sort();
  };
  assert.deepEqual(await contents(rnaseq), ['a.fq.gz']);
  assert.deepEqual(await contents(other), ['b.fq.gz']);
});
```

Tests for non-sibling proposals (`PRJNA000002`) keep `dataStaging/PRJNA000002`: their id is the accession.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/delivery-ops.test.js`
Expected: FAIL (staging still read from `dataStaging/PRJNA000002`)

- [ ] **Step 3: Implement** in `shared/scripts/lib/delivery-ops.js`

```js
/** dataStaging/<proposal id>/ once checked to be there and that no listed path collides with the proposal copy. */
function stagingSource({ remote, staging, proposalId, listed }) {
  const path = join(staging.root, proposalId);
  if (remote.list(path) === null) throw new Error(`dataStaging/${proposalId} is missing on ${staging.host} (${path}); the data provider's files must be there first`);
  const clash = listed.find((s) => normalize(s.path).split('/')[0] === proposalId);
  if (clash) throw new Error(`staging lists ${clash.path}, which would collide with the proposal copy fromProvider/${proposalId}/`);
  return path;
}
```

In `pullStaging`, rename the `accession` parameter to `proposalId` and the two messages to `` `dataStaging/${proposalId} lacks ${rel} on ${staging.host}` `` and `` `dataStaging/${proposalId}: staging lists ${rel}, which is a directory; list its files` ``.

At the call site:

```js
      const stagingPath = listed.length ? stagingSource({ remote: stagingRemote, staging, proposalId, listed }) : null;
      ...
      const stagingSummary = stagingPath ? pullStaging({ remote: stagingRemote, staging, proposalId, path: stagingPath, listed, dest: stagingDir }) : null;
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/delivery-ops.test.js tests/delivery-roundtrip.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add shared/scripts/lib/delivery-ops.js tests/delivery-ops.test.js
git commit -m "dataStaging is keyed by proposal id

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Skill and developer docs

**Files:**
- Modify: `skills/propose-genome-assembly/SKILL.md` (Step 5 section, ~line 113)
- Modify: `skills/propose-genome-assembly/resources/step-5-write-proposal.md`
- Modify: `skills/verify-bulk-rnaseq/SKILL.md:82`
- Modify: `shared/resources/proposal-workflow.md` (wherever staging/dataStaging is described; `grep -n -i staging` it)
- Modify: `docs/development.md` (hook table ~line 199–214; manifest field docs)

- [ ] **Step 1: Genome SKILL.md, Step 5.** Before the `write-proposal.js` command, add:

```markdown
Ask the curator where the annotation comes from, offering the report's answer
as the default (`annotation_info` present → GenBank):

- **GenBank**: nothing to set.
- **A separate file from the provider**: ask for the provider (who made the
  gene models, e.g. `JGI`), its version, and the file names. Put them in the
  overrides as `annotation` and `staging` (see Step 5 details) and tell the
  curator the files must be in `yew:/veupath/dataStaging/<PROPOSAL>/` before
  verification. This skill does not check or upload them.
- **None**: set `"annotation": { "source": "none" }`.
```

- [ ] **Step 2: step-5-write-proposal.md.** Add a section after "The organism":

````markdown
## The annotation source

The manifest records where the gene models come from:

```json
"annotation": { "source": "genbank" }
"annotation": { "source": "none" }
"annotation": { "source": "provider", "provider": "JGI", "version": "2024-03" }
```

It defaults to `genbank` when the assembly report has `annotation_info`, else
`none`. Set it in the overrides; a provider annotation also lists its files,
by path relative to `yew:/veupath/dataStaging/<PROPOSAL>/`:

```json
{
  "annotation": { "source": "provider", "provider": "JGI", "version": "2024-03" },
  "staging": [{ "path": "Tfak_ST-1.gff3" }]
}
```

`genbank` without GenBank annotation is refused. `provider` over GenBank
annotation is a warning: relay it. Both values are kept on later re-writes
unless the overrides change them.

| Source | Ticket label | Display name | Injector |
|---|---|---|---|
| `genbank` | genome & annotation | Genome Sequence and Annotation | `AnnotatedGenome` |
| `provider` | genome & annotation | Genome Sequence and Annotation; history names the provider and version | `AnnotatedGenome` |
| `none` | genome sequence | Genome Sequence | `UnannotatedGenome`, no injector props |
````

In the organism record table, change the `isAnnotatedGenome` row's "From" to `` `annotation.source` is not `none`; set `annotation`, not this field ``.

- [ ] **Step 3: dataStaging wording.** In `skills/verify-bulk-rnaseq/SKILL.md` line 82 and in `shared/resources/proposal-workflow.md`, replace `dataStaging/<ACCESSION>/` (or `<accession>`) with `dataStaging/<PROPOSAL>/` and add once in `proposal-workflow.md`: "Provider files live in `dataStaging/<proposal id>/`, so siblings of one study each have their own directory."

- [ ] **Step 4: docs/development.md.** In the hook table add:

```markdown
| `deriveAnnotation(inputs, accession, chosen, warn)` | 1 | optional; genome only: manifest `annotation`, the curator's choice checked against the report, else the report's answer |
```

and change the `ticketLabelVariant` row's text to "Genome assembly: `annotated` or `unannotated`, from `annotationOf(dir)`". Below the table add: "Genome code reads the annotation source only through `annotationOf(dir)` in `genome-assembly.js`, which falls back to `curated/organism.json` and then the report for proposals written before manifest `annotation`. `writeProposal` carries `annotation` and `staging` forward when the overrides omit them."

- [ ] **Step 5: Sync and commit**

```bash
yarn sync-shared
git add -A skills shared docs
git commit -m "Docs: genome annotation source; dataStaging by proposal id

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Version and full suite

**Files:**
- Modify: `package.json`, `.claude-plugin/plugin.json`

- [ ] **Step 1:** Set `"version": "2.8.0"` in both files.

- [ ] **Step 2: Run the whole suite**

Run: `yarn test`
Expected: all tests pass, including `tests/skill-imports.test.js` and `tests/import-graph.test.js` (no new import cycle: `manifest.js` imports no type module).

- [ ] **Step 3: Commit**

```bash
git add package.json .claude-plugin/plugin.json
git commit -m "Genome annotation source; dataStaging by proposal id (2.8.0)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
