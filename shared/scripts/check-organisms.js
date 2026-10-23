#!/usr/bin/env node
/**
 * check-organisms.js - For every Ready to load proposal on this rebuild branch
 * (optionally only one release's), prints the abbreviation each organism would
 * load under and every stop a person must resolve before it loads. Exits 1 on any stop.
 *
 * Usage: node check-organisms.js [--rebuild-branch rebuildRR] [--build NN]
 */
import { parseArgs } from 'node:util';
import { openWorkspace } from './lib/config.js';
import { createGit } from './lib/git-ops.js';
import { createTicketClient } from './lib/ticket/index.js';
import { checkOrganisms, resolveRebuildBranch } from './lib/load-ops.js';

async function main() {
  const { values } = parseArgs({ options: { build: { type: 'string' }, 'rebuild-branch': { type: 'string' } } });
  const config = openWorkspace();
  const git = createGit(config.repoPath);
  const rebuildBranch = resolveRebuildBranch(git, values['rebuild-branch']);
  const { results, errors } = await checkOrganisms({ git, ticket: createTicketClient(config), repoPath: config.repoPath, rebuildBranch, build: values.build });
  for (const r of results) {
    console.log(r.accession);
    for (const o of r.organisms) console.log(`  ${o.proposed} -> ${o.abbrev ?? '(stopped)'}${o.notes.length ? `  (${o.notes.join('; ')})` : ''}`);
    for (const s of r.stops) console.log(`  STOP ${s}`);
  }
  for (const e of errors) console.error(`Error: ${e.accession}: ${e.message}`);
  if (results.some((r) => r.stops.length) || errors.length) process.exit(1);
}

main().catch(err => { console.error(`Error: ${err.message}`); process.exit(1); });
