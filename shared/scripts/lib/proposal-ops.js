import { mkdirSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { join, basename } from 'node:path';
import { write as writeManifest, read as readManifest, validate, MANIFEST_FILENAME } from './manifest.js';
import { readContactIds, contactsPath, CONTACTS_RELATIVE_PATH } from './contacts.js';

export const PROPOSALS_DIR = 'Proposals';
export const proposalBranch = (accession) => `proposal/${accession}`;
export const proposalRelativePath = (accession) => `${PROPOSALS_DIR}/${accession}`;

/**
 * Verifies the checkout is on a clean, current master; if a proposal already
 * exists on origin/master, consults its ticket. Creates proposal/<accession>.
 * Returns { mode: 'new' } or { mode: 'update', existingTicket }.
 */
export async function startProposal({ git, ticket, accession }) {
  git.fetch();
  if (git.currentBranch() !== 'master') throw new Error(`Expected to be on master, but on "${git.currentBranch()}"`);
  if (!git.isClean()) throw new Error('VEuPathDatasets working tree is not clean; commit or stash first');
  if (!git.isUpToDate('master')) throw new Error('master is behind origin/master; run: git -C veupathdb-repos/VEuPathDatasets pull');
  if (git.branchExists(proposalBranch(accession))) {
    throw new Error(`Branch ${proposalBranch(accession)} already exists. Delete it to start over:\n  git -C veupathdb-repos/VEuPathDatasets branch -D ${proposalBranch(accession)}`);
  }

  let result = { mode: 'new' };
  const manifestPath = `${proposalRelativePath(accession)}/${MANIFEST_FILENAME}`;
  if (git.fileExistsOnRef('origin/master', manifestPath)) {
    const existing = JSON.parse(git.showFile('origin/master', manifestPath));
    if (existing.ticket) {
      const status = await ticket.getStatus(existing.ticket);
      if (status !== 'proposed') {
        throw new Error(`Proposal ${accession} exists and its ticket ${existing.ticket.url} status is "${status}". It cannot be updated.`);
      }
    }
    result = { mode: 'update', existingTicket: existing.ticket };
  }

  git.createBranch(proposalBranch(accession), 'master');
  return result;
}

/**
 * Writes Proposals/<accession>/ with inputs/, curated/ and manifest.json.
 * Replaces any existing directory contents. Returns the proposal directory.
 */
export function writeProposal({ repoPath, manifestInput, curator, inputs, curated }) {
  const dir = join(repoPath, PROPOSALS_DIR, manifestInput.accession);
  const contactIds = readContactIds(contactsPath(repoPath));

  const manifest = {
    schemaVersion: 1,
    accession: manifestInput.accession,
    datasetType: manifestInput.datasetType,
    project: manifestInput.project,
    organismAbbrev: manifestInput.organismAbbrev,
    targetBuild: manifestInput.targetBuild,
    contacts: { primary: manifestInput.contacts.primary, additional: manifestInput.contacts.additional || [] },
    curator,
    createdAt: new Date().toISOString(),
    skill: manifestInput.skill
  };
  if (manifestInput.ticket) manifest.ticket = manifestInput.ticket;

  // Validate before touching the filesystem.
  const errors = validate(manifest, { dirName: manifestInput.accession, contactIds });
  if (errors.length) throw new Error(`Invalid manifest:\n  - ${errors.join('\n  - ')}`);

  if (existsSync(dir)) rmSync(dir, { recursive: true });
  mkdirSync(join(dir, 'inputs'), { recursive: true });
  mkdirSync(join(dir, 'curated'), { recursive: true });
  for (const f of inputs) copyFileSync(f, join(dir, 'inputs', basename(f)));
  for (const f of curated) copyFileSync(f, join(dir, 'curated', basename(f)));
  writeManifest(dir, manifest, { contactIds });
  return dir;
}

/**
 * Commits the proposal and contacts, pushes, opens a PR against master,
 * creates (or comments on) the ticket, records it in the manifest, amends.
 */
export async function publishProposal({ git, ticket, repoPath, accession, existingTicket }) {
  const branch = proposalBranch(accession);
  if (git.currentBranch() !== branch) throw new Error(`Expected to be on ${branch}, but on "${git.currentBranch()}"`);

  const dir = join(repoPath, PROPOSALS_DIR, accession);
  const manifest = readManifest(dir);
  const title = `[${manifest.project}] ${manifest.datasetType} ${accession} for build ${manifest.targetBuild}`;

  git.add([proposalRelativePath(accession), CONTACTS_RELATIVE_PATH]);
  git.commit(`Propose ${accession} (${manifest.datasetType}, ${manifest.project}, build ${manifest.targetBuild})`);
  git.push(branch);

  const summary = [
    `Dataset type: ${manifest.datasetType}`,
    `Project: ${manifest.project}`,
    `Organism: ${manifest.organismAbbrev}`,
    `Target build: ${manifest.targetBuild}`,
    `Primary contact: ${manifest.contacts.primary}`,
    `Additional contacts: ${manifest.contacts.additional.join(', ') || 'none'}`,
    `Curator: ${manifest.curator}`
  ].join('\n');

  const prUrl = git.openPullRequest({ base: 'master', head: branch, title, body: `${summary}\n\nProposal: \`${proposalRelativePath(accession)}\`` });

  let ref = existingTicket;
  if (ref) {
    await ticket.comment(ref, `Proposal updated. Pull request: ${prUrl}\n\n${summary}`);
  } else {
    ref = await ticket.create({ title, body: `Pull request: ${prUrl}\n\n${summary}` });
  }

  writeManifest(dir, { ...manifest, ticket: ref });
  git.add([`${proposalRelativePath(accession)}/${MANIFEST_FILENAME}`]);
  git.amendNoEdit();
  git.push(branch, { force: true });

  return { prUrl, ticket: ref, title };
}
