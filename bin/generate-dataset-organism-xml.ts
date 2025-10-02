import { readFileSync } from 'fs';
import { resolve } from 'path';
import Handlebars from 'handlebars';

// Valid VEuPathDB project IDs
const VALID_PROJECT_IDS = [
  'AmoebaDB',
  'CryptoDB',
  'FungiDB',
  'GiardiaDB',
  'HostDB',
  'MicrosporidiaDB',
  'PiroplasmaDB',
  'PlasmoDB',
  'SchistoDB',
  'ToxoDB',
  'TrichDB',
  'TriTrypDB',
  'VectorBase',
];

// Get command line arguments
const args = process.argv.slice(2);
if (args.length < 3) {
  console.error('Usage: npx tsx bin/generate-dataset-organism-xml.ts <genbank_accession> <project_id> <is_reference_strain>');
  console.error('');
  console.error('Arguments:');
  console.error('  genbank_accession    - GenBank assembly accession (e.g., GCA_000988875.2)');
  console.error('  project_id           - VEuPathDB project (e.g., FungiDB, PlasmoDB, ToxoDB)');
  console.error('  is_reference_strain  - true or false');
  console.error('');
  console.error('Example:');
  console.error('  npx tsx bin/generate-dataset-organism-xml.ts GCA_000988875.2 FungiDB true');
  process.exit(1);
}

const genbankAccession = args[0];
const projectId = args[1];
const isReferenceStrain = args[2];

// Check for typos in PROJECT_ID and suggest corrections
if (!VALID_PROJECT_IDS.includes(projectId)) {
  // Try to find a close match (case-insensitive)
  const projectIdLower = projectId.toLowerCase();
  const match = VALID_PROJECT_IDS.find(id => id.toLowerCase() === projectIdLower);

  if (match) {
    console.error(`Error: PROJECT_ID "${projectId}" appears to be a typo. Did you mean "${match}"?`);
    process.exit(1);
  } else {
    console.error(`Error: PROJECT_ID "${projectId}" is not valid.`);
    console.error(`Valid PROJECT_IDs: ${VALID_PROJECT_IDS.join(', ')}`);
    process.exit(1);
  }
}

if (!['true', 'false'].includes(isReferenceStrain)) {
  console.error('Error: is_reference_strain argument must be "true" or "false"');
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

  // Boolean and conditional logic
  isReferenceStrain,
  referenceStrainOrganismAbbrev: isReferenceStrain === 'true' ? organismAbbrev : 'TODO',
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
