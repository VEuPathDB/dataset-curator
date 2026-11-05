import { existsSync } from 'node:fs';
import { idsTsvFinding, runChecks } from '../checks.js';
import { DEFAULT_ID_POLICY, readIdsTsv } from '../ids.js';
import { planPartitions, publicPartition } from '../partitions.js';
import { planBuild } from '../plan-build.js';
import { STRUCTURAL_TRANSFORMS } from '../transforms/index.js';
import { readText, workPaths, writeJsonAtomic } from '../workdir.js';
import { verifyFetch } from './fetch.js';
import { inputsOf, loadInputs, loadIsfMap, readPartitionsFile } from './inputs.js';

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

  const raw = [
    ...(ids.errors.length ? [idsTsvFinding(ids.errors)] : []),
    ...runChecks({ graph: inputs.graph, isfMap, fastaIds: new Set(inputs.fastaIds), plan, idsEntries: ids.entries })
  ];
  const structural = STRUCTURAL_TRANSFORMS
    .filter((name) => raw.some((f) => f.fix?.transforms?.some((t) => t.name === name)))
    .map((name) => ({ name }));
  const planned = ids.errors.length
    ? null
    : planBuild({ inputs, idPolicy: DEFAULT_ID_POLICY, idsEntries: ids.entries, overrides, transforms: structural, isfMap });
  const previewed = planned !== null && !planned.failure;
  const suggested = planned?.failure ? [planned.failure.finding] : (planned?.findings ?? []);
  const strips = (previewed ? suggested : raw)
    .filter((f) => f.check === 'attributeNotInMap')
    .flatMap((f) => f.fix.transforms);

  const survey = {
    accession: fetched.record.accession,
    inputs: inputsOf(fetched.record),
    surveyedAt: now(),
    findings: [...raw.map((f) => ({ stage: 'raw', ...f })), ...suggested.map((f) => ({ stage: 'suggested', ...f }))],
    suggestedRecipe: {
      idPolicy: DEFAULT_ID_POLICY,
      transforms: [...structural, ...strips],
      ...(hasIds && { ids: 'ids.tsv' }),
      ...(hasPartitions && { partitions: 'partitions.tsv' })
    },
    partitions: plan.partitions.map(publicPartition)
  };
  writeJsonAtomic(p.surveyJson, survey);
  return survey;
}
