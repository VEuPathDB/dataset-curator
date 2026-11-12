import { onlyEntry } from '../../_common.js';
import { organismsOf } from '../../../lib/manifest.js';
import { pendingGenomeProposals } from '../../../lib/organisms.js';
import { checkConvertCurrent, readConverted } from '../record.js';

const NAME = 'converted';
const format = (f) => `${f.check} (${f.count}): ${f.message}${f.sample.length ? ` [${f.sample.join(', ')}]` : ''}`;
const tryRead = (workArea) => { try { return readConverted(workArea); } catch { return undefined; } };

/** Live from origin/master when git is available; otherwise the snapshot fetch recorded. */
const pendingGenomes = (git, organism, recorded) => git
  ? pendingGenomeProposals(git, ['origin/master']).filter((g) => g.organism?.proposedOrganismAbbrev === organism).map((g) => g.accession)
  : recorded ?? [];

export const converted = {
  name: NAME,
  kind: 'preprocess',
  tools: [],
  run: async ({ proposalDir, manifest, workArea, extras, git }) => {
    const entry = onlyEntry(proposalDir, manifest);
    const read = tryRead(workArea);
    const problems = checkConvertCurrent(workArea, entry, read);
    if (problems.length) return problems.map((message) => ({ validator: NAME, severity: 'error', message }));
    const { record, sha256 } = read;
    if (extras) extras.preprocess = { convert: sha256 };
    const organism = organismsOf(manifest)[0];
    return [
      ...pendingGenomes(git, organism, record.pendingGenomes).map((g) => ({ validator: NAME, severity: 'error', message: `genome proposal ${g} on master names ${organism}; update it after that genome loads` })),
      ...record.findings.map((f) => ({ validator: NAME, severity: f.severity, message: format(f) }))
    ];
  }
};
