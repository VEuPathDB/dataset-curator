import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseAssemblyReport } from '../assembly-report.js';
import { readFastaIndex } from '../fasta.js';
import { parseGff, seqIdsOf } from '../gff.js';
import { readIdsTsv } from '../ids.js';
import { readIsfMap } from '../isf-map.js';
import { readPartitionsTsv } from '../partitions.js';
import { apiCommonDataCommit, MAP_PATH } from '../preprocess-gff3.js';
import { PipelineError, readText, sha256 } from '../workdir.js';

/** The ISF map's text at `apiCommonData`, and `{ path, sha256 }` as the records name it. */
export function readIsfMapText(apiCommonData, command) {
  if (!apiCommonData) throw new PipelineError(command, '--apiCommonData', 'is required', 'pass --apiCommonData <an ApiCommonData checkout>');
  const file = join(apiCommonData, MAP_PATH);
  if (!existsSync(file)) throw new PipelineError(command, file, 'is missing', 'point --apiCommonData at an ApiCommonData checkout');
  const text = readText(file);
  return { file, text, record: { path: MAP_PATH, sha256: sha256(text) } };
}

/** `{ commit, dirty }` of the ApiCommonData checkout. */
export function checkoutState(apiCommonData, command, exec) {
  try {
    return apiCommonDataCommit(apiCommonData, { exec });
  } catch (e) {
    throw new PipelineError(command, apiCommonData, e.message, 'point --apiCommonData at a git checkout of ApiCommonData');
  }
}

/** The parsed ISF map and the `{ path, sha256 }` of the text that was parsed. */
export function loadIsfMap(apiCommonData, command) {
  const { file, text, record } = readIsfMapText(apiCommonData, command);
  try {
    return { map: readIsfMap(text), record };
  } catch (e) {
    throw new PipelineError(command, file, e.message, 'point --apiCommonData at a checkout whose map names genemRNAExonCDS2BioperlTree');
  }
}

const FETCH_AGAIN = 'delete the file and run fetch again; if it keeps failing, NCBI\'s copy is malformed';

async function readInput(command, path, read) {
  try {
    return await read();
  } catch (e) {
    if (e instanceof PipelineError) throw e;
    throw new PipelineError(command, path, e.message, FETCH_AGAIN);
  }
}

function repeated(ids) {
  const seen = new Set();
  return [...new Set(ids.filter((id) => seen.has(id) || !seen.add(id)))];
}

export async function loadInputs(fetched, command) {
  const graph = await readInput(command, fetched.paths.gff, () => parseGff(readText(fetched.paths.gff)));
  const fastaIds = (await readInput(command, fetched.paths.fasta, () => readFastaIndex(fetched.paths.fasta))).map((s) => s.id);
  const duplicates = repeated(fastaIds);
  if (duplicates.length) {
    throw new PipelineError(command, fetched.paths.fasta, `has duplicate sequence IDs: ${duplicates.slice(0, 20).join(', ')}`,
      'the input FASTA needs unique sequence IDs; take it up with the assembly provider');
  }
  const report = parseAssemblyReport(readText(fetched.paths.report), fetched.paths.report, command);
  return { graph, fastaIds, sequenceIds: [...new Set([...fastaIds, ...seqIdsOf(graph)])], report };
}

export function readIdsFile(path, command) {
  if (!existsSync(path)) throw new PipelineError(command, path, 'is missing', 'create it, or drop "ids" from recipe.json');
  const text = readText(path);
  const parsed = readIdsTsv(text);
  if (parsed.errors.length) throw new PipelineError(command, path, parsed.errors.join('; '), 'fix those ids.tsv lines');
  return { ...parsed, text };
}

export function readPartitionsFileWithText(path, command) {
  if (!existsSync(path)) throw new PipelineError(command, path, 'is missing', 'create it, or drop "partitions" from recipe.json');
  const text = readText(path);
  try {
    return { lines: readPartitionsTsv(text), text };
  } catch (e) {
    throw new PipelineError(command, path, e.message, 'fix that partitions.tsv line');
  }
}

export const readPartitionsFile = (path, command) => readPartitionsFileWithText(path, command).lines;

export const inputsOf = (record) =>
  Object.fromEntries(Object.entries(record.files).map(([role, f]) => [role, { name: f.name, sha256: f.sha256 }]));
