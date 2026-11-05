import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseAssemblyReport } from '../assembly-report.js';
import { readFastaIndex } from '../fasta.js';
import { parseGff, seqIdsOf } from '../gff.js';
import { readIdsTsv } from '../ids.js';
import { readIsfMap } from '../isf-map.js';
import { readPartitionsTsv } from '../partitions.js';
import { MAP_PATH } from '../preprocess-gff3.js';
import { PipelineError, readText } from '../workdir.js';

export function loadIsfMap(apiCommonData, command) {
  if (!apiCommonData) throw new PipelineError(command, '--apiCommonData', 'is required', 'pass --apiCommonData <an ApiCommonData checkout>');
  const path = join(apiCommonData, MAP_PATH);
  if (!existsSync(path)) throw new PipelineError(command, path, 'is missing', 'point --apiCommonData at an ApiCommonData checkout');
  try {
    return readIsfMap(readText(path));
  } catch (e) {
    throw new PipelineError(command, path, e.message, 'point --apiCommonData at a checkout whose map names genemRNAExonCDS2BioperlTree');
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

export async function loadInputs(fetched, command) {
  const graph = await readInput(command, fetched.paths.gff, () => parseGff(readText(fetched.paths.gff)));
  const fastaIds = (await readInput(command, fetched.paths.fasta, () => readFastaIndex(fetched.paths.fasta))).map((s) => s.id);
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
