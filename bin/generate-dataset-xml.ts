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

// Helper function to remove special characters
function removeSpecialChars(str: string): string {
  return str.replace(/[^a-zA-Z0-9]/g, '');
}

// Parse organism name into parts
const organismName = report.organism.organism_name;
const strain = report.organism.infraspecific_names?.strain || '';
const nameParts = organismName.split(' ');
const genus = nameParts[0] || '';
const species = nameParts.slice(1).join(' ') || '';

// Derive organismAbbrev: first letter of genus + first 3 letters of species + strain (no special chars, max 30)
const genusPrefix = genus.charAt(0).toLowerCase();
const speciesPrefix = species.substring(0, 3).toLowerCase();
const strainSuffix = removeSpecialChars(strain);
const organismAbbrev = (genusPrefix + speciesPrefix + strainSuffix).substring(0, 30);

// Derive organismNameForFiles: PascalCase genus + species + strain (no special chars)
const genusPascal = genus.charAt(0).toUpperCase() + genus.slice(1).toLowerCase();
const speciesPascal = species.replace(/\s+/g, '');
const strainPascal = removeSpecialChars(strain);
const organismNameForFiles = genusPascal + speciesPascal + strainPascal;

// Derive orthomclAbbrev: first letter genus + first 3 letters species (lowercase, 4 chars)
const orthomclAbbrev = (genusPrefix + speciesPrefix).substring(0, 4);

// Check for tRNA in annotation stats (look for non_coding or specific tRNA counts)
let annotationIncludesTRNAs = 'false';
if (report.annotation_info?.stats?.gene_counts) {
  const geneCounts = report.annotation_info.stats.gene_counts;
  // If there are non_coding genes, likely includes tRNAs
  if (geneCounts.non_coding && geneCounts.non_coding > 0) {
    annotationIncludesTRNAs = 'true';
  }
}

// Extract and transform data for template
const templateData = {
  PROJECT_ID: projectId,

  // Derived fields
  organismAbbrev,
  organismNameForFiles,
  orthomclAbbrev,
  taxonFilterForNRProteinsAlignedToGenome: genus,

  // Direct mappings from NCBI data
  ncbiTaxonId: report.organism.tax_id,
  strainAbbrev: removeSpecialChars(strain),
  genomeSource: report.source_database === 'SOURCE_DATABASE_GENBANK' ? 'GenBank' : 'RefSeq',
  genomeVersion: report.assembly_info.release_date,

  // Construct organism full name (organism name + strain)
  organismFullName: strain ? `${organismName} ${strain}` : organismName,

  // Annotation info
  annotationIncludesTRNAs,

  // Boolean conversion and conditional logic
  isReferenceStrain: isReferenceStrain === 'yes' ? 'true' : 'false',
  referenceStrainOrganismAbbrev: isReferenceStrain === 'yes' ? organismAbbrev : 'TODO',
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
