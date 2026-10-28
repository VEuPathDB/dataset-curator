#!/usr/bin/env node
/**
 * One-time migration: drops the strandedness column from every
 * Proposals/<acc>/curated/<abbrev>/samplesheet.csv in a VEuPathDatasets checkout,
 * then re-runs the curated-artifact check on each migrated proposal.
 *
 * Usage: node bin/dropSamplesheetStrandednessColumn.js [--dry-run] <VEuPathDatasets checkout>
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const OLD = 'sample,fastq_1,fastq_2,strandedness';
const NEW = 'sample,fastq_1,fastq_2';

function samplesheets(root) {
  const proposals = join(root, 'Proposals');
  if (!existsSync(proposals)) return [];
  return readdirSync(proposals).flatMap((acc) => {
    const curated = join(proposals, acc, 'curated');
    if (!existsSync(curated)) return [];
    return readdirSync(curated, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join(curated, d.name, 'samplesheet.csv')))
      .map((d) => `Proposals/${acc}/curated/${d.name}/samplesheet.csv`);
  });
}

const STRANDEDNESS = { true: 'stranded', false: 'unstranded' };

function isStrandSpecific(root, path) {
  const datasetJson = join(root, path.split('/').slice(0, 3).join('/'), 'dataset.json');
  try {
    return String(JSON.parse(readFileSync(datasetJson, 'utf-8')).props.isStrandSpecific);
  } catch (e) {
    return undefined;
  }
}

function rowProblems(root, path, lines) {
  const strandSpecific = isStrandSpecific(root, path);
  if (!(strandSpecific in STRANDEDNESS)) return [`${path}: dataset.json missing, unreadable or without props.isStrandSpecific true or false`];
  return lines.flatMap((l, i) => {
    if (!l.trim()) return [];
    // Sample ids and file names cannot contain commas (SAMPLE_ID / FILE_NAME rules), so plain splitting is sound.
    const cells = l.split(',');
    const at = `${path} line ${i + 2}`;
    if (cells.length !== 4) return [`${at}: ${cells.length} columns; expected 4`];
    const value = cells[3].trim();
    if (value !== 'stranded' && value !== 'unstranded') return [`${at}: strandedness "${value}" is neither stranded nor unstranded`];
    if (value !== STRANDEDNESS[strandSpecific]) return [`${at}: strandedness "${value}" but dataset.json isStrandSpecific is ${strandSpecific}`];
    return [];
  });
}

export function planMigration(root) {
  const files = [];
  const refused = [];
  for (const path of samplesheets(root)) {
    const [header, ...lines] = readFileSync(join(root, path), 'utf-8').split(/\r?\n/);
    if (header === NEW) continue;
    if (header !== OLD) { refused.push(`${path}: header "${header}"`); continue; }
    const problems = rowProblems(root, path, lines);
    if (problems.length) { refused.push(...problems); continue; }
    files.push({ path, before: OLD, after: NEW, rows: lines.filter((l) => l.trim()).length });
  }
  return { files, refused };
}

export function applyMigration(root, plan) {
  if (plan.refused.length) throw new Error(`Refusing to migrate; unexpected headers:\n  - ${plan.refused.join('\n  - ')}`);
  for (const { path } of plan.files) {
    const [, ...lines] = readFileSync(join(root, path), 'utf-8').split(/\r?\n/);
    const rows = lines.filter((l) => l.trim()).map((l) => l.split(',').slice(0, 3).join(','));
    writeFileSync(join(root, path), [NEW, ...rows].join('\n') + '\n');
  }
}

async function main() {
  const { values, positionals: [root] } = parseArgs({ options: { 'dry-run': { type: 'boolean', default: false } }, allowPositionals: true });
  if (!root) { console.error('Usage: node bin/dropSamplesheetStrandednessColumn.js [--dry-run] <VEuPathDatasets checkout>'); process.exit(1); }
  const plan = planMigration(root);
  for (const f of plan.files) console.log(`${f.path}: "${f.before}" -> "${f.after}" (${f.rows} rows)`);
  for (const r of plan.refused) console.error(`Refused: ${r}`);
  if (values['dry-run']) { if (plan.refused.length) process.exit(1); return; }
  applyMigration(root, plan);
  const { checkCurated } = await import('../shared/scripts/dataset-types/bulk-rnaseq.js');
  const proposals = [...new Set(plan.files.map((f) => f.path.split('/').slice(0, 2).join('/')))];
  let failed = false;
  for (const p of proposals) {
    const errors = checkCurated(join(root, p));
    if (errors.length) { failed = true; console.error(`${p}:\n  - ${errors.join('\n  - ')}`); }
  }
  if (failed) process.exit(1);
  console.log(`Migrated ${plan.files.length} samplesheets in ${proposals.length} proposals; checkCurated passes for each.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(`Error: ${e.message}`); process.exit(1); });
