import { existsSync, mkdtempSync, mkdirSync, symlinkSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { defaultExec, failureOutput } from './exec.js';

const SHIM = join(dirname(fileURLToPath(import.meta.url)), 'apicommondata-parse.pl');
export const PARSER_MODULES = ['AnalysisConfigParser.pm', 'AnalysisConfigRepeatFinder.pm'];

/** { tool: { path, libDir, perl, version } } or { missing }, from the workspace's validation-env.json. */
export function resolveApiCommonData(env, { exec = defaultExec } = {}) {
  const { apiCommonData, perl } = env.values;
  if (!apiCommonData) return { missing: `${env.path} has no "apiCommonData"` };
  if (!perl) return { missing: `${env.path} has no "perl"` };
  const perlPath = resolve(env.workspace, perl);
  if (!existsSync(perlPath)) return { missing: `perl not found at ${perlPath}` };
  const path = resolve(env.workspace, apiCommonData);
  const libDir = join(path, 'Load', 'lib', 'perl');
  const absent = PARSER_MODULES.filter((m) => !existsSync(join(libDir, m)));
  if (absent.length) return { missing: `${libDir} has no ${absent.join(', ')}` };
  let version;
  try { version = exec('git', ['-C', path, 'rev-parse', 'HEAD']).trim(); }
  catch { return { missing: `${path} is not a git checkout, so its version cannot be recorded` }; }
  return { tool: { path, libDir, perl: perlPath, version } };
}

/**
 * ApiCommonData's own reading of an analysisConfig.xml:
 * { steps: [{ class, arguments }], groups: [{ displayName, samples }] }.
 * The modules live under Load/lib/perl but are named ApiCommonData::Load::*,
 * so a scratch tree of symlinks gives Perl the path it expects.
 */
export function parseAnalysisConfig(tool, xmlPath, { exec = defaultExec } = {}) {
  const lib = mkdtempSync(join(tmpdir(), 'acd-lib-'));
  try {
    const target = join(lib, 'ApiCommonData', 'Load');
    mkdirSync(target, { recursive: true });
    for (const m of PARSER_MODULES) symlinkSync(join(tool.libDir, m), join(target, m));
    let out;
    try { out = exec(tool.perl, [SHIM, xmlPath], { env: { ...process.env, PERL5LIB: lib } }); }
    catch (e) { throw new Error(failureOutput(e)); }
    return JSON.parse(out);
  } finally {
    rmSync(lib, { recursive: true, force: true });
  }
}
