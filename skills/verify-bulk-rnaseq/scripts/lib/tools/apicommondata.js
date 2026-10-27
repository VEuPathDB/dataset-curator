import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultExec, failureOutput } from './exec.js';

const SHIM = join(dirname(fileURLToPath(import.meta.url)), 'apicommondata-parse.pl');
const REPO = 'ApiCommonData';
export const PARSER_MODULES = ['AnalysisConfigParser.pm', 'AnalysisConfigRepeatFinder.pm'];

/** { tool: { libDir, perl, env, version } } or { missing }, from the validation workspace's build. */
export function resolveApiCommonData(ws) {
  const { perl } = ws.executables;
  if (!perl) return { missing: 'env.json has no executables.perl' };
  if (!existsSync(perl)) return { missing: `perl not found at ${perl}` };
  const repo = ws.repos[REPO];
  if (!repo) return { missing: `env.json lists no ${REPO} repo` };
  const libDir = join(ws.buildDir, 'lib', 'perl');
  const modules = join(libDir, 'ApiCommonData', 'Load');
  const absent = PARSER_MODULES.filter((m) => !existsSync(join(modules, m)));
  if (absent.length) return { missing: `${modules} has no ${absent.join(', ')}; does the build install ApiCommonData?` };
  return { tool: { libDir, perl, env: ws.env, version: repo.sha } };
}

/** ApiCommonData's own reading of an analysisConfig.xml: { steps: [{ class, arguments }], groups: [{ displayName, samples }] }. */
export function parseAnalysisConfig(tool, xmlPath, { exec = defaultExec } = {}) {
  let out;
  try { out = exec(tool.perl, [SHIM, xmlPath], { env: tool.env }); }
  catch (e) { throw new Error(failureOutput(e)); }
  return JSON.parse(out);
}
