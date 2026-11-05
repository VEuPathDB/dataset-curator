import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTsv } from '../shared/scripts/genome/trial/gus.js';
import {
  expectedModels, genesSql, internalStopsSql, invocationRowFindings, invocationRowsSql, leftoversSql, parseTranscriptInfo, PROFILE_SOURCE_SQL, profileDiff, profileEntry, profileFindings,
  profileSource, qaFindings, releasesSql, snapshot, sqlList, sqlString, statementsSql, TABLES_PROBE, TABLES_SQL, transcriptsSql
} from '../shared/scripts/genome/trial/qa.js';
import { gffLine } from './genome-helpers.js';
import { PRIMARY, PRIMARY_GFF3, RELEASE, statementsAt, tablesAt, TRANSCRIPT_IDS_TEXT, trialDb } from './genome-trial-helpers.js';

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
  assert.equal(leftoversSql([trialDb(PRIMARY)], RELEASE, []).split('\n').length, 5);
  const sql = leftoversSql([trialDb(PRIMARY)], RELEASE, [7319, 7326]);
  assert.match(sql, /^-- trial:leftovers\nSELECT 'trialRelease' AS what, count\(\*\) AS n\n/);
  assert.match(sql, new RegExp(`\\nUNION ALL SELECT 'trialDatabases', count\\(\\*\\) FROM sres\\.externaldatabase WHERE name IN \\('${trialDb(PRIMARY)}'\\)`));
  assert.match(sql, /\nUNION ALL SELECT 'dots\.nafeatureimp', count\(\*\) FROM dots\.nafeatureimp WHERE row_alg_invocation_id IN \(7319, 7326\)/);
  assert.ok(!sql.includes('core.algorithminvocation'));
  assert.equal(sql.split('\n').length, 11);
});

test('invocationRowsSql is separate from the blocking check, and a remaining row is a warning naming the manual delete', () => {
  assert.match(invocationRowsSql([7319, 7326]), /^-- trial:invocationRows\nSELECT algorithm_invocation_id FROM core\.algorithminvocation WHERE algorithm_invocation_id IN \(7319, 7326\)/);
  assert.match(invocationRowsSql([]), /IN \(NULL\)/);
  const [warning] = invocationRowFindings([{ algorithm_invocation_id: '7322' }]);
  assert.equal(warning.severity, 'warning');
  assert.equal(warning.message, 'invocation 7322 not removable by Undo (run was killed); delete it by hand: core.algorithmparam then core.algorithminvocation where algorithm_invocation_id = 7322');
});

test('an empty ID list is IN (NULL), never IN ()', () => {
  assert.match(genesSql([]), /IN \(NULL\)$/);
  assert.match(transcriptsSql([]), /IN \(NULL\)\nGROUP BY/);
  assert.match(internalStopsSql([]), /IN \(NULL\) AND/);
  assert.match(leftoversSql([trialDb(PRIMARY)], RELEASE, []), /^(?!.*IN \(\))/s);
});

test('transcripts are grouped by na_feature_id, so two features with one source_id are two rows', () => {
  assert.match(transcriptsSql(['501']), /SELECT t\.external_database_release_id AS release_id, t\.na_feature_id, t\.source_id,/);
  assert.match(transcriptsSql(['501']), /GROUP BY t\.external_database_release_id, t\.na_feature_id, t\.source_id$/);
  const duplicated = { ...CLEAN, transcripts: [...CLEAN.transcripts, { ...CLEAN.transcripts[0], na_feature_id: '9' }] };
  const rows = qaFindings([part()], duplicated).find((f) => f.check === 'transcriptInfoRows');
  assert.equal(rows.message, `${PRIMARY}: transcriptInfoAndIds has 2 rows for 3 transcripts loaded`);
});

test('release IDs compare as strings, so a number from a caller matches the TSV text', () => {
  assert.deepEqual(qaFindings([part({ releaseId: 501 })], CLEAN), []);
});

test('pg_stat_statements is the profiling source, in its extension schema, when installed; else pg_stat_user_tables', () => {
  const asked = [];
  const select = (rows) => (sql) => { asked.push(sql); return rows; };
  assert.deepEqual(profileSource(select([{ schema: 'public' }])), { source: 'pg_stat_statements', schema: 'public' });
  assert.deepEqual(profileSource(select([])), TABLES_PROBE);
  assert.deepEqual(asked, [PROFILE_SOURCE_SQL, PROFILE_SOURCE_SQL]);
  assert.match(PROFILE_SOURCE_SQL, /^-- trial:profileSource\nSELECT n\.nspname AS schema FROM pg_extension e JOIN pg_namespace n .* WHERE e\.extname = 'pg_stat_statements'$/);
});

test('snapshot reads the view for its source, qualifying pg_stat_statements by its schema', () => {
  const asked = [];
  const select = (sql) => { asked.push(sql); return []; };
  snapshot({ source: 'pg_stat_statements', schema: 'public' }, select);
  snapshot(TABLES_PROBE, select);
  assert.deepEqual(asked, [statementsSql('public'), TABLES_SQL]);
  assert.match(statementsSql('public'), /^-- trial:statements\nSELECT queryid, calls, total_exec_time, left\(query, 300\) AS query FROM "public"\.pg_stat_statements WHERE dbid = /);
  assert.ok(statementsSql('we"ird').includes('FROM "we""ird".pg_stat_statements'));
  assert.match(TABLES_SQL, /^-- trial:tables\nSELECT schemaname \|\| '\.' \|\| relname AS name, seq_scan, idx_scan, n_tup_ins FROM pg_stat_user_tables$/);
});

test('profileDiff ranks queries by calls and by total time over the ISF run', () => {
  const diff = profileDiff('pg_stat_statements', parseTsv(statementsAt(1)), parseTsv(statementsAt(2)));
  const ontology = { query: 'select name, ontology_term_id from SRES.ontologyterm where external_database_release_id=$1', calls: 2, totalMs: 2 };
  const insert = { query: 'INSERT INTO DoTS.NAFeatureImp (na_feature_id, subclass_view) VALUES ($1, $2)', calls: 1, totalMs: 30 };
  assert.deepEqual(diff, { source: 'pg_stat_statements', byCalls: [ontology, insert], byTotalTime: [insert, ontology] });
});

test('profileDiff falls back to scans and inserts per table, leaving out tables that did nothing of the kind', () => {
  const diff = profileDiff('pg_stat_user_tables', parseTsv(tablesAt(1)), parseTsv(tablesAt(2)));
  const ontology = { table: 'sres.ontologyterm', seqScans: 3, idxScans: 1, inserts: 0 };
  const features = { table: 'dots.nafeatureimp', seqScans: 1, idxScans: 2, inserts: 4 };
  assert.deepEqual(diff, { source: 'pg_stat_user_tables', byScans: [ontology, features], byInserts: [features] });
});

test('profileEntry adds seconds per gene; profileFindings reports time and the busiest queries as info', () => {
  const entry = profileEntry(profileDiff('pg_stat_statements', parseTsv(statementsAt(1)), parseTsv(statementsAt(2))), { seconds: 1, genes: 2 });
  assert.equal(entry.secondsPerGene, 0.5);
  assert.equal(profileEntry({ source: 'pg_stat_user_tables', byScans: [], byInserts: [] }, { seconds: 3, genes: 0 }).secondsPerGene, null);
  const findings = profileFindings({ [`isfPrint:${PRIMARY}`]: entry });
  assert.deepEqual(findings.map((f) => [f.check, f.severity, f.count]), [['isfTime', 'info', 1], ['isfProfile', 'info', 2]]);
  assert.equal(findings[0].message, `isfPrint:${PRIMARY}: 1 s, 0.5 s per gene`);
  assert.equal(findings[1].sample[0], '30 ms in 1 calls: INSERT INTO DoTS.NAFeatureImp (na_feature_id, subclass_view) VALUES ($1, $2)');
  assert.equal(findings[1].message, `isfPrint:${PRIMARY}: busiest queries by total time (pg_stat_statements)`);
});

test('profileFindings prints n/a for a missing per-gene figure and reports an unavailable profile as info', () => {
  const findings = profileFindings({ 'isfSet:p': { scope: 'database', error: 'denied', seconds: 2, secondsPerGene: null } });
  assert.deepEqual(findings.map((f) => f.message), ['isfSet:p: 2 s, n/a s per gene', 'isfSet:p: profiling unavailable: denied']);
});
