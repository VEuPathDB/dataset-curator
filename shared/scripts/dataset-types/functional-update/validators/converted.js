import { onlyEntry } from '../../_common.js';
import { checkConvertCurrent, readConverted } from '../record.js';

const NAME = 'converted';
const format = (f) => `${f.check} (${f.count}): ${f.message}${f.sample.length ? ` [${f.sample.join(', ')}]` : ''}`;

export const converted = {
  name: NAME,
  kind: 'preprocess',
  tools: [],
  run: async ({ proposalDir, manifest, workArea, extras }) => {
    const entry = onlyEntry(proposalDir, manifest);
    const problems = checkConvertCurrent(workArea, entry);
    if (problems.length) return problems.map((message) => ({ validator: NAME, severity: 'error', message }));
    const { record, sha256 } = readConverted(workArea);
    if (extras) extras.preprocess = { convert: sha256 };
    const organism = manifest.organisms[0].proposedOrganismAbbrev;
    return [
      ...(record.pendingGenomes ?? []).map((g) => ({ validator: NAME, severity: 'error', message: `genome proposal ${g} on master names ${organism}; update it after that genome loads` })),
      ...record.findings.filter((f) => f.severity !== 'info').map((f) => ({ validator: NAME, severity: f.severity, message: format(f) }))
    ];
  }
};
