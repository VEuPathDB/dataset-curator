import { createGithubClient } from './github.js';
import { STATUSES } from './statuses.js';

export { STATUSES };

export function assertStatus(status) {
  if (!STATUSES.includes(status)) throw new Error(`Unknown ticket status "${status}"; expected ${STATUSES.join(', ')}`);
}

/**
 * Returns { create, mention, comment, commentOnce, hasComment, getStatus, setStatus }
 * for the configured system. create takes { title, body, build }. mention is how a pull request body cites the ticket.
 * Backends receive injected exec/env so tests stay offline.
 */
export function createTicketClient(config, { exec, env = process.env, warn } = {}) {
  const system = config.ticket.system;
  const guard = (client) => {
    const check = (ref) => {
      if (ref.system !== system) throw new Error(`Ticket ${ref.system}#${ref.id} but this workspace is configured for ${system}`);
    };
    const guarded = {
      create: (args) => client.create(args),
      mention: (ref) => { check(ref); return client.mention(ref); },
      comment: async (ref, body) => { check(ref); return client.comment(ref, body); },
      hasComment: async (ref, text) => { check(ref); return client.hasComment(ref, text); },
      getStatus: async (ref) => { check(ref); return client.getStatus(ref); },
      setStatus: async (ref, status) => { check(ref); assertStatus(status); return client.setStatus(ref, status); }
    };
    // Re-runs are routine, so a notification carrying its own key (the pull
    // request URL) is posted at most once.
    guarded.commentOnce = async (ref, text) => {
      if (await guarded.hasComment(ref, text)) return false;
      await guarded.comment(ref, text);
      return true;
    };
    return guarded;
  };
  switch (system) {
    case 'github': return guard(createGithubClient(config.ticket.github, { exec, env, warn }));
    default: throw new Error(`Unknown ticket system "${system}"`);
  }
}
