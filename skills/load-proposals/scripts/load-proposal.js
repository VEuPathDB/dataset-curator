#!/usr/bin/env node
/**
 * load-proposal.js - Loads one proposal from origin/master onto rebuild<RR>:
 * presenter, dataset entry and master's contacts in one commit; organisms
 * settle as the delivery record mark-ready posted says.
 * Re-running after a failure past the commit resumes where the last run stopped.
 *
 * --workspace is the validation workspace root the data loader names, which
 * holds the per-type workspaces; the content validators run in its
 * loads/<rebuild>/ before anything changes and any error stops the load.
 * --refresh recreates that load workspace.
 *
 * Usage: node load-proposal.js --rebuild-branch rebuildRR [--workspace <root>] [--refresh] [--dry-run] [--ploidy <abbrev>=<N> ...] <accession>
 */
import { parseArgs } from 'node:util';
import { openWorkspace } from './lib/config.js';
import { createGit } from './lib/git-ops.js';
import { createTicketClient } from './lib/ticket/index.js';
import { loadProposal } from './lib/load-ops.js';
import { contentValidation } from './lib/validation-ops.js';
import { homeProject } from './lib/manifest.js';

async function main() {
  const { values, positionals } = parseArgs({
    options: { workspace: { type: 'string' }, refresh: { type: 'boolean', default: false }, 'dry-run': { type: 'boolean', default: false }, 'rebuild-branch': { type: 'string' }, ploidy: { type: 'string', multiple: true, default: [] } }, allowPositionals: true
  });
  const [accession] = positionals;
  const usage = 'Usage: node load-proposal.js --rebuild-branch rebuildRR [--workspace <root>] [--refresh] [--dry-run] [--ploidy <abbrev>=<N> ...] <accession>';
  const rebuildBranch = values['rebuild-branch'];
  if (!rebuildBranch) { console.error(`--rebuild-branch rebuildRR is required: ask the data loader which rebuild branch to load into.\n${usage}`); process.exit(1); }
  if (!accession) { console.error(usage); process.exit(1); }
  const organismConstants = {};
  for (const pair of values.ploidy) {
    const [abbrev, n, ...rest] = pair.split('=');
    if (!abbrev || !n || rest.length) { console.error(`--ploidy must be <abbrev>=<N>, got "${pair}"`); process.exit(1); }
    organismConstants[abbrev] = { ...organismConstants[abbrev], ploidy: n };
  }
  const config = openWorkspace();
  const git = createGit(config.repoPath);
  const dryRun = values['dry-run'];
  const ticket = createTicketClient(config);
  const result = await loadProposal({ git, ticket, repoPath: config.repoPath, rebuildBranch, accession, dryRun, organismConstants, validate: contentValidation({ workspace: values.workspace, rebuildBranch, refresh: values.refresh }) });
  for (const w of result.warnings) console.error(`Warning: ${w}`);
  for (const o of result.settled) {
    const proposed = o.abbrev === o.proposed ? '' : ` (proposed ${o.proposed})`;
    console.error(`Organism: ${o.abbrev}${proposed}${o.notes.length ? `: ${o.notes.join('; ')}` : ''}`);
  }
  if (result.dryRun) {
    console.error(`Dry run: would add ${result.presenterNames?.join(', ') ?? 'the presenters'} to ${homeProject(result.manifest)}.`);
    for (const p of result.presenters ?? []) process.stdout.write(p.xml + '\n');
    if (result.dataset) {
      const { organisms } = result.dataset;
      console.error(`Dry run: would add ${result.manifest.name} to ${organisms.map((o) => o.relFile).join(', ')}`);
      for (const o of organisms.filter((o) => o.constantsAdded?.length)) console.error(`Dry run: would add constants ${o.constantsAdded.join(', ')} to ${o.relFile}`);
      process.stdout.write(result.dataset.xml + '\n');
    }
    return;
  }
  console.log(`Presenters:   ${result.presenterNames?.join(', ') ?? 'committed by an earlier run'}`);
  console.log(`Branch:       ${result.branch}`);
  console.log(`Pull request: ${result.prUrl}`);
  console.log(`Ticket:       ${result.manifest.ticket.url + ' (loading)'}`);
  if (result.corpusStep) console.log(`\nSTF corpus step, once the delivery is on the server:\n  ${result.corpusStep}`);
}

main().catch(err => { console.error(`Error: ${err.message}`); process.exit(1); });
