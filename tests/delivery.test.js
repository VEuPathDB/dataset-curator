import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readlinkSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeDeliveryTree, deliveryHandoff } from '../shared/scripts/lib/delivery.js';

const F1 = 'FungiDB/a1/rnaSeq/N/v/final';
const F2 = 'HostDB/h1/rnaSeq/N/v/final';

function inputs() {
  const base = mkdtempSync(join(tmpdir(), 'delivery-'));
  const proposalDir = join(base, 'src/PRJNA1');
  mkdirSync(join(proposalDir, 'curated'), { recursive: true });
  writeFileSync(join(proposalDir, 'manifest.json'), '{}');
  const stagingDir = join(base, 'staging');
  mkdirSync(stagingDir);
  writeFileSync(join(stagingDir, 'big.gff3'), 'gff');
  const files = { [`${F1}/samplesheet.csv`]: 's1', [`${F2}/samplesheet.csv`]: 's2', 'common/rnaSeq/x/2026-10/final/a1_N_rnaSeq_RSRC/entity-sample.tsv': 't' };
  return { dir: join(base, 'delivery/PRJNA1'), finals: [F1, F2], files, proposalDir, accession: 'PRJNA1', stagingDir };
}

test('writeDeliveryTree lays out final/, fromProvider/ with the proposal and staging, links, workspace/ and the record', () => {
  const i = inputs();
  const record = writeDeliveryTree({ ...i, record: { accession: 'PRJNA1' } });
  assert.equal(readFileSync(join(i.dir, F1, 'samplesheet.csv'), 'utf-8'), 's1');
  const home = join(i.dir, 'FungiDB/a1/rnaSeq/N/v/fromProvider');
  assert.ok(existsSync(join(home, 'PRJNA1/manifest.json')));
  assert.equal(readFileSync(join(home, 'big.gff3'), 'utf-8'), 'gff');
  assert.equal(readlinkSync(join(i.dir, 'HostDB/h1/rnaSeq/N/v/fromProvider')), '../../../../../FungiDB/a1/rnaSeq/N/v/fromProvider');
  assert.ok(lstatSync(join(i.dir, 'HostDB/h1/rnaSeq/N/v/workspace')).isDirectory());
  const paths = record.files.map((f) => f.path);
  assert.ok(paths.includes(`${F1}/samplesheet.csv`) && paths.includes('FungiDB/a1/rnaSeq/N/v/fromProvider/big.gff3'));
  assert.ok(record.files.every((f) => /^[0-9a-f]{64}$/.test(f.sha256)));
  assert.deepEqual(JSON.parse(readFileSync(join(i.dir, 'delivery.json'), 'utf-8')), record);
});

test('a re-run replaces everything but workspace/', () => {
  const i = inputs();
  writeDeliveryTree({ ...i, record: {} });
  writeFileSync(join(i.dir, 'FungiDB/a1/rnaSeq/N/v/workspace/hours-of-work.bam'), 'bam');
  writeFileSync(join(i.dir, F1, 'stray.txt'), 'x');
  const record = writeDeliveryTree({ ...i, files: { ...i.files, [`${F1}/samplesheet.csv`]: 'new' }, record: {} });
  assert.equal(readFileSync(join(i.dir, 'FungiDB/a1/rnaSeq/N/v/workspace/hours-of-work.bam'), 'utf-8'), 'bam');
  assert.equal(existsSync(join(i.dir, F1, 'stray.txt')), false);
  assert.equal(readFileSync(join(i.dir, F1, 'samplesheet.csv'), 'utf-8'), 'new');
  assert.ok(!record.files.some((f) => f.path.includes('/workspace/')));
});

test('a delivery path not ending in final is refused before anything is written', () => {
  const i = inputs();
  assert.throws(() => writeDeliveryTree({ ...i, finals: ['FungiDB/a1/rnaSeq/N/v/data'], record: {} }), /must end in "final"/);
  assert.equal(existsSync(i.dir), false);
});

test('deliveryHandoff is one rsync that keeps links and leaves out the record', () => {
  assert.equal(deliveryHandoff({ dir: '/ws/delivery/PRJNA1', manualDelivery: { host: 'yew', root: '/m' } }),
    'Copy the delivery to the server; -a keeps the fromProvider links:\n  rsync -a --exclude delivery.json /ws/delivery/PRJNA1/ yew:/m/');
});
