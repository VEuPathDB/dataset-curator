import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTicketClient, STATUSES } from '../shared/scripts/lib/ticket/index.js';

const githubCfg = {
  ticket: {
    system: 'github',
    github: {
      repo: 'VEuPathDB/VEuPathDatasets',
      milestone: 'Build {build}',
      typeLabels: { 'bulk-rnaseq': 'rnaseq', 'genome-assembly': 'genome' },
      project: { owner: 'VEuPathDB', number: 25, statusField: 'Status', statusOptions: { proposed: 'Proposed', loading: 'Loading', done: 'Done' } }
    }
  }
};

const ISSUE_URL = 'https://github.com/VEuPathDB/VEuPathDatasets/issues/9';

/** A GraphQL answer listing the issue's project items as [owner, number, status option]. */
const projectItems = (...items) => JSON.stringify({
  data: { repository: { issue: { projectItems: { nodes: items.map(([login, number, name]) => ({
    project: { number, owner: { login } },
    fieldValueByName: name === null ? null : { name }
  })) } } } }
});

function fakeGh({ milestones = [], labels = [], itemAddFails = false, itemEditFails = false, graphql = projectItems() } = {}) {
  const calls = [];
  const envs = [];
  const exec = (cmd, args, opts) => {
    calls.push(args);
    envs.push(opts.env);
    if (args[0] === 'api' && args[1] === 'graphql') return graphql;
    if (args[0] === 'api' && args.includes('--jq')) return (args.some(a => a.includes('/labels')) ? labels : milestones).join('\n');
    if (args[0] === 'api') return '{}';
    if (args[0] === 'label') return '';
    if (args[0] === 'issue' && args[1] === 'create') return `${ISSUE_URL}\n`;
    if (args[1] === 'item-add') {
      if (itemAddFails) throw new Error('missing project scope');
      return JSON.stringify({ id: 'ITEM_1' });
    }
    if (args[1] === 'item-edit' && itemEditFails) throw new Error('field is read-only');
    if (args[0] === 'project' && args[1] === 'view') return JSON.stringify({ id: 'PROJ_1' });
    if (args[1] === 'field-list') {
      return JSON.stringify({ fields: [{ id: 'F_TITLE', name: 'Title' }, {
        id: 'F_STATUS', name: 'Status',
        options: [{ id: 'O_TODO', name: 'Todo' }, { id: 'O_PROP', name: 'Proposed' }, { id: 'O_LOAD', name: 'Loading' }, { id: 'O_DONE', name: 'Done' }]
      }] });
    }
    return '';
  };
  return { exec, calls, envs };
}

const argAfter = (args, flag) => args[args.indexOf(flag) + 1];
const newProposal = { title: 'T', body: 'B', build: '73', datasetType: 'bulk-rnaseq' };

test('STATUSES is the shared vocabulary', () => {
  assert.deepEqual(STATUSES, ['proposed', 'loading', 'done']);
});

test('github backend drives gh with GITHUB_TOKEN stripped', async () => {
  const { exec, envs } = fakeGh({ milestones: ['Build 73'], labels: ['rnaseq'] });
  const client = createTicketClient(githubCfg, { exec, env: { GITHUB_TOKEN: 'x', PATH: '/bin' } });
  const ref = await client.create(newProposal);
  assert.deepEqual(ref, { system: 'github', id: '9', url: ISSUE_URL });
  assert.ok(envs.length > 0);
  assert.equal(envs.some(e => 'GITHUB_TOKEN' in e), false);
});

test('a reference from a different system than the configured one is refused', async () => {
  const client = createTicketClient(githubCfg, { exec: () => '' });
  await assert.rejects(client.getStatus({ system: 'jira', id: '1' }), /configured for github/);
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

// --- create ----------------------------------------------------------------

test('github create files the issue under an existing build milestone', async () => {
  const { exec, calls } = fakeGh({ milestones: ['Build 72', 'Build 73'], labels: ['rnaseq'] });
  const client = createTicketClient(githubCfg, { exec });
  await client.create(newProposal);
  assert.equal(calls.some(a => a[0] === 'api' && a.includes('-f')), false);
  const create = calls.find(a => a[0] === 'issue' && a[1] === 'create');
  assert.equal(argAfter(create, '--milestone'), 'Build 73');
  assert.ok(calls.indexOf(create) > calls.findIndex(a => a[0] === 'api'));
});

test('github create makes the build milestone when it is missing', async () => {
  const { exec, calls } = fakeGh({ milestones: ['Build 72'], labels: ['rnaseq'] });
  const client = createTicketClient(githubCfg, { exec });
  await client.create(newProposal);
  const made = calls.find(a => a[0] === 'api' && a.includes('-f'));
  assert.deepEqual(made, ['api', 'repos/VEuPathDB/VEuPathDatasets/milestones', '-f', 'title=Build 73']);
});

test('github create labels the issue with its dataset type and no status label', async () => {
  const { exec, calls } = fakeGh({ milestones: ['Build 73'], labels: ['bug', 'rnaseq'] });
  const client = createTicketClient(githubCfg, { exec });
  await client.create(newProposal);
  const create = calls.find(a => a[0] === 'issue' && a[1] === 'create');
  assert.deepEqual(create.filter((a, i) => create[i - 1] === '--label'), ['rnaseq']);
  assert.ok(calls.some(a => a[0] === 'api' && a.includes('repos/VEuPathDB/VEuPathDatasets/labels?per_page=100')));
  assert.equal(calls.some(a => a[0] === 'label' && a[1] === 'create'), false);
});

test('github create makes the dataset-type label on first use, before filing the issue', async () => {
  const { exec, calls } = fakeGh({ milestones: ['Build 73'], labels: ['bug', 'rnaseq'] });
  const client = createTicketClient(githubCfg, { exec });
  await client.create({ ...newProposal, datasetType: 'genome-assembly' });
  const made = calls.findIndex(a => a[0] === 'label' && a[1] === 'create');
  assert.ok(made >= 0);
  assert.equal(calls[made][2], 'genome');
  assert.equal(argAfter(calls[made], '--repo'), 'VEuPathDB/VEuPathDatasets');
  const create = calls.findIndex(a => a[0] === 'issue' && a[1] === 'create');
  assert.ok(made < create);
  assert.equal(argAfter(calls[create], '--label'), 'genome');
});

test('github create refuses a dataset type with no label before calling gh', async () => {
  const { exec, calls } = fakeGh();
  const client = createTicketClient(githubCfg, { exec });
  await assert.rejects(client.create({ ...newProposal, datasetType: 'chip-seq' }),
    /No issue label for dataset type "chip-seq"; add it to ticket\.github\.typeLabels \(has bulk-rnaseq, genome-assembly\)/);
  assert.deepEqual(calls, []);
});

test('github create adds the issue to the project with Status Proposed', async () => {
  const { exec, calls } = fakeGh({ milestones: ['Build 73'], labels: ['rnaseq'] });
  const client = createTicketClient(githubCfg, { exec });
  await client.create(newProposal);
  const add = calls.find(a => a[1] === 'item-add');
  assert.equal(add[2], '25');
  assert.equal(argAfter(add, '--owner'), 'VEuPathDB');
  assert.equal(argAfter(add, '--url'), ISSUE_URL);
  assert.equal(add.includes('--repo'), false);
  const edit = calls.find(a => a[1] === 'item-edit');
  assert.equal(argAfter(edit, '--id'), 'ITEM_1');
  assert.equal(argAfter(edit, '--project-id'), 'PROJ_1');
  assert.equal(argAfter(edit, '--field-id'), 'F_STATUS');
  assert.equal(argAfter(edit, '--single-select-option-id'), 'O_PROP');
});

test('a project failure after filing the issue throws, names the issue and carries its reference', async () => {
  const { exec } = fakeGh({ milestones: ['Build 73'], labels: ['rnaseq'], itemAddFails: true });
  const client = createTicketClient(githubCfg, { exec });
  const err = await client.create(newProposal).then(() => null, e => e);
  assert.ok(err);
  assert.ok(err.message.includes(`Issue ${ISSUE_URL} was created but its Status could not be set to "Proposed" in project VEuPathDB/25: missing project scope`));
  assert.deepEqual(err.ticket, { system: 'github', id: '9', url: ISSUE_URL });
});

// --- status ----------------------------------------------------------------

test('github getStatus maps the project Status option to our status in one GraphQL call', async () => {
  for (const [option, status] of [['Proposed', 'proposed'], ['Loading', 'loading'], ['Done', 'done']]) {
    const { exec, calls } = fakeGh({ graphql: projectItems(['VEuPathDB', 3, 'Todo'], ['VEuPathDB', 25, option]) });
    const client = createTicketClient(githubCfg, { exec });
    assert.equal(await client.getStatus({ system: 'github', id: '9' }), status);
    assert.equal(calls.length, 1);
    const q = calls[0];
    assert.deepEqual(q.slice(0, 2), ['api', 'graphql']);
    for (const v of ['owner=VEuPathDB', 'repo=VEuPathDatasets', 'number=9', 'field=Status']) assert.ok(q.includes(v), v);
    assert.equal(q[q.indexOf('number=9') - 1], '-F');
  }
});

test('github getStatus matches the project owner regardless of case', async () => {
  const { exec } = fakeGh({ graphql: projectItems(['veupathdb', 25, 'Loading']) });
  const client = createTicketClient(githubCfg, { exec });
  assert.equal(await client.getStatus({ system: 'github', id: '9' }), 'loading');
});

test('github getStatus refuses an issue that is not in the project', async () => {
  const { exec } = fakeGh({ graphql: projectItems(['VEuPathDB', 3, 'Proposed'], ['Other', 25, 'Proposed']) });
  const client = createTicketClient(githubCfg, { exec });
  await assert.rejects(client.getStatus({ system: 'github', id: '9' }), /Issue #9 is not in project VEuPathDB\/25/);
});

test('github getStatus refuses an item with no Status', async () => {
  const { exec } = fakeGh({ graphql: projectItems(['VEuPathDB', 25, null]) });
  const client = createTicketClient(githubCfg, { exec });
  await assert.rejects(client.getStatus({ system: 'github', id: '9' }), /Issue #9 has no Status in project VEuPathDB\/25/);
});

test('github getStatus refuses a Status option it does not know, naming it and the configured ones', async () => {
  const { exec } = fakeGh({ graphql: projectItems(['VEuPathDB', 25, 'In progress']) });
  const client = createTicketClient(githubCfg, { exec });
  await assert.rejects(client.getStatus({ system: 'github', id: '9' }),
    /Issue #9 has Status "In progress" in project VEuPathDB\/25; expected one of Proposed, Loading, Done/);
});

test('github getStatus refuses an answer it cannot read', async () => {
  for (const graphql of ['not json', JSON.stringify({ errors: [{ message: 'Could not resolve to an Issue' }] })]) {
    const client = createTicketClient(githubCfg, { exec: () => graphql });
    await assert.rejects(client.getStatus({ system: 'github', id: '9' }), /Issue #9: could not read its project items/);
  }
});

test('github setStatus edits the project item and touches no labels', async () => {
  const { exec, calls } = fakeGh();
  const client = createTicketClient(githubCfg, { exec });
  await client.setStatus({ system: 'github', id: '9' }, 'loading');
  assert.equal(argAfter(calls.find(a => a[1] === 'item-add'), '--url'), ISSUE_URL);
  assert.equal(argAfter(calls.find(a => a[1] === 'item-edit'), '--single-select-option-id'), 'O_LOAD');
  assert.equal(calls.some(a => a[0] === 'label' || (a[0] === 'issue' && a[1] === 'edit')), false);
});

test('github setStatus failures throw', async () => {
  const ref = { system: 'github', id: '9' };
  await assert.rejects(createTicketClient(githubCfg, { exec: fakeGh({ itemEditFails: true }).exec }).setStatus(ref, 'done'),
    /field is read-only/);
  const missing = structuredClone(githubCfg);
  missing.ticket.github.project.statusOptions.loading = 'Underway';
  await assert.rejects(createTicketClient(missing, { exec: fakeGh().exec }).setStatus(ref, 'loading'),
    /project VEuPathDB\/25 field "Status" has no option "Underway"; add it to the field by hand/);
});

// --- config ----------------------------------------------------------------

test('github refuses a config without a milestone: it is the only record of the build', () => {
  const { milestone, ...github } = githubCfg.ticket.github;
  assert.throws(() => createTicketClient({ ticket: { system: 'github', github } }, { exec: () => '' }), /ticket\.github\.milestone is required/);
});

test('github refuses a config without a project: status lives there', () => {
  const { project, ...github } = githubCfg.ticket.github;
  assert.throws(() => createTicketClient({ ticket: { system: 'github', github } }, { exec: () => '' }), /ticket\.github\.project is required/);
});

test('github refuses a config without a typeLabels map', () => {
  const { typeLabels, ...github } = githubCfg.ticket.github;
  assert.throws(() => createTicketClient({ ticket: { system: 'github', github } }, { exec: () => '' }), /ticket\.github\.typeLabels is required/);
  assert.throws(() => createTicketClient({ ticket: { system: 'github', github: { ...github, typeLabels: ['rnaseq'] } } }, { exec: () => '' }),
    /ticket\.github\.typeLabels is required/);
});

test('github refuses a project config missing a status option', () => {
  const bad = structuredClone(githubCfg);
  delete bad.ticket.github.project.statusOptions.done;
  assert.throws(() => createTicketClient(bad, { exec: () => '' }), /ticket\.github\.project\.statusOptions\.done is required/);
});

// --- build -----------------------------------------------------------------

test('github getBuild reads the build from the milestone title', async () => {
  const exec = (cmd, args) => (args.includes('milestone') ? JSON.stringify({ milestone: { title: 'Build 73' } }) : '');
  const client = createTicketClient(githubCfg, { exec });
  assert.equal(await client.getBuild({ system: 'github', id: '76' }), '73');
});

test('github getBuild refuses an issue with no build milestone, naming what it has', async () => {
  const none = createTicketClient(githubCfg, { exec: () => JSON.stringify({ milestone: null }) });
  await assert.rejects(none.getBuild({ system: 'github', id: '76' }), /Issue #76 has no "Build \{build\}" milestone; set one to choose the build/);
  const other = createTicketClient(githubCfg, { exec: () => JSON.stringify({ milestone: { title: 'Someday' } }) });
  await assert.rejects(other.getBuild({ system: 'github', id: '76' }), /\(it has "Someday"\)/);
});
