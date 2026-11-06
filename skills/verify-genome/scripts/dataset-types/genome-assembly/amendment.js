import { readCuratedJson, readInputJson, ORGANISM_RECORD_FILENAME, AMENDED_ORGANISM_KEYS } from '../_common.js';
import { entriesFrom } from './entries.js';
import { organismValueProblems } from './organism-values.js';
import { preprocessedProblems, readPreprocessed } from './preprocess.js';

export const ORGANISM_RECORD_SCHEMA_VERSION = 2;
const HUGE_GENOME = 1_000_000_000;
const RULES = { isNotEbiGenome: 'true', isCore: 'false', runExportPred: 'false' };
const ASKED = ['familyNcbiTaxonIds', 'familyNameForFiles', 'orthomclAbbrev'];

export const reportOf = (proposalDir, manifest) => readInputJson(proposalDir, `${manifest.accession}_dataset_report.json`).reports?.[0] ?? {};

/** The constants the entries reference: the genome's source and version from the record, the annotation's date from the report. */
export function constantsFrom(record, report) {
  const released = report.annotation_info?.release_date;
  return {
    constants: { genomeSource: record.genomeSource, genomeVersion: record.genomeVersion, functAnnotVersion: released || record.genomeVersion },
    sources: {
      genomeSource: 'curated/organism.json genomeSource',
      genomeVersion: 'curated/organism.json genomeVersion',
      functAnnotVersion: released ? 'report annotation_info.release_date' : 'genomeVersion (the report has no annotation_info.release_date)'
    }
  };
}

/** Each amended prop as [value, source]: derived from the build or the report, by rule, kept from the record, or given. */
function organismFrom({ records, record, report, proposed, given }) {
  const problems = [];
  const parts = records.genomeBuild.partitions;
  if (parts.some((p) => p.featureTypes === undefined || p.maxIntron === undefined)) {
    problems.push('genome-build.json has no featureTypes or maxIntron (an older finalize wrote it); run genome-pipeline.js finalize, trial and functional again');
  }
  const tRNAs = parts.reduce((n, p) => n + (p.featureTypes?.tRNA ?? 0), 0);
  const longest = Math.max(0, ...parts.map((p) => p.maxIntron ?? 0));
  const total = Number(report.assembly_stats?.total_sequence_length);
  const rep = given.familyRepOrganismAbbrev ?? record.familyRepOrganismAbbrev ?? '';
  const repValue = rep && given.familyRepOrganismAbbrev !== undefined ? [rep, 'given (--organism familyRepOrganismAbbrev)'] : null;
  const values = {
    annotationIncludesTRNAs: [String(tRNAs > 0), `genome-build.json featureTypes: ${tRNAs} tRNA`],
    maxIntronSize: [String(Math.max(1000, Math.ceil(longest / 500) * 500)), `genome-build.json maxIntron ${longest}, rounded up to a multiple of 500, at least 1000`],
    ...(total > 0 ? { isHugeGenome: [String(total > HUGE_GENOME), `report assembly_stats.total_sequence_length ${total}`] } : {}),
    ...Object.fromEntries(Object.entries(RULES).map(([k, v]) => [k, [v, 'rule']])),
    isFamilyRepresentative: [String(rep === proposed), `curated/organism.json familyRepOrganismAbbrev "${rep}"`],
    ...Object.fromEntries(ASKED.filter((k) => typeof record[k] === 'string').map((k) => [k, [record[k], 'curated/organism.json']])),
    ...Object.fromEntries(Object.entries(given).map(([k, v]) => [k, [v, `given (--organism ${k})`]]))
  };
  for (const k of ['familyNcbiTaxonIds', 'familyNameForFiles']) values[k] ??= ['', 'not given'];
  if (values.isFamilyRepresentative[0] !== 'true' && !rep) {
    problems.push('familyRepOrganismAbbrev is empty: pass --organism familyRepOrganismAbbrev=<abbrev>, or --organism isFamilyRepresentative=true if this organism represents its family');
  }
  if (!values.isHugeGenome) problems.push('the assembly report has no assembly_stats.total_sequence_length; pass --organism isHugeGenome=true or false');
  if (!values.orthomclAbbrev) problems.push('orthomclAbbrev is never derived; pass --organism orthomclAbbrev=<4 to 8 lowercase letters>');
  if (values.isFamilyRepresentative[0] === 'true' && !(values.familyNcbiTaxonIds[0] && values.familyNameForFiles[0])) {
    problems.push('this organism represents its family; pass --organism familyNcbiTaxonIds=<taxon ids> and --organism familyNameForFiles=<name>');
  }
  const settled = AMENDED_ORGANISM_KEYS.filter((k) => values[k]);
  const organism = Object.fromEntries(settled.map((k) => [k, values[k][0]]));
  problems.push(...organismValueProblems(organism));
  return {
    organism: { ...organism, ...(repValue ? { familyRepOrganismAbbrev: repValue[0] } : {}) },
    sources: { ...Object.fromEntries(settled.map((k) => [k, values[k][1]])), ...(repValue ? { familyRepOrganismAbbrev: repValue[1] } : {}) },
    problems
  };
}

const prefixed = (prefix, sources) => Object.fromEntries(Object.entries(sources).map(([k, v]) => [`${prefix}.${k}`, v]));

/**
 * What amend-proposal.js writes: { entries, constants, organism, sources }, sources naming where each constant and organism
 * prop came from. Refuses an unknown --organism key, a non-GenBank annotation, another accession's or an undeliverable
 * work area, and props it cannot settle or that the organismRecord validator would refuse.
 */
export function preprocessedAmendment({ workArea, proposalDir, manifest, given = {}, annotation }) {
  const takes = [...AMENDED_ORGANISM_KEYS, 'familyRepOrganismAbbrev'];
  const unknown = Object.keys(given).filter((k) => !takes.includes(k));
  if (unknown.length) throw new Error(`--organism takes ${takes.join(', ')}; not ${unknown.join(', ')}`);
  if (given.familyRepOrganismAbbrev !== undefined && !/^\S+$/.test(given.familyRepOrganismAbbrev)) {
    throw new Error(`familyRepOrganismAbbrev must be an organism abbreviation, not "${given.familyRepOrganismAbbrev}"`);
  }
  if (annotation.source !== 'genbank') {
    throw new Error(`${manifest.accession} has annotation source "${annotation.source}"; provider GFF annotation is not supported yet and unannotated genomes are not handled by verify-genome`);
  }
  const records = readPreprocessed(workArea);
  if (records.genomeBuild.accession !== manifest.accession) throw new Error(`The work area ${workArea} holds ${records.genomeBuild.accession}, not ${manifest.accession}`);
  const problems = preprocessedProblems(records, workArea);
  if (problems.length) throw new Error(`The work area ${workArea} cannot amend ${manifest.accession}:\n  - ${problems.join('\n  - ')}`);
  const record = readCuratedJson(proposalDir, ORGANISM_RECORD_FILENAME);
  const report = reportOf(proposalDir, manifest);
  const organism = organismFrom({ records, record, report, proposed: manifest.organisms[0].proposedOrganismAbbrev, given });
  if (organism.problems.length) throw new Error(`The organism record of ${manifest.accession} cannot be amended:\n  - ${organism.problems.join('\n  - ')}`);
  const constants = constantsFrom(record, report);
  return {
    entries: entriesFrom(records),
    constants: constants.constants,
    organism: organism.organism,
    sources: { ...prefixed('constants', constants.sources), ...prefixed('organism', organism.sources) }
  };
}
