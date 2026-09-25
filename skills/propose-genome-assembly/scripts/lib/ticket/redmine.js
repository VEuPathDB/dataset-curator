import { STATUSES } from './statuses.js';

export function createRedmineClient(cfg, { fetchImpl, env }) {
  const apiKey = env.REDMINE_API_KEY;
  if (!apiKey) throw new Error('REDMINE_API_KEY environment variable is required for the redmine ticket backend');
  for (const s of STATUSES) {
    if (cfg.statusIds?.[s] === undefined) throw new Error(`ticket.redmine.statusIds.${s} is required`);
  }
  const base = cfg.url.replace(/\/$/, '');
  const idToStatus = Object.fromEntries(Object.entries(cfg.statusIds).map(([k, v]) => [String(v), k]));

  async function call(method, path, body) {
    const res = await fetchImpl(`${base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Redmine-API-Key': apiKey },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    if (!res.ok) {
      let text = '';
      try { text = await res.text(); } catch {}
      const suffix = text ? `: ${text.slice(0, 500)}` : '';
      throw new Error(`Redmine ${method} ${path} failed with HTTP ${res.status}${suffix}`);
    }
    if (res.status === 204) return {};
    return res.json();
  }

  const url = (id) => `${base}/issues/${id}`;

  return {
    async create({ title, body }) {
      const out = await call('POST', '/issues.json', {
        issue: { project_id: cfg.project, subject: title, description: body, status_id: cfg.statusIds.proposed }
      });
      const id = String(out.issue.id);
      return { system: 'redmine', id, url: url(id) };
    },
    mention(ref) {
      return ref.url || url(ref.id);
    },
    async comment(ref, body) {
      await call('PUT', `/issues/${ref.id}.json`, { issue: { notes: body } });
    },
    async hasComment(ref, text) {
      const out = await call('GET', `/issues/${ref.id}.json?include=journals`);
      // Whole-note equality: a note about pull/70 must not answer for pull/7.
      const wanted = text.trim();
      return (out.issue.journals || []).some(j => typeof j.notes === 'string' && j.notes.trim() === wanted);
    },
    async getStatus(ref) {
      const out = await call('GET', `/issues/${ref.id}.json`);
      const status = idToStatus[String(out.issue.status.id)];
      if (!status) throw new Error(`Redmine status id ${out.issue.status.id} is not mapped in ticket.redmine.statusIds`);
      return status;
    },
    async setStatus(ref, status) {
      await call('PUT', `/issues/${ref.id}.json`, { issue: { status_id: cfg.statusIds[status] } });
    }
  };
}
