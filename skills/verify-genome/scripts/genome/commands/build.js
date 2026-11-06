import { existsSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import { duplicateIds, formatFinding } from '../checks.js';
import { writeFastaSubset } from '../fasta.js';
import { featureGroups, features, serializeGff, subsetGff } from '../gff.js';
import { defaultExec } from '../../lib/tools/exec.js';
import { ID_POLICIES, idsTsvText } from '../ids.js';
import { isfTrees } from '../isf-map.js';
import { chromosomeMapText, isChromosomePrimary, publicPartition } from '../partitions.js';
import { planBuild } from '../plan-build.js';
import { BUILD_FILES, FINAL_FILES, recordHeader } from '../record.js';
import { transformProblems } from '../transforms/index.js';
import {
  isIoError, PipelineError, readJson, readText, recoverSwap, sha256, sha256File, swapDirs, workPaths, writeFileAtomic, writeJsonAtomic
} from '../workdir.js';
import { verifyFetch } from './fetch.js';
import { checkoutState, inputsOf, loadInputs, loadIsfMap, readIdsFile, readPartitionsFileWithText } from './inputs.js';

const RECIPE_KEYS = ['idPolicy', 'transforms', 'ids', 'partitions'];

function recipeProblems(recipe) {
  if (!recipe || typeof recipe !== 'object' || Array.isArray(recipe)) return ['must be a JSON object'];
  const problems = [];
  if (!ID_POLICIES.includes(recipe.idPolicy)) problems.push(`idPolicy must be one of ${ID_POLICIES.join(', ')}`);
  if (!Array.isArray(recipe.transforms)) problems.push('transforms must be a list');
  else problems.push(...transformProblems(recipe.transforms));
  for (const key of ['ids', 'partitions']) {
    if (recipe[key] !== undefined && (typeof recipe[key] !== 'string' || !recipe[key])) problems.push(`${key} must name a file in the work directory`);
  }
  const unknown = Object.keys(recipe).filter((k) => !RECIPE_KEYS.includes(k));
  if (unknown.length) problems.push(`unknown keys: ${unknown.join(', ')}`);
  return problems;
}

function readRecipe(p) {
  if (!existsSync(p.recipeJson)) throw new PipelineError('build', p.recipeJson, 'is missing', 'copy suggestedRecipe from survey.json into recipe.json and edit it');
  const text = readText(p.recipeJson);
  let recipe;
  try {
    recipe = JSON.parse(text);
  } catch (e) {
    throw new PipelineError('build', p.recipeJson, `is not JSON: ${e.message}`, 'fix recipe.json');
  }
  const problems = recipeProblems(recipe);
  if (problems.length) throw new PipelineError('build', p.recipeJson, problems.join('; '), 'fix recipe.json');
  return { recipe, text };
}

function checkSurvey(p, fetched) {
  const survey = readJson(p.surveyJson, 'build', 'run survey first');
  for (const [role, file] of Object.entries(fetched.record.files)) {
    if (survey.inputs?.[role]?.sha256 !== file.sha256) throw new PipelineError('build', p.surveyJson, `was written for a different ${role} file`, 'run survey again');
  }
}

function failureError({ kind, finding }, p, idsPath) {
  const idsFix = (finding.fix?.ids ?? []).join(' | ');
  switch (kind) {
    case 'idsTsv': return new PipelineError('build', idsPath, finding.message, 'fix those ids.tsv lines');
    case 'policyCollision':
      return new PipelineError('build', p.recipeJson, formatFinding(finding),
        `add these to ids.tsv, by input ID (and "ids": "ids.tsv" in recipe.json): ${idsFix}`);
    case 'transformCollision': return new PipelineError('build', p.recipeJson, formatFinding(finding), idsFix);
    case 'handFix': return new PipelineError('build', p.recipeJson, finding.message, 'this needs a hand fix to the input GFF, or drop the transform');
    default: throw new Error(`unknown planBuild failure ${kind}`);
  }
}

/**
 * featureCount is what ISF loads (its trees), gffLines the feature lines; `final` names the files finalize writes,
 * so a partition with nothing for ISF gets no GFF.
 */
async function writePartitions({ graph, plan, fetched, renames, outDir }) {
  const partitions = [];
  for (const part of plan.partitions) {
    const dir = join(outDir, basename(part.dir));
    const sequenceIds = new Set(part.sequences.map((s) => s.id));
    const subset = subsetGff(graph, sequenceIds);
    const chromosomeMap = isChromosomePrimary(part);
    writeFileAtomic(join(dir, BUILD_FILES.gff3), serializeGff(subset));
    await writeFastaSubset(fetched.paths.fasta, join(dir, BUILD_FILES.fasta), sequenceIds, renames);
    if (chromosomeMap) writeFileAtomic(join(dir, BUILD_FILES.chromosomeMap), chromosomeMapText(part));
    const featureCount = isfTrees(subset).trees.length;
    partitions.push({
      ...publicPartition(part),
      featureCount,
      gffLines: features(subset).length,
      final: {
        gff: featureCount > 0 ? FINAL_FILES.gff : null,
        fasta: FINAL_FILES.fasta,
        chromosomeMap: chromosomeMap ? FINAL_FILES.chromosomeMap : null
      },
      buildFiles: {
        gff3: sha256File(join(dir, BUILD_FILES.gff3)),
        fasta: sha256File(join(dir, BUILD_FILES.fasta)),
        chromosomeMap: chromosomeMap ? sha256File(join(dir, BUILD_FILES.chromosomeMap)) : null
      }
    });
  }
  return partitions;
}

/** Writes into build.tmp, then swaps it for build/, so a failed run leaves the previous build intact. */
async function writeBuild({ graph, plan, fetched, renames, p, workDir, makeRecord }) {
  const outDir = join(workDir, 'build.tmp');
  try {
    rmSync(outDir, { recursive: true, force: true });
    const normalizedText = serializeGff(graph);
    writeFileAtomic(join(outDir, 'normalized.gff3'), normalizedText);
    const partitions = await writePartitions({ graph, plan, fetched, renames, outDir });
    const record = makeRecord({ normalizedText, partitions });
    writeJsonAtomic(join(outDir, 'build.json'), record);
    rmSync(p.genomeBuildJson, { force: true });
    swapDirs(outDir, p.buildDir);
    return record;
  } catch (e) {
    rmSync(outDir, { recursive: true, force: true });
    if (!isIoError(e)) throw e;
    throw new PipelineError('build', outDir, e.message, 'check disk space and permissions in the work directory, then run build again');
  }
}

export async function runBuild({ workDir, apiCommonData, exec = defaultExec, now = () => new Date().toISOString() }) {
  const p = workPaths(workDir);
  recoverSwap(p.buildDir);
  const { map: isfMap, record: isfMapRecord } = loadIsfMap(apiCommonData, 'build');
  const checkout = checkoutState(apiCommonData, 'build', exec);
  const fetched = verifyFetch(workDir, 'build');
  checkSurvey(p, fetched);
  const { recipe, text: recipeText } = readRecipe(p);
  const idsPath = recipe.ids ? join(workDir, recipe.ids) : null;
  const partitionsPath = recipe.partitions ? join(workDir, recipe.partitions) : null;
  const ids = idsPath ? readIdsFile(idsPath, 'build') : { entries: [], text: null };
  const partitionsFile = partitionsPath ? readPartitionsFileWithText(partitionsPath, 'build') : { lines: [], text: null };
  const overrides = partitionsFile.lines;
  const inputs = await loadInputs(fetched, 'build');

  const rawDuplicates = duplicateIds(featureGroups(inputs.graph));
  if (rawDuplicates.length) {
    throw new PipelineError('build', fetched.paths.gff, `has IDs used by several features: ${rawDuplicates.slice(0, 20).map((d) => d.id).join(', ')}`,
      'the input GFF needs unique IDs; take it up with the annotation provider');
  }

  const planned = planBuild({ inputs, idPolicy: recipe.idPolicy, idsEntries: ids.entries, overrides, transforms: recipe.transforms, isfMap });
  writeFileAtomic(p.idsDefault, idsTsvText(planned.policy.defaults));
  if (planned.failure) throw failureError(planned.failure, p, idsPath);
  const { policy, run, plan, findings } = planned;
  const { graph } = run;
  const renames = policy.sequenceRenames;
  const errors = findings.filter((f) => f.severity === 'error');
  if (errors.length) {
    throw new PipelineError('build', p.buildDir, `the result still has errors:\n${errors.map(formatFinding).join('\n')}`,
      'add the fixes those findings suggest to recipe.json, ids.tsv or partitions.tsv, then run build again');
  }

  const makeRecord = ({ normalizedText, partitions }) => ({
    ...recordHeader(),
    accession: fetched.record.accession,
    apiCommonData: { ...checkout, isfMap: isfMapRecord },
    inputs: inputsOf(fetched.record),
    recipe: { sha256: sha256(recipeText) },
    idPolicy: { name: recipe.idPolicy, renamed: policy.defaults.length },
    transforms: run.results,
    warnings: run.warnings,
    ids: idsPath ? { file: recipe.ids, sha256: sha256(ids.text), applied: policy.applied } : null,
    partitionsTsv: partitionsPath ? { file: recipe.partitions, sha256: sha256(partitionsFile.text) } : null,
    normalized: { path: 'build/normalized.gff3', sha256: sha256(normalizedText) },
    findings,
    partitions,
    builtAt: now()
  });
  return writeBuild({ graph, plan, fetched, renames, p, workDir, makeRecord });
}
