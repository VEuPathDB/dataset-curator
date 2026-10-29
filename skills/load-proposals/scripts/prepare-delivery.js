#!/usr/bin/env node
/**
 * prepare-delivery.js - Preprocessing: settles a merged proposal's organisms
 * against a rebuild branch and writes its whole manual delivery under the
 * validation workspace's delivery/<accession>/. Re-running replaces everything
 * but workspace/. Prints the rsync a person runs.
 *
 * Usage: node prepare-delivery.js --workspace <root> --against origin/rebuildRR [--settle <proposed>=<abbrev> ...] <accession>
 */
import { parseArgs } from 'node:util';
import { openWorkspace } from './lib/config.js';
import { createGit } from './lib/git-ops.js';
import { createTicketClient } from './lib/ticket/index.js';
import { prepareDelivery } from './lib/delivery-ops.js';
import { ASK } from './lib/validation-env.js';

const USAGE = 'Usage: node prepare-delivery.js --workspace <root> --against origin/rebuildRR [--settle <proposed>=<abbrev> ...] <accession>';

async function main() {
  const { values, positionals } = parseArgs({
    options: { workspace: { type: 'string' }, against: { type: 'string' }, settle: { type: 'string', multiple: true, default: [] } }, allowPositionals: true
  });
  const [accession] = positionals;
  if (!accession || positionals.length !== 1) { console.error(USAGE); process.exit(1); }
  if (!values.workspace) { console.error(`--workspace is required: ${ASK}.\n${USAGE}`); process.exit(1); }
  if (!values.against) { console.error(`--against origin/rebuildRR is required: ask the data loader which rebuild branch.\n${USAGE}`); process.exit(1); }
  const settle = {};
  for (const pair of values.settle) {
    const [proposed, abbrev, ...rest] = pair.split('=');
    if (!proposed || !abbrev || rest.length) { console.error(`--settle must be <proposed>=<abbrev>, got "${pair}"`); process.exit(1); }
    if (Object.hasOwn(settle, proposed)) { console.error(`--settle names ${proposed} twice`); process.exit(1); }
    settle[proposed] = abbrev;
  }
  const config = openWorkspace();
  const { dir, record, handoff } = await prepareDelivery({
    git: createGit(config.repoPath), ticket: createTicketClient(config), workspace: values.workspace, against: values.against, accession, settle
  });
  for (const s of record.settlement) console.log(`Organism: ${s.abbrev}${s.abbrev === s.proposed ? '' : ` (proposed ${s.proposed})`}`);
  console.log(`Release:  ${record.release} (build ${record.build})`);
  console.log(`Delivery: ${dir} (${record.files.length} files)`);
  console.log(`\n${handoff}`);
  console.log('\nPreprocess in each workspace/, then run mark-ready.js.');
}

main().catch(err => { console.error(`Error: ${err.message}`); process.exit(1); });
