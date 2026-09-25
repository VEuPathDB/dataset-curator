import { readFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TICKET_SYSTEMS = ['redmine', 'github'];
export const CONFIG_FILENAME = 'curator.config.json';
export const SCRATCH_DIR = '.curation';
export const DEFAULT_CONFIG_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'resources', CONFIG_FILENAME);
const MARKER = join('Model', 'lib', 'xml', 'datasetPresenters');

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** The top of the VEuPathDatasets checkout containing cwd. */
export function findRepoRoot(cwd = process.cwd()) {
  let root;
  try { root = git(cwd, 'rev-parse', '--show-toplevel'); }
  catch { throw new Error(`${resolve(cwd)} is not inside a git checkout. Run from a VEuPathDatasets clone:\n  git clone git@github.com:VEuPathDB/VEuPathDatasets.git`); }
  if (!existsSync(join(root, MARKER))) {
    throw new Error(`${root} is not a VEuPathDatasets checkout (no ${MARKER}/). Run from a VEuPathDatasets clone.`);
  }
  return root;
}

/**
 * Loads the plugin's curator.config.json, or .curation/curator.config.json in
 * the checkout when present, and resolves the repository path. No side effects.
 */
export function loadConfig(cwd = process.cwd(), { defaultPath = DEFAULT_CONFIG_PATH } = {}) {
  const repoPath = findRepoRoot(cwd);
  const override = join(repoPath, SCRATCH_DIR, CONFIG_FILENAME);
  const path = existsSync(override) ? override : defaultPath;
  if (!existsSync(path)) throw new Error(`${CONFIG_FILENAME} not found at ${path}; the plugin installation is incomplete.`);
  let cfg;
  try {
    cfg = JSON.parse(readFileSync(path, 'utf-8'));
  } catch (e) {
    throw new Error(`${path} is not valid JSON: ${e.message}`);
  }

  if (!cfg.ticket || !TICKET_SYSTEMS.includes(cfg.ticket.system)) {
    throw new Error(`${path}: ticket.system must be one of ${TICKET_SYSTEMS.join(', ')}`);
  }
  if (!cfg.ticket[cfg.ticket.system]) {
    throw new Error(`${path}: ticket.${cfg.ticket.system} is required when ticket.system is "${cfg.ticket.system}"`);
  }

  cfg.configPath = path;
  cfg.repoPath = repoPath;
  cfg.scratchPath = join(repoPath, SCRATCH_DIR);
  return cfg;
}

/**
 * loadConfig, plus the one side effect every lifecycle script needs first:
 * .curation/ exists and is ignored through this clone's info/exclude, so
 * scratch files never make the working tree dirty.
 */
export function openWorkspace(cwd = process.cwd(), opts) {
  const cfg = loadConfig(cwd, opts);
  mkdirSync(join(cfg.scratchPath, 'tmp'), { recursive: true });
  let exclude = git(cfg.repoPath, 'rev-parse', '--git-path', 'info/exclude');
  if (!isAbsolute(exclude)) exclude = join(cfg.repoPath, exclude);
  const entry = `/${SCRATCH_DIR}/`;
  const current = existsSync(exclude) ? readFileSync(exclude, 'utf-8') : '';
  if (!current.split('\n').includes(entry)) {
    mkdirSync(dirname(exclude), { recursive: true });
    appendFileSync(exclude, `${current && !current.endsWith('\n') ? '\n' : ''}${entry}\n`);
  }
  return cfg;
}
