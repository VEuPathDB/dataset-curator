import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  runValidators, verdictOf, formatFinding, formatReportComment, parseReportComment, latestReport, verifiedComment, REPORT_MARKER,
  formatDeliveryComment, latestDeliveryRecord, VALIDATOR_KINDS
} from '../shared/scripts/lib/validation.js';
import { DATASET_TYPES } from '../shared/scripts/dataset-types/index.js';
import { validatorsFor, hasValidators } from '../shared/scripts/dataset-types/validators.js';
import { buildFitnessValidator } from '../shared/scripts/lib/build-fitness.js';

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
    { name: 'a', kind: 'content', tools: [], run: async () => [finding('warning', 'thin', 'a')] },
    { name: 'b', kind: 'content', tools: [], run: async (ctx) => [finding('info', ctx.proposalDir, 'b')] }
  ];
  const findings = await runValidators(validators, { proposalDir: '/p' }, () => ({ missing: 'unused' }));
  assert.deepEqual(findings, [finding('warning', 'thin', 'a'), finding('info', '/p', 'b')]);
});

test('runValidators turns a missing tool into a could-not-verify error and skips only that validator', async () => {
  let ran = false;
  const validators = [
    { name: 'perlParse', kind: 'content', tools: ['apiCommonData'], run: async () => { ran = true; return []; } },
    { name: 'pure', kind: 'content', tools: [], run: async () => [] }
  ];
  const findings = await runValidators(validators, {}, (name) => ({ missing: `${name} is not configured` }));
  assert.equal(ran, false);
  assert.deepEqual(findings, [finding('error', 'could not verify: apiCommonData is not configured', 'perlParse')]);
});

test('runValidators hands resolved tools to the validator', async () => {
  let seen;
  const validators = [{ name: 'stf', kind: 'content', tools: ['studyWrangler'], run: async (ctx) => { seen = ctx.tools; return []; } }];
  await runValidators(validators, {}, () => ({ tool: { version: '1.0.41' } }));
  assert.deepEqual(seen, { studyWrangler: { version: '1.0.41' } });
});

test('runValidators turns a thrown validator into an error naming it, and keeps going', async () => {
  const validators = [
    { name: 'boom', kind: 'content', tools: [], run: async () => { throw new Error('bad xml'); } },
    { name: 'after', kind: 'content', tools: [], run: async () => [finding('info', 'still ran', 'after')] }
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

test('a delivery comment round-trips its record, and the latest one wins', () => {
  const record = { proposalTree: 't1', against: 'origin/rebuild02', settlement: [{ proposed: 'a', abbrev: 'a' }], build: '02', release: '2026-10', corpusStep: 'ssh yew x', handoff: 'Copy ...\n  rsync -a ...' };
  const body = formatDeliveryComment(record, 'f'.repeat(64));
  assert.ok(body.startsWith('<!-- dataset-curator delivery record -->'));
  assert.ok(body.includes('rsync -a'));
  assert.deepEqual(latestDeliveryRecord(['x', body]).record, {
    schemaVersion: 1, proposalTree: 't1', against: 'origin/rebuild02', settlement: [{ proposed: 'a', abbrev: 'a' }], build: '02', release: '2026-10', corpusStep: 'ssh yew x', deliverySha: 'f'.repeat(64)
  });
  assert.equal(latestDeliveryRecord(['x']), null);
  assert.equal(latestDeliveryRecord([body, '<!-- dataset-curator delivery record -->\nbroken']).record, null);
});

test('a delivery record without its build or release is unreadable', () => {
  const record = { proposalTree: 't1', against: 'origin/rebuild02', settlement: [], build: '02', release: '2026-10', corpusStep: 'x', handoff: 'h' };
  assert.equal(latestDeliveryRecord([formatDeliveryComment({ ...record, build: undefined }, 'f')]).record, null);
  assert.equal(latestDeliveryRecord([formatDeliveryComment({ ...record, release: undefined }, 'f')]).record, null);
});

test('the latest delivery record is the last posted, even when it repeats an earlier one', () => {
  const at = (proposalTree) => formatDeliveryComment({ proposalTree, against: 'origin/rebuild02', settlement: [], build: '02', release: '2026-10', corpusStep: 'x', handoff: 'h' }, 'f');
  assert.equal(latestDeliveryRecord([at('A'), at('B'), at('A')]).record.proposalTree, 'A');
});

test('runValidators refuses a validator whose kind is missing or unknown, before running any', async () => {
  let ran = false;
  const first = { name: 'first', kind: 'content', tools: [], run: async () => { ran = true; return []; } };
  await assert.rejects(runValidators([first, { name: 'kindless', tools: [], run: async () => [] }], {}, () => ({})), /kindless has kind undefined; a validator's kind is one of preprocess, content/);
  await assert.rejects(runValidators([first, { name: 'odd', kind: 'load', tools: [], run: async () => [] }], {}, () => ({})), /odd has kind "load"; a validator's kind is one of preprocess, content/);
  assert.equal(ran, false);
});

test('runValidators refuses a preprocess validator without a work area, before running any', async () => {
  let ran = false;
  const validators = [
    { name: 'first', kind: 'content', tools: [], run: async () => { ran = true; return []; } },
    { name: 'reads', kind: 'preprocess', tools: [], run: async () => [] }
  ];
  await assert.rejects(runValidators(validators, {}, () => ({})), /reads read the preprocessing work area, but none was given/);
  assert.equal(ran, false);
  assert.deepEqual(await runValidators(validators, { workArea: '/w' }, () => ({})), []);
});

test('hasValidators in meta.js agrees with the validators each type registers', async () => {
  for (const type of Object.keys(DATASET_TYPES)) assert.equal(hasValidators(type), (await validatorsFor(type)).length > 0, type);
  assert.equal(hasValidators('nope'), false);
});

test('every registered validator declares whether it reads the work area or the proposal', async () => {
  for (const type of Object.keys(DATASET_TYPES)) {
    for (const v of await validatorsFor(type)) assert.ok(VALIDATOR_KINDS.includes(v.kind), `${type} ${v.name}: ${v.kind}`);
  }
  assert.equal(buildFitnessValidator.kind, 'content');
});

test('formatDeliveryComment adds one provenance line, naming a summary several directories share once', () => {
  const record = {
    proposalTree: 't', against: 'origin/rebuild02', settlement: [{ proposed: 'a', abbrev: 'a' }], build: '02', release: '2026-10', corpusStep: null, handoff: 'Copy',
    provenance: { 'P/a/x/final': { genomeBuild: 'g', trial: 't', database: 'UniDB' }, 'P/a/y/final': { genomeBuild: 'g', trial: 't', database: 'UniDB' } }
  };
  const text = formatDeliveryComment(record, 'e'.repeat(64));
  const lines = text.split('\n');
  assert.equal(lines[2], 'Provenance: genomeBuild g, trial t, database UniDB');
  assert.equal(lines.filter((l) => l.startsWith('Provenance:')).length, 1);
  assert.equal(latestDeliveryRecord([text]).record.build, '02');
  const { provenance, ...plain } = record;
  assert.equal(formatDeliveryComment(plain, 'e'.repeat(64)).includes('Provenance'), false);
});
