#!/usr/bin/env node
/**
 * check-library.js - Checks that a proposal's SRA runs are DNA sequencing with reads.
 * Reads .curation/tmp/<accession>_sra_metadata.json; exits 1 on any hard stop.
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
const { errors, warnings } = libraryProblems(JSON.parse(readFileSync(path, 'utf-8')).runs ?? []);
for (const w of warnings) console.error(`Warning: ${w}`);
for (const e of errors) console.error(`Error: ${e}`);
console.log(JSON.stringify({ errors, warnings }, null, 2));
process.exit(errors.length ? 1 : 0);
