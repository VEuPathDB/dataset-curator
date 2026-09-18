#!/usr/bin/env node
/**
 * start-proposal.js - Checks preconditions and creates proposal/<accession>.
 *
 * Usage: node start-proposal.js <accession>
 * Prints JSON: { "mode": "new" } or { "mode": "update", "existingTicket": {...} }
 */
import { loadConfig } from './lib/config.js';
import { createGit } from './lib/git-ops.js';
import { createTicketClient } from './lib/ticket/index.js';
import { startProposal } from './lib/proposal-ops.js';

async function main() {
  const [accession] = process.argv.slice(2);
  if (!accession) { console.error('Usage: node start-proposal.js <accession>'); process.exit(1); }
  const config = loadConfig();
  const git = createGit(config.repoPath);
  const ticket = createTicketClient(config);
  const result = await startProposal({ git, ticket, accession });
  console.log(JSON.stringify(result, null, 2));
  console.error(`On branch proposal/${accession} (${result.mode})`);
}

main().catch(err => { console.error(`Error: ${err.message}`); process.exit(1); });
