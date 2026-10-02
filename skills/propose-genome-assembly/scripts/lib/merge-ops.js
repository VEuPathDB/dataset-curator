import { readOnRef, proposalBranch } from './manifest.js';

// The PRs merge-proposal merges: a first version, or an update of a dataset not yet being verified.
const MERGEABLE_STATUSES = ['draft', 'proposed'];

/**
 * Merges a proposal PR for someone who asked Claude to, and moves its ticket to
 * `proposed`, which a person merging by hand does on the board themselves.
 * The ticket is read from the manifest at the PR's head commit. The status
 * moves only once GitHub reports the PR merged. Re-running after the merge (no
 * open PR, a merged one into master) skips the merge and finishes the note and
 * status. Returns { prUrl, ticket, resumed }.
 */
export async function mergeProposal({ git, ticket, accession }) {
  git.checkGhAuth();
  await ticket.checkProject();
  git.fetch();
  const branch = proposalBranch(accession);
  const lookup = (find) => {
    try { return find(); }
    catch (e) { throw new Error(`Cannot check for an open proposal PR from ${branch}, so nothing is merged: ${e.message}`); }
  };
  const open = lookup(() => git.findOpenPullRequest(branch));
  if (open && open.base !== 'master') {
    throw new Error(`The PR ${open.url} from ${branch} targets ${open.base}, not master; merge-proposal merges only proposal PRs into master`);
  }
  const merged = open ? null : lookup(() => git.findMergedPullRequest(branch, { base: /^master$/ }));
  if (!open && !merged) throw new Error(`No open or merged proposal PR from ${branch}`);

  // Its head commit survives a deleted branch as refs/pull/<n>/head.
  const readAtHead = ({ headOid, number }) => {
    if (!git.hasCommit(headOid)) git.fetchPullHead(number);
    return readOnRef(git, headOid, accession);
  };
  let manifest;
  if (open) manifest = readAtHead(open);
  else {
    try { manifest = readAtHead(merged); } catch { manifest = null; }
    manifest ??= readOnRef(git, 'origin/master', accession);
  }
  if (!manifest?.ticket) throw new Error(`The proposal ${accession} has no ticket in its manifest at the PR head${open ? '' : ' or on origin/master'}`);
  const ref = manifest.ticket;
  const status = await ticket.getStatus(ref);
  if (!MERGEABLE_STATUSES.includes(status)) {
    throw new Error(`The ticket ${ref.url} is at "${ticket.statusOption(status)}"; merge-proposal merges only ${MERGEABLE_STATUSES.map(s => `"${ticket.statusOption(s)}"`).join(' or ')} proposals`);
  }

  if (open) {
    try { git.mergePullRequest(branch); }
    catch (e) { throw new Error(`Cannot merge ${open.url}: ${e.message.trim()}\nThe ticket is unchanged.`); }
    // gh exits 0 when a merge queue or pending checks only schedule the merge.
    const done = lookup(() => git.findMergedPullRequest(branch, { base: /^master$/, number: open.number }));
    if (!done) throw new Error(`${open.url} is queued or pending, not merged; re-run merge-proposal after it merges. The ticket is unchanged.`);
  }
  const prUrl = open?.url ?? merged.url;
  await ticket.commentOnce(ref, `Merged ${prUrl}`);
  if (status !== 'proposed') await ticket.setStatus(ref, 'proposed');
  return { prUrl, ticket: ref, resumed: !open };
}
