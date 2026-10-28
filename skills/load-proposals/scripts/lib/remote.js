import { mkdirSync } from 'node:fs';
import { defaultExec } from './tools/exec.js';

const SSH_OPTIONS = ['-o', 'BatchMode=yes', '-o', 'ClearAllForwardings=yes'];
const quote = (s) => `'${s.replace(/'/g, `'\\''`)}'`;

/**
 * Read-only access to paths on host over ssh and rsync; host null reads the
 * local filesystem the same way. Output after a leading "+" line marks a path
 * that exists, so a missing path is null rather than an error.
 */
export function createRemote({ host, exec = defaultExec }) {
  const run = (script) => (host ? exec('ssh', [...SSH_OPTIONS, host, script]) : exec('sh', ['-c', script]));
  const present = (out) => (out.startsWith('+\n') ? out.slice(2) : null);
  const where = (path) => (host ? `${host}:${path}` : path);
  return {
    where,
    list(path) {
      const out = present(run(`[ -d ${quote(path)} ] || exit 0; echo +; ls -1A ${quote(path)}`));
      return out === null ? null : out.split('\n').filter(Boolean).sort();
    },
    readText(path) {
      return present(run(`[ -f ${quote(path)} ] || exit 0; echo +; cat ${quote(path)}`));
    },
    pull(path, localDir) {
      mkdirSync(localDir, { recursive: true });
      exec('rsync', ['-a', '-e', `ssh ${SSH_OPTIONS.join(' ')}`, `${where(path)}/`, `${localDir}/`]);
    }
  };
}
