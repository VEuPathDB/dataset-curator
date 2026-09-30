#!/usr/bin/env node
/**
 * list-proposals.js - Lists proposals on the current VEuPathDatasets branch.
 *
 * Usage: node list-proposals.js [--build NN] [--json]
 */
import { parseArgs } from 'node:util';
import { loadConfig } from './lib/config.js';
import { createTicketClient } from './lib/ticket/index.js';
import { listProposals } from './lib/load-ops.js';

async function main() {
  const { values } = parseArgs({ options: { build: { type: 'string' }, json: { type: 'boolean', default: false } } });
  const config = loadConfig();
  const { proposals, errors } = await listProposals(config.repoPath, { ticket: createTicketClient(config), build: values.build });

  if (values.json) {
    console.log(JSON.stringify(proposals.map(({ manifest, build }) => ({ ...manifest, build })), null, 2));
  } else if (proposals.length > 0) {
    console.log(['ACCESSION', 'TYPE', 'PROJECT', 'BUILD', 'TICKET'].join('\t'));
    for (const { manifest: p, build } of proposals) {
      console.log([p.accession, p.datasetType, p.project, build ?? '-', p.ticket?.url || '-'].join('\t'));
    }
  } else if (errors.length === 0) {
    console.log(values.build ? `No proposals are in build ${values.build}.` : 'No proposals.');
  }

  // An unreadable manifest is reported without hiding the proposals that read.
  for (const e of errors) console.error(`Error: ${e.accession}: ${e.message}`);
  if (errors.length > 0 && proposals.length === 0) process.exit(1);
}

main().catch((err) => { console.error(`Error: ${err.message}`); process.exit(1); });
