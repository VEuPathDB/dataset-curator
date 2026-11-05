import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { reportTaxonId } from '../assembly-report.js';
import { finding } from '../checks.js';
import { extractDatasets, fileText } from '../functional/classes.js';
import { resolveFeatures } from '../functional/ids.js';
import { functionalPaths, newFunctionalRecord } from '../functional/record.js';
import { partitionName, readGenomeBuild } from '../genome-build.js';
import { parseGff } from '../gff.js';
import { BUILD_FILES } from '../record.js';
import { PipelineError, readJson, readText, sha256, sha256File, swapDirs, workPaths, writeFileAtomic, writeJsonAtomic } from '../workdir.js';

const REFINALIZE = 'run build and finalize again';

export function sourceOf(accession) {
  if (accession.startsWith('GCA_')) return 'GenBank';
  if (accession.startsWith('GCF_')) return 'RefSeq';
  return null;
}

/** GAF's date column from finalize's timestamp, so a rerun writes the same bytes. */
export const gafDate = (finalizedAt) => (/^\d{4}-\d{2}-\d{2}T/.test(finalizedAt ?? '') ? finalizedAt.slice(0, 10).replaceAll('-', '') : null);

/** The NCBI taxon ID from the `# Taxid:` line of the assembly report fetch recorded. */
export function readTaxonId(workDir) {
  const p = workPaths(workDir);
  const report = readJson(p.fetchJson, 'functional', 'run fetch <assemblyAccession> first')?.files?.report;
  if (typeof report?.name !== 'string' || report.name.includes('/') || typeof report.sha256 !== 'string') {
    throw new PipelineError('functional', p.fetchJson, 'is incomplete: no files.report name and sha256', 'delete fetch/fetch.json and run fetch again');
  }
  const path = join(p.fetchDir, report.name);
  if (!existsSync(path)) throw new PipelineError('functional', path, 'is missing', 'run fetch again');
  if (sha256File(path) !== report.sha256) throw new PipelineError('functional', path, 'does not match fetch/fetch.json', 'delete it and run fetch again');
  const taxonId = reportTaxonId(readText(path));
  if (taxonId === null) throw new PipelineError('functional', path, 'has no "# Taxid:" line', 'run fetch again; if the report still has none, NCBI changed its format');
  return taxonId;
}

function readFeatures(build, workDir) {
  const { buildDir } = workPaths(workDir);
  const all = { features: [], unresolved: [], notLoaded: [], codingTranscripts: [] };
  for (const part of build.partitions.filter((x) => x.featureCount > 0)) {
    const model = resolveFeatures(parseGff(readText(join(buildDir, partitionName(part), BUILD_FILES.gff3))));
    all.features.push(...model.features);
    all.unresolved.push(...model.unresolved);
    all.notLoaded.push(...model.notLoaded);
    all.codingTranscripts.push(...model.codingTranscripts);
  }
  return all;
}

/** The old record goes first and the new one is written last, so functional.json never describes files that are not there. */
function writeDatasets(workDir, datasets) {
  const paths = functionalPaths(workDir);
  rmSync(paths.functionalJson, { force: true });
  rmSync(paths.stagedDir, { recursive: true, force: true });
  mkdirSync(paths.stagedDir, { recursive: true });
  for (const d of datasets) writeFileAtomic(join(paths.stagedDir, d.datasetClass, d.name, d.file), d.text);
  swapDirs(paths.stagedDir, paths.functionDir);
}

export function runFunctional({ workDir }) {
  const { build, sha256: genomeBuildSha256 } = readGenomeBuild(workDir, 'functional');
  const { genomeBuildJson } = workPaths(workDir);
  const source = sourceOf(build.accession);
  if (!source) throw new PipelineError('functional', genomeBuildJson, `has accession ${build.accession}, neither GCA_ nor GCF_`, REFINALIZE);
  const date = gafDate(build.finalizedAt);
  if (!date) throw new PipelineError('functional', genomeBuildJson, 'has no finalizedAt timestamp', REFINALIZE);
  const ctx = { source, taxonId: readTaxonId(workDir), date };
  const { features, unresolved, notLoaded, codingTranscripts } = readFeatures(build, workDir);
  const extracted = extractDatasets(features, { source, codingTranscripts });
  const datasets = extracted.datasets.map((d) => {
    const text = fileText(d, ctx);
    return { ...d, text, sha256: sha256(text) };
  });
  const findings = [
    finding('functional', 'unresolvedFeature', 'error', unresolved, 'CDS or RNA features whose Parent chain reaches no gene; build and functional disagree, report it'),
    finding('functional', 'notLoaded', 'warning', notLoaded.map(({ id, type }) => `${id} (${type})`),
      `${notLoaded.length} features have a type ISF does not load (or a gene with no loaded transcript), so they get no functional data`),
    ...extracted.findings
  ].filter((f) => f.count);
  writeDatasets(workDir, datasets);
  const record = newFunctionalRecord({ genomeBuildSha256, source, datasets, findings });
  writeJsonAtomic(functionalPaths(workDir).functionalJson, record);
  return record;
}
