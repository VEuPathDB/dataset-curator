export const REPORT_SCHEMA_VERSION = 1;
export const REPORT_MARKER = '<!-- dataset-curator verification report -->';
export const DELIVERY_MARKER = '<!-- dataset-curator delivery record -->';
export const DELIVERY_RECORD_SCHEMA_VERSION = 1;

/** preprocess validators read the work area (ctx.workArea) and run at verify only; content validators read the proposal and also run at load. */
export const VALIDATOR_KINDS = ['preprocess', 'content'];

/**
 * Runs every validator. A tool resolveTool cannot supply is an error for that
 * validator ("could not verify"), never a skip; a validator that throws is an
 * error naming it. resolveTool(name) returns { tool } or { missing }.
 */
export async function runValidators(validators, ctx, resolveTool) {
  const odd = validators.filter((v) => !VALIDATOR_KINDS.includes(v.kind));
  if (odd.length) {
    throw new Error(odd.map((v) => `${v.name} has kind ${v.kind === undefined ? 'undefined' : `"${v.kind}"`}; a validator's kind is one of ${VALIDATOR_KINDS.join(', ')}`).join('\n'));
  }
  const blind = validators.filter((v) => v.kind === 'preprocess' && !ctx.workArea).map((v) => v.name);
  if (blind.length) throw new Error(`${blind.join(', ')} read the preprocessing work area, but none was given`);
  const findings = [];
  for (const v of validators) {
    const tools = {};
    const missing = [];
    for (const name of v.tools ?? []) {
      const r = await resolveTool(name);
      if (r.tool) tools[name] = r.tool; else missing.push(r.missing);
    }
    if (missing.length) {
      findings.push({ validator: v.name, severity: 'error', message: `could not verify: ${missing.join('; ')}` });
      continue;
    }
    try { findings.push(...await v.run({ ...ctx, tools })); }
    catch (e) { findings.push({ validator: v.name, severity: 'error', message: `failed: ${e.message}` }); }
  }
  return findings;
}

export const verdictOf = (findings) =>
  findings.some((f) => f.severity === 'error') ? 'fail'
    : findings.some((f) => f.severity === 'warning') ? 'needs-review' : 'pass';

export const formatFinding = (f) => `${f.severity.toUpperCase()} [${f.validator}]${f.organism ? ` ${f.organism}:` : ''} ${f.message}`;

const toolList = (tools) => Object.entries(tools).map(([n, v]) => `${n} ${v}`).join(', ') || 'no tools';

/** The ticket comment: readable findings, then the report as JSON for mark-ready. */
export function formatReportComment(report) {
  return [
    REPORT_MARKER,
    `**Verification report** for ${report.proposalId ?? report.accession}: **${report.verdict}** (${toolList(report.tools)})`,
    '',
    ...(report.findings.length ? report.findings.map((f) => `- ${formatFinding(f)}`) : ['No findings.']),
    '',
    '```json',
    JSON.stringify(report, null, 2),
    '```'
  ].join('\n');
}

const jsonBlockOf = (body) => /\n```json\n([\s\S]*)\n```$/.exec(body.replaceAll('\r\n', '\n').trimEnd())?.[1];

const isReportComment = (body) => typeof body === 'string' && body.startsWith(REPORT_MARKER);

export function parseReportComment(body) {
  if (!isReportComment(body)) return null;
  const json = jsonBlockOf(body);
  if (!json) return null;
  try {
    const report = JSON.parse(json);
    return report?.schemaVersion === REPORT_SCHEMA_VERSION ? report : null;
  } catch { return null; }
}

/** The last report comment is authoritative: { report }, with report null when it cannot be read; null when there is none. */
export function latestReport(bodies) {
  const last = bodies.filter(isReportComment).at(-1);
  return last === undefined ? null : { report: parseReportComment(last) };
}

/** What mark-ready writes on the ticket: the report it relied on and the warnings the person accepted. */
export function verifiedComment(report, note) {
  const warnings = report.findings.filter((f) => f.severity === 'warning');
  return [
    `Verified: report ${report.verdict} (${toolList(report.tools)})`,
    ...(warnings.length ? ['Accepted warnings:', ...warnings.map((f) => `- ${formatFinding(f)}`)] : []),
    ...(note ? [`Note: ${note}`] : [])
  ].join('\n');
}

/** One line naming what produced a preprocessed delivery; a summary several delivery directories share is named once. */
function provenanceLine(provenance) {
  const summaries = [...new Set(Object.values(provenance).map((p) => JSON.stringify(p)))].map((p) => JSON.parse(p));
  return `Provenance: ${summaries.map((p) => Object.entries(p).map(([k, v]) => `${k} ${v}`).join(', ')).join('; ')}`;
}

/** The ticket comment mark-ready posts: the handoff, then what load enforces as JSON. */
export function formatDeliveryComment(record, deliverySha) {
  const { proposalTree, against, settlement, build, release, corpusStep } = record;
  return [
    DELIVERY_MARKER,
    `**Delivery** prepared against ${against} for release ${release}: ${settlement.map((s) => s.abbrev).join(', ')}`,
    ...(record.provenance && Object.keys(record.provenance).length ? [provenanceLine(record.provenance)] : []),
    '',
    record.handoff,
    '',
    '```json',
    JSON.stringify({ schemaVersion: DELIVERY_RECORD_SCHEMA_VERSION, proposalTree, against, settlement, build, release, corpusStep, deliverySha }, null, 2),
    '```'
  ].join('\n');
}

const isDeliveryRecord = (r) => r?.schemaVersion === DELIVERY_RECORD_SCHEMA_VERSION && typeof r.build === 'string' && typeof r.release === 'string';

/** The last delivery comment is authoritative: { record }, record null when unreadable; null when there is none. */
export function latestDeliveryRecord(bodies) {
  const last = bodies.filter((b) => typeof b === 'string' && b.startsWith(DELIVERY_MARKER)).at(-1);
  if (last === undefined) return null;
  try {
    const record = JSON.parse(jsonBlockOf(last) ?? '');
    return { record: isDeliveryRecord(record) ? record : null };
  } catch { return { record: null }; }
}
