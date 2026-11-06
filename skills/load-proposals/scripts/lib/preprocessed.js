import { existsSync, lstatSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, normalize, sep } from 'node:path';

const isInside = (path, root) => path === root || path.startsWith(root + sep);

/**
 * Asks the type for each location's files from the work area and checks them: paths relative
 * to the delivery directory without '..', sources that are regular files inside the work area
 * once symlinks resolve, and no delivery path given twice or also rendered as text.
 * report is the verification report prepare-delivery checked, handed to the type with a cache for this call;
 * a problem several locations report is named once, under the first.
 * Returns { sources: { deliveryPath: realSource }, provenance: { deliveryDir: object } }.
 */
export function collectPreprocessed({ datasetType, proposalDir, proposalId, locations, workArea, rendered = {}, report = null }) {
  let link = false;
  try { link = lstatSync(workArea).isSymbolicLink(); } catch { link = false; }
  if (link) throw new Error(`The preprocessing work area ${workArea} is a symbolic link; preprocess in the directory itself, not a link to it`);
  if (!existsSync(workArea) || !statSync(workArea).isDirectory()) throw new Error(`No preprocessing work area for ${proposalId} at ${workArea}; run preprocessing there first`);
  const root = realpathSync(workArea);
  const sources = {};
  const provenance = {};
  const problems = [];
  const seen = new Set();
  const cache = {};
  for (const location of locations) {
    const { files = [], problems: own = [], provenance: summary = null } = datasetType.preprocessedFiles(proposalDir, location, { workArea, report, cache });
    for (const p of own.filter((p) => !seen.has(p))) {
      seen.add(p);
      problems.push(`${location.label}: ${p}`);
    }
    if (summary !== null) provenance[location.relative] = summary;
    for (const { path, from } of files) {
      const where = `${location.label}: ${path}`;
      const clean = typeof path === 'string' && path ? normalize(path) : '';
      if (!clean || clean === '.' || clean.endsWith(sep) || isAbsolute(clean) || clean.split(sep).includes('..')) {
        problems.push(`${where} is not a relative path inside the delivery directory`);
        continue;
      }
      if (typeof from !== 'string' || !isAbsolute(from)) { problems.push(`${where}: \`from\` must be an absolute path`); continue; }
      let real;
      try { real = realpathSync(from); } catch { problems.push(`${where}: ${from} does not exist`); continue; }
      if (!isInside(real, root)) { problems.push(`${where}: ${from} is outside the work area ${workArea}`); continue; }
      if (!statSync(real).isFile()) { problems.push(`${where}: ${from} is not a regular file`); continue; }
      const at = join(location.relative, clean);
      if (Object.hasOwn(sources, at) || Object.hasOwn(rendered, at)) { problems.push(`${where}: ${at} is delivered twice`); continue; }
      const other = [...Object.keys(sources), ...Object.keys(rendered)].map(normalize).find((o) => o.startsWith(at + sep) || at.startsWith(o + sep));
      if (other) { problems.push(`${where}: ${at} clashes with ${other}`); continue; }
      sources[at] = real;
    }
  }
  if (problems.length) throw new Error(`${proposalId}: the preprocessing work area cannot be delivered:\n  - ${problems.join('\n  - ')}`);
  return { sources, provenance };
}
