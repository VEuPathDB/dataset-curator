import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  runValidators, verdictOf, formatFinding, formatReportComment, parseReportComment, latestReport, verifiedComment, REPORT_MARKER
} from '../shared/scripts/lib/validation.js';

const finding = (severity, message = 'm', validator = 'v') => ({ validator, severity, message });
const report = (verdict, findings = []) => ({
  schemaVersion: 1, accession: 'PRJNA1', datasetType: 'bulk-rnaseq', proposalTree: 'a'.repeat(40), against: null,
  workspace: '/ws', tools: { apiCommonData: 'abc123', studyWrangler: '1.0.41' }, findings, verdict
});

test('verdictOf: fail on any error, needs-review on any warning, else pass', () => {
  assert.equal(verdictOf([finding('info'), finding('warning'), finding('error')]), 'fail');
  assert.equal(verdictOf([finding('info'), finding('warning')]), 'needs-review');
  assert.equal(verdictOf([finding('info')]), 'pass');
  assert.equal(verdictOf([]), 'pass');
});

test('runValidators runs every validator and collects findings', async () => {
  const validators = [
    { name: 'a', tools: [], run: async () => [finding('warning', 'thin', 'a')] },
    { name: 'b', tools: [], run: async (ctx) => [finding('info', ctx.proposalDir, 'b')] }
  ];
  const findings = await runValidators(validators, { proposalDir: '/p' }, () => ({ missing: 'unused' }));
  assert.deepEqual(findings, [finding('warning', 'thin', 'a'), finding('info', '/p', 'b')]);
});

test('runValidators turns a missing tool into a could-not-verify error and skips only that validator', async () => {
  let ran = false;
  const validators = [
    { name: 'perlParse', tools: ['apiCommonData'], run: async () => { ran = true; return []; } },
    { name: 'pure', tools: [], run: async () => [] }
  ];
  const findings = await runValidators(validators, {}, (name) => ({ missing: `${name} is not configured` }));
  assert.equal(ran, false);
  assert.deepEqual(findings, [finding('error', 'could not verify: apiCommonData is not configured', 'perlParse')]);
});

test('runValidators hands resolved tools to the validator', async () => {
  let seen;
  const validators = [{ name: 'stf', tools: ['studyWrangler'], run: async (ctx) => { seen = ctx.tools; return []; } }];
  await runValidators(validators, {}, () => ({ tool: { version: '1.0.41' } }));
  assert.deepEqual(seen, { studyWrangler: { version: '1.0.41' } });
});

test('runValidators turns a thrown validator into an error naming it, and keeps going', async () => {
  const validators = [
    { name: 'boom', tools: [], run: async () => { throw new Error('bad xml'); } },
    { name: 'after', tools: [], run: async () => [finding('info', 'still ran', 'after')] }
  ];
  const findings = await runValidators(validators, {}, () => ({}));
  assert.deepEqual(findings, [finding('error', 'failed: bad xml', 'boom'), finding('info', 'still ran', 'after')]);
});

test('formatFinding names severity, validator and organism', () => {
  assert.equal(formatFinding({ validator: 'stf', severity: 'error', organism: 'tfakST1', message: 'bad' }), 'ERROR [stf] tfakST1: bad');
  assert.equal(formatFinding(finding('warning', 'thin', 'libraryType')), 'WARNING [libraryType] thin');
});

test('a report comment round-trips and starts with the marker', () => {
  const r = report('needs-review', [finding('warning', 'has ``` fences\nand lines', 'libraryType')]);
  const body = formatReportComment(r);
  assert.ok(body.startsWith(REPORT_MARKER));
  assert.match(body, /WARNING \[libraryType\] has/);
  assert.deepEqual(parseReportComment(body), r);
});

test('parseReportComment ignores other comments and other schema versions', () => {
  assert.equal(parseReportComment('Verified: fine'), null);
  assert.equal(parseReportComment(formatReportComment({ ...report('pass'), schemaVersion: 2 })), null);
  assert.equal(parseReportComment(`${REPORT_MARKER}\nno json here`), null);
});

test('latestReport takes the last report comment', () => {
  const first = report('fail', [finding('error')]);
  const second = report('pass');
  assert.deepEqual(latestReport(['hello', formatReportComment(first), 'note', formatReportComment(second), 'later']), { report: second });
  assert.equal(latestReport(['hello']), null);
});

test('parseReportComment reads a comment whose line endings were turned into CRLF', () => {
  const r = report('needs-review', [finding('warning', 'thin', 'libraryType')]);
  assert.deepEqual(parseReportComment(formatReportComment(r).replaceAll('\n', '\r\n')), r);
});

test('latestReport does not fall back to an older report when the last one is unreadable', () => {
  const good = formatReportComment(report('pass'));
  assert.deepEqual(latestReport([good, `${REPORT_MARKER}\nnot json`]), { report: null });
  assert.deepEqual(latestReport([good, formatReportComment({ ...report('pass'), schemaVersion: 2 })]), { report: null });
});

test('verifiedComment records verdict, tools, accepted warnings and the note', () => {
  const r = report('needs-review', [finding('warning', 'MGI adapters', 'libraryType'), finding('info', 'cDNA', 'libraryType')]);
  assert.equal(verifiedComment(r, 'presenter read'), [
    'Verified: report needs-review (apiCommonData abc123, studyWrangler 1.0.41)',
    'Accepted warnings:',
    '- WARNING [libraryType] MGI adapters',
    'Note: presenter read'
  ].join('\n'));
  assert.equal(verifiedComment(report('pass'), ''), 'Verified: report pass (apiCommonData abc123, studyWrangler 1.0.41)');
});
