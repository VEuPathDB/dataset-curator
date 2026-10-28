import { mkdirSync } from 'node:fs';
import { defaultExec } from './tools/exec.js';

const SSH_OPTIONS = ['-o', 'BatchMode=yes', '-o', 'ClearAllForwardings=yes'];
const quote = (s) => `'${s.replace(/'/g, `'\\''`)}'`;
export const PRESENT = '__dataset-curator-present__';

/**
 * Read-only access to paths on host over ssh and rsync; host null reads the
 * local filesystem the same way. Output after a PRESENT line marks a path that
 * exists, so a missing path is null rather than an error, and a login banner
 * before it is ignored.
 */
export function createRemote({ host, exec = defaultExec }) {
  const run = (script) => (host ? exec('ssh', [...SSH_OPTIONS, host, script]) : exec('sh', ['-c', script]));
  const present = (out) => {
    const line = `\n${PRESENT}\n`;
    const at = `\n${out}`.indexOf(line);
    return at < 0 ? null : out.slice(at + line.length - 1);
  };
  const where = (path) => (host ? `${host}:${path}` : path);
  return {
    where,
    list(path) {
      const out = present(run(`[ -d ${quote(path)} ] || exit 0; echo ${PRESENT}; ls -1A ${quote(path)}`));
      return out === null ? null : out.split('\n').filter(Boolean).sort();
    },
    readText(path) {
      return present(run(`[ -f ${quote(path)} ] || exit 0; echo ${PRESENT}; cat ${quote(path)}`));
    },
    pull(path, localDir) {
      mkdirSync(localDir, { recursive: true });
      exec('rsync', ['-a', '-e', `ssh ${SSH_OPTIONS.join(' ')}`, `${where(path)}/`, `${localDir}/`]);
    }
  };
}
