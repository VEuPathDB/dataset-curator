import { onlyEntry } from '../../_common.js';
import { organismsOf } from '../../../lib/manifest.js';
import { pendingGenomesNaming } from '../../../lib/organisms.js';
import { checkConvertCurrent, formatFinding, tryReadConverted } from '../record.js';

const NAME = 'converted';

export const converted = {
  name: NAME,
  kind: 'preprocess',
  tools: [],
  run: async ({ proposalDir, manifest, workArea, extras, git }) => {
    const entry = onlyEntry(proposalDir, manifest);
    const read = tryReadConverted(workArea);
    const problems = checkConvertCurrent(workArea, entry, read, manifest.staging?.[0]);
    if (problems.length) return problems.map((message) => ({ validator: NAME, severity: 'error', message }));
    const { record, sha256 } = read;
    if (extras) extras.preprocess = { convert: sha256 };
    const organism = organismsOf(manifest)[0];
    // Live from origin/master when git is available; otherwise the snapshot fetch recorded.
    const pending = git ? pendingGenomesNaming(git, organism) : record.pendingGenomes ?? [];
    return [
      ...pending.map((g) => ({ validator: NAME, severity: 'error', message: `genome proposal ${g} on master names ${organism}; update it after that genome loads` })),
      ...record.findings.map((f) => ({ validator: NAME, severity: f.severity, message: formatFinding(f) }))
    ];
  }
};
