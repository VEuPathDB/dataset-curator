import { addExonPerCds } from './add-exon-per-cds.js';
import { addMrnaToGeneCds } from './add-mrna-to-gene-cds.js';
import { collapseSplitGenes } from './collapse-split-genes.js';
import { parentOrphanRnas } from './parent-orphan-rnas.js';
import { stripAttributes, stripAttributesProblems } from './strip-attributes.js';

const noArgs = (args) => (Object.keys(args).length ? ['takes no args'] : []);

/** In canonical order: the order survey suggests them in. */
export const TRANSFORMS = {
  collapseSplitGenes: { run: collapseSplitGenes, argProblems: noArgs },
  addMrnaToGeneCds: { run: addMrnaToGeneCds, argProblems: noArgs },
  addExonPerCds: { run: addExonPerCds, argProblems: noArgs },
  parentOrphanRnas: { run: parentOrphanRnas, argProblems: noArgs },
  stripAttributes: { run: stripAttributes, argProblems: stripAttributesProblems }
};
export const CANONICAL_ORDER = Object.keys(TRANSFORMS);

export function transformProblems(steps) {
  return steps.flatMap((step, i) => {
    const transform = TRANSFORMS[step?.name];
    if (!transform) return [`transforms[${i}]: unknown transform ${step?.name}; known: ${CANONICAL_ORDER.join(', ')}`];
    return transform.argProblems(step.args ?? {}).map((p) => `transforms[${i}] ${step.name}: ${p}`);
  });
}

/** `created` maps each created ID to the settled `{ level, id }` it derives from. */
export function runTransforms(graph, steps) {
  let current = graph;
  const results = [];
  const warnings = [];
  const created = new Map();
  for (const step of steps) {
    const { graph: next, changes } = TRANSFORMS[step.name].run(current, step.args ?? {});
    current = next;
    for (const change of changes) for (const id of change.created ?? []) created.set(id, change.from);
    if (!changes.length) warnings.push(`${step.name} changed nothing; the recipe declares a transform this genome does not need`);
    results.push({ name: step.name, ...(step.args && { args: step.args }), changes: changes.length, sample: changes.slice(0, 20).map((c) => c.id) });
  }
  return { graph: current, results, warnings, created };
}
