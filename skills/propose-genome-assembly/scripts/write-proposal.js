#!/usr/bin/env node
/**
 * write-proposal.js - Writes Proposals/<accession>/ in VEuPathDatasets.
 *
 * Usage:
 *   node write-proposal.js --accession GCA_1.1 [--external-id kind=id ...] --type genome-assembly --project FungiDB \
 *     --organism tfakST1 [--also-organism <abbrev> ...] --rebuild-branch rebuildNN --primary-contact jane.doe [--contact ravi.kumar ...] \
 *     --skill propose-genome-assembly --input .curation/tmp/a.json [--input .curation/tmp/b.json ...] \
 *     [--curated .curation/tmp/c.json ...] [--overrides .curation/tmp/overrides.json] \
 *     [--keep-edits | --replace-edits | --keep-edit <file> ... --replace-edit <file> ...]
 *
 * Derives curated/presenter.json, curated/dataset.json (for types with a
 * dataset class) and, for RNA-seq, the curated loading artifacts, and prints
 * the proposal directory. Curated loading artifacts that differ from what it
 * would derive are refused unless the curator's choice is given: for all of
 * them (--keep-edits, --replace-edits) or per file (--keep-edit, --replace-edit).
 */
import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { openWorkspace } from './lib/config.js';
import { createGit } from './lib/git-ops.js';
import { writeProposal } from './lib/proposal-ops.js';
import { parseExternalIds } from './lib/manifest.js';

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
      accession: { type: 'string' }, 'external-id': { type: 'string', multiple: true, default: [] }, type: { type: 'string' }, project: { type: 'string' },
      organism: { type: 'string' }, 'rebuild-branch': { type: 'string' }, 'also-organism': { type: 'string', multiple: true, default: [] },
      'primary-contact': { type: 'string' },
      contact: { type: 'string', multiple: true, default: [] }, skill: { type: 'string' },
      input: { type: 'string', multiple: true, default: [] }, curated: { type: 'string', multiple: true, default: [] },
      overrides: { type: 'string' },
      'keep-edits': { type: 'boolean' }, 'replace-edits': { type: 'boolean' },
      'keep-edit': { type: 'string', multiple: true, default: [] }, 'replace-edit': { type: 'string', multiple: true, default: [] }
    }
  });
  for (const k of ['accession', 'type', 'project', 'organism', 'rebuild-branch', 'primary-contact', 'skill']) {
    if (!values[k]) { console.error(`Missing --${k}`); process.exit(1); }
  }
  const perFile = values['keep-edit'].length + values['replace-edit'].length > 0;
  if ([values['keep-edits'], values['replace-edits'], perFile].filter(Boolean).length > 1) {
    console.error('Pass one of --keep-edits, --replace-edits, or per-file --keep-edit/--replace-edit');
    process.exit(1);
  }
  const config = openWorkspace();
  const git = createGit(config.repoPath);
  const { dir } = await writeProposal({
    git,
    repoPath: config.repoPath,
    rebuildBranch: values['rebuild-branch'],
    curator: git.userEmail(),
    inputs: values.input,
    curated: values.curated,
    overrides: values.overrides,
    curatedEdits: values['keep-edits'] ? 'keep' : values['replace-edits'] ? 'replace'
      : perFile ? { keep: values['keep-edit'], replace: values['replace-edit'] } : undefined,
    manifestInput: {
      accession: values.accession, externalIds: parseExternalIds(values['external-id'], values.accession), datasetType: values.type, project: values.project,
      organism: values.organism, additionalOrganisms: values['also-organism'],
      contacts: { primary: values['primary-contact'], additional: values.contact },
      skill: { name: values.skill, version: pluginVersion() }
    }
  });
  console.log(dir);
}

main().catch(err => { console.error(`Error: ${err.message}`); process.exit(1); });
