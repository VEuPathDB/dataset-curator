#!/usr/bin/env node
/**
 * fetch-taxonomy.js - Fetches the NCBI Taxonomy report for a taxon
 *
 * Usage: node fetch-taxonomy.js <ncbi_taxon_id>
 *
 * Saves the NCBI Datasets taxonomy report (rank, scientific name, species and
 * full lineage) to .curation/tmp/<ncbi_taxon_id>_taxonomy.json.
 */

import { writeFileSync } from 'fs';
import { resolve } from 'path';

const TAXONOMY_URL = 'https://api.ncbi.nlm.nih.gov/datasets/v2/taxonomy/taxon';

async function main() {
  const [taxId] = process.argv.slice(2);
  if (!/^\d+$/.test(taxId ?? '')) {
    console.error('Usage: node fetch-taxonomy.js <ncbi_taxon_id>');
    process.exit(1);
  }
  try {
    const response = await fetch(`${TAXONOMY_URL}/${taxId}/dataset_report`, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    const report = await response.json();
    const taxonomy = report.reports?.[0]?.taxonomy;
    if (!taxonomy?.tax_id) throw new Error(`NCBI returned no taxonomy for taxon ${taxId}`);

    const outputPath = resolve(`.curation/tmp/${taxId}_taxonomy.json`);
    writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n');
    console.log(`${taxonomy.current_scientific_name?.name} (${taxonomy.rank}), species ${taxonomy.classification?.species?.id ?? 'none'}`);
    console.log(`Saved to: ${outputPath}`);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

main();
