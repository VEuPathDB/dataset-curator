import { readFileSync, writeFileSync, existsSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  read as readManifest, readOnRef, proposalRelativePath, organismsOf,
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
import { assertStatus } from './ticket/index.js';

export { PROPOSALS_DIR, proposalRelativePath };
// A dry run changes nothing, so it also serves verification before mark-ready.
const DRY_RUN_STATUSES = ['proposed', 'verifying', 'ready', 'revision'];
export const loadBranch = (accession) => `load/${accession}`;
export const rebuildBranch = (build) => `rebuild${build}`;


/**
 * Proposals on the working tree with the build and status their ticket has,
 * optionally filtered by build and status. A proposal without a ticket has
 * build and status null. Read-only. One unreadable manifest or ticket must
 * not hide the rest, so it is reported in `errors` rather than thrown.
 * Returns { proposals: [{ manifest, build, status }], errors: [{ accession, message }] }.
 */
export async function listProposals(repoPath, { ticket, build, status } = {}) {
  if (status !== undefined) assertStatus(status);
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
      if (build && found !== build) continue;
      const current = manifest.ticket ? await ticket.getStatus(manifest.ticket) : null;
      if (status && current !== status) continue;
      proposals.push({ manifest, build: found, status: current });
    } catch (err) {
      errors.push({ accession: d.name, message: err.message });
    }
  }
  return { proposals, errors };
}

/**
 * Rejects with a precise, actionable message on the first failed check.
 * The build comes from the milestone of the proposal's ticket, read through
 * the ticket client, so a proposal with no ticket is refused. Only a verified
 * (`ready`) proposal loads, though a dry run also accepts one awaiting or
 * failing verification; a resumed load is past that check.
 * For a proposal already on this branch the presenter is rendered here
 * (renderPresenter is pure) so the name-collision check runs before anything is
 * touched. For a straggler (only on origin/master) the manifest is read from
 * that ref, `straggler` lists the commits since the rebuild branch to
 * cherry-pick, and the render for the collision check runs against a scratch
 * export of origin/master. A load branch that is already
 * checked out with the proposal consumed is a previous run that failed after
 * its commit, and is reported as `resume` rather than refused.
 */
export async function checkLoadPreconditions({ git, ticket, repoPath, accession, dryRun = false }) {
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
  await ticket.checkProject();
  const build = await ticket.getBuild(manifest.ticket);
  const base = rebuildBranch(build);
  const current = git.currentBranch() || 'detached HEAD';
  const presenterPath = presenterFilePath(repoPath, manifest.project);

  if (current === branch && !existsSync(proposalDir) && git.aheadOf(base) >= 1) {
    return { manifest, proposalDir, presenterPath, straggler: null, base, branch, build, resume: true };
  }
  const status = await ticket.getStatus(manifest.ticket);
  const draftNote = status === 'draft'
    ? ` An "${ticket.statusOption('draft')}" ticket's proposal PR is still being worked on, or was merged without moving the ticket to "${ticket.statusOption('proposed')}".`
    : '';
  if (dryRun && !DRY_RUN_STATUSES.includes(status)) {
    throw new Error(`The proposal's ticket ${manifest.ticket.url} is at "${ticket.statusOption(status)}"; a dry run needs ${DRY_RUN_STATUSES.map(s => `"${ticket.statusOption(s)}"`).join(', ').replace(/, ([^,]*)$/, ' or $1')}.${draftNote}`);
  }
  if (!dryRun && status !== 'ready') {
    throw new Error(`The proposal's ticket ${manifest.ticket.url} is at "${ticket.statusOption(status)}"; only "${ticket.statusOption('ready')}" proposals load. Verify it and run mark-ready, or request-revision.${draftNote}`);
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

/** The load commit names the presenters it inserted, so a resume can recover them. */
function presenterNamesFromCommit(subject) {
  return /^Load \S+: add (.+?) to /.exec(subject)?.[1].split(' ') ?? null;
}

/**
 * Everything a load writes, rendered while the proposal still exists: a
 * presenter per organism and, for types with a dataset class, each organism's
 * file entry and loading artifacts. Refuses a name already present in any file.
 */
async function renderAndCheck(manifest, proposalDir, presenterPath, repoPath, build) {
  const datasetType = await loadDatasetType(manifest.datasetType);
  const presenterFile = readFileSync(presenterPath, 'utf-8');
  const presenters = organismsOf(manifest).map((organism) => {
    const xml = datasetType.renderPresenter(proposalDir, { build, organism });
    return { xml, name: extractPresenterName(xml) };
  });
  const taken = presenters.find((p) => presenterNameExists(presenterFile, p.name));
  if (taken) throw new Error(`Presenter "${taken.name}" already exists in ${presenterFileRelativePath(manifest.project)}. It may already be loaded; ask before continuing.`);
  return { presenters, presenterFile, ...(await renderDatasetParts(manifest, proposalDir, repoPath, { check: true })) };
}

/**
 * The dataset entry (the same for every organism) and each organism's file and
 * artifacts; check refuses a missing organism file or a taken name.
 */
async function renderDatasetParts(manifest, proposalDir, repoPath, { check }) {
  const datasetType = await loadDatasetType(manifest.datasetType);
  if (!datasetType.datasetClass) return { dataset: null };
  const classDef = readDatasetClass(repoPath, datasetType.datasetClass);
  const xml = datasetType.renderDataset(proposalDir, classDef);
  const organisms = organismsOf(manifest).map((organism) => {
    const relFile = datasetFileRelativePath(manifest.project, organism);
    let datasetFile = null;
    if (check) {
      const path = datasetFilePath(repoPath, manifest.project, organism);
      if (!existsSync(path)) throw new Error(`Dataset file missing: ${relFile}. Is ${organism} a ${manifest.project} organism on this build?`);
      datasetFile = readFileSync(path, 'utf-8');
      if (datasetNameExists(datasetFile, classDef.className, manifest.name)) {
        throw new Error(`${relFile} already has a ${classDef.className} named "${manifest.name}". It may already be loaded; ask before continuing.`);
      }
    }
    return {
      organism, relFile, datasetFile,
      files: datasetType.renderArtifacts(proposalDir, organism).files,
      delivery: deliveryLocation(manifest, classDef, organism)
    };
  });
  return { dataset: { xml, source: readDataset(proposalDir).source, organisms } };
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
  const pre = await checkLoadPreconditions({ git, ticket, repoPath, accession, dryRun });
  const { manifest, proposalDir, presenterPath, straggler, base, branch, build, resume } = pre;
  const relDir = proposalRelativePath(accession);
  const warnings = [];
  if (straggler) warnings.push(`Proposal ${accession} is not on ${base}; will cherry-pick ${straggler.join(', ')} from origin/master.`);
  if (resume) warnings.push(`Branch ${branch} already holds the load commit; resuming with push, pull request and ticket.`);
  if (dryRun) {
    // A resume renders nothing up front; its commit still names the presenters.
    const presenters = pre.presenters ?? [];
    return {
      presenterNames: pre.presenters ? presenters.map((p) => p.name) : presenterNamesFromCommit(git.headSubject()),
      presenters, dataset: pre.dataset ?? null, manifest, warnings,
      cherryPicked: straggler || [], dryRun: true
    };
  }

  git.checkGhAuth();

  let { presenterFile, presenters, dataset } = pre;
  let presenterNames = presenters?.map((p) => p.name);
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
        ({ presenterFile, presenters, dataset } = await renderAndCheck(onBranch, proposalDir, presenterPath, repoPath, build));
        presenterNames = presenters.map((p) => p.name);
      }
      // Every insert runs before any write, so a refused insert leaves the tree clean.
      const writes = [{ relFile: presenterFileRelativePath(manifest.project), content: presenters.reduce((c, p) => insertPresenter(c, p.xml), presenterFile) },
        ...(dataset?.organisms ?? []).map((o) => ({ relFile: o.relFile, content: insertDataset(o.datasetFile, dataset.xml) }))];
      for (const w of writes) writeFileSync(join(repoPath, w.relFile), w.content);
      git.add(writes.map((w) => w.relFile));
      git.rm(relDir);
      const alsoDataset = dataset ? `, ${manifest.name} to ${dataset.organisms.map((o) => o.organism).join(' ')}` : '';
      git.commit(`Load ${accession}: add ${presenterNames.join(' ')} to ${manifest.project}${alsoDataset}, remove proposal`);
    }
    if (resume) {
      presenterNames ??= presenterNamesFromCommit(git.headSubject());
      // The load commit removed the proposal; its parent still has it.
      ({ dataset } = await withProposalFromRef(git, 'HEAD~1', relDir,
        (dir) => renderDatasetParts(manifest, dir, repoPath, { check: false })));
    }
    if (dataset) {
      excludeScratch(repoPath);
      const base = deliveryBase ?? join(repoPath, SCRATCH_DIR, 'delivery');
      const deliveries = dataset.organisms.map((o) => ({ localDir: writeArtifacts(base, o.delivery.relative, o.files), target: o.delivery.target, files: o.files }));
      handoff = handoffNote({ deliveries, source: dataset.source });
    }
    git.push(branch, resume ? { force: git.remoteBranchExists(branch) } : {});

    const title = `Load ${accession} (${manifest.datasetType}, ${manifest.project}) into build ${build}`;
    const body = [
      `Presenters: ${presenterNames?.map((n) => `\`${n}\``).join(', ') ?? 'see the commit on this branch'} in \`${presenterFileRelativePath(manifest.project)}\``,
      ...(dataset ? [`Dataset: \`${manifest.name}\` (${manifest.datasetClass}) in ${dataset.organisms.map((o) => `\`${o.relFile}\``).join(', ')}`] : []),
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
    presenterNames, manifest, prUrl, branch, base, warnings, handoff,
    cherryPicked: straggler || [], dryRun: false, resumed: Boolean(resume)
  };
}

// Past loading, people move the ticket on by hand: loaders to Final QA, outreach to Done.
const LOADED_STATUSES = ['qa', 'finalqa', 'done'];

/**
 * After the load pull request has merged: moves the ticket of a loaded proposal
 * to `qa` (Post Load QA) and notes the pull request on it once. The load commit deleted the
 * proposal, so the manifest is read from just before that deletion in the
 * merged pull request's head, which GitHub keeps as refs/pull/<n>/head even
 * after the branch is deleted or squash-merged. Re-running once the ticket is
 * past loading changes nothing. Returns { prUrl, base, ticket, alreadyLoaded }.
 */
export async function markLoaded({ git, ticket, accession }) {
  const branch = loadBranch(accession);
  git.fetch();
  const pr = git.findMergedPullRequest(branch);
  if (!pr) throw new Error(`No merged pull request from ${branch}; mark ${accession} loaded after its load pull request merges`);
  if (!git.hasCommit(pr.headOid)) git.fetchPullHead(pr.number);

  const manifestPath = `${proposalRelativePath(accession)}/${MANIFEST_FILENAME}`;
  if (git.fileExistsOnRef(pr.headOid, manifestPath)) {
    throw new Error(`The merged pull request ${pr.url} still has ${manifestPath}; it is not a load of ${accession}`);
  }
  const deletion = git.commitsForPath(pr.headOid, manifestPath).pop();
  const manifest = deletion ? readOnRef(git, `${deletion}~1`, accession) : null;
  if (!manifest) throw new Error(`The merged pull request ${pr.url} never had ${manifestPath}, so its ticket cannot be found`);
  if (!manifest.ticket) throw new Error(`The loaded manifest of ${accession} has no ticket`);

  const status = await ticket.getStatus(manifest.ticket);
  const alreadyLoaded = LOADED_STATUSES.includes(status);
  if (status !== 'loading' && !alreadyLoaded) {
    throw new Error(`The ticket ${manifest.ticket.url} status is "${status}", not "loading"; only a loading ticket is marked loaded`);
  }
  if (alreadyLoaded) return { prUrl: pr.url, base: pr.base, ticket: manifest.ticket, alreadyLoaded };
  await ticket.commentOnce(manifest.ticket, `Loaded into ${pr.base}: ${pr.url}`);
  await ticket.setStatus(manifest.ticket, 'qa');
  return { prUrl: pr.url, base: pr.base, ticket: manifest.ticket, alreadyLoaded };
}
