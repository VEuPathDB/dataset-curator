import { mkdirSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { join, basename } from 'node:path';
import {
  write as writeManifest, read as readManifest, readOnRef, validate,
  MANIFEST_FILENAME, PROPOSALS_DIR
} from './manifest.js';
import { readContactIds, contactsPath, CONTACTS_RELATIVE_PATH } from './contacts.js';

export { PROPOSALS_DIR };
export const proposalBranch = (accession) => `proposal/${accession}`;
export const proposalRelativePath = (accession) => `${PROPOSALS_DIR}/${accession}`;

const branchName = (git) => git.currentBranch() || 'detached HEAD';

/** Every stop message names how to get back on the proposal branch. */
function assertOnProposalBranch(git, accession, recovery) {
  const branch = proposalBranch(accession);
  const current = branchName(git);
  if (current !== branch) {
    throw new Error(`Expected to be on ${branch}, but on "${current}".\nRecover with:\n  ${recovery}`);
  }
}

/**
 * Verifies the checkout is on a clean, current master with no proposal branch
 * here or on origin; if a proposal already exists on origin/master, consults
 * its ticket. Creates proposal/<accession>.
 * Returns { mode: 'new' } or { mode: 'update', existingTicket }.
 */
export async function startProposal({ git, ticket, accession, forceUpdate = false }) {
  const branch = proposalBranch(accession);
  git.fetch();

  const current = branchName(git);
  if (current !== 'master') {
    throw new Error(`Expected to be on master, but on "${current}"; run: git -C '${git.repoPath}' checkout master`);
  }
  if (!git.isClean()) {
    throw new Error(`VEuPathDatasets working tree is not clean; commit or stash first. Inspect with: git -C '${git.repoPath}' status`);
  }
  if (!git.isUpToDate('master')) {
    throw new Error(`master is behind origin/master; run: git -C '${git.repoPath}' pull`);
  }
  if (git.branchExists(branch)) {
    throw new Error(`Branch ${branch} already exists here. Delete it to start over:\n  git -C '${git.repoPath}' branch -D ${branch}`);
  }
  if (git.remoteBranchExists(branch)) {
    throw new Error(`Branch ${branch} already exists on origin. Delete it to start over:\n  git -C '${git.repoPath}' push origin --delete ${branch}`);
  }

  let result = { mode: 'new' };
  const existing = readOnRef(git, 'origin/master', accession);
  if (existing) {
    if (existing.ticket) {
      const status = await ticket.getStatus(existing.ticket);
      if (status !== 'proposed') {
        throw new Error(`Proposal ${accession} exists and its ticket ${existing.ticket.url} status is "${status}". It cannot be updated.`);
      }
    } else if (!forceUpdate) {
      throw new Error(`Proposal ${accession} exists on master but its manifest has no ticket, so its status cannot be checked. Add the ticket to ${proposalRelativePath(accession)}/${MANIFEST_FILENAME} on master, or re-run with --force-update to treat it as proposed.`);
    }
    result = { mode: 'update', existingTicket: existing.ticket };
  }

  git.createBranch(branch, 'master');
  return result;
}

/**
 * Writes Proposals/<accession>/ with inputs/, curated/ and manifest.json,
 * replacing any existing directory contents. Everything is checked before the
 * first filesystem change. Returns the proposal directory.
 */
export function writeProposal({ git, repoPath, manifestInput, curator, inputs, curated }) {
  const accession = manifestInput.accession;
  assertOnProposalBranch(git, accession, `node scripts/start-proposal.js ${accession}`);

  const missing = [...inputs, ...curated].filter((f) => !existsSync(f));
  if (missing.length) {
    throw new Error(`These files do not exist:\n  - ${missing.join('\n  - ')}\nRe-run the fetch steps that write them, then run this script again.`);
  }

  const dir = join(repoPath, PROPOSALS_DIR, accession);
  const contactIds = readContactIds(contactsPath(repoPath));
  // A proposal already on master keeps its ticket, so the branch describes itself.
  const recordedTicket = readOnRef(git, 'origin/master', accession)?.ticket;

  const manifest = {
    schemaVersion: 1,
    accession,
    datasetType: manifestInput.datasetType,
    project: manifestInput.project,
    organismAbbrev: manifestInput.organismAbbrev,
    targetBuild: manifestInput.targetBuild,
    contacts: { primary: manifestInput.contacts.primary, additional: manifestInput.contacts.additional || [] },
    curator,
    createdAt: new Date().toISOString(),
    skill: manifestInput.skill
  };
  const ticketRef = manifestInput.ticket ?? recordedTicket;
  if (ticketRef) manifest.ticket = ticketRef;

  const errors = validate(manifest, { dirName: accession, contactIds });
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
 * creates (or comments on) the ticket and records it in the manifest.
 * Idempotent: a re-run after a failure reuses the commit, the open pull
 * request and the recorded ticket. Returns { prUrl, ticket, title, resumed }.
 */
export async function publishProposal({ git, ticket, repoPath, accession }) {
  const branch = proposalBranch(accession);
  const dir = join(repoPath, PROPOSALS_DIR, accession);

  // Preflight: nothing below mutates git, the ticket system or the manifest.
  assertOnProposalBranch(git, accession, `git -C '${repoPath}' checkout -- ${proposalRelativePath(accession)} ${CONTACTS_RELATIVE_PATH}`);
  git.checkGhAuth();
  const contactIds = readContactIds(contactsPath(repoPath));
  const manifest = readManifest(dir, { contactIds });
  git.fetch();

  const title = `[${manifest.project}] ${manifest.datasetType} ${accession} for build ${manifest.targetBuild}`;
  const summary = [
    `Dataset type: ${manifest.datasetType}`,
    `Project: ${manifest.project}`,
    `Organism: ${manifest.organismAbbrev}`,
    `Target build: ${manifest.targetBuild}`,
    `Primary contact: ${manifest.contacts.primary}`,
    `Additional contacts: ${manifest.contacts.additional.join(', ') || 'none'}`,
    `Curator: ${manifest.curator}`
  ].join('\n');

  if (!git.isClean()) {
    git.add([proposalRelativePath(accession), CONTACTS_RELATIVE_PATH]);
    git.commit(`Propose ${accession} (${manifest.datasetType}, ${manifest.project}, build ${manifest.targetBuild})`);
  } else if (git.aheadOf('origin/master') === 0) {
    throw new Error(`Nothing to publish: ${branch} has no commit beyond origin/master and the working tree is clean. Write the proposal first: node scripts/write-proposal.js --accession ${accession} ...`);
  }

  const alreadyPushed = git.remoteBranchExists(branch);
  git.push(branch, { force: alreadyPushed });

  const openPr = git.findPullRequest(branch);
  const prUrl = openPr ?? git.openPullRequest({
    base: 'master', head: branch, title,
    body: `${summary}\n\nProposal: \`${proposalRelativePath(accession)}\``
  });

  let ref = manifest.ticket;
  if (!ref) {
    const prior = readOnRef(git, 'origin/master', accession)?.ticket;
    if (prior) {
      await ticket.comment(prior, `Proposal updated. Pull request: ${prUrl}\n\n${summary}`);
      ref = prior;
    } else {
      ref = await ticket.create({ title, body: `Pull request: ${prUrl}\n\n${summary}` });
    }
  } else if (!alreadyPushed) {
    // An update carries the ticket from master; tell it about this pull request.
    await ticket.comment(ref, `Proposal updated. Pull request: ${prUrl}\n\n${summary}`);
  }

  if (!manifest.ticket) {
    writeManifest(dir, { ...manifest, ticket: ref }, { contactIds });
    git.add([`${proposalRelativePath(accession)}/${MANIFEST_FILENAME}`]);
    git.amendNoEdit();
    git.push(branch, { force: true });
  }

  return { prUrl, ticket: ref, title, resumed: alreadyPushed || openPr !== null };
}
