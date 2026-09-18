import { createRedmineClient } from './redmine.js';
import { createGithubClient } from './github.js';
import { STATUSES } from './statuses.js';

export { STATUSES };

export function assertStatus(status) {
  if (!STATUSES.includes(status)) throw new Error(`Unknown ticket status "${status}"; expected ${STATUSES.join(', ')}`);
}

/**
 * Returns { create, comment, getStatus, setStatus } for the configured system.
 * Backends receive injected fetch/exec/env so tests stay offline.
 */
export function createTicketClient(config, { fetchImpl = globalThis.fetch, exec, env = process.env } = {}) {
  const system = config.ticket.system;
  const guard = (client) => {
    const check = (ref) => {
      if (ref.system !== system) throw new Error(`Ticket ${ref.system}#${ref.id} but this workspace is configured for ${system}`);
    };
    return {
      create: (args) => client.create(args),
      comment: async (ref, body) => { check(ref); return client.comment(ref, body); },
      getStatus: async (ref) => { check(ref); return client.getStatus(ref); },
      setStatus: async (ref, status) => { check(ref); assertStatus(status); return client.setStatus(ref, status); }
    };
  };
  switch (system) {
    case 'redmine': return guard(createRedmineClient(config.ticket.redmine, { fetchImpl, env }));
    case 'github': return guard(createGithubClient(config.ticket.github, { exec, env }));
    default: throw new Error(`Unknown ticket system "${system}"`);
  }
}
