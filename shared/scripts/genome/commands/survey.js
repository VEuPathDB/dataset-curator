import { existsSync } from 'node:fs';
import { collisionFinding, runChecks } from '../checks.js';
import { applyIdPolicy } from '../ids.js';
import { planPartitions, publicPartition } from '../partitions.js';
import { CANONICAL_ORDER, runTransforms } from '../transforms/index.js';
import { workPaths, writeJsonAtomic } from '../workdir.js';
import { verifyFetch } from './fetch.js';
import { inputsOf, loadInputs, loadIsfMap, readIdsFile, readPartitionsFile } from './inputs.js';

const errorFinding = (group, check, message, fix = null) => ({ group, check, severity: 'error', count: 1, sample: [], message, fix });

function collisionFromTransform(e, policy, idLines) {
  const { level, id } = e.from;
  const root = (level === 'sequence' ? policy.inputSequenceIdOf : policy.inputIdOf).get(id) ?? id;
  const existing = idLines.find((l) => l.old === root);
  const line = existing
    ? `ids.tsv line ${existing.line} already renames ${root}; give it a different new ID`
    : `${level}\t${root}\t<new id>`;
  return errorFinding('ids', 'duplicateId', `${e.message}; it derives from input ${level} ${root}`, { ids: [line] });
}

/** The suggested build in memory: ID pass (policy + ids.tsv), suggested structural transforms, checks. */
function preview(inputs, idLines, partitionLines, structural, isfMap) {
  const policy = applyIdPolicy(inputs.graph, { policy: 'ncbiDefault', overrides: idLines, sequenceIds: inputs.sequenceIds });
  if (policy.errors.length) {
    return { ran: false, findings: [{ ...errorFinding('ids', 'idsTsvLine', policy.errors.join('; ')), count: policy.errors.length }] };
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
    const finding = e.code === 'ID_COLLISION'
      ? collisionFromTransform(e, policy, idLines)
      : errorFinding('structure', 'previewFailed', e.message);
    return { ran: false, findings: [finding] };
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
  const ids = hasIds ? readIdsFile(p.idsTsv, 'survey') : { entries: [] };
  const overrides = hasPartitions ? readPartitionsFile(p.partitionsTsv, 'survey') : [];
  const plan = planPartitions({ sequenceIds: inputs.sequenceIds, report: inputs.report, overrides });

  const raw = runChecks({ graph: inputs.graph, isfMap, fastaIds: new Set(inputs.fastaIds), plan, idsEntries: ids.entries });
  const structural = CANONICAL_ORDER
    .filter((name) => name !== 'stripAttributes' && raw.some((f) => f.fix?.transforms?.some((t) => t.name === name)))
    .map((name) => ({ name }));
  const suggested = preview(inputs, ids.entries, overrides, structural, isfMap);
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
