import { closeSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { dirname, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { failureOutput } from '../../lib/tools/exec.js';
import { PipelineError } from '../workdir.js';

export const WORK = '/work';
export const inWork = (...parts) => posix.join(WORK, ...parts);
export const SELECT_ROWS_SCRIPT = fileURLToPath(new URL('./selectRows.pl', import.meta.url));
export const SELECT_ROWS_MOUNT = '/opt/curator/selectRows.pl';
const MAX_BUFFER = 512 * 1024 * 1024;
const ALG_INVOCATION = /^[^\t\n]*\tAlgInvocationId\t(\d+)$/m;
const UNESCAPE = { '\\': '\\', t: '\t', n: '\n', r: '\r' };

export const hostUser = () => `${process.getuid()}:${process.getgid()}`;
export const tail = (text, lines = 20) => text.trimEnd().split('\n').slice(-lines).join('\n');
const dockerMissing = () => new PipelineError('trial', 'docker', 'is not on PATH', 'install Docker or put it on PATH');

export function dockerRunArgs(ctx, command, { stdin = false, mounts = [] } = {}) {
  return [
    'run', '--rm', '--network', 'host', '-u', ctx.user, '-e', 'HOME=/tmp',
    '-v', `${ctx.gusConfig}:${ctx.gusHome}/config/gus.config:ro`, '-v', `${ctx.workDir}:${WORK}`, '-w', WORK,
    ...mounts.flatMap((mount) => ['-v', mount]), ...(stdin ? ['-i'] : []),
    ctx.image, ...command
  ];
}

/** ga's Plugin::log writes `<scalar localtime>\tAlgInvocationId\t<id>` to stderr once its invocation row exists. */
export function parseAlgInvocationId(log) {
  const match = log.match(ALG_INVOCATION);
  return match ? Number(match[1]) : null;
}

/** Runs docker with stdout and stderr in `logPath`. Only the exit status says whether it worked. */
export function runLogged(args, logPath, { exec }) {
  mkdirSync(dirname(logPath), { recursive: true });
  const fd = openSync(logPath, 'w');
  let exitCode = 0;
  try {
    exec('docker', args, { stdio: ['ignore', fd, fd] });
  } catch (e) {
    if (e.code === 'ENOENT') throw dockerMissing();
    exitCode = typeof e.status === 'number' ? e.status : 1;
  } finally {
    closeSync(fd);
  }
  return { exitCode, log: readFileSync(logPath, 'utf-8') };
}

export function runGa(ctx, { plugin, args }, logPath, { exec }) {
  const { exitCode, log } = runLogged(dockerRunArgs(ctx, ['ga', plugin, ...args]), logPath, { exec });
  return { exitCode, algInvocationId: parseAlgInvocationId(log), log };
}

const unescapeValue = (value) => (value === '\\N' ? null : value.replace(/\\([\\tnr])/g, (_, c) => UNESCAPE[c]));

/** selectRows output: a header line, then one line per row. */
export function parseTsv(text) {
  const lines = text.replace(/\n$/, '').split('\n');
  if (lines.length === 1 && lines[0] === '') return [];
  const [header, ...rows] = lines;
  const names = header.split('\t');
  return rows.map((row) => Object.fromEntries(row.split('\t').map((value, i) => [names[i], unescapeValue(value)])));
}

export function selectRows(ctx, sql, { exec, mounted = false }) {
  const command = ['perl', mounted ? SELECT_ROWS_MOUNT : posix.join(ctx.gusHome, 'bin/selectRows')];
  const mounts = mounted ? [`${SELECT_ROWS_SCRIPT}:${SELECT_ROWS_MOUNT}:ro`] : [];
  let out;
  try {
    out = exec('docker', dockerRunArgs(ctx, command, { stdin: true, mounts }), { input: sql, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: MAX_BUFFER });
  } catch (e) {
    if (e.code === 'ENOENT') throw dockerMissing();
    throw new PipelineError('trial', 'selectRows', `${sql.split('\n')[0]} failed: ${failureOutput(e)}`,
      'check that the mounted gus.config reaches the database, then run trial again');
  }
  return parseTsv(out);
}

export function inspectImage(name, { exec }) {
  let out;
  try {
    out = exec('docker', ['image', 'inspect', name]);
  } catch (e) {
    if (e.code === 'ENOENT') throw dockerMissing();
    if (/No such image/i.test(failureOutput(e))) return null;
    throw new PipelineError('trial', name, `docker image inspect failed: ${failureOutput(e)}`, 'check that Docker is running');
  }
  const [info] = JSON.parse(out);
  const env = Object.fromEntries((info.Config?.Env ?? []).map((kv) => [kv.slice(0, kv.indexOf('=')), kv.slice(kv.indexOf('=') + 1)]));
  return { id: info.Id, gusHome: env.GUS_HOME ?? null, labels: info.Config?.Labels ?? {} };
}

export function readImageFile(image, path, { exec }) {
  try {
    return exec('docker', ['run', '--rm', image, 'cat', path]);
  } catch (e) {
    if (e.code === 'ENOENT') throw dockerMissing();
    return null;
  }
}
