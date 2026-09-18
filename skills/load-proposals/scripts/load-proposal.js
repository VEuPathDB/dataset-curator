#!/usr/bin/env node
/**
 * load-proposal.js - Renders one proposal into its presenter file on rebuild<NN>.
 * Re-running after a failure past the commit resumes where the last run stopped.
 *
 * Usage: node load-proposal.js [--dry-run] <accession>
 */
import { parseArgs } from 'node:util';
import { loadConfig } from './lib/config.js';
import { createGit } from './lib/git-ops.js';
import { createTicketClient } from './lib/ticket/index.js';
import { loadProposal } from './lib/load-ops.js';

async function main() {
  const { values, positionals } = parseArgs({
    options: { 'dry-run': { type: 'boolean', default: false } }, allowPositionals: true
  });
  const [accession] = positionals;
  if (!accession) { console.error('Usage: node load-proposal.js [--dry-run] <accession>'); process.exit(1); }
  const config = loadConfig();
  const git = createGit(config.repoPath);
  const ticket = createTicketClient(config);
  const result = await loadProposal({ git, ticket, repoPath: config.repoPath, accession, dryRun: values['dry-run'] });
  for (const w of result.warnings) console.error(`Warning: ${w}`);
  if (result.dryRun) {
    if (result.cherryPicked.length) {
      console.error(`Dry run: straggler. Would cherry-pick ${result.cherryPicked.join(', ')} from origin/master first.`);
    }
    console.error(`Dry run: would add ${result.presenterName} to ${result.manifest.project} and remove Proposals/${accession}.`);
    process.stdout.write(result.xml + '\n');
    return;
  }
  console.log(`Presenter:    ${result.presenterName ?? 'committed by an earlier run'}`);
  console.log(`Branch:       ${result.branch}`);
  if (result.cherryPicked.length) console.log(`Cherry-picked: ${result.cherryPicked.join(', ')}`);
  console.log(`Pull request: ${result.prUrl}`);
  console.log(`Ticket:       ${result.manifest.ticket ? result.manifest.ticket.url + ' (loading)' : 'none'}`);
}

main().catch(err => { console.error(`Error: ${err.message}`); process.exit(1); });
