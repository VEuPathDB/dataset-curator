import { createHash } from 'node:crypto';
import { createWriteStream, mkdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const LISTING_TIMEOUT_MS = 60 * 1000;
export const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;

/** The released site's GFF directory for an organism, under Current_Release or a pinned release-<N>. */
export const gffDirectoryUrl = (project, nameForFiles, release = 'Current_Release') =>
  `https://${project.toLowerCase()}.org/common/downloads/${release}/${encodeURIComponent(nameForFiles)}/gff/data/`;

export function pickGff(html, dirUrl) {
  const names = [...new Set([...html.matchAll(/href="([^"/?#]+\.gff)"/g)].map((m) => m[1]))];
  if (names.length !== 1) throw new Error(`${dirUrl} lists ${names.length} .gff files (${names.join(', ') || 'none'}); expected one`);
  return names[0];
}

/** PlasmoDB-68_Pfalciparum3D7.gff → "68". */
export function releaseOf(file) {
  const release = /-(\d+)_/.exec(file)?.[1];
  if (!release) throw new Error(`${file}: no release number in the name`);
  return release;
}

const failure = (url, e) => new Error(`${url}: ${e.cause?.code ?? e.message}`);

async function request(fetchImpl, url, timeoutMs) {
  let res;
  try {
    res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    throw failure(url, e);
  }
  if (res.status !== 200) throw new Error(`${url}: HTTP ${res.status}`);
  return res;
}

/**
 * Lists the organism's GFF directory, then streams the one GFF into destDir while hashing it, so a large annotation
 * never sits in memory. pinnedUrl names the same file under its release, which outlives Current_Release.
 */
export async function fetchReleasedGff({ project, nameForFiles, destDir, fetchImpl = fetch }) {
  const dir = gffDirectoryUrl(project, nameForFiles);
  const listing = await request(fetchImpl, dir, LISTING_TIMEOUT_MS);
  const file = pickGff(await listing.text().catch((e) => { throw failure(dir, e); }), dir);
  const release = releaseOf(file);
  const url = `${dir}${file}`;
  const res = await request(fetchImpl, url, DOWNLOAD_TIMEOUT_MS);
  mkdirSync(destDir, { recursive: true });
  const path = join(destDir, file);
  const part = `${path}.part`;
  const hash = createHash('sha256');
  const tap = new Transform({ transform(chunk, _enc, done) { hash.update(chunk); done(null, chunk); } });
  try {
    await pipeline(Readable.fromWeb(res.body), tap, createWriteStream(part));
  } catch (e) {
    rmSync(part, { force: true });
    throw failure(url, e);
  }
  renameSync(part, path);
  return { url, pinnedUrl: `${gffDirectoryUrl(project, nameForFiles, `release-${release}`)}${file}`, file, release, path, sha256: hash.digest('hex') };
}
