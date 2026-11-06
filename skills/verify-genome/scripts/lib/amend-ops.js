import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { read as readManifest, announce, proposalBranch, proposalRelativePath, PROPOSALS_DIR } from './manifest.js';
import { readContactIds, contactsPath } from './contacts.js';
import { assertOnBranch } from './guards.js';
import { memoClassOf } from './dataset-classes.js';
import { typeDirOf, workAreaOf } from './validation-workspace.js';
import { loadDatasetType } from '../dataset-types/index.js';
import {
  assertValidEntries, renderDatasets, readCuratedJson, DATASETS_FILENAME, DATASETS_SCHEMA_VERSION, ORGANISM_RECORD_FILENAME
} from '../dataset-types/_common.js';

/**
 * Writes the type's preprocessedAmendment into curated/datasets.json and curated/organism.json on the proposal branch,
 * keeping every other record key and constant; a scratch copy is validated first, so a refusal writes nothing.
 * Returns { dir, entries, constants, organism (the whole record), sources, diff (against origin/master) }.
 */
export async function amendProposal({ git, repoPath, workspace, proposalId, given = {} }) {
  assertOnBranch(git, proposalBranch(proposalId), 'node scripts/start-proposal.js <accession> --type <datasetType>');
  const dir = join(repoPath, PROPOSALS_DIR, proposalId);
  const manifest = readManifest(dir, { contactIds: readContactIds(contactsPath(repoPath)) });
  announce(proposalId, manifest);
  const datasetType = await loadDatasetType(manifest.datasetType);
  if (!datasetType.preprocessedAmendment) throw new Error(`${manifest.datasetType} proposals are not amended from preprocessing; amend-proposal.js has nothing to write`);
  const t = typeDirOf(workspace, manifest.datasetType);
  if (t.error) throw new Error(t.error);
  const workArea = workAreaOf(t.typeDir, proposalId);
  if (!existsSync(workArea)) throw new Error(`No preprocessing work area for ${proposalId} at ${workArea}; run preprocessing there first`);

  const amendment = datasetType.preprocessedAmendment({ workArea, proposalDir: dir, manifest, given });
  const record = readCuratedJson(dir, ORGANISM_RECORD_FILENAME);
  const organism = {
    ...record, ...amendment.organism, schemaVersion: datasetType.ORGANISM_RECORD_SCHEMA_VERSION, constants: { ...record.constants, ...amendment.constants }
  };
  const files = {
    [DATASETS_FILENAME]: JSON.stringify({ schemaVersion: DATASETS_SCHEMA_VERSION, datasets: amendment.entries }, null, 2) + '\n',
    [ORGANISM_RECORD_FILENAME]: JSON.stringify(organism, null, 2) + '\n'
  };
  const scratch = mkdtempSync(join(tmpdir(), 'amend-'));
  try {
    const staged = join(scratch, proposalId);
    cpSync(dir, staged, { recursive: true });
    for (const [name, text] of Object.entries(files)) writeFileSync(join(staged, 'curated', name), text);
    const classOf = memoClassOf(repoPath);
    assertValidEntries(staged, manifest, datasetType, { classOf });
    renderDatasets(staged, manifest, datasetType, classOf);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, 'curated', name), text);
  return { dir, ...amendment, organism, diff: git.diff('origin/master', `${proposalRelativePath(proposalId)}/curated`) };
}
