#!/usr/bin/env node
/**
 * organism-utils.js - Organism abbreviation generation utilities
 *
 * JavaScript port of Perl logic for generating organism abbreviations
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Generate organism abbreviation using standardized logic
 * Port of Perl script logic: genus[0] + species[0:3] + cleaned_strain
 * Includes CSV fallback for reference strain lookup when strain is missing
 */
export function generateOrganismAbbrev(organismFullName, csvPath = null) {
    if (!organismFullName || typeof organismFullName !== 'string') {
        throw new Error('Organism name must be a non-empty string');
    }

    const items = organismFullName.trim().split(/\s+/);

    // Extract genus (remove brackets if present)
    let genus = items.shift() || '';
    genus = genus.replace(/^\[/, '').replace(/\]$/, '');

    // Extract species
    const species = items.shift() || '';

    // Add validation to require both genus and species
    if (!genus || !species) {
        throw new Error('Organism name must contain at least genus and species (e.g., "Homo sapiens")');
    }

    // Process strain abbreviation from remaining parts
    let strainAbbrev = '';
    if (items.length > 0) {
        // Extract strain from remaining parts
        strainAbbrev = items.join(' ');

        // Clean strain abbreviation - remove prefixes but keep characters as-is
        strainAbbrev = strainAbbrev.replace(/isolate\s*/gi, '');
        strainAbbrev = strainAbbrev.replace(/strain\s*/gi, '');
        strainAbbrev = strainAbbrev.replace(/breed\s*/gi, '');
        strainAbbrev = strainAbbrev.replace(/str\.\s*/gi, '');
        strainAbbrev = strainAbbrev.trim(); // Remove leading/trailing whitespace only
    }

    // If no strain found and CSV path provided, look up reference strain
    if (!strainAbbrev && csvPath) {
        const referenceStrain = findReferenceStrain(csvPath, genus, species);
        if (referenceStrain) {
            strainAbbrev = extractStrainFromOrganism(referenceStrain.fullName);
            console.log(`Using reference strain from CSV: ${referenceStrain.fullName} -> ${strainAbbrev}`);
        }
    }

    // Generate final abbreviation
    const organismAbbrev = genus.charAt(0).toLowerCase() + species.substring(0, 3) + strainAbbrev;
    const orthomclAbbrev = genus.charAt(0).toLowerCase() + species.substring(0, 3);

    return {
        organismAbbrev,
        orthomclAbbrev,
        genus,
        species,
        strainAbbrev: strainAbbrev || ''
    };
}

/**
 * Parse CSV row that handles quoted fields and commas within values
 */
function parseCSVRow(row) {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < row.length; i++) {
        const char = row[i];

        if (char === '"' && (i === 0 || row[i-1] === ',')) {
            inQuotes = true;
        } else if (char === '"' && inQuotes) {
            inQuotes = false;
        } else if (char === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    result.push(current.trim());
    return result;
}

/**
 * Extract strain information from organism full name
 * e.g., "Fusarium graminearum PH-1" -> "PH-1"
 */
function extractStrainFromOrganism(organismName) {
    const parts = organismName.trim().split(/\s+/);
    if (parts.length <= 2) {
        return ''; // No strain information
    }

    // Get everything after genus and species
    const strainParts = parts.slice(2);
    let strain = strainParts.join(' ');

    // Clean strain abbreviation - remove prefixes but keep characters as-is
    strain = strain.replace(/isolate\s*/gi, '');
    strain = strain.replace(/strain\s*/gi, '');
    strain = strain.replace(/breed\s*/gi, '');
    strain = strain.replace(/str\.\s*/gi, '');
    strain = strain.trim(); // Remove leading/trailing whitespace only

    return strain;
}

/**
 * Find reference strain for genus/species in CSV
 * Returns organism where is_annotated_genome=1 AND is_reference_strain=1
 */
function findReferenceStrain(csvPath, genus, species) {
    try {
        const csvData = readFileSync(csvPath, 'utf-8');
        const lines = csvData.trim().split('\n');

        if (lines.length < 2) {
            console.warn('CSV file is empty or has no data rows');
            return null;
        }

        // Skip header row, parse data rows
        const rows = lines.slice(1).map(line => {
            const columns = parseCSVRow(line);
            if (columns.length < 6) {
                return null; // Skip malformed rows
            }

            return {
                project: columns[0]?.trim(),
                fullName: columns[1]?.trim(),
                abbrev: columns[2]?.trim(),
                annotated: columns[3]?.trim(),
                reference: columns[4]?.trim(),
                orthomcl: columns[5]?.trim()
            };
        }).filter(row => row !== null);

        // Filter for annotated genome = 1 AND reference strain = 1
        const validOrganisms = rows.filter(org =>
            org.annotated === '1' && org.reference === '1'
        );

        // Find organism that matches genus and species
        const targetGenusSpecies = `${genus} ${species}`.toLowerCase();
        return validOrganisms.find(org => {
            const orgParts = org.fullName.trim().split(/\s+/);
            if (orgParts.length < 2) return false;

            const orgGenusSpecies = `${orgParts[0]} ${orgParts[1]}`.toLowerCase();
            return orgGenusSpecies === targetGenusSpecies;
        }) || null;

    } catch (error) {
        console.warn(`Reference strain lookup failed: ${error.message}`);
        return null;
    }
}

/**
 * Look up organism in CSV reference file
 */
export function lookupOrganism(csvPath, organismName) {
    try {
        const csvData = readFileSync(csvPath, 'utf-8');
        const lines = csvData.trim().split('\n');

        if (lines.length < 2) {
            console.warn('CSV file is empty or has no data rows');
            return null;
        }

        // Skip header row, parse data rows with robust CSV parsing
        const rows = lines.slice(1).map(line => {
            const columns = parseCSVRow(line);
            if (columns.length < 6) {
                return null; // Skip malformed rows
            }

            return {
                project: columns[0]?.trim(),
                fullName: columns[1]?.trim(),
                abbrev: columns[2]?.trim(),
                annotated: columns[3]?.trim(),
                reference: columns[4]?.trim(),
                orthomcl: columns[5]?.trim()
            };
        }).filter(row => row !== null);

        // Filter for annotated genome = 1 AND reference strain = 1
        const validOrganisms = rows.filter(org =>
            org.annotated === '1' && org.reference === '1'
        );

        // Exact match on organism full name (case insensitive)
        return validOrganisms.find(org =>
            org.fullName.toLowerCase() === organismName.trim().toLowerCase()
        ) || null;

    } catch (error) {
        console.warn(`CSV lookup failed: ${error.message}`);
        return null;
    }
}

/**
 * Interactive prompt for organism name
 */
export async function promptOrganismName() {
    return new Promise((resolve) => {
        process.stdout.write('Enter organism name: ');
        process.stdin.resume();
        process.stdin.setEncoding('utf8');

        process.stdin.once('data', (data) => {
            process.stdin.pause();
            resolve(data.toString().trim());
        });
    });
}

/**
 * Interactive confirmation prompt
 */
export async function promptConfirm(message) {
    return new Promise((resolve) => {
        process.stdout.write(`${message} [Y/n]: `);
        process.stdin.resume();
        process.stdin.setEncoding('utf8');

        process.stdin.once('data', (data) => {
            process.stdin.pause();
            const response = data.toString().trim().toLowerCase();
            resolve(response === '' || response === 'y' || response === 'yes');
        });
    });
}

/**
 * Interactive prompt for custom abbreviation
 */
export async function promptCustomAbbrev() {
    return new Promise((resolve) => {
        process.stdout.write('Enter custom organism abbreviation: ');
        process.stdin.resume();
        process.stdin.setEncoding('utf8');

        process.stdin.once('data', (data) => {
            process.stdin.pause();
            resolve(data.toString().trim());
        });
    });
}