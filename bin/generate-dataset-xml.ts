#!/usr/bin/env node
import { readFileSync } from 'fs';
import { resolve } from 'path';
import Handlebars from 'handlebars';

// Get command line arguments
const args = process.argv.slice(2);
if (args.length < 1) {
  console.error('Usage: tsx bin/generate-dataset-xml.ts <genbank_accession>');
  console.error('');
  console.error('Required environment variables:');
  console.error('  PROJECT_ID - VEuPathDB project (e.g., FungiDB, VectorBase)');
  console.error('  IS_REFERENCE_STRAIN - yes or no');
  process.exit(1);
}

const genbankAccession = args[0];
const projectId = process.env.PROJECT_ID;
const isReferenceStrain = process.env.IS_REFERENCE_STRAIN;

// Validate environment variables
if (!projectId) {
  console.error('Error: PROJECT_ID environment variable is required');
  process.exit(1);
}
if (!isReferenceStrain || !['yes', 'no'].includes(isReferenceStrain)) {
  console.error('Error: IS_REFERENCE_STRAIN environment variable must be "yes" or "no"');
  process.exit(1);
}

// Read NCBI dataset report
const jsonPath = resolve(`tmp/${genbankAccession}_dataset_report.json`);
let ncbiData: any;
try {
  ncbiData = JSON.parse(readFileSync(jsonPath, 'utf-8'));
} catch (error) {
  console.error(`Error reading ${jsonPath}:`, error);
  process.exit(1);
}

const report = ncbiData.reports[0];

// Extract and transform data for template
const templateData = {
  PROJECT_ID: projectId,

  // Direct mappings from NCBI data
  ncbiTaxonId: report.organism.tax_id,
  strainAbbrev: report.organism.infraspecific_names?.strain || '',
  genomeSource: report.source_database === 'SOURCE_DATABASE_GENBANK' ? 'GenBank' : 'RefSeq',
  genomeVersion: report.assembly_info.release_date,

  // Construct organism full name (organism name + strain)
  organismFullName: report.organism.infraspecific_names?.strain
    ? `${report.organism.organism_name} ${report.organism.infraspecific_names.strain}`
    : report.organism.organism_name,

  // Boolean conversion
  isReferenceStrain: isReferenceStrain === 'yes' ? 'true' : 'false',
};

// Load and compile template
const templatePath = resolve('lib/templates/dataset-organism.xml');
let templateSource: string;
try {
  templateSource = readFileSync(templatePath, 'utf-8');
} catch (error) {
  console.error(`Error reading ${templatePath}:`, error);
  process.exit(1);
}

const template = Handlebars.compile(templateSource);

// Generate XML
const xml = template(templateData);
console.log(xml);
