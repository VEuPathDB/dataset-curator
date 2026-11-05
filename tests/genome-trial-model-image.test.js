import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseTsv, SELECT_ROWS_MOUNT, SELECT_ROWS_SCRIPT } from '../shared/scripts/genome/trial/gus.js';
import {
  BASE_IMAGE_LABEL, BUILD_MODEL, COLUMNS_SQL, ensureModelImage, FINGERPRINT_SQL, modelTag, schemaFingerprint, SELECT_ROWS_LABEL
} from '../shared/scripts/genome/trial/model-image.js';
import { PipelineError, sha256, sha256File } from '../shared/scripts/genome/workdir.js';
import { tempDir } from './genome-helpers.js';
import { DATABASE, fakeDocker, GUS_HOME, IMAGE, IMAGE_ID, INSPECT_BASE, modelInspect, SELECTS, USER } from './genome-trial-helpers.js';

const TABLES = '1\tAlgorithm\t1\n2\tAlgorithmImplementation\t1\n56\tExternalNASequence\t3';
const COLUMNS = 'core\talgorithm\talgorithm_id\tinteger\ncore\talgorithm\tname\tcharacter varying\ndots\tnafeatureimp\tna_feature_id\tbigint';
const FINGERPRINT = sha256(`${TABLES}\n--columns--\n${COLUMNS}`);
const TAG = `gus_isf-model:unidb_shu_m-${FINGERPRINT.slice(0, 12)}`;
const SUFFIX = 'a1b2c3d4';
const CONTAINER = `gus_isf-model-build-${FINGERPRINT.slice(0, 12)}-${SUFFIX}`;
const baseCtx = () => ({ workDir: tempDir('trial-work-'), image: IMAGE, gusHome: GUS_HOME, gusConfig: '/home/me/gus.config', user: USER });
const logOf = (ctx) => join(ctx.workDir, 'trial/logs/modelImage.log');
const ensure = (docker, ctx, options = {}) => ensureModelImage(ctx, DATABASE, { exec: docker.exec, logPath: logOf(ctx), suffix: SUFFIX, ...options });
const currentLabels = () => ({ [SELECT_ROWS_LABEL]: sha256File(SELECT_ROWS_SCRIPT), [BASE_IMAGE_LABEL]: IMAGE_ID });

test('schemaFingerprint hashes the tables in id order and the GUS schemas columns', () => {
  assert.equal(schemaFingerprint(parseTsv(SELECTS.schemaFingerprint), parseTsv(SELECTS.schemaColumns)), FINGERPRINT);
  assert.notEqual(schemaFingerprint(parseTsv(SELECTS.schemaFingerprint), parseTsv(SELECTS.schemaColumns.replace('bigint', 'integer'))), FINGERPRINT);
  assert.equal(FINGERPRINT_SQL, '-- trial:schemaFingerprint\nSELECT table_id, name, database_id FROM core.tableinfo ORDER BY table_id');
  assert.match(COLUMNS_SQL, /^-- trial:schemaColumns\nSELECT table_schema, table_name, column_name, data_type FROM information_schema\.columns .*core\.databaseinfo\) ORDER BY table_schema, table_name, column_name$/);
});

test('schemaFingerprint throws when either query returned no rows', () => {
  const tables = parseTsv(SELECTS.schemaFingerprint);
  const columns = parseTsv(SELECTS.schemaColumns);
  assert.throws(() => schemaFingerprint([], columns), PipelineError);
  assert.throws(() => schemaFingerprint(tables, []), PipelineError);
});

test('modelTag lower-cases the database name for Docker and keeps 12 characters of the fingerprint', () => {
  assert.equal(modelTag('UniDB_shu_m', FINGERPRINT), TAG);
  assert.equal(modelTag('My DB!', 'abcdef0123456789'), 'gus_isf-model:my_db_-abcdef012345');
});

test('modelTag caps the tag at 128 characters and refuses a name that would start it with . or -', () => {
  const tag = modelTag('d'.repeat(300), 'abcdef0123456789');
  assert.equal(tag.slice('gus_isf-model:'.length).length, 128);
  assert.ok(tag.endsWith('-abcdef012345'));
  for (const name of ['.hidden', '-flag', '']) {
    assert.throws(() => modelTag(name, 'abcdef0123456789'), (e) => e instanceof PipelineError && /cannot be used in a Docker tag/.test(e.problem), name);
  }
});

test('a missing model image is generated in the base image with bld GUS/Model, labelled and committed', () => {
  const docker = fakeDocker();
  const ctx = baseCtx();
  assert.deepEqual(ensure(docker, ctx), { modelTag: TAG, schemaFingerprint: FINGERPRINT, built: true });
  assert.deepEqual(docker.calls[0].args.slice(-3), [IMAGE, 'perl', SELECT_ROWS_MOUNT]);
  assert.equal(docker.calls[0].input, FINGERPRINT_SQL);
  assert.equal(docker.calls[1].input, COLUMNS_SQL);
  assert.deepEqual(docker.calls.slice(2).map((c) => c.args), [
    ['image', 'inspect', IMAGE],
    ['image', 'inspect', TAG],
    ['rm', '-f', CONTAINER],
    ['run', '--name', CONTAINER, '--pull', 'never', '--network', 'host',
      '--mount', `type=bind,src=/home/me/gus.config,dst=${GUS_HOME}/config/gus.config,readonly`,
      '--mount', `type=bind,src=${SELECT_ROWS_SCRIPT},dst=${SELECT_ROWS_MOUNT},readonly`, IMAGE, 'bash', '-c', BUILD_MODEL],
    ['commit', '--change', `LABEL ${SELECT_ROWS_LABEL}=${sha256File(SELECT_ROWS_SCRIPT)}`, '--change', `LABEL ${BASE_IMAGE_LABEL}=${IMAGE_ID}`,
      '--change', 'CMD ["bash"]', CONTAINER, TAG],
    ['rm', '-f', CONTAINER]
  ]);
  assert.equal(BUILD_MODEL, 'rm -rf $GUS_HOME/lib/perl/GUS/Model && bld GUS/Model && install -m 755 /opt/curator/selectRows.pl $GUS_HOME/bin/selectRows');
  assert.match(readFileSync(logOf(ctx), 'utf-8'), /BUILD SUCCESSFUL/);
});

test('the build container name carries a random suffix unless one is given', () => {
  const docker = fakeDocker();
  const ctx = baseCtx();
  ensureModelImage(ctx, DATABASE, { exec: docker.exec, logPath: logOf(ctx) });
  const name = docker.calls.find((c) => c.args[0] === 'run' && c.args[1] === '--name').args[2];
  assert.match(name, new RegExp(`^gus_isf-model-build-${FINGERPRINT.slice(0, 12)}-[0-9a-f]{8}$`));
  assert.notEqual(name, CONTAINER);
});

test('a model image tagged for this schema and labelled with this selectRows and base image is reused', () => {
  const docker = fakeDocker({ images: { [IMAGE]: INSPECT_BASE, [TAG]: modelInspect(currentLabels()) } });
  const ctx = baseCtx();
  assert.equal(ensure(docker, ctx).built, false);
  assert.deepEqual(docker.calls.map((c) => c.args[0]), ['run', 'run', 'image', 'image']);
});

test('a model image built with another selectRows is built again', () => {
  const docker = fakeDocker({ images: { [IMAGE]: INSPECT_BASE, [TAG]: modelInspect({ ...currentLabels(), [SELECT_ROWS_LABEL]: 'old' }) } });
  assert.equal(ensure(docker, baseCtx()).built, true);
});

test('a model image built on another base image is built again', () => {
  const docker = fakeDocker({ images: { [IMAGE]: INSPECT_BASE, [TAG]: modelInspect({ ...currentLabels(), [BASE_IMAGE_LABEL]: 'sha256:old' }) } });
  assert.equal(ensure(docker, baseCtx()).built, true);
  const unlabelled = fakeDocker({ images: { [IMAGE]: INSPECT_BASE, [TAG]: modelInspect({ [SELECT_ROWS_LABEL]: sha256File(SELECT_ROWS_SCRIPT) }) } });
  assert.equal(ensure(unlabelled, baseCtx()).built, true);
});

test('a database with no tables or columns in it is refused before anything is built', () => {
  const docker = fakeDocker({ selects: { schemaColumns: 'table_schema\ttable_name\tcolumn_name\tdata_type\n' } });
  assert.throws(() => ensure(docker, baseCtx()), PipelineError);
  assert.equal(docker.calls.some((c) => c.args[0] === 'commit'), false);
});

test('a failed bld names its log, shows its tail, commits nothing and removes the container', () => {
  const docker = fakeDocker({ buildExit: 2 });
  const ctx = baseCtx();
  assert.throws(() => ensure(docker, ctx),
    (e) => e instanceof PipelineError && e.file === logOf(ctx) && /^bld GUS\/Model exited 2:\n[\s\S]*BUILD FAILED/.test(e.problem));
  assert.equal(docker.calls.some((c) => c.args[0] === 'commit'), false);
  assert.deepEqual(docker.calls.at(-1).args, ['rm', '-f', CONTAINER]);
});
