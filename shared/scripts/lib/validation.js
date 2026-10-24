export const REPORT_SCHEMA_VERSION = 1;
export const REPORT_MARKER = '<!-- dataset-curator verification report -->';

/**
 * Runs every validator. A tool resolveTool cannot supply is an error for that
 * validator ("could not verify"), never a skip; a validator that throws is an
 * error naming it. resolveTool(name) returns { tool } or { missing }.
 */
export async function runValidators(validators, ctx, resolveTool) {
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
    `**Verification report** for ${report.accession}: **${report.verdict}** (${toolList(report.tools)})`,
    '',
    ...(report.findings.length ? report.findings.map((f) => `- ${formatFinding(f)}`) : ['No findings.']),
    '',
    '```json',
    JSON.stringify(report, null, 2),
    '```'
  ].join('\n');
}

const isReportComment = (body) => typeof body === 'string' && body.startsWith(REPORT_MARKER);

export function parseReportComment(body) {
  if (!isReportComment(body)) return null;
  const json = /\n```json\n([\s\S]*)\n```$/.exec(body.replaceAll('\r\n', '\n').trimEnd())?.[1];
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
