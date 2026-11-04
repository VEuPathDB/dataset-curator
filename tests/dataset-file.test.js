import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { datasetNameExists, entryDatasetExists, insertDataset, datasetFileRelativePath } from '../shared/scripts/lib/dataset-file.js';
import { parseDatasetClass } from '../shared/scripts/lib/dataset-classes.js';

const organismFile = readFileSync(new URL('./fixtures/tfakST1.xml', import.meta.url), 'utf-8');

test('the organism dataset file lives under its project', () => {
  assert.equal(datasetFileRelativePath('FungiDB', 'tfakST1'), 'Datasets/lib/xml/datasets/FungiDB/tfakST1.xml');
});

test('datasetNameExists matches class and name together', () => {
  assert.equal(datasetNameExists(organismFile, 'rnaSeqExperiment', 'Existing_2020'), true);
  assert.equal(datasetNameExists(organismFile, 'rnaSeqExperiment', 'Existing_2021'), false);
  assert.equal(datasetNameExists(organismFile, 'otherClass', 'Existing_2020'), false);
});

test('entryDatasetExists compares the values the class datasetName uses, as written, not (class, name)', () => {
  const classes = readFileSync(new URL('./fixtures/classes.xml', import.meta.url), 'utf-8');
  const secondary = parseDatasetClass(classes, 'fasta_secondary_genome');
  const file = '<datasets>\n  <dataset class="fasta_secondary_genome">\n    <prop name="name">$$genomeSource$$</prop>\n    <prop name="soTerm">contig</prop>\n  </dataset>\n</datasets>\n';
  const entry = (soTerm) => ({ datasetClass: 'fasta_secondary_genome', name: '$$genomeSource$$', version: '$$genomeVersion$$', props: { soTerm } });
  assert.equal(entryDatasetExists(file, secondary, entry('contig')), true);
  assert.equal(entryDatasetExists(file, secondary, entry('supercontig')), false);
  const rna = parseDatasetClass(classes, 'rnaSeqExperiment');
  assert.equal(entryDatasetExists(organismFile, rna, { name: 'Existing_2020', props: {} }), true);
  assert.equal(entryDatasetExists(organismFile, rna, { name: 'Existing_2021', props: {} }), false);
});

test('insertDataset appends before </datasets> with a blank line between entries', () => {
  const block = '  <dataset class="rnaSeqExperiment">\n    <prop name="name">New_2024</prop>\n  </dataset>';
  const out = insertDataset(organismFile, block);
  assert.ok(out.endsWith(`  </dataset>\n\n${block}\n</datasets>\n`));
  assert.equal(datasetNameExists(out, 'rnaSeqExperiment', 'New_2024'), true);
  assert.throws(() => insertDataset('<nope/>', block), /no closing <\/datasets> tag/);
});
