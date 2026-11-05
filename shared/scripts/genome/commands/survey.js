import { existsSync } from 'node:fs';
import { collisionFinding, collisionFromError, runChecks } from '../checks.js';
import { applyIdPolicy, readIdsTsv } from '../ids.js';
import { planPartitions, publicPartition } from '../partitions.js';
import { CANONICAL_ORDER, runTransforms } from '../transforms/index.js';
import { readText, workPaths, writeJsonAtomic } from '../workdir.js';
import { verifyFetch } from './fetch.js';
import { inputsOf, loadInputs, loadIsfMap, readPartitionsFile } from './inputs.js';

const errorFinding = (group, check, message, count = 1) => ({ group, check, severity: 'error', count, sample: [], message, fix: null });
const PREVIEW_ERRORS = new Set(['SPLIT_ACROSS', 'ORPHAN_OPPOSITE_STRANDS']);

/** The suggested build in memory: ID pass (policy + ids.tsv), suggested structural transforms, checks. */
function preview(inputs, idLines, partitionLines, structural, isfMap) {
  const policy = applyIdPolicy(inputs.graph, { policy: 'ncbiDefault', overrides: idLines, sequenceIds: inputs.sequenceIds });
  if (policy.errors.length) {
    return { ran: false, findings: [errorFinding('ids', 'idsTsvLine', policy.errors.join('; '), policy.errors.length)] };
  }
  if (policy.collisions.length) return { ran: false, findings: [collisionFinding(policy.collisions, idLines)] };
  const renames = policy.sequenceRenames;
  const plan = planPartitions({ sequenceIds: inputs.sequenceIds, report: inputs.report, overrides: partitionLines, renames });
  const fastaIds = new Set(inputs.fastaIds.map((id) => renames.get(id) ?? id));
  try {
    const run = runTransforms(policy.graph, structural);
    return {
      ran: true,
      findings: runChecks({
        graph: run.graph, isfMap, fastaIds, plan, synthesized: run.created,
        inputIdOf: policy.inputIdOf, inputSequenceIdOf: policy.inputSequenceIdOf, idsEntries: idLines
      })
    };
  } catch (e) {
    if (e.code === 'ID_COLLISION') return { ran: false, findings: [collisionFromError(e, policy, idLines)] };
    if (PREVIEW_ERRORS.has(e.code)) return { ran: false, findings: [errorFinding('structure', 'previewFailed', e.message)] };
    throw e;
  }
}

/** Findings on the raw graph and on a preview of the suggested recipe; never modifies inputs. */
export async function runSurvey({ workDir, apiCommonData, now = () => new Date().toISOString() }) {
  const p = workPaths(workDir);
  const isfMap = loadIsfMap(apiCommonData, 'survey');
  const fetched = verifyFetch(workDir, 'survey');
  const inputs = await loadInputs(fetched, 'survey');
  const hasIds = existsSync(p.idsTsv);
  const hasPartitions = existsSync(p.partitionsTsv);
  const ids = hasIds ? readIdsTsv(readText(p.idsTsv)) : { entries: [], errors: [] };
  const overrides = hasPartitions ? readPartitionsFile(p.partitionsTsv, 'survey') : [];
  const plan = planPartitions({ sequenceIds: inputs.sequenceIds, report: inputs.report, overrides });

  const idsFindings = ids.errors.length ? [errorFinding('ids', 'idsTsvLine', ids.errors.join('; '), ids.errors.length)] : [];
  const raw = [
    ...idsFindings,
    ...runChecks({ graph: inputs.graph, isfMap, fastaIds: new Set(inputs.fastaIds), plan, idsEntries: ids.entries })
  ];
  const structural = CANONICAL_ORDER
    .filter((name) => name !== 'stripAttributes' && raw.some((f) => f.fix?.transforms?.some((t) => t.name === name)))
    .map((name) => ({ name }));
  const suggested = ids.errors.length ? { ran: false, findings: [] } : preview(inputs, ids.entries, overrides, structural, isfMap);
  const strips = (suggested.ran ? suggested.findings : raw)
    .filter((f) => f.check === 'attributeNotInMap')
    .flatMap((f) => f.fix.transforms);

  const survey = {
    accession: fetched.record.accession,
    inputs: inputsOf(fetched.record),
    surveyedAt: now(),
    findings: [...raw.map((f) => ({ stage: 'raw', ...f })), ...suggested.findings.map((f) => ({ stage: 'suggested', ...f }))],
    suggestedRecipe: {
      idPolicy: 'ncbiDefault',
      transforms: [...structural, ...strips],
      ...(hasIds && { ids: 'ids.tsv' }),
      ...(hasPartitions && { partitions: 'partitions.tsv' })
    },
    partitions: plan.partitions.map(publicPartition)
  };
  writeJsonAtomic(p.surveyJson, survey);
  return survey;
}
