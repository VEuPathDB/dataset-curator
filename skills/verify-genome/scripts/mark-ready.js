#!/usr/bin/env node
/**
 * mark-ready.js - Records that a person verified a merged proposal: sets its
 * ticket to Ready to load, the only status load accepts, with an optional note,
 * then posts the delivery record and removes the proposal's validation
 * workspace (never its delivery/). Refuses first while a
 * worktree there holds uncommitted or unpushed work, unless --discard-changes.
 *
 * Usage: node mark-ready.js [--workspace <root>] [--discard-changes] <proposal> ["<note>"]
 */
import { parseArgs } from 'node:util';
import { loadConfig } from './lib/config.js';
import { createGit } from './lib/git-ops.js';
import { createTicketClient } from './lib/ticket/index.js';
import { markReady } from './lib/verification-ops.js';
import { verifyWorkspaceDisposal, deliveryReader } from './lib/validation-workspace.js';

const USAGE = 'Usage: node mark-ready.js [--workspace <root>] [--discard-changes] <proposal> ["<note>"]';

async function main() {
  const { values, positionals } = parseArgs({
    options: { workspace: { type: 'string' }, 'discard-changes': { type: 'boolean', default: false } }, allowPositionals: true
  });
  const [proposalId, note] = positionals;
  if (!proposalId || positionals.length > 2) { console.error(USAGE); process.exit(1); }
  if (values['discard-changes'] && !values.workspace) { console.error(`--discard-changes needs --workspace.\n${USAGE}`); process.exit(1); }
  const config = loadConfig();
  const ticket = createTicketClient(config);
  const workspace = values.workspace ? verifyWorkspaceDisposal({ root: values.workspace, proposalId, discardChanges: values['discard-changes'] }) : undefined;
  const delivery = values.workspace ? deliveryReader({ root: values.workspace, proposalId }) : undefined;
  const result = await markReady({ git: createGit(config.repoPath), ticket, proposalId, note, workspace, delivery });
  if (result.notice) console.error(`Note: ${result.notice}`);
  if (result.report) console.log(`Report: ${result.report.verdict} (${Object.entries(result.report.tools).map(([n, v]) => `${n} ${v}`).join(', ')})`);
  console.log(`Ticket: ${result.ticket.url} (${ticket.statusOption('ready')})`);
  if (result.disposed) console.log(`Removed: ${result.disposed}`);
  if (result.noWorkspaceUnder) console.error(`Note: no validation workspace for ${proposalId} under ${result.noWorkspaceUnder}`);
  if (result.disposeError) console.error(`Warning: ${result.disposeError}`);
}

main().catch(err => { console.error(`Error: ${err.message}`); process.exit(1); });
