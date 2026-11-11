import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sha256File } from '../../genome/workdir.js';

export const GFF_SCHEMA_VERSION = 1;
export const COLUMNS_SCHEMA_VERSION = 1;
export const CONVERT_SCHEMA_VERSION = 1;
const AGAIN = 'run functional-update.js convert again';

export const workFiles = (workArea) => ({
  gffJson: join(workArea, 'gff.json'), gffDir: join(workArea, 'gff'), inputDir: join(workArea, 'input'),
  columns: join(workArea, 'columns.json'), final: join(workArea, 'final'), convert: join(workArea, 'convert.json')
});

const readJson = (path) => JSON.parse(readFileSync(path, 'utf-8'));

/** convert.json and its own sha256 (what the verification report records). */
export function readConverted(workArea) {
  const path = workFiles(workArea).convert;
  return { record: readJson(path), sha256: sha256File(path) };
}

const label = (e) => `${e.datasetClass} ${e.name} ${e.version}`;

/** Why convert.json does not describe the work area for entry now; [] when it does. */
export function checkConvertCurrent(workArea, entry) {
  const files = workFiles(workArea);
  if (!existsSync(files.convert)) return ['no convert.json in the work area; run functional-update.js fetch, columns and convert'];
  const { record } = readConverted(workArea);
  if (record.schemaVersion !== CONVERT_SCHEMA_VERSION) return [`convert.json is schemaVersion ${record.schemaVersion}, not ${CONVERT_SCHEMA_VERSION}; ${AGAIN}`];
  const problems = [];
  if (label(record.entry) !== label(entry)) problems.push(`convert.json is for ${label(record.entry)}, not ${label(entry)}; ${AGAIN}`);
  const same = (path, sha, what) => {
    if (!existsSync(path)) problems.push(`${what} is missing; ${AGAIN}`);
    else if (sha256File(path) !== sha) problems.push(`${what} changed since convert; ${AGAIN}`);
  };
  same(files.gffJson, record.gffJson, 'gff.json');
  same(files.columns, record.columns, 'columns.json');
  same(join(files.inputDir, record.input.file), record.input.sha256, `input/${record.input.file}`);
  same(join(files.final, record.file), record.sha256, `final/${record.file}`);
  return problems;
}
