import { join } from 'node:path';
import { parseAnalysisConfig } from '../../../lib/tools/apicommondata.js';
import { readCuratedJson } from '../../_common.js';
import { samplesFor, annotationsFile } from '../../bulk-rnaseq.js';

const NAME = 'perlParse';
const STEP_CLASS = 'ApiCommonData::Load::RnaSeqAnalysisEbi';
const error = (message, organism) => ({ validator: NAME, severity: 'error', organism, message });
const describe = (groups) => [...groups].map(([name, ids]) => `${name}: ${ids.join(', ')}`).join(' | ');

/** analysisConfig.xml as ApiCommonData reads it: one RnaSeqAnalysisEbi step whose groups are the annotations' labels. */
export const perlParse = {
  name: NAME,
  tools: ['apiCommonData'],
  async run({ proposalDir, manifest, tools, exec }) {
    const annotations = readCuratedJson(proposalDir, annotationsFile(manifest));
    return manifest.organisms.flatMap(({ proposedOrganismAbbrev: p }) => {
      let parsed;
      try { parsed = parseAnalysisConfig(tools.apiCommonData, join(proposalDir, 'curated', p, 'analysisConfig.xml'), { exec }); }
      catch (e) { return [error(`AnalysisConfigParser could not read analysisConfig.xml: ${e.message}`, p)]; }
      const classes = parsed.steps.map((s) => s.class);
      if (classes.length !== 1 || classes[0] !== STEP_CLASS) return [error(`expected one ${STEP_CLASS} step, got ${classes.join(', ') || 'none'}`, p)];
      // displayAndBaseName appends a trailing " - ..." of profileSetName to every group.
      const suffix = /( - .+)$/.exec(parsed.steps[0].arguments.profileSetName ?? '')?.[1] ?? '';
      const expected = new Map();
      for (const s of samplesFor(annotations, manifest, p)) expected.set(s.label + suffix, [...(expected.get(s.label + suffix) ?? []), s.sampleId]);
      const actual = new Map(parsed.groups.map((g) => [g.displayName, g.samples]));
      const same = expected.size === actual.size
        && [...expected].every(([name, ids]) => actual.get(name)?.length === ids.length && ids.every((id) => actual.get(name).includes(id)));
      return same ? [] : [error(`ApiCommonData groups the samples as ${describe(actual)}; the annotations as ${describe(expected)}`, p)];
    });
  }
};
