import { mkdirSync, writeFileSync, cpSync, rmSync, symlinkSync } from 'node:fs';
import { join, dirname, basename, relative } from 'node:path';
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

/** fromProvider always sits beside the class's final delivery directory. */
export function fromProviderOf(finalRelative) {
  if (basename(finalRelative) !== 'final') throw new Error(`A delivery path must end in "final" so fromProvider can sit beside it; got "${finalRelative}"`);
  return join(dirname(finalRelative), 'fromProvider');
}

/**
 * Copies the whole proposal to the first organism's fromProvider/proposal and
 * makes every other organism's fromProvider a relative symlink to it, so the
 * link survives copying the tree to the server. Returns the first fromProvider.
 */
export function archiveProposal(baseDir, finalRelatives, proposalDir) {
  const [home, ...others] = finalRelatives.map((f) => join(baseDir, fromProviderOf(f)));
  rmSync(home, { recursive: true, force: true });
  mkdirSync(home, { recursive: true });
  cpSync(proposalDir, join(home, 'proposal'), { recursive: true });
  for (const link of others) {
    mkdirSync(dirname(link), { recursive: true });
    rmSync(link, { recursive: true, force: true });
    symlinkSync(relative(dirname(link), home), link);
  }
  return home;
}

function describeSource(source) {
  if (source.type === 'sra') return 'SRA: the samplesheet lists run accessions for the pipeline to fetch';
  if (source.type === 'server') return `files named in the samplesheet, under: ${source.paths.join(', ')}`;
  return `files named in the samplesheet, at: ${source.urls.join(', ')}`;
}

/** The hand-off for the data loading team, who alone copy to and check the server. */
export function handoffNote({ deliveries, source, archive }) {
  // Top-level entries only, so organism-named subdirectories read the same for every delivery.
  const entries = new Set(deliveries.flatMap((d) => Object.keys(d.files).map((path) => path.split('/')[0])));
  return [
    `Artifacts: ${[...entries].sort().join(', ')}`,
    ...deliveries.map(({ localDir, target }) => `Copy \`${localDir}\` to \`${target}\``),
    ...(archive ? [`Proposal archive: \`${archive.localDir}\` to \`${archive.target}\`; the other organisms' fromProvider link to it, so copy with cp -a or rsync -a to keep the links`] : []),
    `Reads: ${describeSource(source)}`,
    'Copying these files and checking the data on the server is the data loading team\'s step.'
  ].join('\n');
}
