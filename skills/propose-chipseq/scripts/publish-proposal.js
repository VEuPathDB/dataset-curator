#!/usr/bin/env node
/**
 * publish-proposal.js - Commits, pushes, opens the PR and creates the ticket.
 * Re-running after a failure resumes where the last run stopped.
 *
 * Usage: node publish-proposal.js <accession> [--build NN]
 */
import { parseArgs } from 'node:util';
import { openWorkspace } from './lib/config.js';
import { createGit } from './lib/git-ops.js';
import { createTicketClient } from './lib/ticket/index.js';
import { publishProposal } from './lib/proposal-ops.js';

async function main() {
  const { values, positionals } = parseArgs({ options: { build: { type: 'string' } }, allowPositionals: true });
  const [accession] = positionals;
  if (!accession) { console.error('Usage: node publish-proposal.js <accession> [--build NN]'); process.exit(1); }
  const config = openWorkspace();
  const git = createGit(config.repoPath);
  const ticket = createTicketClient(config);
  const result = await publishProposal({ git, ticket, repoPath: config.repoPath, accession, build: values.build });
  if (result.resumed) console.log('Resumed an earlier publish.');
  console.log(`Pull request: ${result.prUrl}`);
  console.log(`Ticket:       ${result.ticket.url}`);
  console.log('Next: review and merge the pull request.');
}

main().catch(err => { console.error(`Error: ${err.message}`); process.exit(1); });
