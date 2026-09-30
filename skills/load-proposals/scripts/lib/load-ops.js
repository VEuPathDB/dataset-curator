import { readFileSync, writeFileSync, existsSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  read as readManifest, readOnRef, proposalRelativePath,
  MANIFEST_FILENAME, PROPOSALS_DIR
} from './manifest.js';
import {
  presenterFilePath, presenterFileRelativePath, presenterNameExists,
  insertPresenter, extractPresenterName
} from './presenter-file.js';
import { readContactIds, readContactIdsOnRef, contactsPath } from './contacts.js';
import { assertClean, assertOnBranch } from './guards.js';
import { loadDatasetType, readDataset } from '../dataset-types/_common.js';
import { readDatasetClass } from './dataset-classes.js';
import { datasetFilePath, datasetFileRelativePath, datasetNameExists, insertDataset } from './dataset-file.js';
import { deliveryLocation, writeArtifacts, handoffNote } from './artifacts.js';
import { excludeScratch, SCRATCH_DIR } from './config.js';

export { PROPOSALS_DIR, proposalRelativePath };
export const loadBranch = (accession) => `load/${accession}`;
export const rebuildBranch = (build) => `rebuild${build}`;


/**
 * Proposals on the working tree with the build their ticket names,
 * optionally filtered by build. A proposal without a ticket has build null.
 * One unreadable manifest or ticket must not hide the rest, so it is
 * reported in `errors` rather than thrown.
 * Returns { proposals: [{ manifest, build }], errors: [{ accession, message }] }.
 */
export async function listProposals(repoPath, { ticket, build } = {}) {
  const dir = join(repoPath, PROPOSALS_DIR);
  const proposals = [];
  const errors = [];
  if (!existsSync(dir)) return { proposals, errors };
  const contactIds = readContactIds(contactsPath(repoPath));
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    if (!d.isDirectory() || !existsSync(join(dir, d.name, MANIFEST_FILENAME))) continue;
    try {
      const manifest = readManifest(join(dir, d.name), { contactIds });
      const found = manifest.ticket ? await ticket.getBuild(manifest.ticket) : null;
      if (!build || found === build) proposals.push({ manifest, build: found });
    } catch (err) {
      errors.push({ accession: d.name, message: err.message });
    }
  }
  return { proposals, errors };
}

/**
 * Rejects with a precise, actionable message on the first failed check.
 * For a proposal already on this branch the presenter is rendered here
 * (renderPresenter is pure) so the name-collision check runs before anything is
 * touched. For a straggler (only on origin/master) the manifest is read from
 * that ref, `straggler` lists the commits since the rebuild branch to
 * cherry-pick, and the render for the collision check runs against a scratch
 * export of origin/master. A load branch that is already
 * checked out with the proposal consumed is a previous run that failed after
 * its commit, and is reported as `resume` rather than refused.
 */
export async function checkLoadPreconditions({ git, ticket, repoPath, accession }) {
  const proposalDir = join(repoPath, PROPOSALS_DIR, accession);
  const relDir = proposalRelativePath(accession);
  const branch = loadBranch(accession);
  // Freshness and straggler detection both read origin, so fetch first.
  git.fetch();

  const onLoadBranch = (git.currentBranch() || '') === branch;
  const dirty = onLoadBranch ? await dirtyTreeMessage(git, ticket, repoPath, accession) : undefined;
  assertClean(git, () => dirty);

  // Contacts as this checkout has them, for a proposal already on this branch.
  const contactIds = readContactIds(contactsPath(repoPath));

  let manifest = null;
  let isStraggler = false;
  if (existsSync(join(proposalDir, MANIFEST_FILENAME))) {
    manifest = readManifest(proposalDir, { contactIds });
  } else if ((git.currentBranch() || '') === branch) {
    // A resumed load: its own commit removed the proposal, the parent still has it.
    manifest = readOnRef(git, 'HEAD~1', accession, { contactIds: readContactIdsOnRef(git, 'HEAD~1') });
  }
  if (!manifest) {
    // A straggler brings its own contacts: its Phase 1 commit added them to
    // master, so it is judged against master, and against the rebuild branch
    // only once the cherry-pick has brought them over.
    manifest = readOnRef(git, 'origin/master', accession, { contactIds: readContactIdsOnRef(git, 'origin/master') });
    if (!manifest) {
      throw new Error(`No proposal found at ${relDir} on this branch or on origin/master. Check the accession, or confirm its proposal pull request was merged.`);
    }
    isStraggler = true;
  }

  if (!manifest.ticket) {
    throw new Error(`Proposal ${accession} has no ticket, so it has no build. Record its ticket in ${relDir}/${MANIFEST_FILENAME} on master.`);
  }
  const build = await ticket.getBuild(manifest.ticket);
  const base = rebuildBranch(build);
  const current = git.currentBranch() || 'detached HEAD';
  const presenterPath = presenterFilePath(repoPath, manifest.project);

  if (current === branch && !existsSync(proposalDir) && git.aheadOf(base) >= 1) {
    return { manifest, proposalDir, presenterPath, straggler: null, base, branch, build, resume: true };
  }
  assertOnBranch(git, base, `git -C '${repoPath}' checkout ${base}`,
    { because: `The proposal's ticket is in build ${build} (${base}).` });
  if (!git.isUpToDate(base)) {
    throw new Error(`${base} is not at origin/${base}; run: git -C '${repoPath}' pull`);
  }
  if (git.branchExists(branch)) {
    throw new Error(`Branch ${branch} already exists. Inspect it, then delete it to rerun:\n  git -C '${repoPath}' branch -D ${branch}`);
  }
  if (git.remoteBranchExists(branch)) {
    throw new Error(`Branch origin/${branch} already exists. Inspect its pull request, then delete it to rerun:\n  git -C '${repoPath}' push origin --delete ${branch}`);
  }
  if (!existsSync(presenterPath)) {
    throw new Error(`Presenter file missing: ${presenterFileRelativePath(manifest.project)}. Ask which project file this dataset belongs in.`);
  }

  if (!isStraggler) {
    const rendered = await renderAndCheck(manifest, proposalDir, presenterPath, repoPath, build);
    return { manifest, proposalDir, presenterPath, straggler: null, base, branch, build, resume: false, ...rendered };
  }

  // The rebuild branch bounds the search, so an earlier build's propose and
  // load commits for this accession are not dragged along.
  const straggler = git.commitsForPath(`${base}..origin/master`, relDir);
  if (straggler.length === 0) {
    throw new Error(`${relDir} is on origin/master but no commit since ${base} touches it; the history is not what this skill expects. Inspect with: git -C '${repoPath}' log ${base}..origin/master -- ${relDir}`);
  }
  // Render from a scratch copy of origin/master so a proposal already loaded
  // into this build is refused before the load branch exists.
  const rendered = await withProposalFromRef(git, 'origin/master', relDir,
    (dir) => renderAndCheck(manifest, dir, presenterPath, repoPath, build));
  return { manifest, proposalDir, presenterPath, straggler, base, branch, build, resume: false, ...rendered };
}

/** Runs fn on a scratch export of the proposal as ref has it, without touching the checkout. */
async function withProposalFromRef(git, ref, relDir, fn) {
  const scratch = mkdtempSync(join(tmpdir(), 'load-from-ref-'));
  try {
    git.exportTree(ref, relDir, scratch);
    return await fn(join(scratch, relDir));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** A dirty load branch is a previous run, so it gets its own way out. */
async function dirtyTreeMessage(git, ticket, repoPath, accession) {
  const branch = loadBranch(accession);
  const target = readOnRef(git, 'HEAD~1', accession) ?? readOnRef(git, 'origin/master', accession);
  let base = 'rebuild<NN>';
  if (target?.ticket) {
    try { base = rebuildBranch(await ticket.getBuild(target.ticket)); } catch { /* keep the placeholder */ }
  }
  return `A previous load left uncommitted changes on ${branch}; to start over: git -C '${repoPath}' checkout -f ${base} && git -C '${repoPath}' branch -D ${branch}`;
}

/**
 * A run that got as far as the load commit can be finished by re-running;
 * anything earlier leaves a half-built branch that is cheaper to discard.
 */
function recoveryFooter({ git, repoPath, proposalDir, base, branch }) {
  let resumable = false;
  try {
    resumable = (git.currentBranch() || '') === branch && !existsSync(proposalDir) && git.aheadOf(base) >= 1;
  } catch { resumable = false; }
  if (resumable) return 'Re-run the same command to resume.';
  // A cherry-pick stopped on a conflict holds the checkout hostage.
  let gitDir = join(repoPath, '.git');
  try { gitDir = git.gitDir(); } catch { /* keep the conventional location */ }
  const midPick = existsSync(join(gitDir, 'CHERRY_PICK_HEAD')) || existsSync(join(gitDir, 'sequencer'));
  const abort = midPick ? `git -C '${repoPath}' cherry-pick --abort && ` : '';
  return `To start over: ${abort}git -C '${repoPath}' checkout -f ${base} && git -C '${repoPath}' branch -D ${branch}`;
}

/** The load commit names the presenter it inserted, so a resume can recover it. */
function presenterNameFromCommit(subject) {
  return /^Load \S+: add (\S+) to /.exec(subject)?.[1] ?? null;
}

/**
 * Everything a load writes, rendered while the proposal still exists: the
 * presenter and, for types with a dataset class, the organism-file entry and
 * the loading artifacts. Refuses a name already present in either file.
 */
async function renderAndCheck(manifest, proposalDir, presenterPath, repoPath, build) {
  const datasetType = await loadDatasetType(manifest.datasetType);
  const xml = datasetType.renderPresenter(proposalDir, { build });
  const presenterName = extractPresenterName(xml);
  const presenterFile = readFileSync(presenterPath, 'utf-8');
  if (presenterNameExists(presenterFile, presenterName)) {
    throw new Error(`Presenter "${presenterName}" already exists in ${presenterFileRelativePath(manifest.project)}. It may already be loaded; ask before continuing.`);
  }
  return { xml, presenterName, presenterFile, ...(await renderDatasetParts(manifest, proposalDir, repoPath, { check: true })) };
}

/** Dataset entry and artifacts; check refuses a missing organism file or a taken name. */
async function renderDatasetParts(manifest, proposalDir, repoPath, { check }) {
  const datasetType = await loadDatasetType(manifest.datasetType);
  if (!datasetType.datasetClass) return { dataset: null };
  const classDef = readDatasetClass(repoPath, datasetType.datasetClass);
  const relFile = datasetFileRelativePath(manifest.project, manifest.organismAbbrev);
  let datasetFile = null;
  if (check) {
    const path = datasetFilePath(repoPath, manifest.project, manifest.organismAbbrev);
    if (!existsSync(path)) throw new Error(`Dataset file missing: ${relFile}. Is ${manifest.organismAbbrev} a ${manifest.project} organism on this build?`);
    datasetFile = readFileSync(path, 'utf-8');
    if (datasetNameExists(datasetFile, classDef.className, manifest.name)) {
      throw new Error(`${relFile} already has a ${classDef.className} named "${manifest.name}". It may already be loaded; ask before continuing.`);
    }
  }
  return {
    dataset: {
      relFile, datasetFile, xml: datasetType.renderDataset(proposalDir, classDef),
      files: datasetType.renderArtifacts(proposalDir).files,
      delivery: deliveryLocation(manifest, classDef),
      source: readDataset(proposalDir).source
    }
  };
}

/**
 * Renders, inserts the presenter (and the dataset entry, for types with a
 * dataset class), deletes the proposal, commits once, writes the loading
 * artifacts under deliveryBase for the data loading team to copy, pushes,
 * opens a PR against the rebuild branch of the build the ticket names, comments
 * on and transitions the ticket. dryRun performs only checks and rendering,
 * reading nothing from the ticket but its build. Idempotent: a re-run after a
 * failure past the commit reuses that commit and any open pull request, and
 * the ticket hears about the pull request once.
 */
export async function loadProposal({ git, ticket, repoPath, accession, dryRun = false, deliveryBase }) {
  const pre = await checkLoadPreconditions({ git, ticket, repoPath, accession });
  const { manifest, proposalDir, presenterPath, straggler, base, branch, build, resume } = pre;
  const relDir = proposalRelativePath(accession);
  const warnings = [];
  if (straggler) warnings.push(`Proposal ${accession} is not on ${base}; will cherry-pick ${straggler.join(', ')} from origin/master.`);
  if (resume) warnings.push(`Branch ${branch} already holds the load commit; resuming with push, pull request and ticket.`);
  if (dryRun) {
    return {
      presenterName: pre.presenterName, xml: pre.xml, dataset: pre.dataset ?? null, manifest, warnings,
      cherryPicked: straggler || [], dryRun: true
    };
  }

  git.checkGhAuth();

  let { presenterFile, xml, presenterName, dataset } = pre;
  let prUrl;
  let handoff = null;
  // Everything below changes the repository, the forge or the ticket, so a
  // failure ends with the one recovery the current state allows.
  try {
    if (!resume) {
      git.createBranch(branch, base);
      if (straggler) {
        git.cherryPick(straggler);
        // The cherry-pick may have moved allContacts.xml, so the manifest is
        // re-validated against the contacts this branch now holds.
        const onBranch = readManifest(proposalDir, { contactIds: readContactIds(contactsPath(repoPath)) });
        ({ presenterFile, xml, presenterName, dataset } = await renderAndCheck(onBranch, proposalDir, presenterPath, repoPath, build));
      }
      writeFileSync(presenterPath, insertPresenter(presenterFile, xml));
      const changed = [presenterFileRelativePath(manifest.project)];
      if (dataset) {
        writeFileSync(join(repoPath, dataset.relFile), insertDataset(dataset.datasetFile, dataset.xml));
        changed.push(dataset.relFile);
      }
      git.add(changed);
      git.rm(relDir);
      const alsoDataset = dataset ? `, ${manifest.name} to ${manifest.organismAbbrev}` : '';
      git.commit(`Load ${accession}: add ${presenterName} to ${manifest.project}${alsoDataset}, remove proposal`);
    }
    if (resume) {
      presenterName ??= presenterNameFromCommit(git.headSubject());
      // The load commit removed the proposal; its parent still has it.
      ({ dataset } = await withProposalFromRef(git, 'HEAD~1', relDir,
        (dir) => renderDatasetParts(manifest, dir, repoPath, { check: false })));
    }
    if (dataset) {
      excludeScratch(repoPath);
      const localDir = writeArtifacts(deliveryBase ?? join(repoPath, SCRATCH_DIR, 'delivery'), dataset.delivery.relative, dataset.files);
      handoff = handoffNote({ target: dataset.delivery.target, localDir, files: dataset.files, source: dataset.source });
    }
    git.push(branch, resume ? { force: git.remoteBranchExists(branch) } : {});

    const title = `Load ${accession} (${manifest.datasetType}, ${manifest.project}) into build ${build}`;
    const body = [
      `Presenter: \`${presenterName ?? 'see the commit on this branch'}\` in \`${presenterFileRelativePath(manifest.project)}\``,
      ...(dataset ? [`Dataset: \`${manifest.name}\` (${manifest.datasetClass}) in \`${dataset.relFile}\``] : []),
      `Proposal removed: \`${relDir}\``,
      `Part of ${ticket.mention(manifest.ticket)}`,
      ...(handoff ? ['', handoff] : [])
    ].join('\n');
    const openPr = git.findPullRequest(branch);
    prUrl = openPr ?? git.openPullRequest({ base, head: branch, title, body });

    await ticket.commentOnce(manifest.ticket, [`Loading into ${base}. Pull request: ${prUrl}`, ...(handoff ? ['', handoff] : [])].join('\n'));
    await ticket.setStatus(manifest.ticket, 'loading');
  } catch (err) {
    throw new Error(`${err.message}\n${recoveryFooter({ git, repoPath, proposalDir, base, branch })}`, { cause: err });
  }
  return {
    presenterName, xml, manifest, prUrl, branch, base, warnings, handoff,
    cherryPicked: straggler || [], dryRun: false, resumed: Boolean(resume)
  };
}
