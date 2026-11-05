#!/usr/bin/env node
/**
 * render-proposal.js - Renders a proposal's XML from its manifest and curated records.
 *
 * Usage: node render-proposal.js [--name | --dataset | --artifacts <dir>] [--build NN] <proposalDir>
 *   (default)        the presenter XML, from curated/presenter.json
 *   --name           only the presenter names, one per line
 *   --build NN       the build for the presenter's history (default: a placeholder)
 *   --dataset        every <dataset> element for the organism file, from curated/datasets.json,
 *                    checked against classes.xml in the checkout holding the proposal
 *   --artifacts dir  writes each organism's loading artifacts under dir, laid out
 *                    like the class's delivery directory, and prints where they go
 */
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { read as readManifest } from './lib/manifest.js';
import { findRepoRoot } from './lib/config.js';
import { readDatasetClass } from './lib/dataset-classes.js';
import { writeArtifacts, handoffNote } from './lib/artifacts.js';
import { readPresenter, unknownInjectorProps, PREVIEW_BUILD, assertValidEntries, renderDatasets, entryDeliveries, constantsOf } from './dataset-types/_common.js';
import { loadDatasetType } from './dataset-types/index.js';

const USAGE = 'Usage: node render-proposal.js [--name | --dataset | --artifacts <dir>] [--build NN] <proposalDir>';

async function main() {
  const { values, positionals } = parseArgs({
    options: {
      name: { type: 'boolean', default: false }, dataset: { type: 'boolean', default: false }, artifacts: { type: 'string' }, build: { type: 'string' }
    },
    allowPositionals: true
  });
  if (positionals.length !== 1 || [values.name, values.dataset, values.artifacts !== undefined].filter(Boolean).length > 1) {
    console.error(USAGE);
    process.exit(1);
  }
  const proposalDir = resolve(positionals[0]);
  const manifest = readManifest(proposalDir);
  const datasetType = await loadDatasetType(manifest.datasetType);

  if (values.dataset || values.artifacts !== undefined) {
    if (values.artifacts !== undefined && !datasetType.renderArtifacts) throw new Error(`${manifest.datasetType} proposals have no loading artifacts to preview`);
    let repoRoot;
    const classes = new Map();
    const classOf = (className) => {
      repoRoot ??= findRepoRoot(proposalDir);
      if (!classes.has(className)) classes.set(className, readDatasetClass(repoRoot, className));
      return classes.get(className);
    };
    const entries = assertValidEntries(proposalDir, manifest, datasetType, { classOf });
    if (!entries.length) throw new Error(`${manifest.accession} has no dataset entries, so there is no dataset entry or artifact to render`);
    if (values.dataset) {
      process.stdout.write(renderDatasets(proposalDir, manifest, datasetType, classOf) + '\n');
      return;
    }
    const deliveries = entryDeliveries(manifest, entries, { classOf, constants: constantsOf(proposalDir), datasetType }).map(({ organism, target, relative }) => {
      const { files } = datasetType.renderArtifacts(proposalDir, organism);
      return { target, files, localDir: writeArtifacts(resolve(values.artifacts), relative, files) };
    });
    // Types with renderArtifacts are singleEntry, so entries[0] is the only source.
    process.stdout.write(handoffNote({ deliveries, source: entries[0].source }) + '\n');
    return;
  }
  if (values.name) {
    process.stdout.write(datasetType.presenterNames(proposalDir).join('\n') + '\n');
  } else {
    const build = values.build ?? PREVIEW_BUILD;
    process.stdout.write(datasetType.renderPresenter(proposalDir, { build }) + '\n');
  }

  if (!values.name && datasetType.injectorDefaults) {
    const { injectorProps, organisms = {} } = readPresenter(proposalDir, { requiredFields: datasetType.requiredFields, requiredInjectorProps: datasetType.requiredInjectorProps });
    const unknown = [...new Set([injectorProps, ...Object.values(organisms).map((o) => o.injectorProps ?? {})]
      .flatMap((chosen) => unknownInjectorProps(datasetType.injectorDefaults, chosen)))];
    if (unknown.length) console.error(`Warning: injector props not in defaults: ${unknown.join(', ')}`);
  }
}

main().catch(err => { console.error(`Error: ${err.message}`); process.exit(1); });
