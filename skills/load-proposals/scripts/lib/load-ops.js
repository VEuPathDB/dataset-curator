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
import { assertClean, assertOnBranch } from './guards.js';

export { PROPOSALS_DIR, proposalRelativePath };
export const loadBranch = (accession) => `load/${accession}`;
export const rebuildBranch = (build) => `rebuild${build}`;

async function loadRenderer(datasetType) {
  return import(new URL(`../renderers/${datasetType}.js`, import.meta.url));
}

/**
 * Proposals on the working tree, optionally filtered by targetBuild.
 * One unreadable manifest must not hide every other proposal, so it is
 * reported in `errors` rather than thrown.
 * Returns { proposals, errors: [{ accession, message }] }.
 */
export function listProposals(repoPath, { build } = {}) {
  const dir = join(repoPath, PROPOSALS_DIR);
  const proposals = [];
  const errors = [];
  if (!existsSync(dir)) return { proposals, errors };
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    if (!d.isDirectory() || !existsSync(join(dir, d.name, MANIFEST_FILENAME))) continue;
    let m;
    try { m = readManifest(join(dir, d.name)); }
    catch (err) { errors.push({ accession: d.name, message: err.message }); continue; }
    if (!build || m.targetBuild === build) proposals.push(m);
  }
  return { proposals, errors };
}

/**
 * Rejects with a precise, actionable message on the first failed check.
 * For a proposal already on this branch the presenter is rendered here
 * (renderers are pure) so the name-collision check runs before anything is
 * touched. For a straggler (only on origin/master) the manifest is read from
 * that ref and `straggler` lists the commits to cherry-pick; rendering waits
 * until loadProposal has the files on disk. A load branch that is already
 * checked out with the proposal consumed is a previous run that failed after
 * its commit, and is reported as `resume` rather than refused.
 */
export async function checkLoadPreconditions({ git, repoPath, accession }) {
  const proposalDir = join(repoPath, PROPOSALS_DIR, accession);
  const relDir = proposalRelativePath(accession);
  const branch = loadBranch(accession);
  // Freshness and straggler detection both read origin, so fetch first.
  git.fetch();

  assertClean(git, () => dirtyTreeMessage(git, repoPath, accession));

  let manifest = null;
  let isStraggler = false;
  if (existsSync(join(proposalDir, MANIFEST_FILENAME))) {
    manifest = readManifest(proposalDir);
  } else if ((git.currentBranch() || '') === branch) {
    // A resumed load: its own commit removed the proposal, the parent still has it.
    manifest = readOnRef(git, 'HEAD~1', accession);
  }
  if (!manifest) {
    manifest = readOnRef(git, 'origin/master', accession);
    if (!manifest) {
      throw new Error(`No proposal found at ${relDir} on this branch or on origin/master. Check the accession, or confirm its proposal pull request was merged.`);
    }
    isStraggler = true;
  }

  const base = rebuildBranch(manifest.targetBuild);
  const current = git.currentBranch() || 'detached HEAD';
  const presenterPath = presenterFilePath(repoPath, manifest.project);

  if (current === branch && !existsSync(proposalDir) && git.aheadOf(base) >= 1) {
    return { manifest, proposalDir, presenterPath, straggler: null, base, branch, resume: true };
  }
  assertOnBranch(git, base, `git -C '${repoPath}' checkout ${base}`,
    { because: `The proposal targets build ${manifest.targetBuild} (${base}).` });
  if (!git.isUpToDate(base)) {
    throw new Error(`${base} is behind origin/${base}; run: git -C '${repoPath}' pull`);
  }
  if (git.branchExists(branch)) {
    throw new Error(`Branch ${branch} already exists. Inspect it, then delete it to rerun:\n  git -C '${repoPath}' branch -D ${branch}`);
  }
  if (!existsSync(presenterPath)) {
    throw new Error(`Presenter file missing: ${presenterFileRelativePath(manifest.project)}. Ask which project file this dataset belongs in.`);
  }

  if (!isStraggler) {
    const rendered = await renderAndCheck(manifest, proposalDir, presenterPath);
    return { manifest, proposalDir, presenterPath, straggler: null, base, branch, resume: false, ...rendered };
  }

  // The rebuild branch bounds the search, so an earlier build's propose and
  // load commits for this accession are not dragged along.
  const straggler = git.commitsForPath(`${base}..origin/master`, relDir);
  if (straggler.length === 0) {
    throw new Error(`${relDir} is on origin/master but no commit since ${base} touches it; the history is not what this skill expects. Inspect with: git -C '${repoPath}' log ${base}..origin/master -- ${relDir}`);
  }
  // Render from a scratch copy of origin/master so a proposal already loaded
  // into this build is refused before the load branch exists.
  const rendered = await renderFromRef(git, manifest, relDir, presenterPath);
  return { manifest, proposalDir, presenterPath, straggler, base, branch, resume: false, ...rendered };
}

/** Renders a straggler out of origin/master without touching the checkout. */
async function renderFromRef(git, manifest, relDir, presenterPath) {
  const scratch = mkdtempSync(join(tmpdir(), 'load-straggler-'));
  try {
    git.exportTree('origin/master', relDir, scratch);
    return await renderAndCheck(manifest, join(scratch, relDir), presenterPath);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** A dirty load branch is a previous run, so it gets its own way out. */
function dirtyTreeMessage(git, repoPath, accession) {
  const branch = loadBranch(accession);
  if ((git.currentBranch() || '') !== branch) return undefined;
  const target = readOnRef(git, 'HEAD~1', accession) ?? readOnRef(git, 'origin/master', accession);
  const base = target ? rebuildBranch(target.targetBuild) : 'rebuild<NN>';
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
  return resumable
    ? 'Re-run the same command to resume.'
    : `To start over: git -C '${repoPath}' checkout -f ${base} && git -C '${repoPath}' branch -D ${branch}`;
}

/** The load commit names the presenter it inserted, so a resume can recover it. */
function presenterNameFromCommit(subject) {
  return /^Load \S+: add (\S+) to /.exec(subject)?.[1] ?? null;
}

async function renderAndCheck(manifest, proposalDir, presenterPath) {
  const renderer = await loadRenderer(manifest.datasetType);
  const xml = renderer.render(proposalDir);
  const presenterName = extractPresenterName(xml);
  const presenterFile = readFileSync(presenterPath, 'utf-8');
  if (presenterNameExists(presenterFile, presenterName)) {
    throw new Error(`Presenter "${presenterName}" already exists in ${presenterFileRelativePath(manifest.project)}. It may already be loaded; ask before continuing.`);
  }
  return { xml, presenterName, presenterFile };
}

/**
 * Renders, inserts, deletes the proposal, commits once, pushes, opens a PR
 * against rebuild<NN>, comments on and transitions the ticket to "loading".
 * dryRun performs only checks and rendering. Idempotent: a re-run after a
 * failure past the commit reuses that commit and any open pull request, and
 * the ticket hears about the pull request once.
 */
export async function loadProposal({ git, ticket, repoPath, accession, dryRun = false }) {
  const pre = await checkLoadPreconditions({ git, repoPath, accession });
  const { manifest, proposalDir, presenterPath, straggler, base, branch, resume } = pre;
  const warnings = [];
  if (!manifest.ticket) warnings.push(`Proposal ${accession} has no ticket recorded; ticket updates skipped.`);
  if (straggler) warnings.push(`Proposal ${accession} is not on ${base}; will cherry-pick ${straggler.join(', ')} from origin/master.`);
  if (resume) warnings.push(`Branch ${branch} already holds the load commit; resuming with push, pull request and ticket.`);
  if (dryRun) {
    return { presenterName: pre.presenterName, xml: pre.xml, manifest, warnings, cherryPicked: straggler || [], dryRun: true };
  }

  git.checkGhAuth();

  let { presenterFile, xml, presenterName } = pre;
  let prUrl;
  // Everything below changes the repository, the forge or the ticket, so a
  // failure ends with the one recovery the current state allows.
  try {
    if (!resume) {
      git.createBranch(branch, base);
      if (straggler) {
        git.cherryPick(straggler);
        ({ presenterFile, xml, presenterName } = await renderAndCheck(manifest, proposalDir, presenterPath));
      }
      writeFileSync(presenterPath, insertPresenter(presenterFile, xml));
      git.add([presenterFileRelativePath(manifest.project)]);
      git.rm(proposalRelativePath(accession));
      git.commit(`Load ${accession}: add ${presenterName} to ${manifest.project}, remove proposal`);
    }
    if (resume && !presenterName) presenterName = presenterNameFromCommit(git.headSubject());
    git.push(branch, { force: git.remoteBranchExists(branch) });

    const title = `Load ${accession} (${manifest.datasetType}, ${manifest.project}) into build ${manifest.targetBuild}`;
    const body = [
      `Presenter: \`${presenterName ?? 'see the commit on this branch'}\` in \`${presenterFileRelativePath(manifest.project)}\``,
      `Proposal removed: \`${proposalRelativePath(accession)}\``,
      manifest.ticket ? `Ticket: ${manifest.ticket.url}` : 'Ticket: none recorded'
    ].join('\n');
    const openPr = git.findPullRequest(branch);
    prUrl = openPr ?? git.openPullRequest({ base, head: branch, title, body });

    if (manifest.ticket) {
      await ticket.commentOnce(manifest.ticket, `Loading into ${base}. Pull request: ${prUrl}`);
      await ticket.setStatus(manifest.ticket, 'loading');
    }
  } catch (err) {
    throw new Error(`${err.message}\n${recoveryFooter({ git, repoPath, proposalDir, base, branch })}`, { cause: err });
  }
  return {
    presenterName, xml, manifest, prUrl, branch, base, warnings,
    cherryPicked: straggler || [], dryRun: false, resumed: Boolean(resume)
  };
}
