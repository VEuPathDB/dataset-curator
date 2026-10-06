#!/usr/bin/env node
/**
 * load-proposal.js - Loads one proposal on rebuild<NN>: presenter, dataset entry
 * and proposal removal in one commit, loading artifacts written under
 * .curation/delivery/ for the data loading team to copy.
 * Re-running after a failure past the commit resumes where the last run stopped.
 *
 * Usage: node load-proposal.js [--dry-run] [--settle <proposed>=<abbrev> ...] <accession>
 */
import { parseArgs } from 'node:util';
import { openWorkspace } from './lib/config.js';
import { createGit } from './lib/git-ops.js';
import { createTicketClient } from './lib/ticket/index.js';
import { loadProposal } from './lib/load-ops.js';
import { homeProject } from './lib/manifest.js';

async function main() {
  const { values, positionals } = parseArgs({
    options: { 'dry-run': { type: 'boolean', default: false }, settle: { type: 'string', multiple: true, default: [] } }, allowPositionals: true
  });
  const [accession] = positionals;
  if (!accession) { console.error('Usage: node load-proposal.js [--dry-run] [--settle <proposed>=<abbrev> ...] <accession>'); process.exit(1); }
  const settle = {};
  for (const pair of values.settle) {
    const [proposed, abbrev, ...rest] = pair.split('=');
    if (!proposed || !abbrev || rest.length) { console.error(`--settle must be <proposed>=<abbrev>, got "${pair}"`); process.exit(1); }
    if (Object.hasOwn(settle, proposed)) { console.error(`--settle names ${proposed} twice`); process.exit(1); }
    settle[proposed] = abbrev;
  }
  const config = openWorkspace();
  const git = createGit(config.repoPath);
  const dryRun = values['dry-run'];
  const ticket = createTicketClient(config);
  const result = await loadProposal({ git, ticket, repoPath: config.repoPath, accession, dryRun, settle });
  for (const w of result.warnings) console.error(`Warning: ${w}`);
  for (const o of result.settled) {
    const proposed = o.abbrev === o.proposed ? '' : ` (proposed ${o.proposed})`;
    console.error(`Organism: ${o.abbrev}${proposed}${o.notes.length ? `: ${o.notes.join('; ')}` : ''}`);
  }
  if (result.dryRun) {
    if (result.cherryPicked.length) {
      console.error(`Dry run: straggler. Would cherry-pick ${result.cherryPicked.join(', ')} from origin/master first.`);
    }
    console.error(`Dry run: would add ${result.presenterNames?.join(', ') ?? 'the presenters'} to ${homeProject(result.manifest)} and remove Proposals/${accession}.`);
    for (const p of result.presenters ?? []) process.stdout.write(p.xml + '\n');
    if (result.dataset) {
      const { organisms } = result.dataset;
      console.error(`Dry run: would add ${result.manifest.name} to ${organisms.map((o) => o.relFile).join(', ')} and write ${Object.keys(organisms[0].files).length} artifacts for each of ${organisms.map((o) => o.delivery.target).join(', ')}`);
      process.stdout.write(result.dataset.xml + '\n');
    }
    return;
  }
  console.log(`Presenters:   ${result.presenterNames?.join(', ') ?? 'committed by an earlier run'}`);
  console.log(`Branch:       ${result.branch}`);
  if (result.cherryPicked.length) console.log(`Cherry-picked: ${result.cherryPicked.join(', ')}`);
  console.log(`Pull request: ${result.prUrl}`);
  console.log(`Ticket:       ${result.manifest.ticket.url + ' (loading)'}`);
  if (result.handoff) console.log(`\n${result.handoff}`);
}

main().catch(err => { console.error(`Error: ${err.message}`); process.exit(1); });
