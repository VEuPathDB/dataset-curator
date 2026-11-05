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
const FILE_MAX_BUFFER = 64 * 1024 * 1024;
const ALG_INVOCATION = /^[^\t\n]*\tAlgInvocationId\t(\d+)$/m;
const UNESCAPE = { '\\': '\\', t: '\t', n: '\n', r: '\r' };

export const hostUser = () => `${process.getuid()}:${process.getgid()}`;
export const tail = (text, lines = 20) => text.trimEnd().split('\n').slice(-lines).join('\n');
const dockerMissing = () => new PipelineError('trial', 'docker', 'is not on PATH', 'install Docker or put it on PATH');

/** A --mount value; unlike -v it takes host paths with a colon, but a comma would split its fields. */
export function bindMount(src, dst, { readonly = false } = {}) {
  if (/[,"]/.test(src)) {
    throw new PipelineError('trial', src, 'has a comma or quote, which docker --mount cannot take', 'move the file to a path without one');
  }
  return `type=bind,src=${src},dst=${dst}${readonly ? ',readonly' : ''}`;
}

export function dockerRunArgs(ctx, command, { stdin = false, mounts = [] } = {}) {
  for (const key of ['user', 'gusConfig', 'workDir']) {
    if (!ctx[key]) throw new PipelineError('trial', 'docker', `run context has no ${key}`, 'pass it when building the context');
  }
  return [
    'run', '--rm', '--pull', 'never', '--network', 'host', '-u', ctx.user, '-e', 'HOME=/tmp',
    '--mount', bindMount(ctx.gusConfig, `${ctx.gusHome}/config/gus.config`, { readonly: true }),
    '--mount', bindMount(ctx.workDir, WORK), '-w', WORK,
    ...mounts.flatMap(({ src, dst }) => ['--mount', bindMount(src, dst, { readonly: true })]), ...(stdin ? ['-i'] : []),
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
    if (typeof e.status !== 'number') {
      throw new PipelineError('trial', 'docker', `could not be run: ${e.code ?? e.signal ?? e.message}`, 'check that Docker is installed and running');
    }
    exitCode = e.status;
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
  if (new Set(names).size !== names.length) throw new PipelineError('trial', 'selectRows', `returned duplicate column names: ${names.join(', ')}`, 'alias the columns in the query');
  return rows.map((row, n) => {
    const values = row.split('\t');
    if (values.length !== names.length) {
      throw new PipelineError('trial', 'selectRows', `row ${n + 1} has ${values.length} fields for ${names.length} columns`, 'check the query output');
    }
    return Object.fromEntries(values.map((value, i) => [names[i], unescapeValue(value)]));
  });
}

export function selectRows(ctx, sql, { exec, mounted = false }) {
  const command = ['perl', mounted ? SELECT_ROWS_MOUNT : posix.join(ctx.gusHome, 'bin/selectRows')];
  const mounts = mounted ? [{ src: SELECT_ROWS_SCRIPT, dst: SELECT_ROWS_MOUNT }] : [];
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
    return exec('docker', ['run', '--rm', '--pull', 'never', '--entrypoint', 'cat', image, path], { maxBuffer: FILE_MAX_BUFFER });
  } catch (e) {
    if (e.code === 'ENOENT') throw dockerMissing();
    const output = failureOutput(e);
    if (/No such file or directory/.test(output)) return null;
    throw new PipelineError('trial', image, `could not read ${path}: ${output}`, 'check that Docker is running and the image exists');
  }
}
