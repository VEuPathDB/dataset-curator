#!/usr/bin/env node
/**
 * resolve-accessions.js - Cross-references a BioProject and its GEO series
 *
 * Usage: node resolve-accessions.js <PRJNA…|GSE…>
 *
 * For each proposal the id makes (one, or one per sub-series BioProject for a
 * GEO SuperSeries), writes .curation/tmp/<accession>_xref.json and, when GEO
 * has the series, .curation/tmp/<GSE>_family.xml. Prints the resolution JSON.
 */

import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { gunzipSync } from 'zlib';
import { resolveAccession } from './lib/geo-xref.js';

const NCBI_DELAY_MS = 400;

async function fetchText(url) {
  await new Promise((r) => setTimeout(r, NCBI_DELAY_MS));
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
  return response.text();
}

/** The first .xml member of a tar archive. */
function xmlFromTar(tar) {
  let offset = 0;
  while (offset < tar.length) {
    const filename = tar.subarray(offset, offset + 100).toString('utf-8').replace(/\0/g, '').trim();
    if (!filename) break;
    const size = parseInt(tar.subarray(offset + 124, offset + 136).toString('utf-8').replace(/\0/g, '').trim(), 8) || 0;
    offset += 512;
    if (filename.endsWith('.xml')) return tar.subarray(offset, offset + size).toString('utf-8');
    offset += Math.ceil(size / 512) * 512;
  }
  throw new Error('XML file not found in tar archive');
}

/** Series live in directories by thousands: GSE245678 is under GSE245nnn/. */
async function downloadMiniml(gse) {
  const base = `https://ftp.ncbi.nlm.nih.gov/geo/series/GSE${gse.slice(3, -3)}nnn/${gse}/miniml/${gse}_family.xml`;
  const tgz = await fetch(`${base}.tgz`);
  if (tgz.ok) return xmlFromTar(gunzipSync(Buffer.from(await tgz.arrayBuffer())));
  const xml = await fetch(base);
  if (!xml.ok) throw new Error(`MINiML for ${gse} not found at NCBI FTP (tried .tgz and .xml)`);
  return xml.text();
}

async function main() {
  const [id] = process.argv.slice(2);
  if (!id) {
    console.error('Usage: node resolve-accessions.js <PRJNA…|GSE…>');
    process.exit(1);
  }
  const tmp = resolve('.curation/tmp');
  mkdirSync(tmp, { recursive: true });

  const result = await resolveAccession(id, { fetchText });
  for (const p of result.proposals) {
    const xref = { query: id, kind: result.kind, ...p, ...(result.superSeries ? { superSeries: result.superSeries } : {}), checkedAt: new Date().toISOString() };
    writeFileSync(`${tmp}/${p.accession}_xref.json`, JSON.stringify(xref, null, 2) + '\n');
    console.error(`  ${p.accession}: ${Object.entries(p.externalIds).map(([k, v]) => `${k}=${v}`).join(', ')}`);
    if (p.externalIds.geo) {
      writeFileSync(`${tmp}/${p.externalIds.geo}_family.xml`, await downloadMiniml(p.externalIds.geo));
      console.error(`    saved ${p.externalIds.geo}_family.xml`);
    }
    for (const w of p.warnings) console.error(`    Warning: ${w}`);
  }
  for (const s of result.skipped ?? []) console.error(`  Skipped ${s.gse}: ${s.reason}`);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => { console.error(`Error: ${err.message}`); process.exit(1); });
