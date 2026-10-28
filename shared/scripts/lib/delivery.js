import { mkdirSync, writeFileSync, cpSync, rmSync, renameSync, existsSync, readdirSync, readFileSync, symlinkSync, lstatSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { fromProviderOf } from './artifacts.js';
import { DELIVERY_RECORD } from './validation-workspace.js';

export const DELIVERY_SCHEMA_VERSION = 1;
const WORKSPACE = 'workspace';

const workspaceOf = (finalRelative) => join(dirname(finalRelative), WORKSPACE);

/** Every regular file under dir, relative, except the record and anything in a workspace/; symlinks are not followed. */
function filesUnder(dir, finals, at = '') {
  const skip = new Set([DELIVERY_RECORD, ...finals.map(workspaceOf)]);
  return readdirSync(join(dir, at)).sort().flatMap((name) => {
    const rel = join(at, name);
    if (skip.has(rel)) return [];
    const st = lstatSync(join(dir, rel));
    if (st.isDirectory()) return filesUnder(dir, finals, rel);
    return st.isFile() ? [rel] : [];
  });
}

/**
 * Builds the delivery tree beside dir and swaps it in, carrying over each
 * workspace/. Leftovers of an interrupted run are refused, never deleted,
 * since they may hold a workspace/. files maps paths
 * relative to @@manualDeliveryDir@@ to text. The first final's fromProvider
 * holds the proposal (as <accession>/) and the staging files; the others link
 * to it. Writes record plus the file list as delivery.json and returns it.
 */
export function writeDeliveryTree({ dir, finals, files, proposalDir, accession, stagingDir, record }) {
  const [home, ...others] = finals.map(fromProviderOf);
  const next = `${dir}.next`;
  const old = `${dir}.old`;
  for (const leftover of [next, old]) {
    if (existsSync(leftover)) {
      throw new Error(`${leftover} is left from an interrupted delivery and may hold a workspace/; move any workspace/ back into ${dir} by hand, then remove it`);
    }
  }
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(next, path)), { recursive: true });
    writeFileSync(join(next, path), text);
  }
  cpSync(proposalDir, join(next, home, accession), { recursive: true });
  if (stagingDir) cpSync(stagingDir, join(next, home), { recursive: true });
  for (const link of others) {
    mkdirSync(dirname(join(next, link)), { recursive: true });
    symlinkSync(relative(dirname(join(next, link)), join(next, home)), join(next, link));
  }
  const workspaces = finals.map(workspaceOf);
  const kept = workspaces.filter((ws) => existsSync(join(dir, ws)));
  for (const ws of workspaces.filter((w) => !kept.includes(w))) mkdirSync(join(next, ws), { recursive: true });
  const full = {
    ...record,
    files: filesUnder(next, finals).map((path) => ({ path, sha256: createHash('sha256').update(readFileSync(join(next, path))).digest('hex') }))
  };
  writeFileSync(join(next, DELIVERY_RECORD), JSON.stringify(full, null, 2) + '\n');
  mkdirSync(dirname(dir), { recursive: true });
  if (existsSync(dir)) renameSync(dir, old);
  renameSync(next, dir);
  for (const ws of kept) renameSync(join(old, ws), join(dir, ws));
  rmSync(old, { recursive: true, force: true });
  return full;
}

/** The copy a person runs; prepare-delivery prints it and mark-ready posts it. */
export function deliveryHandoff({ dir, manualDelivery }) {
  return [
    'Copy the delivery to the server; -a keeps the fromProvider links:',
    `  rsync -a --exclude ${DELIVERY_RECORD} ${dir}/ ${manualDelivery.host}:${manualDelivery.root}/`
  ].join('\n');
}
