import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  expectedModels, genesSql, internalStopsSql, leftoversSql, parseTranscriptInfo, qaFindings, releasesSql, sqlList, sqlString, transcriptsSql
} from '../shared/scripts/genome/trial/qa.js';
import { gffLine } from './genome-helpers.js';
import { PRIMARY, PRIMARY_GFF3, RELEASE, TRANSCRIPT_IDS_TEXT, trialDb } from './genome-trial-helpers.js';

const part = (overrides = {}) => ({
  name: PRIMARY, featureCount: 2, releaseId: '501',
  expected: { geneIds: ['TST_0010', 'TST_0030'], codingTranscriptIds: ['TST_0010_mRNA'] },
  transcriptInfo: parseTranscriptInfo(TRANSCRIPT_IDS_TEXT),
  validationLogs: [{ key: `isfPrint:${PRIMARY}`, text: '' }, { key: `isfSet:${PRIMARY}`, text: '' }],
  ...overrides
});
const CLEAN = {
  genes: [{ release_id: '501', source_id: 'TST_0010' }, { release_id: '501', source_id: 'TST_0030' }],
  transcripts: [{ release_id: '501', source_id: 'TST_0010_mRNA', proteins: '1' }, { release_id: '501', source_id: 'rna-TST_0030', proteins: '0' }],
  internalStops: []
};
const summary = (findings) => findings.map((f) => [f.check, f.severity, f.count, f.sample]);

test('expectedModels lists the gene trees ISF builds and their coding transcripts, not other trees', () => {
  const gff = `${PRIMARY_GFF3}${gffLine('CM000001.1', 'repeat_region', 2000, 2100, '+', 'ID=rep1')}\n`;
  assert.deepEqual(expectedModels(gff), { geneIds: ['TST_0010', 'TST_0030'], codingTranscriptIds: ['TST_0010_mRNA'] });
});

test('parseTranscriptInfo keeps columns 1 and 5 of each row', () => {
  assert.deepEqual(parseTranscriptInfo(TRANSCRIPT_IDS_TEXT), [{ gene: 'TST_0010', transcript: 'TST_0010_mRNA' }, { gene: 'TST_0030', transcript: 'rna-TST_0030' }]);
  assert.deepEqual(parseTranscriptInfo(''), []);
});

test('a trial that loaded what the GFF describes has no findings, and rows of other releases do not count', () => {
  assert.deepEqual(qaFindings([part()], CLEAN), []);
  assert.deepEqual(qaFindings([part()], { ...CLEAN, genes: [...CLEAN.genes, { release_id: '502', source_id: 'OTHER' }] }), []);
});

test('a gene the GFF has and dots.genefeature lacks is an error', () => {
  const findings = qaFindings([part()], { ...CLEAN, genes: [CLEAN.genes[0]] });
  assert.deepEqual(summary(findings), [['geneCount', 'error', 1, ['TST_0030']]]);
  assert.equal(findings[0].group, 'trial');
  assert.equal(findings[0].message, `${PRIMARY}: 1 genes loaded, 2 gene trees expected (featureCount 2); sample: GFF genes not in dots.genefeature`);
});

test('transcriptInfoAndIds rows are compared with transcripts loaded, not genes', () => {
  const findings = qaFindings([part()], { ...CLEAN, transcripts: [...CLEAN.transcripts, { ...CLEAN.transcripts[0], source_id: 'TST_0010_mRNA2' }] });
  const rows = findings.find((f) => f.check === 'transcriptInfoRows');
  assert.equal(rows.severity, 'error');
  assert.equal(rows.message, `${PRIMARY}: transcriptInfoAndIds has 2 rows for 3 transcripts loaded`);
});

test('a transcript with two proteins, and a coding transcript with none, are errors; a tRNA without one is not', () => {
  const two = qaFindings([part()], { ...CLEAN, transcripts: [{ ...CLEAN.transcripts[0], proteins: '2' }, CLEAN.transcripts[1]] });
  assert.deepEqual(summary(two), [['multipleProteins', 'error', 1, ['TST_0010_mRNA']]]);
  const none = qaFindings([part()], { ...CLEAN, transcripts: [{ ...CLEAN.transcripts[0], proteins: '0' }, CLEAN.transcripts[1]] });
  assert.deepEqual(summary(none), [['codingNoProtein', 'error', 1, ['TST_0010_mRNA']]]);
});

test('transcript IDs that differ between dots.transcript and column 5 of transcriptInfoAndIds are an error', () => {
  const renamed = parseTranscriptInfo(TRANSCRIPT_IDS_TEXT.replace('\tTST_0010_mRNA\n', '\tTST_0010_mRNA_x\n'));
  assert.deepEqual(summary(qaFindings([part({ transcriptInfo: renamed })], CLEAN)), [['transcriptIds', 'error', 2, ['TST_0010_mRNA', 'TST_0010_mRNA_x']]]);
});

test('an internal stop codon and a non-empty validation.log are warnings', () => {
  const findings = qaFindings([part({ validationLogs: [{ key: `isfSet:${PRIMARY}`, text: 'line one\nline two\n' }] })],
    { ...CLEAN, internalStops: [{ release_id: '501', source_id: 'TST_0010_mRNA' }] });
  assert.deepEqual(summary(findings), [['internalStop', 'warning', 1, ['TST_0010_mRNA']], ['validationLog', 'warning', 2, ['line one', 'line two']]]);
  assert.equal(findings[1].message, `${PRIMARY}: isfSet:${PRIMARY} wrote 2 lines to its validation.log`);
});

test('a partition whose release was never found counts every gene as missing', () => {
  assert.deepEqual(summary(qaFindings([part({ releaseId: null })], CLEAN)).map(([check]) => check), ['geneCount', 'transcriptIds', 'transcriptInfoRows']);
});

test('the SELECTs are tagged, quote names and scope to release IDs', () => {
  assert.equal(sqlString("O'Brien"), "'O''Brien'");
  assert.equal(sqlList(['a', 'b']), "'a', 'b'");
  assert.equal(releasesSql([trialDb(PRIMARY)], RELEASE), [
    '-- trial:releases',
    'SELECT d.name, r.external_database_release_id AS release_id',
    'FROM sres.externaldatabase d JOIN sres.externaldatabaserelease r ON r.external_database_id = d.external_database_id',
    `WHERE d.name IN ('${trialDb(PRIMARY)}') AND r.version = '${RELEASE}'`
  ].join('\n'));
  assert.match(genesSql(['501', '502']), /^-- trial:genes\nSELECT .* FROM dots\.genefeature WHERE external_database_release_id IN \(501, 502\)$/);
  assert.match(transcriptsSql(['501']), /^-- trial:transcripts\n[\s\S]*LEFT JOIN dots\.translatedaafeature[\s\S]*IN \(501\)\nGROUP BY/);
  assert.match(internalStopsSql(['501']), /^-- trial:internalStops\n[\s\S]*rtrim\(s\.sequence, '\*'\) LIKE '%\*%'$/);
});

test('leftoversSql counts the trial release, and rows of each invocation when there are any', () => {
  assert.equal(leftoversSql([trialDb(PRIMARY)], RELEASE, []).split('\n').length, 4);
  const sql = leftoversSql([trialDb(PRIMARY)], RELEASE, [7319, 7326]);
  assert.match(sql, /^-- trial:leftovers\nSELECT 'trialRelease' AS what, count\(\*\) AS n\n/);
  assert.match(sql, /\nUNION ALL SELECT 'dots\.nafeatureimp', count\(\*\) FROM dots\.nafeatureimp WHERE row_alg_invocation_id IN \(7319, 7326\)/);
  assert.equal(sql.split('\n').length, 10);
});
