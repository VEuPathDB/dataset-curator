import { existsSync, readFileSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { defaultExec } from './tools/exec.js';
import { resolveApiCommonData } from './tools/apicommondata.js';
import { resolveStudyWrangler } from './tools/study-wrangler.js';

export const ASK = 'ask the data loader which validation workspace root to use';
export const ENV_FILENAME = 'env.json';

/** A type directory's env.json, checked against schema v2: { values } or { error }. */
export function readEnvJson(typeDir) {
  const path = join(typeDir, ENV_FILENAME);
  if (!existsSync(path)) return { error: `${path} not found; ${ASK}` };
  let values;
  try { values = JSON.parse(readFileSync(path, 'utf-8')); }
  catch (e) { return { error: `${path} is not valid JSON: ${e.message}` }; }
  const problem = envProblem(values);
  return problem ? { error: `${path}: ${problem}` } : { values };
}

const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const RESERVED = ['.', '..', 'build'];

function envProblem(v) {
  if (v?.schemaVersion === 1) return 'schemaVersion 1 is the old flat validation-env.json; rewrite it as schemaVersion 2 (repos, executables, build)';
  if (v?.schemaVersion !== 2) return 'schemaVersion must be 2';
  if (!isObject(v.repos)) return '"repos" must be an object of { url, ref, followsRebuild? }';
  for (const [name, r] of Object.entries(v.repos)) {
    if (!/^[A-Za-z0-9._-]+$/.test(name) || RESERVED.includes(name)) return `repo name "${name}" must be a plain directory name other than build`;
    if (typeof r?.url !== 'string' || typeof r?.ref !== 'string') return `repos.${name} needs string "url" and "ref"`;
    if (r.followsRebuild !== undefined && typeof r.followsRebuild !== 'boolean') return `repos.${name}.followsRebuild must be true or false`;
  }
  if (!isObject(v.executables)) return '"executables" must be an object of absolute paths';
  for (const [name, p] of Object.entries(v.executables)) {
    if (typeof p !== 'string' || !isAbsolute(p)) return `executables.${name} must be an absolute path`;
  }
  if (v.build !== undefined && !(Array.isArray(v.build) && v.build.every((c) => typeof c === 'string'))) return '"build" must be an array of shell commands';
  return null;
}

const RESOLVERS = { apiCommonData: resolveApiCommonData, studyWrangler: resolveStudyWrangler };

/**
 * resolveTool(name) -> { tool } | { missing }, cached, for a workspace handle
 * (or its { error }); versions() of the tools resolved so far; repos() the
 * ref and commit of each worktree.
 */
export function createToolResolver(ws, { exec = defaultExec } = {}) {
  const cache = new Map();
  const resolveTool = (name) => {
    if (!cache.has(name)) {
      if (ws.error) cache.set(name, { missing: ws.error });
      else if (!RESOLVERS[name]) cache.set(name, { missing: `unknown tool "${name}"` });
      else cache.set(name, RESOLVERS[name](ws, { exec }));
    }
    return cache.get(name);
  };
  const versions = () => Object.fromEntries([...cache].filter(([, r]) => r.tool).map(([name, r]) => [name, r.tool.version]));
  const repos = () => ws.error ? {} : Object.fromEntries(Object.entries(ws.repos).map(([name, r]) => [name, { ref: r.ref, sha: r.sha }]));
  return { workspace: ws.dir ?? null, resolveTool, versions, repos };
}
