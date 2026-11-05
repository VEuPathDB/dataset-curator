import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assemblyDirUrl, runFetch, verifyFetch } from '../shared/scripts/genome/commands/fetch.js';
import { PipelineError, sha256 } from '../shared/scripts/genome/workdir.js';
import { FIXED_NOW, fetchedWorkDir, stubNcbi, tempDir, TINY_ACCESSION, TINY_ASSEMBLY, TINY_GFF, TINY_REPORT, tinyFiles } from './genome-helpers.js';

const REPORT = `${TINY_ASSEMBLY}_assembly_report.txt`;
const GFF = `${TINY_ASSEMBLY}_genomic.gff.gz`;

test('assemblyDirUrl splits the accession digits the way NCBI FTP does', () => {
  assert.equal(assemblyDirUrl('GCA_000091225.2'), 'https://ftp.ncbi.nlm.nih.gov/genomes/all/GCA/000/091/225/');
  assert.equal(assemblyDirUrl('GCF_000002765.6'), 'https://ftp.ncbi.nlm.nih.gov/genomes/all/GCF/000/002/765/');
  assert.throws(() => assemblyDirUrl('PRJNA13833'), /PRJNA13833 is not an NCBI assembly accession/);
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
