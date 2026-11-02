#!/usr/bin/env node
/**
 * start-proposal.js - Checks preconditions and creates proposal/<accession>.
 *
 * Usage: node start-proposal.js <accession> [--external-id kind=id ...] [--force-update]
 * Prints JSON: { "mode": "new" } or { "mode": "update", "existingTicket": {...} }
 */
import { parseArgs } from 'node:util';
import { openWorkspace } from './lib/config.js';
import { createGit } from './lib/git-ops.js';
import { createTicketClient } from './lib/ticket/index.js';
import { startProposal } from './lib/proposal-ops.js';
import { parseExternalIds } from './lib/manifest.js';

async function main() {
  const { values, positionals } = parseArgs({
    options: {
      'force-update': { type: 'boolean', default: false },
      'external-id': { type: 'string', multiple: true, default: [] }
    },
    allowPositionals: true
  });
  const [accession] = positionals;
  if (!accession) { console.error('Usage: node start-proposal.js <accession> [--external-id kind=id ...] [--force-update]'); process.exit(1); }
  const externalIds = parseExternalIds(values['external-id'], accession);
  const config = openWorkspace();
  const git = createGit(config.repoPath);
  const ticket = createTicketClient(config);
  const result = await startProposal({ git, ticket, accession, externalIds, forceUpdate: values['force-update'] });
  console.log(JSON.stringify(result, null, 2));
  console.error(`On branch proposal/${accession} (${result.mode})`);
}

main().catch(err => { console.error(`Error: ${err.message}`); process.exit(1); });
