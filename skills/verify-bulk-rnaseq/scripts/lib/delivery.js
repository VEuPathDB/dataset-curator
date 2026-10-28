import { mkdirSync, writeFileSync, cpSync, rmSync, renameSync, existsSync, readdirSync, readFileSync, symlinkSync, lstatSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { fromProviderOf } from './artifacts.js';
import { DELIVERY_RECORD } from './validation-workspace.js';
import { shellQuote } from './remote.js';

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

/** Moves each entry of from into to, copying where they are on different filesystems. */
function moveInto(from, to) {
  for (const name of readdirSync(from)) {
    try {
      renameSync(join(from, name), join(to, name));
    } catch (err) {
      if (err.code !== 'EXDEV') throw err;
      cpSync(join(from, name), join(to, name), { recursive: true, verbatimSymlinks: true });
    }
  }
}

const isRealDir = (path) => existsSync(path) && lstatSync(path).isDirectory();

/** Every workspace/ beside a final/ under dir, relative; common/ and symlinks are not followed. */
function workspacesUnder(dir, at = '') {
  const here = join(dir, at);
  if (!isRealDir(here)) return [];
  const names = readdirSync(here);
  const own = names.includes(WORKSPACE) && names.includes('final') && isRealDir(join(here, WORKSPACE)) && isRealDir(join(here, 'final'))
    ? [join(at, WORKSPACE)] : [];
  const deeper = names.filter((n) => n !== WORKSPACE && !(at === '' && n === 'common')).flatMap((n) => workspacesUnder(dir, join(at, n)));
  return [...own, ...deeper];
}

/**
 * Refuses what writeDeliveryTree would refuse, before anything is written:
 * leftovers of an interrupted run, or a non-empty workspace/ the new finals
 * would leave behind.
 */
export function assertDeliverable({ dir, finals }) {
  for (const leftover of [`${dir}.next`, `${dir}.old`]) {
    if (existsSync(leftover)) {
      throw new Error(`${leftover} is left from an interrupted delivery and may hold a workspace/; move any workspace/ back into ${dir} by hand, then remove it`);
    }
  }
  const workspaces = finals.map(workspaceOf);
  for (const ws of workspacesUnder(dir)) {
    if (workspaces.includes(ws) || !readdirSync(join(dir, ws)).length) continue;
    const organism = ws.split('/').slice(0, 2).join('/');
    const same = workspaces.find((w) => w.split('/').slice(0, 2).join('/') === organism) ?? (workspaces.length === 1 ? workspaces[0] : null);
    const target = same ? join(dir, same) : 'the new workspace/';
    throw new Error(`${join(dir, ws)} holds preprocessing output but this delivery no longer uses that path; move it to ${target} or remove it, then re-run`);
  }
}

/**
 * Builds the delivery tree beside dir and swaps it in, carrying over each
 * workspace/. Leftovers of an interrupted run are refused, never deleted,
 * since they may hold a workspace/. files maps paths
 * relative to @@manualDeliveryDir@@ to text. The first final's fromProvider
 * holds the proposal (as <accession>/) and the staging files, moved out of
 * stagingDir; the others link to it. Writes record plus the file list as delivery.json and returns it.
 */
export function writeDeliveryTree({ dir, finals, files, proposalDir, accession, stagingDir, record }) {
  const [home, ...others] = finals.map(fromProviderOf);
  const next = `${dir}.next`;
  const old = `${dir}.old`;
  assertDeliverable({ dir, finals });
  const workspaces = finals.map(workspaceOf);
  const kept = workspaces.filter((ws) => existsSync(join(dir, ws)));
  let full;
  try {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(next, path)), { recursive: true });
      writeFileSync(join(next, path), text);
    }
    cpSync(proposalDir, join(next, home, accession), { recursive: true, verbatimSymlinks: true });
    if (stagingDir) moveInto(stagingDir, join(next, home));
    for (const link of others) {
      mkdirSync(dirname(join(next, link)), { recursive: true });
      symlinkSync(relative(dirname(join(next, link)), join(next, home)), join(next, link));
    }
    for (const ws of workspaces.filter((w) => !kept.includes(w))) mkdirSync(join(next, ws), { recursive: true });
    full = {
      ...record,
      files: filesUnder(next, finals).map((path) => ({ path, sha256: createHash('sha256').update(readFileSync(join(next, path))).digest('hex') }))
    };
    writeFileSync(join(next, DELIVERY_RECORD), JSON.stringify(full, null, 2) + '\n');
  } catch (err) {
    rmSync(next, { recursive: true, force: true });
    throw err;
  }
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
    'Copy the delivery to the server; -l keeps the fromProvider links; permissions and directory times on the server are left alone:',
    `  rsync -rlt --omit-dir-times --exclude ${DELIVERY_RECORD} ${shellQuote(`${dir}/`)} ${manualDelivery.host}:${shellQuote(`${manualDelivery.root}/`)}`
  ].join('\n');
}
