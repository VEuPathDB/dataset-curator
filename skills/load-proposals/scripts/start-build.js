#!/usr/bin/env node
/**
 * start-build.js - The start of a website build, one step at a time; each of
 * the first three opens a pull request for a person to merge before the next:
 *   sync-contacts     copy master's allContacts.xml onto the rebuild branch
 *   merge-back        merge the rebuild branch into master
 *   clean-proposals   delete from master the proposals loaded for earlier builds, and their local deliveries
 *   reset-load-workspaces  remove every loads/<rebuild>/ under the validation root; no PR
 *
 * Usage: node start-build.js --rebuild-branch rebuildRR --build NN sync-contacts|merge-back
 *        node start-build.js --rebuild-branch rebuildRR --build NN --workspace <root> clean-proposals
 *        node start-build.js --workspace <root> reset-load-workspaces
 */
import { parseArgs } from 'node:util';
import { openWorkspace } from './lib/config.js';
import { createGit } from './lib/git-ops.js';
import { createTicketClient } from './lib/ticket/index.js';
import { resetLoadWorkspaces, removeDeliveries } from './lib/validation-workspace.js';
import { ASK } from './lib/validation-env.js';
import { syncContacts, mergeBack, cleanProposals } from './lib/build-start-ops.js';

const USAGE = `Usage: node start-build.js --rebuild-branch rebuildRR --build NN sync-contacts|merge-back
       node start-build.js --rebuild-branch rebuildRR --build NN --workspace <root> clean-proposals
       node start-build.js --workspace <root> reset-load-workspaces`;

const usage = (why = '') => { console.error(`${why}${USAGE}`); process.exit(1); };

async function main() {
  const { values, positionals } = parseArgs({ options: { 'rebuild-branch': { type: 'string' }, build: { type: 'string' }, workspace: { type: 'string' } }, allowPositionals: true });
  const [step] = positionals;
  if (positionals.length !== 1) usage();
  if (step === 'reset-load-workspaces') {
    if (!values.workspace) usage(`--workspace is required: ${ASK}.\n`);
    const removed = resetLoadWorkspaces({ root: values.workspace });
    console.log(removed.length ? `Removed ${removed.join(' ')}` : 'No load workspaces to remove.');
    return;
  }
  const rebuildBranch = values['rebuild-branch'];
  if (!rebuildBranch || !/^\d+$/.test(values.build ?? '')) usage();
  const config = openWorkspace();
  const git = createGit(config.repoPath);
  if (step === 'sync-contacts') {
    const r = await syncContacts({ git, repoPath: config.repoPath, rebuildBranch, build: values.build });
    console.log(r.changed ? `Pull request: ${r.prUrl}` : `allContacts.xml already matches master on ${rebuildBranch}; nothing to do.`);
  } else if (step === 'merge-back') {
    console.log(`Pull request: ${(await mergeBack({ git, rebuildBranch, build: values.build })).prUrl}`);
  } else if (step === 'clean-proposals') {
    if (!values.workspace) usage(`--workspace is required: ${ASK}.\n`);
    const removeDelivery = (accessions) => removeDeliveries({ root: values.workspace, accessions });
    const r = await cleanProposals({ git, ticket: createTicketClient(config), rebuildBranch, build: values.build, removeDelivery });
    for (const d of r.deliveries) console.log(`Removed delivery ${d}`);
    for (const k of r.kept) console.error(`Kept ${k.accession}: ${k.message}`);
    console.log(r.removed.length ? `Removing ${r.removed.join(' ')}. Pull request: ${r.prUrl}` : 'No proposals loaded before this build remain on master.');
  } else {
    usage();
  }
}

main().catch(err => { console.error(`Error: ${err.message}`); process.exit(1); });
