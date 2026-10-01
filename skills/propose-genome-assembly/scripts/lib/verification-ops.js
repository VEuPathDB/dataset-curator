import { join } from 'node:path';
import { readOnRef, readWorkingTreeTicket, proposalBranch, MANIFEST_FILENAME, PROPOSALS_DIR } from './manifest.js';

// Verification is the human check between merge and load; its two outcomes are
// markReady and requestRevision.

// Review happens before loading starts; after that a revision is a new proposal.
// A ticket already sent back can take a further reason.
const REVIEWABLE_STATUSES = ['proposed', 'ready', 'revision'];

/**
 * Sends a proposal back to its curator: notes the reason on its ticket once and
 * sets the ticket `revision` (one already there keeps it). The ticket comes from
 * the proposal in the working tree, else from origin/master. Returns { ticket, status }.
 */
export async function requestRevision({ git, ticket, repoPath, accession, reason, warn = (m) => console.error(m) }) {
  const why = (reason ?? '').trim();
  if (!why) throw new Error('A reason is required: it tells the curator what to revise');
  git.fetch();
  const ref = readWorkingTreeTicket(join(repoPath, PROPOSALS_DIR, accession, MANIFEST_FILENAME), warn)
    ?? readOnRef(git, 'origin/master', accession)?.ticket;
  if (!ref) throw new Error(`No ticket found for ${accession} in the working tree or on origin/master`);
  const status = await ticket.getStatus(ref);
  if (!REVIEWABLE_STATUSES.includes(status)) {
    throw new Error(`The ticket ${ref.url} status is "${status}"; only a proposed, ready or revision ticket can take a revision request`);
  }
  await ticket.commentOnce(ref, `Needs revision: ${why}`);
  if (status !== 'revision') await ticket.setStatus(ref, 'revision');
  return { ticket: ref, status: 'revision' };
}

/**
 * Records that a person verified a merged proposal: notes the optional note on
 * its ticket once and sets the ticket `ready`, the only status load accepts.
 * What is verified is the proposal on origin/master, so an update still
 * awaiting review must merge first. Returns { ticket, status }.
 */
export async function markReady({ git, ticket, accession, note }) {
  git.checkGhAuth();
  git.fetch();
  const manifest = readOnRef(git, 'origin/master', accession);
  if (!manifest) throw new Error(`Proposal ${accession} is not on origin/master; verify it after its proposal pull request merges`);
  if (!manifest.ticket) throw new Error(`Proposal ${accession} on origin/master has no ticket; record it in its manifest first`);
  const openPr = git.findPullRequest(proposalBranch(accession));
  if (openPr) throw new Error(`An update to ${accession} is awaiting review in ${openPr}; verify it after that merges`);
  const ref = manifest.ticket;
  const status = await ticket.getStatus(ref);
  if (status !== 'proposed') {
    throw new Error(`The ticket ${ref.url} is at "${ticket.statusOption(status)}"; only a "${ticket.statusOption('proposed')}" proposal can be marked ready`);
  }
  const why = (note ?? '').trim();
  if (why) await ticket.commentOnce(ref, `Verified: ${why}`);
  await ticket.setStatus(ref, 'ready');
  return { ticket: ref, status: 'ready' };
}
