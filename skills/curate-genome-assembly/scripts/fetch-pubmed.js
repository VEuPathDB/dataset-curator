#!/usr/bin/env node
/**
 * fetch-pubmed.js - Fetches PubMed records linked to a BioProject
 *
 * Usage: node fetch-pubmed.js <bioproject_id>
 *
 * This script:
 * 1. Uses NCBI elink to find PubMed records linked to a BioProject
 * 2. Uses NCBI esummary to get PubMed details (title, authors, abstract)
 * 3. Saves results to tmp/<bioproject_accession>_pubmed.json
 */

import { writeFileSync, readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const EUTILS_BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';

/**
 * Fetch JSON from NCBI E-utilities
 */
async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Find linked PubMed records for a BioProject
 */
async function findLinkedPubMed(bioProjectId) {
  const url = `${EUTILS_BASE}/elink.fcgi?dbfrom=bioproject&db=pubmed&id=${bioProjectId}&retmode=json`;
  const result = await fetchJson(url);

  // Extract PubMed IDs from the link set
  const linkSets = result.linksets || [];
  const pubmedIds = [];

  for (const linkSet of linkSets) {
    const linkSetDbs = linkSet.linksetdbs || [];
    for (const linkSetDb of linkSetDbs) {
      if (linkSetDb.dbto === 'pubmed' && linkSetDb.links) {
        pubmedIds.push(...linkSetDb.links);
      }
    }
  }

  return pubmedIds;
}

/**
 * Get PubMed summaries for multiple IDs
 */
async function getPubMedSummaries(ids) {
  if (ids.length === 0) return [];

  const url = `${EUTILS_BASE}/esummary.fcgi?db=pubmed&id=${ids.join(',')}&retmode=json`;
  const result = await fetchJson(url);

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
        // Identify last/senior author (typically corresponding author for genomics papers)
        lastAuthor: summary.lastauthor || '',
        _raw: summary
      });
    }
  }

  return summaries;
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.error('Usage: node fetch-pubmed.js <bioproject_id_or_accession>');
    console.error('');
    console.error('Arguments:');
    console.error('  bioproject_id_or_accession - Either numeric ID (282568) or accession (PRJNA282568)');
    console.error('');
    console.error('Example:');
    console.error('  node fetch-pubmed.js 282568');
    console.error('  node fetch-pubmed.js PRJNA282568');
    process.exit(1);
  }

  let bioProjectId = args[0];
  let bioProjectAccession = '';

  // If given an accession, try to read the ID from the bioproject JSON
  if (bioProjectId.startsWith('PRJ')) {
    bioProjectAccession = bioProjectId;
    const bioProjectPath = resolve(`tmp/${bioProjectAccession}_bioproject.json`);

    if (existsSync(bioProjectPath)) {
      const bioProjectData = JSON.parse(readFileSync(bioProjectPath, 'utf-8'));
      bioProjectId = bioProjectData.id;
      console.error(`Using BioProject ID ${bioProjectId} from ${bioProjectPath}`);
    } else {
      console.error(`Error: BioProject JSON not found at ${bioProjectPath}`);
      console.error('Run fetch-bioproject.js first, or provide numeric BioProject ID directly.');
      process.exit(1);
    }
  }

  // Validate numeric ID
  if (!/^\d+$/.test(bioProjectId)) {
    console.error(`Error: Invalid BioProject ID: ${bioProjectId}`);
    console.error('Expected numeric ID (e.g., 282568)');
    process.exit(1);
  }

  console.error(`Fetching PubMed records linked to BioProject: ${bioProjectId}`);

  try {
    // Step 1: Find linked PubMed records
    console.error('  Searching for linked PubMed records...');
    const pubmedIds = await findLinkedPubMed(bioProjectId);

    if (pubmedIds.length === 0) {
      console.error('  No linked PubMed records found.');
      const output = {
        bioProjectId,
        bioProjectAccession,
        pubmedCount: 0,
        papers: []
      };
      const outputPath = resolve(`tmp/${bioProjectAccession || bioProjectId}_pubmed.json`);
      writeFileSync(outputPath, JSON.stringify(output, null, 2));
      console.error(`  Saved (empty) to: ${outputPath}`);
      console.log(JSON.stringify(output, null, 2));
      return;
    }

    console.error(`  Found ${pubmedIds.length} linked PubMed record(s): ${pubmedIds.join(', ')}`);

    // Step 2: Get PubMed summaries
    console.error('  Fetching PubMed summaries...');
    const papers = await getPubMedSummaries(pubmedIds);

    const output = {
      bioProjectId,
      bioProjectAccession,
      pubmedCount: papers.length,
      papers
    };

    // Save to file
    const outputPath = resolve(`tmp/${bioProjectAccession || bioProjectId}_pubmed.json`);
    writeFileSync(outputPath, JSON.stringify(output, null, 2));
    console.error(`  Saved to: ${outputPath}`);

    // Also output to stdout for piping
    console.log(JSON.stringify(output, null, 2));

  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

main();
