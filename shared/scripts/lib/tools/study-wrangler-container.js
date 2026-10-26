import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultExec, failureOutput } from './exec.js';

export const STUDY_WRANGLER_VERSION = '1.0.53';
export const STUDY_WRANGLER_IMAGE = `veupathdb/study-wrangler:${STUDY_WRANGLER_VERSION}`;

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'study-wrangler-validate-study.R');

/** 'docker' | 'podman' | null: the first engine that answers `version`; only `preferred` if given. */
export function detectEngine({ exec = defaultExec, preferred } = {}) {
  for (const engine of preferred ? [preferred] : ['docker', 'podman']) {
    try { exec(engine, ['version']); return engine; }
    catch { /* not installed, or its daemon is down */ }
  }
  return null;
}

/** Arguments for `<engine> ...`. Read-only mounts, so nothing is written as root; never pulls the image. */
export function containerArgs(engine, stfDir, scriptPath) {
  const z = engine === 'podman' ? ',Z' : ''; // SELinux relabel
  return [
    'run', '--rm', '--pull=never',
    '-v', `${resolve(stfDir)}:/stf:ro${z}`,
    '-v', `${resolve(scriptPath)}:/sw/validate-study.R:ro${z}`,
    STUDY_WRANGLER_IMAGE, 'Rscript', '/sw/validate-study.R', '/stf'
  ];
}

/** Validates an STF directory in the pinned container: { status: 'pass' | 'fail' | 'load-error', output }. */
export function validateStudyInContainer(stfDir, { engine = detectEngine(), exec = defaultExec } = {}) {
  if (!engine) throw new Error('No container engine (docker or podman) found');
  let output;
  try { output = exec(engine, containerArgs(engine, stfDir, SCRIPT)).trim(); }
  catch (e) { output = failureOutput(e); }
  // the engine's own failures (no image, no daemon) carry no marker either
  const status = /^STF_VALIDATION: PASS\s*$/m.test(output) ? 'pass'
    : /^STF_VALIDATION: FAIL\s*$/m.test(output) ? 'fail' : 'load-error';
  return { status, output };
}
