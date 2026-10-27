import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validationWorkspaceFor, validationWorkspaceNames } from '../shared/scripts/dataset-types/validators.js';

test('each dataset type names its validation workspace directory', () => {
  assert.equal(validationWorkspaceFor('bulk-rnaseq'), 'rnaseq-validation');
  assert.equal(validationWorkspaceFor('genome-assembly'), 'annotated-genome-validation');
  assert.equal(validationWorkspaceFor('nope'), null);
  assert.deepEqual(validationWorkspaceNames().sort(), ['annotated-genome-validation', 'rnaseq-validation']);
});
