import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
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

/** { tool: { rscript, env, version } } or { missing }, from the validation workspace's build. */
export function resolveStudyWrangler(ws, { exec = defaultExec } = {}) {
  const { rscript } = ws.executables;
  if (!rscript) return { missing: 'env.json has no executables.rscript' };
  if (!existsSync(rscript)) return { missing: `Rscript not found at ${rscript}` };
  let version;
  try { version = exec(rscript, ['-e', 'cat(as.character(packageVersion("study.wrangler")))'], { env: ws.env }).trim(); }
  catch { return { missing: `study.wrangler is not installed in ${ws.env.R_LIBS} for ${rscript}` }; }
  if (compareVersions(version, MIN_STUDY_WRANGLER) < 0) return { missing: `study.wrangler ${version} is older than ${MIN_STUDY_WRANGLER}` };
  return { tool: { rscript, env: ws.env, version } };
}

/** study.wrangler's entity_from_stf + validate on one entity: { ok, output }. */
export function validateEntity(tool, tsvPath, yamlPath, { exec = defaultExec } = {}) {
  try { return { ok: true, output: exec(tool.rscript, [SHIM, tsvPath, yamlPath], { env: tool.env }).trim() }; }
  catch (e) { return { ok: false, output: failureOutput(e) }; }
}
