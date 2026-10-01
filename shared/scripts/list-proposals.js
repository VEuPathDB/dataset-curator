#!/usr/bin/env node
/**
 * list-proposals.js - Lists proposals on the current VEuPathDatasets branch with
 * each ticket's build and status. Read-only.
 *
 * Usage: node list-proposals.js [--build NN] [--status proposed|verifying|ready|revision|loading|done] [--json]
 */
import { parseArgs } from 'node:util';
import { loadConfig } from './lib/config.js';
import { createTicketClient } from './lib/ticket/index.js';
import { listProposals } from './lib/load-ops.js';

async function main() {
  const { values } = parseArgs({ options: {
    build: { type: 'string' }, status: { type: 'string' }, json: { type: 'boolean', default: false }
  } });
  const config = loadConfig();
  const ticket = createTicketClient(config);
  const { proposals, errors } = await listProposals(config.repoPath, { ticket, build: values.build, status: values.status });

  if (values.json) {
    console.log(JSON.stringify(proposals.map(({ manifest, build, status }) => ({ ...manifest, build, status })), null, 2));
  } else if (proposals.length > 0) {
    console.log(['ACCESSION', 'TYPE', 'PROJECT', 'BUILD', 'STATUS', 'TICKET'].join('\t'));
    for (const { manifest: p, build, status } of proposals) {
      console.log([p.accession, p.datasetType, p.project, build ?? '-', status ? ticket.statusOption(status) : '-', p.ticket?.url || '-'].join('\t'));
    }
  } else if (errors.length === 0) {
    const filters = [values.build && `in build ${values.build}`, values.status && `at ${ticket.statusOption(values.status)}`].filter(Boolean);
    console.log(filters.length ? `No proposals are ${filters.join(' and ')}.` : 'No proposals.');
  }

  // An unreadable manifest is reported without hiding the proposals that read.
  for (const e of errors) console.error(`Error: ${e.accession}: ${e.message}`);
  if (errors.length > 0 && proposals.length === 0) process.exit(1);
}

main().catch((err) => { console.error(`Error: ${err.message}`); process.exit(1); });
