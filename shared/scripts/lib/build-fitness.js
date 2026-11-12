import { presenterFileRelativePath, presenterNameExists } from './presenter-file.js';
import { datasetFileRelativePath, entryDatasetExists, namePatternClash } from './dataset-file.js';
import { memoClassOf, readDatasetClassOnRef } from './dataset-classes.js';
import { homeProject } from './manifest.js';
import { DATASETS_DIR } from './project-organisms.js';
import { datasetsOf, entryNamed, isAmendedEntry } from '../dataset-types/_common.js';
import { loadDatasetType } from '../dataset-types/index.js';
import { withSettledProposal, settlementOn, composeLoadEdits } from './load-ops.js';
import { editTarget, editLabel } from './load-edits.js';

const NAME = 'buildFitness';

/**
 * The load checks, read from a ref through git instead of a checkout: every
 * organism settles, the presenter name and every dataset entry's name are free,
 * and each organism's dataset file exists (a new organism's file is not expected: load writes it, so its load refusals are reported instead).
 * Presenters a type amends (amendsPresenters) and entries it re-versions (amendsEntries) must exist instead. With a
 * build, each of the type's load edits is dry-run on the ref; a missing carried history value is a warning. Never changes the checkout.
 */
export async function buildFitness({ git, manifest, proposalDir, against, build = null }) {
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
  let targetsMissing = false;
  const missing = (message) => { targetsMissing = true; error(message); };
  if (!git.fileExistsOnRef(against, presenters)) missing(`${presenters} is missing on ${against}`);
  else {
    const file = git.showFile(against, presenters);
    for (const name of names) {
      const exists = presenterNameExists(file, name);
      if (datasetType.amendsPresenters && !exists) missing(`Presenter "${name}" is not in ${presenters} on ${against}; ${manifest.datasetType} amends an existing presenter`);
      if (!datasetType.amendsPresenters && exists) error(`Presenter "${name}" already exists in ${presenters} on ${against}`);
    }
  }
  const amended = await withSettledProposal(proposalDir, manifest, organisms, async (dir) => datasetType.amendsEntries?.(dir) ?? []);
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
        } else missing(`${rel} is missing on ${against}`);
        continue;
      }
      const file = git.showFile(against, rel);
      for (const e of entries) {
        const exists = entryDatasetExists(file, classOf(e.datasetClass), e);
        if (isAmendedEntry(amended, e) && !exists) missing(`${rel} on ${against} has no ${entryNamed(e)} to update`);
        if (!isAmendedEntry(amended, e) && exists) error(`${rel} on ${against} already has a ${entryNamed(e)}`);
      }
    }
    for (const e of entries.filter((x) => !isAmendedEntry(amended, x))) {
      const clash = namePatternClash(git, against, datasetType, { className: e.datasetClass, name: e.name, organisms: abbrevs });
      if (clash) error(clash);
    }
  }
  if (datasetType.loadEdits && build && !targetsMissing) {
    const edits = await withSettledProposal(proposalDir, manifest, organisms, async (dir, m) => datasetType.loadEdits(dir, { manifest: m, build, given: {} }));
    const inserted = insertTargets(manifest, datasetType, entries, amended, organisms);
    const read = (rel) => (git.fileExistsOnRef(against, rel) ? git.showFile(against, rel) : null);
    for (const edit of edits) {
      if (inserted.has(editTarget(edit))) {
        error(`${editLabel(edit)} edits ${editTarget(edit)}, which this proposal also inserts into; the dry run cannot compose them`);
        continue;
      }
      // Each edit alone, so a value the data loader gives at load never hides another edit's refusal.
      try {
        composeLoadEdits([], [edit], read);
      } catch (e) {
        const carry = e.cause?.code === 'HISTORY_CARRY_MISSING';
        findings.push({ validator: NAME, severity: carry ? 'warning' : 'error', message: carry ? `${e.message} (the data loader can give it at load)` : e.message });
      }
    }
  }
  return findings;
}

/** The files load inserts into: the presenter file unless presenters are amended, and each organism file when entries are added. */
function insertTargets(manifest, datasetType, entries, amended, organisms) {
  const files = new Set();
  if (!datasetType.amendsPresenters) files.add(presenterFileRelativePath(homeProject(manifest)));
  if (entries.some((e) => !isAmendedEntry(amended, e))) manifest.organisms.forEach((o, i) => files.add(datasetFileRelativePath(o.project, organisms[i].abbrev)));
  return files;
}

export const buildFitnessValidator = { name: NAME, kind: 'content', tools: [], run: (ctx) => buildFitness(ctx) };
