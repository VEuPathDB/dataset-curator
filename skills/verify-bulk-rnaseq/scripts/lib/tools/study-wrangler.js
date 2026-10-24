import { existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultExec, failureOutput } from './exec.js';

const SHIM = join(dirname(fileURLToPath(import.meta.url)), 'study-wrangler-validate.R');
export const MIN_STUDY_WRANGLER = '1.0.41';

const compareVersions = (a, b) => {
  const [x, y] = [a, b].map((v) => v.split('.').map(Number));
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d;
  }
  return 0;
};

/** { tool: { rscript, env, version } } or { missing }, from the workspace's validation-env.json. */
export function resolveStudyWrangler(env, { exec = defaultExec } = {}) {
  const { rscript, rLibs } = env.values;
  if (!rscript) return { missing: `${env.path} has no "rscript"` };
  const path = resolve(env.workspace, rscript);
  if (!existsSync(path)) return { missing: `Rscript not found at ${path}` };
  const libs = rLibs ? resolve(env.workspace, rLibs) : null;
  const rEnv = libs ? { ...process.env, R_LIBS: libs } : { ...process.env };
  let version;
  try { version = exec(path, ['-e', 'cat(as.character(packageVersion("study.wrangler")))'], { env: rEnv }).trim(); }
  catch { return { missing: `study.wrangler is not installed for ${path}${libs ? ` with R_LIBS=${libs}` : ''}` }; }
  if (compareVersions(version, MIN_STUDY_WRANGLER) < 0) return { missing: `study.wrangler ${version} is older than ${MIN_STUDY_WRANGLER}` };
  return { tool: { rscript: path, env: rEnv, version } };
}

/** study.wrangler's entity_from_stf + validate on one entity: { ok, output }. */
export function validateEntity(tool, tsvPath, yamlPath, { exec = defaultExec } = {}) {
  try { return { ok: true, output: exec(tool.rscript, [SHIM, tsvPath, yamlPath], { env: tool.env }).trim() }; }
  catch (e) { return { ok: false, output: failureOutput(e) }; }
}
