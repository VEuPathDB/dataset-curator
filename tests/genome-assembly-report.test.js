import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classifySequence, findReportRow, parseAssemblyReport, reportTaxonId } from '../shared/scripts/genome/assembly-report.js';
import { ECUN_REPORT } from './genome-helpers.js';

test('parseAssemblyReport reads the NCBI report by header name, CRLF and all', () => {
  const report = parseAssemblyReport(readFileSync(ECUN_REPORT, 'utf-8'));
  assert.deepEqual(report.rows.map((r) => [r.sequenceName, r.role, r.locationType, r.genbank, r.refseq]), [
    ['X', 'assembled-molecule', 'Chromosome', 'AL590449.1', 'NC_003236.1'],
    ['XI', 'assembled-molecule', 'Chromosome', 'AL590450.2', 'NC_003237.2']
  ]);
  assert.equal(findReportRow(report, 'NC_003237.2').index, 1);
  assert.equal(findReportRow(report, 'AL590449.1').row.sequenceName, 'X');
  assert.equal(findReportRow(report, 'na'), null);
  assert.equal(findReportRow(report, 'AL000000.1'), null);
});

test('a report with no Sequence-Name header is refused', () => {
  assert.throws(() => parseAssemblyReport('# Assembly name: x\nI\tassembled-molecule\n'), /no "# Sequence-Name" header line/);
});

test('a report missing a required column is refused with a PipelineError naming it', () => {
  const text = '# Sequence-Name\tSequence-Role\tGenBank-Accn\nI\tassembled-molecule\tCM000001.1\n';
  assert.throws(() => parseAssemblyReport(text, 'fetch/report.txt'), (e) =>
    e.name === 'PipelineError' && e.command === 'survey' && e.file === 'fetch/report.txt'
    && /"Assigned-Molecule-Location\/Type", "RefSeq-Accn" column/.test(e.problem) && e.next.length > 0);
  assert.throws(() => parseAssemblyReport(text, 'r.txt', 'build'), { command: 'build' });
});

test('whitespace-only lines are skipped and repeated accessions are recorded', () => {
  const header = '# Sequence-Name\tSequence-Role\tAssigned-Molecule-Location/Type\tGenBank-Accn\tRefSeq-Accn';
  const report = parseAssemblyReport(`${header}\nA\tassembled-molecule\tChromosome\tCM1.1\tna\n  \nB\tassembled-molecule\tChromosome\tCM1.1\tNC_2.1\n`);
  assert.equal(report.rows.length, 2);
  assert.deepEqual([...report.duplicateAccessions], ['CM1.1']);
  assert.equal(findReportRow(report, 'NC_2.1').row.sequenceName, 'B');
});

test('classifySequence ranks by role, location type and accession', () => {
  const row = (role, locationType, genbank) => ({ role, locationType, genbank });
  assert.deepEqual(classifySequence(row('assembled-molecule', 'Chromosome', 'CM000001.1')), { rank: 'chromosome' });
  assert.deepEqual(classifySequence(row('unplaced-scaffold', 'na', 'KZ000002.1')), { rank: 'supercontig' });
  assert.deepEqual(classifySequence(row('unplaced-scaffold', 'na', 'AAEX03000001.1')), { rank: 'contig' });
  assert.deepEqual(classifySequence(row('unlocalized-scaffold', 'Chromosome', 'JAAABC010000001.1')), { rank: 'contig' });
  assert.deepEqual(classifySequence(row('assembled-molecule', 'Mitochondrion', 'CM000003.1')),
    { rank: 'organelle', organelle: 'mitochondrion', soTerm: 'mitochondrial_chromosome' });
  assert.deepEqual(classifySequence(row('assembled-molecule', 'Apicoplast', 'CM000004.1')),
    { rank: 'organelle', organelle: 'apicoplast', soTerm: 'apicoplast_chromosome' });
  assert.deepEqual(classifySequence(row('unplaced-scaffold', 'na', 'na')), { problem: 'missingAccession' });
  assert.deepEqual(classifySequence(row('mystery-role', 'na', 'KZ000002.1')), { problem: 'unknownRole' });
  assert.deepEqual(classifySequence(row('assembled-molecule', 'Linkage Group', 'CM000005.1')), { problem: 'unknownLocationType' });
});

test('reportTaxonId reads the "# Taxid:" header line', () => {
  assert.equal(reportTaxonId(readFileSync(ECUN_REPORT, 'utf-8')), 284813);
  assert.equal(reportTaxonId('# Assembly name:  X\r\n# Taxid:          5833\r\n'), 5833);
  assert.equal(reportTaxonId('# Assembly name:  X\n# Sequence-Name\tSequence-Role\n'), null);
  assert.equal(reportTaxonId('# Taxid:\n12345\n'), null);
});
