import { readOnRef, proposalBranch } from './manifest.js';

// The PRs merge-proposal merges: a first version, or an update of a dataset not yet being verified.
const MERGEABLE_STATUSES = ['draft', 'proposed'];

/**
 * Merges a proposal PR for someone who asked Claude to, and moves its ticket to
 * `proposed`, which a person merging by hand does on the board themselves.
 * Re-running after the merge (no open PR, a merged one into master) skips the
 * merge and finishes the note and status. Returns { prUrl, ticket, resumed }.
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
  const open = lookup(() => git.findPullRequest(branch, { strict: true }));
  const merged = open ? null : lookup(() => git.findMergedPullRequest(branch, { base: /^master$/ }));
  if (!open && !merged) throw new Error(`No open or merged proposal PR from ${branch}`);

  const manifest = readOnRef(git, `origin/${branch}`, accession) ?? readOnRef(git, 'origin/master', accession);
  if (!manifest?.ticket) throw new Error(`The proposal ${accession} has no ticket in its manifest on origin/${branch} or origin/master`);
  const ref = manifest.ticket;
  const status = await ticket.getStatus(ref);
  if (!MERGEABLE_STATUSES.includes(status)) {
    throw new Error(`The ticket ${ref.url} is at "${ticket.statusOption(status)}"; merge-proposal merges only ${MERGEABLE_STATUSES.map(s => `"${ticket.statusOption(s)}"`).join(' or ')} proposals`);
  }

  if (open) {
    try { git.mergePullRequest(branch); }
    catch (e) { throw new Error(`Cannot merge ${open}: ${e.message.trim()}\nThe ticket is unchanged.`); }
  }
  const prUrl = open ?? merged.url;
  await ticket.commentOnce(ref, `Merged ${prUrl}`);
  if (status !== 'proposed') await ticket.setStatus(ref, 'proposed');
  return { prUrl, ticket: ref, resumed: !open };
}
