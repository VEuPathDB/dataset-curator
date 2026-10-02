#!/usr/bin/env node
/**
 * start-verification.js - Claims a merged proposal for verification: assigns its
 * issue to you and sets its ticket to Verification in progress. Optional;
 * mark-ready and request-revision work from Proposed too.
 *
 * Usage: node start-verification.js <accession>
 */
import { parseArgs } from 'node:util';
import { loadConfig } from './lib/config.js';
import { createGit } from './lib/git-ops.js';
import { createTicketClient } from './lib/ticket/index.js';
import { startVerification } from './lib/verification-ops.js';

async function main() {
  const { positionals } = parseArgs({ options: {}, allowPositionals: true });
  const [accession] = positionals;
  if (!accession || positionals.length !== 1) { console.error('Usage: node start-verification.js <accession>'); process.exit(1); }
  const config = loadConfig();
  const ticket = createTicketClient(config);
  const result = await startVerification({ git: createGit(config.repoPath), ticket, accession });
  if (result.notice) console.error(`Note: ${result.notice}`);
  console.log(`Ticket: ${result.ticket.url} (${ticket.statusOption('verifying')}, assigned to you)`);
}

main().catch(err => { console.error(`Error: ${err.message}`); process.exit(1); });
