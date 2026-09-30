import { mkdirSync, mkdtempSync, copyFileSync, cpSync, existsSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import {
  write as writeManifest, read as readManifest, readOnRef, validate, organismsOf, organismsFor, organismKeys,
  proposalRelativePath, MANIFEST_FILENAME, PROPOSALS_DIR, IDENTITY_FIELDS
} from './manifest.js';
import { readContactIds, readContactName, contactsPath, CONTACTS_RELATIVE_PATH } from './contacts.js';
import { assertClean, assertOnBranch } from './guards.js';
import {
  loadDatasetType, readOverrides, assertValidPresenter, presenterPath, datasetPath, PRESENTER_FILENAME, DATASET_FILENAME, PREVIEW_BUILD
} from '../dataset-types/_common.js';
import { readDatasetClass } from './dataset-classes.js';
import { datasetFilePath, datasetFileRelativePath, datasetNameExists } from './dataset-file.js';

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

/** Built per call: the organism keys come from the dataset-type registry. */
const manifestOrder = () => [
  'schemaVersion', 'accession', 'datasetType', 'project', ...organismKeys(),
  ...IDENTITY_FIELDS, 'contacts', 'curator', 'createdAt', 'skill', 'ticket'
];
const inManifestOrder = (m) => Object.fromEntries(manifestOrder().filter((k) => k in m).map((k) => [k, m[k]]));

/** Other proposals on master are read unvalidated, so any organism field counts. */
const organismsIn = (m) => organismKeys()
  .flatMap((k) => (Array.isArray(m[k]) ? m[k] : [m[k]]))
  .filter((a) => typeof a === 'string' && a !== '');

/**
 * The experiment name must be new for each of its organisms: not in the
 * organism's dataset file, and not claimed by another proposal already on master.
 */
function assertNameIsFree(git, repoPath, m) {
  const organisms = organismsOf(m);
  for (const organism of organisms) {
    const file = datasetFilePath(repoPath, m.project, organism);
    if (!existsSync(file)) {
      throw new Error(`${datasetFileRelativePath(m.project, organism)} does not exist; is ${organism} a ${m.project} organism?`);
    }
    if (datasetNameExists(readFileSync(file, 'utf-8'), m.datasetClass, m.name)) {
      throw new Error(`${datasetFileRelativePath(m.project, organism)} already has a ${m.datasetClass} named "${m.name}"; choose another "name" in --overrides`);
    }
  }
  for (const other of git.listDir('origin/master', PROPOSALS_DIR)) {
    if (other === m.accession) continue;
    let theirs;
    try { theirs = JSON.parse(git.showFile('origin/master', `${proposalRelativePath(other)}/${MANIFEST_FILENAME}`)); }
    catch { continue; }
    if (theirs.name !== m.name) continue;
    const shared = organisms.find((organism) => organismsIn(theirs).includes(organism));
    if (shared) {
      throw new Error(`Proposal ${other} on master already uses the name "${m.name}" for ${shared}; choose another "name" in --overrides`);
    }
  }
}

/**
 * name and version for a dataset type that makes a classes.xml dataset:
 * curator overrides first, then what the type can derive from the inputs.
 */
function identityFor(datasetType, stagedDir, manifest, overrides, repoPath) {
  if (!datasetType.datasetClass) {
    if (overrides.name !== undefined || overrides.version !== undefined) {
      throw new Error(`${manifest.datasetType} proposals do not take a name or version yet`);
    }
    return {};
  }
  const derived = datasetType.deriveIdentity(stagedDir, {
    primaryContactName: readContactName(contactsPath(repoPath), manifest.contacts.primary)
  });
  const identity = {
    datasetClass: datasetType.datasetClass,
    name: overrides.name ?? derived.name,
    version: overrides.version ?? derived.version
  };
  const missing = ['name', 'version'].filter((k) => !identity[k]);
  if (missing.length) {
    throw new Error(`No ${missing.join(' or ')} could be derived for ${manifest.accession}; set ${missing.map((k) => `"${k}"`).join(' and ')} in the --overrides file`);
  }
  return identity;
}

/**
 * Writes Proposals/<accession>/ with inputs/, curated/ (including the derived
 * presenter.json) and manifest.json, replacing any existing directory. The
 * proposal is built and trial-rendered in a staging directory first, so a
 * missing input or an incomplete presenter leaves the existing one untouched.
 * overrides is an optional path to curator presenter overrides.
 * Returns { dir, presenter, dataset, manifest }.
 */
export async function writeProposal({ git, repoPath, manifestInput, curator, inputs, curated, overrides }) {
  const accession = manifestInput.accession;
  assertOnProposalBranch(git, accession, `node scripts/start-proposal.js ${accession}`);

  const missing = [...inputs, ...curated, ...(overrides ? [overrides] : [])].filter((f) => !existsSync(f));
  if (missing.length) {
    throw new Error(`These files do not exist:\n  - ${missing.join('\n  - ')}\nRe-run the fetch steps that write them, then run this script again.`);
  }
  const clash = curated.find((f) => [PRESENTER_FILENAME, DATASET_FILENAME].includes(basename(f)));
  if (clash) throw new Error(`${clash}: ${basename(clash)} is derived by this script; pass curator edits with --overrides`);

  const dir = join(repoPath, PROPOSALS_DIR, accession);
  const contactIds = readContactIds(contactsPath(repoPath));
  // A proposal already on master keeps its ticket, so the branch describes itself.
  const recordedTicket = readOnRef(git, 'origin/master', accession)?.ticket;

  const manifest = {
    schemaVersion: 2,
    accession,
    datasetType: manifestInput.datasetType,
    project: manifestInput.project,
    ...organismsFor(manifestInput),
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
  const datasetType = await loadDatasetType(manifest.datasetType);

  const staging = mkdtempSync(join(tmpdir(), 'proposal-'));
  try {
    const staged = join(staging, accession);
    mkdirSync(join(staged, 'inputs'), { recursive: true });
    mkdirSync(join(staged, 'curated'), { recursive: true });
    for (const f of inputs) copyFileSync(f, join(staged, 'inputs', basename(f)));
    for (const f of curated) copyFileSync(f, join(staged, 'curated', basename(f)));

    const full = inManifestOrder({ ...manifest, ...identityFor(datasetType, staged, manifest, overrideValues, repoPath) });
    writeManifest(staged, full, { contactIds });

    const presenter = datasetType.derivePresenter(staged, overrideValues.presenter);
    assertValidPresenter(presenter, { requiredFields: datasetType.requiredFields },
      `presenter for ${accession} (set the missing fields under "presenter" in --overrides)`);
    writeFileSync(presenterPath(staged), JSON.stringify(presenter, null, 2) + '\n');

    let dataset;
    if (datasetType.datasetClass) {
      const classDef = readDatasetClass(repoPath, datasetType.datasetClass);
      assertNameIsFree(git, repoPath, full);
      dataset = datasetType.deriveDataset(staged, classDef, overrideValues.dataset);
      writeFileSync(datasetPath(staged), JSON.stringify(dataset, null, 2) + '\n');
      datasetType.renderDataset(staged, classDef);
    } else if (overrideValues.dataset) {
      throw new Error(`${manifest.datasetType} proposals do not take dataset overrides yet`);
    }
    for (const organism of organismsOf(full)) datasetType.renderPresenter(staged, { build: PREVIEW_BUILD, organism });

    if (existsSync(dir)) rmSync(dir, { recursive: true });
    cpSync(staged, dir, { recursive: true });
    return { dir, presenter, dataset, manifest: full };
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

/**
 * Creates the ticket (or reuses the recorded one) and records it in the
 * manifest, commits the proposal and contacts, pushes, opens a PR against
 * master that cites the ticket, and notes the PR on the ticket.
 * Idempotent: a re-run after a failure reuses the commit, the open pull
 * request and the recorded ticket. build is required when a ticket must be
 * created (it becomes the ticket's milestone) and must match the milestone of
 * a ticket already recorded. Returns { prUrl, ticket, title, resumed }.
 */
export async function publishProposal({ git, ticket, repoPath, accession, build }) {
  if (build !== undefined && !/^\d{2,}$/.test(build)) throw new Error(`--build must be two or more digits, e.g. 02; got "${build}"`);
  const branch = proposalBranch(accession);
  const dir = join(repoPath, PROPOSALS_DIR, accession);

  // Preflight: nothing below mutates git, the ticket system or the manifest.
  assertOnProposalBranch(git, accession, `git -C '${repoPath}' checkout -- ${proposalRelativePath(accession)} ${CONTACTS_RELATIVE_PATH}`);
  git.checkGhAuth();
  const contactIds = readContactIds(contactsPath(repoPath));
  const manifest = readManifest(dir, { contactIds });
  git.fetch();

  const title = `[${manifest.project}] ${manifest.datasetType} ${accession}`;
  const summary = [
    `Proposal: \`${proposalRelativePath(accession)}\``,
    `Dataset type: ${manifest.datasetType}`,
    `Project: ${manifest.project}`,
    `Organisms: ${organismsOf(manifest).join(', ')}`,
    ...(manifest.name ? [`Name: ${manifest.name}`, `Version: ${manifest.version}`] : []),
    `Primary contact: ${manifest.contacts.primary}`,
    `Additional contacts: ${manifest.contacts.additional.join(', ') || 'none'}`,
    `Curator: ${manifest.curator}`
  ].join('\n');

  const ahead = git.aheadOf('origin/master');
  if (git.isClean() && ahead === 0) {
    throw new Error(`Nothing to publish: ${branch} has no commit beyond origin/master and the working tree is clean. Write the proposal first: node scripts/write-proposal.js --accession ${accession} ...`);
  }

  // The ticket comes first so the pull request is opened citing it. An update
  // is a proposal already on master and keeps that proposal's ticket.
  const priorTicket = readOnRef(git, 'origin/master', accession)?.ticket ?? null;
  const known = manifest.ticket ?? priorTicket;
  if (!known && build === undefined) throw new Error('A new ticket needs a build: re-run with --build NN');
  if (known && build !== undefined) {
    const current = await ticket.getBuild(known);
    if (current !== build) throw new Error(`The ticket ${known.url} is in build ${current}, not ${build}; move its milestone instead of passing --build`);
  }
  const ref = known ?? await ticket.create({ title: `${title} for build ${build}`, body: summary, build });
  if (!manifest.ticket) writeManifest(dir, { ...manifest, ticket: ref }, { contactIds });

  if (!git.isClean()) {
    git.add([proposalRelativePath(accession), CONTACTS_RELATIVE_PATH]);
    // A branch already ahead was committed by an earlier run; folding the
    // changes in keeps one commit.
    if (ahead >= 1) git.amendNoEdit();
    else git.commit(`Propose ${accession} (${manifest.datasetType}, ${manifest.project})`);
  }

  const alreadyPushed = git.remoteBranchExists(branch);
  git.push(branch, { force: alreadyPushed });

  const openPr = git.findPullRequest(branch);
  const prUrl = openPr ?? git.openPullRequest({
    base: 'master', head: branch, title,
    body: `Part of ${ticket.mention(ref)}\n\n${summary}`
  });

  // The URL in the note keeps a re-run from repeating it.
  await ticket.commentOnce(ref, priorTicket
    ? `Proposal updated. Pull request: ${prUrl}\n\n${summary}`
    : `Pull request: ${prUrl}`);

  return { prUrl, ticket: ref, title, resumed: alreadyPushed || openPr !== null };
}
