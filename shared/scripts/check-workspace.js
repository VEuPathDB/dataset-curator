#!/usr/bin/env node
/**
 * check-workspace.js - Confirms the current directory is the top of a
 * VEuPathDatasets checkout and prepares .curation/ for scratch files.
 *
 * Usage: node check-workspace.js
 */
import { realpathSync } from 'node:fs';
import { openWorkspace } from './lib/config.js';

try {
  const config = openWorkspace();
  if (realpathSync(process.cwd()) !== realpathSync(config.repoPath)) {
    throw new Error(`Run from the top of the checkout, where .curation/ lives:\n  cd '${config.repoPath}'`);
  }
  console.log(`Workspace: ${config.repoPath}`);
  console.log(`Scratch:   ${config.scratchPath} (ignored via .git/info/exclude)`);
  console.log(`Config:    ${config.configPath}`);
  console.log(`Tickets:   ${config.ticket.system}`);
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exit(1);
}
