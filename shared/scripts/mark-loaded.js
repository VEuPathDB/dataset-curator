#!/usr/bin/env node
/**
 * mark-loaded.js - After a proposal's load pull request has merged and the data
 * is checked, sets its ticket Done and notes the pull request on it.
 *
 * Usage: node mark-loaded.js <accession>
 */
import { parseArgs } from 'node:util';
import { loadConfig } from './lib/config.js';
import { createGit } from './lib/git-ops.js';
import { createTicketClient } from './lib/ticket/index.js';
import { markLoaded } from './lib/load-ops.js';

async function main() {
  const { positionals } = parseArgs({ options: {}, allowPositionals: true });
  const [accession] = positionals;
  if (!accession) { console.error('Usage: node mark-loaded.js <accession>'); process.exit(1); }
  const config = loadConfig();
  const result = await markLoaded({ git: createGit(config.repoPath), ticket: createTicketClient(config), accession });
  console.log(`Pull request: ${result.prUrl} (merged into ${result.base})`);
  console.log(`Ticket:       ${result.ticket.url} (done${result.alreadyDone ? ' already' : ''})`);
}

main().catch(err => { console.error(`Error: ${err.message}`); process.exit(1); });
