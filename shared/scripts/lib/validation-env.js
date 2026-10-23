import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { defaultExec } from './tools/exec.js';
import { resolveApiCommonData } from './tools/apicommondata.js';
import { resolveStudyWrangler } from './tools/study-wrangler.js';

export const VALIDATION_ENV_FILENAME = 'validation-env.json';
const ASK = 'ask the data loader which validation workspace to use';

/**
 * The validation workspace the data loader named, described by its own
 * validation-env.json. Never guessed, searched for or defaulted.
 * Returns { workspace, path, values } or { error }.
 */
export function readValidationEnv(workspace) {
  if (!workspace) return { error: `No validation workspace given; ${ASK} and pass --workspace <dir>` };
  const dir = resolve(workspace);
  const path = join(dir, VALIDATION_ENV_FILENAME);
  if (!existsSync(path)) return { error: `${path} not found; ${ASK}` };
  let values;
  try { values = JSON.parse(readFileSync(path, 'utf-8')); }
  catch (e) { return { error: `${path} is not valid JSON: ${e.message}` }; }
  if (values?.schemaVersion !== 1) return { error: `${path}: schemaVersion must be 1` };
  return { workspace: dir, path, values };
}

const RESOLVERS = { apiCommonData: resolveApiCommonData, studyWrangler: resolveStudyWrangler };

/** resolveTool(name) -> { tool } | { missing }, cached; versions() of the tools resolved so far. */
export function createToolResolver(workspace, { exec = defaultExec } = {}) {
  const env = readValidationEnv(workspace);
  const cache = new Map();
  const resolveTool = (name) => {
    if (!cache.has(name)) {
      if (env.error) cache.set(name, { missing: env.error });
      else if (!RESOLVERS[name]) cache.set(name, { missing: `unknown tool "${name}"` });
      else cache.set(name, RESOLVERS[name](env, { exec }));
    }
    return cache.get(name);
  };
  const versions = () => Object.fromEntries([...cache].filter(([, r]) => r.tool).map(([name, r]) => [name, r.tool.version]));
  return { workspace: env.workspace ?? null, resolveTool, versions };
}
