import { basename, join } from 'node:path';
import { statSync } from 'node:fs';
import { defaultExec, failureOutput } from './tools/exec.js';
import { sha256File } from './file-hash.js';
import { PRESENT, SSH_OPTIONS, shellQuote } from './remote.js';

const PLAIN = /^[A-Za-z0-9_.-]+$/;
const plainName = (s) => PLAIN.test(s) && !s.startsWith('.');

/**
 * The curator tool's only remote write: copies localPath into <root>/<proposalId>/ on host (null: this machine).
 * The root must already exist. The same file already there is a no-op; a different file of that name is refused,
 * never overwritten, and the upload is re-checked by sha256 afterwards.
 * Returns { host, path, file, sha256, bytes, alreadyStaged }.
 */
export function stageFile({ host, root, proposalId, localPath, exec = defaultExec }) {
  if (!plainName(proposalId)) throw new Error(`proposal id "${proposalId}" must be a plain directory name`);
  const file = basename(localPath);
  if (!plainName(file)) throw new Error(`file name "${file}" must be a plain file name (letters, digits, _ . -)`);
  const sha256 = sha256File(localPath);
  const bytes = statSync(localPath).size;
  const dir = join(root, proposalId);
  const path = join(dir, file);
  const where = host ? `${host}:${dir}` : dir;
  const run = (script) => {
    try { return host ? exec('ssh', [...SSH_OPTIONS, host, script]) : exec('sh', ['-c', script]); }
    catch (e) {
      const hint = host && e.status === 255 ?`; needs passwordless ssh to ${host}; ask the data loaders` : '';
      throw new Error(`${where}: ${failureOutput(e)}${hint}`);
    }
  };
  const missingRoot = `staging root ${root} does not exist on ${host ?? 'this machine'}`;
  const remoteSha = () => {
    const out = run(`[ -d ${shellQuote(root)} ] || { echo ${shellQuote(missingRoot)} >&2; exit 3; }; [ -f ${shellQuote(path)} ] || exit 0; echo ${PRESENT}; sha256sum ${shellQuote(path)}`);
    const at = out.indexOf(`${PRESENT}\n`);
    return at < 0 ? null : out.slice(at + PRESENT.length + 1).split(/\s+/)[0];
  };
  const result = { host, path, file, sha256, bytes };
  const there = remoteSha();
  if (there === sha256) return { ...result, alreadyStaged: true };
  if (there !== null) throw new Error(`${where} already holds ${file} with a different sha256 (${there}); ask the data loaders before replacing it`);
  run(`mkdir -p ${shellQuote(dir)} && chmod 2775 ${shellQuote(dir)}`);
  const ssh = host ? ['-e', `ssh ${SSH_OPTIONS.join(' ')}`] : [];
  try { exec('rsync', ['-rt', '--copy-links', '--chmod=D2775,F664', '--ignore-existing', ...ssh, '--', localPath, `${where}/`]); }
  catch (e) { throw new Error(`${where}: ${failureOutput(e)}`); }
  const after = remoteSha();
  if (after !== sha256) throw new Error(`${where} ${after === null ? `lacks ${file}` : `holds ${file} with sha256 ${after}`} after upload, expected ${sha256}; re-run once your file is final; a data loader must remove ${host ? `${host}:${path}` : path}`);
  return { ...result, alreadyStaged: false };
}
