import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTicketClient, STATUSES } from '../shared/scripts/lib/ticket/index.js';

const githubCfg = {
  ticket: {
    system: 'github',
    github: { repo: 'VEuPathDB/VEuPathDatasets', labels: { proposed: 'proposal', loading: 'loading', done: 'loaded' } }
  }
};

test('STATUSES is the shared vocabulary', () => {
  assert.deepEqual(STATUSES, ['proposed', 'loading', 'done']);
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
  await assert.rejects(client.getStatus({ system: 'jira', id: '1' }), /configured for github/);
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

test('a pull request cites a github issue by qualified number', () => {
  const client = createTicketClient(githubCfg, { exec: () => '' });
  assert.equal(client.mention({ system: 'github', id: '76', url: 'https://github.com/VEuPathDB/VEuPathDatasets/issues/76' }),
    'VEuPathDB/VEuPathDatasets#76');
});

test('the redmine system is no longer accepted', () => {
  assert.throws(() => createTicketClient({ ticket: { system: 'redmine', redmine: {} } }), /Unknown ticket system "redmine"/);
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
  await assert.rejects(client.hasComment({ system: 'jira', id: '1' }, 'x'), /configured for github/);
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

const milestoneCfg = {
  ticket: { ...githubCfg.ticket, github: { ...githubCfg.ticket.github, milestone: 'Build {build}' } }
};

test('github getBuild reads the build from the milestone title', async () => {
  const exec = (cmd, args) => (args.includes('milestone') ? JSON.stringify({ milestone: { title: 'Build 73' } }) : '');
  const client = createTicketClient(milestoneCfg, { exec });
  assert.equal(await client.getBuild({ system: 'github', id: '76' }), '73');
});

test('github getBuild refuses an issue with no build milestone, naming what it has', async () => {
  const none = createTicketClient(milestoneCfg, { exec: () => JSON.stringify({ milestone: null }) });
  await assert.rejects(none.getBuild({ system: 'github', id: '76' }), /Issue #76 has no "Build \{build\}" milestone; set one to choose the build/);
  const other = createTicketClient(milestoneCfg, { exec: () => JSON.stringify({ milestone: { title: 'Someday' } }) });
  await assert.rejects(other.getBuild({ system: 'github', id: '76' }), /\(it has "Someday"\)/);
});

test('github getBuild needs a milestone pattern in the config', async () => {
  const client = createTicketClient(githubCfg, { exec: () => '{}' });
  await assert.rejects(client.getBuild({ system: 'github', id: '1' }), /ticket\.github\.milestone is not configured/);
});
