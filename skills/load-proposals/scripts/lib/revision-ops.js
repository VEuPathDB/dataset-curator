import { join } from 'node:path';
import { readOnRef, readWorkingTreeTicket, MANIFEST_FILENAME, PROPOSALS_DIR } from './manifest.js';

// Review happens before loading starts; after that a revision is a new proposal.
// A ticket already sent back can take a further reason.
const REVIEWABLE_STATUSES = ['proposed', 'ready', 'revision'];

/**
 * Sends a proposal back to its curator: notes the reason on its ticket once and
 * sets the ticket `revision` (one already there keeps it). The ticket comes from the proposal in the working
 * tree, else from origin/master. Returns { ticket, status }.
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
