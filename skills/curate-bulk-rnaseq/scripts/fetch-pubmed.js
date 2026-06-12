#!/usr/bin/env node

import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { resolve } from 'path';

// NCBI E-utilities base URL
const EUTILS_BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';

// Rate limiting delay (matches existing codebase pattern)
const API_DELAY = 350;

/**
 * Search for publications linked to BioProject via elink
 * @param {string} bioprojectAccession - BioProject accession
 * @returns {Promise<string[]>} Array of PMIDs
 */
export async function searchByBioproject(bioprojectAccession) {
    if (!isValidBioProject(bioprojectAccession)) {
        console.warn(`Invalid BioProject format: ${bioprojectAccession}`);
        return [];
    }

    try {
        console.log(`Searching publications for BioProject: ${bioprojectAccession}`);

        // First, convert accession to numeric ID using esearch
        const searchUrl = `${EUTILS_BASE}/esearch.fcgi?db=bioproject&term=${bioprojectAccession}&retmode=json`;

        await delay(API_DELAY);
        const searchResponse = await fetchURL(searchUrl);
        const searchData = JSON.parse(searchResponse);

        if (!searchData.esearchresult || !searchData.esearchresult.idlist || searchData.esearchresult.idlist.length === 0) {
            console.log(`BioProject ${bioprojectAccession} not found in NCBI database`);
            return [];
        }

        const bioProjectId = searchData.esearchresult.idlist[0];

        // Use elink to find publications linked to BioProject ID
        const elinkUrl = `${EUTILS_BASE}/elink.fcgi?dbfrom=bioproject&db=pubmed&id=${bioProjectId}&retmode=json`;

        await delay(API_DELAY);
        const response = await fetchURL(elinkUrl);
        const data = JSON.parse(response);

        // Extract PMIDs from elink response
        const pmids = [];
        if (data.linksets && data.linksets[0] && data.linksets[0].linksetdbs) {
            for (const linksetdb of data.linksets[0].linksetdbs) {
                if (linksetdb.dbto === 'pubmed' && linksetdb.links) {
                    pmids.push(...linksetdb.links);
                }
            }
        }

        console.log(`Found ${pmids.length} publications via BioProject search`);
        return [...new Set(pmids)]; // Deduplicate

    } catch (error) {
        console.warn(`BioProject search failed: ${error.message}`);
        return [];
    }
}

/**
 * Search for publications linked to GEO series via elink
 * @param {string} geoAccession - GEO series accession (GSE...)
 * @returns {Promise<string[]>} Array of PMIDs
 */
export async function searchByGEO(geoAccession) {
    if (!isValidGEO(geoAccession)) {
        console.warn(`Invalid GEO format: ${geoAccession}`);
        return [];
    }

    try {
        console.log(`Searching publications for GEO series: ${geoAccession}`);

        // First, convert GSE accession to GDS ID using esearch
        const searchUrl = `${EUTILS_BASE}/esearch.fcgi?db=gds&term=${geoAccession}&retmode=json`;

        await delay(API_DELAY);
        const searchResponse = await fetchURL(searchUrl);
        const searchData = JSON.parse(searchResponse);

        if (!searchData.esearchresult || !searchData.esearchresult.idlist || searchData.esearchresult.idlist.length === 0) {
            console.log(`GEO series ${geoAccession} not found in GDS database`);
            return [];
        }

        const gdsId = searchData.esearchresult.idlist[0];

        // Use elink to find publications linked to GDS ID
        const elinkUrl = `${EUTILS_BASE}/elink.fcgi?dbfrom=gds&db=pubmed&id=${gdsId}&retmode=json`;

        await delay(API_DELAY);
        const response = await fetchURL(elinkUrl);
        const data = JSON.parse(response);

        // Extract PMIDs from elink response
        const pmids = [];
        if (data.linksets && data.linksets[0] && data.linksets[0].linksetdbs) {
            for (const linksetdb of data.linksets[0].linksetdbs) {
                if (linksetdb.dbto === 'pubmed' && linksetdb.links) {
                    pmids.push(...linksetdb.links);
                }
            }
        }

        console.log(`Found ${pmids.length} publications via GEO search`);
        return [...new Set(pmids)]; // Deduplicate

    } catch (error) {
        console.warn(`GEO search failed: ${error.message}`);
        return [];
    }
}

/**
 * Search for publications linked to SAMN accessions via elink (batched)
 * @param {string[]} samnAccessions - Array of SAMN accessions
 * @returns {Promise<string[]>} Array of PMIDs
 */
export async function searchBySAMN(samnAccessions) {
    if (!samnAccessions || samnAccessions.length === 0) {
        return [];
    }

    // Validate and filter SAMN accessions
    const validSamns = samnAccessions.filter(isValidSAMN);
    if (validSamns.length === 0) {
        console.warn('No valid SAMN accessions provided');
        return [];
    }

    try {
        console.log(`Searching publications for ${validSamns.length} SAMN accessions`);

        // Batch SAMN accessions (max 100 per request, following existing pattern)
        const batchSize = 100;
        const allPmids = [];

        for (let i = 0; i < validSamns.length; i += batchSize) {
            const batch = validSamns.slice(i, i + batchSize);

            // First, convert SAMN accessions to numeric IDs using esearch
            const searchTerm = batch.join(' OR ');
            const searchUrl = `${EUTILS_BASE}/esearch.fcgi?db=biosample&term=${encodeURIComponent(searchTerm)}&retmode=json&retmax=${batch.length}`;

            await delay(API_DELAY);
            const searchResponse = await fetchURL(searchUrl);
            const searchData = JSON.parse(searchResponse);

            if (!searchData.esearchresult || !searchData.esearchresult.idlist || searchData.esearchresult.idlist.length === 0) {
                console.log(`No numeric IDs found for SAMN batch: ${batch.join(', ')}`);
                continue;
            }

            const samnIds = searchData.esearchresult.idlist.join(',');

            // Use elink to find publications linked to BioSample IDs
            const elinkUrl = `${EUTILS_BASE}/elink.fcgi?dbfrom=biosample&db=pubmed&id=${samnIds}&retmode=json`;

            await delay(API_DELAY);
            const response = await fetchURL(elinkUrl);
            const data = JSON.parse(response);

            // Extract PMIDs from elink response
            if (data.linksets) {
                for (const linkset of data.linksets) {
                    if (linkset.linksetdbs) {
                        for (const linksetdb of linkset.linksetdbs) {
                            if (linksetdb.dbto === 'pubmed' && linksetdb.links) {
                                allPmids.push(...linksetdb.links);
                            }
                        }
                    }
                }
            }
        }

        const uniquePmids = [...new Set(allPmids)];
        console.log(`Found ${uniquePmids.length} publications via SAMN search`);
        return uniquePmids;

    } catch (error) {
        console.warn(`SAMN search failed: ${error.message}`);
        return [];
    }
}

/**
 * Search PubMed text for mentions of SAMN accessions
 * @param {string[]} samnAccessions - Array of SAMN accessions
 * @returns {Promise<string[]>} Array of PMIDs
 */
export async function textMineForSAMN(samnAccessions) {
    if (!samnAccessions || samnAccessions.length === 0) {
        return [];
    }

    const validSamns = samnAccessions.filter(isValidSAMN);
    if (validSamns.length === 0) {
        return [];
    }

    try {
        console.log(`Text mining for ${Math.min(validSamns.length, 10)} SAMN accessions`);

        // Limit to first 10 SAMNs for efficiency
        const searchSamns = validSamns.slice(0, 10);
        const allPmids = [];

        for (const samn of searchSamns) {
            // Search PubMed text for SAMN mentions
            const searchTerm = encodeURIComponent(samn);
            const esearchUrl = `${EUTILS_BASE}/esearch.fcgi?db=pubmed&term=${searchTerm}&retmode=json&retmax=20`;

            await delay(API_DELAY);
            const response = await fetchURL(esearchUrl);
            const data = JSON.parse(response);

            if (data.esearchresult && data.esearchresult.idlist) {
                allPmids.push(...data.esearchresult.idlist);
            }
        }

        const uniquePmids = [...new Set(allPmids)];
        console.log(`Found ${uniquePmids.length} publications via text mining`);
        return uniquePmids;

    } catch (error) {
        console.warn(`Text mining failed: ${error.message}`);
        return [];
    }
}

/**
 * Fetch detailed publication metadata for PMIDs using esummary
 * @param {string[]} pmids - Array of PubMed IDs
 * @returns {Promise<Object[]>} Array of publication objects with metadata
 */
export async function enrichPublications(pmids) {
    if (!pmids || pmids.length === 0) {
        return [];
    }

    try {
        console.log(`Fetching metadata for ${pmids.length} publications`);

        // Batch PMIDs for esummary (max 200 per request)
        const batchSize = 200;
        const allPublications = [];

        for (let i = 0; i < pmids.length; i += batchSize) {
            const batch = pmids.slice(i, i + batchSize);
            const pmidList = batch.join(',');

            const esummaryUrl = `${EUTILS_BASE}/esummary.fcgi?db=pubmed&id=${pmidList}&retmode=json`;

            await delay(API_DELAY);
            const response = await fetchURL(esummaryUrl);
            const data = JSON.parse(response);

            if (data.result) {
                for (const pmid of batch) {
                    const pubData = data.result[pmid];
                    if (pubData && pubData.title) {
                        allPublications.push({
                            pmid: pmid,
                            title: pubData.title,
                            authors: pubData.authors || [],
                            journal: pubData.fulljournalname || pubData.source,
                            pubdate: pubData.pubdate,
                            doi: pubData.doi || null
                        });
                    }
                }
            }
        }

        console.log(`Retrieved metadata for ${allPublications.length} publications`);
        return allPublications;

    } catch (error) {
        console.warn(`Publication metadata fetch failed: ${error.message}`);
        return [];
    }
}

/**
 * Main function to find publications using cascading search strategy
 * @param {string} bioprojectAccession - BioProject accession (PRJXXXXXXX)
 * @param {string} geoAccession - Optional GEO series accession (GSEXXXXXX)
 * @param {string[]} samnAccessions - Array of SAMN accessions
 * @returns {Object} Result with publications array and search method used
 */
export async function findPublications(bioprojectAccession, geoAccession, samnAccessions) {
    let pmids = [];
    let searchMethod = '';

    // 1. BioProject search (primary)
    try {
        pmids = await searchByBioproject(bioprojectAccession);
        if (pmids.length > 0) {
            searchMethod = 'bioproject';
            console.log(`✓ Found publications via BioProject search`);
        }
    } catch (error) {
        console.warn('BioProject search failed:', error.message);
    }

    // 2. GEO search (if no results and GEO available)
    if (pmids.length === 0 && geoAccession) {
        try {
            pmids = await searchByGEO(geoAccession);
            if (pmids.length > 0) {
                searchMethod = 'geo';
                console.log(`✓ Found publications via GEO search`);
            }
        } catch (error) {
            console.warn('GEO search failed:', error.message);
        }
    }

    // 3. SAMN search (if still no results)
    if (pmids.length === 0 && samnAccessions && samnAccessions.length > 0) {
        try {
            pmids = await searchBySAMN(samnAccessions);
            if (pmids.length > 0) {
                searchMethod = 'samn';
                console.log(`✓ Found publications via SAMN search`);
            }
        } catch (error) {
            console.warn('SAMN search failed:', error.message);
        }
    }

    // 4. Text mining (final fallback)
    if (pmids.length === 0 && samnAccessions && samnAccessions.length > 0) {
        try {
            pmids = await textMineForSAMN(samnAccessions);
            if (pmids.length > 0) {
                searchMethod = 'text_mining';
                console.log(`✓ Found publications via text mining`);
            }
        } catch (error) {
            console.warn('Text mining failed:', error.message);
        }
    }

    // Enrich with metadata
    const publications = pmids.length > 0 ? await enrichPublications(pmids) : [];

    return {
        publications: publications,
        searchMethod: searchMethod || 'none',
        pmidCount: pmids.length,
        timestamp: new Date().toISOString()
    };
}

/**
 * Make HTTP request with error handling
 * @param {string} url - URL to fetch
 * @returns {Promise<string>} Response body
 */
export function fetchURL(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(data);
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
                }
            });
        }).on('error', (err) => {
            reject(err);
        });
    });
}

/**
 * Add delay between API calls for rate limiting
 * @param {number} ms - Milliseconds to wait
 */
export function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Validate BioProject accession format
 * @param {string} accession - BioProject accession
 * @returns {boolean} True if valid
 */
export function isValidBioProject(accession) {
    return /^PRJ[A-Z]{1,2}\d+$/.test(accession);
}

/**
 * Validate SAMN accession format
 * @param {string} accession - SAMN accession
 * @returns {boolean} True if valid
 */
export function isValidSAMN(accession) {
    return /^SAMN\d+$/.test(accession);
}

/**
 * Validate GEO series accession format
 * @param {string} accession - GEO series accession
 * @returns {boolean} True if valid
 */
export function isValidGEO(accession) {
    return /^GSE\d+$/.test(accession);
}

/**
 * Ensure tmp directory exists for output files
 */
export function ensureTmpDir() {
    // Create tmp directory relative to the scripts directory
    const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
    const tmpDir = path.resolve(scriptsDir, '..', 'tmp');
    if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
    }
    return tmpDir;
}

/**
 * Main CLI function
 */
async function main() {
    // Ensure tmp directory exists for output files
    ensureTmpDir();

    console.log('fetch-pubmed.js - Publication Search Script');
    console.log('');
    console.log('Usage: fetch-pubmed.js <bioproject_accession> [options]');
    console.log('');
    console.log('Options:');
    console.log('  --help                 Show this help message');
    console.log('  --geo <accession>      GEO series accession (GSExxxxxx)');
    console.log('  --samn <accessions>    Comma-separated SAMN accessions');
    console.log('  --output <file>        Output file path (default: tmp/pubmed_results.json)');
    console.log('');
    console.log('Examples:');
    console.log('  fetch-pubmed.js PRJNA123456');
    console.log('  fetch-pubmed.js PRJNA123456 --geo GSE12345 --output results.json');
    console.log('');
    // TODO: CLI argument parsing and publication search implementation in later steps
}

// CLI entry point - check if script is executed directly
const scriptPath = fileURLToPath(import.meta.url);
const executedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (executedPath && scriptPath === executedPath) {
    main().catch(error => {
        console.error('Error:', error.message);
        process.exit(1);
    });
}
