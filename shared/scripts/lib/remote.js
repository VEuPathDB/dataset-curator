import { mkdirSync } from 'node:fs';
import { defaultExec, failureOutput } from './tools/exec.js';

const SSH_OPTIONS = ['-o', 'BatchMode=yes', '-o', 'ClearAllForwardings=yes'];
export const shellQuote = (s) => `'${s.replace(/'/g, `'\\''`)}'`;
export const PRESENT = '__dataset-curator-present__';

/**
 * Read-only access to paths on host over ssh and rsync; host null reads the
 * local filesystem the same way. Output after a PRESENT line marks a path that
 * exists, so a missing path is null rather than an error, and a login banner
 * before it is ignored.
 */
export function createRemote({ host, exec = defaultExec }) {
  const where = (path) => (host ? `${host}:${path}` : path);
  const naming = (path, fn) => {
    try { return fn(); } catch (e) { throw new Error(`${where(path)}: ${failureOutput(e)}`); }
  };
  const run = (path, script) => naming(path, () => (host ? exec('ssh', [...SSH_OPTIONS, host, script]) : exec('sh', ['-c', script])));
  const present = (out) => {
    const line = `\n${PRESENT}\n`;
    const at = `\n${out}`.indexOf(line);
    return at < 0 ? null : out.slice(at + line.length - 1);
  };
  return {
    where,
    list(path) {
      const out = present(run(path, `[ -d ${shellQuote(path)} ] || exit 0; echo ${PRESENT}; ls -1A ${shellQuote(path)}`));
      return out === null ? null : out.split('\n').filter(Boolean).sort();
    },
    readText(path) {
      return present(run(path, `[ -f ${shellQuote(path)} ] || exit 0; echo ${PRESENT}; cat ${shellQuote(path)}`));
    },
    pull(path, localDir) {
      mkdirSync(localDir, { recursive: true });
      naming(path, () => exec('rsync', ['-a', '--delete', '-e', `ssh ${SSH_OPTIONS.join(' ')}`, `${where(path)}/`, `${localDir}/`]));
    }
  };
}
