import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const TICKET_SYSTEMS = ['redmine', 'github'];
export const CONFIG_FILENAME = 'curator.config.json';

/**
 * Loads curator.config.json from the curation workspace directory and
 * resolves derived paths. Throws with actionable messages on any problem.
 */
export function loadConfig(cwd = process.cwd()) {
  const path = join(cwd, CONFIG_FILENAME);
  if (!existsSync(path)) {
    throw new Error(
      `${CONFIG_FILENAME} not found in ${cwd}.\n` +
      `Copy curator.config.example.json from the dataset-curator repository to ${path} and edit it.`
    );
  }
  const raw = JSON.parse(readFileSync(path, 'utf-8'));
  const cfg = { veupathdbRepos: 'veupathdb-repos', ...raw };

  if (!cfg.ticket || !TICKET_SYSTEMS.includes(cfg.ticket.system)) {
    throw new Error(`ticket.system must be one of ${TICKET_SYSTEMS.join(', ')}`);
  }
  if (!cfg.ticket[cfg.ticket.system]) {
    throw new Error(`ticket.${cfg.ticket.system} is required when ticket.system is "${cfg.ticket.system}"`);
  }

  cfg.workspace = resolve(cwd);
  cfg.repoPath = join(cfg.workspace, cfg.veupathdbRepos, 'VEuPathDatasets');
  return cfg;
}
