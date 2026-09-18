#!/usr/bin/env node
/**
 * publish-proposal.js - Commits, pushes, opens the PR and creates the ticket.
 *
 * Usage: node publish-proposal.js <accession> [--existing-ticket '<json from start-proposal>']
 */
import { parseArgs } from 'node:util';
import { loadConfig } from './lib/config.js';
import { createGit } from './lib/git-ops.js';
import { createTicketClient } from './lib/ticket/index.js';
import { publishProposal } from './lib/proposal-ops.js';

async function main() {
  const { values, positionals } = parseArgs({
    options: { 'existing-ticket': { type: 'string' } }, allowPositionals: true
  });
  const [accession] = positionals;
  if (!accession) { console.error('Usage: node publish-proposal.js <accession> [--existing-ticket <json>]'); process.exit(1); }
  const config = loadConfig();
  const git = createGit(config.repoPath);
  const ticket = createTicketClient(config);
  const existingTicket = values['existing-ticket'] ? JSON.parse(values['existing-ticket']) : undefined;
  const result = await publishProposal({ git, ticket, repoPath: config.repoPath, accession, existingTicket });
  console.log(`Pull request: ${result.prUrl}`);
  console.log(`Ticket:       ${result.ticket.url}`);
  console.log('Next: review and merge the pull request.');
}

main().catch(err => { console.error(`Error: ${err.message}`); process.exit(1); });
