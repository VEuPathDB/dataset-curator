import { recordsOrNull } from './records.js';

const NAME = 'pipelineFindings';
const SEVERITIES = ['error', 'warning', 'info'];
const describe = (f) => `${f.group}/${f.check} (${f.count}): ${f.message}${f.sample?.length ? ` [${f.sample.join(', ')}]` : ''}`;
const tagged = (step, f) => ({ validator: NAME, severity: SEVERITIES.includes(f.severity) ? f.severity : 'warning', message: `[${step}] ${describe(f)}` });

export const pipelineFindings = {
  name: NAME,
  kind: 'preprocess',
  tools: [],
  run: async ({ workArea }) => {
    const found = recordsOrNull(workArea);
    if (!found) return [];
    const { genomeBuild, trial, functional } = found;
    return [
      ...(genomeBuild.warnings ?? []).map((w) => ({ validator: NAME, severity: 'warning', message: `[build] ${w}` })),
      ...(genomeBuild.findings ?? []).map((f) => tagged('build', f)),
      ...trial.findings.map((f) => tagged('trial', f)),
      ...functional.findings.map((f) => tagged('functional', f))
    ];
  }
};
