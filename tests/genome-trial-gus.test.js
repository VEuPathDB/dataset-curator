import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import {
  dockerRunArgs, inspectImage, inWork, parseAlgInvocationId, parseTsv, readImageFile, runGa, SELECT_ROWS_MOUNT, SELECT_ROWS_SCRIPT,
  selectRows, tail
} from '../shared/scripts/genome/trial/gus.js';
import { PipelineError } from '../shared/scripts/genome/workdir.js';
import { tempDir } from './genome-helpers.js';
import { GUS_HOME, IMAGE_ID, INSPECT_BASE } from './genome-trial-helpers.js';

const CTX = { workDir: '/data/work', image: 'gus_isf-model:unidb_shu_m-0123456789ab', gusHome: GUS_HOME, gusConfig: '/home/me/gus.config', user: '1000:1000' };

const GA_LOG_OK = [
  'Thu Nov  5 10:23:45 2026\tDSN\tdbi:Pg:dbname=UniDB_shu_m;host=localhost;port=5432',
  'Thu Nov  5 10:23:45 2026\tPLUGIN\tGUS::Supported::Plugin::LoadFastaSequences',
  'Thu Nov  5 10:23:45 2026\tAlgInvocationId\t7322',
  'Thu Nov  5 10:23:45 2026\tCOMMIT\tcommit on',
  'Thu Nov  5 10:23:55 2026\tTIME\t10 sec  (0:00:10)',
  'Thu Nov  5 10:23:55 2026\tRESULT\tInserted 11 sequences',
  'Thu Nov  5 10:23:55 2026\tAlgInvocationId\t7322',
  'Thu Nov  5 10:23:55 2026\tCOMMIT\tcommit on',
  ''
].join('\n');

const GA_LOG_DIED_IN_OPEN_INVOCATION = [
  "Invalid child name for Table GUS::Model::Core::AlgorithmInvocation_Table: 'GUS::Model::ApidbUserDatasets::AnnotationProperties'"
    + ' at /opt/veupathdb/gus_home/lib/perl/GUS/ObjRelP/DbiTable.pm line 312.',
  ''
].join('\n');

const GA_LOG_ISF_DIED = [
  'Thu Nov  5 10:30:01 2026\tDSN\tdbi:Pg:dbname=UniDB_shu_m;host=localhost;port=5432',
  'Thu Nov  5 10:30:01 2026\tPLUGIN\tGUS::Supported::Plugin::InsertSequenceFeatures',
  'Thu Nov  5 10:30:01 2026\tAlgInvocationId\t7325',
  'Thu Nov  5 10:30:01 2026\tCOMMIT\tcommit off',
  '',
  'ERROR:',
  'double check the number of CDS and exons of ECU10_0805, not consistant with the exon number',
  '',
  'STACK TRACE:',
  '  at /opt/veupathdb/gus_home/lib/perl/GUS/PluginMgr/GusApplication.pm line 598.',
  ''
].join('\n');

test('dockerRunArgs mounts gus.config read-only at $GUS_HOME/config and the work area at /work, as the host user', () => {
  assert.deepEqual(dockerRunArgs(CTX, ['ga', 'GUS::Supported::Plugin::InsertExternalDatabase', '--name', 'x']), [
    'run', '--rm', '--network', 'host', '-u', '1000:1000', '-e', 'HOME=/tmp',
    '-v', '/home/me/gus.config:/opt/veupathdb/gus_home/config/gus.config:ro', '-v', '/data/work:/work', '-w', '/work',
    CTX.image, 'ga', 'GUS::Supported::Plugin::InsertExternalDatabase', '--name', 'x'
  ]);
  assert.deepEqual(dockerRunArgs(CTX, ['perl', '/x.pl'], { stdin: true, mounts: ['/a:/b:ro'] }).slice(14),
    ['-v', '/a:/b:ro', '-i', CTX.image, 'perl', '/x.pl']);
  assert.equal(inWork('final/primary_chromosome', 'genome.gff'), '/work/final/primary_chromosome/genome.gff');
});

test('parseAlgInvocationId reads the first timestamped AlgInvocationId line and nothing else', () => {
  assert.equal(parseAlgInvocationId(GA_LOG_OK), 7322);
  assert.equal(parseAlgInvocationId(GA_LOG_ISF_DIED), 7325);
  assert.equal(parseAlgInvocationId(GA_LOG_DIED_IN_OPEN_INVOCATION), null);
  assert.equal(parseAlgInvocationId('Thu Nov  5 10:23:55 2026\tRESULT\tAlgInvocationId\t99\n'), null);
});

test('runGa writes the container output to the log and reads the invocation ID from it', () => {
  const logPath = join(tempDir('ga-'), 'logs', 'sequences:primary_chromosome.log');
  const calls = [];
  const exec = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    writeSync(opts.stdio[1], GA_LOG_OK);
    return null;
  };
  const result = runGa(CTX, { plugin: 'GUS::Supported::Plugin::LoadFastaSequences', args: ['--commit'] }, logPath, { exec });
  assert.deepEqual(result, { exitCode: 0, algInvocationId: 7322, log: GA_LOG_OK });
  assert.equal(readFileSync(logPath, 'utf-8'), GA_LOG_OK);
  assert.equal(calls[0].cmd, 'docker');
  assert.deepEqual(calls[0].args.slice(-3), ['ga', 'GUS::Supported::Plugin::LoadFastaSequences', '--commit']);
  assert.equal(calls[0].opts.stdio[0], 'ignore');
});

test('runGa reports the exit status of a failed ga with the ID it logged before dying', () => {
  const logPath = join(tempDir('ga-'), 'isfPrint:primary_chromosome.log');
  const exec = (cmd, args, opts) => {
    writeSync(opts.stdio[1], GA_LOG_ISF_DIED);
    throw Object.assign(new Error('Command failed'), { status: 255 });
  };
  const result = runGa(CTX, { plugin: 'GUS::Supported::Plugin::InsertSequenceFeatures', args: [] }, logPath, { exec });
  assert.equal(result.exitCode, 255);
  assert.equal(result.algInvocationId, 7325);
  assert.match(tail(result.log), /ERROR:\ndouble check the number of CDS/);
});

test('a missing docker binary is a PipelineError, not a failed step', () => {
  const exec = () => { throw Object.assign(new Error('spawnSync docker ENOENT'), { code: 'ENOENT' }); };
  assert.throws(() => runGa(CTX, { plugin: 'p', args: [] }, join(tempDir('ga-'), 'x.log'), { exec }),
    (e) => e instanceof PipelineError && e.file === 'docker' && e.problem === 'is not on PATH');
});

test('tail keeps the last 20 lines', () => {
  const text = `${Array.from({ length: 25 }, (_, i) => `line ${i + 1}`).join('\n')}\n`;
  assert.equal(tail(text), Array.from({ length: 20 }, (_, i) => `line ${i + 6}`).join('\n'));
});

test('parseTsv reads selectRows output: header, \\N as null, escapes undone', () => {
  assert.deepEqual(parseTsv('a\tb\tc\n1\t\\N\tx\\ty\\\\z\n\t\t\n'), [{ a: '1', b: null, c: 'x\ty\\z' }, { a: '', b: '', c: '' }]);
  assert.deepEqual(parseTsv('a\tb\n'), []);
  assert.deepEqual(parseTsv(''), []);
});

test('selectRows feeds the SQL on stdin to selectRows in the model image and parses its TSV', () => {
  const calls = [];
  const exec = (cmd, args, opts) => {
    calls.push({ args, opts });
    return 'name\trelease_id\ncuratorTrial_GCA_000000001.1_primary_chromosome_RSRC\t501\n';
  };
  const sql = '-- trial:releases\nSELECT d.name, r.external_database_release_id AS release_id FROM x';
  assert.deepEqual(selectRows(CTX, sql, { exec }), [{ name: 'curatorTrial_GCA_000000001.1_primary_chromosome_RSRC', release_id: '501' }]);
  assert.deepEqual(calls[0].args.slice(-4), ['-i', CTX.image, 'perl', '/opt/veupathdb/gus_home/bin/selectRows']);
  assert.equal(calls[0].opts.input, sql);
});

test('selectRows with mounted: true runs the host copy of selectRows.pl, for an image that lacks it', () => {
  const calls = [];
  const exec = (cmd, args) => { calls.push(args); return 'name\nUniDB_shu_m\n'; };
  assert.deepEqual(selectRows(CTX, '-- trial:database\nSELECT current_database() AS name', { exec, mounted: true }), [{ name: 'UniDB_shu_m' }]);
  assert.deepEqual(calls[0].slice(14), ['-v', `${SELECT_ROWS_SCRIPT}:${SELECT_ROWS_MOUNT}:ro`, '-i', CTX.image, 'perl', SELECT_ROWS_MOUNT]);
});

test('a failed SELECT is a PipelineError naming its query tag and what DBI printed', () => {
  const exec = () => {
    throw Object.assign(new Error('Command failed'), { status: 255, stdout: '', stderr: 'DBD::Pg::st execute failed: ERROR:  relation "core.tableinfo" does not exist' });
  };
  assert.throws(() => selectRows(CTX, '-- trial:schemaFingerprint\nSELECT 1', { exec }),
    (e) => e instanceof PipelineError && e.file === 'selectRows' && /^-- trial:schemaFingerprint failed: DBD::Pg::st execute failed/.test(e.problem));
});

test('inspectImage reads the image ID, GUS_HOME and labels, and null for no such image', () => {
  assert.deepEqual(inspectImage('gus_isf:local', { exec: () => INSPECT_BASE }), { id: IMAGE_ID, gusHome: GUS_HOME, labels: {} });
  const missing = () => { throw Object.assign(new Error('x'), { status: 1, stdout: '', stderr: 'Error response from daemon: No such image: nope:1' }); };
  assert.equal(inspectImage('nope:1', { exec: missing }), null);
  const down = () => { throw Object.assign(new Error('x'), { status: 1, stdout: '', stderr: 'Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?' }); };
  assert.throws(() => inspectImage('gus_isf:local', { exec: down }), /docker image inspect failed: Cannot connect to the Docker daemon/);
});

test('readImageFile cats a file from the image, or null when it is not there', () => {
  const calls = [];
  const exec = (cmd, args) => { calls.push(args); return 'abc\n'; };
  assert.equal(readImageFile('gus_isf:local', '/opt/x', { exec }), 'abc\n');
  assert.deepEqual(calls[0], ['run', '--rm', 'gus_isf:local', 'cat', '/opt/x']);
  const absent = () => { throw Object.assign(new Error('x'), { status: 1, stdout: '', stderr: 'cat: /opt/x: No such file or directory' }); };
  assert.equal(readImageFile('gus_isf:local', '/opt/x', { exec: absent }), null);
});
