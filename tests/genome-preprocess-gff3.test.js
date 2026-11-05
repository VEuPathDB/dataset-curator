import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { apiCommonDataCommit, BIO_SEQIO_FIX, compileProblem, runPreprocessGFF3, SCRIPT_PATH } from '../shared/scripts/genome/preprocess-gff3.js';
import { gffLine, gffText, perlMissing, tempDir, withoutBioSeqIO } from './genome-helpers.js';

const ACD = process.env.APICOMMONDATA_DIR;
const failing = (stderr, code) => () => { throw Object.assign(new Error('Command failed'), { stderr, status: 2, ...(code && { code }) }); };

test('compileProblem is null for a script that compiles and returns what perl printed otherwise', () => {
  const calls = [];
  assert.equal(compileProblem('/x/preprocessGFF3', { exec: (cmd, args) => { calls.push([cmd, ...args]); return ''; } }), null);
  assert.deepEqual(calls, [['perl', '-c', '/x/preprocessGFF3']]);
  assert.match(compileProblem('/x', { exec: failing("Can't locate Bio/SeqIO.pm in @INC") }), /Can't locate Bio\/SeqIO\.pm/);
});

test('a missing perl throws instead of reporting a compile problem', () => {
  assert.throws(() => compileProblem('/x', { exec: failing('', 'ENOENT') }), /perl is not on PATH/);
});

test('BIO_SEQIO_FIX names the line to remove and the --preprocessGFF3 escape hatch', () => {
  assert.match(BIO_SEQIO_FIX, /`use Bio::SeqIO;`/);
  assert.match(BIO_SEQIO_FIX, /--preprocessGFF3/);
});

test('runPreprocessGFF3 passes input and output and refuses empty output', () => {
  const dir = tempDir('preprocess-');
  const calls = [];
  const out = join(dir, 'out.gff');
  runPreprocessGFF3('/s', '/in.gff3', out, { exec: (cmd, args) => { calls.push([cmd, ...args]); writeFileSync(out, 'x\n'); } });
  assert.deepEqual(calls, [['perl', '/s', '--input_gff', '/in.gff3', '--output_gff', out]]);
  assert.throws(() => runPreprocessGFF3('/s', '/in.gff3', join(dir, 'none.gff'), { exec: () => '' }), /preprocessGFF3 wrote nothing to .*none\.gff/);
  assert.throws(() => runPreprocessGFF3('/s', '/in.gff3', out, { exec: failing('boom') }),
    (e) => /preprocessGFF3 failed on \/in\.gff3: boom/.test(e.message) && e.input === '/in.gff3' && e.output === 'boom');
});

test('apiCommonDataCommit reads HEAD and dirtiness of a git checkout and refuses anything else', () => {
  const dir = tempDir('acd-');
  execFileSync('git', ['init', '-q', dir]);
  writeFileSync(join(dir, 'f'), 'x');
  execFileSync('git', ['-C', dir, 'add', '.']);
  execFileSync('git', ['-C', dir, '-c', 'user.email=t@apidb.org', '-c', 'user.name=T', 'commit', '-q', '-m', 'x']);
  const head = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim();
  assert.deepEqual(apiCommonDataCommit(dir), { commit: head, dirty: false });
  writeFileSync(join(dir, 'f'), 'changed');
  assert.deepEqual(apiCommonDataCommit(dir), { commit: head, dirty: true });
  assert.throws(() => apiCommonDataCommit(tempDir('not-git-')), /is not a git checkout/);
});

test('apiCommonDataCommit refuses a subdirectory of a repository and reports a missing git', () => {
  const dir = tempDir('acd-');
  execFileSync('git', ['init', '-q', dir]);
  mkdirSync(join(dir, 'sub'));
  assert.throws(() => apiCommonDataCommit(join(dir, 'sub')), /is not a git checkout: it is inside the repository at/);
  assert.throws(() => apiCommonDataCommit(dir, { exec: failing('', 'ENOENT') }), /git is not on PATH/);
});

test('the real preprocessGFF3 without its Bio::SeqIO line rewrites attributes GFF2-style',
  { skip: (!ACD && 'APICOMMONDATA_DIR is not set; point it at an ApiCommonData checkout') || perlMissing }, () => {
    const dir = tempDir('preprocess-real-');
    const script = withoutBioSeqIO(join(ACD, SCRIPT_PATH), dir);
    assert.equal(compileProblem(script), null);
    writeFileSync(join(dir, 'in.gff3'), gffText(gffLine('c', 'gene', 1, 9, '+', 'ID=g1;Note=a%2C b')));
    runPreprocessGFF3(script, join(dir, 'in.gff3'), join(dir, 'out.gff'));
    assert.equal(readFileSync(join(dir, 'out.gff'), 'utf-8'), 'c\tEMBL\tgene\t1\t9\t.\t+\t.\tID "g1";Note "a, b";\n');
  });
