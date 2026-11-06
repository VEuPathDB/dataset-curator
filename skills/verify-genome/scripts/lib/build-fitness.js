import { presenterFileRelativePath, presenterNameExists } from './presenter-file.js';
import { datasetFileRelativePath, entryDatasetExists, namePatternClash } from './dataset-file.js';
import { memoClassOf, readDatasetClassOnRef } from './dataset-classes.js';
import { homeProject } from './manifest.js';
import { DATASETS_DIR } from './project-organisms.js';
import { datasetsOf, entryNamed } from '../dataset-types/_common.js';
import { loadDatasetType } from '../dataset-types/index.js';
import { withSettledProposal, settlementOn } from './load-ops.js';

const NAME = 'buildFitness';

/**
 * The load checks, read from a ref through git instead of a checkout: every
 * organism settles, the presenter name and every dataset entry's name are free,
 * and each organism's dataset file exists (a new organism's file is not expected: load writes it, so its load refusals are reported instead). Never changes the checkout.
 */
export async function buildFitness({ git, manifest, proposalDir, against }) {
  const findings = [];
  const error = (message) => findings.push({ validator: NAME, severity: 'error', message });
  const datasetType = await loadDatasetType(manifest.datasetType);
  const { organisms, stops } = settlementOn(git, manifest, against);
  const entries = datasetsOf(proposalDir, manifest);
  const where = entries.length ? 'prepare-delivery' : 'load';
  stops.forEach((stop) => findings.push({ validator: NAME, severity: 'warning', message: `${stop} (needs a person's --settle at ${where})` }));
  if (stops.length) return findings;

  const names = await withSettledProposal(proposalDir, manifest, organisms, async (dir) => datasetType.presenterNames(dir));
  const presenters = presenterFileRelativePath(homeProject(manifest));
  if (!git.fileExistsOnRef(against, presenters)) error(`${presenters} is missing on ${against}`);
  else {
    const file = git.showFile(against, presenters);
    for (const name of names) if (presenterNameExists(file, name)) error(`Presenter "${name}" already exists in ${presenters} on ${against}`);
  }
  if (entries.length) {
    const abbrevs = organisms.map((o) => o.abbrev);
    const classOf = memoClassOf(null, (_, className) => readDatasetClassOnRef(git, against, className));
    for (const [i, o] of manifest.organisms.entries()) {
      const rel = datasetFileRelativePath(o.project, abbrevs[i]);
      if (!git.fileExistsOnRef(against, rel)) {
        if (o.source === 'new' && datasetType.newOrganismFiles && datasetType.newOrganismProblems) {
          const projectFiles = git.listDir(against, DATASETS_DIR).filter((n) => n.endsWith('.xml'))
            .map((n) => ({ relFile: `${DATASETS_DIR}/${n}`, xml: git.showFile(against, `${DATASETS_DIR}/${n}`) }));
          const problems = await withSettledProposal(proposalDir, manifest, organisms, async (dir, m) => datasetType.newOrganismProblems({ proposalDir: dir, manifest: m, organism: abbrevs[i], projectFiles }));
          problems.forEach(error);
        } else error(`${rel} is missing on ${against}`);
        continue;
      }
      const file = git.showFile(against, rel);
      for (const e of entries) {
        if (entryDatasetExists(file, classOf(e.datasetClass), e)) error(`${rel} on ${against} already has a ${entryNamed(e)}`);
      }
    }
    for (const e of entries) {
      const clash = namePatternClash(git, against, datasetType, { className: e.datasetClass, name: e.name, organisms: abbrevs });
      if (clash) error(clash);
    }
  }
  return findings;
}

export const buildFitnessValidator = { name: NAME, kind: 'content', tools: [], run: (ctx) => buildFitness(ctx) };
