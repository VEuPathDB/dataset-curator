import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { expandPattern, identityValues } from './dataset-classes.js';

const ROOT = '@@manualDeliveryDir@@/';

/**
 * Where the class loads from, per classes.xml: the @@manualDeliveryDir@@
 * target, and the same path relative to that root for a local copy.
 */
export function deliveryLocation(manifest, classDef, organism) {
  const target = expandPattern(classDef.deliveryPath, identityValues(manifest, organism));
  if (!target.startsWith(ROOT)) throw new Error(`Delivery path "${target}" does not start with ${ROOT}`);
  return { target, relative: target.slice(ROOT.length).replace(/\/$/, '') };
}

/** Writes each artifact under baseDir/relative, replacing what is there. Returns that directory. */
export function writeArtifacts(baseDir, relative, files) {
  const dir = join(baseDir, relative);
  for (const [name, text] of Object.entries(files)) {
    const path = join(dir, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
  return dir;
}

function describeSource(source) {
  if (source.type === 'sra') return 'SRA: the samplesheet lists run accessions for the pipeline to fetch';
  if (source.type === 'server') return `server paths: ${source.paths.join(', ')}`;
  return `URLs: ${source.urls.join(', ')}`;
}

/** The hand-off for the data loading team, who alone copy to and check the server. */
export function handoffNote({ deliveries, source }) {
  // Top-level entries only, so organism-named subdirectories read the same for every delivery.
  const entries = new Set(deliveries.flatMap((d) => Object.keys(d.files).map((path) => path.split('/')[0])));
  return [
    `Artifacts: ${[...entries].sort().join(', ')}`,
    ...deliveries.map(({ localDir, target }) => `Copy \`${localDir}\` to \`${target}\``),
    `Reads: ${describeSource(source)}`,
    'Copying these files and checking the data on the server is the data loading team\'s step.'
  ].join('\n');
}
