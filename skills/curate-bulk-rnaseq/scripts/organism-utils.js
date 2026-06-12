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
 */
export function generateOrganismAbbrev(organismFullName) {
    if (!organismFullName || typeof organismFullName !== 'string') {
        throw new Error('Organism name must be a non-empty string');
    }

    const items = organismFullName.trim().split(/\s+/);

    // Extract genus (remove brackets if present)
    let genus = items.shift() || '';
    genus = genus.replace(/^\[/, '').replace(/\]$/, '');

    // Extract species
    const species = items.shift() || '';

    // Process strain abbreviation from remaining parts
    let strainAbbrev = items.join('');
    strainAbbrev = strainAbbrev.replace(/isolate/gi, '');
    strainAbbrev = strainAbbrev.replace(/strain/gi, '');
    strainAbbrev = strainAbbrev.replace(/breed/gi, '');
    strainAbbrev = strainAbbrev.replace(/str\./gi, '');
    strainAbbrev = strainAbbrev.replace(/\//g, '');
    strainAbbrev = strainAbbrev.replace(/,/g, '');
    strainAbbrev = strainAbbrev.replace(/:/g, '');
    strainAbbrev = strainAbbrev.replace(/#/g, '-');
    strainAbbrev = strainAbbrev.replace(/\./g, '-');

    // Generate final abbreviation
    const organismAbbrev = genus.charAt(0).toLowerCase() + species.substring(0, 3) + strainAbbrev;
    const orthomclAbbrev = genus.charAt(0).toLowerCase() + species.substring(0, 3);

    return {
        organismAbbrev,
        orthomclAbbrev,
        genus,
        species,
        strainAbbrev
    };
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

        // Skip header row, parse data rows
        const rows = lines.slice(1).map(line => {
            const columns = line.split(',');
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