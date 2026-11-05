import { existsSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, normalize, sep } from 'node:path';

const isInside = (path, root) => path === root || path.startsWith(root + sep);

/**
 * Asks the type for each location's files from the work area and checks them: paths relative
 * to the delivery directory without '..', sources that are regular files inside the work area
 * once symlinks resolve, and no delivery path given twice or also rendered as text.
 * Returns { sources: { deliveryPath: realSource }, provenance: { deliveryDir: object } }.
 */
export function collectPreprocessed({ datasetType, proposalDir, proposalId, locations, workArea, rendered = {} }) {
  if (!existsSync(workArea)) throw new Error(`No preprocessing work area for ${proposalId} at ${workArea}; run preprocessing there first`);
  const root = realpathSync(workArea);
  const sources = {};
  const provenance = {};
  const problems = [];
  for (const location of locations) {
    const { files = [], problems: own = [], provenance: summary = null } = datasetType.preprocessedFiles(proposalDir, location, { workArea });
    problems.push(...own.map((p) => `${location.label}: ${p}`));
    if (summary !== null) provenance[location.relative] = summary;
    for (const { path, from } of files) {
      const where = `${location.label}: ${path}`;
      if (typeof path !== 'string' || !path || isAbsolute(path) || normalize(path).split(sep).includes('..')) {
        problems.push(`${where} is not a relative path inside the delivery directory`);
        continue;
      }
      let real;
      try { real = realpathSync(from); } catch { problems.push(`${where}: ${from} does not exist`); continue; }
      if (!isInside(real, root)) { problems.push(`${where}: ${from} is outside the work area ${workArea}`); continue; }
      if (!statSync(real).isFile()) { problems.push(`${where}: ${from} is not a regular file`); continue; }
      const at = join(location.relative, path);
      if (Object.hasOwn(sources, at) || Object.hasOwn(rendered, at)) { problems.push(`${where}: ${at} is delivered twice`); continue; }
      sources[at] = real;
    }
  }
  if (problems.length) throw new Error(`${proposalId}: the preprocessing work area cannot be delivered:\n  - ${problems.join('\n  - ')}`);
  return { sources, provenance };
}
