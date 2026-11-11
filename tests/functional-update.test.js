import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import * as fu from '../shared/scripts/dataset-types/functional-update.js';
import { DATASET_TYPES } from '../shared/scripts/dataset-types/index.js';
import { ORGANISM_RULES } from '../shared/scripts/dataset-types/organism-rules.js';
import { assertValidEntries, loadManifest } from '../shared/scripts/dataset-types/_common.js';
import { parseDatasetClass } from '../shared/scripts/lib/dataset-classes.js';
import { fixtures } from './helpers.js';

export const FU = join(fixtures, 'proposals/tfakST1_productNames_20261111');
export const fixtureClassOf = (className) => parseDatasetClass(readFileSync(join(fixtures, 'classes.xml'), 'utf-8'), className);

test('functional-update is registered, single-entry, amends presenters and needs a released organism', () => {
  assert.equal(DATASET_TYPES['functional-update'], fu);
  assert.deepEqual(ORGANISM_RULES['functional-update'], { new: false, max: 1, pending: 'refuse' });
  assert.equal(fu.singleEntry, true);
  assert.equal(fu.amendsPresenters, true);
  assert.deepEqual(fu.datasetClasses, ['productNames', 'GeneOntologyAssociations', 'EnzymeCommissionAssociations', 'geneName', 'comments', 'aliases']);
  assert.equal(fu.validationWorkspace, 'functional-update-validation');
});

test('presenterNames names the organism\'s genome presenter', () => {
  assert.deepEqual(fu.presenterNames(FU), ['tfakST1_primary_genome_RSRC']);
});

test('the fixture\'s entry is valid against the fixture classes', () => {
  const entries = assertValidEntries(FU, loadManifest(FU), fu, { classOf: fixtureClassOf });
  assert.equal(entries[0].name, 'VEuPathDB');
});
