import { CONTACTS_RELATIVE_PATH } from './contacts.js';
import { proposalRelativePath } from './manifest.js';
import { assertClean, assertOnBranch } from './guards.js';
import { assertRebuildBranch, listProposals, LOADED_STATUSES } from './load-ops.js';

// Contacts are only edited on master; a rebuild branch holds a copy, so merging it back cannot conflict.
const contactsDiffer = (git, rebuildBranch) =>
  git.objectId(`origin/${rebuildBranch}`, CONTACTS_RELATIVE_PATH) !== git.objectId('origin/master', CONTACTS_RELATIVE_PATH);

/** Opens a PR copying master's allContacts.xml onto the rebuild branch, unless they already match. Returns { changed, prUrl }. */
export async function syncContacts({ git, repoPath, rebuildBranch }) {
  assertRebuildBranch(rebuildBranch);
  git.fetch();
  if (!contactsDiffer(git, rebuildBranch)) return { changed: false };
  git.checkGhAuth();
  const branch = `sync-contacts/${rebuildBranch}`;
  const open = git.findPullRequest(branch);
  if (open) return { changed: true, prUrl: open };
  assertClean(git);
  assertOnBranch(git, rebuildBranch, `git -C '${repoPath}' checkout ${rebuildBranch}`, { because: 'Contacts are synced onto the rebuild branch.' });
  if (!git.isUpToDate(rebuildBranch)) throw new Error(`${rebuildBranch} is not at origin/${rebuildBranch}; run: git -C '${repoPath}' pull`);
  git.createBranch(branch, rebuildBranch);
  git.checkoutPath('origin/master', CONTACTS_RELATIVE_PATH);
  git.commit(`Sync allContacts.xml from master onto ${rebuildBranch}`);
  git.push(branch);
  const prUrl = git.openPullRequest({ base: rebuildBranch, head: branch, title: `Sync contacts from master onto ${rebuildBranch}`,
    body: 'Copies master\'s allContacts.xml. Contacts are only edited on master, so this makes the merge back conflict-free.' });
  return { changed: true, prUrl };
}

/** Opens (or reports the open) PR merging the rebuild branch into master; refuses while contacts differ. Returns { prUrl }. */
export async function mergeBack({ git, rebuildBranch, build }) {
  assertRebuildBranch(rebuildBranch);
  git.fetch();
  if (contactsDiffer(git, rebuildBranch)) {
    throw new Error(`allContacts.xml differs between origin/${rebuildBranch} and origin/master; run start-build.js sync-contacts first and merge its PR`);
  }
  git.checkGhAuth();
  const prUrl = git.findPullRequest(rebuildBranch) ?? git.openPullRequest({ base: 'master', head: rebuildBranch,
    title: `Merge ${rebuildBranch} into master for build ${build}`, body: `Loaded datasets of ${rebuildBranch} back into master at the start of build ${build}.` });
  return { prUrl };
}

/**
 * After the merge-back: opens a PR on master deleting each proposal whose
 * ticket is in an earlier build and past loading. The delivery archive keeps
 * them. Returns { removed, kept: [{ accession, message }], prUrl }.
 */
export async function cleanProposals({ git, ticket, rebuildBranch, build }) {
  assertRebuildBranch(rebuildBranch);
  git.fetch();
  if (!git.isAncestor(`origin/${rebuildBranch}`, 'origin/master')) {
    throw new Error(`origin/${rebuildBranch} is not merged into origin/master yet; run start-build.js merge-back and merge its PR first`);
  }
  const { proposals, errors } = await listProposals(git, { ticket });
  const removed = proposals
    .filter((p) => p.build !== null && Number(p.build) < Number(build) && LOADED_STATUSES.includes(p.status))
    .map((p) => p.manifest.accession)
    .sort();
  if (!removed.length) return { removed, kept: errors };
  git.checkGhAuth();
  const branch = `clean-proposals/build-${build}`;
  const open = git.findPullRequest(branch);
  if (open) return { removed, kept: errors, prUrl: open };
  assertClean(git);
  git.createBranch(branch, 'origin/master');
  for (const accession of removed) git.rm(proposalRelativePath(accession));
  git.commit(`Remove proposals loaded before build ${build}: ${removed.join(' ')}`);
  git.push(branch);
  const prUrl = git.openPullRequest({ base: 'master', head: branch, title: `Remove proposals loaded before build ${build}`,
    body: ['Each is archived in its delivery\'s fromProvider/proposal.', ...removed.map((a) => `- \`${proposalRelativePath(a)}\``)].join('\n') });
  return { removed, kept: errors, prUrl };
}
