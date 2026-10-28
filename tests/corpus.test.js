import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRemote } from '../shared/scripts/lib/remote.js';
import { corpusDir, corpusClashes, corpusStep, datasetIdOf } from '../shared/scripts/lib/corpus.js';

const RNA = { root: 'common/rnaSeq/sampleDetailsForEda', layout: 'per-dataset' };
const DNA = { root: 'common/dnaSeq/sampleDetailsForEda', layout: 'per-organism' };
const remote = createRemote({ host: null });

test('datasetIdOf is DS_ and the first 10 hex of sha1', () => {
  assert.match(datasetIdOf('tgonME49_x_dnaseqExperiment_RSRC'), /^DS_[0-9a-f]{10}$/);
});

test('corpusDir puts per-dataset under final/ and per-organism fragments under incoming/', () => {
  assert.equal(corpusDir(RNA, '2026-10', { datasetName: 'a_n_rnaSeq_RSRC', abbrev: 'a' }), 'common/rnaSeq/sampleDetailsForEda/2026-10/final/a_n_rnaSeq_RSRC');
  assert.equal(corpusDir(DNA, '2026-10', { datasetName: 'a_n_dnaseqExperiment_RSRC', abbrev: 'a' }), 'common/dnaSeq/sampleDetailsForEda/2026-10/incoming/a_n_dnaseqExperiment_RSRC/a');
});

test('per-dataset clashes: a name in an earlier release or retired; the target release and suffixed releases are ignored', () => {
  const m = mkdtempSync(join(tmpdir(), 'corpus-'));
  const c = join(m, RNA.root);
  for (const d of ['2026-07/final/old_rnaSeq_RSRC', '2026-08_v2/final/odd_rnaSeq_RSRC', '2026-10/final/mine_rnaSeq_RSRC']) mkdirSync(join(c, d), { recursive: true });
  writeFileSync(join(c, 'retired-datasets.tsv'), '# header\ngone_rnaSeq_RSRC\tnew_rnaSeq_RSRC\t2026-07-25\n');
  const clashes = corpusClashes({ remote, manualRoot: m, corpus: RNA, release: '2026-10', datasets: ['old', 'odd', 'mine', 'gone'].map((n) => ({ datasetName: `${n}_rnaSeq_RSRC` })) });
  assert.deepEqual(clashes, ['old_rnaSeq_RSRC is already in 2026-07/final', 'gone_rnaSeq_RSRC is retired (retired-datasets.tsv)']);
});

test('per-dataset clashes name only the earliest release when later ones link the dataset', () => {
  const m = mkdtempSync(join(tmpdir(), 'corpus-'));
  const c = join(m, RNA.root);
  for (const r of ['2026-07', '2026-08', '2026-09']) mkdirSync(join(c, r, 'final', 'old_rnaSeq_RSRC'), { recursive: true });
  const clashes = corpusClashes({ remote, manualRoot: m, corpus: RNA, release: '2026-10', datasets: [{ datasetName: 'old_rnaSeq_RSRC' }] });
  assert.deepEqual(clashes, ['old_rnaSeq_RSRC is already in 2026-07/final']);
});

test('per-organism clashes: the dataset_id is a row of the organism in an earlier release', () => {
  const m = mkdtempSync(join(tmpdir(), 'corpus-'));
  const dir = join(m, DNA.root, '2026-08/final/ToxoDB/tgonME49');
  mkdirSync(dir, { recursive: true });
  const name = 'tgonME49_x_dnaseqExperiment_RSRC';
  writeFileSync(join(dir, 'entity-sample.tsv'), `sample_id \\\\ Descriptors\tdataset_id\nRH\t${datasetIdOf(name)}\n`);
  const datasets = [{ datasetName: name, abbrev: 'tgonME49', project: 'ToxoDB' }, { datasetName: 'tgonME49_y_dnaseqExperiment_RSRC', abbrev: 'tgonME49', project: 'ToxoDB' }];
  assert.deepEqual(corpusClashes({ remote, manualRoot: m, corpus: DNA, release: '2026-10', datasets }), [`${name} (${datasetIdOf(name)}) is already in 2026-08/final/ToxoDB/tgonME49`]);
});

test('per-organism clashes: no earlier releases or a missing corpus root is no clash', () => {
  const datasets = [{ datasetName: 'tgonME49_x_dnaseqExperiment_RSRC', abbrev: 'tgonME49', project: 'ToxoDB' }];
  const empty = mkdtempSync(join(tmpdir(), 'corpus-'));
  assert.deepEqual(corpusClashes({ remote, manualRoot: empty, corpus: DNA, release: '2026-10', datasets }), []);
  const onlyTarget = mkdtempSync(join(tmpdir(), 'corpus-'));
  mkdirSync(join(onlyTarget, DNA.root, '2026-10/final'), { recursive: true });
  assert.deepEqual(corpusClashes({ remote, manualRoot: onlyTarget, corpus: DNA, release: '2026-10', datasets }), []);
});

test('corpusStep: make-cumulative-links for per-dataset, a by-hand note for per-organism', () => {
  const md = { host: 'yew', root: '/eupath/data/EuPathDB/manualDelivery' };
  assert.equal(corpusStep(RNA, '2026-10', md), "ssh yew '/eupath/data/EuPathDB/manualDelivery/common/rnaSeq/sampleDetailsForEda/make-cumulative-links.sh 2026-10'");
  assert.equal(corpusStep(DNA, '2026-10', md), 'Merge yew:/eupath/data/EuPathDB/manualDelivery/common/dnaSeq/sampleDetailsForEda/2026-10/incoming/ into its 2026-10/final/ by hand (study-wrangler harmonization; not automated yet)');
});
