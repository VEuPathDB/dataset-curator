import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, cpSync, rmSync, writeFileSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import * as dnaseq from '../shared/scripts/dataset-types/dnaseq.js';
import { readDatasetClass, expandPattern, identityValues, CLASSES_RELATIVE_PATH } from '../shared/scripts/lib/dataset-classes.js';
import { loadManifest, PREVIEW_BUILD } from '../shared/scripts/dataset-types/_common.js';

const fixtures = new URL('./fixtures/', import.meta.url).pathname;
const src = join(fixtures, 'proposals', 'PRJNA000010');
const classDef = (() => {
  const repo = mkdtempSync(join(tmpdir(), 'classes-'));
  mkdirSync(join(repo, 'Model/lib/xml/datasetClass'), { recursive: true });
  cpSync(join(fixtures, 'classes.xml'), join(repo, CLASSES_RELATIVE_PATH));
  return readDatasetClass(repo, 'dnaseqExperiment');
})();

function staged(t, { overrides = {} } = {}) {
  const tmp = mkdtempSync(join(tmpdir(), 'dnaseq-'));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const dir = join(tmp, basename(src));
  cpSync(src, dir, { recursive: true, filter: (p) => !/expected/.test(p) });
  dnaseq.normalizeCurated(dir, overrides.dataset);
  const presenter = dnaseq.derivePresenter(dir, { shortDisplayName: 'Tfak WGS', shortAttribution: 'Doe 2025', ...overrides.presenter });
  writeFileSync(join(dir, 'curated', 'presenter.json'), JSON.stringify(presenter, null, 2) + '\n');
  writeFileSync(join(dir, 'curated', 'dataset.json'), JSON.stringify(dnaseq.deriveDataset(dir, classDef, overrides.dataset ?? {}), null, 2) + '\n');
  for (const [f, text] of Object.entries(dnaseq.deriveArtifacts(dir))) {
    const path = join(dir, 'curated', f);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
  return dir;
}

test('dnaseq dataset name follows the classes.xml datasetLoader pattern', () => {
  const m = loadManifest(src);
  assert.equal(dnaseq.datasetNameFor('tfakST1', m.name), expandPattern(classDef.datasetNamePattern, identityValues(m, 'tfakST1')));
  assert.deepEqual(dnaseq.presenterNames(src), ['tfakST1_Doe_isolates_2025_dnaseqExperiment_RSRC']);
});

test('dnaseq presenter defaults hasCNVData from the released chromosome count', (t) => {
  const dir = staged(t);
  assert.equal(JSON.parse(readFileSync(join(dir, 'curated', 'presenter.json'), 'utf-8')).injectorProps.hasCNVData, 'true');
  const contigs = join(dir, 'inputs', 'PRJNA000010_released_organism.json');
  const r = JSON.parse(readFileSync(contigs, 'utf-8')); r.released.chromosomeCount = 0; writeFileSync(contigs, JSON.stringify(r));
  assert.equal(dnaseq.derivePresenter(dir, {}).injectorProps.hasCNVData, 'false');
  assert.equal(dnaseq.derivePresenter(dir, { injectorProps: { hasCNVData: 'true' } }).injectorProps.hasCNVData, 'true');
});

test('dnaseq derivePresenter refuses a proposal without the released-organism input', (t) => {
  const dir = staged(t);
  rmSync(join(dir, 'inputs', 'PRJNA000010_released_organism.json'));
  assert.throws(() => dnaseq.derivePresenter(dir, {}), /check-released-organism\.js/);
});

test('dnaseq renders an IsolatesHTS presenter and a dataset entry with $$ploidy$$', (t) => {
  const dir = staged(t);
  const xml = dnaseq.renderPresenter(dir, { build: PREVIEW_BUILD });
  assert.match(xml, /<datasetPresenter name="tfakST1_Doe_isolates_2025_dnaseqExperiment_RSRC"\s+projectName="FungiDB">/);
  assert.match(xml, /className="org\.apidb\.apicommon\.model\.datasetInjector\.IsolatesHTS">\n\s*<prop name="hasCNVData">true<\/prop>/);
  assert.equal(readFileSync(join(src, 'expected.xml'), 'utf-8'), xml + '\n');
  const dataset = dnaseq.renderDataset(dir, classDef);
  assert.match(dataset, /<prop name="ploidy">\$\$ploidy\$\$<\/prop>/);
  assert.match(dataset, /<prop name="fromSRA">true<\/prop>/);
  assert.equal(readFileSync(join(src, 'expected-dataset.xml'), 'utf-8'), dataset + '\n');
});

test('dnaseq refuses a ploidy override, a non-SRA source and a library hard stop', (t) => {
  const dir = staged(t);
  assert.throws(() => dnaseq.deriveDataset(dir, classDef, { props: { ploidy: '2' } }), /ploidy comes from the organism file/);
  assert.throws(() => dnaseq.deriveDataset(dir, classDef, { source: { type: 'server', paths: ['/x'] } }), /reads from SRA only/);
  const sra = join(dir, 'inputs', 'PRJNA000010_sra_metadata.json');
  const d = JSON.parse(readFileSync(sra, 'utf-8')); d.runs[2].library_source = 'TRANSCRIPTOMIC'; writeFileSync(sra, JSON.stringify(d));
  assert.throws(() => dnaseq.deriveDataset(dir, classDef, {}), /SRR13: library_source is TRANSCRIPTOMIC/);
});

test('dnaseq artifacts: technical replicate runs share a sample, ids agree, and the layout is per organism', (t) => {
  const dir = staged(t);
  assert.equal(readFileSync(join(dir, 'curated', 'tfakST1', 'samplesheet.csv'), 'utf-8'), 'sample,fastq_1,fastq_2\nisolate_A,SRR11,\nisolate_A,SRR12,\nisolate_B,SRR13,\n');
  assert.deepEqual(dnaseq.checkCurated(dir), []);
  const { files } = dnaseq.renderArtifacts(dir, 'tfakST1');
  assert.deepEqual(Object.keys(files).sort(), [
    'sample-annotations-stf/tfakST1_Doe_isolates_2025_dnaseqExperiment_RSRC/entity-sample.tsv',
    'sample-annotations-stf/tfakST1_Doe_isolates_2025_dnaseqExperiment_RSRC/entity-sample.yaml',
    'sampleAnnotations.json', 'samplesheet.csv'
  ]);
});

test('dnaseq checkCurated names samplesheet ids missing from the STF', (t) => {
  const dir = staged(t);
  const tsv = join(dir, 'curated', 'tfakST1', 'entity-sample.tsv');
  writeFileSync(tsv, readFileSync(tsv, 'utf-8').replace('isolate_B', 'isolate_b'));
  assert.deepEqual(dnaseq.checkCurated(dir), ['samplesheet.csv and entity-sample.tsv disagree: only in samplesheet.csv: isolate_B; only in entity-sample.tsv: isolate_b']);
  assert.throws(() => dnaseq.assertCuratedAgree(dir), /isolate_B/);
});

test('dnaseq refuses organisms tags and files: it is single-organism and SRA-only', (t) => {
  const dir = staged(t);
  const path = join(dir, 'curated', 'PRJNA000010_sample_annotations.json');
  const a = JSON.parse(readFileSync(path, 'utf-8')); a.samples[0].organisms = ['tfakST1']; writeFileSync(path, JSON.stringify(a));
  assert.throws(() => dnaseq.normalizeCurated(dir), /single-organism/);
});
