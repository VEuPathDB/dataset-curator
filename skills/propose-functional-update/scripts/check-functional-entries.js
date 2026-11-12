#!/usr/bin/env node
/**
 * check-functional-entries.js - Reads an organism's entries of one functional class, its constants, and any genome
 * proposal on master that names it, from origin/<rebuild branch>. Writes
 * .curation/tmp/<proposal>_organism_entries.json for write-proposal.js.
 *
 * Usage: node check-functional-entries.js <proposal> --organism <abbrev> --project <Project> --class <datasetClass> --rebuild-branch rebuildRR
 */
import { parseArgs } from 'node:util';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { openWorkspace } from './lib/config.js';
import { createGit } from './lib/git-ops.js';
import { pendingGenomeProposals } from './lib/organisms.js';
import { datasetFileRelativePath, datasetsOfClass, organismFileConstants } from './lib/dataset-file.js';
import { datasetClasses } from './dataset-types/functional-update.js';

async function main() {
  const { values, positionals: [proposalId] } = parseArgs({
    options: { organism: { type: 'string' }, project: { type: 'string' }, class: { type: 'string' }, 'rebuild-branch': { type: 'string' } },
    allowPositionals: true
  });
  if (!proposalId || !values.organism || !values.project || !values.class || !values['rebuild-branch']) {
    console.error('Usage: node check-functional-entries.js <proposal> --organism <abbrev> --project <Project> --class <datasetClass> --rebuild-branch rebuildRR');
    process.exit(1);
  }
  if (!datasetClasses.includes(values.class)) throw new Error(`--class must be one of ${datasetClasses.join(', ')}`);
  const config = openWorkspace();
  const git = createGit(config.repoPath);
  git.fetch();
  const ref = `origin/${values['rebuild-branch']}`;
  const rel = datasetFileRelativePath(values.project, values.organism);
  if (!git.fileExistsOnRef(ref, rel)) throw new Error(`${rel} is not on ${ref}: ${values.organism} is not a loaded ${values.project} organism`);
  const xml = git.showFile(ref, rel);
  const entries = datasetsOfClass(xml, values.class).map(({ props: { name, version, ...props } }) => ({ name, version, props }));
  const pendingGenomes = pendingGenomeProposals(git, ['origin/master'])
    .filter((g) => g.organism?.proposedOrganismAbbrev === values.organism).map((g) => g.accession);
  const out = {
    schemaVersion: 1, organism: values.organism, project: values.project, datasetClass: values.class, checkedAgainst: ref,
    constants: organismFileConstants(xml), entries, pendingGenomes
  };
  const path = resolve(`.curation/tmp/${proposalId}_organism_entries.json`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(out, null, 2) + '\n');
  console.error(`${values.organism} has ${entries.length} ${values.class} entr${entries.length === 1 ? 'y' : 'ies'}: ${entries.map((e) => `${e.name} ${e.version}`).join(', ') || 'none'}`);
  if (pendingGenomes.length) console.error(`Genome proposal ${pendingGenomes.join(', ')} on master names ${values.organism}: a functional update must wait for it`);
  console.log(path);
}

main().catch((err) => { console.error(`Error: ${err.message}`); process.exit(1); });
