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
 * Main function to find publications for a BioProject using cascading search
 * @param {string} bioprojectAccession - BioProject accession (PRJXXXXXXX)
 * @param {string} geoAccession - Optional GEO series accession (GSEXXXXXX)
 * @param {string[]} samnAccessions - Array of SAMN accessions
 * @returns {Object} Result with publications array and search method used
 */
export function findPublications(bioprojectAccession, geoAccession, samnAccessions) {
    // TODO: Implementation in next steps
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
const executedPath = resolve(process.argv[1]);
if (scriptPath === executedPath) {
    main().catch(error => {
        console.error('Error:', error.message);
        process.exit(1);
    });
}
