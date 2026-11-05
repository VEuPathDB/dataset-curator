import { features, idOf } from '../gff.js';
import { levelOf } from '../feature-types.js';
import { addExonPerCds } from './add-exon-per-cds.js';
import { addMrnaToGeneCds } from './add-mrna-to-gene-cds.js';
import { collapseSplitGenes } from './collapse-split-genes.js';
import { parentOrphanRnas } from './parent-orphan-rnas.js';
import { stripAttributes, stripAttributesProblems } from './strip-attributes.js';

const noArgs = (args) => (Object.keys(args).length ? ['takes no args'] : []);

/**
 * In canonical order: the order survey suggests them in. `handFixCodes` are the error codes
 * a transform throws when only a hand edit of the input GFF can fix the genome.
 */
export const TRANSFORMS = {
  collapseSplitGenes: { kind: 'structural', run: collapseSplitGenes, argProblems: noArgs, handFixCodes: ['SPLIT_ACROSS'] },
  addMrnaToGeneCds: { kind: 'structural', run: addMrnaToGeneCds, argProblems: noArgs, handFixCodes: [] },
  parentOrphanRnas: { kind: 'structural', run: parentOrphanRnas, argProblems: noArgs, handFixCodes: ['ORPHAN_OPPOSITE_STRANDS'] },
  addExonPerCds: { kind: 'structural', run: addExonPerCds, argProblems: noArgs, handFixCodes: [] },
  stripAttributes: { kind: 'attributes', run: stripAttributes, argProblems: stripAttributesProblems, handFixCodes: [] }
};
export const CANONICAL_ORDER = Object.keys(TRANSFORMS);
export const STRUCTURAL_TRANSFORMS = CANONICAL_ORDER.filter((name) => TRANSFORMS[name].kind === 'structural');

export function transformProblems(steps) {
  return steps.flatMap((step, i) => {
    const transform = TRANSFORMS[step?.name];
    if (!transform) return [`transforms[${i}]: unknown transform ${step?.name}; known: ${CANONICAL_ORDER.join(', ')}`];
    return transform.argProblems(step.args ?? {}).map((p) => `transforms[${i}] ${step.name}: ${p}`);
  });
}

function sourceLevel(graph, id) {
  const feature = features(graph).find((f) => idOf(f) === id);
  return (feature && levelOf(feature.type)) ?? 'sequence';
}

/**
 * `created` maps each created ID to the root input `{ level, id }` it derives from, through any chain of created IDs.
 * A thrown error is tagged: `from` on an ID_COLLISION, `handFix` on one of the transform's handFixCodes.
 */
export function runTransforms(graph, steps) {
  let current = graph;
  const results = [];
  const warnings = [];
  const created = new Map();
  for (const step of steps) {
    const transform = TRANSFORMS[step.name];
    let outcome;
    try {
      outcome = transform.run(current, step.args ?? {});
    } catch (e) {
      if (e.code === 'ID_COLLISION') e.from = created.get(e.source) ?? { level: sourceLevel(current, e.source), id: e.source };
      if (transform.handFixCodes.includes(e.code)) e.handFix = true;
      throw e;
    }
    const { graph: next, changes } = outcome;
    current = next;
    for (const change of changes) for (const id of change.created ?? []) created.set(id, created.get(change.from.id) ?? change.from);
    if (!changes.length) warnings.push(`${step.name} changed nothing; the recipe declares a transform this genome does not need`);
    results.push({ name: step.name, ...(step.args && { args: step.args }), changes: changes.length, sample: changes.slice(0, 20).map((c) => c.id) });
  }
  return { graph: current, results, warnings, created };
}
