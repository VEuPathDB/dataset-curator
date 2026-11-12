import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdtempSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { validatorsFor } from '../shared/scripts/dataset-types/validators.js';
import { loadManifest } from '../shared/scripts/dataset-types/_common.js';
import { workFiles } from '../shared/scripts/dataset-types/functional-update/record.js';
import { fixtures } from './helpers.js';
import { convertedWorkArea } from './functional-update-helpers.js';

const FU = join(fixtures, 'proposals/tfakST1_productNames_20261111');
const byName = Object.fromEntries(validatorsFor('functional-update').map((v) => [v.name, v]));

test('functional-update registers converted (preprocess) and updateRecord (content)', () => {
  assert.deepEqual(validatorsFor('functional-update').map((v) => [v.name, v.kind]), [['converted', 'preprocess'], ['updateRecord', 'content']]);
});

test('updateRecord passes the fixture', async () => {
  assert.deepEqual(await byName.updateRecord.run({ proposalDir: FU, manifest: loadManifest(FU) }), []);
});

test('converted reports an unconverted work area as an error', async () => {
  const workArea = mkdtempSync(join(tmpdir(), 'fu-v-'));
  const findings = await byName.converted.run({ proposalDir: FU, manifest: loadManifest(FU), workArea, extras: {} });
  assert.deepEqual(findings.map((f) => [f.severity, f.message]), [['error', 'no convert.json in the work area; run functional-update.js fetch, columns and convert']]);
});

test('converted passes a current conversion, records its digest, and fails a pending genome', async () => {
  const extras = {};
  const workArea = await convertedWorkArea();
  assert.deepEqual(await byName.converted.run({ proposalDir: FU, manifest: loadManifest(FU), workArea, extras }), []);
  assert.match(extras.preprocess.convert, /^[0-9a-f]{64}$/);
  const pending = await convertedWorkArea({ pendingGenomes: ['GCA_9.1'] });
  const findings = await byName.converted.run({ proposalDir: FU, manifest: loadManifest(FU), workArea: pending, extras: {} });
  assert.deepEqual(findings.map((f) => f.severity), ['error']);
  assert.match(findings[0].message, /genome proposal GCA_9\.1 on master names tfakST1/);
});

test('converted fails when the work area changed after convert', async () => {
  const workArea = await convertedWorkArea();
  appendFileSync(workFiles(workArea).columns, ' ');
  const findings = await byName.converted.run({ proposalDir: FU, manifest: loadManifest(FU), workArea, extras: {} });
  assert.deepEqual(findings.map((f) => f.severity), ['error']);
  assert.match(findings[0].message, /columns\.json changed since convert/);
});
