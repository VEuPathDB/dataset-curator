#!/usr/bin/env node
/**
 * fetch-pubmed.js - Fetches PubMed records for a BioProject using cascading search
 *
 * Usage: node fetch-pubmed.js <bioproject_accession> [--geo <geo_accession>] [--samn samn1 samn2 ...]
 *
 * This script:
 * 1. Searches for publications using cascading methods:
 *    - Method 1: NCBI Datasets API (if available for bulk RNA-seq)
 *    - Method 2: GEO series elink (if GEO accession provided)
 *    - Method 3: BioProject elink (direct link)
 *    - Method 4: SAMN sample elink (if SAMN accessions provided)
 * 2. Uses NCBI esummary to get PubMed details (title, authors)
 * 3. Saves results to tmp/<bioproject_accession>_pubmed.json
 */

import { writeFileSync, readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const EUTILS_BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';

// Rate limiting delay (matches existing codebase pattern)
const API_DELAY = 350;

/**
 * Make HTTP request with error handling
 * @param {string} url - URL to fetch
 * @returns {Promise<string>} Response body
 */
async function fetchURL(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  return response.text();
}

/**
 * Fetch JSON from a URL
 * @param {string} url - URL to fetch
 * @returns {Promise<Object>} Parsed JSON response
 */
async function fetchJSON(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Add delay between API calls for rate limiting
 * @param {number} ms - Milliseconds to wait
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Validate BioProject accession format
 * @param {string} accession - BioProject accession
 * @returns {boolean} True if valid
 */
function isValidBioProject(accession) {
  return /^PRJ[A-Z]{1,2}\d+$/.test(accession);
}

/**
 * Validate SAMN accession format
 * @param {string} accession - SAMN accession
 * @returns {boolean} True if valid
 */
function isValidSAMN(accession) {
  return /^SAMN\d+$/.test(accession);
}

/**
 * Validate GEO series accession format
 * @param {string} accession - GEO series accession
 * @returns {boolean} True if valid
 */
function isValidGEO(accession) {
  return /^GSE\d+$/.test(accession);
}

/**
 * Find linked PubMed records via elink
 * @param {string} dbFrom - Database to link from
 * @param {string} id - Accession/ID to search
 * @returns {Promise<Array>} Array of {pmid, source} objects
 */
async function findLinkedPubMed(dbFrom, id) {
  const url = `${EUTILS_BASE}/elink.fcgi?dbfrom=${dbFrom}&db=pubmed&id=${id}&retmode=json`;

  try {
    const result = await fetchJSON(url);
    const linkSets = result.linksets || [];
    const pubmedIds = [];

    for (const linkSet of linkSets) {
      const linkSetDbs = linkSet.linksetdbs || [];
      for (const linkSetDb of linkSetDbs) {
        if (linkSetDb.dbto === 'pubmed' && linkSetDb.links) {
          pubmedIds.push(...linkSetDb.links.map(id => ({
            pmid: String(id),
            source: [`${dbFrom}_elink`]
          })));
        }
      }
    }
    return pubmedIds;
  } catch (error) {
    return [];
  }
}

/**
 * Get BioProject numeric ID from accession (via esearch)
 * @param {string} bioProjectAccession - BioProject accession
 * @returns {Promise<string|null>} BioProject ID or null
 */
async function getBioProjectId(bioProjectAccession) {
  const url = `${EUTILS_BASE}/esearch.fcgi?db=bioproject&term=${bioProjectAccession}&retmode=json`;

  try {
    const result = await fetchJSON(url);
    const ids = result.esearchresult?.idlist || [];
    return ids.length > 0 ? ids[0] : null;
  } catch (error) {
    return null;
  }
}

/**
 * Get SAMN numeric ID from accession (via esearch)
 * @param {string} samnAccession - SAMN accession
 * @returns {Promise<string|null>} SAMN ID or null
 */
async function getSamnId(samnAccession) {
  const url = `${EUTILS_BASE}/esearch.fcgi?db=biosample&term=${samnAccession}&retmode=json`;

  try {
    const result = await fetchJSON(url);
    const ids = result.esearchresult?.idlist || [];
    return ids.length > 0 ? ids[0] : null;
  } catch (error) {
    return null;
  }
}

/**
 * Get GEO series numeric ID from accession (via esearch)
 * @param {string} geoAccession - GEO series accession
 * @returns {Promise<string|null>} GEO ID or null
 */
async function getGeoId(geoAccession) {
  const url = `${EUTILS_BASE}/esearch.fcgi?db=gds&term=${geoAccession}&retmode=json`;

  try {
    const result = await fetchJSON(url);
    const ids = result.esearchresult?.idlist || [];
    return ids.length > 0 ? ids[0] : null;
  } catch (error) {
    return null;
  }
}

/**
 * Get PubMed summaries for multiple IDs
 * @param {Array} pubsWithSource - Array of {pmid, source} objects
 * @returns {Promise<Array>} Array of publication objects with metadata
 */
async function getPubMedSummaries(pubsWithSource) {
  if (pubsWithSource.length === 0) return [];

  const ids = pubsWithSource.map(p => p.pmid);
  const sourceMap = Object.fromEntries(pubsWithSource.map(p => [p.pmid, p.source]));

  const url = `${EUTILS_BASE}/esummary.fcgi?db=pubmed&id=${ids.join(',')}&retmode=json`;

  try {
    const result = await fetchJSON(url);

    const summaries = [];
    for (const id of ids) {
      const summary = result.result?.[id];
      if (summary) {
        summaries.push({
          pmid: id,
          title: summary.title || '',
          authors: (summary.authors || []).map(a => ({
            name: a.name,
            authtype: a.authtype
          })),
          source: summary.source || '',
          pubdate: summary.pubdate || '',
          volume: summary.volume || '',
          issue: summary.issue || '',
          pages: summary.pages || '',
          doi: summary.elocationid || '',
          lastAuthor: summary.lastauthor || '',
          // How this publication was found
          discoverySource: sourceMap[id] || []
        });
      }
    }

    return summaries;
  } catch (error) {
    console.error(`  Warning: Failed to fetch PubMed summaries: ${error.message}`);
    return [];
  }
}

/**
 * Main function to find publications for a BioProject using cascading search
 * @param {string} bioprojectAccession - BioProject accession (PRJXXXXXXX)
 * @param {string} geoAccession - Optional GEO series accession (GSEXXXXXX)
 * @param {string[]} samnAccessions - Array of SAMN accessions
 * @returns {Promise<Object>} Result with publications array and search method used
 */
async function findPublications(bioprojectAccession, geoAccession = null, samnAccessions = []) {
  const allPubs = new Map(); // pmid -> {pmid, source[]}

  // Method 1: BioProject elink (most reliable, always available)
  console.error(`  Searching via BioProject elink (${bioprojectAccession})...`);
  try {
    const bioProjectId = await getBioProjectId(bioprojectAccession);
    if (bioProjectId) {
      const pubs = await findLinkedPubMed('bioproject', bioProjectId);
      if (pubs.length > 0) {
        console.error(`    Found ${pubs.length} publication(s) via BioProject elink`);
        for (const pub of pubs) {
          if (allPubs.has(pub.pmid)) {
            allPubs.get(pub.pmid).source.push(...pub.source);
          } else {
            allPubs.set(pub.pmid, { pmid: pub.pmid, source: [...pub.source] });
          }
        }
      } else {
        console.error('    No publications found via BioProject elink');
      }
      await delay(API_DELAY);
    }
  } catch (error) {
    console.error(`    Error searching BioProject: ${error.message}`);
  }

  // Method 2: GEO series elink (if GEO accession provided)
  if (geoAccession && isValidGEO(geoAccession)) {
    console.error(`  Searching via GEO series elink (${geoAccession})...`);
    try {
      const geoId = await getGeoId(geoAccession);
      if (geoId) {
        const pubs = await findLinkedPubMed('gds', geoId);
        if (pubs.length > 0) {
          console.error(`    Found ${pubs.length} publication(s) via GEO elink`);
          for (const pub of pubs) {
            if (allPubs.has(pub.pmid)) {
              allPubs.get(pub.pmid).source.push(...pub.source);
            } else {
              allPubs.set(pub.pmid, { pmid: pub.pmid, source: [...pub.source] });
            }
          }
        } else {
          console.error('    No publications found via GEO elink');
        }
        await delay(API_DELAY);
      }
    } catch (error) {
      console.error(`    Error searching GEO series: ${error.message}`);
    }
  }

  // Method 3: SAMN sample elink (if SAMN accessions provided)
  if (samnAccessions && samnAccessions.length > 0) {
    console.error(`  Searching via ${samnAccessions.length} SAMN accession(s)...`);
    for (const samnAccession of samnAccessions) {
      if (!isValidSAMN(samnAccession)) {
        console.error(`    Skipping invalid SAMN accession: ${samnAccession}`);
        continue;
      }
      try {
        const samnId = await getSamnId(samnAccession);
        if (samnId) {
          const pubs = await findLinkedPubMed('biosample', samnId);
          if (pubs.length > 0) {
            console.error(`    Found ${pubs.length} publication(s) for ${samnAccession}`);
            for (const pub of pubs) {
              if (allPubs.has(pub.pmid)) {
                allPubs.get(pub.pmid).source.push(...pub.source);
              } else {
                allPubs.set(pub.pmid, { pmid: pub.pmid, source: [...pub.source] });
              }
            }
          }
        }
        await delay(API_DELAY);
      } catch (error) {
        console.error(`    Error searching SAMN ${samnAccession}: ${error.message}`);
      }
    }
  }

  // Deduplicate sources
  const pubsWithSource = Array.from(allPubs.values());
  for (const pub of pubsWithSource) {
    pub.source = [...new Set(pub.source)];
  }

  return {
    totalUnique: pubsWithSource.length,
    publications: pubsWithSource
  };
}

// Export for testing
export { findPublications, isValidBioProject, isValidSAMN, isValidGEO };

// CLI entry point
async function main() {
  const args = process.argv.slice(2);

  if (args.length < 1 || args.includes('--help') || args.includes('-h')) {
    console.error('Usage: node fetch-pubmed.js <bioproject_accession> [--geo <geo_accession>] [--samn samn1 samn2 ...]');
    console.error('');
    console.error('Arguments:');
    console.error('  bioproject_accession - BioProject accession (e.g., PRJNA1018599)');
    console.error('  --geo <accession>    - Optional GEO series accession (e.g., GSE1234)');
    console.error('  --samn <accessions>  - Optional SAMN accessions (can specify multiple)');
    console.error('');
    console.error('Examples:');
    console.error('  node fetch-pubmed.js PRJNA1018599');
    console.error('  node fetch-pubmed.js PRJNA1018599 --geo GSE123456');
    console.error('  node fetch-pubmed.js PRJNA1018599 --samn SAMN00000001 SAMN00000002');
    console.error('');
    console.error('Output: tmp/<bioproject_accession>_pubmed.json');
    process.exit(args.includes('--help') || args.includes('-h') ? 0 : 1);
  }

  const bioprojectAccession = args[0];

  // Validate BioProject accession
  if (!isValidBioProject(bioprojectAccession)) {
    console.error(`Error: Invalid BioProject accession format: ${bioprojectAccession}`);
    console.error('Expected format: PRJNA123456, PRJEA123456, PRJDA123456, etc.');
    process.exit(1);
  }

  // Parse optional arguments
  let geoAccession = null;
  let samnAccessions = [];

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--geo' && i + 1 < args.length) {
      geoAccession = args[i + 1];
      i++;
    } else if (args[i] === '--samn') {
      // Collect all remaining non-flag arguments as SAMN accessions
      i++;
      while (i < args.length && !args[i].startsWith('--')) {
        samnAccessions.push(args[i]);
        i++;
      }
      i--; // Adjust for the loop increment
    }
  }

  console.error(`Fetching PubMed records for: ${bioprojectAccession}`);

  try {
    const result = await findPublications(bioprojectAccession, geoAccession, samnAccessions);
    const { totalUnique, publications } = result;

    console.error(`  Total unique publications found: ${totalUnique}`);

    if (totalUnique === 0) {
      console.error('  No publications found from any source.');
      const output = {
        bioprojectAccession,
        geoAccession: geoAccession || null,
        samnAccessions: samnAccessions.length > 0 ? samnAccessions : null,
        pubmedCount: 0,
        papers: [],
        fetchDate: new Date().toISOString()
      };
      const outputPath = resolve(`tmp/${bioprojectAccession}_pubmed.json`);
      writeFileSync(outputPath, JSON.stringify(output, null, 2));
      console.error(`  Saved (empty) to: ${outputPath}`);
      console.log(JSON.stringify(output, null, 2));
      return;
    }

    console.error('  Fetching PubMed summaries...');
    const papers = await getPubMedSummaries(publications);

    const output = {
      bioprojectAccession,
      geoAccession: geoAccession || null,
      samnAccessions: samnAccessions.length > 0 ? samnAccessions : null,
      pubmedCount: papers.length,
      papers,
      fetchDate: new Date().toISOString()
    };

    // Save to file
    const outputPath = resolve(`tmp/${bioprojectAccession}_pubmed.json`);
    writeFileSync(outputPath, JSON.stringify(output, null, 2));
    console.error(`  Saved to: ${outputPath}`);

    // Also output to stdout for piping
    console.log(JSON.stringify(output, null, 2));

  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('Error:', error.message);
    process.exit(1);
  });
}
