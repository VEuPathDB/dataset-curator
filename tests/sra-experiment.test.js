import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sraExperimentType } from '../shared/scripts/dataset-types/_sra-experiment.js';
import * as dnaseq from '../shared/scripts/dataset-types/dnaseq.js';

const SHARED = ['derivedCuratedFiles', 'presenterNames', 'normalizeCurated', 'deriveArtifacts', 'checkCurated', 'assertCuratedAgree', 'renderArtifacts', 'corpusFiles', 'stagingProblems'];

test('the factory returns every shared export, and dnaseq exports them', () => {
  const shared = sraExperimentType({ type: 't', datasetClass: 'c', datasetNameFor: (o, n) => `${o}_${n}` });
  assert.deepEqual(Object.keys(shared).sort(), [...SHARED].sort());
  for (const name of SHARED) assert.equal(typeof dnaseq[name], typeof shared[name], name);
});
