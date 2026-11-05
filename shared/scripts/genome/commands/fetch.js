import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PipelineError, readJson, sha256, sha256File, workPaths, writeJson } from '../workdir.js';

export const NCBI_FTP = 'https://ftp.ncbi.nlm.nih.gov/genomes/all';
const ACCESSION = /^(GC[AF])_(\d{3})(\d{3})(\d{3})\.\d+$/;
const FILES = { gff: '_genomic.gff.gz', fasta: '_genomic.fna.gz', report: '_assembly_report.txt' };

export function assemblyDirUrl(accession) {
  const m = accession.match(ACCESSION);
  if (!m) throw new Error(`${accession} is not an NCBI assembly accession (GCA_ or GCF_ plus nine digits and a version)`);
  return `${NCBI_FTP}/${m[1]}/${m[2]}/${m[3]}/${m[4]}/`;
}

export async function defaultFetchBytes(url) {
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET ${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function assemblyDir(accession, dirUrl, fetchBytes) {
  const listing = await fetchBytes(dirUrl);
  const names = listing
    ? [...listing.toString('utf-8').matchAll(/href="([^"]+?)\/?"/g)].map(([, n]) => n).filter((n) => n.startsWith(`${accession}_`))
    : [];
  if (names.length !== 1) throw new PipelineError('fetch', dirUrl, `lists no assembly directory for ${accession}`, 'check the accession, including its version');
  return names[0];
}

/** Downloads into fetch/; a re-run keeps local files and the first record, and refuses drift. */
export async function runFetch({ workDir, accession, fetchBytes = defaultFetchBytes, now = () => new Date().toISOString() }) {
  const p = workPaths(workDir);
  const previous = existsSync(p.fetchJson) ? JSON.parse(readFileSync(p.fetchJson, 'utf-8')) : null;
  if (previous && previous.accession !== accession) {
    throw new PipelineError('fetch', p.fetchJson, `holds ${previous.accession}, not ${accession}`, 'use a fresh --workDir for another assembly');
  }
  const dirUrl = assemblyDirUrl(accession);
  const assembly = await assemblyDir(accession, dirUrl, fetchBytes);
  mkdirSync(p.fetchDir, { recursive: true });
  const files = {};
  for (const [role, suffix] of Object.entries(FILES)) {
    const name = `${assembly}${suffix}`;
    const url = `${dirUrl}${assembly}/${name}`;
    const local = join(p.fetchDir, name);
    const body = await fetchBytes(url);
    if (!body && role === 'gff') throw new PipelineError('fetch', url, `${accession} has no annotation GFF`, 'this pipeline needs an annotated assembly; check for an annotated GCF_ (RefSeq) or newer GCA_ version');
    if (!body) throw new PipelineError('fetch', url, 'is missing on NCBI', 'check the accession');
    const digest = sha256(body);
    const recorded = previous?.files?.[role];
    if (recorded && recorded.sha256 !== digest) {
      throw new PipelineError('fetch', name, `NCBI's copy changed since ${previous.fetchedAt} (sha256 ${recorded.sha256} → ${digest})`, 'start a fresh --workDir to build from the new version');
    }
    if (!existsSync(local)) writeFileSync(local, body);
    else if (sha256File(local) !== digest) throw new PipelineError('fetch', local, 'differs from NCBI\'s copy', `delete ${local} and run fetch again`);
    files[role] = { name, url, sha256: digest };
  }
  const record = previous ?? { accession, assembly, fetchedAt: now(), files };
  writeJson(p.fetchJson, record);
  return record;
}

/** The fetch record and local paths, after checking every file against its sha256. */
export function verifyFetch(workDir, command) {
  const p = workPaths(workDir);
  const record = readJson(p.fetchJson, command, 'run fetch <assemblyAccession> first');
  const paths = {};
  for (const [role, file] of Object.entries(record.files)) {
    const path = join(p.fetchDir, file.name);
    if (!existsSync(path)) throw new PipelineError(command, path, 'is missing', 'run fetch again');
    if (sha256File(path) !== file.sha256) throw new PipelineError(command, path, 'does not match fetch/fetch.json', 'delete it and run fetch again');
    paths[role] = path;
  }
  return { record, paths };
}
