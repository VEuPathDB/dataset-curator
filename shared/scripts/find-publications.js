#!/usr/bin/env node
/**
 * find-publications.js - Finds the papers for a BioProject so the curator can read
 * their Methods. Linked papers are NCBI's BioProject-PubMed links and GEO's PubMed IDs;
 * when there are none, Europe PMC candidates by accession or title, which a curator
 * must confirm. Writes .curation/tmp/<accession>_publications.json.
 *
 * Usage: node scripts/find-publications.js <ACCESSION>
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { findPublications } from './lib/publications.js';

function readXref(accession) {
  const path = resolve(`.curation/tmp/${accession}_xref.json`);
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf-8')) : null;
}

function describe(p) {
  const ids = [p.pmid && `PMID ${p.pmid}`, p.pmcid, p.doi && `doi:${p.doi}`].filter(Boolean).join(', ');
  const lines = [`  [${p.source ?? '?'}] ${ids || '(no identifiers)'} (${p.year ?? 'year unknown'})`, `    ${p.title ?? '(title unknown)'}`];
  if (p.foundBy) lines.push(`    found by ${p.foundBy}`);
  for (const f of p.fullText) lines.push(`    ${f.url}${f.availability ? ` (${f.availability})` : ''}`);
  return lines.join('\n');
}

async function main() {
  const [accession] = process.argv.slice(2);
  if (!accession) {
    console.error('Usage: node scripts/find-publications.js <ACCESSION>');
    process.exit(1);
  }
  const xref = readXref(accession);
  const bioproject = xref?.externalIds?.bioproject ?? (/^PRJ/.test(accession) ? accession : null);
  if (!bioproject) throw new Error(`no BioProject for ${accession}: no .curation/tmp/${accession}_xref.json; run: node scripts/resolve-accessions.js ${accession}`);
  const geoPubmedIds = xref?.pubmedIds ?? [];

  const { linked, candidates } = await findPublications(bioproject, { geoPubmedIds });
  const path = resolve(`.curation/tmp/${accession}_publications.json`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ accession, bioproject, geoPubmedIds, linked, candidates, queriedAt: new Date().toISOString() }, null, 2) + '\n');

  console.error(`Linked publications for ${bioproject}: ${linked.length}`);
  linked.forEach((p) => console.error(describe(p)));
  if (!linked.length) {
    console.error(`Candidate publications (unconfirmed; check they describe ${bioproject}): ${candidates.length}`);
    candidates.forEach((p) => console.error(describe(p)));
  }
  console.error(path);
}

main().catch((err) => { console.error(`Error: ${err.message}`); process.exit(1); });
