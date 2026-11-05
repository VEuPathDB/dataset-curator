import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, cpSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import * as dnaseq from '../shared/scripts/dataset-types/dnaseq.js';
import * as chipseq from '../shared/scripts/dataset-types/chipseq.js';
import * as rnaseq from '../shared/scripts/dataset-types/bulk-rnaseq.js';
import { renderDatasets, onlyEntry, entryDeliveries } from '../shared/scripts/dataset-types/_common.js';
import { readDatasetClass, CLASSES_RELATIVE_PATH } from '../shared/scripts/lib/dataset-classes.js';
import { fixtures } from './helpers.js';

const cli = new URL('../shared/scripts/render-proposal.js', import.meta.url).pathname;

const CASES = [
  {
    mod: dnaseq, accession: 'PRJNA000010', className: 'dnaseqExperiment', dataset: {},
    presenter: { shortDisplayName: 'Tfak WGS', shortAttribution: 'Doe 2025' },
    final: 'FungiDB/tfakST1/SNP/Doe_isolates_2025/2025-03-01/final'
  },
  {
    mod: chipseq, accession: 'PRJNA000011', className: 'chipSeqExperiment', dataset: { props: { experimentType: 'histonemod' } },
    presenter: { shortDisplayName: 'Tfak histone', shortAttribution: 'Doe 2025' },
    final: 'FungiDB/tfakST1/chipSeq/Doe_histone_2025/2025-04-01/final'
  }
];

/** A throwaway checkout holding the fixture proposal curated as write-proposal leaves it. */
function checkoutWith(t, { mod, accession, className, dataset, presenter }) {
  const repo = mkdtempSync(join(tmpdir(), 'regression-'));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q', repo]);
  mkdirSync(join(repo, 'Model/lib/xml/datasetPresenters'), { recursive: true });
  mkdirSync(join(repo, 'Model/lib/xml/datasetClass'), { recursive: true });
  cpSync(join(fixtures, 'classes.xml'), join(repo, CLASSES_RELATIVE_PATH));
  const dir = join(repo, 'Proposals', accession);
  cpSync(join(fixtures, 'proposals', accession), dir, { recursive: true, filter: (p) => !/expected/.test(p) });
  mod.normalizeCurated(dir, dataset);
  writeFileSync(join(dir, 'curated', 'presenter.json'), JSON.stringify(mod.derivePresenter(dir, presenter), null, 2) + '\n');
  writeFileSync(join(dir, 'curated', 'dataset.json'), JSON.stringify(mod.deriveDataset(dir, readDatasetClass(repo, className), dataset), null, 2) + '\n');
  for (const [f, text] of Object.entries(mod.deriveArtifacts(dir))) {
    mkdirSync(dirname(join(dir, 'curated', f)), { recursive: true });
    writeFileSync(join(dir, 'curated', f), text);
  }
  return { repo, dir };
}

for (const c of CASES) {
  test(`${c.accession}: render-proposal --dataset prints its golden dataset entry`, (t) => {
    const { dir } = checkoutWith(t, c);
    const r = spawnSync('node', [cli, '--dataset', dir], { encoding: 'utf-8' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, readFileSync(join(fixtures, 'proposals', c.accession, 'expected-dataset.xml'), 'utf-8'));
  });

  test(`${c.accession}: render-proposal --artifacts delivers to the class path`, (t) => {
    const { repo, dir } = checkoutWith(t, c);
    const out = join(repo, '.curation', 'delivery');
    const r = spawnSync('node', [cli, '--artifacts', out, dir], { encoding: 'utf-8' });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.stdout.split('\n').includes(`${join(out, c.final)} → @@manualDeliveryDir@@/${c.final}/`), r.stdout);
    assert.ok(existsSync(join(out, c.final, 'samplesheet.csv')));
  });
}

test('PRJNA000002 in the datasets.json shape renders and delivers exactly as in the old shape', (t) => {
  const repo = mkdtempSync(join(tmpdir(), 'regression-v2-'));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  mkdirSync(join(repo, 'Model/lib/xml/datasetClass'), { recursive: true });
  cpSync(join(fixtures, 'classes.xml'), join(repo, CLASSES_RELATIVE_PATH));
  const golden = join(fixtures, 'proposals', 'PRJNA000002');
  const dir = join(repo, 'PRJNA000002');
  cpSync(golden, dir, { recursive: true });
  const manifestPath = join(dir, 'manifest.json');
  const { datasetClass, name, version, ...m } = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  const { props, source } = JSON.parse(readFileSync(join(dir, 'curated', 'dataset.json'), 'utf-8'));
  writeFileSync(manifestPath, JSON.stringify(m, null, 2) + '\n');
  rmSync(join(dir, 'curated', 'dataset.json'));
  writeFileSync(join(dir, 'curated', 'datasets.json'), JSON.stringify({ schemaVersion: 2, datasets: [{ datasetClass, name, version, props, source }] }, null, 2) + '\n');
  const classOf = (className) => readDatasetClass(repo, className);

  assert.equal(rnaseq.renderPresenter(dir, { build: '02' }) + '\n', readFileSync(join(golden, 'expected.xml'), 'utf-8'));
  assert.equal(renderDatasets(dir, m, rnaseq, classOf) + '\n', readFileSync(join(golden, 'expected-dataset.xml'), 'utf-8'));
  const artifacts = Object.entries(rnaseq.renderArtifacts(dir, 'tfakST1').files);
  assert.ok(artifacts.length > 0);
  for (const [file, text] of artifacts) {
    assert.equal(text, readFileSync(join(golden, 'expected-artifacts', file), 'utf-8'), file);
  }
  const [delivery] = entryDeliveries(m, [onlyEntry(dir, m)], { classOf });
  assert.equal(delivery.target, '@@manualDeliveryDir@@/FungiDB/tfakST1/rnaSeq/Doe_heat_shock_2024/2024-05-01/final/');
  assert.deepEqual([delivery.datasetName], rnaseq.presenterNames(dir));
});
