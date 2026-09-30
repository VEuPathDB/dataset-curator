#!/usr/bin/env node
/**
 * load-proposal.js - Loads one proposal on rebuild<NN>: presenter, dataset entry
 * and proposal removal in one commit, loading artifacts written under
 * .curation/delivery/ for the data loading team to copy.
 * Re-running after a failure past the commit resumes where the last run stopped.
 *
 * Usage: node load-proposal.js [--dry-run] <accession>
 */
import { parseArgs } from 'node:util';
import { openWorkspace } from './lib/config.js';
import { createGit } from './lib/git-ops.js';
import { createTicketClient } from './lib/ticket/index.js';
import { loadProposal } from './lib/load-ops.js';

async function main() {
  const { values, positionals } = parseArgs({
    options: { 'dry-run': { type: 'boolean', default: false } }, allowPositionals: true
  });
  const [accession] = positionals;
  if (!accession) { console.error('Usage: node load-proposal.js [--dry-run] <accession>'); process.exit(1); }
  const config = openWorkspace();
  const git = createGit(config.repoPath);
  const dryRun = values['dry-run'];
  const ticket = createTicketClient(config);
  const result = await loadProposal({ git, ticket, repoPath: config.repoPath, accession, dryRun });
  for (const w of result.warnings) console.error(`Warning: ${w}`);
  if (result.dryRun) {
    if (result.cherryPicked.length) {
      console.error(`Dry run: straggler. Would cherry-pick ${result.cherryPicked.join(', ')} from origin/master first.`);
    }
    console.error(`Dry run: would add ${result.presenterName} to ${result.manifest.project} and remove Proposals/${accession}.`);
    process.stdout.write(result.xml + '\n');
    if (result.dataset) {
      console.error(`Dry run: would add ${result.manifest.name} to ${result.dataset.relFile} and write ${Object.keys(result.dataset.files).length} artifacts for ${result.dataset.delivery.target}`);
      process.stdout.write(result.dataset.xml + '\n');
    }
    return;
  }
  console.log(`Presenter:    ${result.presenterName ?? 'committed by an earlier run'}`);
  console.log(`Branch:       ${result.branch}`);
  if (result.cherryPicked.length) console.log(`Cherry-picked: ${result.cherryPicked.join(', ')}`);
  console.log(`Pull request: ${result.prUrl}`);
  console.log(`Ticket:       ${result.manifest.ticket.url + ' (loading)'}`);
  if (result.handoff) console.log(`\n${result.handoff}`);
}

main().catch(err => { console.error(`Error: ${err.message}`); process.exit(1); });
