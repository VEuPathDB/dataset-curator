#!/usr/bin/env node
/**
 * generate-samplesheet.js - Generates samplesheet.csv for nf-core/rnaseq pipeline
 *
 * Usage: node generate-samplesheet.js <bioproject>
 *
 * This script reads SRA metadata and sample annotations to generate
 * a samplesheet.csv compatible with nf-core/rnaseq pipeline.
 *
 * Reads from:
 *   tmp/<bioproject>_sra_metadata.json
 *   tmp/<bioproject>_sample_annotations.json (Claude-generated)
 *
 * Writes to:
 *   delivery/bulk-rnaseq/<bioproject>/samplesheet.csv
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';

/**
 * Determine strandedness from library info
 * Returns: 'unstranded', 'forward', or 'reverse'
 */
function inferStrandedness(runs) {
  // For now, default to unstranded - curator should verify
  // Could be enhanced to detect from library protocol
  return 'auto';
}

function main() {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.error('Usage: node generate-samplesheet.js <bioproject>');
    console.error('');
    console.error('Arguments:');
    console.error('  bioproject - BioProject accession (e.g., PRJNA1018599)');
    console.error('');
    console.error('Reads from:');
    console.error('  tmp/<bioproject>_sra_metadata.json');
    console.error('  tmp/<bioproject>_sample_annotations.json');
    console.error('');
    console.error('Writes to:');
    console.error('  delivery/bulk-rnaseq/<bioproject>/samplesheet.csv');
    process.exit(1);
  }

  const bioproject = args[0];

  // Read SRA metadata
  const sraPath = resolve(`tmp/${bioproject}_sra_metadata.json`);
  if (!existsSync(sraPath)) {
    console.error(`Error: SRA metadata not found at ${sraPath}`);
    console.error('Run fetch-sra-metadata.js first.');
    process.exit(1);
  }

  const sraMetadata = JSON.parse(readFileSync(sraPath, 'utf-8'));
  const runs = sraMetadata.runs || [];

  // Try to read sample annotations (Claude-generated)
  const annotationsPath = resolve(`tmp/${bioproject}_sample_annotations.json`);
  let sampleAnnotations = null;
  let sampleToIdMap = new Map();

  if (existsSync(annotationsPath)) {
    sampleAnnotations = JSON.parse(readFileSync(annotationsPath, 'utf-8'));
    console.error(`  Using sample annotations from: ${annotationsPath}`);

    // Build mapping from run accession to sample ID
    for (const sample of (sampleAnnotations.samples || [])) {
      for (const runAcc of (sample.runs || [])) {
        sampleToIdMap.set(runAcc, sample.sampleId);
      }
    }
  } else {
    console.error(`  Warning: Sample annotations not found at ${annotationsPath}`);
    console.error('  Using sample accessions as sample IDs...');
  }

  // Determine strandedness
  const strandedness = inferStrandedness(runs);

  // Generate samplesheet rows
  // Format: sample,fastq_1,fastq_2,strandedness
  // For SRA data, we just use the run accession and let nf-core fetch
  const rows = [];

  for (const run of runs) {
    const runAcc = run.run_accession;
    const sampleId = sampleToIdMap.get(runAcc) || run.sample_accession || run.sample_alias || runAcc;

    // For paired-end, fastq_2 would be populated; for single-end, leave empty
    const isPaired = (run.library_layout || '').toUpperCase() === 'PAIRED';

    rows.push({
      sample: sampleId,
      fastq_1: runAcc,
      fastq_2: isPaired ? runAcc : '',
      strandedness: strandedness
    });
  }

  // Sort by sample ID for readability
  rows.sort((a, b) => a.sample.localeCompare(b.sample));

  // Generate CSV content
  const header = 'sample,fastq_1,fastq_2,strandedness';
  const csvRows = rows.map(r => `${r.sample},${r.fastq_1},${r.fastq_2},${r.strandedness}`);
  const csvContent = [header, ...csvRows].join('\n') + '\n';

  // Ensure output directory exists
  const outputDir = resolve(`delivery/bulk-rnaseq/${bioproject}`);
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
    console.error(`  Created directory: ${outputDir}`);
  }

  // Write samplesheet
  const outputPath = resolve(outputDir, 'samplesheet.csv');
  writeFileSync(outputPath, csvContent);

  console.error('');
  console.error('Generated samplesheet.csv:');
  console.error(`  Output: ${outputPath}`);
  console.error(`  Total runs: ${rows.length}`);
  console.error(`  Unique samples: ${new Set(rows.map(r => r.sample)).size}`);
  console.error(`  Strandedness: ${strandedness}`);

  // Summary of paired vs single-end
  const pairedCount = rows.filter(r => r.fastq_2).length;
  const singleCount = rows.length - pairedCount;
  console.error(`  Paired-end runs: ${pairedCount}`);
  console.error(`  Single-end runs: ${singleCount}`);

  // Also print to stdout
  console.log(csvContent);
}

main();
