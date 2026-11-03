#!/usr/bin/env node
/**
 * start-proposal.js - Checks preconditions, finds or allocates the proposal id
 * for the accession and dataset type, and creates proposal/<proposalId>.
 *
 * Usage: node start-proposal.js <accession> --type <datasetType> [--external-id kind=id ...] [--force-update]
 * Prints JSON: { "mode": "new", "proposalId": "..." } or { "mode": "update", "proposalId": "...", "existingTicket": {...} }
 */
import { parseArgs } from 'node:util';
import { openWorkspace } from './lib/config.js';
import { createGit } from './lib/git-ops.js';
import { createTicketClient } from './lib/ticket/index.js';
import { startProposal } from './lib/proposal-ops.js';
import { parseExternalIds } from './lib/manifest.js';

const USAGE = 'Usage: node start-proposal.js <accession> --type <datasetType> [--external-id kind=id ...] [--force-update]';

async function main() {
  const { values, positionals } = parseArgs({
    options: {
      type: { type: 'string' },
      'force-update': { type: 'boolean', default: false },
      'external-id': { type: 'string', multiple: true, default: [] }
    },
    allowPositionals: true
  });
  const [accession] = positionals;
  if (!accession || !values.type) { console.error(USAGE); process.exit(1); }
  const externalIds = parseExternalIds(values['external-id'], accession);
  const config = openWorkspace();
  const git = createGit(config.repoPath);
  const ticket = createTicketClient(config);
  const result = await startProposal({ git, ticket, accession, datasetType: values.type, externalIds, forceUpdate: values['force-update'] });
  console.log(JSON.stringify(result, null, 2));
  console.error(`On branch proposal/${result.proposalId} (${result.mode})`);
}

main().catch(err => { console.error(`Error: ${err.message}`); process.exit(1); });
