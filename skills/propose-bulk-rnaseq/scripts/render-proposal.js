#!/usr/bin/env node
/**
 * render-proposal.js - Renders a proposal's XML from its manifest and curated records.
 *
 * Usage: node render-proposal.js [--name | --dataset | --artifacts <dir>] [--build NN] <proposalDir>
 *   (default)        each organism's presenter XML, from curated/presenter.json
 *   --name           only the presenter names, one per line
 *   --build NN       the build for the presenter's history (default: a placeholder)
 *   --dataset        the <dataset> entry for the organism file, from curated/dataset.json,
 *                    checked against classes.xml in the checkout holding the proposal
 *   --artifacts dir  writes each organism's loading artifacts under dir, laid out
 *                    like the class's delivery directory, and prints where they go
 */
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { read as readManifest, organismsOf } from './lib/manifest.js';
import { findRepoRoot } from './lib/config.js';
import { readDatasetClass } from './lib/dataset-classes.js';
import { deliveryLocation, writeArtifacts, handoffNote } from './lib/artifacts.js';
import { loadDatasetType, readPresenter, readDataset, unknownInjectorProps, PREVIEW_BUILD } from './dataset-types/_common.js';

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
    if (!datasetType.datasetClass) throw new Error(`${manifest.datasetType} proposals have no dataset entry or artifacts yet`);
    const classDef = readDatasetClass(findRepoRoot(proposalDir), datasetType.datasetClass);
    if (values.dataset) {
      process.stdout.write(datasetType.renderDataset(proposalDir, classDef) + '\n');
      return;
    }
    const deliveries = organismsOf(manifest).map((organism) => {
      const { files } = datasetType.renderArtifacts(proposalDir, organism);
      const { target, relative } = deliveryLocation(manifest, classDef, organism);
      return { target, files, localDir: writeArtifacts(resolve(values.artifacts), relative, files) };
    });
    process.stdout.write(handoffNote({ deliveries, source: readDataset(proposalDir).source }) + '\n');
    return;
  }
  if (values.name) {
    process.stdout.write(datasetType.presenterNames(proposalDir).join('\n') + '\n');
  } else {
    const build = values.build ?? PREVIEW_BUILD;
    const xmls = organismsOf(manifest).map((organism) => datasetType.renderPresenter(proposalDir, { build, organism }));
    process.stdout.write(xmls.join('\n\n') + '\n');
  }

  if (!values.name && datasetType.injectorDefaults) {
    const { injectorProps } = readPresenter(proposalDir, { requiredFields: datasetType.requiredFields, requiredInjectorProps: datasetType.requiredInjectorProps });
    const unknown = unknownInjectorProps(datasetType.injectorDefaults, injectorProps);
    if (unknown.length) console.error(`Warning: injector props not in defaults: ${unknown.join(', ')}`);
  }
}

main().catch(err => { console.error(`Error: ${err.message}`); process.exit(1); });
