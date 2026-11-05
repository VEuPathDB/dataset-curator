import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseTsv, SELECT_ROWS_MOUNT, SELECT_ROWS_SCRIPT } from '../shared/scripts/genome/trial/gus.js';
import {
  BUILD_MODEL, ensureModelImage, FINGERPRINT_SQL, modelTag, schemaFingerprint, SELECT_ROWS_LABEL
} from '../shared/scripts/genome/trial/model-image.js';
import { PipelineError, sha256, sha256File } from '../shared/scripts/genome/workdir.js';
import { tempDir } from './genome-helpers.js';
import { DATABASE, fakeDocker, GUS_HOME, IMAGE, INSPECT_BASE, modelInspect, SELECTS, USER } from './genome-trial-helpers.js';

const FINGERPRINT = sha256('1\tAlgorithm\t1\n2\tAlgorithmImplementation\t1\n56\tExternalNASequence\t3');
const TAG = `gus_isf-model:unidb_shu_m-${FINGERPRINT.slice(0, 12)}`;
const CONTAINER = `gus_isf-model-build-${FINGERPRINT.slice(0, 12)}`;
const baseCtx = () => ({ workDir: tempDir('trial-work-'), image: IMAGE, gusHome: GUS_HOME, gusConfig: '/home/me/gus.config', user: USER });
const logOf = (ctx) => join(ctx.workDir, 'trial/logs/modelImage.log');

test('schemaFingerprint hashes table_id, name and database_id in id order', () => {
  assert.equal(schemaFingerprint(parseTsv(SELECTS.schemaFingerprint)), FINGERPRINT);
  assert.equal(FINGERPRINT_SQL, '-- trial:schemaFingerprint\nSELECT table_id, name, database_id FROM core.tableinfo ORDER BY table_id');
});

test('modelTag lower-cases the database name for Docker and keeps 12 characters of the fingerprint', () => {
  assert.equal(modelTag('UniDB_shu_m', FINGERPRINT), TAG);
  assert.equal(modelTag('My DB!', 'abcdef0123456789'), 'gus_isf-model:my_db_-abcdef012345');
});

test('a missing model image is generated in the base image with bld GUS/Model, labelled and committed', () => {
  const docker = fakeDocker();
  const ctx = baseCtx();
  assert.deepEqual(ensureModelImage(ctx, DATABASE, { exec: docker.exec, logPath: logOf(ctx) }), { modelTag: TAG, schemaFingerprint: FINGERPRINT, built: true });
  assert.deepEqual(docker.calls[0].args.slice(-3), [IMAGE, 'perl', SELECT_ROWS_MOUNT]);
  assert.equal(docker.calls[0].input, FINGERPRINT_SQL);
  assert.deepEqual(docker.calls.slice(1).map((c) => c.args), [
    ['image', 'inspect', TAG],
    ['rm', '-f', CONTAINER],
    ['run', '--name', CONTAINER, '--pull', 'never', '--network', 'host',
      '--mount', `type=bind,src=/home/me/gus.config,dst=${GUS_HOME}/config/gus.config,readonly`,
      '--mount', `type=bind,src=${SELECT_ROWS_SCRIPT},dst=${SELECT_ROWS_MOUNT},readonly`, IMAGE, 'bash', '-c', BUILD_MODEL],
    ['commit', '--change', `LABEL ${SELECT_ROWS_LABEL}=${sha256File(SELECT_ROWS_SCRIPT)}`, CONTAINER, TAG],
    ['rm', '-f', CONTAINER]
  ]);
  assert.equal(BUILD_MODEL, 'rm -rf $GUS_HOME/lib/perl/GUS/Model && bld GUS/Model && install -m 755 /opt/curator/selectRows.pl $GUS_HOME/bin/selectRows');
  assert.match(readFileSync(logOf(ctx), 'utf-8'), /BUILD SUCCESSFUL/);
});

test('a model image tagged for this schema and labelled with this selectRows is reused', () => {
  const docker = fakeDocker({ images: { [IMAGE]: INSPECT_BASE, [TAG]: modelInspect({ [SELECT_ROWS_LABEL]: sha256File(SELECT_ROWS_SCRIPT) }) } });
  const ctx = baseCtx();
  assert.equal(ensureModelImage(ctx, DATABASE, { exec: docker.exec, logPath: logOf(ctx) }).built, false);
  assert.deepEqual(docker.calls.map((c) => c.args[0]), ['run', 'image']);
});

test('a model image built with another selectRows is built again', () => {
  const docker = fakeDocker({ images: { [IMAGE]: INSPECT_BASE, [TAG]: modelInspect({ [SELECT_ROWS_LABEL]: 'old' }) } });
  const ctx = baseCtx();
  assert.equal(ensureModelImage(ctx, DATABASE, { exec: docker.exec, logPath: logOf(ctx) }).built, true);
});

test('a failed bld names its log, shows its tail, commits nothing and removes the container', () => {
  const docker = fakeDocker({ buildExit: 2 });
  const ctx = baseCtx();
  assert.throws(() => ensureModelImage(ctx, DATABASE, { exec: docker.exec, logPath: logOf(ctx) }),
    (e) => e instanceof PipelineError && e.file === logOf(ctx) && /^bld GUS\/Model exited 2:\n[\s\S]*BUILD FAILED/.test(e.problem));
  assert.equal(docker.calls.some((c) => c.args[0] === 'commit'), false);
  assert.deepEqual(docker.calls.at(-1).args, ['rm', '-f', CONTAINER]);
});
