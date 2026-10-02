import { join } from 'node:path';
import { readOnRef, readWorkingTreeTicket, proposalBranch, MANIFEST_FILENAME, PROPOSALS_DIR } from './manifest.js';

// Verification is the human check between merge and load; its two outcomes are
// markReady and requestRevision.

// Review happens before loading starts; after that a revision is a new proposal.
// A ticket already sent back can take a further reason.
const REVIEWABLE_STATUSES = ['proposed', 'verifying', 'ready', 'revision'];
const UNVERIFIED_STATUSES = ['proposed', 'verifying'];

/**
 * A ticket still at `draft` whose proposal PR merged is treated as `proposed`
 * (whoever merged it did not move the card); one not merged is refused, since
 * its review happens on the PR. The merged-PR lookup fails closed.
 * Returns { status, notice }.
 */
function resolveDraft(git, ticket, accession, status, onMaster, refusal) {
  if (status !== 'draft') return { status, notice: null };
  const branch = proposalBranch(accession);
  let merged;
  try { merged = git.findMergedPullRequest(branch, { base: /^master$/ }); }
  catch (e) { throw new Error(`Cannot check whether the proposal PR from ${branch} merged, so ${refusal}: ${e.message}`); }
  const draft = ticket.statusOption('draft');
  if (onMaster && merged) {
    return { status: 'proposed', notice: `The proposal PR ${merged.url} is merged but the ticket was still at "${draft}"; continuing as ${ticket.statusOption('proposed')}.` };
  }
  let open = null;
  try { open = git.findPullRequest(branch, { strict: true }); } catch { open = null; }
  throw new Error(`The proposal PR ${open ?? `from ${branch}`} is not merged yet; the ticket is at "${draft}".`);
}

/**
 * Sends a proposal back to its curator: notes the reason on its ticket once and
 * sets the ticket `revision` (one already there keeps it). The ticket comes from
 * the proposal in the working tree, else from origin/master. Returns { ticket, status }.
 */
export async function requestRevision({ git, ticket, repoPath, accession, reason, warn = (m) => console.error(m) }) {
  const why = (reason ?? '').trim();
  if (!why) throw new Error('A reason is required: it tells the curator what to revise');
  git.fetch();
  const onMaster = readOnRef(git, 'origin/master', accession);
  const ref = readWorkingTreeTicket(join(repoPath, PROPOSALS_DIR, accession, MANIFEST_FILENAME), warn) ?? onMaster?.ticket;
  if (!ref) throw new Error(`No ticket found for ${accession} in the working tree or on origin/master`);
  const { status, notice } = resolveDraft(git, ticket, accession, await ticket.getStatus(ref), Boolean(onMaster), 'no revision is requested');
  if (!REVIEWABLE_STATUSES.includes(status)) {
    throw new Error(`The ticket ${ref.url} status is "${status}"; only a ${REVIEWABLE_STATUSES.slice(0, -1).join(', ')} or ${REVIEWABLE_STATUSES.at(-1)} ticket can take a revision request`);
  }
  await ticket.commentOnce(ref, `Needs revision: ${why}`);
  if (status !== 'revision') await ticket.setStatus(ref, 'revision');
  return { ticket: ref, status: 'revision', notice };
}

/**
 * The ticket of a merged proposal with no update awaiting review: what is
 * verified is the proposal on origin/master. The open-update lookup fails closed.
 */
function verifiableTicket(git, accession, refusal) {
  git.checkGhAuth();
  git.fetch();
  const manifest = readOnRef(git, 'origin/master', accession);
  if (!manifest) throw new Error(`Proposal ${accession} is not on origin/master; verify it after its proposal pull request merges`);
  if (!manifest.ticket) throw new Error(`Proposal ${accession} on origin/master has no ticket; record it in its manifest first`);
  const branch = proposalBranch(accession);
  let openPr;
  try { openPr = git.findPullRequest(branch, { strict: true }); }
  catch (e) { throw new Error(`Cannot check for an open update to ${accession} from ${branch}, so ${refusal}: ${e.message}`); }
  if (openPr) throw new Error(`An update to ${accession} is awaiting review in ${openPr}; verify it after that merges`);
  return manifest.ticket;
}

const quoteOptions = (ticket, statuses) =>
  statuses.map(s => `"${ticket.statusOption(s)}"`).join(', ').replace(/, ([^,]*)$/, ' or $1');

/**
 * Claims a merged proposal for verification: assigns its issue to the current
 * gh user and sets the ticket `verifying`. Claiming is optional; mark-ready and
 * request-revision also accept a `proposed` ticket. Returns { ticket, status }.
 */
export async function startVerification({ git, ticket, accession }) {
  const ref = verifiableTicket(git, accession, 'verification is not started');
  const { status, notice } = resolveDraft(git, ticket, accession, await ticket.getStatus(ref), true, 'verification is not started');
  if (status !== 'proposed') {
    throw new Error(`The ticket ${ref.url} is at "${ticket.statusOption(status)}"; only a "${ticket.statusOption('proposed')}" proposal can start verification`);
  }
  await ticket.assign(ref);
  await ticket.setStatus(ref, 'verifying');
  return { ticket: ref, status: 'verifying', notice };
}

/**
 * Records that a person verified a merged proposal: notes the optional note on
 * its ticket once and sets the ticket `ready`, the only status load accepts.
 * Returns { ticket, status }.
 */
export async function markReady({ git, ticket, accession, note }) {
  const ref = verifiableTicket(git, accession, 'it is not marked ready');
  const { status, notice } = resolveDraft(git, ticket, accession, await ticket.getStatus(ref), true, 'it is not marked ready');
  if (!UNVERIFIED_STATUSES.includes(status)) {
    throw new Error(`The ticket ${ref.url} is at "${ticket.statusOption(status)}"; only a ${quoteOptions(ticket, UNVERIFIED_STATUSES)} proposal can be marked ready`);
  }
  const why = (note ?? '').trim();
  if (why) await ticket.commentOnce(ref, `Verified: ${why}`);
  await ticket.setStatus(ref, 'ready');
  return { ticket: ref, status: 'ready', notice };
}
