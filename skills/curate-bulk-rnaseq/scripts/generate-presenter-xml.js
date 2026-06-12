#!/usr/bin/env node
/**
 * generate-presenter-xml.js - Generates RNA-seq datasetPresenter XML
 *
 * Usage: node generate-presenter-xml.js <bioproject> <project_id> <primary_contact_id> [additional_contact_ids...]
 *
 * This script reads fetched SRA metadata and optionally MINiML data to generate
 * VEuPathDB datasetPresenter XML for RNA-seq datasets.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { resolve } from 'path';
import {
  generateOrganismAbbrev,
  lookupOrganism,
  promptOrganismName,
  promptConfirm,
  promptCustomAbbrev
} from './organism-utils.js';

// Load valid project IDs from resources
const validProjectsPath = new URL('../resources/valid-projects.json', import.meta.url);
const VALID_PROJECT_IDS = JSON.parse(readFileSync(validProjectsPath, 'utf-8'));

/**
 * Remove special characters, keeping only alphanumeric
 */
function removeSpecialChars(str) {
  return str.replace(/[^a-zA-Z0-9]/g, '');
}

/**
 * Derive organismAbbrev from organism name
 * Format: first letter genus + first 3 letters species
 */
function deriveOrganismAbbrev(organismName) {
  const nameParts = organismName.trim().split(/\s+/);
  const genus = nameParts[0] || '';
  const species = nameParts[1] || '';

  const genusPrefix = genus.charAt(0).toLowerCase();
  const speciesPrefix = species.substring(0, 3).toLowerCase();

  return genusPrefix + speciesPrefix;
}

/**
 * Escape text for use in CDATA sections
 */
function escapeForCDATA(text) {
  return text.replace(/\]\]>/g, ']]&gt;');
}

/**
 * Determine if library is likely strand-specific based on library info
 */
function inferStrandSpecificity(runs) {
  // Common strand-specific library selections/protocols
  const strandSpecificSelections = [
    'polya', 'cdna_oligo_dt', 'cdna_randompriming'
  ];

  // Check library selection across runs
  const selections = runs.map(r => (r.library_selection || '').toLowerCase());
  const sources = runs.map(r => (r.library_source || '').toLowerCase());

  // Most modern RNA-seq is strand-specific, default to true
  // unless we see indicators it's not
  return true;
}

/**
 * Extract unique organism name from runs
 */
function getOrganismFromRuns(runs) {
  const organisms = [...new Set(runs.map(r => r.scientific_name).filter(Boolean))];
  return organisms[0] || 'Unknown organism';
}

/**
 * Try to find experiment description from various sources
 */
function findExperimentDescription(sraMetadata, minimlData) {
  // Try MINiML first (usually most descriptive)
  if (minimlData) {
    // Look for Series summary
    const summaryMatch = minimlData.match(/<Summary[^>]*>([\s\S]*?)<\/Summary>/i);
    if (summaryMatch) {
      return summaryMatch[1].trim();
    }
  }

  // Fall back to experiment titles from SRA
  const titles = [...new Set(sraMetadata.runs.map(r => r.experiment_title).filter(Boolean))];
  if (titles.length > 0) {
    return titles[0];
  }

  return 'TODO: Add description';
}

/**
 * Extract methodology info from metadata
 */
function extractMethodology(sraMetadata) {
  const runs = sraMetadata.runs;
  if (runs.length === 0) return '';

  const parts = [];

  // Library strategy
  const strategies = [...new Set(runs.map(r => r.library_strategy).filter(Boolean))];
  if (strategies.length > 0) {
    parts.push(`Library strategy: ${strategies.join(', ')}`);
  }

  // Library layout
  const layouts = [...new Set(runs.map(r => r.library_layout).filter(Boolean))];
  if (layouts.length > 0) {
    parts.push(`Layout: ${layouts.join(', ')}`);
  }

  // Instrument
  const instruments = [...new Set(runs.map(r => r.instrument_model).filter(Boolean))];
  if (instruments.length > 0) {
    parts.push(`Sequencing: ${instruments.join(', ')}`);
  }

  return parts.join('. ');
}

/**
 * Read publication data if available
 * @param {string} bioprojectAccession - BioProject accession
 * @returns {Object} Publication data or empty object
 */
function readPublicationData(bioprojectAccession) {
  const publicationPath = resolve(`tmp/${bioprojectAccession}_publications.json`);

  if (existsSync(publicationPath)) {
    try {
      const data = JSON.parse(readFileSync(publicationPath, 'utf8'));
      return data;
    } catch (error) {
      console.warn(`Could not read publication data: ${error.message}`);
    }
  }

  return { publications: [], pmidCount: 0 };
}

/**
 * Read BioProject metadata for submitter fallback information
 */
function readBioprojectData(bioproject) {
    const bioprojectPath = resolve(`tmp/${bioproject}_bioproject.json`);

    if (!existsSync(bioprojectPath)) {
        console.warn(`  BioProject metadata not found: ${bioprojectPath}`);
        return { submitterOrganization: 'Unknown', registrationDate: new Date().getFullYear().toString() };
    }

    try {
        const data = readFileSync(bioprojectPath, 'utf-8');
        return JSON.parse(data);
    } catch (error) {
        console.warn(`  Failed to read BioProject data: ${error.message}`);
        return { submitterOrganization: 'Unknown', registrationDate: new Date().getFullYear().toString() };
    }
}

/**
 * Interactive organism abbreviation lookup/generation
 */
async function getOrganismAbbreviation() {
    const csvPath = resolve('../../../shared/resources/organism-abbreviations.csv');

    // Get organism name from curator
    const organismName = await promptOrganismName();
    console.error(`  Looking up: ${organismName}`);

    // Try CSV lookup first
    const found = lookupOrganism(csvPath, organismName);

    if (found) {
        console.error(`  Found in database: ${found.abbrev}`);
        const useExisting = await promptConfirm(`Use '${found.abbrev}' as organism abbreviation?`);

        if (useExisting) {
            console.error(`  Using: ${found.abbrev}`);
            return found.abbrev;
        } else {
            const custom = await promptCustomAbbrev();
            console.error(`  Using custom: ${custom}`);
            return custom;
        }
    } else {
        // Generate new abbreviation
        console.error(`  Not found in database`);
        const generated = generateOrganismAbbrev(organismName);
        console.error(`  Generated: ${generated.organismAbbrev} (${generated.genus.charAt(0).toLowerCase()} + ${generated.species.substring(0,3)} + ${generated.strainAbbrev})`);

        const useGenerated = await promptConfirm(`Use '${generated.organismAbbrev}' as organism abbreviation?`);

        let finalAbbrev;
        if (useGenerated) {
            finalAbbrev = generated.organismAbbrev;
        } else {
            finalAbbrev = await promptCustomAbbrev();
        }

        console.error(`  Using: ${finalAbbrev}`);
        console.error('');
        console.error('ADD TO shared/resources/organism-abbreviations.csv:');
        console.error(`FungiDB,${organismName},${finalAbbrev},1,1,${generated.orthomclAbbrev}`);
        console.error('');

        return finalAbbrev;
    }
}

/**
 * Extract last name from author name
 */
function extractLastName(authorName) {
    if (!authorName || typeof authorName !== 'string') {
        return 'Unknown';
    }

    // Handle formats like "Smith J", "John Smith", "Smith, John", etc.
    const name = authorName.trim();

    // Split by comma first (for "Last, First" format)
    if (name.includes(',')) {
        return name.split(',')[0].trim();
    }

    // Split by space and take first word (assumes "LastName FirstInitial" format)
    const parts = name.split(/\s+/);

    // If only one word, return it
    if (parts.length === 1) {
        return parts[0];
    }

    // For multiple parts, check if last part looks like initials (1-2 chars, possibly with periods)
    const lastPart = parts[parts.length - 1];
    const isInitial = lastPart.length <= 2 || /^[A-Z]{1,2}\.?$/.test(lastPart);

    if (isInitial) {
        // "Smith J" or "Smith JD" format - return first part as last name
        return parts[0];
    } else {
        // "John Smith" format - return last part as last name
        return lastPart;
    }
}

/**
 * Extract year from date string
 */
function extractYear(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') {
        return new Date().getFullYear().toString();
    }

    // Try to extract 4-digit year
    const yearMatch = dateStr.match(/(\d{4})/);
    return yearMatch ? yearMatch[1] : new Date().getFullYear().toString();
}

/**
 * Clean submitter organization name for use in presenter name
 */
function cleanSubmitterName(submitterOrg) {
    if (!submitterOrg || typeof submitterOrg !== 'string') {
        return 'Unknown';
    }

    // Remove common organizational terms and clean for use in identifier
    let cleaned = submitterOrg
        .replace(/university/gi, 'U')
        .replace(/college/gi, 'C')
        .replace(/institute/gi, 'I')
        .replace(/laboratory/gi, 'Lab')
        .replace(/department/gi, 'Dept')
        .replace(/of /gi, '')
        .replace(/the /gi, '')
        .replace(/[^a-zA-Z0-9]/g, ''); // Remove special characters

    // Take first 10 characters to keep names reasonable
    return cleaned.substring(0, 10) || 'Unknown';
}

/**
 * Generate the RNA-seq datasetPresenter XML
 */
function generatePresenterXML(data) {
  const {
    presenterName,
    projectId,
    organismName,
    description,
    methodology,
    primaryContactId,
    additionalContactIds,
    bioproject,
    pubmedIds,
    runCount,
    sampleCount,
    isStrandSpecific,
    hasMultipleSamples
  } = data;

  // Format organism name for display
  const organismDisplay = `<i>${organismName}</i>`;

  // Generate contact elements
  const contactElements = additionalContactIds
    .map(id => `    <contactId>${id}</contactId>`)
    .join('\n');

  // Generate pubmed elements
  const pubmedElements = pubmedIds
    .map(id => `    <pubmedId>${id}</pubmedId>`)
    .join('\n');

  return `  <datasetPresenter name="${presenterName}"
                    projectName="${projectId}">
    <displayName><![CDATA[RNA-Seq analysis of ${organismDisplay}]]></displayName>
    <shortDisplayName>TODO: Short name</shortDisplayName>
    <shortAttribution>TODO: Author et al.</shortAttribution>
    <summary><![CDATA[RNA-Seq analysis of ${organismDisplay}]]></summary>
    <description><![CDATA[

<b>General Description:</b> ${escapeForCDATA(description)}
<br><br><b>Methodology used:</b> ${escapeForCDATA(methodology)}

                  ]]></description>
    <protocol></protocol>
    <caveat></caveat>
    <acknowledgement></acknowledgement>
    <releasePolicy></releasePolicy>
    <history buildNumber="TODO"/>
    <primaryContactId>${primaryContactId}</primaryContactId>
${contactElements ? contactElements + '\n' : ''}    <link>
      <text>NCBI Bioproject</text>
      <url>https://www.ncbi.nlm.nih.gov/bioproject/${bioproject}</url>
    </link>
${pubmedElements ? pubmedElements + '\n' : ''}    <templateInjector className="org.apidb.apicommon.model.datasetInjector.RNASeq">
      <prop name="switchStrandsGBrowse">false</prop>
      <prop name="switchStrandsProfiles">false</prop>
      <prop name="graphForceXLabelsHorizontal">false</prop>
      <prop name="hasFishersExactTestData">false</prop>
      <prop name="isEuPathDBSite">true</prop>
      <prop name="jbrowseTracksOnly">false</prop>
      <prop name="graphType">bar</prop>
      <prop name="graphColor">#336699</prop>
      <prop name="graphBottomMarginSize">50</prop>
      <prop name="graphSampleLabels"></prop>
      <prop name="showIntronJunctions">true</prop>
      <prop name="includeInUnifiedJunctions"></prop>
      <prop name="isAlignedToAnnotatedGenome">true</prop>
      <prop name="hasMultipleSamples">${hasMultipleSamples}</prop>
      <prop name="graphXAxisSamplesDescription">TODO: Description of x-axis samples</prop>
      <prop name="graphPriorityOrderGrouping">1000</prop>
      <prop name="optionalQuestionDescription"></prop>
      <prop name="isDESeq">${hasMultipleSamples}</prop>
      <prop name="isDEGseq">false</prop>
      <prop name="includeProfileSimilarity">false</prop>
      <prop name="profileTimeShift"></prop>
    </templateInjector>
  </datasetPresenter>`;
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 3) {
    console.error('Usage: node generate-presenter-xml.js <bioproject> <project_id> <primary_contact_id> [additional_contact_ids...]');
    console.error('');
    console.error('Arguments:');
    console.error('  bioproject            - BioProject accession (e.g., PRJNA1018599)');
    console.error('  project_id            - VEuPathDB project (e.g., VectorBase, HostDB)');
    console.error('  primary_contact_id    - Primary contact ID from allContacts.xml');
    console.error('  additional_contact_ids - (optional) Additional contact IDs');
    console.error('');
    console.error('Reads from:');
    console.error('  tmp/<bioproject>_sra_metadata.json (required)');
    console.error('  tmp/<GSE>_family.xml (optional, for richer descriptions)');
    console.error('');
    console.error('Example:');
    console.error('  node generate-presenter-xml.js PRJNA1018599 VectorBase john.smith');
    process.exit(1);
  }

  const bioproject = args[0];
  const projectId = args[1];
  const primaryContactId = args[2];
  const additionalContactIds = args.slice(3);

  // Validate project ID
  if (!VALID_PROJECT_IDS.includes(projectId)) {
    const projectIdLower = projectId.toLowerCase();
    const match = VALID_PROJECT_IDS.find(id => id.toLowerCase() === projectIdLower);

    if (match) {
      console.error(`Error: PROJECT_ID "${projectId}" appears to be a typo. Did you mean "${match}"?`);
    } else {
      console.error(`Error: PROJECT_ID "${projectId}" is not valid.`);
      console.error(`Valid PROJECT_IDs: ${VALID_PROJECT_IDS.join(', ')}`);
    }
    process.exit(1);
  }

  // Read SRA metadata
  const sraPath = resolve(`tmp/${bioproject}_sra_metadata.json`);
  if (!existsSync(sraPath)) {
    console.error(`Error: SRA metadata not found at ${sraPath}`);
    console.error('Run fetch-sra-metadata.js first.');
    process.exit(1);
  }

  const sraMetadata = JSON.parse(readFileSync(sraPath, 'utf-8'));

  // Try to read MINiML data (optional)
  let minimlData = null;
  const minimlFiles = readdirSync(resolve('tmp')).filter(f => f.endsWith('_family.xml'));
  if (minimlFiles.length > 0) {
    const minimlPath = resolve(`tmp/${minimlFiles[0]}`);
    try {
      minimlData = readFileSync(minimlPath, 'utf-8');
      console.error(`  Using MINiML data from: ${minimlFiles[0]}`);
    } catch (e) {
      console.error(`  Warning: Could not read MINiML file`);
    }
  }

  // Extract info from metadata
  const runs = sraMetadata.runs || [];
  const organismName = getOrganismFromRuns(runs);
  const uniqueSamples = new Set(runs.map(r => r.sample_accession)).size;

  // Get organism abbreviation interactively
  const orgAbbrev = await getOrganismAbbreviation();

  // Read publication data (already implemented)
  const publicationData = readPublicationData(bioproject);

  // Read BioProject data for fallback
  const bioprojectData = readBioprojectData(bioproject);

  // Determine author/submitter and year
  let authorOrSubmitter, year;

  if (publicationData.pmidCount > 0) {
    // Use first author's last name and publication year
    const firstAuthor = publicationData.publications[0].authors[0];
    authorOrSubmitter = extractLastName(firstAuthor.name);
    year = extractYear(publicationData.publications[0].pubdate);
    console.error(`  Using publication: ${authorOrSubmitter} (${year})`);
  } else {
    // Fallback to submitter organization and registration year
    authorOrSubmitter = cleanSubmitterName(bioprojectData.submitterOrganization);
    year = extractYear(bioprojectData.registrationDate);
    console.error(`  Using submitter: ${authorOrSubmitter} (${year})`);
  }

  // Generate enhanced presenter name
  const presenterName = `${orgAbbrev}_${authorOrSubmitter}_${year}_rnaSeq_RSRC`;

  // Find description
  const description = findExperimentDescription(sraMetadata, minimlData);

  // Extract methodology
  const methodology = extractMethodology(sraMetadata);

  // Publication data already read above for naming
  if (publicationData.pmidCount > 0) {
    console.error(`  Including ${publicationData.pmidCount} publications in presenter XML`);
  }

  // Build data object for template
  const templateData = {
    presenterName,
    projectId,
    organismName,
    description,
    methodology: methodology || 'TODO: Add methodology',
    primaryContactId,
    additionalContactIds,
    bioproject,
    pubmedIds: publicationData.publications.map(pub => pub.pmid),
    runCount: runs.length,
    sampleCount: uniqueSamples,
    isStrandSpecific: inferStrandSpecificity(runs),
    hasMultipleSamples: uniqueSamples > 1 ? 'true' : 'false'
  };

  // Generate XML
  const xml = generatePresenterXML(templateData);

  // Save to tmp file for editing
  const outputPath = resolve(`tmp/${bioproject}_presenter.xml`);
  writeFileSync(outputPath, xml);

  // Print summary
  console.error('');
  console.error('Generated RNA-seq presenter XML:');
  console.error(`  Output: ${outputPath}`);
  console.error(`  Name: ${presenterName}`);
  console.error(`  Organism: ${organismName}`);
  console.error(`  Runs: ${runs.length}`);
  console.error(`  Unique samples: ${uniqueSamples}`);
  console.error(`  Primary Contact: ${primaryContactId}`);
  if (additionalContactIds.length > 0) {
    console.error(`  Additional Contacts: ${additionalContactIds.join(', ')}`);
  }
  console.error('');
  console.error('Next steps:');
  console.error(`  1. Review and edit: ${outputPath}`);
  console.error('  2. Fill in TODO fields (shortDisplayName, shortAttribution, buildNumber, etc.)');
  console.error('  3. Add pubmedId elements if publications exist');
  console.error('  4. Insert into presenter file when ready');

  // Also output to stdout for reference
  console.log(xml);
}

main().catch(console.error);
