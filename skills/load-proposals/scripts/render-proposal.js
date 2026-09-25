#!/usr/bin/env node
/**
 * render-proposal.js - Renders presenter XML from a proposal's manifest and curated/presenter.json.
 *
 * Usage: node render-proposal.js [--name] <proposalDir>
 *   --name  print only the presenter name instead of the XML
 */
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { read as readManifest } from './lib/manifest.js';
import { loadRenderer, readPresenter, unknownInjectorProps } from './renderers/_common.js';

async function main() {
  const { values, positionals } = parseArgs({
    options: { name: { type: 'boolean', default: false } },
    allowPositionals: true
  });
  if (positionals.length !== 1) {
    console.error('Usage: node render-proposal.js [--name] <proposalDir>');
    process.exit(1);
  }
  const proposalDir = resolve(positionals[0]);
  const manifest = readManifest(proposalDir);
  const renderer = await loadRenderer(manifest.datasetType);
  process.stdout.write(values.name ? renderer.presenterName(proposalDir) + '\n' : renderer.render(proposalDir) + '\n');

  if (!values.name && renderer.injectorDefaults) {
    const { injectorProps } = readPresenter(proposalDir, { requiredFields: renderer.requiredFields });
    const unknown = unknownInjectorProps(renderer.injectorDefaults, injectorProps);
    if (unknown.length) console.error(`Warning: injector props not in defaults: ${unknown.join(', ')}`);
  }
}

main().catch(err => { console.error(`Error: ${err.message}`); process.exit(1); });
