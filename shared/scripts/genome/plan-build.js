import { collisionFinding, collisionFromError, finding, idsTsvFinding, runChecks } from './checks.js';
import { applyIdPolicy } from './ids.js';
import { planPartitions } from './partitions.js';
import { runTransforms } from './transforms/index.js';

const failed = (policy, kind, found) => ({ policy, failure: { kind, finding: found } });

/**
 * The build phases in memory: ID policy and ids.tsv, transforms, partitions, checks. A failure that stops them is
 * `{ policy, failure: { kind: 'idsTsv' | 'policyCollision' | 'transformCollision' | 'handFix', finding } }`.
 */
export function planBuild({ inputs, idPolicy, idsEntries = [], overrides = [], transforms, isfMap }) {
  const policy = applyIdPolicy(inputs.graph, { policy: idPolicy, overrides: idsEntries, sequenceIds: inputs.sequenceIds });
  if (policy.errors.length) return failed(policy, 'idsTsv', idsTsvFinding(policy.errors));
  if (policy.collisions.length) return failed(policy, 'policyCollision', collisionFinding(policy.collisions, idsEntries));
  let run;
  try {
    run = runTransforms(policy.graph, transforms);
  } catch (e) {
    if (e.code === 'ID_COLLISION') return failed(policy, 'transformCollision', collisionFromError(e, policy, idsEntries));
    if (e.handFix) return failed(policy, 'handFix', finding('structure', 'previewFailed', 'error', [], e.message, null, 1));
    throw e;
  }
  const renames = policy.sequenceRenames;
  const plan = planPartitions({ sequenceIds: inputs.sequenceIds, report: inputs.report, overrides, renames });
  const fastaIds = new Set(inputs.fastaIds.map((id) => renames.get(id) ?? id));
  const findings = runChecks({
    graph: run.graph, isfMap, fastaIds, plan, synthesized: run.created,
    inputIdOf: policy.inputIdOf, inputSequenceIdOf: policy.inputSequenceIdOf, idsEntries
  });
  return { policy, run, plan, fastaIds, findings };
}
