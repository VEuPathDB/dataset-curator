#!/usr/bin/env node
/**
 * generate-organism-xml.js - Generates organism dataset XML from NCBI data
 *
 * Usage: node generate-organism-xml.js <genbank_accession> <project_id> <is_reference_strain>
 *
 * This script reads NCBI dataset metadata and generates VEuPathDB organism XML configuration.
 * All templates are inlined - no external dependencies required.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

// Load valid project IDs from resources
const validProjectsPath = new URL('../resources/valid-projects.json', import.meta.url);
const VALID_PROJECT_IDS = JSON.parse(readFileSync(validProjectsPath, 'utf-8'));

/**
 * Template function for generating organism dataset XML
 * Inlined template - no external template files or libraries needed
 */
function generateOrganismXML(data) {
  const referenceStrainDataset = data.isReferenceStrain === 'true' ? `
  <dataset class="referenceStrain">
    <!-- Same as organism dataset organismAbbrev -->
    <prop name="organismAbbrev">${data.organismAbbrev}</prop>

    <!-- Constant true for GenBank genomes -->
    <prop name="isAnnotatedGenome">true</prop>
  </dataset>` : '';

  return `  <dataset class="organism">
    <!-- Derived: first letter of genus + first three letters of species + strain (no special chars, max 30 chars) -->
    <prop name="organismAbbrev">${data.organismAbbrev}</prop>

    <!-- Will be replaced by downstream templating system -->
    <prop name="projectName">$$projectName$$</prop>

    <!-- From NCBI: reports[0].organism.tax_id (or generated temp ID starting with 9 if unavailable) -->
    <prop name="ncbiTaxonId">${data.ncbiTaxonId}</prop>

    <!-- Same as organismAbbrev -->
    <prop name="publicOrganismAbbrev">${data.organismAbbrev}</prop>

    <!-- From NCBI: reports[0].organism.organism_name + strain -->
    <prop name="organismFullName">${data.organismFullName}</prop>

    <!-- Derived: PascalCase genus + species + strain (no special chars) -->
    <prop name="organismNameForFiles">${data.organismNameForFiles}</prop>

    <!-- From NCBI: reports[0].organism.tax_id (species level) -->
    <prop name="speciesNcbiTaxonId">${data.ncbiTaxonId}</prop>

    <!-- From IS_REFERENCE_STRAIN environment variable -->
    <prop name="isReferenceStrain">${data.isReferenceStrain}</prop>

    <!-- Same as organismAbbrev if isReferenceStrain=true, otherwise must look up reference strain -->
    <prop name="referenceStrainOrganismAbbrev">${data.referenceStrainOrganismAbbrev}</prop>

    <!-- Constant true for GenBank genomes -->
    <prop name="isAnnotatedGenome">true</prop>

    <!-- Constant false for NCBI genomes (true only for non-NCBI bespoke genomes) -->
    <prop name="hasTemporaryNcbiTaxonId">false</prop>

    <!-- Derived: 4-letter code (first letter genus + first 3 letters species) -->
    <prop name="orthomclAbbrev">${data.orthomclAbbrev}</prop>

    <!-- TODO: Curator must determine if this is a "core" organism for the project -->
    <prop name="isCore">TODO</prop>

    <!-- From NCBI: reports[0].organism.infraspecific_names.strain (special chars removed) -->
    <prop name="strainAbbrev">${data.strainAbbrev}</prop>

    <!-- From NCBI: reports[0].source_database (GenBank or RefSeq) -->
    <prop name="genomeSource">${data.genomeSource}</prop>

    <!-- Derived: Genus name from organism_name -->
    <prop name="taxonFilterForNRProteinsAlignedToGenome">${data.taxonFilterForNRProteinsAlignedToGenome}</prop>

    <!-- TODO: Curator must determine if genome is available in EBI/ENA -->
    <prop name="isNotEbiGenome">TODO</prop>

    <!-- From NCBI: true if annotation includes tRNA genes (from annotation_info.stats) -->
    <prop name="annotationIncludesTRNAs">${data.annotationIncludesTRNAs}</prop>

    <!-- TODO: Determine if ExportPred should be run for this organism -->
    <prop name="runExportPred">TODO</prop>

    <!-- TODO: Determine if genome is considered "huge" (threshold definition needed) -->
    <prop name="isHugeGenome">TODO</prop>

    <!-- TODO: Set appropriate maximum intron size for this organism (kingdom/phylum-specific?) -->
    <prop name="maxIntronSize">TODO</prop>

    <!-- From NCBI: reports[0].assembly_info.release_date -->
    <prop name="genomeVersion">${data.genomeVersion}</prop>

    <!-- TODO: Determine if this is the representative for its family -->
    <prop name="isFamilyRepresentative">TODO</prop>

    <!-- TODO: Organism abbreviation of the family representative -->
    <prop name="familyRepOrganismAbbrev">TODO</prop>

    <!-- TODO: NCBI taxon ID(s) for the family -->
    <prop name="familyNcbiTaxonIds">TODO</prop>

    <!-- TODO: Human-readable family name for file naming -->
    <prop name="familyNameForFiles">TODO</prop>
  </dataset>
${referenceStrainDataset}
`;
}

/**
 * Helper function to remove special characters
 */
function removeSpecialChars(str) {
  return str.replace(/[^a-zA-Z0-9]/g, '');
}

// Main script logic
function main() {
  // Get command line arguments
  const args = process.argv.slice(2);
  if (args.length < 3) {
    console.error('Usage: node generate-organism-xml.js <genbank_accession> <project_id> <is_reference_strain>');
    console.error('');
    console.error('Arguments:');
    console.error('  genbank_accession    - GenBank assembly accession (e.g., GCA_000988875.2)');
    console.error('  project_id           - VEuPathDB project (e.g., FungiDB, PlasmoDB, ToxoDB)');
    console.error('  is_reference_strain  - true or false');
    console.error('');
    console.error('Example:');
    console.error('  node generate-organism-xml.js GCA_000988875.2 FungiDB true');
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
  let ncbiData;
  try {
    ncbiData = JSON.parse(readFileSync(jsonPath, 'utf-8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.error(`Error: Could not find ${jsonPath}`);
      console.error('');
      console.error('This script expects to be run from your working directory (where veupathdb-repos/ lives).');
      console.error('Make sure you have run Step 1 to fetch the NCBI metadata first.');
      process.exit(1);
    }
    console.error(`Error reading ${jsonPath}:`, error.message);
    process.exit(1);
  }

  const report = ncbiData.reports[0];

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

  // Generate and output XML
  const xml = generateOrganismXML(templateData);
  console.log(xml);
}

main();
