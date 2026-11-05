import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = join(tmpdir(), 'dataset-curator-tests');
const RUN_DIR = /^run-(\d+)-/;
let runDir;

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

function sweepStaleRuns() {
  for (const name of readdirSync(ROOT)) {
    const pid = RUN_DIR.exec(name)?.[1];
    if (pid && !isAlive(Number(pid))) rmSync(join(ROOT, name), { recursive: true, force: true });
  }
}

// Redirect tmpdir() for the test files and the CLIs they spawn, so one rmSync cleans up everything they create.
export function globalSetup() {
  mkdirSync(ROOT, { recursive: true });
  sweepStaleRuns();
  runDir = mkdtempSync(join(ROOT, `run-${process.pid}-`));
  process.env.TMPDIR = runDir;
}

export function globalTeardown() {
  rmSync(runDir, { recursive: true, force: true });
}
