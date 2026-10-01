#!/usr/bin/env node
/**
 * request-revision.js - Sends a proposal that fails review or the loading
 * requirements back to its curator: comments the reason on the ticket and sets
 * its Status to Needs Revision.
 *
 * Usage: node request-revision.js <accession> "<reason>"
 */
import { parseArgs } from 'node:util';
import { loadConfig } from './lib/config.js';
import { createGit } from './lib/git-ops.js';
import { createTicketClient } from './lib/ticket/index.js';
import { requestRevision } from './lib/revision-ops.js';

async function main() {
  const { positionals } = parseArgs({ options: {}, allowPositionals: true });
  const [accession, reason] = positionals;
  if (!accession || positionals.length !== 2) { console.error('Usage: node request-revision.js <accession> "<reason>"'); process.exit(1); }
  const config = loadConfig();
  const result = await requestRevision({
    git: createGit(config.repoPath), ticket: createTicketClient(config), repoPath: config.repoPath, accession, reason
  });
  console.log(`Ticket: ${result.ticket.url} (revision)`);
}

main().catch(err => { console.error(`Error: ${err.message}`); process.exit(1); });
