import { mkdirSync, mkdtempSync, copyFileSync, cpSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import {
  write as writeManifest, read as readManifest, readOnRef, validate,
  proposalRelativePath, MANIFEST_FILENAME, PROPOSALS_DIR
} from './manifest.js';
import { readContactIds, contactsPath, CONTACTS_RELATIVE_PATH } from './contacts.js';
import { assertClean, assertOnBranch } from './guards.js';
import { loadRenderer, readOverrides, assertValidPresenter, presenterPath, PRESENTER_FILENAME } from '../renderers/_common.js';

export { PROPOSALS_DIR, proposalRelativePath };
export const proposalBranch = (accession) => `proposal/${accession}`;

/** Every stop message names how to get back on the proposal branch. */
const assertOnProposalBranch = (git, accession, recovery) =>
  assertOnBranch(git, proposalBranch(accession), recovery);

/**
 * Verifies the checkout is on a clean, current master with no proposal branch
 * here or on origin; if a proposal already exists on origin/master, consults
 * its ticket. Creates proposal/<accession>.
 * Returns { mode: 'new' } or { mode: 'update', existingTicket }.
 */
export async function startProposal({ git, ticket, accession, forceUpdate = false }) {
  const branch = proposalBranch(accession);
  git.fetch();

  assertOnBranch(git, 'master', `git -C '${git.repoPath}' checkout master`);
  assertClean(git);
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
 * Writes Proposals/<accession>/ with inputs/, curated/ (including the derived
 * presenter.json) and manifest.json, replacing any existing directory. The
 * proposal is built and trial-rendered in a staging directory first, so a
 * missing input or an incomplete presenter leaves the existing one untouched.
 * overrides is an optional path to curator presenter overrides.
 * Returns { dir, presenter }.
 */
export async function writeProposal({ git, repoPath, manifestInput, curator, inputs, curated, overrides }) {
  const accession = manifestInput.accession;
  assertOnProposalBranch(git, accession, `node scripts/start-proposal.js ${accession}`);

  const missing = [...inputs, ...curated, ...(overrides ? [overrides] : [])].filter((f) => !existsSync(f));
  if (missing.length) {
    throw new Error(`These files do not exist:\n  - ${missing.join('\n  - ')}\nRe-run the fetch steps that write them, then run this script again.`);
  }
  const clash = curated.find((f) => basename(f) === PRESENTER_FILENAME);
  if (clash) throw new Error(`${clash}: ${PRESENTER_FILENAME} is derived by this script; pass curator edits with --overrides`);

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
  const overrideValues = readOverrides(overrides);

  const staging = mkdtempSync(join(tmpdir(), 'proposal-'));
  try {
    const staged = join(staging, accession);
    mkdirSync(join(staged, 'inputs'), { recursive: true });
    mkdirSync(join(staged, 'curated'), { recursive: true });
    for (const f of inputs) copyFileSync(f, join(staged, 'inputs', basename(f)));
    for (const f of curated) copyFileSync(f, join(staged, 'curated', basename(f)));
    writeManifest(staged, manifest, { contactIds });

    const renderer = await loadRenderer(manifest.datasetType);
    const presenter = renderer.derive(staged, overrideValues);
    assertValidPresenter(presenter, { requiredFields: renderer.requiredFields },
      `presenter for ${accession} (set the missing fields with --overrides)`);
    writeFileSync(presenterPath(staged), JSON.stringify(presenter, null, 2) + '\n');
    renderer.render(staged);

    if (existsSync(dir)) rmSync(dir, { recursive: true });
    cpSync(staged, dir, { recursive: true });
    return { dir, presenter };
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
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

  const ahead = git.aheadOf('origin/master');
  if (!git.isClean()) {
    git.add([proposalRelativePath(accession), CONTACTS_RELATIVE_PATH]);
    // A run that died between writing the manifest and amending leaves the
    // branch ahead with a dirty tree; folding it in keeps one commit.
    if (ahead >= 1) git.amendNoEdit();
    else git.commit(`Propose ${accession} (${manifest.datasetType}, ${manifest.project}, build ${manifest.targetBuild})`);
  } else if (ahead === 0) {
    throw new Error(`Nothing to publish: ${branch} has no commit beyond origin/master and the working tree is clean. Write the proposal first: node scripts/write-proposal.js --accession ${accession} ...`);
  }

  const alreadyPushed = git.remoteBranchExists(branch);
  git.push(branch, { force: alreadyPushed });

  const openPr = git.findPullRequest(branch);
  const prUrl = openPr ?? git.openPullRequest({
    base: 'master', head: branch, title,
    body: `${summary}\n\nProposal: \`${proposalRelativePath(accession)}\``
  });

  // An update is a proposal already on master; its ticket hears about every
  // pull request, and the URL in the note keeps a re-run from repeating it.
  const priorTicket = readOnRef(git, 'origin/master', accession)?.ticket ?? null;
  let ref = manifest.ticket ?? priorTicket;
  if (!ref) {
    ref = await ticket.create({ title, body: `Pull request: ${prUrl}\n\n${summary}`, build: manifest.targetBuild });
  } else if (priorTicket) {
    await ticket.commentOnce(ref, `Proposal updated. Pull request: ${prUrl}\n\n${summary}`);
  }

  if (!manifest.ticket) {
    writeManifest(dir, { ...manifest, ticket: ref }, { contactIds });
    git.add([`${proposalRelativePath(accession)}/${MANIFEST_FILENAME}`]);
    git.amendNoEdit();
    git.push(branch, { force: true });
  }

  return { prUrl, ticket: ref, title, resumed: alreadyPushed || openPr !== null };
}
