import { basename, join } from 'node:path';
import { partitionName } from '../../genome/genome-build.js';
import { preprocessedProblems, readPreprocessed } from './preprocess.js';
import { isFeaturesClass, isSequenceClass, partitionOf, roleOf } from './entries.js';

const RECORDS = ['genomeBuild', 'trial', 'functional'];
const AMEND_AGAIN = 're-run amend-proposal.js';
const checked = new WeakMap();

/** The records and the problems shared by every location; one prepare-delivery passes one report, so this runs once per delivery. */
function checkedRecords(workArea, report) {
  if (report && checked.has(report)) return checked.get(report);
  let result;
  try {
    const records = readPreprocessed(workArea);
    const problems = preprocessedProblems(records, workArea);
    const validated = report?.preprocess;
    if (!validated) problems.push('the verification report records no preprocessing; validate again');
    else if (RECORDS.some((k) => validated[k] !== records.sha256[k])) problems.push('the work area changed since validation; validate again');
    result = { records, problems, reported: false };
  } catch (e) {
    result = { records: null, problems: [e.message], reported: false };
  }
  if (report) checked.set(report, result);
  return result;
}

function partitionFiles(location, records, workArea) {
  const { entry } = location;
  const part = partitionOf(entry, records.genomeBuild.partitions);
  if (!part) return { problem: `no partition in genome-build.json is ${roleOf(entry.datasetClass)} with soTerm ${entry.props.soTerm}; ${AMEND_AGAIN}` };
  const from = (file) => join(workArea, part.dir, file);
  if (isSequenceClass(entry.datasetClass)) {
    if (location.file) return { files: [{ path: location.file, from: from(part.final.fasta) }] };
    return {
      files: [
        { path: 'genome.fasta', from: from(part.final.fasta) },
        ...(part.final.chromosomeMap ? [{ path: 'chromosomeMap.txt', from: from(part.final.chromosomeMap) }] : [])
      ]
    };
  }
  if (!part.final.gff) return { problem: `partition ${partitionName(part)} has no features to load; ${AMEND_AGAIN}` };
  return {
    files: [
      { path: 'genome.gff', from: from(part.final.gff) },
      ...Object.keys(records.trial.outputs[partitionName(part)] ?? {}).map((file) => ({ path: file, from: from(file) }))
    ]
  };
}

function functionalFiles(location, records, workArea) {
  const { entry } = location;
  const dataset = records.functional.datasets.find((d) => d.datasetClass === entry.datasetClass && d.name === entry.name);
  if (!dataset) return { problem: `functional.json has no ${entry.datasetClass} dataset named ${entry.name}; ${AMEND_AGAIN}` };
  if (basename(dataset.file) !== location.file) return { problem: `functional.json gives ${dataset.file}, but the class loads ${location.file}` };
  return { files: [{ path: location.file, from: join(workArea, dataset.file) }] };
}

/**
 * prepare-delivery: one entry location's files from the work area. Sequence and features entries take their
 * partition's final files (and the trial's transcriptInfoAndIds), functional entries their functional.json file.
 * Problems: the work area's preprocessedProblems, a work area changed since the report validated it, an entry with nothing to deliver.
 */
export function preprocessedFiles(proposalDir, location, { workArea, report = null }) {
  const shared = checkedRecords(workArea, report);
  const problems = shared.reported ? [] : [...shared.problems];
  shared.reported = Boolean(report);
  if (!shared.records) return { files: [], problems, provenance: null };
  const { records } = shared;
  const own = isSequenceClass(location.entry.datasetClass) || isFeaturesClass(location.entry.datasetClass)
    ? partitionFiles(location, records, workArea)
    : functionalFiles(location, records, workArea);
  return {
    files: own.files ?? [],
    problems: [...problems, ...(own.problem ? [own.problem] : [])],
    provenance: { ...records.sha256, database: records.trial.database, release: records.trial.release, generator: records.genomeBuild.generator?.version ?? null }
  };
}
