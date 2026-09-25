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
    if (r && r.__notOk) {
      return { ok: false, status: r.status, text: async () => r.text };
    }
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

test('redmine requires every STATUSES status id to be configured', () => {
  const badCfg = {
    ticket: {
      system: 'redmine',
      redmine: { url: 'https://redmine.example', project: 'apidb', statusIds: { proposed: 1, loading: 2 } }
    }
  };
  assert.throws(
    () => createTicketClient(badCfg, { env: { REDMINE_API_KEY: 'k' } }),
    /ticket\.redmine\.statusIds\.done is required/
  );
});

test('redmine surfaces the response body on non-ok responses', async () => {
  const fetchImpl = fakeFetch([{ __notOk: true, status: 422, text: 'Subject cannot be blank' }]);
  const client = createTicketClient(redmineCfg, { fetchImpl, env: { REDMINE_API_KEY: 'k' } });
  await assert.rejects(client.create({ title: '', body: 'B' }), /Subject cannot be blank/);
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

test('github requires every STATUSES label to be configured', () => {
  const badCfg = {
    ticket: {
      system: 'github',
      github: { repo: 'VEuPathDB/VEuPathDatasets', labels: { proposed: 'proposal', loading: 'loading' } }
    }
  };
  assert.throws(
    () => createTicketClient(badCfg, { exec: () => '' }),
    /ticket\.github\.labels\.done is required/
  );
});

test('github getStatus rejects an issue carrying more than one status label', async () => {
  const exec = (cmd, args) => {
    if (args[1] === 'view') return JSON.stringify({ labels: [{ name: 'proposal' }, { name: 'loading' }] });
    return '';
  };
  const client = createTicketClient(githubCfg, { exec });
  await assert.rejects(
    client.getStatus({ system: 'github', id: '9' }),
    /Issue #9 carries more than one status label: proposal, loading/
  );
});

test('redmine hasComment matches a whole journal note, not a fragment', async () => {
  const body = 'Proposal updated. Pull request: https://gh/pull/7';
  const journals = [{ notes: '' }, { notes: `${body}\n` }];
  const fetchImpl = fakeFetch([
    { issue: { id: 42, journals } }, { issue: { id: 42, journals } }, { issue: { id: 42, journals } }
  ]);
  const client = createTicketClient(redmineCfg, { fetchImpl, env: { REDMINE_API_KEY: 'k' } });
  const ref = { system: 'redmine', id: '42' };
  assert.equal(await client.hasComment(ref, body), true);
  assert.equal(await client.hasComment(ref, 'https://gh/pull/7'), false);
  assert.equal(await client.hasComment(ref, `${body}\n\nSummary`), false);
  assert.equal(fetchImpl.calls[0].url, 'https://redmine.example/issues/42.json?include=journals');
});

test('redmine hasComment does not treat a pull/70 note as pull/7', async () => {
  const journals = [{ notes: 'Loading into rebuild02. Pull request: https://gh/pull/70' }];
  const fetchImpl = fakeFetch([{ issue: { id: 42, journals } }, { issue: { id: 42, journals } }]);
  const client = createTicketClient(redmineCfg, { fetchImpl, env: { REDMINE_API_KEY: 'k' } });
  const ref = { system: 'redmine', id: '42' };
  assert.equal(await client.hasComment(ref, 'Loading into rebuild02. Pull request: https://gh/pull/7'), false);
  assert.equal(await client.hasComment(ref, 'Loading into rebuild02. Pull request: https://gh/pull/70'), true);
});

test('redmine hasComment is false on an issue with no journals', async () => {
  const fetchImpl = fakeFetch([{ issue: { id: 42 } }]);
  const client = createTicketClient(redmineCfg, { fetchImpl, env: { REDMINE_API_KEY: 'k' } });
  assert.equal(await client.hasComment({ system: 'redmine', id: '42' }, 'anything'), false);
});

test('github hasComment compares whole comment bodies read as JSON', async () => {
  const calls = [];
  const body = 'Loading into rebuild02. Pull request: https://gh/pull/11';
  const exec = (cmd, args) => {
    calls.push(args);
    if (args[1] === 'view') return JSON.stringify({ comments: [{ body: 'first note' }, { body: `${body}\n` }] });
    return '';
  };
  const client = createTicketClient(githubCfg, { exec });
  const ref = { system: 'github', id: '9' };
  assert.equal(await client.hasComment(ref, body), true);
  assert.deepEqual(calls[0].slice(0, 5), ['issue', 'view', '9', '--json', 'comments']);
  assert.equal(calls[0].includes('--jq'), false);
  assert.ok(calls[0].includes('--repo'));
  assert.equal(await client.hasComment(ref, 'https://gh/pull/11'), false);
  assert.equal(await client.hasComment(ref, `${body}\nand more`), false);
});

test('github hasComment does not treat a pull/70 comment as pull/7', async () => {
  const exec = (cmd, args) => {
    if (args[1] === 'view') return JSON.stringify({ comments: [{ body: 'Pull request: https://gh/pull/70' }] });
    return '';
  };
  const client = createTicketClient(githubCfg, { exec });
  const ref = { system: 'github', id: '9' };
  assert.equal(await client.hasComment(ref, 'Pull request: https://gh/pull/7'), false);
  assert.equal(await client.hasComment(ref, 'Pull request: https://gh/pull/70'), true);
});

test('github hasComment is false on an issue with no comments', async () => {
  const client = createTicketClient(githubCfg, { exec: () => JSON.stringify({ comments: [] }) });
  assert.equal(await client.hasComment({ system: 'github', id: '9' }, 'anything'), false);
});

test('hasComment refuses a reference from a different ticket system', async () => {
  const client = createTicketClient(githubCfg, { exec: () => '' });
  await assert.rejects(client.hasComment({ system: 'redmine', id: '1' }, 'x'), /configured for github/);
});

test('commentOnce comments the first time and stays quiet afterwards', async () => {
  const bodies = [];
  const exec = (cmd, args) => {
    if (args[1] === 'view') return JSON.stringify({ comments: bodies.map(body => ({ body })) });
    if (args[1] === 'comment') { bodies.push(args[args.indexOf('--body') + 1]); return ''; }
    return '';
  };
  const client = createTicketClient(githubCfg, { exec });
  const ref = { system: 'github', id: '9' };
  assert.equal(await client.commentOnce(ref, 'Pull request: https://gh/pull/11'), true);
  assert.equal(await client.commentOnce(ref, 'Pull request: https://gh/pull/11'), false);
  assert.deepEqual(bodies, ['Pull request: https://gh/pull/11']);
  assert.equal(await client.commentOnce(ref, 'Pull request: https://gh/pull/12'), true);
  assert.equal(bodies.length, 2);
});

const projectCfg = {
  ticket: {
    system: 'github',
    github: {
      ...githubCfg.ticket.github,
      milestone: 'Build {build}',
      project: { owner: 'VEuPathDB', number: 25, statusField: 'Status', statusOptions: { proposed: 'Todo', loading: 'In progress', done: 'Done' } }
    }
  }
};

function fakeProjectGh({ milestones = [], itemAddFails = false } = {}) {
  const calls = [];
  const exec = (cmd, args) => {
    calls.push(args);
    if (args[0] === 'api' && args.includes('--jq')) return milestones.join('\n');
    if (args[0] === 'api') return '{}';
    if (args[1] === 'create') return 'https://github.com/VEuPathDB/VEuPathDatasets/issues/9\n';
    if (args[1] === 'item-add') {
      if (itemAddFails) throw new Error('missing project scope');
      return JSON.stringify({ id: 'ITEM_1' });
    }
    if (args[0] === 'project' && args[1] === 'view') return JSON.stringify({ id: 'PROJ_1' });
    if (args[1] === 'field-list') {
      return JSON.stringify({ fields: [{ id: 'F_TITLE', name: 'Title' }, {
        id: 'F_STATUS', name: 'Status',
        options: [{ id: 'O_TODO', name: 'Todo' }, { id: 'O_PROG', name: 'In progress' }, { id: 'O_DONE', name: 'Done' }]
      }] });
    }
    return '';
  };
  return { exec, calls };
}

const argAfter = (args, flag) => args[args.indexOf(flag) + 1];

test('github create files the issue under an existing build milestone', async () => {
  const { exec, calls } = fakeProjectGh({ milestones: ['Build 72', 'Build 73'] });
  const client = createTicketClient(projectCfg, { exec, warn: () => {} });
  await client.create({ title: 'T', body: 'B', build: '73' });
  assert.equal(calls.some(a => a[0] === 'api' && a.includes('-f')), false);
  const create = calls.find(a => a[1] === 'create');
  assert.equal(argAfter(create, '--milestone'), 'Build 73');
  assert.ok(calls.indexOf(create) > calls.findIndex(a => a[0] === 'api'));
});

test('github create makes the build milestone when it is missing', async () => {
  const { exec, calls } = fakeProjectGh({ milestones: ['Build 72'] });
  const client = createTicketClient(projectCfg, { exec, warn: () => {} });
  await client.create({ title: 'T', body: 'B', build: '73' });
  const made = calls.find(a => a[0] === 'api' && a.includes('-f'));
  assert.deepEqual(made, ['api', 'repos/VEuPathDB/VEuPathDatasets/milestones', '-f', 'title=Build 73']);
});

test('github create passes no milestone when none is configured', async () => {
  const { exec, calls } = fakeProjectGh();
  const client = createTicketClient(githubCfg, { exec });
  await client.create({ title: 'T', body: 'B', build: '73' });
  assert.equal(calls.some(a => a[0] === 'api'), false);
  assert.equal(calls.find(a => a[1] === 'create').includes('--milestone'), false);
});

test('github create adds the issue to the project and sets its status column', async () => {
  const { exec, calls } = fakeProjectGh({ milestones: ['Build 73'] });
  const client = createTicketClient(projectCfg, { exec, warn: () => {} });
  await client.create({ title: 'T', body: 'B', build: '73' });
  const add = calls.find(a => a[1] === 'item-add');
  assert.equal(add[2], '25');
  assert.equal(argAfter(add, '--owner'), 'VEuPathDB');
  assert.equal(argAfter(add, '--url'), 'https://github.com/VEuPathDB/VEuPathDatasets/issues/9');
  assert.equal(add.includes('--repo'), false);
  const edit = calls.find(a => a[1] === 'item-edit');
  assert.equal(argAfter(edit, '--id'), 'ITEM_1');
  assert.equal(argAfter(edit, '--project-id'), 'PROJ_1');
  assert.equal(argAfter(edit, '--field-id'), 'F_STATUS');
  assert.equal(argAfter(edit, '--single-select-option-id'), 'O_TODO');
});

test('github setStatus mirrors the new status to the project', async () => {
  const { exec, calls } = fakeProjectGh();
  const client = createTicketClient(projectCfg, { exec, warn: () => {} });
  await client.setStatus({ system: 'github', id: '9' }, 'loading');
  assert.equal(argAfter(calls.find(a => a[1] === 'item-add'), '--url'), 'https://github.com/VEuPathDB/VEuPathDatasets/issues/9');
  assert.equal(argAfter(calls.find(a => a[1] === 'item-edit'), '--single-select-option-id'), 'O_PROG');
});

test('a project mirror failure warns and still returns the created issue', async () => {
  const { exec } = fakeProjectGh({ milestones: ['Build 73'], itemAddFails: true });
  const warnings = [];
  const client = createTicketClient(projectCfg, { exec, warn: (m) => warnings.push(m) });
  const ref = await client.create({ title: 'T', body: 'B', build: '73' });
  assert.equal(ref.id, '9');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /issue #9 status "proposed" was not mirrored to project VEuPathDB\/25: missing project scope/);
});

test('github refuses a project config missing a status option', () => {
  const bad = structuredClone(projectCfg);
  delete bad.ticket.github.project.statusOptions.done;
  assert.throws(() => createTicketClient(bad, { exec: () => '' }), /ticket\.github\.project\.statusOptions\.done is required/);
});
