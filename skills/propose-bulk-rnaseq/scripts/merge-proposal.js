#!/usr/bin/env node
/**
 * merge-proposal.js - Merges a proposal PR (merge commit; the branch is kept)
 * and moves its ticket to Proposed. Use this, never gh pr merge, when asked to
 * merge a proposal PR. Re-running after a failure past the merge finishes the
 * ticket update.
 *
 * Usage: node merge-proposal.js <accession>
 */
import { parseArgs } from 'node:util';
import { loadConfig } from './lib/config.js';
import { createGit } from './lib/git-ops.js';
import { createTicketClient } from './lib/ticket/index.js';
import { mergeProposal } from './lib/merge-ops.js';

async function main() {
  const { positionals } = parseArgs({ options: {}, allowPositionals: true });
  const [accession] = positionals;
  if (!accession || positionals.length !== 1) { console.error('Usage: node merge-proposal.js <accession>'); process.exit(1); }
  const config = loadConfig();
  const ticket = createTicketClient(config);
  const result = await mergeProposal({ git: createGit(config.repoPath), ticket, accession });
  console.log(`Pull request: ${result.prUrl} (${result.resumed ? 'already merged' : 'merged'})`);
  console.log(`Ticket:       ${result.ticket.url} (${ticket.statusOption('proposed')})`);
}

main().catch(err => { console.error(`Error: ${err.message}`); process.exit(1); });
