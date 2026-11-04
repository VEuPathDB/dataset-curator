import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { expandPattern } from './dataset-classes.js';
import { projectOf } from './manifest.js';

const ROOT = '@@manualDeliveryDir@@/';

/**
 * Where one resolved entry loads from for one organism, per classes.xml: the
 * @@manualDeliveryDir@@ target directory, the same directory relative to that
 * root for a local copy, and the one file the class reads from it (null for
 * the whole directory). Placeholders come from the entry and the organism.
 */
export function deliveryLocation(manifest, classDef, organism, entry) {
  const values = { ...entry.props, projectName: projectOf(manifest, organism), organismAbbrev: organism, name: entry.name, version: entry.version };
  let relative;
  try { relative = expandPattern(classDef.delivery.dir, values); }
  catch (e) { throw new Error(`${entry.datasetClass} ${entry.name}: ${e.message}`); }
  return { target: `${ROOT}${relative}/`, relative, file: classDef.delivery.file };
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

/** fromProvider always sits beside the class's final delivery directory. */
export function fromProviderOf(finalRelative) {
  if (basename(finalRelative) !== 'final') throw new Error(`A delivery path must end in "final" so fromProvider can sit beside it; got "${finalRelative}"`);
  return join(dirname(finalRelative), 'fromProvider');
}

function describeSource(source) {
  if (source.type === 'sra') return 'SRA: the samplesheet lists run accessions for the pipeline to fetch';
  if (source.type === 'server') return `files named in the samplesheet, under: ${source.paths.join(', ')}`;
  return `files named in the samplesheet, at: ${source.urls.join(', ')}`;
}

/** The Phase 1 curator preview; preprocessing writes the real delivery. */
export function handoffNote({ deliveries, source }) {
  // Top-level entries only, so organism-named subdirectories read the same for every delivery.
  const entries = new Set(deliveries.flatMap((d) => Object.keys(d.files).map((path) => path.split('/')[0])));
  return [
    'Preview of final/ (preprocessing writes the real delivery):',
    `Artifacts: ${[...entries].sort().join(', ')}`,
    ...deliveries.map(({ localDir, target }) => `${localDir} → ${target}`),
    `Reads: ${describeSource(source)}`
  ].join('\n');
}
