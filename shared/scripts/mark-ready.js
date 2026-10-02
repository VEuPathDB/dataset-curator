#!/usr/bin/env node
/**
 * mark-ready.js - Records that a person verified a merged proposal: sets its
 * ticket to Ready to load, the only status load accepts, with an optional note.
 *
 * Usage: node mark-ready.js <accession> ["<note>"]
 */
import { parseArgs } from 'node:util';
import { loadConfig } from './lib/config.js';
import { createGit } from './lib/git-ops.js';
import { createTicketClient } from './lib/ticket/index.js';
import { markReady } from './lib/verification-ops.js';

async function main() {
  const { positionals } = parseArgs({ options: {}, allowPositionals: true });
  const [accession, note] = positionals;
  if (!accession || positionals.length > 2) { console.error('Usage: node mark-ready.js <accession> ["<note>"]'); process.exit(1); }
  const config = loadConfig();
  const ticket = createTicketClient(config);
  const result = await markReady({ git: createGit(config.repoPath), ticket, accession, note });
  if (result.notice) console.error(`Note: ${result.notice}`);
  console.log(`Ticket: ${result.ticket.url} (${ticket.statusOption('ready')})`);
}

main().catch(err => { console.error(`Error: ${err.message}`); process.exit(1); });
