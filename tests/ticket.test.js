import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTicketClient, STATUSES } from '../shared/scripts/lib/ticket/index.js';

const redmineCfg = {
  ticket: {
    system: 'redmine',
    redmine: { url: 'https://redmine.example', project: 'apidb', statusIds: { proposed: 1, loading: 2, done: 5 } }
  }
};
const githubCfg = {
  ticket: {
    system: 'github',
    github: { repo: 'VEuPathDB/VEuPathDatasets', labels: { proposed: 'proposal', loading: 'loading', done: 'loaded' } }
  }
};

function fakeFetch(responses) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : undefined, headers: init.headers });
    const r = responses.shift();
    return { ok: true, status: 200, json: async () => r };
  };
  fn.calls = calls;
  return fn;
}

test('STATUSES is the shared vocabulary', () => {
  assert.deepEqual(STATUSES, ['proposed', 'loading', 'done']);
});

test('redmine create posts an issue and returns a reference', async () => {
  const fetchImpl = fakeFetch([{ issue: { id: 42 } }]);
  const client = createTicketClient(redmineCfg, { fetchImpl, env: { REDMINE_API_KEY: 'k' } });
  const ref = await client.create({ title: 'T', body: 'B' });
  assert.deepEqual(ref, { system: 'redmine', id: '42', url: 'https://redmine.example/issues/42' });
  const call = fetchImpl.calls[0];
  assert.equal(call.url, 'https://redmine.example/issues.json');
  assert.equal(call.method, 'POST');
  assert.equal(call.headers['X-Redmine-API-Key'], 'k');
  assert.deepEqual(call.body, { issue: { project_id: 'apidb', subject: 'T', description: 'B', status_id: 1 } });
});

test('redmine getStatus maps status ids back to our vocabulary', async () => {
  const fetchImpl = fakeFetch([{ issue: { id: 42, status: { id: 2 } } }]);
  const client = createTicketClient(redmineCfg, { fetchImpl, env: { REDMINE_API_KEY: 'k' } });
  assert.equal(await client.getStatus({ system: 'redmine', id: '42' }), 'loading');
});

test('redmine setStatus and comment issue PUTs', async () => {
  const fetchImpl = fakeFetch([{}, {}]);
  const client = createTicketClient(redmineCfg, { fetchImpl, env: { REDMINE_API_KEY: 'k' } });
  await client.setStatus({ system: 'redmine', id: '42' }, 'done');
  await client.comment({ system: 'redmine', id: '42' }, 'note');
  assert.deepEqual(fetchImpl.calls[0].body, { issue: { status_id: 5 } });
  assert.deepEqual(fetchImpl.calls[1].body, { issue: { notes: 'note' } });
  assert.equal(fetchImpl.calls[0].method, 'PUT');
});

test('redmine requires REDMINE_API_KEY', () => {
  assert.throws(() => createTicketClient(redmineCfg, { env: {} }), /REDMINE_API_KEY/);
});

test('github backend drives gh and strips GITHUB_TOKEN', async () => {
  const calls = [];
  const exec = (cmd, args, opts) => {
    calls.push({ cmd, args, env: opts.env });
    if (args[1] === 'create') return 'https://github.com/VEuPathDB/VEuPathDatasets/issues/9\n';
    if (args[1] === 'view') return JSON.stringify({ labels: [{ name: 'loading' }] });
    return '';
  };
  const client = createTicketClient(githubCfg, { exec });
  const ref = await client.create({ title: 'T', body: 'B' });
  assert.deepEqual(ref, { system: 'github', id: '9', url: 'https://github.com/VEuPathDB/VEuPathDatasets/issues/9' });
  assert.ok(calls[0].args.includes('--label') && calls[0].args.includes('proposal'));
  assert.equal('GITHUB_TOKEN' in calls[0].env, false);
  assert.equal(await client.getStatus(ref), 'loading');
  await client.setStatus(ref, 'done');
  const edit = calls.find(c => c.args[1] === 'edit');
  assert.ok(edit.args.includes('--add-label') && edit.args.includes('loaded'));
  assert.ok(edit.args.includes('--remove-label'));
});

test('a reference from a different system than the configured one is refused', async () => {
  const client = createTicketClient(githubCfg, { exec: () => '' });
  await assert.rejects(client.getStatus({ system: 'redmine', id: '1' }), /configured for github/);
});
