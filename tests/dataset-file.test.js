import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { datasetNameExists, insertDataset, datasetFileRelativePath } from '../shared/scripts/lib/dataset-file.js';

const organismFile = readFileSync(new URL('./fixtures/tfakST1.xml', import.meta.url), 'utf-8');

test('the organism dataset file lives under its project', () => {
  assert.equal(datasetFileRelativePath('FungiDB', 'tfakST1'), 'Datasets/lib/xml/datasets/FungiDB/tfakST1.xml');
});

test('datasetNameExists matches class and name together', () => {
  assert.equal(datasetNameExists(organismFile, 'rnaSeqExperiment', 'Existing_2020'), true);
  assert.equal(datasetNameExists(organismFile, 'rnaSeqExperiment', 'Existing_2021'), false);
  assert.equal(datasetNameExists(organismFile, 'otherClass', 'Existing_2020'), false);
});

test('insertDataset appends before </datasets> with a blank line between entries', () => {
  const block = '  <dataset class="rnaSeqExperiment">\n    <prop name="name">New_2024</prop>\n  </dataset>';
  const out = insertDataset(organismFile, block);
  assert.ok(out.endsWith(`  </dataset>\n\n${block}\n</datasets>\n`));
  assert.equal(datasetNameExists(out, 'rnaSeqExperiment', 'New_2024'), true);
  assert.throws(() => insertDataset('<nope/>', block), /no closing <\/datasets> tag/);
});
