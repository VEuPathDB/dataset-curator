#!/usr/bin/env node
/**
 * check-library.js - Checks that a proposal's SRA runs are DNA sequencing with reads of the type's library strategies (WGS by default).
 * Reads .curation/tmp/<accession>_sra_metadata.json and checks every run.
 * Exits 0 when clean; 1 on a project-level stop (or bad usage); 3 when only some
 * runs fail, which the sample annotations must leave out (write-proposal refuses them).
 *
 * Usage: node check-library.js <accession> [--type <datasetType>]
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { libraryProblems } from './lib/library-checks.js';
import { DATASET_TYPES } from './dataset-types/index.js';

const args = process.argv.slice(2);
const typeAt = args.indexOf('--type');
const type = typeAt >= 0 ? args[typeAt + 1] : undefined;
const accession = args.find((a, i) => !a.startsWith('--') && (typeAt < 0 || i !== typeAt + 1));
const usage = `Usage: node check-library.js <accession> [--type ${Object.keys(DATASET_TYPES).join('|')}]`;
if (!accession || (typeAt >= 0 && !DATASET_TYPES[type]?.libraryStrategies)) { console.error(usage); process.exit(1); }
const strategies = type ? DATASET_TYPES[type].libraryStrategies : undefined;
const path = resolve(`.curation/tmp/${accession}_sra_metadata.json`);
if (!existsSync(path)) { console.error(`Error: no ${path}; run fetch-sra-metadata.js ${accession} first`); process.exit(1); }
const { projectErrors, runErrors, warnings } = libraryProblems(JSON.parse(readFileSync(path, 'utf-8')).runs ?? [], { strategies });
for (const w of warnings) console.error(`Warning: ${w}`);
for (const e of projectErrors) console.error(`Error: ${e}`);
for (const e of runErrors) console.error(`Error: ${e} (drop this run from the sample annotations, or stop)`);
console.log(JSON.stringify({ projectErrors, runErrors, warnings }, null, 2));
process.exit(projectErrors.length ? 1 : runErrors.length ? 3 : 0);
