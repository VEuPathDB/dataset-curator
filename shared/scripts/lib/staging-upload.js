import { basename, join } from 'node:path';
import { statSync } from 'node:fs';
import { defaultExec, failureOutput } from './tools/exec.js';
import { sha256File } from './file-hash.js';
import { PRESENT, SSH_OPTIONS, shellQuote } from './remote.js';

const PLAIN = /^[A-Za-z0-9_.-]+$/;

/**
 * The curator tool's only remote write: copies localPath into <root>/<proposalId>/ on host (null: this machine).
 * The same file already there is a no-op; a different file of that name is refused, never overwritten.
 * Returns { host, path, file, sha256, bytes, alreadyStaged }.
 */
export function stageFile({ host, root, proposalId, localPath, exec = defaultExec }) {
  if (!PLAIN.test(proposalId) || proposalId.startsWith('.')) throw new Error(`proposal id "${proposalId}" must be a plain directory name`);
  const file = basename(localPath);
  const sha256 = sha256File(localPath);
  const bytes = statSync(localPath).size;
  const dir = join(root, proposalId);
  const path = join(dir, file);
  const where = host ? `${host}:${dir}` : dir;
  const run = (script) => {
    try { return host ? exec('ssh', [...SSH_OPTIONS, host, script]) : exec('sh', ['-c', script]); }
    catch (e) { throw new Error(`${where}: ${failureOutput(e)}`); }
  };
  const out = run(`[ -f ${shellQuote(path)} ] || exit 0; echo ${PRESENT}; sha256sum ${shellQuote(path)}`);
  const at = out.indexOf(`${PRESENT}\n`);
  const there = at < 0 ? null : out.slice(at + PRESENT.length + 1).split(/\s+/)[0];
  const result = { host, path, file, sha256, bytes };
  if (there === sha256) return { ...result, alreadyStaged: true };
  if (there !== null) throw new Error(`${where} already holds ${file} with a different sha256 (${there}); ask the data loaders before replacing it`);
  run(`mkdir -p ${shellQuote(dir)}`);
  const ssh = host ? ['-e', `ssh ${SSH_OPTIONS.join(' ')}`] : [];
  try { exec('rsync', ['-a', '--chmod=F644', ...ssh, localPath, `${where}/`]); }
  catch (e) { throw new Error(`${where}: ${failureOutput(e)}`); }
  return { ...result, alreadyStaged: false };
}
