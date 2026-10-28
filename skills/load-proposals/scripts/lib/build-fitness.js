import { presenterFileRelativePath, presenterNameExists } from './presenter-file.js';
import { datasetFileRelativePath, datasetNameExists, namePatternClash } from './dataset-file.js';
import { homeProject } from './manifest.js';
import { loadDatasetType } from '../dataset-types/_common.js';
import { withSettledProposal, settlementOn } from './load-ops.js';

const NAME = 'buildFitness';

/**
 * The load checks, read from a ref through git instead of a checkout: every
 * organism settles, the presenter name and dataset names are free, and each
 * organism's dataset file exists. Never changes the checkout.
 */
export async function buildFitness({ git, manifest, proposalDir, against }) {
  const findings = [];
  const error = (message) => findings.push({ validator: NAME, severity: 'error', message });
  const { organisms, stops } = settlementOn(git, manifest, against);
  stops.forEach((stop) => findings.push({ validator: NAME, severity: 'warning', message: `${stop} (needs a person's --settle at load)` }));
  if (stops.length) return findings;

  const datasetType = await loadDatasetType(manifest.datasetType);
  const names = await withSettledProposal(proposalDir, manifest, organisms, async (dir) => datasetType.presenterNames(dir));
  const presenters = presenterFileRelativePath(homeProject(manifest));
  if (!git.fileExistsOnRef(against, presenters)) error(`${presenters} is missing on ${against}`);
  else {
    const file = git.showFile(against, presenters);
    for (const name of names) if (presenterNameExists(file, name)) error(`Presenter "${name}" already exists in ${presenters} on ${against}`);
  }
  if (datasetType.datasetClass) {
    const abbrevs = organisms.map((o) => o.abbrev);
    manifest.organisms.forEach((o, i) => {
      const rel = datasetFileRelativePath(o.project, abbrevs[i]);
      if (!git.fileExistsOnRef(against, rel)) error(`${rel} is missing on ${against}`);
      else if (datasetNameExists(git.showFile(against, rel), manifest.datasetClass, manifest.name)) error(`${rel} on ${against} already has a ${manifest.datasetClass} named "${manifest.name}"`);
    });
    const clash = namePatternClash(git, against, datasetType, { className: manifest.datasetClass, name: manifest.name, organisms: abbrevs });
    if (clash) error(clash);
  }
  return findings;
}

export const buildFitnessValidator = { name: NAME, tools: [], run: (ctx) => buildFitness(ctx) };
