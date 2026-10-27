#!/usr/bin/env node
/**
 * mark-ready.js - Records that a person verified a merged proposal: sets its
 * ticket to Ready to load, the only status load accepts, with an optional note,
 * then removes the proposal's validation workspace. Refuses first while a
 * worktree there holds uncommitted or unpushed work, unless --discard-changes.
 *
 * Usage: node mark-ready.js [--workspace <root>] [--discard-changes] <accession> ["<note>"]
 */
import { parseArgs } from 'node:util';
import { loadConfig } from './lib/config.js';
import { createGit } from './lib/git-ops.js';
import { createTicketClient } from './lib/ticket/index.js';
import { markReady } from './lib/verification-ops.js';
import { verifyWorkspaceDisposal } from './lib/validation-workspace.js';

const USAGE = 'Usage: node mark-ready.js [--workspace <root>] [--discard-changes] <accession> ["<note>"]';

async function main() {
  const { values, positionals } = parseArgs({
    options: { workspace: { type: 'string' }, 'discard-changes': { type: 'boolean', default: false } }, allowPositionals: true
  });
  const [accession, note] = positionals;
  if (!accession || positionals.length > 2) { console.error(USAGE); process.exit(1); }
  const config = loadConfig();
  const ticket = createTicketClient(config);
  const workspace = values.workspace ? verifyWorkspaceDisposal({ root: values.workspace, accession, discardChanges: values['discard-changes'] }) : undefined;
  const result = await markReady({ git: createGit(config.repoPath), ticket, accession, note, workspace });
  if (result.notice) console.error(`Note: ${result.notice}`);
  if (result.report) console.log(`Report: ${result.report.verdict} (${Object.entries(result.report.tools).map(([n, v]) => `${n} ${v}`).join(', ')})`);
  console.log(`Ticket: ${result.ticket.url} (${ticket.statusOption('ready')})`);
  if (result.disposed) console.log(`Removed: ${result.disposed}`);
}

main().catch(err => { console.error(`Error: ${err.message}`); process.exit(1); });
