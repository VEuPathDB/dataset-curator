#!/usr/bin/env node
/**
 * fetch-sra-metadata.js - Fetches and merges SRA run metadata with BioSample attributes
 *
 * Usage: node fetch-sra-metadata.js <accession> [--no-geo]
 *
 * The accession is the proposal's: a BioProject, or a GSE whose BioProject
 * resolve-accessions.js recorded in .curation/tmp/<accession>_xref.json.
 *
 * This script:
 * 1. Queries ENA Portal API for run-level metadata
 * 2. Extracts unique sample accessions (SAMN...)
 * 3. Queries NCBI BioSample API for custom attributes (batched)
 * 4. Merges run data with sample attributes
 * 5. Writes combined JSON to .curation/tmp/
 * 6. Compares the runs' GSM sample aliases with the GEO series, when there is one
 *
 * Falls back to manual CSV if API fetching fails.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { parseCsv, csvToRuns } from './lib/sra-runinfo.js';

const ENA_PORTAL_API = 'https://www.ebi.ac.uk/ena/portal/api/search';
const NCBI_EFETCH = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi';

// ENA fields to request
const ENA_FIELDS = [
  'run_accession',
  'sample_accession',
  'sample_alias',
  'sample_title',
  'experiment_accession',
  'experiment_title',
  'library_name',
  'submission_accession',
  'first_public',
  'library_layout',
  'library_strategy',
  'library_source',
  'library_selection',
  'instrument_platform',
  'instrument_model',
  'read_count',
  'base_count',
  'scientific_name',
  'tax_id'
].join(',');

/**
 * Fetch JSON from ENA Portal API
 */
async function fetchEnaRuns(bioproject) {
  const url = `${ENA_PORTAL_API}?result=read_run&query=study_accession=${bioproject}&fields=${ENA_FIELDS}&format=json`;

  console.error(`  Querying ENA Portal API...`);
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`ENA API error: HTTP ${response.status}`);
  }

  const data = await response.json();

  if (!Array.isArray(data) || data.length === 0) {
    throw new Error(`No runs found in ENA for BioProject: ${bioproject}`);
  }

  console.error(`  Found ${data.length} runs`);
  return data;
}

/**
 * Parse BioSample XML and extract attributes
 */
function parseBioSampleXml(xml) {
  const samples = {};

  // Match each BioSample element
  const sampleRegex = /<BioSample[^>]*accession="([^"]+)"[^>]*>([\s\S]*?)<\/BioSample>/g;
  let match;

  while ((match = sampleRegex.exec(xml)) !== null) {
    const accession = match[1];
    const content = match[2];

    const attributes = {};

    // Extract attributes
    const attrRegex = /<Attribute[^>]*attribute_name="([^"]+)"[^>]*>([^<]*)<\/Attribute>/g;
    let attrMatch;

    while ((attrMatch = attrRegex.exec(content)) !== null) {
      const name = attrMatch[1].toLowerCase().replace(/\s+/g, '_');
      const value = attrMatch[2].trim();
      if (value) {
        attributes[name] = value;
      }
    }

    samples[accession] = attributes;
  }

  return samples;
}

/**
 * Fetch BioSample attributes from NCBI (batched)
 */
async function fetchBioSampleAttributes(sampleAccessions) {
  const allAttributes = {};
  const batchSize = 100;

  console.error(`  Fetching BioSample attributes for ${sampleAccessions.length} samples...`);

  for (let i = 0; i < sampleAccessions.length; i += batchSize) {
    const batch = sampleAccessions.slice(i, i + batchSize);
    const ids = batch.join(',');

    const url = `${NCBI_EFETCH}?db=biosample&id=${ids}&retmode=xml`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        console.error(`    Warning: BioSample batch ${i / batchSize + 1} failed: HTTP ${response.status}`);
        continue;
      }

      const xml = await response.text();
      const batchAttributes = parseBioSampleXml(xml);
      Object.assign(allAttributes, batchAttributes);

      console.error(`    Fetched batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(sampleAccessions.length / batchSize)}`);

      // Rate limiting - be nice to NCBI
      if (i + batchSize < sampleAccessions.length) {
        await new Promise(resolve => setTimeout(resolve, 350));
      }
    } catch (err) {
      console.error(`    Warning: BioSample batch ${i / batchSize + 1} failed: ${err.message}`);
    }
  }

  return allAttributes;
}

function readXref(accession) {
  const path = resolve(`.curation/tmp/${accession}_xref.json`);
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf-8')) : null;
}

/** GEO samples missing from SRA, and SRA GSM aliases missing from GEO. */
function geoCrossCheck(runs, gse) {
  const path = resolve(`.curation/tmp/${gse}_family.xml`);
  if (!existsSync(path)) return { gse, error: `${gse}_family.xml is missing; re-run resolve-accessions.js` };
  const inGeo = new Set([...readFileSync(path, 'utf-8').matchAll(/<Sample iid="(GSM\d+)"/g)].map((m) => m[1]));
  const inSra = new Set(runs.map((r) => r.sample_alias).filter((a) => /^GSM\d+$/.test(a)));
  return {
    gse,
    geoSamples: inGeo.size,
    sraSamplesWithGsm: inSra.size,
    missingFromSra: [...inGeo].filter((g) => !inSra.has(g)).sort(),
    missingFromGeo: [...inSra].filter((g) => !inGeo.has(g)).sort()
  };
}

/**
 * Try to load manual CSV fallback
 */
function tryLoadManualCsv(bioproject) {
  const paths = [
    resolve(`.curation/tmp/${bioproject}_SraRunTable.csv`),
    resolve('.curation/tmp/SraRunTable.csv')
  ];

  for (const csvPath of paths) {
    if (existsSync(csvPath)) {
      console.error(`  Found manual CSV: ${csvPath}`);
      const content = readFileSync(csvPath, 'utf-8');
      const rows = parseCsv(content);
      console.error(`  Parsed ${rows.length} rows from CSV`);
      return csvToRuns(rows);
    }
  }

  return null;
}

async function main() {
  const args = process.argv.slice(2);
  const noGeo = args.includes('--no-geo');
  const accession = args.find((a) => !a.startsWith('--'));

  if (!accession) {
    console.error('Usage: node fetch-sra-metadata.js <accession> [--no-geo]');
    console.error('');
    console.error('Arguments:');
    console.error('  accession - BioProject (e.g., PRJNA1018599), or a GSE already resolved by resolve-accessions.js');
    console.error('  --no-geo  - skip the GEO cross-check warning (datasets with no GEO series)');
    console.error('');
    console.error('Example:');
    console.error('  node fetch-sra-metadata.js PRJNA1018599');
    console.error('');
    console.error('Output: .curation/tmp/<bioproject>_sra_metadata.json');
    console.error('');
    console.error('Fallback: If API fails, place SraRunTable.csv in .curation/tmp/ directory');
    process.exit(1);
  }

  const xref = readXref(accession);
  if (/^GSE\d+$/.test(accession) && !xref) {
    console.error(`Error: no .curation/tmp/${accession}_xref.json; run: node scripts/resolve-accessions.js ${accession}`);
    process.exit(1);
  }
  const bioproject = xref?.externalIds?.bioproject ?? accession;

  if (!/^PRJ[A-Z]{1,2}\d+$/.test(bioproject)) {
    console.error(`Error: Invalid BioProject accession format: ${bioproject}`);
    console.error('Expected format: PRJNA123456, PRJEA123456, PRJDA123456, etc.');
    process.exit(1);
  }

  console.error(`Fetching SRA metadata for: ${bioproject}`);

  let runs;
  let source = 'ENA+BioSample';

  try {
    // Step 1: Fetch runs from ENA
    runs = await fetchEnaRuns(bioproject);

    // Step 2: Extract unique sample accessions
    const sampleAccessions = [...new Set(runs.map(r => r.sample_accession).filter(Boolean))];

    // Step 3: Fetch BioSample attributes
    const sampleAttributes = await fetchBioSampleAttributes(sampleAccessions);

    // Step 4: Merge attributes into runs
    for (const run of runs) {
      if (run.sample_accession && sampleAttributes[run.sample_accession]) {
        run.sample_attributes = sampleAttributes[run.sample_accession];
      }
    }

  } catch (err) {
    console.error(`  API fetch failed: ${err.message}`);
    console.error('  Checking for manual CSV fallback...');

    runs = tryLoadManualCsv(bioproject);

    if (!runs) {
      console.error('');
      console.error('No data available. To use manual fallback:');
      console.error(`  1. Go to: https://www.ncbi.nlm.nih.gov/Traces/study/?acc=${bioproject}`);
      console.error('  2. Click "Metadata" button to download SraRunTable.csv');
      console.error(`  3. Save as: .curation/tmp/${bioproject}_SraRunTable.csv`);
      console.error('  4. Re-run this script');
      process.exit(1);
    }

    source = 'manual_csv';
  }

  // Build output
  const gse = xref?.externalIds?.geo;
  const output = {
    accession,
    bioproject: bioproject,
    ...(gse ? { geoCrossCheck: geoCrossCheck(runs, gse) } : {}),
    fetchDate: new Date().toISOString(),
    source: source,
    runCount: runs.length,
    runs: runs
  };

  // Save to file
  const outputPath = resolve(`.curation/tmp/${accession}_sra_metadata.json`);
  writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.error(`  Saved to: ${outputPath}`);

  // Summary
  console.error('');
  console.error(`Summary:`);
  console.error(`  Runs: ${runs.length}`);
  console.error(`  Unique samples: ${new Set(runs.map(r => r.sample_accession)).size}`);

  const withAttrs = runs.filter(r => r.sample_attributes && Object.keys(r.sample_attributes).length > 0).length;
  console.error(`  Runs with custom attributes: ${withAttrs}`);
  if (!xref && !noGeo) console.error(`  Warning: no ${accession}_xref.json, so GEO was not cross-checked; run resolve-accessions.js first`);
  const check = output.geoCrossCheck;
  if (check?.error) console.error(`  Warning: ${check.error}`);
  else if (check) {
    console.error(`  GEO ${check.gse}: ${check.geoSamples} samples; SRA runs carry ${check.sraSamplesWithGsm} GSM aliases`);
    if (check.missingFromSra.length) console.error(`  Warning: GEO samples with no SRA run: ${check.missingFromSra.join(', ')}`);
    if (check.missingFromGeo.length) console.error(`  Warning: SRA GSM aliases not in ${check.gse}: ${check.missingFromGeo.join(', ')}`);
  }

  // Also output to stdout
  console.log(JSON.stringify(output, null, 2));
}

main().catch(err => { console.error(`Error: ${err.message}`); process.exit(1); });
