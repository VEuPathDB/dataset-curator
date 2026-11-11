import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { sha256, sha256File, writeFileAtomic, writeJsonAtomic } from '../../genome/workdir.js';
import { isEc } from '../../genome/functional/values.js';
import { fetchReleasedGff } from './gff-source.js';
import { idIndexOfFile, levelOfId, LEVELS } from './gff-ids.js';
import { CONVERTERS, columnsProblems, convert, readTab } from './converters.js';
import { COLUMNS_SCHEMA_VERSION, CONVERT_SCHEMA_VERSION, GFF_SCHEMA_VERSION, workFiles } from './record.js';

const readJson = (path) => JSON.parse(readFileSync(path, 'utf-8'));
const GENERATOR = 'dataset-curator functional-update';

/**
 * Pulls the staged curator file (checked against its manifest sha256) and streams the organism's released GFF into the
 * work area, and writes gff.json. remote.pull(path, dest, { files }) is lib/remote.js's; fetchImpl is fetch.
 */
export async function runFetch({ workArea, proposalId, staged, stagingPath, remote, organism, pendingGenomes, fetchImpl = fetch }) {
  const files = workFiles(workArea);
  mkdirSync(workArea, { recursive: true });
  remote.pull(stagingPath, files.inputDir, { files: [staged.path] });
  const input = join(files.inputDir, staged.path);
  if (!existsSync(input)) throw new Error(`dataStaging/${proposalId} lacks ${staged.path}`);
  const got = sha256File(input);
  if (staged.sha256 && got !== staged.sha256) throw new Error(`${staged.path} on staging has sha256 ${got}, not the ${staged.sha256} the proposal recorded`);
  const gff = await fetchReleasedGff({ project: organism.project, nameForFiles: organism.nameForFiles, destDir: files.gffDir, fetchImpl });
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
  return {
    files, gffRecord,
    index: idIndexOfFile(join(files.gffDir, gffRecord.gff.file)),
    text: readFileSync(join(files.inputDir, gffRecord.input.file), 'utf-8')
  };
}

const VALUE_PATTERNS = {
  goId: (v) => /^(GO:)?\d{7}$/.test(v), ec: isEc, evidence: (v) => /^[A-Z]{2,3}$/.test(v), aspect: (v) => /^[FPC]$/.test(v)
};
const TEXT_KEYS = ['product', 'name', 'comment', 'alias'];

/** A proposed columns.json for the data loader to confirm: the ID column and level that match the GFF best, and value columns by content. */
export function inferColumns(workArea, datasetClass) {
  const { index, text } = loaded(workArea);
  const rows = readTab(text);
  const width = Math.max(...rows.map((r) => r.length));
  const body = rows.slice(1, 201);
  let best = { column: 1, level: 'gene', hits: -1 };
  for (let c = 1; c <= width; c++) {
    for (const level of LEVELS) {
      const hits = body.filter((r) => levelOfId(index, r[c - 1]) === level).length;
      if (hits > best.hits) best = { column: c, level, hits };
    }
  }
  const header = rows.length > 0 && levelOfId(index, rows[0][best.column - 1]) === null;
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
    matched: best.hits, sampled: body.length, sample: rows.slice(0, 6)
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
