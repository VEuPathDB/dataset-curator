#!/usr/bin/env node
/**
 * amend-proposal.js - Writes what preprocessing settled into a proposal on its
 * proposal/<proposal> branch (start-proposal.js, update mode): the dataset
 * entries, and the organism constants and props in curated/organism.json, from
 * the work area under the validation workspace. Prints each derived value with
 * its source, then the diff against master. Publish with publish-proposal.js.
 *
 * Usage: node amend-proposal.js --workspace <root> [--organism key=value ...] <proposal>
 */
import { parseArgs } from 'node:util';
import { openWorkspace } from './lib/config.js';
import { createGit } from './lib/git-ops.js';
import { amendProposal } from './lib/amend-ops.js';
import { entryLabel } from './dataset-types/_common.js';
import { ASK } from './lib/validation-env.js';

const USAGE = 'Usage: node amend-proposal.js --workspace <root> [--organism key=value ...] <proposal>';

async function main() {
  const { values, positionals } = parseArgs({
    options: { workspace: { type: 'string' }, organism: { type: 'string', multiple: true, default: [] } }, allowPositionals: true
  });
  const [proposalId] = positionals;
  if (!proposalId || positionals.length !== 1) { console.error(USAGE); process.exit(1); }
  if (!values.workspace) { console.error(`--workspace is required: ${ASK}.\n${USAGE}`); process.exit(1); }
  const given = {};
  for (const pair of values.organism) {
    const at = pair.indexOf('=');
    if (at < 1) { console.error(`--organism must be key=value, got "${pair}"`); process.exit(1); }
    if (Object.hasOwn(given, pair.slice(0, at))) { console.error(`--organism names ${pair.slice(0, at)} twice`); process.exit(1); }
    given[pair.slice(0, at)] = pair.slice(at + 1);
  }
  const config = openWorkspace();
  const result = await amendProposal({ git: createGit(config.repoPath), repoPath: config.repoPath, workspace: values.workspace, proposalId, given });
  for (const e of result.entries) console.log(`Dataset: ${entryLabel(e)} ${e.version}`);
  for (const [key, source] of Object.entries(result.sources)) {
    const [section, name] = key.split('.');
    console.log(`${key} = ${JSON.stringify(result[section][name])}  (${source})`);
  }
  console.log(result.diff ? `\n${result.diff}` : '\nNo change against origin/master.');
  console.log(`\nNext: review the diff with the user, then node scripts/publish-proposal.js ${proposalId}`);
}

main().catch(err => { console.error(`Error: ${err.message}`); process.exit(1); });
