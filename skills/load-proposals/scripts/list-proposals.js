#!/usr/bin/env node
/**
 * list-proposals.js - Lists proposals on the current VEuPathDatasets branch.
 * With --sync-status, also sets each listed proposed ticket to Ready to load:
 * a proposal on this branch has been merged.
 *
 * Usage: node list-proposals.js [--build NN] [--json] [--sync-status]
 */
import { parseArgs } from 'node:util';
import { loadConfig } from './lib/config.js';
import { createTicketClient } from './lib/ticket/index.js';
import { listProposals } from './lib/load-ops.js';

async function main() {
  const { values } = parseArgs({ options: {
    build: { type: 'string' }, json: { type: 'boolean', default: false }, 'sync-status': { type: 'boolean', default: false }
  } });
  const syncStatus = values['sync-status'];
  const config = loadConfig();
  const { proposals, errors } = await listProposals(config.repoPath, { ticket: createTicketClient(config), build: values.build, syncStatus });

  if (values.json) {
    console.log(JSON.stringify(proposals.map(({ manifest, build, status, synced }) => ({ ...manifest, build, status, synced })), null, 2));
  } else if (proposals.length > 0) {
    console.log(['ACCESSION', 'TYPE', 'PROJECT', 'BUILD', 'TICKET', ...(syncStatus ? ['STATUS', 'SYNCED'] : [])].join('\t'));
    for (const { manifest: p, build, status, synced } of proposals) {
      const sync = syncStatus ? [status ?? '-', synced ? 'yes' : '-'] : [];
      console.log([p.accession, p.datasetType, p.project, build ?? '-', p.ticket?.url || '-', ...sync].join('\t'));
    }
  } else if (errors.length === 0) {
    console.log(values.build ? `No proposals are in build ${values.build}.` : 'No proposals.');
  }

  for (const { manifest: p, synced } of proposals) {
    if (synced) console.error(`Set ${p.ticket.url} (${p.accession}) from proposed to ready: it is on this branch.`);
  }
  // An unreadable manifest is reported without hiding the proposals that read.
  for (const e of errors) console.error(`Error: ${e.accession}: ${e.message}`);
  if (errors.length > 0 && proposals.length === 0) process.exit(1);
}

main().catch((err) => { console.error(`Error: ${err.message}`); process.exit(1); });
