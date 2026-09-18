import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { read as readManifest, readOnRef, MANIFEST_FILENAME, PROPOSALS_DIR } from './manifest.js';
import {
  presenterFilePath, presenterFileRelativePath, presenterNameExists,
  insertPresenter, extractPresenterName
} from './presenter-file.js';

export { PROPOSALS_DIR };
export const loadBranch = (accession) => `load/${accession}`;
export const rebuildBranch = (build) => `rebuild${build}`;
export const proposalRelativePath = (accession) => `${PROPOSALS_DIR}/${accession}`;

async function loadRenderer(datasetType) {
  return import(new URL(`../renderers/${datasetType}.js`, import.meta.url));
}

/** Proposals on the working tree, optionally filtered by targetBuild. */
export function listProposals(repoPath, { build } = {}) {
  const dir = join(repoPath, PROPOSALS_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter(d => d.isDirectory() && existsSync(join(dir, d.name, MANIFEST_FILENAME)))
    .map(d => readManifest(join(dir, d.name)))
    .filter(m => !build || m.targetBuild === build);
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
  if (!git.isClean()) {
    throw new Error(`VEuPathDatasets working tree is not clean; commit or stash first. Inspect with: git -C '${repoPath}' status`);
  }

  const proposalDir = join(repoPath, PROPOSALS_DIR, accession);
  const relDir = proposalRelativePath(accession);
  let manifest;
  let straggler = null;
  if (existsSync(join(proposalDir, MANIFEST_FILENAME))) {
    manifest = readManifest(proposalDir);
  } else {
    git.fetch();
    manifest = readOnRef(git, 'origin/master', accession);
    if (!manifest) {
      throw new Error(`No proposal found at ${relDir} on this branch or on origin/master. Check the accession, or confirm its proposal pull request was merged.`);
    }
    straggler = git.commitsForPath('origin/master', relDir);
  }

  const base = rebuildBranch(manifest.targetBuild);
  const branch = loadBranch(accession);
  const current = git.currentBranch() || 'detached HEAD';
  const presenterPath = presenterFilePath(repoPath, manifest.project);

  if (current === branch && !existsSync(proposalDir) && git.aheadOf(base) >= 1) {
    return { manifest, proposalDir, presenterPath, straggler: null, base, branch, resume: true };
  }
  if (current !== base) {
    throw new Error(`Checked out on branch "${current}" but the proposal targets build ${manifest.targetBuild} (${base}).\nRecover with:\n  git -C '${repoPath}' checkout ${base}`);
  }
  if (git.branchExists(branch)) {
    throw new Error(`Branch ${branch} already exists. Inspect it, then delete it to rerun:\n  git -C '${repoPath}' branch -D ${branch}`);
  }
  if (!existsSync(presenterPath)) {
    throw new Error(`Presenter file missing: ${presenterFileRelativePath(manifest.project)}. Ask which project file this dataset belongs in.`);
  }

  if (straggler) return { manifest, proposalDir, presenterPath, straggler, base, branch, resume: false };
  const rendered = await renderAndCheck(manifest, proposalDir, presenterPath);
  return { manifest, proposalDir, presenterPath, straggler, base, branch, resume: false, ...rendered };
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
 * failure past the commit reuses that commit and any open pull request.
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
  git.push(branch);

  const title = `Load ${accession} (${manifest.datasetType}, ${manifest.project}) into build ${manifest.targetBuild}`;
  const body = [
    `Presenter: \`${presenterName ?? 'see the commit on this branch'}\` in \`${presenterFileRelativePath(manifest.project)}\``,
    `Proposal removed: \`${proposalRelativePath(accession)}\``,
    manifest.ticket ? `Ticket: ${manifest.ticket.url}` : 'Ticket: none recorded'
  ].join('\n');
  const openPr = git.findPullRequest(branch);
  const prUrl = openPr ?? git.openPullRequest({ base, head: branch, title, body });

  // A pull request that was already open means a previous run got this far,
  // so the ticket has heard about it.
  if (manifest.ticket && !openPr) {
    await ticket.comment(manifest.ticket, `Loading into ${base}. Pull request: ${prUrl}`);
    await ticket.setStatus(manifest.ticket, 'loading');
  }
  return {
    presenterName, xml, manifest, prUrl, branch, base, warnings,
    cherryPicked: straggler || [], dryRun: false, resumed: Boolean(resume)
  };
}
