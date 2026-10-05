#!/usr/bin/env node
/**
 * check-organisms.js - For every Ready to load proposal of a build on this
 * rebuild branch, prints the abbreviation each organism would load under and
 * every stop a person must resolve before it loads. Exits 1 on any stop.
 *
 * Usage: node check-organisms.js --build NN
 */
import { parseArgs } from 'node:util';
import { openWorkspace } from './lib/config.js';
import { createGit } from './lib/git-ops.js';
import { createTicketClient } from './lib/ticket/index.js';
import { checkOrganisms } from './lib/load-ops.js';

async function main() {
  const { values } = parseArgs({ options: { build: { type: 'string' } } });
  if (!values.build) { console.error('Usage: node check-organisms.js --build NN'); process.exit(1); }
  const config = openWorkspace();
  const git = createGit(config.repoPath);
  git.fetch();
  const { results, errors } = await checkOrganisms({ git, ticket: createTicketClient(config), repoPath: config.repoPath, build: values.build });
  for (const r of results) {
    console.log(r.accession);
    for (const o of r.organisms) console.log(`  ${o.proposed} -> ${o.abbrev ?? '(stopped)'}${o.notes.length ? `  (${o.notes.join('; ')})` : ''}`);
    for (const s of r.stops) console.log(`  STOP ${s}`);
  }
  for (const e of errors) console.error(`Error: ${e.accession}: ${e.message}`);
  if (results.some((r) => r.stops.length) || errors.length) process.exit(1);
}

main().catch(err => { console.error(`Error: ${err.message}`); process.exit(1); });
