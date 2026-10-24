import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixtures } from './helpers.js';
import { consistency } from '../shared/scripts/dataset-types/bulk-rnaseq/validators/consistency.js';
import { libraryType, MIN_SPOTS, MGI_WARNING, ION_TORRENT_WARNING } from '../shared/scripts/dataset-types/bulk-rnaseq/validators/library-type.js';

/** A scratch copy of the PRJNA000002 fixture whose SRA metadata has the given runs. */
function proposal(runs) {
  const dir = join(mkdtempSync(join(tmpdir(), 'validators-')), 'PRJNA000002');
  cpSync(join(fixtures, 'proposals/PRJNA000002'), dir, { recursive: true });
  if (runs) writeFileSync(join(dir, 'inputs/PRJNA000002_sra_metadata.json'), JSON.stringify({ bioproject: 'PRJNA000002', runs }));
  return { proposalDir: dir, manifest: JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf-8')) };
}
const run = (id, extra = {}) => ({
  run_accession: id, library_strategy: 'RNA-Seq', library_source: 'TRANSCRIPTOMIC', library_selection: 'cDNA',
  instrument_platform: 'ILLUMINA', read_count: '2000000', ...extra
});
const severities = (findings) => findings.map((f) => f.severity);
const errors = (findings) => findings.filter((f) => f.severity === 'error').map((f) => f.message);

test('libraryType passes Illumina bulk RNA-seq with enough reads, noting the selection', async () => {
  const findings = await libraryType.run(proposal([run('SRR1'), run('SRR2')]));
  assert.deepEqual(severities(findings), ['info']);
  assert.match(findings[0].message, /library_selection cDNA \(2 runs\)/);
});

test('libraryType refuses other strategies and sources by name', async () => {
  const findings = await libraryType.run(proposal([run('SRR1', { library_strategy: 'ChIP-Seq' }), run('SRR2', { library_source: 'TRANSCRIPTOMIC SINGLE CELL' })]));
  assert.deepEqual(errors(findings), [
    'library_strategy is ChIP-Seq for SRR1; bulk RNA-seq needs RNA-Seq',
    'library_source is TRANSCRIPTOMIC SINGLE CELL for SRR2; bulk RNA-seq needs TRANSCRIPTOMIC'
  ]);
});

test('libraryType warns for MGI and Ion Torrent with what can go wrong', async () => {
  const findings = await libraryType.run(proposal([run('SRR1', { instrument_platform: 'DNBSEQ' }), run('SRR2', { instrument_platform: 'ION_TORRENT' })]));
  const warnings = findings.filter((f) => f.severity === 'warning').map((f) => f.message);
  assert.deepEqual(warnings, [`DNBSEQ (SRR1): ${MGI_WARNING}`, `ION_TORRENT (SRR2): ${ION_TORRENT_WARNING}`]);
  assert.match(MGI_WARNING, /clips only Illumina adapters/);
  assert.match(ION_TORRENT_WARNING, /homopolymer/);
});

test('libraryType refuses long-read and unknown platforms', async () => {
  const findings = await libraryType.run(proposal([run('SRR1', { instrument_platform: 'OXFORD_NANOPORE' }), run('SRR2', { instrument_platform: undefined })]));
  assert.deepEqual(errors(findings), [
    'OXFORD_NANOPORE (SRR1) is not a short-read platform bulk-rnaseq-nextflow handles; long reads belong in long-read-rnaseq-nextflow',
    '(missing) (SRR2) is not a short-read platform bulk-rnaseq-nextflow handles'
  ]);
});

test('libraryType sums technical replicates per sample before the depth floor', async () => {
  const p = proposal([run('SRR1', { read_count: '600000' }), run('SRR3', { read_count: '600000' }), run('SRR2', { read_count: '999999' })]);
  const sheet = join(p.proposalDir, 'curated/tfakST1/samplesheet.csv');
  writeFileSync(sheet, 'sample,fastq_1,fastq_2,strandedness\nSAMN1,SRR1,,stranded\nSAMN1,SRR3,,stranded\nSAMN2,SRR2,,stranded\n');
  assert.equal(MIN_SPOTS, 1000000);
  assert.deepEqual(errors(await libraryType.run(p)), ['SAMN2 has 999,999 spots in SRR2; at least 1,000,000 are needed']);
});

test('libraryType refuses a samplesheet run missing from the metadata or without a read count', async () => {
  assert.deepEqual(errors(await libraryType.run(proposal([run('SRR1')]))), ['SAMN2: SRR2 not in the SRA metadata']);
  assert.deepEqual(errors(await libraryType.run(proposal([run('SRR1'), run('SRR2', { read_count: '' })]))), ['SAMN2: no read_count for SRR2']);
});

test('libraryType refuses an SRA proposal without metadata, and only warns for reads on a server', async () => {
  const p = proposal();
  rmSync(join(p.proposalDir, 'inputs/PRJNA000002_sra_metadata.json'));
  assert.deepEqual(errors(await libraryType.run(p)), ['inputs/PRJNA000002_sra_metadata.json is missing, so library type and depth cannot be checked']);
  const dataset = join(p.proposalDir, 'curated/dataset.json');
  writeFileSync(dataset, JSON.stringify({ ...JSON.parse(readFileSync(dataset, 'utf-8')), source: { type: 'server' } }));
  const findings = await libraryType.run(p);
  assert.deepEqual(severities(findings), ['warning']);
  assert.match(findings[0].message, /No SRA metadata: library type and depth not checked; confirm by hand/);
});

test('libraryType warns that depth is unchecked for server reads that do have metadata', async () => {
  const p = proposal([run('SRR1'), run('SRR2')]);
  const dataset = join(p.proposalDir, 'curated/dataset.json');
  writeFileSync(dataset, JSON.stringify({ ...JSON.parse(readFileSync(dataset, 'utf-8')), source: { type: 'server' } }));
  const warnings = (await libraryType.run(p)).filter((f) => f.severity === 'warning').map((f) => f.message);
  assert.deepEqual(warnings, ['Reads come from server: depth not checked; confirm by hand']);
});

const rewrite = (path, from, to) => writeFileSync(path, readFileSync(path, 'utf-8').replace(from, to));

test('consistency passes the fixture', async () => {
  assert.deepEqual(await consistency.run(proposal()), []);
});

test('consistency reports a label that differs between files', async () => {
  const p = proposal();
  rewrite(join(p.proposalDir, 'curated/tfakST1/entity-sample.tsv'), 'SAMN2\tSRR2\tStressed', 'SAMN2\tSRR2\tStresed');
  assert.deepEqual(await consistency.run(p), [{
    validator: 'consistency', severity: 'error', organism: 'tfakST1',
    message: 'SAMN2 has different labels: annotations "Stressed", analysisConfig.xml "Stressed", entity-sample.tsv "Stresed"'
  }]);
});

test('consistency reports runs that differ between files', async () => {
  const p = proposal();
  rewrite(join(p.proposalDir, 'curated/tfakST1/samplesheet.csv'), 'SAMN1,SRR1,', 'SAMN1,SRR9,');
  const [f] = await consistency.run(p);
  assert.equal(f.message, 'SAMN1 has different runs: annotations SRR1, samplesheet.csv SRR9, entity-sample.tsv SRR1');
});

test('consistency passes checkCurated errors through', async () => {
  const p = proposal();
  rewrite(join(p.proposalDir, 'curated/tfakST1/entity-sample.tsv'), 'SAMN2\t', 'SAMN3\t');
  const findings = await consistency.run(p);
  assert.ok(findings.length > 0);
  assert.ok(findings.every((f) => f.validator === 'consistency' && f.severity === 'error'));
  assert.match(findings[0].message, /samplesheet\.csv and entity-sample\.tsv disagree/);
});

import { perlParse } from '../shared/scripts/dataset-types/bulk-rnaseq/validators/perl-parse.js';
import { stf } from '../shared/scripts/dataset-types/bulk-rnaseq/validators/stf.js';

const acd = { libDir: '/acd/Load/lib/perl', perl: '/usr/bin/perl', version: 'c0ffee' };
const parsedAs = (parsed) => () => JSON.stringify(parsed);
const fixtureParse = {
  steps: [{ class: 'ApiCommonData::Load::RnaSeqAnalysisEbi', arguments: { profileSetName: 'Testus fakeus stress & recovery' } }],
  groups: [{ displayName: 'Control', samples: ['SAMN1'] }, { displayName: 'Stressed', samples: ['SAMN2'] }]
};

test('perlParse passes when the parser sees one RnaSeqAnalysisEbi step and the label groups', async () => {
  assert.deepEqual(await perlParse.run({ ...proposal(), tools: { apiCommonData: acd }, exec: parsedAs(fixtureParse) }), []);
});

test('perlParse reports a parse failure, a wrong step and different groups', async () => {
  const failing = () => { throw Object.assign(new Error('x'), { stderr: 'not well-formed (invalid token) at line 3' }); };
  const [crash] = await perlParse.run({ ...proposal(), tools: { apiCommonData: acd }, exec: failing });
  assert.equal(crash.message, 'AnalysisConfigParser could not read analysisConfig.xml: not well-formed (invalid token) at line 3');

  const [step] = await perlParse.run({ ...proposal(), tools: { apiCommonData: acd }, exec: parsedAs({ ...fixtureParse, steps: [{ class: 'Other', arguments: {} }] }) });
  assert.equal(step.message, 'expected one ApiCommonData::Load::RnaSeqAnalysisEbi step, got Other');

  const merged = { ...fixtureParse, groups: [{ displayName: 'Control', samples: ['SAMN1', 'SAMN2'] }] };
  const [groups] = await perlParse.run({ ...proposal(), tools: { apiCommonData: acd }, exec: parsedAs(merged) });
  assert.equal(groups.message, 'ApiCommonData groups the samples as Control: SAMN1, SAMN2; the annotations as Control: SAMN1 | Stressed: SAMN2');
});

test('perlParse expects the profileSetName suffix on every group display name', async () => {
  const suffixed = {
    steps: [{ class: 'ApiCommonData::Load::RnaSeqAnalysisEbi', arguments: { profileSetName: 'Heat - sense' } }],
    groups: [{ displayName: 'Control - sense', samples: ['SAMN1'] }, { displayName: 'Stressed - sense', samples: ['SAMN2'] }]
  };
  assert.deepEqual(await perlParse.run({ ...proposal(), tools: { apiCommonData: acd }, exec: parsedAs(suffixed) }), []);
});

test('stf reports what study.wrangler printed when it rejects the entity', async () => {
  const sw = { rscript: '/usr/bin/Rscript', env: {}, version: '1.0.41' };
  assert.deepEqual(await stf.run({ ...proposal(), tools: { studyWrangler: sw }, exec: () => 'Entity is valid.' }), []);
  const rejecting = () => { throw Object.assign(new Error('x'), { stdout: 'Entity is not valid: duplicate IDs' }); };
  assert.deepEqual(await stf.run({ ...proposal(), tools: { studyWrangler: sw }, exec: rejecting }), [{
    validator: 'stf', severity: 'error', organism: 'tfakST1', message: 'study.wrangler rejected entity-sample: Entity is not valid: duplicate IDs'
  }]);
});
