#!/usr/bin/env node
/**
 * functional-update.js - Preprocesses a functional-update proposal in its work area
 * (<workspace>/functional-update-validation/proposals/<proposal>/preprocess/).
 *
 *   fetch   <proposal> --workspace <root> --against origin/rebuildRR   pull the staged file and the released GFF
 *   columns <proposal> --workspace <root> [--write --header|--no-header --id <col>:<level> --value <key>=<col> ...]
 *           without --write: print the inferred mapping for the data loader to confirm
 *   convert <proposal> --workspace <root>                              write final/<file> and convert.json; exits 1 on an error finding
 */
import { parseArgs } from 'node:util';
import { openWorkspace } from './lib/config.js';
import { createGit } from './lib/git-ops.js';
import { readOnRef, proposalRelativePath } from './lib/manifest.js';
import { createRemote } from './lib/remote.js';
import { openDeliveryDir, workAreaOf } from './lib/validation-workspace.js';
import { pendingGenomeProposals } from './lib/organisms.js';
import { datasetFileRelativePath, organismFileConstants } from './lib/dataset-file.js';
import { organismDatasetProps, projectFileRelativePath } from './lib/project-organisms.js';
import { datasetsOf, readerOnRef } from './dataset-types/_common.js';
import { runFetch, inferColumns, writeColumns, runConvert } from './dataset-types/functional-update/commands.js';
import { pluginVersion } from './lib/plugin-version.js';

const TYPE = 'functional-update';


async function main() {
  const { values, positionals: [command, proposalId] } = parseArgs({
    options: {
      workspace: { type: 'string' }, against: { type: 'string' }, write: { type: 'boolean', default: false },
      header: { type: 'boolean' }, 'no-header': { type: 'boolean' }, id: { type: 'string' }, value: { type: 'string', multiple: true, default: [] }
    },
    allowPositionals: true
  });
  if (!['fetch', 'columns', 'convert'].includes(command) || !proposalId || !values.workspace) {
    console.error('Usage: node functional-update.js fetch|columns|convert <proposal> --workspace <root> [--against origin/rebuildRR]');
    process.exit(1);
  }
  const config = openWorkspace();
  const git = createGit(config.repoPath);
  git.fetch();
  const manifest = readOnRef(git, 'origin/master', proposalId);
  if (!manifest) throw new Error(`No proposal ${proposalId} on origin/master`);
  if (manifest.datasetType !== TYPE) throw new Error(`${proposalId} is a ${manifest.datasetType} proposal, not ${TYPE}`);
  const { typeDir, staging } = openDeliveryDir({ root: values.workspace, datasetType: TYPE, proposalId });
  const workArea = workAreaOf(typeDir, proposalId);
  const [entry] = datasetsOf(proposalRelativePath(proposalId), manifest, { read: readerOnRef(git, 'origin/master') });

  if (command === 'fetch') {
    if (!/^origin\/rebuild\d+$/.test(values.against ?? '')) throw new Error('fetch needs --against origin/rebuildRR');
    const { proposedOrganismAbbrev: abbrev, project } = manifest.organisms[0];
    const props = organismDatasetProps(git.showFile(values.against, projectFileRelativePath(project))).find((p) => p.organismAbbrev === abbrev);
    if (!props?.organismNameForFiles) throw new Error(`${projectFileRelativePath(project)} on ${values.against} has no organism ${abbrev} with organismNameForFiles`);
    const constants = organismFileConstants(git.showFile(values.against, datasetFileRelativePath(project, abbrev)));
    const pendingGenomes = pendingGenomeProposals(git, ['origin/master']).filter((g) => g.organism?.proposedOrganismAbbrev === abbrev).map((g) => g.accession);
    const record = await runFetch({
      workArea, proposalId, staged: manifest.staging[0], stagingPath: `${staging.root}/${proposalId}`, remote: createRemote({ host: staging.host }),
      organism: { abbrev, project, nameForFiles: props.organismNameForFiles, ncbiTaxonId: constants.ncbiTaxonId ?? null }, pendingGenomes
    });
    console.error(`GFF: ${record.gff.url} (release ${record.gff.release})`);
    if (pendingGenomes.length) console.error(`Genome proposal ${pendingGenomes.join(', ')} names ${abbrev}: validation will fail until it loads`);
    console.log(workArea);
    return;
  }
  if (command === 'columns') {
    if (!values.write) {
      console.log(JSON.stringify(inferColumns(workArea, entry.datasetClass), null, 2));
      return;
    }
    if (Boolean(values.header) === Boolean(values['no-header'])) throw new Error('columns --write needs exactly one of --header or --no-header');
    const [column, level] = (values.id ?? '').split(':');
    const mapped = Object.fromEntries(values.value.map((pair) => { const [k, n] = pair.split('='); return [k, Number(n)]; }));
    writeColumns(workArea, entry.datasetClass, { header: Boolean(values.header), id: { column: Number(column), level }, values: mapped });
    console.log(workArea);
    return;
  }
  const record = runConvert({ workArea, entry: { datasetClass: entry.datasetClass, name: entry.name, version: entry.version }, generatorVersion: pluginVersion() });
  for (const f of record.findings) console.error(`${f.severity} ${f.check} (${f.count}): ${f.message}${f.sample.length ? ` [${f.sample.join(', ')}]` : ''}`);
  console.error(`${record.file}: ${record.rows} rows, ${record.ids.count} ${record.ids.level} IDs`);
  console.log(workArea);
  if (record.findings.some((f) => f.severity === 'error')) process.exit(1);
}

main().catch((err) => { console.error(`Error: ${err.message}`); process.exit(1); });
