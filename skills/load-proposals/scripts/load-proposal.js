#!/usr/bin/env node
/**
 * load-proposal.js - Loads one proposal from origin/master onto rebuild<RR>:
 * presenter, dataset entry and master's contacts in one commit; organisms
 * settle as the delivery record mark-ready posted says.
 * Re-running after a failure past the commit resumes where the last run stopped.
 *
 * --workspace is the validation workspace root the data loader names, which
 * holds the per-type workspaces; the content validators run in its
 * loads/<rebuild>/ before anything changes and any error stops the load.
 * --refresh recreates that load workspace.
 * --settle applies to genome assemblies only, which have no delivery record yet.
 * --history gives a carried history value (genomeSource, ...) a type's history row needs and the presenter lacks.
 *
 * Usage: node load-proposal.js --rebuild-branch rebuildRR [--workspace <root>] [--refresh] [--dry-run] [--settle <proposed>=<abbrev> ...] [--ploidy <abbrev>=<N> ...] [--history <key>=<value> ...] <proposal>
 */
import { parseArgs } from 'node:util';
import { openWorkspace } from './lib/config.js';
import { createGit } from './lib/git-ops.js';
import { createTicketClient } from './lib/ticket/index.js';
import { loadProposal } from './lib/load-ops.js';
import { contentValidation } from './lib/validation-ops.js';
import { homeProject } from './lib/manifest.js';
import { entriesLabel } from './dataset-types/_common.js';
import { HISTORY_CARRIED } from './lib/presenter-file.js';
import { editLabel, editTarget } from './lib/load-edits.js';

async function main() {
  const { values, positionals } = parseArgs({
    options: { workspace: { type: 'string' }, refresh: { type: 'boolean', default: false }, 'dry-run': { type: 'boolean', default: false }, 'rebuild-branch': { type: 'string' }, settle: { type: 'string', multiple: true, default: [] }, ploidy: { type: 'string', multiple: true, default: [] }, history: { type: 'string', multiple: true, default: [] } }, allowPositionals: true
  });
  const [proposalId] = positionals;
  const usage = 'Usage: node load-proposal.js --rebuild-branch rebuildRR [--workspace <root>] [--refresh] [--dry-run] [--settle <proposed>=<abbrev> ... (genome assemblies only)] [--ploidy <abbrev>=<N> ...] [--history <key>=<value> ...] <proposal>';
  const rebuildBranch = values['rebuild-branch'];
  if (!rebuildBranch) { console.error(`--rebuild-branch rebuildRR is required: ask the data loader which rebuild branch to load into.\n${usage}`); process.exit(1); }
  if (!proposalId) { console.error(usage); process.exit(1); }
  const settle = {};
  for (const pair of values.settle) {
    const [proposed, abbrev, ...rest] = pair.split('=');
    if (!proposed || !abbrev || rest.length) { console.error(`--settle must be <proposed>=<abbrev>, got "${pair}"`); process.exit(1); }
    if (Object.hasOwn(settle, proposed)) { console.error(`--settle names ${proposed} twice`); process.exit(1); }
    settle[proposed] = abbrev;
  }
  const organismConstants = {};
  for (const pair of values.ploidy) {
    const [abbrev, n, ...rest] = pair.split('=');
    if (!abbrev || !n || rest.length) { console.error(`--ploidy must be <abbrev>=<N>, got "${pair}"`); process.exit(1); }
    organismConstants[abbrev] = { ...organismConstants[abbrev], ploidy: n };
  }
  const history = {};
  for (const pair of values.history) {
    const at = pair.indexOf('=');
    const key = pair.slice(0, at);
    if (at < 1 || !HISTORY_CARRIED.includes(key) || at === pair.length - 1) { console.error(`--history must be <key>=<value> with key one of ${HISTORY_CARRIED.join(', ')}; got "${pair}"`); process.exit(1); }
    if (Object.hasOwn(history, key)) { console.error(`--history names ${key} twice`); process.exit(1); }
    history[key] = pair.slice(at + 1);
  }
  const config = openWorkspace();
  const git = createGit(config.repoPath);
  const dryRun = values['dry-run'];
  const ticket = createTicketClient(config);
  const result = await loadProposal({ git, ticket, repoPath: config.repoPath, rebuildBranch, proposalId, dryRun, settle, organismConstants, history, validate: contentValidation({ workspace: values.workspace, rebuildBranch, refresh: values.refresh }) });
  for (const w of result.warnings) console.error(`Warning: ${w}`);
  for (const o of result.settled) {
    const proposed = o.abbrev === o.proposed ? '' : ` (proposed ${o.proposed})`;
    console.error(`Organism: ${o.abbrev}${proposed}${o.notes.length ? `: ${o.notes.join('; ')}` : ''}`);
  }
  if (result.dryRun) {
    for (const e of result.edits ?? []) console.error(`Dry run: would edit ${editTarget(e)}: ${editLabel(e)}`);
    if (result.presenterNames?.length || !result.edits?.length) console.error(`Dry run: would add ${result.presenterNames?.join(', ') ?? 'the presenters'} to ${homeProject(result.manifest)}.`);
    for (const p of result.presenters ?? []) process.stdout.write(p.xml + '\n');
    if (result.dataset) {
      const { organisms } = result.dataset;
      console.error(`Dry run: would add ${entriesLabel(result.dataset.entries)} to ${organisms.map((o) => o.relFile).join(', ')}`);
      for (const o of organisms.filter((o) => o.constantsAdded?.length)) console.error(`Dry run: would add constants ${o.constantsAdded.join(', ')} to ${o.relFile}`);
      for (const o of organisms.filter((o) => o.created)) console.error(`Dry run: would create ${o.relFile}`);
      for (const p of result.dataset.projectFiles ?? []) console.error(`Dry run: would add ${p.organism} to ${p.relFile}`);
      process.stdout.write(result.dataset.xml + '\n');
    }
    return;
  }
  if (result.alreadyLoaded) return;
  if (result.presenterNames?.length !== 0) console.log(`Presenters:   ${result.presenterNames?.join(', ') ?? 'committed by an earlier run'}`);
  for (const e of result.edits ?? []) console.log(`Edit:         ${editLabel(e)} in ${editTarget(e)}`);
  console.log(`Branch:       ${result.branch}`);
  console.log(`Pull request: ${result.prUrl}`);
  console.log(`Ticket:       ${result.manifest.ticket.url + ' (loading)'}`);
  if (result.corpusStep) console.log(`\nSTF corpus step, once the delivery is on the server:\n  ${result.corpusStep}`);
}

main().catch(err => { console.error(`Error: ${err.message}`); process.exit(1); });
