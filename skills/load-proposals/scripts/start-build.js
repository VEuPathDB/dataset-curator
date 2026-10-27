#!/usr/bin/env node
/**
 * start-build.js - The start of a website build, one step at a time; each step
 * opens a pull request for a person to merge before the next:
 *   sync-contacts     copy master's allContacts.xml onto the rebuild branch
 *   merge-back        merge the rebuild branch into master
 *   clean-proposals   delete from master the proposals loaded for earlier builds
 *   reset-load-workspaces  remove every loads/<rebuild>/ under the validation root (--workspace)
 *
 * Usage: node start-build.js --rebuild-branch rebuildRR --build NN [--workspace <root>] <step>
 */
import { parseArgs } from 'node:util';
import { openWorkspace } from './lib/config.js';
import { createGit } from './lib/git-ops.js';
import { createTicketClient } from './lib/ticket/index.js';
import { resetLoadWorkspaces } from './lib/validation-workspace.js';
import { syncContacts, mergeBack, cleanProposals } from './lib/build-start-ops.js';

const USAGE = 'Usage: node start-build.js --rebuild-branch rebuildRR --build NN [--workspace <root>] sync-contacts|merge-back|clean-proposals|reset-load-workspaces';

async function main() {
  const { values, positionals } = parseArgs({ options: { 'rebuild-branch': { type: 'string' }, build: { type: 'string' }, workspace: { type: 'string' } }, allowPositionals: true });
  const [step] = positionals;
  const rebuildBranch = values['rebuild-branch'];
  if (!rebuildBranch || !/^\d+$/.test(values.build ?? '') || positionals.length !== 1) { console.error(USAGE); process.exit(1); }
  const config = openWorkspace();
  const git = createGit(config.repoPath);
  if (step === 'sync-contacts') {
    const r = await syncContacts({ git, repoPath: config.repoPath, rebuildBranch, build: values.build });
    console.log(r.changed ? `Pull request: ${r.prUrl}` : `allContacts.xml already matches master on ${rebuildBranch}; nothing to do.`);
  } else if (step === 'merge-back') {
    console.log(`Pull request: ${(await mergeBack({ git, rebuildBranch, build: values.build })).prUrl}`);
  } else if (step === 'clean-proposals') {
    const r = await cleanProposals({ git, ticket: createTicketClient(config), rebuildBranch, build: values.build });
    for (const k of r.kept) console.error(`Kept ${k.accession}: ${k.message}`);
    console.log(r.removed.length ? `Removing ${r.removed.join(' ')}. Pull request: ${r.prUrl}` : 'No proposals loaded before this build remain on master.');
  } else if (step === 'reset-load-workspaces') {
    if (!values.workspace) { console.error(`--workspace is required: ask the data loader which validation workspace to use.\n${USAGE}`); process.exit(1); }
    const removed = resetLoadWorkspaces({ root: values.workspace });
    console.log(removed.length ? `Removed ${removed.join(' ')}` : 'No load workspaces to remove.');
  } else {
    console.error(USAGE);
    process.exit(1);
  }
}

main().catch(err => { console.error(`Error: ${err.message}`); process.exit(1); });
