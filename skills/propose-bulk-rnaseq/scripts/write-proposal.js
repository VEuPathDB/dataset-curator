#!/usr/bin/env node
/**
 * write-proposal.js - Writes Proposals/<accession>/ in VEuPathDatasets.
 *
 * Usage:
 *   node write-proposal.js --accession GCA_1.1 --type genome-assembly --project FungiDB \
 *     --organism tfakST1 --build 02 --primary-contact jane.doe [--contact ravi.kumar ...] \
 *     --skill propose-genome-assembly --input .curation/tmp/a.json [--input .curation/tmp/b.json ...] \
 *     [--curated .curation/tmp/c.json ...] [--overrides .curation/tmp/overrides.json]
 *
 * Derives curated/presenter.json and prints the proposal directory.
 */
import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { openWorkspace } from './lib/config.js';
import { createGit } from './lib/git-ops.js';
import { writeProposal } from './lib/proposal-ops.js';

/** plugin.json is two levels up from shared/scripts and three from skills/<name>/scripts. */
const pluginVersion = () => {
  for (const rel of ['../../.claude-plugin/plugin.json', '../../../.claude-plugin/plugin.json']) {
    try {
      return JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf-8')).version;
    } catch { /* try the next location */ }
  }
  throw new Error('Cannot read .claude-plugin/plugin.json; run this script from the skill or from shared/scripts');
};

async function main() {
  const { values } = parseArgs({
    options: {
      accession: { type: 'string' }, type: { type: 'string' }, project: { type: 'string' },
      organism: { type: 'string' }, build: { type: 'string' }, 'primary-contact': { type: 'string' },
      contact: { type: 'string', multiple: true, default: [] }, skill: { type: 'string' },
      input: { type: 'string', multiple: true, default: [] }, curated: { type: 'string', multiple: true, default: [] },
      overrides: { type: 'string' }
    }
  });
  for (const k of ['accession', 'type', 'project', 'organism', 'build', 'primary-contact', 'skill']) {
    if (!values[k]) { console.error(`Missing --${k}`); process.exit(1); }
  }
  const config = openWorkspace();
  const git = createGit(config.repoPath);
  const { dir } = await writeProposal({
    git,
    repoPath: config.repoPath,
    curator: git.userEmail(),
    inputs: values.input,
    curated: values.curated,
    overrides: values.overrides,
    manifestInput: {
      accession: values.accession, datasetType: values.type, project: values.project,
      organismAbbrev: values.organism, targetBuild: values.build,
      contacts: { primary: values['primary-contact'], additional: values.contact },
      skill: { name: values.skill, version: pluginVersion() }
    }
  });
  console.log(dir);
}

main().catch(err => { console.error(`Error: ${err.message}`); process.exit(1); });
