import { createGithubClient } from './github.js';
import { STATUSES } from './statuses.js';

export { STATUSES };

export function assertStatus(status) {
  if (!STATUSES.includes(status)) throw new Error(`Unknown ticket status "${status}"; expected ${STATUSES.join(', ')}`);
}

/**
 * Returns { create, checkDatasetType, checkProject, statusOption, mention,
 * comment, commentOnce, hasComment, listComments, getStatus, setStatus, getBuild, isOpen, assign } for the configured system.
 * checkDatasetType(datasetType[, labelVariant]) throws, offline, for a type
 * (or, when given, a variant of it) create could not label;
 * statusOption is the name people see for a status; checkProject confirms,
 * read-only, that the status field and every configured option exist. create takes
 * { title, body, build, datasetType, labelVariant } and refuses a datasetType
 * (or variant) the system cannot label before touching it; labelVariant is
 * what the dataset type module's ticketLabelVariant reports, if it has one.
 * If create fails after the ticket exists, the error carries that ticket as
 * error.ticket. mention is how a pull request
 * body cites the ticket. Backends receive injected exec/env so tests stay offline.
 */
export function createTicketClient(config, { exec, env = process.env } = {}) {
  const system = config.ticket.system;
  const guard = (client) => {
    const check = (ref) => {
      if (ref.system !== system) throw new Error(`Ticket ${ref.system}#${ref.id} but this workspace is configured for ${system}`);
    };
    const guarded = {
      create: ({ title, body, build, datasetType, labelVariant }) => client.create({ title, body, build, datasetType, labelVariant }),
      checkDatasetType: (datasetType, labelVariant) => client.checkDatasetType(datasetType, labelVariant),
      checkProject: async () => client.checkProject(),
      statusOption: (status) => { assertStatus(status); return client.statusOption(status); },
      mention: (ref) => { check(ref); return client.mention(ref); },
      comment: async (ref, body) => { check(ref); return client.comment(ref, body); },
      hasComment: async (ref, text) => { check(ref); return client.hasComment(ref, text); },
      listComments: async (ref) => { check(ref); return client.listComments(ref); },
      getStatus: async (ref) => { check(ref); return client.getStatus(ref); },
      getBuild: async (ref) => { check(ref); return client.getBuild(ref); },
      isOpen: async (ref) => { check(ref); return client.isOpen(ref); },
      assign: async (ref) => { check(ref); return client.assign(ref); },
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
    case 'github': return guard(createGithubClient(config.ticket.github, { exec, env }));
    default: throw new Error(`Unknown ticket system "${system}"`);
  }
}
