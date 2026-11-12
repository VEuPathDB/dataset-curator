import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { sha256, sha256File, writeFileAtomic, writeJsonAtomic } from '../../genome/workdir.js';
import { isEc } from '../../genome/functional/values.js';
import { fetchReleasedGff } from './gff-source.js';
import { idIndexOfFile, levelOfId, LEVELS } from './gff-ids.js';
import { CONVERTERS, aspectOf, columnsProblems, convert, ecTokens, goIdOf, isEvidence, readTab } from './converters.js';
import { COLUMNS_SCHEMA_VERSION, CONVERT_SCHEMA_VERSION, GFF_SCHEMA_VERSION, readJson, workFiles } from './record.js';

const GENERATOR = 'dataset-curator functional-update';
const COLUMN = /^[1-9]\d*$/;

/** The CLI's --id <column>:<level> and --value <key>=<column> as columns.json's id and values; columns count from 1. */
export function parseColumnArgs(id, pairs = []) {
  const at = /^(\d+):(\w+)$/.exec(id ?? '');
  if (!at || !COLUMN.test(at[1]) || !LEVELS.includes(at[2])) {
    throw new Error(`--id must be <column>:<level>, with a column number from 1 and level ${LEVELS.join(', ')}; got ${JSON.stringify(id ?? '')}`);
  }
  const values = {};
  for (const pair of pairs) {
    const m = /^(\w+)=(\d+)$/.exec(pair);
    if (!m || !COLUMN.test(m[2])) throw new Error(`--value must be <key>=<column>, with a column number from 1; got ${JSON.stringify(pair)}`);
    if (Object.hasOwn(values, m[1])) throw new Error(`--value names ${m[1]} twice`);
    values[m[1]] = Number(m[2]);
  }
  return { id: { column: Number(at[1]), level: at[2] }, values };
}

/**
 * Pulls the staged curator file (checked against its manifest sha256) and streams the organism's released GFF into the
 * work area, and writes gff.json. remote.pull(path, dest, { files }) is lib/remote.js's; fetchImpl is fetch.
 */
export async function runFetch({ workArea, proposalId, staged, stagingPath, remote, organism, pendingGenomes, fetchImpl = fetch }) {
  if (!staged?.sha256) throw new Error(`the proposal records no sha256 for ${staged?.path ?? 'its staged file'}; it cannot be checked`);
  const files = workFiles(workArea);
  mkdirSync(workArea, { recursive: true });
  for (const stale of [files.convert, files.gffJson]) rmSync(stale, { force: true });
  rmSync(files.inputDir, { recursive: true, force: true });
  remote.pull(stagingPath, files.inputDir, { files: [staged.path] });
  const input = join(files.inputDir, staged.path);
  if (!existsSync(input)) throw new Error(`dataStaging/${proposalId} lacks ${staged.path}`);
  const got = sha256File(input);
  if (got !== staged.sha256) throw new Error(`${staged.path} on staging has sha256 ${got}, not the ${staged.sha256} the proposal recorded`);
  chmodSync(input, 0o444);
  const gff = await fetchReleasedGff({ project: organism.project, nameForFiles: organism.nameForFiles, destDir: files.gffDir, fetchImpl });
  for (const name of readdirSync(files.gffDir)) if (name.endsWith('.gff') && name !== gff.file) rmSync(join(files.gffDir, name), { force: true });
  const record = {
    schemaVersion: GFF_SCHEMA_VERSION, proposalId, organism, pendingGenomes,
    gff: { url: gff.url, pinnedUrl: gff.pinnedUrl, file: gff.file, release: gff.release, sha256: gff.sha256 },
    input: { file: staged.path, sha256: got },
    fetchedAt: new Date().toISOString()
  };
  writeJsonAtomic(files.gffJson, record);
  return record;
}

function loaded(workArea) {
  const files = workFiles(workArea);
  if (!existsSync(files.gffJson)) throw new Error(`no gff.json in ${workArea}; run functional-update.js fetch first`);
  const gffRecord = readJson(files.gffJson);
  const gffPath = join(files.gffDir, gffRecord.gff.file);
  const inputPath = join(files.inputDir, gffRecord.input.file);
  for (const [path, sha, what] of [[gffPath, gffRecord.gff.sha256, `gff/${gffRecord.gff.file}`], [inputPath, gffRecord.input.sha256, `input/${gffRecord.input.file}`]]) {
    if (!existsSync(path)) throw new Error(`${what} is missing from ${workArea}; run functional-update.js fetch again`);
    if (sha256File(path) !== sha) throw new Error(`${what} changed since fetch recorded it in gff.json; run functional-update.js fetch again`);
  }
  return { files, gffRecord, index: idIndexOfFile(gffPath), text: readFileSync(inputPath, 'utf-8') };
}

const VALUE_PATTERNS = {
  goId: (v) => goIdOf(v) !== null, ec: (v) => ecTokens(v).length > 0 && ecTokens(v).every(isEc),
  evidence: (v) => isEvidence(v), aspect: (v) => aspectOf(v) !== ''
};
const TEXT_KEYS = ['product', 'name', 'comment', 'alias'];
const SAMPLE_ROWS = 201;

/**
 * A proposed columns.json for the data loader to confirm: the ID column and level that match the GFF best, and value
 * columns by content. id is null, with a note, when no column holds IDs of the released GFF.
 */
export function inferColumns(workArea, datasetClass) {
  const { gffRecord, index, text } = loaded(workArea);
  const rows = readTab(text);
  if (!rows.length) throw new Error(`input/${gffRecord.input.file} has no rows`);
  const sampled = rows.slice(0, SAMPLE_ROWS);
  const width = sampled.reduce((w, r) => Math.max(w, r.length), 0);
  const body = sampled.slice(1);
  let best = { column: 1, level: 'gene', hits: 0 };
  for (let c = 1; c <= width; c++) {
    for (const level of LEVELS) {
      const hits = body.filter((r) => levelOfId(index, r[c - 1]) === level).length;
      if (hits > best.hits) best = { column: c, level, hits };
    }
  }
  const sample = rows.slice(0, 6);
  if (best.hits === 0) {
    return { columns: null, note: `no column of ${gffRecord.input.file} holds gene, transcript or protein IDs of the released GFF (${gffRecord.gff.file}); check the file or the organism`, matched: 0, sampled: body.length, sample };
  }
  const header = levelOfId(index, rows[0][best.column - 1]) === null;
  const spec = CONVERTERS[datasetClass];
  const values = {};
  const free = [...Array(width).keys()].map((i) => i + 1).filter((c) => c !== best.column);
  for (const key of [...spec.values, ...spec.optional]) {
    const test = VALUE_PATTERNS[key];
    const pick = test ? free.find((c) => body.length && body.every((r) => !r[c - 1] || test(r[c - 1])) && body.some((r) => r[c - 1]))
      : TEXT_KEYS.includes(key) ? free.find((c) => body.some((r) => r[c - 1])) : undefined;
    if (pick !== undefined) { values[key] = pick; free.splice(free.indexOf(pick), 1); }
  }
  return {
    columns: { schemaVersion: COLUMNS_SCHEMA_VERSION, header, id: { column: best.column, level: best.level }, values },
    matched: best.hits, sampled: body.length, sample
  };
}

/** Writes columns.json once the class can use it. */
export function writeColumns(workArea, datasetClass, columns) {
  const problems = columnsProblems(datasetClass, columns);
  if (problems.length) throw new Error(`columns for ${datasetClass}:\n  - ${problems.join('\n  - ')}`);
  writeJsonAtomic(workFiles(workArea).columns, { schemaVersion: COLUMNS_SCHEMA_VERSION, header: Boolean(columns.header), id: columns.id, values: columns.values });
}

/** Converts the input for entry ({ datasetClass, name, version }) into final/<file> and writes convert.json last. */
export function runConvert({ workArea, entry, generatorVersion = null }) {
  const { files, gffRecord, index, text } = loaded(workArea);
  if (!existsSync(files.columns)) throw new Error(`no columns.json in ${workArea}; run functional-update.js columns first`);
  const columns = readJson(files.columns);
  const problems = columnsProblems(entry.datasetClass, columns);
  if (problems.length) throw new Error(`columns.json cannot convert ${entry.datasetClass}:\n  - ${problems.join('\n  - ')}`);
  rmSync(files.convert, { force: true });
  const out = convert({ ...entry, text, columns, index, taxonId: gffRecord.organism.ncbiTaxonId });
  rmSync(files.final, { recursive: true, force: true });
  mkdirSync(files.final, { recursive: true });
  writeFileAtomic(join(files.final, out.file), out.text);
  const record = {
    schemaVersion: CONVERT_SCHEMA_VERSION, generator: { name: GENERATOR, version: generatorVersion }, entry,
    gffJson: sha256File(files.gffJson), columns: sha256File(files.columns),
    gff: gffRecord.gff, input: gffRecord.input, pendingGenomes: gffRecord.pendingGenomes,
    file: out.file, rows: out.rows, sha256: sha256(out.text), ids: out.ids, findings: out.findings
  };
  writeJsonAtomic(files.convert, record);
  return record;
}
