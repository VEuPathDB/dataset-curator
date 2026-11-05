import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assemblyDirUrl, runFetch, verifyFetch } from '../shared/scripts/genome/commands/fetch.js';
import { PipelineError, sha256 } from '../shared/scripts/genome/workdir.js';
import { FIXED_NOW, fetchedWorkDir, stubNcbi, tempDir, TINY_ACCESSION, TINY_ASSEMBLY, TINY_GFF, TINY_REPORT, tinyFiles } from './genome-helpers.js';

const REPORT = `${TINY_ASSEMBLY}_assembly_report.txt`;
const GFF = `${TINY_ASSEMBLY}_genomic.gff.gz`;

test('assemblyDirUrl splits the accession digits the way NCBI FTP does', () => {
  assert.equal(assemblyDirUrl('GCA_000091225.2'), 'https://ftp.ncbi.nlm.nih.gov/genomes/all/GCA/000/091/225/');
  assert.equal(assemblyDirUrl('GCF_000002765.6'), 'https://ftp.ncbi.nlm.nih.gov/genomes/all/GCF/000/002/765/');
  assert.throws(() => assemblyDirUrl('PRJNA13833'), (e) => e instanceof PipelineError && /^fetch: PRJNA13833: is not an NCBI assembly accession/.test(e.message));
});

const listing = (...names) => async () => Buffer.from(names.map((n) => `<a href="${n}/">${n}/</a>`).join('\n'));

test('network errors become PipelineErrors naming the URL', async () => {
  const dirUrl = assemblyDirUrl(TINY_ACCESSION);
  await assert.rejects(runFetch({ workDir: tempDir('fetch-'), accession: TINY_ACCESSION, fetchBytes: async () => { throw new Error('ECONNRESET'); } }),
    (e) => e instanceof PipelineError && e.file === dirUrl && /download failed: ECONNRESET/.test(e.problem) && /retry fetch/.test(e.next));
});

test('a listing with two matching directories or an unsafe name is an error', async () => {
  const run = (...names) => runFetch({ workDir: tempDir('fetch-'), accession: TINY_ACCESSION, fetchBytes: listing(...names) });
  await assert.rejects(run(`${TINY_ASSEMBLY}`, `${TINY_ACCESSION}_OTHER`), /lists more than one assembly directory for GCA_000000001\.1: /);
  await assert.rejects(run(`${TINY_ACCESSION}_a b`), /unusable assembly directory name/);
});

test('a downloaded .gz that is empty or not gzip is refused and leaves no file behind', async () => {
  const bad = tinyFiles();
  bad[GFF] = Buffer.from('<html>error page</html>');
  const workDir = tempDir('fetch-');
  await assert.rejects(runFetch({ workDir, accession: TINY_ACCESSION, fetchBytes: stubNcbi(TINY_ACCESSION, TINY_ASSEMBLY, bad).fetchBytes }),
    (e) => e instanceof PipelineError && e.file.endsWith(GFF) && /empty or not a gzip file/.test(e.problem));
  bad[GFF] = Buffer.alloc(0);
  await assert.rejects(runFetch({ workDir, accession: TINY_ACCESSION, fetchBytes: stubNcbi(TINY_ACCESSION, TINY_ASSEMBLY, bad).fetchBytes }), /empty or not a gzip file/);
  assert.equal(existsSync(join(workDir, 'fetch', GFF)), false);
});

test('downloads and fetch.json are written atomically, leaving no .part files', async () => {
  const workDir = await fetchedWorkDir();
  assert.deepEqual(readdirSync(join(workDir, 'fetch')).filter((n) => n.endsWith('.part')), []);
});

test('a corrupt fetch.json is a PipelineError telling the curator to delete it', async () => {
  const workDir = await fetchedWorkDir();
  writeFileSync(join(workDir, 'fetch/fetch.json'), '{not json');
  await assert.rejects(runFetch({ workDir, accession: TINY_ACCESSION, fetchBytes: stubNcbi(TINY_ACCESSION, TINY_ASSEMBLY, tinyFiles()).fetchBytes }),
    (e) => e instanceof PipelineError && /is not JSON/.test(e.problem) && /delete fetch\/fetch\.json/.test(e.next));
});

test('fetch downloads the GFF, FASTA and report and records each sha256', async () => {
  const workDir = tempDir('fetch-');
  const ncbi = stubNcbi(TINY_ACCESSION, TINY_ASSEMBLY, tinyFiles());
  const record = await runFetch({ workDir, accession: TINY_ACCESSION, fetchBytes: ncbi.fetchBytes, now: FIXED_NOW });
  assert.equal(record.accession, TINY_ACCESSION);
  assert.equal(record.assembly, TINY_ASSEMBLY);
  assert.equal(record.fetchedAt, FIXED_NOW());
  assert.deepEqual(Object.keys(record.files), ['gff', 'fasta', 'report']);
  assert.equal(record.files.gff.url, `${assemblyDirUrl(TINY_ACCESSION)}${TINY_ASSEMBLY}/${GFF}`);
  assert.equal(record.files.report.sha256, sha256(TINY_REPORT));
  assert.equal(readFileSync(join(workDir, 'fetch', REPORT), 'utf-8'), TINY_REPORT);
  assert.deepEqual(JSON.parse(readFileSync(join(workDir, 'fetch/fetch.json'), 'utf-8')), record);
  assert.ok(ncbi.requests.every((url) => url.startsWith('https://ftp.ncbi.nlm.nih.gov/genomes/all/GCA/000/000/001/')));
});

test('a re-run reuses local files and keeps the first record', async () => {
  const workDir = await fetchedWorkDir();
  const before = statSync(join(workDir, 'fetch', GFF)).mtimeMs;
  const record = await runFetch({ workDir, accession: TINY_ACCESSION, fetchBytes: stubNcbi(TINY_ACCESSION, TINY_ASSEMBLY, tinyFiles()).fetchBytes, now: () => 'later' });
  assert.equal(record.fetchedAt, FIXED_NOW());
  assert.equal(statSync(join(workDir, 'fetch', GFF)).mtimeMs, before);
});

test('a remote file that drifted from fetch.json is an error naming the file', async () => {
  const workDir = await fetchedWorkDir();
  const drifted = stubNcbi(TINY_ACCESSION, TINY_ASSEMBLY, tinyFiles({ gff: TINY_GFF.replace('U4 snRNA', 'U6 snRNA') }));
  await assert.rejects(runFetch({ workDir, accession: TINY_ACCESSION, fetchBytes: drifted.fetchBytes }),
    (e) => e instanceof PipelineError && e.file === GFF && /NCBI's copy changed since 2026-11-04T00:00:00\.000Z/.test(e.problem));
});

test('an assembly with no annotation GFF is an error', async () => {
  const files = tinyFiles();
  delete files[GFF];
  await assert.rejects(runFetch({ workDir: tempDir('fetch-'), accession: TINY_ACCESSION, fetchBytes: stubNcbi(TINY_ACCESSION, TINY_ASSEMBLY, files).fetchBytes }),
    /fetch: .*genomic\.gff\.gz: GCA_000000001\.1 has no annotation GFF/);
});

test('an accession NCBI does not list is an error', async () => {
  await assert.rejects(runFetch({ workDir: tempDir('fetch-'), accession: 'GCA_000000009.1', fetchBytes: stubNcbi(TINY_ACCESSION, TINY_ASSEMBLY, tinyFiles()).fetchBytes }),
    /fetch: https:\/\/ftp\.ncbi\.nlm\.nih\.gov\/genomes\/all\/GCA\/000\/000\/009\/: lists no assembly directory for GCA_000000009\.1/);
});

test('verifyFetch returns the record and paths, and refuses a local file changed after fetch', async () => {
  const workDir = await fetchedWorkDir();
  const { record, paths } = verifyFetch(workDir, 'survey');
  assert.equal(record.assembly, TINY_ASSEMBLY);
  assert.equal(paths.report, join(workDir, 'fetch', REPORT));
  writeFileSync(join(workDir, 'fetch', REPORT), 'edited');
  assert.throws(() => verifyFetch(workDir, 'survey'), /^PipelineError: survey: .*assembly_report\.txt: does not match fetch\/fetch\.json\nNext: delete it and run fetch again$/);
  assert.throws(() => verifyFetch(tempDir('empty-'), 'build'), /fetch\.json: is missing\nNext: run fetch <assemblyAccession> first/);
});

test('verifyFetch refuses a hand-edited fetch.json missing a file role, naming the record', async () => {
  const workDir = await fetchedWorkDir();
  const path = join(workDir, 'fetch', 'fetch.json');
  const record = JSON.parse(readFileSync(path, 'utf-8'));
  const { fasta, ...files } = record.files;
  writeFileSync(path, JSON.stringify({ ...record, files: { ...files, gff: { ...files.gff, name: '../x' } } }));
  assert.throws(() => verifyFetch(workDir, 'survey'), (e) => e instanceof PipelineError && e.file === path
    && e.problem === 'is incomplete: no files.gff name and sha256, files.fasta name and sha256' && /delete fetch\/fetch\.json and run fetch again/.test(e.next));
  writeFileSync(path, '[]');
  assert.throws(() => verifyFetch(workDir, 'build'), /fetch\.json: is incomplete: no accession, files\.gff/);
});
