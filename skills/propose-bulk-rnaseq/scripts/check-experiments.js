#!/usr/bin/env node
/**
 * check-experiments.js - Flags BioSamples whose runs span SRA experiments that differ in
 * title, library name, submission or release date (e.g. an isolate and later generations).
 * Reads .curation/tmp/<accession>_sra_metadata.json. Tables and warnings go to stderr, the
 * flagged BioSamples as JSON to stdout. Report-only: exits 0 whether or not anything is flagged;
 * 1 on bad usage, a missing metadata file or metadata that lacks experiment accessions.
 *
 * Usage: node check-experiments.js <accession>
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { mixedBioSamples } from './dataset-types/_sra-samples.js';

const FIELDS = ['experiment_title', 'library_name', 'submission_accession', 'first_public'];

function table(rows) {
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  return rows.map((r) => r.map((c, i) => c.padEnd(widths[i])).join('  ').trimEnd()).join('\n');
}

const [accession] = process.argv.slice(2);
if (!accession) { console.error('Usage: node check-experiments.js <accession>'); process.exit(1); }
const path = resolve(`.curation/tmp/${accession}_sra_metadata.json`);
if (!existsSync(path)) { console.error(`Error: no ${path}; run fetch-sra-metadata.js ${accession} first`); process.exit(1); }
const metadata = JSON.parse(readFileSync(path, 'utf-8'));
let flagged;
try {
  flagged = mixedBioSamples(metadata.runs ?? []);
} catch (e) {
  console.error(`Error: ${e.message}`);
  process.exit(1);
}
if (metadata.source === 'manual_csv') {
  console.error("Warning: experiment titles aren't available from SRA runinfo, so only library name, submission and release date were compared");
}
if (!flagged.length) console.error('No BioSample spans differing SRA experiments');
for (const { biosample, experiments, differing } of flagged) {
  const header = ['SRX', 'runs', ...FIELDS.map((f) => (differing.includes(f) ? `${f}*` : f))];
  const rows = experiments.map((e) => [e.experiment, e.runs.join(','), ...FIELDS.map((f) => e[f])]);
  console.error(`\n${biosample} spans ${experiments.length} experiments (* = differs)\n${table([header, ...rows])}`);
}
console.log(JSON.stringify(flagged, null, 2));
