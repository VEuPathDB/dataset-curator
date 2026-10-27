#!/usr/bin/env node
/**
 * validate-proposal.js - Runs every validator for a merged proposal's dataset
 * type with the tools of the validation workspace the data loader names,
 * prints the findings, keeps the report under .curation/tmp/verify/ and posts
 * it on the ticket, where mark-ready reads it. Exits 1 when the verdict is fail.
 *
 * Usage: node validate-proposal.js --workspace <root> [--refresh] [--rebuild] [--against <ref>] [--no-post] <accession>
 */
import { parseArgs } from 'node:util';
import { openWorkspace } from './lib/config.js';
import { createGit } from './lib/git-ops.js';
import { createTicketClient } from './lib/ticket/index.js';
import { validateProposal } from './lib/validation-ops.js';
import { formatFinding } from './lib/validation.js';

const USAGE = 'Usage: node validate-proposal.js --workspace <root> [--refresh] [--rebuild] [--against <ref>] [--no-post] <accession>';

async function main() {
  const { values, positionals } = parseArgs({
    options: { workspace: { type: 'string' }, refresh: { type: 'boolean', default: false }, rebuild: { type: 'boolean', default: false }, against: { type: 'string' }, 'no-post': { type: 'boolean', default: false } }, allowPositionals: true
  });
  const [accession] = positionals;
  if (!accession || positionals.length !== 1) { console.error(USAGE); process.exit(1); }
  if (!values.workspace) { console.error(`--workspace is required: ask the data loader which validation workspace to use.\n${USAGE}`); process.exit(1); }
  const config = openWorkspace();
  const ticket = createTicketClient(config);
  const { report, path, ticket: ref } = await validateProposal({
    git: createGit(config.repoPath), ticket, repoPath: config.repoPath, accession,
    workspace: values.workspace, refresh: values.refresh, rebuild: values.rebuild, against: values.against ?? null, post: !values['no-post']
  });
  for (const f of report.findings) console.log(formatFinding(f));
  console.log(`Verdict: ${report.verdict}`);
  console.log(`Tools:   ${Object.entries(report.tools).map(([n, v]) => `${n} ${v}`).join(', ') || 'none resolved'}`);
  console.log(`Repos:   ${Object.entries(report.repos).map(([n, r]) => `${n} ${r.ref}@${r.sha.slice(0, 10)}`).join(', ') || 'none'}`);
  console.log(`Report:  ${path}`);
  console.log(values['no-post'] ? 'Not posted (--no-post).' : `Posted:  ${ref.url}`);
  if (report.verdict === 'fail') process.exit(1);
}

main().catch(err => { console.error(`Error: ${err.message}`); process.exit(1); });
