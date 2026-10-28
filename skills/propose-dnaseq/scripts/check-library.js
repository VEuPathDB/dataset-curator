#!/usr/bin/env node
/**
 * check-library.js - Checks that a proposal's SRA runs are DNA sequencing with reads.
 * Reads .curation/tmp/<accession>_sra_metadata.json and checks every run.
 * Exits 0 when clean; 1 on a project-level stop (or bad usage); 3 when only some
 * runs fail, which the sample annotations must leave out (write-proposal refuses them).
 *
 * Usage: node check-library.js <accession>
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { libraryProblems } from './lib/library-checks.js';

const [accession] = process.argv.slice(2);
if (!accession) { console.error('Usage: node check-library.js <accession>'); process.exit(1); }
const path = resolve(`.curation/tmp/${accession}_sra_metadata.json`);
if (!existsSync(path)) { console.error(`Error: no ${path}; run fetch-sra-metadata.js ${accession} first`); process.exit(1); }
const { projectErrors, runErrors, warnings } = libraryProblems(JSON.parse(readFileSync(path, 'utf-8')).runs ?? []);
for (const w of warnings) console.error(`Warning: ${w}`);
for (const e of projectErrors) console.error(`Error: ${e}`);
for (const e of runErrors) console.error(`Error: ${e} (drop this run from the sample annotations, or stop)`);
console.log(JSON.stringify({ projectErrors, runErrors, warnings }, null, 2));
process.exit(projectErrors.length ? 1 : runErrors.length ? 3 : 0);
