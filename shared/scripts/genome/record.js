import { readFileSync } from 'node:fs';

/** The contract of build.json and genome-build.json; bump SCHEMA_VERSION when either changes shape. */
export const SCHEMA_VERSION = 1;
export const SOURCE = 'ncbi';
export const GENERATOR = Object.freeze({
  name: 'dataset-curator genome-pipeline',
  version: JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf-8')).version
});

export const recordHeader = () => ({ schemaVersion: SCHEMA_VERSION, generator: { ...GENERATOR }, source: SOURCE });

/** File names in each build/<partition>/ directory, keyed as in a partition's `buildFiles`. */
export const BUILD_FILES = Object.freeze({ gff3: 'genome.gff3', fasta: 'genome.fasta', chromosomeMap: 'chromosomeMap.txt' });

/** File names finalize writes into each final/<partition>/ directory, keyed as in a partition's `final`. */
export const FINAL_FILES = Object.freeze({ gff: 'genome.gff', fasta: 'genome.fasta', chromosomeMap: 'chromosomeMap.txt' });
