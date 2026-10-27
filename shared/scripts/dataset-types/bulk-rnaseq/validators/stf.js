import { join } from 'node:path';
import { validateEntity } from '../../../lib/tools/study-wrangler.js';

const NAME = 'stf';

/** Each organism's entity-sample STF files through study.wrangler's own load and validate. */
export const stf = {
  name: NAME,
  tools: ['studyWrangler'],
  async run({ proposalDir, manifest, tools, exec }) {
    return manifest.organisms.flatMap(({ proposedOrganismAbbrev: p }) => {
      const dir = join(proposalDir, 'curated', p);
      const { ok, output } = validateEntity(tools.studyWrangler, join(dir, 'entity-sample.tsv'), join(dir, 'entity-sample.yaml'), { exec });
      return ok ? [] : [{ validator: NAME, severity: 'error', organism: p, message: `study.wrangler rejected entity-sample: ${output}` }];
    });
  }
};
