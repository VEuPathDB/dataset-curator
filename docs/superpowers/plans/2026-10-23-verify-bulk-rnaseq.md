# Verify Bulk RNA-seq Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `verify-bulk-rnaseq` skill whose `validate-proposal.js` runs deterministic validators (library type and depth, cross-file consistency, ApiCommonData's analysisConfig parser, study-wrangler STF validation, optional build fitness) using tools from a validation workspace the data loader names, posts the report on the ticket, and gates `mark-ready`; load re-runs the content validators.

**Architecture:** Validators are `{ name, tools, run(ctx) -> Finding[] }` objects registered per dataset type in `dataset-types/validators.js`. `lib/validation.js` runs them (a missing tool or a thrown validator becomes an `error` finding, never a skip), computes the verdict and formats/parses the ticket comment. `lib/validation-env.js` reads `<workspace>/validation-env.json` and resolves tools; nothing guesses or defaults a tool location. `lib/validation-ops.js` validates the proposal as `origin/master` has it, writes `.curation/tmp/verify/<ACC>.json` and posts the report. `markReady` reads the latest report comment and refuses a missing, stale (`proposalTree` mismatch) or failing one, for types that have validators. `loadProposal` takes an injected `validate` function and refuses on any error.

**Tech Stack:** Node.js ESM, `node:test`; Perl (ApiCommonData `AnalysisConfigParser`, needs `XML::Simple`, `JSON`, `Tie::IxHash`); R with `study.wrangler` >= 1.0.41; `gh` for tickets.

Spec: `docs/superpowers/specs/2026-10-23-verify-bulk-rnaseq-design.md`. Prerequisite: `docs/superpowers/plans/2026-10-23-release-vs-rebuild.md` merged (this plan uses its `rebuildBranch` argument and `REBUILD` test constant).

**Rules for whoever executes this plan:**
- Work on branch `verify-bulk-rnaseq`, rebased onto `origin/main` after the release-vs-rebuild PR merges. Never commit to `main`.
- Edit only `shared/`, `tests/`, `docs/`, `package.json`, `CLAUDE.md` and the skill-owned files named here. `yarn sync-shared` (pre-commit hook) copies `shared/` into `skills/*/`; never edit a synced copy.
- End every commit message with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Never guess or search for a validation workspace. Tests that need real tools read `VALIDATION_WORKSPACE` and skip visibly without it; ask John for the path when you want them to run.

---

## File Structure

```
shared/scripts/
  validate-proposal.js                       CLI: validate, print, write, post
  lib/tools/exec.js                          defaultExec, failureOutput
  lib/tools/apicommondata.js                 resolveApiCommonData, parseAnalysisConfig
  lib/tools/apicommondata-parse.pl           Perl shim: parser output as JSON
  lib/tools/study-wrangler.js                resolveStudyWrangler, validateEntity
  lib/tools/study-wrangler-validate.R        R shim: entity_from_stf + validate
  lib/validation-env.js                      readValidationEnv, createToolResolver
  lib/validation.js                          runValidators, verdictOf, report comment, formatFinding, verifiedComment
  lib/validation-ops.js                      validateProposal, contentValidation, reportPath
  lib/build-fitness.js                       buildFitness, buildFitnessValidator
  dataset-types/validators.js                validatorsFor(datasetType)
  dataset-types/bulk-rnaseq/validators/
    library-type.js  consistency.js  perl-parse.js  stf.js
Modified: lib/git-ops.js (treeHash, refExists), lib/ticket/{github,index}.js (listComments),
  lib/verification-ops.js (verifiableTicket export, mark-ready gate), lib/load-ops.js (validate,
  export withSettledProposal), dataset-types/bulk-rnaseq.js (export unescapeXml, annotationsFile),
  mark-ready.js, load-proposal.js
skills/verify-bulk-rnaseq/SKILL.md           new skill (scripts/resources arrive by sync)
tests/: validation.test.js, validation-env.test.js, validators-bulk-rnaseq.test.js,
  build-fitness.test.js, validation-ops.test.js, fixtures/proposals/PRJNA525426/
```

The validator registry lives in `dataset-types/validators.js`, not in `bulk-rnaseq.js`: the validators import `bulk-rnaseq.js`, and registering them there would make an import cycle.

---

### Task 1: git-ops treeHash and refExists

**Files:**
- Modify: `shared/scripts/lib/git-ops.js` (next to `showFile`, line 107)
- Test: `tests/git-ops.test.js`

- [ ] **Step 1: Write the failing test** (append; add `initRepo` from `./helpers.js` and `execFileSync` from `node:child_process` to the imports if absent)

```js
test('treeHash names the tree of a path on a ref; refExists answers for refs', () => {
  const { repo } = initRepo('git-tree-');
  const git = createGit(repo);
  const expected = execFileSync('git', ['-C', repo, 'rev-parse', 'origin/master:Model/lib/xml/datasetClass'], { encoding: 'utf-8' }).trim();
  assert.equal(git.treeHash('origin/master', 'Model/lib/xml/datasetClass'), expected);
  assert.match(expected, /^[0-9a-f]{40}$/);
  assert.equal(git.refExists('origin/master'), true);
  assert.equal(git.refExists('origin/rebuild99'), false);
});
```

- [ ] **Step 2: Run it**

Run: `node --test tests/git-ops.test.js`
Expected: FAIL, `git.treeHash is not a function`.

- [ ] **Step 3: Implement** (after the `showFile` line)

```js
    /** The tree object id of path on ref: changes whenever anything under path changes. */
    treeHash: (ref, path) => git('rev-parse', `${ref}:${path}`),
    refExists: (ref) => {
      try { git('rev-parse', '--verify', '--quiet', `${ref}^{commit}`); return true; }
      catch { return false; }
    },
```

- [ ] **Step 4: Run it**

Run: `node --test tests/git-ops.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/scripts/lib/git-ops.js tests/git-ops.test.js
git commit -m "git-ops: treeHash and refExists"
```

---

### Task 2: Ticket listComments

**Files:**
- Modify: `shared/scripts/lib/ticket/github.js` (after `hasComment`), `shared/scripts/lib/ticket/index.js`, `tests/helpers.js` (`stubTicket`)
- Test: `tests/ticket.test.js`

- [ ] **Step 1: Write the failing tests** (append to `tests/ticket.test.js`)

```js
test('github listComments returns comment bodies oldest first', async () => {
  const calls = [];
  const exec = (cmd, args) => {
    calls.push(args);
    return JSON.stringify({ comments: [{ body: 'first' }, { body: 'second' }, { author: 'x' }] });
  };
  const client = createTicketClient(githubCfg, { exec });
  assert.deepEqual(await client.listComments({ system: 'github', id: '9' }), ['first', 'second']);
  assert.deepEqual(calls[0].slice(0, 5), ['issue', 'view', '9', '--json', 'comments']);
});

test('listComments refuses a reference from a different ticket system', async () => {
  const client = createTicketClient(githubCfg, { exec: () => '' });
  await assert.rejects(client.listComments({ system: 'jira', id: '1' }), /configured for github/);
});
```

- [ ] **Step 2: Run them**

Run: `node --test tests/ticket.test.js`
Expected: FAIL, `client.listComments is not a function`.

- [ ] **Step 3: Implement**

`github.js`, after `hasComment`:

```js
    async listComments(ref) {
      const out = gh('issue', 'view', ref.id, '--json', 'comments');
      let comments;
      try { comments = JSON.parse(out).comments; }
      catch (e) { throw new Error(`gh issue view ${ref.id} --json comments returned no JSON: ${e.message}`); }
      return (comments || []).filter(c => typeof c?.body === 'string').map(c => c.body);
    },
```

`index.js`: add to `guarded` after `hasComment`:

```js
      listComments: async (ref) => { check(ref); return client.listComments(ref); },
```

and add `listComments` to the list in the `createTicketClient` doc comment (`comment, commentOnce, hasComment, listComments, getStatus, ...`).

`tests/helpers.js`, in `stubTicket`'s `client` after `hasComment`:

```js
    async listComments(ref) { calls.push(['listComments', ref.id]); return [...notes]; },
```

- [ ] **Step 4: Run all tests**

Run: `node --test tests/*.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/scripts/lib/ticket tests/ticket.test.js tests/helpers.js
git commit -m "Ticket client: listComments"
```

---

### Task 3: Validation core

**Files:**
- Create: `shared/scripts/lib/tools/exec.js`, `shared/scripts/lib/validation.js`
- Test: `tests/validation.test.js`

- [ ] **Step 1: Write the failing tests** (`tests/validation.test.js`)

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  runValidators, verdictOf, formatFinding, formatReportComment, parseReportComment, latestReport, verifiedComment, REPORT_MARKER
} from '../shared/scripts/lib/validation.js';

const finding = (severity, message = 'm', validator = 'v') => ({ validator, severity, message });
const report = (verdict, findings = []) => ({
  schemaVersion: 1, accession: 'PRJNA1', datasetType: 'bulk-rnaseq', proposalTree: 'a'.repeat(40), against: null,
  workspace: '/ws', tools: { apiCommonData: 'abc123', studyWrangler: '1.0.41' }, findings, verdict
});

test('verdictOf: fail on any error, needs-review on any warning, else pass', () => {
  assert.equal(verdictOf([finding('info'), finding('warning'), finding('error')]), 'fail');
  assert.equal(verdictOf([finding('info'), finding('warning')]), 'needs-review');
  assert.equal(verdictOf([finding('info')]), 'pass');
  assert.equal(verdictOf([]), 'pass');
});

test('runValidators runs every validator and collects findings', async () => {
  const validators = [
    { name: 'a', tools: [], run: async () => [finding('warning', 'thin', 'a')] },
    { name: 'b', tools: [], run: async (ctx) => [finding('info', ctx.proposalDir, 'b')] }
  ];
  const findings = await runValidators(validators, { proposalDir: '/p' }, () => ({ missing: 'unused' }));
  assert.deepEqual(findings, [finding('warning', 'thin', 'a'), finding('info', '/p', 'b')]);
});

test('runValidators turns a missing tool into a could-not-verify error and skips only that validator', async () => {
  let ran = false;
  const validators = [
    { name: 'perlParse', tools: ['apiCommonData'], run: async () => { ran = true; return []; } },
    { name: 'pure', tools: [], run: async () => [] }
  ];
  const findings = await runValidators(validators, {}, (name) => ({ missing: `${name} is not configured` }));
  assert.equal(ran, false);
  assert.deepEqual(findings, [finding('error', 'could not verify: apiCommonData is not configured', 'perlParse')]);
});

test('runValidators hands resolved tools to the validator', async () => {
  let seen;
  const validators = [{ name: 'stf', tools: ['studyWrangler'], run: async (ctx) => { seen = ctx.tools; return []; } }];
  await runValidators(validators, {}, () => ({ tool: { version: '1.0.41' } }));
  assert.deepEqual(seen, { studyWrangler: { version: '1.0.41' } });
});

test('runValidators turns a thrown validator into an error naming it, and keeps going', async () => {
  const validators = [
    { name: 'boom', tools: [], run: async () => { throw new Error('bad xml'); } },
    { name: 'after', tools: [], run: async () => [finding('info', 'still ran', 'after')] }
  ];
  const findings = await runValidators(validators, {}, () => ({}));
  assert.deepEqual(findings, [finding('error', 'failed: bad xml', 'boom'), finding('info', 'still ran', 'after')]);
});

test('formatFinding names severity, validator and organism', () => {
  assert.equal(formatFinding({ validator: 'stf', severity: 'error', organism: 'tfakST1', message: 'bad' }), 'ERROR [stf] tfakST1: bad');
  assert.equal(formatFinding(finding('warning', 'thin', 'libraryType')), 'WARNING [libraryType] thin');
});

test('a report comment round-trips and starts with the marker', () => {
  const r = report('needs-review', [finding('warning', 'has ``` fences\nand lines', 'libraryType')]);
  const body = formatReportComment(r);
  assert.ok(body.startsWith(REPORT_MARKER));
  assert.match(body, /WARNING \[libraryType\] has/);
  assert.deepEqual(parseReportComment(body), r);
});

test('parseReportComment ignores other comments and other schema versions', () => {
  assert.equal(parseReportComment('Verified: fine'), null);
  assert.equal(parseReportComment(formatReportComment({ ...report('pass'), schemaVersion: 2 })), null);
  assert.equal(parseReportComment(`${REPORT_MARKER}\nno json here`), null);
});

test('latestReport takes the last report comment', () => {
  const first = report('fail', [finding('error')]);
  const second = report('pass');
  assert.deepEqual(latestReport(['hello', formatReportComment(first), 'note', formatReportComment(second), 'later']), second);
  assert.equal(latestReport(['hello']), null);
});

test('verifiedComment records verdict, tools, accepted warnings and the note', () => {
  const r = report('needs-review', [finding('warning', 'MGI adapters', 'libraryType'), finding('info', 'cDNA', 'libraryType')]);
  assert.equal(verifiedComment(r, 'presenter read'), [
    'Verified: report needs-review (apiCommonData abc123, studyWrangler 1.0.41)',
    'Accepted warnings:',
    '- WARNING [libraryType] MGI adapters',
    'Note: presenter read'
  ].join('\n'));
  assert.equal(verifiedComment(report('pass'), ''), 'Verified: report pass (apiCommonData abc123, studyWrangler 1.0.41)');
});
```

- [ ] **Step 2: Run them**

Run: `node --test tests/validation.test.js`
Expected: FAIL, cannot find module `validation.js`.

- [ ] **Step 3: Implement `shared/scripts/lib/tools/exec.js`**

```js
import { execFileSync } from 'node:child_process';

export function defaultExec(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
}

/** What a failed command printed, so a finding says why. */
export const failureOutput = (e) => [e.stdout, e.stderr].filter(Boolean).join('\n').trim() || e.message;
```

- [ ] **Step 4: Implement `shared/scripts/lib/validation.js`**

```js
export const REPORT_SCHEMA_VERSION = 1;
export const REPORT_MARKER = '<!-- dataset-curator verification report -->';

/**
 * Runs every validator. A tool resolveTool cannot supply is an error for that
 * validator ("could not verify"), never a skip; a validator that throws is an
 * error naming it. resolveTool(name) returns { tool } or { missing }.
 */
export async function runValidators(validators, ctx, resolveTool) {
  const findings = [];
  for (const v of validators) {
    const tools = {};
    const missing = [];
    for (const name of v.tools ?? []) {
      const r = await resolveTool(name);
      if (r.tool) tools[name] = r.tool; else missing.push(r.missing);
    }
    if (missing.length) {
      findings.push({ validator: v.name, severity: 'error', message: `could not verify: ${missing.join('; ')}` });
      continue;
    }
    try { findings.push(...await v.run({ ...ctx, tools })); }
    catch (e) { findings.push({ validator: v.name, severity: 'error', message: `failed: ${e.message}` }); }
  }
  return findings;
}

export const verdictOf = (findings) =>
  findings.some((f) => f.severity === 'error') ? 'fail'
    : findings.some((f) => f.severity === 'warning') ? 'needs-review' : 'pass';

export const formatFinding = (f) => `${f.severity.toUpperCase()} [${f.validator}]${f.organism ? ` ${f.organism}:` : ''} ${f.message}`;

const toolList = (tools) => Object.entries(tools).map(([n, v]) => `${n} ${v}`).join(', ') || 'no tools';

/** The ticket comment: readable findings, then the report as JSON for mark-ready. */
export function formatReportComment(report) {
  return [
    REPORT_MARKER,
    `**Verification report** for ${report.accession}: **${report.verdict}** (${toolList(report.tools)})`,
    '',
    ...(report.findings.length ? report.findings.map((f) => `- ${formatFinding(f)}`) : ['No findings.']),
    '',
    '```json',
    JSON.stringify(report, null, 2),
    '```'
  ].join('\n');
}

export function parseReportComment(body) {
  if (typeof body !== 'string' || !body.startsWith(REPORT_MARKER)) return null;
  const json = /\n```json\n([\s\S]*)\n```$/.exec(body.trimEnd())?.[1];
  if (!json) return null;
  try {
    const report = JSON.parse(json);
    return report?.schemaVersion === REPORT_SCHEMA_VERSION ? report : null;
  } catch { return null; }
}

export const latestReport = (bodies) => bodies.map(parseReportComment).filter(Boolean).at(-1) ?? null;

/** What mark-ready writes on the ticket: the report it relied on and the warnings the person accepted. */
export function verifiedComment(report, note) {
  const warnings = report.findings.filter((f) => f.severity === 'warning');
  return [
    `Verified: report ${report.verdict} (${toolList(report.tools)})`,
    ...(warnings.length ? ['Accepted warnings:', ...warnings.map((f) => `- ${formatFinding(f)}`)] : []),
    ...(note ? [`Note: ${note}`] : [])
  ].join('\n');
}
```

- [ ] **Step 5: Run them**

Run: `node --test tests/validation.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add shared/scripts/lib/tools/exec.js shared/scripts/lib/validation.js tests/validation.test.js
git commit -m "Validation core: run validators, verdict, report comment"
```

---

### Task 4: Validation workspace and tool resolution

**Files:**
- Create: `shared/scripts/lib/validation-env.js`, `shared/scripts/lib/tools/apicommondata.js`, `shared/scripts/lib/tools/study-wrangler.js`
- Test: `tests/validation-env.test.js`

`validation-env.json`, kept by the data loader in the workspace they name:

```json
{ "schemaVersion": 1, "apiCommonData": "ApiCommonData", "perl": "/usr/bin/perl", "rscript": "/usr/bin/Rscript", "rLibs": null }
```

Relative paths resolve against the workspace. `rLibs: null` means R's own library path, by the loader's explicit choice.

- [ ] **Step 1: Write the failing tests** (`tests/validation-env.test.js`)

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readValidationEnv, createToolResolver } from '../shared/scripts/lib/validation-env.js';

/** A workspace with fake ApiCommonData modules and a fake perl/Rscript; env overrides validation-env.json keys. */
function workspace(env = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'validation-ws-'));
  mkdirSync(join(dir, 'ApiCommonData/Load/lib/perl'), { recursive: true });
  for (const m of ['AnalysisConfigParser.pm', 'AnalysisConfigRepeatFinder.pm']) writeFileSync(join(dir, 'ApiCommonData/Load/lib/perl', m), '1;\n');
  mkdirSync(join(dir, 'bin'));
  writeFileSync(join(dir, 'bin/perl'), '');
  writeFileSync(join(dir, 'bin/Rscript'), '');
  writeFileSync(join(dir, 'validation-env.json'), JSON.stringify({
    schemaVersion: 1, apiCommonData: 'ApiCommonData', perl: 'bin/perl', rscript: 'bin/Rscript', rLibs: null, ...env
  }));
  return dir;
}

/** exec answering git rev-parse and the study.wrangler version probe. */
const fakeExec = ({ version = '1.0.41', gitFails = false, rFails = false } = {}) => (cmd, args) => {
  if (cmd === 'git') { if (gitFails) throw new Error('not a git repository'); return 'c0ffee\n'; }
  if (cmd.endsWith('Rscript')) { if (rFails) throw new Error('there is no package called study.wrangler'); return version; }
  throw new Error(`unexpected ${cmd} ${args.join(' ')}`);
};

test('readValidationEnv needs a workspace and its validation-env.json', () => {
  assert.match(readValidationEnv(undefined).error, /No validation workspace given; ask the data loader/);
  const empty = mkdtempSync(join(tmpdir(), 'validation-ws-'));
  assert.match(readValidationEnv(empty).error, /validation-env\.json not found; ask the data loader/);
  writeFileSync(join(empty, 'validation-env.json'), '{ nope');
  assert.match(readValidationEnv(empty).error, /is not valid JSON/);
  writeFileSync(join(empty, 'validation-env.json'), '{"schemaVersion": 2}');
  assert.match(readValidationEnv(empty).error, /schemaVersion must be 1/);
  const ok = readValidationEnv(workspace());
  assert.equal(ok.error, undefined);
  assert.equal(ok.values.apiCommonData, 'ApiCommonData');
});

test('without a workspace every tool is missing with the ask-the-loader message', () => {
  const tools = createToolResolver(undefined, { exec: fakeExec() });
  assert.match(tools.resolveTool('apiCommonData').missing, /ask the data loader/);
  assert.equal(tools.workspace, null);
});

test('apiCommonData resolves relative to the workspace and records its commit', () => {
  const dir = workspace();
  const tools = createToolResolver(dir, { exec: fakeExec() });
  const { tool } = tools.resolveTool('apiCommonData');
  assert.equal(tool.path, join(dir, 'ApiCommonData'));
  assert.equal(tool.libDir, join(dir, 'ApiCommonData/Load/lib/perl'));
  assert.equal(tool.perl, join(dir, 'bin/perl'));
  assert.equal(tool.version, 'c0ffee');
  assert.deepEqual(tools.versions(), { apiCommonData: 'c0ffee' });
});

test('apiCommonData is missing when a key, a module, perl or git is missing', () => {
  assert.match(createToolResolver(workspace({ apiCommonData: undefined }), { exec: fakeExec() }).resolveTool('apiCommonData').missing, /has no "apiCommonData"/);
  assert.match(createToolResolver(workspace({ perl: undefined }), { exec: fakeExec() }).resolveTool('apiCommonData').missing, /has no "perl"/);
  assert.match(createToolResolver(workspace({ perl: 'bin/nope' }), { exec: fakeExec() }).resolveTool('apiCommonData').missing, /perl not found at .*bin\/nope/);
  assert.match(createToolResolver(workspace({ apiCommonData: 'elsewhere' }), { exec: fakeExec() }).resolveTool('apiCommonData').missing, /has no AnalysisConfigParser\.pm, AnalysisConfigRepeatFinder\.pm/);
  assert.match(createToolResolver(workspace(), { exec: fakeExec({ gitFails: true }) }).resolveTool('apiCommonData').missing, /is not a git checkout/);
});

test('studyWrangler resolves Rscript, R_LIBS and a new enough version', () => {
  const dir = workspace({ rLibs: 'R/library' });
  const { tool } = createToolResolver(dir, { exec: fakeExec({ version: '1.0.42' }) }).resolveTool('studyWrangler');
  assert.equal(tool.rscript, join(dir, 'bin/Rscript'));
  assert.equal(tool.env.R_LIBS, join(dir, 'R/library'));
  assert.equal(tool.version, '1.0.42');
});

test('studyWrangler is missing when Rscript, the package or the version falls short', () => {
  assert.match(createToolResolver(workspace({ rscript: undefined }), { exec: fakeExec() }).resolveTool('studyWrangler').missing, /has no "rscript"/);
  assert.match(createToolResolver(workspace({ rscript: 'bin/R-nope' }), { exec: fakeExec() }).resolveTool('studyWrangler').missing, /Rscript not found at/);
  assert.match(createToolResolver(workspace(), { exec: fakeExec({ rFails: true }) }).resolveTool('studyWrangler').missing, /study\.wrangler is not installed for .*Rscript/);
  assert.match(createToolResolver(workspace(), { exec: fakeExec({ version: '1.0.9' }) }).resolveTool('studyWrangler').missing, /study\.wrangler 1\.0\.9 is older than 1\.0\.41/);
});

test('an unknown tool name is missing, and resolution is cached', () => {
  let probes = 0;
  const exec = (cmd) => { probes++; return cmd === 'git' ? 'c0ffee' : '1.0.41'; };
  const tools = createToolResolver(workspace(), { exec });
  assert.match(tools.resolveTool('blast').missing, /unknown tool "blast"/);
  tools.resolveTool('apiCommonData');
  tools.resolveTool('apiCommonData');
  assert.equal(probes, 1);
});
```

- [ ] **Step 2: Run them**

Run: `node --test tests/validation-env.test.js`
Expected: FAIL, cannot find module.

- [ ] **Step 3: Implement `shared/scripts/lib/tools/apicommondata.js`**

```js
import { existsSync, mkdtempSync, mkdirSync, symlinkSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { defaultExec, failureOutput } from './exec.js';

const SHIM = join(dirname(fileURLToPath(import.meta.url)), 'apicommondata-parse.pl');
export const PARSER_MODULES = ['AnalysisConfigParser.pm', 'AnalysisConfigRepeatFinder.pm'];

/** { tool: { path, libDir, perl, version } } or { missing }, from the workspace's validation-env.json. */
export function resolveApiCommonData(env, { exec = defaultExec } = {}) {
  const { apiCommonData, perl } = env.values;
  if (!apiCommonData) return { missing: `${env.path} has no "apiCommonData"` };
  if (!perl) return { missing: `${env.path} has no "perl"` };
  const perlPath = resolve(env.workspace, perl);
  if (!existsSync(perlPath)) return { missing: `perl not found at ${perlPath}` };
  const path = resolve(env.workspace, apiCommonData);
  const libDir = join(path, 'Load', 'lib', 'perl');
  const absent = PARSER_MODULES.filter((m) => !existsSync(join(libDir, m)));
  if (absent.length) return { missing: `${libDir} has no ${absent.join(', ')}` };
  let version;
  try { version = exec('git', ['-C', path, 'rev-parse', 'HEAD']).trim(); }
  catch { return { missing: `${path} is not a git checkout, so its version cannot be recorded` }; }
  return { tool: { path, libDir, perl: perlPath, version } };
}

/**
 * ApiCommonData's own reading of an analysisConfig.xml:
 * { steps: [{ class, arguments }], groups: [{ displayName, samples }] }.
 * The modules live under Load/lib/perl but are named ApiCommonData::Load::*,
 * so a scratch tree of symlinks gives Perl the path it expects.
 */
export function parseAnalysisConfig(tool, xmlPath, { exec = defaultExec } = {}) {
  const lib = mkdtempSync(join(tmpdir(), 'acd-lib-'));
  try {
    const target = join(lib, 'ApiCommonData', 'Load');
    mkdirSync(target, { recursive: true });
    for (const m of PARSER_MODULES) symlinkSync(join(tool.libDir, m), join(target, m));
    let out;
    try { out = exec(tool.perl, [SHIM, xmlPath], { env: { ...process.env, PERL5LIB: lib } }); }
    catch (e) { throw new Error(failureOutput(e)); }
    return JSON.parse(out);
  } finally {
    rmSync(lib, { recursive: true, force: true });
  }
}
```

- [ ] **Step 4: Implement `shared/scripts/lib/tools/study-wrangler.js`**

```js
import { existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultExec, failureOutput } from './exec.js';

const SHIM = join(dirname(fileURLToPath(import.meta.url)), 'study-wrangler-validate.R');
export const MIN_STUDY_WRANGLER = '1.0.41';

const compareVersions = (a, b) => {
  const [x, y] = [a, b].map((v) => v.split('.').map(Number));
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d;
  }
  return 0;
};

/** { tool: { rscript, env, version } } or { missing }, from the workspace's validation-env.json. */
export function resolveStudyWrangler(env, { exec = defaultExec } = {}) {
  const { rscript, rLibs } = env.values;
  if (!rscript) return { missing: `${env.path} has no "rscript"` };
  const path = resolve(env.workspace, rscript);
  if (!existsSync(path)) return { missing: `Rscript not found at ${path}` };
  const libs = rLibs ? resolve(env.workspace, rLibs) : null;
  const rEnv = libs ? { ...process.env, R_LIBS: libs } : { ...process.env };
  let version;
  try { version = exec(path, ['-e', 'cat(as.character(packageVersion("study.wrangler")))'], { env: rEnv }).trim(); }
  catch { return { missing: `study.wrangler is not installed for ${path}${libs ? ` with R_LIBS=${libs}` : ''}` }; }
  if (compareVersions(version, MIN_STUDY_WRANGLER) < 0) return { missing: `study.wrangler ${version} is older than ${MIN_STUDY_WRANGLER}` };
  return { tool: { rscript: path, env: rEnv, version } };
}

/** study.wrangler's entity_from_stf + validate on one entity: { ok, output }. */
export function validateEntity(tool, tsvPath, yamlPath, { exec = defaultExec } = {}) {
  try { return { ok: true, output: exec(tool.rscript, [SHIM, tsvPath, yamlPath], { env: tool.env }).trim() }; }
  catch (e) { return { ok: false, output: failureOutput(e) }; }
}
```

- [ ] **Step 5: Implement `shared/scripts/lib/validation-env.js`**

```js
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { defaultExec } from './tools/exec.js';
import { resolveApiCommonData } from './tools/apicommondata.js';
import { resolveStudyWrangler } from './tools/study-wrangler.js';

export const VALIDATION_ENV_FILENAME = 'validation-env.json';
const ASK = 'ask the data loader which validation workspace to use';

/**
 * The validation workspace the data loader named, described by its own
 * validation-env.json. Never guessed, searched for or defaulted.
 * Returns { workspace, path, values } or { error }.
 */
export function readValidationEnv(workspace) {
  if (!workspace) return { error: `No validation workspace given; ${ASK} and pass --workspace <dir>` };
  const dir = resolve(workspace);
  const path = join(dir, VALIDATION_ENV_FILENAME);
  if (!existsSync(path)) return { error: `${path} not found; ${ASK}` };
  let values;
  try { values = JSON.parse(readFileSync(path, 'utf-8')); }
  catch (e) { return { error: `${path} is not valid JSON: ${e.message}` }; }
  if (values?.schemaVersion !== 1) return { error: `${path}: schemaVersion must be 1` };
  return { workspace: dir, path, values };
}

const RESOLVERS = { apiCommonData: resolveApiCommonData, studyWrangler: resolveStudyWrangler };

/** resolveTool(name) -> { tool } | { missing }, cached; versions() of the tools resolved so far. */
export function createToolResolver(workspace, { exec = defaultExec } = {}) {
  const env = readValidationEnv(workspace);
  const cache = new Map();
  const resolveTool = (name) => {
    if (!cache.has(name)) {
      if (env.error) cache.set(name, { missing: env.error });
      else if (!RESOLVERS[name]) cache.set(name, { missing: `unknown tool "${name}"` });
      else cache.set(name, RESOLVERS[name](env, { exec }));
    }
    return cache.get(name);
  };
  const versions = () => Object.fromEntries([...cache].filter(([, r]) => r.tool).map(([name, r]) => [name, r.tool.version]));
  return { workspace: env.workspace ?? null, resolveTool, versions };
}
```

- [ ] **Step 6: Run them**

Run: `node --test tests/validation-env.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add shared/scripts/lib/validation-env.js shared/scripts/lib/tools tests/validation-env.test.js
git commit -m "Validation workspace: validation-env.json and tool resolution"
```

---

### Task 5: Perl and R shims

**Files:**
- Create: `shared/scripts/lib/tools/apicommondata-parse.pl`, `shared/scripts/lib/tools/study-wrangler-validate.R`
- Test: `tests/validation-env.test.js` (real-tool tests, skipped without `VALIDATION_WORKSPACE`)

- [ ] **Step 1: Write the gated tests** (append to `tests/validation-env.test.js`; add `parseAnalysisConfig` and `validateEntity` imports from `../shared/scripts/lib/tools/apicommondata.js` and `../shared/scripts/lib/tools/study-wrangler.js`, and `fixtures` from `./helpers.js`)

```js
const REAL = process.env.VALIDATION_WORKSPACE;
const needsWorkspace = { skip: !REAL && 'VALIDATION_WORKSPACE is not set; ask John for the validation workspace to run real-tool tests' };
const fixtureOrganism = join(fixtures, 'proposals/PRJNA000002/curated/tfakST1');

test('ApiCommonData parses the fixture analysisConfig.xml', needsWorkspace, () => {
  const { tool, missing } = createToolResolver(REAL).resolveTool('apiCommonData');
  assert.equal(missing, undefined);
  const parsed = parseAnalysisConfig(tool, join(fixtureOrganism, 'analysisConfig.xml'));
  assert.deepEqual(parsed.steps.map((s) => s.class), ['ApiCommonData::Load::RnaSeqAnalysisEbi']);
  assert.deepEqual(parsed.groups, [{ displayName: 'Control', samples: ['SAMN1'] }, { displayName: 'Stressed', samples: ['SAMN2'] }]);
});

test('ApiCommonData reports XML it cannot read', needsWorkspace, () => {
  const { tool } = createToolResolver(REAL).resolveTool('apiCommonData');
  const bad = join(mkdtempSync(join(tmpdir(), 'acd-bad-')), 'analysisConfig.xml');
  writeFileSync(bad, '<xml><step class="x">');
  assert.throws(() => parseAnalysisConfig(tool, bad), /./);
});

test('study.wrangler accepts the fixture entity and rejects a broken one', needsWorkspace, () => {
  const { tool, missing } = createToolResolver(REAL).resolveTool('studyWrangler');
  assert.equal(missing, undefined);
  assert.equal(validateEntity(tool, join(fixtureOrganism, 'entity-sample.tsv'), join(fixtureOrganism, 'entity-sample.yaml')).ok, true);
  const dir = mkdtempSync(join(tmpdir(), 'stf-bad-'));
  writeFileSync(join(dir, 'entity-sample.tsv'), 'sample.ID \\\\ Descriptors\tlabel\nS1\tA\nS1\tB\n');
  writeFileSync(join(dir, 'entity-sample.yaml'), 'name: sample\n');
  assert.equal(validateEntity(tool, join(dir, 'entity-sample.tsv'), join(dir, 'entity-sample.yaml')).ok, false);
});
```

- [ ] **Step 2: Write `shared/scripts/lib/tools/apicommondata-parse.pl`**

```perl
# Prints ApiCommonData's own reading of an analysisConfig.xml as JSON.
# Usage: perl apicommondata-parse.pl <analysisConfig.xml>   (PERL5LIB set by apicommondata.js)
use strict;
use warnings;
use JSON;
use ApiCommonData::Load::AnalysisConfigParser;
use ApiCommonData::Load::AnalysisConfigRepeatFinder qw(displayAndBaseName);

my ($xmlFile) = @ARGV;
my $steps = ApiCommonData::Load::AnalysisConfigParser->new($xmlFile)->parse();
my $groups = displayAndBaseName($xmlFile);

print JSON->new->canonical->encode({
  steps  => [map { { class => $_->{class}, arguments => $_->{arguments} } } @$steps],
  groups => [map { { displayName => $groups->{$_}->{displayName}, samples => $groups->{$_}->{samples} } } keys %$groups],
});
```

`displayAndBaseName` returns a `Tie::IxHash`, so `keys` keeps the order of the samples in the file.

- [ ] **Step 3: Write `shared/scripts/lib/tools/study-wrangler-validate.R`**

```r
# Loads one STF entity with study.wrangler and validates it; exits 1 unless valid.
# Usage: Rscript study-wrangler-validate.R <entity.tsv> <entity.yaml>
suppressPackageStartupMessages(library(study.wrangler))
args <- commandArgs(trailingOnly = TRUE)
entity <- entity_from_stf(args[1], args[2])
quit(status = if (isTRUE(validate(entity))) 0 else 1)
```

- [ ] **Step 4: Run them**

Run: `node --test tests/validation-env.test.js`
Expected without `VALIDATION_WORKSPACE`: PASS with 3 tests reported `# SKIP VALIDATION_WORKSPACE is not set ...`. If John has given a workspace, run `VALIDATION_WORKSPACE=<his path> node --test tests/validation-env.test.js` and expect PASS with no skips.

- [ ] **Step 5: Commit**

```bash
git add shared/scripts/lib/tools/apicommondata-parse.pl shared/scripts/lib/tools/study-wrangler-validate.R tests/validation-env.test.js
git commit -m "Perl and R shims for ApiCommonData and study.wrangler"
```

---

### Task 6: libraryType validator

**Files:**
- Create: `shared/scripts/dataset-types/bulk-rnaseq/validators/library-type.js`
- Test: `tests/validators-bulk-rnaseq.test.js`

- [ ] **Step 1: Write the failing tests** (`tests/validators-bulk-rnaseq.test.js`)

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixtures } from './helpers.js';
import { libraryType, MIN_SPOTS, MGI_WARNING, ION_TORRENT_WARNING } from '../shared/scripts/dataset-types/bulk-rnaseq/validators/library-type.js';

/** A scratch copy of the PRJNA000002 fixture whose SRA metadata has the given runs. */
function proposal(runs) {
  const dir = join(mkdtempSync(join(tmpdir(), 'validators-')), 'PRJNA000002');
  cpSync(join(fixtures, 'proposals/PRJNA000002'), dir, { recursive: true });
  if (runs) writeFileSync(join(dir, 'inputs/PRJNA000002_sra_metadata.json'), JSON.stringify({ bioproject: 'PRJNA000002', runs }));
  return { proposalDir: dir, manifest: JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf-8')) };
}
const run = (id, extra = {}) => ({
  run_accession: id, library_strategy: 'RNA-Seq', library_source: 'TRANSCRIPTOMIC', library_selection: 'cDNA',
  instrument_platform: 'ILLUMINA', read_count: '2000000', ...extra
});
const severities = (findings) => findings.map((f) => f.severity);
const errors = (findings) => findings.filter((f) => f.severity === 'error').map((f) => f.message);

test('libraryType passes Illumina bulk RNA-seq with enough reads, noting the selection', async () => {
  const findings = await libraryType.run(proposal([run('SRR1'), run('SRR2')]));
  assert.deepEqual(severities(findings), ['info']);
  assert.match(findings[0].message, /library_selection cDNA \(2 runs\)/);
});

test('libraryType refuses other strategies and sources by name', async () => {
  const findings = await libraryType.run(proposal([run('SRR1', { library_strategy: 'ChIP-Seq' }), run('SRR2', { library_source: 'TRANSCRIPTOMIC SINGLE CELL' })]));
  assert.deepEqual(errors(findings), [
    'library_strategy is ChIP-Seq for SRR1; bulk RNA-seq needs RNA-Seq',
    'library_source is TRANSCRIPTOMIC SINGLE CELL for SRR2; bulk RNA-seq needs TRANSCRIPTOMIC'
  ]);
});

test('libraryType warns for MGI and Ion Torrent with what can go wrong', async () => {
  const findings = await libraryType.run(proposal([run('SRR1', { instrument_platform: 'DNBSEQ' }), run('SRR2', { instrument_platform: 'ION_TORRENT' })]));
  const warnings = findings.filter((f) => f.severity === 'warning').map((f) => f.message);
  assert.deepEqual(warnings, [`DNBSEQ (SRR1): ${MGI_WARNING}`, `ION_TORRENT (SRR2): ${ION_TORRENT_WARNING}`]);
  assert.match(MGI_WARNING, /clips only Illumina adapters/);
  assert.match(ION_TORRENT_WARNING, /homopolymer/);
});

test('libraryType refuses long-read and unknown platforms', async () => {
  const findings = await libraryType.run(proposal([run('SRR1', { instrument_platform: 'OXFORD_NANOPORE' }), run('SRR2', { instrument_platform: undefined })]));
  assert.deepEqual(errors(findings), [
    'OXFORD_NANOPORE (SRR1) is not a short-read platform bulk-rnaseq-nextflow handles; long reads belong in long-read-rnaseq-nextflow',
    '(missing) (SRR2) is not a short-read platform bulk-rnaseq-nextflow handles'
  ]);
});

test('libraryType sums technical replicates per sample before the depth floor', async () => {
  const p = proposal([run('SRR1', { read_count: '600000' }), run('SRR3', { read_count: '600000' }), run('SRR2', { read_count: '999999' })]);
  const sheet = join(p.proposalDir, 'curated/tfakST1/samplesheet.csv');
  writeFileSync(sheet, 'sample,fastq_1,fastq_2,strandedness\nSAMN1,SRR1,,stranded\nSAMN1,SRR3,,stranded\nSAMN2,SRR2,,stranded\n');
  assert.equal(MIN_SPOTS, 1000000);
  assert.deepEqual(errors(await libraryType.run(p)), ['SAMN2 has 999,999 spots in SRR2; at least 1,000,000 are needed']);
});

test('libraryType refuses a samplesheet run missing from the metadata or without a read count', async () => {
  assert.deepEqual(errors(await libraryType.run(proposal([run('SRR1')]))), ['SAMN2: SRR2 not in the SRA metadata']);
  assert.deepEqual(errors(await libraryType.run(proposal([run('SRR1'), run('SRR2', { read_count: '' })]))), ['SAMN2: no read_count for SRR2']);
});

test('libraryType refuses an SRA proposal without metadata, and only warns for reads on a server', async () => {
  const p = proposal();
  rmSync(join(p.proposalDir, 'inputs/PRJNA000002_sra_metadata.json'));
  assert.deepEqual(errors(await libraryType.run(p)), ['inputs/PRJNA000002_sra_metadata.json is missing, so library type and depth cannot be checked']);
  const dataset = join(p.proposalDir, 'curated/dataset.json');
  writeFileSync(dataset, JSON.stringify({ ...JSON.parse(readFileSync(dataset, 'utf-8')), source: { type: 'server' } }));
  const findings = await libraryType.run(p);
  assert.deepEqual(severities(findings), ['warning']);
  assert.match(findings[0].message, /No SRA metadata: library type and depth not checked; confirm by hand/);
});

test('libraryType warns that depth is unchecked for server reads that do have metadata', async () => {
  const p = proposal([run('SRR1'), run('SRR2')]);
  const dataset = join(p.proposalDir, 'curated/dataset.json');
  writeFileSync(dataset, JSON.stringify({ ...JSON.parse(readFileSync(dataset, 'utf-8')), source: { type: 'server' } }));
  const warnings = (await libraryType.run(p)).filter((f) => f.severity === 'warning').map((f) => f.message);
  assert.deepEqual(warnings, ['Reads come from server: depth not checked; confirm by hand']);
});
```

- [ ] **Step 2: Run them**

Run: `node --test tests/validators-bulk-rnaseq.test.js`
Expected: FAIL, cannot find module.

- [ ] **Step 3: Implement `library-type.js`**

```js
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readInputJson, readDataset } from '../../_common.js';

const NAME = 'libraryType';
export const MIN_SPOTS = 1_000_000;
export const MGI_WARNING = 'bulk-rnaseq-nextflow clips only Illumina adapters (Trimmomatic ILLUMINACLIP with All_adaptors-*.fa). MGI adapter read-through stays in the reads, lowering alignment rates and adding soft-clipped or mismatched bases near the 3\' end, worst with short inserts. Confirm the library\'s insert size, or add MGI adapters to the pipeline.';
export const ION_TORRENT_WARNING = 'Single-end reads of variable length with homopolymer indel errors. The pipeline does not clip Ion Torrent adapters, and indels near splice sites can shift HISAT2 junction calls and lower unique-alignment rates. Expect noisier junctions and counts.';
const PLATFORM_WARNINGS = { BGISEQ: MGI_WARNING, DNBSEQ: MGI_WARNING, ION_TORRENT: ION_TORRENT_WARNING };
const LONG_READ = ['OXFORD_NANOPORE', 'PACBIO_SMRT'];

const finding = (severity, message) => ({ validator: NAME, severity, message });
const runList = (ids) => (ids.length > 3 ? `${ids.slice(0, 3).join(', ')} and ${ids.length - 3} more` : ids.join(', '));

/** Run ids grouped by the value they have for field, in first-seen order. */
function byValue(runs, field) {
  const groups = new Map();
  for (const r of runs) {
    const v = r[field] || '(missing)';
    groups.set(v, [...(groups.get(v) ?? []), r.run_accession]);
  }
  return groups;
}

const expect = (runs, field, expected) => [...byValue(runs, field)]
  .filter(([v]) => v !== expected)
  .map(([v, ids]) => finding('error', `${field} is ${v} for ${runList(ids)}; bulk RNA-seq needs ${expected}`));

const platforms = (runs) => [...byValue(runs, 'instrument_platform')].flatMap(([platform, ids]) => {
  if (platform === 'ILLUMINA') return [];
  if (PLATFORM_WARNINGS[platform]) return [finding('warning', `${platform} (${runList(ids)}): ${PLATFORM_WARNINGS[platform]}`)];
  const hint = LONG_READ.includes(platform) ? '; long reads belong in long-read-rnaseq-nextflow' : '';
  return [finding('error', `${platform} (${runList(ids)}) is not a short-read platform bulk-rnaseq-nextflow handles${hint}`)];
});

/** Samplesheet sample -> its runs, across organisms; rows sharing a name are technical replicates. */
function sampleRuns(proposalDir, manifest) {
  const samples = new Map();
  for (const { proposedOrganismAbbrev } of manifest.organisms) {
    const [, ...rows] = readFileSync(join(proposalDir, 'curated', proposedOrganismAbbrev, 'samplesheet.csv'), 'utf-8').split(/\r?\n/);
    for (const row of rows.filter((l) => l.trim())) {
      const [sample, run] = row.split(',').map((c) => c.trim());
      samples.set(sample, new Set([...(samples.get(sample) ?? []), run]));
    }
  }
  return samples;
}

function depth(runs, samples) {
  const byRun = new Map(runs.map((r) => [r.run_accession, r]));
  return [...samples].flatMap(([sample, set]) => {
    const ids = [...set];
    const absent = ids.filter((id) => !byRun.has(id));
    if (absent.length) return [finding('error', `${sample}: ${absent.join(', ')} not in the SRA metadata`)];
    const counts = ids.map((id) => {
      const raw = byRun.get(id).read_count;
      return raw === undefined || raw === '' ? NaN : Number(raw);
    });
    const uncounted = ids.filter((id, i) => !Number.isFinite(counts[i]));
    if (uncounted.length) return [finding('error', `${sample}: no read_count for ${uncounted.join(', ')}`)];
    const total = counts.reduce((a, b) => a + b, 0);
    return total < MIN_SPOTS
      ? [finding('error', `${sample} has ${total.toLocaleString('en-US')} spots in ${ids.join(', ')}; at least ${MIN_SPOTS.toLocaleString('en-US')} are needed`)]
      : [];
  });
}

/** Bulk short-read RNA-seq with enough spots per sample, from the SRA metadata snapshot taken at proposal time. */
export const libraryType = {
  name: NAME,
  tools: [],
  async run({ proposalDir, manifest }) {
    const source = readDataset(proposalDir).source ?? { type: 'sra' };
    const file = `${manifest.accession}_sra_metadata.json`;
    const metadata = readInputJson(proposalDir, file, { optional: true });
    if (!metadata) {
      return source.type === 'sra'
        ? [finding('error', `inputs/${file} is missing, so library type and depth cannot be checked`)]
        : [finding('warning', 'No SRA metadata: library type and depth not checked; confirm by hand')];
    }
    const runs = metadata.runs ?? [];
    return [
      ...expect(runs, 'library_strategy', 'RNA-Seq'),
      ...expect(runs, 'library_source', 'TRANSCRIPTOMIC'),
      ...platforms(runs),
      ...[...byValue(runs, 'library_selection')].map(([v, ids]) => finding('info', `library_selection ${v} (${ids.length} runs)`)),
      ...(source.type === 'sra'
        ? depth(runs, sampleRuns(proposalDir, manifest))
        : [finding('warning', `Reads come from ${source.type}: depth not checked; confirm by hand`)])
    ];
  }
};
```

- [ ] **Step 4: Run them**

Run: `node --test tests/validators-bulk-rnaseq.test.js`
Expected: PASS. `readDataset` returns `{ props, source }`; if `source` is absent in an older fixture, the `?? { type: 'sra' }` default applies.

- [ ] **Step 5: Commit**

```bash
git add shared/scripts/dataset-types/bulk-rnaseq/validators/library-type.js tests/validators-bulk-rnaseq.test.js
git commit -m "bulk-rnaseq validator: library type and depth"
```

---

### Task 7: consistency validator

**Files:**
- Modify: `shared/scripts/dataset-types/bulk-rnaseq.js` (export `unescapeXml`, line 562; export `annotationsFile`, line 276)
- Create: `shared/scripts/dataset-types/bulk-rnaseq/validators/consistency.js`
- Test: `tests/validators-bulk-rnaseq.test.js`

- [ ] **Step 1: Write the failing tests** (append; add the import of `consistency`)

```js
import { consistency } from '../shared/scripts/dataset-types/bulk-rnaseq/validators/consistency.js';

const rewrite = (path, from, to) => writeFileSync(path, readFileSync(path, 'utf-8').replace(from, to));

test('consistency passes the fixture', async () => {
  assert.deepEqual(await consistency.run(proposal()), []);
});

test('consistency reports a label that differs between files', async () => {
  const p = proposal();
  rewrite(join(p.proposalDir, 'curated/tfakST1/entity-sample.tsv'), 'SAMN2\tSRR2\tStressed', 'SAMN2\tSRR2\tStresed');
  assert.deepEqual(await consistency.run(p), [{
    validator: 'consistency', severity: 'error', organism: 'tfakST1',
    message: 'SAMN2 has different labels: annotations "Stressed", analysisConfig.xml "Stressed", entity-sample.tsv "Stresed"'
  }]);
});

test('consistency reports runs that differ between files', async () => {
  const p = proposal();
  rewrite(join(p.proposalDir, 'curated/tfakST1/samplesheet.csv'), 'SAMN1,SRR1,', 'SAMN1,SRR9,');
  const [f] = await consistency.run(p);
  assert.equal(f.message, 'SAMN1 has different runs: annotations SRR1, samplesheet.csv SRR9, entity-sample.tsv SRR1');
});

test('consistency passes checkCurated errors through', async () => {
  const p = proposal();
  rewrite(join(p.proposalDir, 'curated/tfakST1/entity-sample.tsv'), 'SAMN2\t', 'SAMN3\t');
  const findings = await consistency.run(p);
  assert.ok(findings.length > 0);
  assert.ok(findings.every((f) => f.validator === 'consistency' && f.severity === 'error'));
  assert.match(findings[0].message, /samplesheet\.csv and entity-sample\.tsv disagree/);
});
```

- [ ] **Step 2: Run them**

Run: `node --test tests/validators-bulk-rnaseq.test.js`
Expected: FAIL, cannot find module `consistency.js`.

- [ ] **Step 3: Export the two helpers in `bulk-rnaseq.js`**

Change `const unescapeXml = (s) =>` to `export const unescapeXml = (s) =>` and `const annotationsFile = (m) =>` to `export const annotationsFile = (m) =>`.

- [ ] **Step 4: Implement `consistency.js`**

```js
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkCurated, samplesFor, unescapeXml, annotationsFile } from '../../bulk-rnaseq.js';
import { readCuratedJson, readDataset } from '../../_common.js';

const NAME = 'consistency';
const SRA_COLUMN = 'SRA.ID.s.';
const error = (message, organism) => ({ validator: NAME, severity: 'error', ...(organism ? { organism } : {}), message });

function tsvRows(text) {
  const [header, ...rows] = text.split(/\r?\n/).filter((l) => l.trim());
  const cols = header.split('\t');
  return rows.map((r) => Object.fromEntries(r.split('\t').map((v, i) => [cols[i], v.trim()])));
}

/** sampleId -> label from the label|sampleId values of analysisConfig.xml. */
function configLabels(xml) {
  const labels = new Map();
  for (const [, raw] of xml.matchAll(/<value\s*>([^<]*)<\/value\s*>/g)) {
    const [label, id] = unescapeXml(raw).trim().split('|');
    if (id !== undefined) labels.set(id.trim(), label.trim());
  }
  return labels;
}

/** sample -> the fastq_1 values of its samplesheet rows. */
function sheetRuns(csv) {
  const runs = new Map();
  for (const row of csv.split(/\r?\n/).slice(1).filter((l) => l.trim())) {
    const [sample, run] = row.split(',').map((c) => c.trim());
    runs.set(sample, new Set([...(runs.get(sample) ?? []), run]));
  }
  return runs;
}

const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
const list = (set) => [...set].join(',') || 'none';

/** checkCurated (sample IDs), plus each sample's label and runs across every file that names them. */
export const consistency = {
  name: NAME,
  tools: [],
  async run({ proposalDir, manifest }) {
    const curated = checkCurated(proposalDir);
    if (curated.length) return curated.map((m) => error(m));
    const annotations = readCuratedJson(proposalDir, annotationsFile(manifest));
    const sra = (readDataset(proposalDir).source ?? { type: 'sra' }).type === 'sra';
    return manifest.organisms.flatMap(({ proposedOrganismAbbrev: p }) => {
      const dir = join(proposalDir, 'curated', p);
      const tsv = tsvRows(readFileSync(join(dir, 'entity-sample.tsv'), 'utf-8'));
      const idColumn = Object.keys(tsv[0] ?? {})[0];
      const labels = configLabels(readFileSync(join(dir, 'analysisConfig.xml'), 'utf-8'));
      const runs = sheetRuns(readFileSync(join(dir, 'samplesheet.csv'), 'utf-8'));
      const found = [];
      for (const s of samplesFor(annotations, manifest, p)) {
        const row = tsv.find((r) => r[idColumn] === s.sampleId);
        const seen = { annotations: s.label, 'analysisConfig.xml': labels.get(s.sampleId), 'entity-sample.tsv': row?.label };
        if (new Set(Object.values(seen)).size > 1) {
          found.push(error(`${s.sampleId} has different labels: ${Object.entries(seen).map(([f, l]) => `${f} "${l}"`).join(', ')}`, p));
        }
        if (!sra) continue;
        const fromAnnotations = new Set(s.runs ?? []);
        const fromSheet = runs.get(s.sampleId) ?? new Set();
        const fromTsv = new Set((row?.[SRA_COLUMN] ?? '').split(',').map((r) => r.trim()).filter(Boolean));
        if (!sameSet(fromAnnotations, fromSheet) || !sameSet(fromAnnotations, fromTsv)) {
          found.push(error(`${s.sampleId} has different runs: annotations ${list(fromAnnotations)}, samplesheet.csv ${list(fromSheet)}, entity-sample.tsv ${list(fromTsv)}`, p));
        }
      }
      return found;
    });
  }
};
```

- [ ] **Step 5: Run them**

Run: `node --test tests/validators-bulk-rnaseq.test.js tests/dataset-types.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add shared/scripts/dataset-types/bulk-rnaseq.js shared/scripts/dataset-types/bulk-rnaseq/validators/consistency.js tests/validators-bulk-rnaseq.test.js
git commit -m "bulk-rnaseq validator: labels and runs agree across files"
```

---

### Task 8: perlParse and stf validators

**Files:**
- Create: `shared/scripts/dataset-types/bulk-rnaseq/validators/perl-parse.js`, `.../stf.js`
- Test: `tests/validators-bulk-rnaseq.test.js`

- [ ] **Step 1: Write the failing tests** (append; add imports of `perlParse` and `stf`)

```js
import { perlParse } from '../shared/scripts/dataset-types/bulk-rnaseq/validators/perl-parse.js';
import { stf } from '../shared/scripts/dataset-types/bulk-rnaseq/validators/stf.js';

const acd = { libDir: '/acd/Load/lib/perl', perl: '/usr/bin/perl', version: 'c0ffee' };
const parsedAs = (parsed) => () => JSON.stringify(parsed);
const fixtureParse = {
  steps: [{ class: 'ApiCommonData::Load::RnaSeqAnalysisEbi', arguments: { profileSetName: 'Testus fakeus stress & recovery' } }],
  groups: [{ displayName: 'Control', samples: ['SAMN1'] }, { displayName: 'Stressed', samples: ['SAMN2'] }]
};

test('perlParse passes when the parser sees one RnaSeqAnalysisEbi step and the label groups', async () => {
  assert.deepEqual(await perlParse.run({ ...proposal(), tools: { apiCommonData: acd }, exec: parsedAs(fixtureParse) }), []);
});

test('perlParse reports a parse failure, a wrong step and different groups', async () => {
  const failing = () => { throw Object.assign(new Error('x'), { stderr: 'not well-formed (invalid token) at line 3' }); };
  const [crash] = await perlParse.run({ ...proposal(), tools: { apiCommonData: acd }, exec: failing });
  assert.equal(crash.message, 'AnalysisConfigParser could not read analysisConfig.xml: not well-formed (invalid token) at line 3');

  const [step] = await perlParse.run({ ...proposal(), tools: { apiCommonData: acd }, exec: parsedAs({ ...fixtureParse, steps: [{ class: 'Other', arguments: {} }] }) });
  assert.equal(step.message, 'expected one ApiCommonData::Load::RnaSeqAnalysisEbi step, got Other');

  const merged = { ...fixtureParse, groups: [{ displayName: 'Control', samples: ['SAMN1', 'SAMN2'] }] };
  const [groups] = await perlParse.run({ ...proposal(), tools: { apiCommonData: acd }, exec: parsedAs(merged) });
  assert.equal(groups.message, 'ApiCommonData groups the samples as Control: SAMN1, SAMN2; the annotations as Control: SAMN1 | Stressed: SAMN2');
});

test('perlParse expects the profileSetName suffix on every group display name', async () => {
  const suffixed = {
    steps: [{ class: 'ApiCommonData::Load::RnaSeqAnalysisEbi', arguments: { profileSetName: 'Heat - sense' } }],
    groups: [{ displayName: 'Control - sense', samples: ['SAMN1'] }, { displayName: 'Stressed - sense', samples: ['SAMN2'] }]
  };
  assert.deepEqual(await perlParse.run({ ...proposal(), tools: { apiCommonData: acd }, exec: parsedAs(suffixed) }), []);
});

test('stf reports what study.wrangler printed when it rejects the entity', async () => {
  const sw = { rscript: '/usr/bin/Rscript', env: {}, version: '1.0.41' };
  assert.deepEqual(await stf.run({ ...proposal(), tools: { studyWrangler: sw }, exec: () => 'Entity is valid.' }), []);
  const rejecting = () => { throw Object.assign(new Error('x'), { stdout: 'Entity is not valid: duplicate IDs' }); };
  assert.deepEqual(await stf.run({ ...proposal(), tools: { studyWrangler: sw }, exec: rejecting }), [{
    validator: 'stf', severity: 'error', organism: 'tfakST1', message: 'study.wrangler rejected entity-sample: Entity is not valid: duplicate IDs'
  }]);
});
```

- [ ] **Step 2: Run them**

Run: `node --test tests/validators-bulk-rnaseq.test.js`
Expected: FAIL, cannot find module `perl-parse.js`.

- [ ] **Step 3: Implement `perl-parse.js`**

```js
import { join } from 'node:path';
import { parseAnalysisConfig } from '../../../lib/tools/apicommondata.js';
import { readCuratedJson } from '../../_common.js';
import { samplesFor, annotationsFile } from '../../bulk-rnaseq.js';

const NAME = 'perlParse';
const STEP_CLASS = 'ApiCommonData::Load::RnaSeqAnalysisEbi';
const error = (message, organism) => ({ validator: NAME, severity: 'error', organism, message });
const describe = (groups) => [...groups].map(([name, ids]) => `${name}: ${ids.join(', ')}`).join(' | ');

/** analysisConfig.xml as ApiCommonData reads it: one RnaSeqAnalysisEbi step whose groups are the annotations' labels. */
export const perlParse = {
  name: NAME,
  tools: ['apiCommonData'],
  async run({ proposalDir, manifest, tools, exec }) {
    const annotations = readCuratedJson(proposalDir, annotationsFile(manifest));
    return manifest.organisms.flatMap(({ proposedOrganismAbbrev: p }) => {
      let parsed;
      try { parsed = parseAnalysisConfig(tools.apiCommonData, join(proposalDir, 'curated', p, 'analysisConfig.xml'), { exec }); }
      catch (e) { return [error(`AnalysisConfigParser could not read analysisConfig.xml: ${e.message}`, p)]; }
      const classes = parsed.steps.map((s) => s.class);
      if (classes.length !== 1 || classes[0] !== STEP_CLASS) return [error(`expected one ${STEP_CLASS} step, got ${classes.join(', ') || 'none'}`, p)];
      // displayAndBaseName appends a trailing " - ..." of profileSetName to every group.
      const suffix = /( - .+)$/.exec(parsed.steps[0].arguments.profileSetName ?? '')?.[1] ?? '';
      const expected = new Map();
      for (const s of samplesFor(annotations, manifest, p)) expected.set(s.label + suffix, [...(expected.get(s.label + suffix) ?? []), s.sampleId]);
      const actual = new Map(parsed.groups.map((g) => [g.displayName, g.samples]));
      const same = expected.size === actual.size
        && [...expected].every(([name, ids]) => actual.get(name)?.length === ids.length && ids.every((id) => actual.get(name).includes(id)));
      return same ? [] : [error(`ApiCommonData groups the samples as ${describe(actual)}; the annotations as ${describe(expected)}`, p)];
    });
  }
};
```

- [ ] **Step 4: Implement `stf.js`**

```js
import { join } from 'node:path';
import { validateEntity } from '../../../lib/tools/study-wrangler.js';

const NAME = 'stf';

/** Each organism's entity-sample STF files through study.wrangler's own load and validate. */
export const stf = {
  name: NAME,
  tools: ['studyWrangler'],
  async run({ proposalDir, manifest, tools, exec }) {
    return manifest.organisms.flatMap(({ proposedOrganismAbbrev: p }) => {
      const dir = join(proposalDir, 'curated', p);
      const { ok, output } = validateEntity(tools.studyWrangler, join(dir, 'entity-sample.tsv'), join(dir, 'entity-sample.yaml'), { exec });
      return ok ? [] : [{ validator: NAME, severity: 'error', organism: p, message: `study.wrangler rejected entity-sample: ${output}` }];
    });
  }
};
```

- [ ] **Step 5: Run them**

Run: `node --test tests/validators-bulk-rnaseq.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add shared/scripts/dataset-types/bulk-rnaseq/validators tests/validators-bulk-rnaseq.test.js
git commit -m "bulk-rnaseq validators: ApiCommonData parse and study.wrangler STF"
```

---

### Task 9: Registry and the PRJNA525426 fixture

**Files:**
- Create: `shared/scripts/dataset-types/validators.js`
- Create: `tests/fixtures/proposals/PRJNA525426/` (copied)
- Test: `tests/validators-bulk-rnaseq.test.js`

- [ ] **Step 1: Copy the fixture** (from John's VEuPathDatasets checkout, `master` at `2a36679c4` or later)

```bash
SRC=/home/jbrestel/workspaces/misc/VEuPathDatasets/Proposals/PRJNA525426
DST=tests/fixtures/proposals/PRJNA525426
mkdir -p $DST/inputs
cp $SRC/manifest.json $DST/
cp $SRC/inputs/PRJNA525426_sra_metadata.json $DST/inputs/
cp -r $SRC/curated $DST/
find $DST -type f | sort
```

Expected: `manifest.json`, `inputs/PRJNA525426_sra_metadata.json`, `curated/{presenter.json,dataset.json,PRJNA525426_sample_annotations.json}`, `curated/calbSC5314/{analysisConfig.xml,samplesheet.csv,entity-sample.tsv,entity-sample.yaml}`.

- [ ] **Step 2: Write the failing tests** (append)

```js
import { validatorsFor } from '../shared/scripts/dataset-types/validators.js';
import { createToolResolver } from '../shared/scripts/lib/validation-env.js';
import { runValidators } from '../shared/scripts/lib/validation.js';

const PRJNA525426 = join(fixtures, 'proposals/PRJNA525426');
const realProposal = () => ({ proposalDir: PRJNA525426, manifest: JSON.parse(readFileSync(join(PRJNA525426, 'manifest.json'), 'utf-8')) });

test('validatorsFor registers the bulk-rnaseq validators and none for genomes yet', () => {
  assert.deepEqual(validatorsFor('bulk-rnaseq').map((v) => v.name), ['libraryType', 'consistency', 'perlParse', 'stf']);
  assert.deepEqual(validatorsFor('genome-assembly'), []);
});

test('PRJNA525426: library type and consistency pass except depth, 6 samples under 1M spots', async () => {
  const lib = await libraryType.run(realProposal());
  assert.deepEqual(lib.filter((f) => f.severity !== 'error').map((f) => f.message), ['library_selection cDNA (6 runs)']);
  assert.equal(lib.filter((f) => f.severity === 'error').length, 6);
  assert.ok(lib.filter((f) => f.severity === 'error').every((f) => /spots in SRR866\d+; at least 1,000,000 are needed/.test(f.message)));
  assert.deepEqual(await consistency.run(realProposal()), []);
});

test('PRJNA525426: ApiCommonData and study.wrangler accept it', { skip: !process.env.VALIDATION_WORKSPACE && 'VALIDATION_WORKSPACE is not set' }, async () => {
  const tools = createToolResolver(process.env.VALIDATION_WORKSPACE);
  const findings = await runValidators([perlParse, stf], realProposal(), tools.resolveTool);
  assert.deepEqual(findings, []);
});
```

- [ ] **Step 3: Run them**

Run: `node --test tests/validators-bulk-rnaseq.test.js`
Expected: FAIL, cannot find module `validators.js`.

- [ ] **Step 4: Implement `shared/scripts/dataset-types/validators.js`**

```js
import { libraryType } from './bulk-rnaseq/validators/library-type.js';
import { consistency } from './bulk-rnaseq/validators/consistency.js';
import { perlParse } from './bulk-rnaseq/validators/perl-parse.js';
import { stf } from './bulk-rnaseq/validators/stf.js';

// A type with validators must have a current, non-failing report before mark-ready.
const VALIDATORS = { 'bulk-rnaseq': [libraryType, consistency, perlParse, stf] };

export const validatorsFor = (datasetType) => VALIDATORS[datasetType] ?? [];
```

- [ ] **Step 5: Run them**

Run: `node --test tests/validators-bulk-rnaseq.test.js`
Expected: PASS (the real-tool test skipped without `VALIDATION_WORKSPACE`).

- [ ] **Step 6: Commit**

```bash
git add shared/scripts/dataset-types/validators.js tests/fixtures/proposals/PRJNA525426 tests/validators-bulk-rnaseq.test.js
git commit -m "Validator registry; PRJNA525426 fixture"
```

---

### Task 10: buildFitness against a ref

**Files:**
- Modify: `shared/scripts/lib/load-ops.js` (export `withSettledProposal`)
- Create: `shared/scripts/lib/build-fitness.js`
- Test: `tests/build-fitness.test.js`

- [ ] **Step 1: Write the failing tests** (`tests/build-fitness.test.js`)

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createGit } from '../shared/scripts/lib/git-ops.js';
import { buildFitness } from '../shared/scripts/lib/build-fitness.js';
import { insertPresenter } from '../shared/scripts/lib/presenter-file.js';
import { renderPresenter } from '../shared/scripts/dataset-types/bulk-rnaseq.js';
import { fixtures, initRepo } from './helpers.js';

const PRESENTERS = 'Model/lib/xml/datasetPresenters/FungiDB.xml';

/** origin/rebuild02 with the fixture organism file and an empty FungiDB presenter file; the proposal in a scratch dir. */
function setup({ presenterFile = '<?xml version="1.0"?>\n<datasetPresenters>\n</datasetPresenters>\n' } = {}) {
  const { repo } = initRepo('build-fitness-');
  writeFileSync(join(repo, PRESENTERS), presenterFile);
  execFileSync('git', ['-C', repo, 'add', '-A']);
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'presenters']);
  execFileSync('git', ['-C', repo, 'push', '-q', 'origin', 'HEAD:rebuild02']);
  execFileSync('git', ['-C', repo, 'fetch', '-q']);
  const proposalDir = join(mkdtempSync(join(tmpdir(), 'build-fitness-p-')), 'PRJNA000002');
  cpSync(join(fixtures, 'proposals/PRJNA000002'), proposalDir, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(proposalDir, 'manifest.json'), 'utf-8'));
  return { git: createGit(repo), proposalDir, manifest };
}

test('buildFitness passes a proposal that would load on the ref', async () => {
  const ctx = setup();
  assert.deepEqual(await buildFitness({ ...ctx, against: 'origin/rebuild02' }), []);
});

test('buildFitness reports a presenter name already on the ref', async () => {
  const proposalDir = join(fixtures, 'proposals/PRJNA000002');
  const taken = insertPresenter('<?xml version="1.0"?>\n<datasetPresenters>\n</datasetPresenters>\n', renderPresenter(proposalDir, { build: '02' }));
  const ctx = setup({ presenterFile: taken });
  const findings = await buildFitness({ ...ctx, against: 'origin/rebuild02' });
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /already exists in Model\/lib\/xml\/datasetPresenters\/FungiDB\.xml on origin\/rebuild02/);
});

test('buildFitness reports an organism that does not settle on the ref', async () => {
  const ctx = setup();
  ctx.manifest = { ...ctx.manifest, organisms: [{ proposedOrganismAbbrev: 'nobody1', source: 'loaded', project: 'FungiDB' }] };
  const findings = await buildFitness({ ...ctx, against: 'origin/rebuild02' });
  assert.ok(findings.length >= 1);
  assert.ok(findings.every((f) => f.validator === 'buildFitness' && f.severity === 'error'));
  assert.match(findings[0].message, /^nobody1: /);
});
```

- [ ] **Step 2: Run them**

Run: `node --test tests/build-fitness.test.js`
Expected: FAIL, cannot find module.

- [ ] **Step 3: Export `withSettledProposal` in `load-ops.js`**

Change `async function withSettledProposal(` to `export async function withSettledProposal(`.

- [ ] **Step 4: Implement `shared/scripts/lib/build-fitness.js`**

```js
import { readOrganismIndex, pendingGenomeProposals, genomeOrganismOf, settleOrganisms } from './organisms.js';
import { presenterFileRelativePath, presenterNameExists } from './presenter-file.js';
import { datasetFileRelativePath, datasetNameExists, namePatternClash } from './dataset-file.js';
import { homeProject } from './manifest.js';
import { loadDatasetType } from '../dataset-types/_common.js';
import { withSettledProposal } from './load-ops.js';

const NAME = 'buildFitness';

/**
 * The load checks, read from a ref through git instead of a checkout: every
 * organism settles, the presenter name and dataset names are free, and each
 * organism's dataset file exists. Never changes the checkout.
 */
export async function buildFitness({ git, manifest, proposalDir, against }) {
  const findings = [];
  const error = (message) => findings.push({ validator: NAME, severity: 'error', message });
  const { organisms, stops } = settleOrganisms(manifest, {
    index: readOrganismIndex(git, against),
    claims: pendingGenomeProposals(git, [against, 'origin/master']),
    genomeOf: (accession) => genomeOrganismOf(git, against, accession) ?? genomeOrganismOf(git, 'origin/master', accession),
    settle: {}
  });
  stops.forEach(error);
  if (stops.length) return findings;

  const datasetType = await loadDatasetType(manifest.datasetType);
  const names = await withSettledProposal(proposalDir, manifest, organisms, async (dir) => datasetType.presenterNames(dir));
  const presenters = presenterFileRelativePath(homeProject(manifest));
  if (!git.fileExistsOnRef(against, presenters)) error(`${presenters} is missing on ${against}`);
  else {
    const file = git.showFile(against, presenters);
    for (const name of names) if (presenterNameExists(file, name)) error(`Presenter "${name}" already exists in ${presenters} on ${against}`);
  }
  if (datasetType.datasetClass) {
    const abbrevs = organisms.map((o) => o.abbrev);
    manifest.organisms.forEach((o, i) => {
      const rel = datasetFileRelativePath(o.project, abbrevs[i]);
      if (!git.fileExistsOnRef(against, rel)) error(`${rel} is missing on ${against}`);
      else if (datasetNameExists(git.showFile(against, rel), manifest.datasetClass, manifest.name)) error(`${rel} on ${against} already has a ${manifest.datasetClass} named "${manifest.name}"`);
    });
    const clash = namePatternClash(git, against, datasetType, { className: manifest.datasetClass, name: manifest.name, organisms: abbrevs });
    if (clash) error(clash);
  }
  return findings;
}

export const buildFitnessValidator = { name: NAME, tools: [], run: (ctx) => buildFitness(ctx) };
```

- [ ] **Step 5: Run them**

Run: `node --test tests/build-fitness.test.js tests/load-ops.test.js`
Expected: PASS. If the settlement stop for `nobody1` is phrased differently, keep the `/^nobody1: /` assertion: `settleOrganisms` prefixes every stop with the proposed abbreviation.

- [ ] **Step 6: Commit**

```bash
git add shared/scripts/lib/build-fitness.js shared/scripts/lib/load-ops.js tests/build-fitness.test.js
git commit -m "buildFitness: load checks read from a ref"
```

---

### Task 11: validateProposal

**Files:**
- Modify: `shared/scripts/lib/verification-ops.js` (`verifiableTicket` exported, returns `{ ticket, manifest }`)
- Create: `shared/scripts/lib/validation-ops.js`
- Test: `tests/validation-ops.test.js`

- [ ] **Step 1: Write the failing tests** (`tests/validation-ops.test.js`)

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createGit } from '../shared/scripts/lib/git-ops.js';
import { validateProposal, contentValidation, reportPath } from '../shared/scripts/lib/validation-ops.js';
import { parseReportComment } from '../shared/scripts/lib/validation.js';
import { fixtures, initRepo, stubTicket, stubGh } from './helpers.js';

const TICKET = { system: 'github', id: '43', url: 'https://r/issues/43' };

/** A proposal merged to origin/master with a ticket, no update open. */
function setupMerged(accession = 'PRJNA000002') {
  const { repo } = initRepo('validation-ops-');
  const dir = join(repo, 'Proposals', accession);
  cpSync(join(fixtures, 'proposals', accession), dir, { recursive: true });
  const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf-8'));
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ ...m, ticket: TICKET }, null, 2) + '\n');
  execFileSync('git', ['-C', repo, 'add', '-A']);
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', `merge ${accession}`]);
  execFileSync('git', ['-C', repo, 'push', '-q']);
  return { repo, git: createGit(repo, { exec: stubGh().exec }) };
}

const careful = [{ name: 'careful', tools: [], run: async () => [{ validator: 'careful', severity: 'warning', message: 'thin reads' }] }];

test('validateProposal writes the report, posts it on the ticket and names the proposal tree', async () => {
  const { repo, git } = setupMerged();
  const ticket = stubTicket();
  const { report, path } = await validateProposal({ git, ticket, repoPath: repo, accession: 'PRJNA000002', validators: careful });
  assert.equal(report.verdict, 'needs-review');
  assert.equal(report.proposalTree, git.treeHash('origin/master', 'Proposals/PRJNA000002'));
  assert.equal(path, reportPath(repo, 'PRJNA000002'));
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf-8')), report);
  assert.deepEqual(parseReportComment(ticket.notes.at(-1)), report);
});

test('post: false keeps the report local', async () => {
  const { repo, git } = setupMerged();
  const ticket = stubTicket();
  await validateProposal({ git, ticket, repoPath: repo, accession: 'PRJNA000002', validators: careful, post: false });
  assert.deepEqual(ticket.notes, []);
});

test('validators see the proposal as origin/master has it, not the working tree', async () => {
  const { repo, git } = setupMerged();
  writeFileSync(join(repo, 'Proposals/PRJNA000002/curated/dataset.json'), '{}');
  let seen;
  const peek = [{ name: 'peek', tools: [], run: async ({ proposalDir }) => { seen = readFileSync(join(proposalDir, 'curated/dataset.json'), 'utf-8'); return []; } }];
  await validateProposal({ git, ticket: stubTicket(), repoPath: repo, accession: 'PRJNA000002', validators: peek, post: false });
  assert.match(seen, /"limitNU"/);
});

test('without a workspace the tool validators cannot verify, so the verdict is fail', async () => {
  const { repo, git } = setupMerged();
  const { report } = await validateProposal({ git, ticket: stubTicket(), repoPath: repo, accession: 'PRJNA000002', post: false });
  assert.equal(report.verdict, 'fail');
  assert.equal(report.workspace, null);
  for (const v of ['perlParse', 'stf']) {
    assert.ok(report.findings.some((f) => f.validator === v && /could not verify: No validation workspace given; ask the data loader/.test(f.message)), v);
  }
});

test('a missing --against ref is refused before any validator runs', async () => {
  const { repo, git } = setupMerged();
  await assert.rejects(validateProposal({ git, ticket: stubTicket(), repoPath: repo, accession: 'PRJNA000002', against: 'origin/rebuild99', validators: careful }),
    /origin\/rebuild99 does not exist/);
});

test('a type without validators is refused', async () => {
  const { repo, git } = setupMerged('GCA_000001.1');
  await assert.rejects(validateProposal({ git, ticket: stubTicket(), repoPath: repo, accession: 'GCA_000001.1' }),
    /No validators for datasetType "genome-assembly"; verify GCA_000001\.1 by hand/);
});

test('contentValidation runs the type validators on a directory', async () => {
  const proposalDir = join(fixtures, 'proposals/PRJNA000002');
  const manifest = JSON.parse(readFileSync(join(proposalDir, 'manifest.json'), 'utf-8'));
  const findings = await contentValidation({ workspace: undefined })({ proposalDir, manifest });
  assert.ok(findings.some((f) => f.validator === 'perlParse' && f.severity === 'error'));
  assert.ok(findings.every((f) => f.validator !== 'buildFitness'));
});
```

- [ ] **Step 2: Run them**

Run: `node --test tests/validation-ops.test.js`
Expected: FAIL, cannot find module.

- [ ] **Step 3: `verification-ops.js`: export `verifiableTicket`, return the manifest too**

Change the function head to `export function verifiableTicket(git, accession, refusal) {` and its last line from `return manifest.ticket;` to `return { ticket: manifest.ticket, manifest };`. Update its doc comment to "The ticket and manifest of a merged proposal ...". In `startVerification` change `const ref = verifiableTicket(...)` to `const { ticket: ref } = verifiableTicket(...)`; in `markReady` the same (Task 13 changes it again).

- [ ] **Step 4: Implement `shared/scripts/lib/validation-ops.js`**

```js
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { proposalRelativePath } from './manifest.js';
import { verifiableTicket } from './verification-ops.js';
import { validatorsFor } from '../dataset-types/validators.js';
import { runValidators, verdictOf, formatReportComment, REPORT_SCHEMA_VERSION } from './validation.js';
import { createToolResolver } from './validation-env.js';
import { buildFitnessValidator } from './build-fitness.js';
import { excludeScratch, SCRATCH_DIR } from './config.js';

export const reportPath = (repoPath, accession) => join(repoPath, SCRATCH_DIR, 'tmp', 'verify', `${accession}.json`);

/**
 * Validates a merged proposal as origin/master has it, with the tools of the
 * workspace the data loader named, plus buildFitness when against names a ref.
 * Writes the report under .curation/tmp/verify/ and, unless post is false,
 * posts it on the ticket for mark-ready. Returns { report, path, ticket }.
 */
export async function validateProposal({ git, ticket, repoPath, accession, workspace, against = null, post = true, exec, validators }) {
  const { ticket: ref, manifest } = verifiableTicket(git, accession, 'it is not validated');
  const chosen = validators ?? validatorsFor(manifest.datasetType);
  if (!chosen.length) throw new Error(`No validators for datasetType "${manifest.datasetType}"; verify ${accession} by hand`);
  if (against && !git.refExists(against)) throw new Error(`${against} does not exist; fetch it or name another ref`);
  const tools = createToolResolver(workspace, { exec });
  const relDir = proposalRelativePath(accession);
  const scratch = mkdtempSync(join(tmpdir(), 'validate-'));
  let findings;
  try {
    git.exportTree('origin/master', relDir, scratch);
    const ctx = { proposalDir: join(scratch, relDir), manifest, git, against, exec };
    findings = await runValidators([...chosen, ...(against ? [buildFitnessValidator] : [])], ctx, tools.resolveTool);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  const report = {
    schemaVersion: REPORT_SCHEMA_VERSION, accession, datasetType: manifest.datasetType,
    proposalTree: git.treeHash('origin/master', relDir), against, workspace: tools.workspace,
    tools: tools.versions(), findings, verdict: verdictOf(findings)
  };
  excludeScratch(repoPath);
  const path = reportPath(repoPath, accession);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(report, null, 2) + '\n');
  if (post) await ticket.comment(ref, formatReportComment(report));
  return { report, path, ticket: ref };
}

/** For load: validate({ proposalDir, manifest }) runs the content validators of the proposal's type. */
export function contentValidation({ workspace, exec }) {
  const tools = createToolResolver(workspace, { exec });
  return ({ proposalDir, manifest }) => runValidators(validatorsFor(manifest.datasetType), { proposalDir, manifest, exec }, tools.resolveTool);
}
```

- [ ] **Step 5: Run them**

Run: `node --test tests/validation-ops.test.js tests/proposal-ops.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add shared/scripts/lib/validation-ops.js shared/scripts/lib/verification-ops.js tests/validation-ops.test.js
git commit -m "validateProposal: validate origin/master, write and post the report"
```

---

### Task 12: validate-proposal.js

**Files:**
- Create: `shared/scripts/validate-proposal.js`

- [ ] **Step 1: Write the CLI**

```js
#!/usr/bin/env node
/**
 * validate-proposal.js - Runs every validator for a merged proposal's dataset
 * type with the tools of the validation workspace the data loader names,
 * prints the findings, keeps the report under .curation/tmp/verify/ and posts
 * it on the ticket, where mark-ready reads it. Exits 1 when the verdict is fail.
 *
 * Usage: node validate-proposal.js --workspace <dir> [--against <ref>] [--no-post] <accession>
 */
import { parseArgs } from 'node:util';
import { openWorkspace } from './lib/config.js';
import { createGit } from './lib/git-ops.js';
import { createTicketClient } from './lib/ticket/index.js';
import { validateProposal } from './lib/validation-ops.js';
import { formatFinding } from './lib/validation.js';

const USAGE = 'Usage: node validate-proposal.js --workspace <dir> [--against <ref>] [--no-post] <accession>';

async function main() {
  const { values, positionals } = parseArgs({
    options: { workspace: { type: 'string' }, against: { type: 'string' }, 'no-post': { type: 'boolean', default: false } }, allowPositionals: true
  });
  const [accession] = positionals;
  if (!accession || positionals.length !== 1) { console.error(USAGE); process.exit(1); }
  if (!values.workspace) { console.error(`--workspace is required: ask the data loader which validation workspace to use.\n${USAGE}`); process.exit(1); }
  const config = openWorkspace();
  const ticket = createTicketClient(config);
  const { report, path, ticket: ref } = await validateProposal({
    git: createGit(config.repoPath), ticket, repoPath: config.repoPath, accession,
    workspace: values.workspace, against: values.against ?? null, post: !values['no-post']
  });
  for (const f of report.findings) console.log(formatFinding(f));
  console.log(`Verdict: ${report.verdict}`);
  console.log(`Tools:   ${Object.entries(report.tools).map(([n, v]) => `${n} ${v}`).join(', ') || 'none resolved'}`);
  console.log(`Report:  ${path}`);
  console.log(values['no-post'] ? 'Not posted (--no-post).' : `Posted:  ${ref.url}`);
  if (report.verdict === 'fail') process.exit(1);
}

main().catch(err => { console.error(`Error: ${err.message}`); process.exit(1); });
```

- [ ] **Step 2: Check the argument handling**

Run: `node shared/scripts/validate-proposal.js PRJNA525426`
Expected: `--workspace is required: ask the data loader which validation workspace to use.` and exit 1.

- [ ] **Step 3: Commit**

```bash
git add shared/scripts/validate-proposal.js
git commit -m "validate-proposal.js"
```

---

### Task 13: mark-ready gate

**Files:**
- Modify: `shared/scripts/lib/verification-ops.js` (`markReady`), `shared/scripts/mark-ready.js`
- Test: `tests/validation-ops.test.js`

- [ ] **Step 1: Write the failing tests** (append; add `markReady` from `verification-ops.js` and `formatReportComment`, `verifiedComment` from `validation.js` to the imports)

```js
const reportFor = (git, verdict, findings = [], tree) => ({
  schemaVersion: 1, accession: 'PRJNA000002', datasetType: 'bulk-rnaseq',
  proposalTree: tree ?? git.treeHash('origin/master', 'Proposals/PRJNA000002'), against: null, workspace: '/ws',
  tools: { apiCommonData: 'c0ffee', studyWrangler: '1.0.41' }, findings, verdict
});
const setsStatus = (ticket) => ticket.calls.some((c) => c[0] === 'setStatus');

test('markReady refuses a validated type with no report on the ticket', async () => {
  const { git } = setupMerged();
  const ticket = stubTicket({ status: 'verifying' });
  await assert.rejects(markReady({ git, ticket, accession: 'PRJNA000002' }), /has no verification report; run validate-proposal\.js PRJNA000002 first/);
  assert.equal(setsStatus(ticket), false);
});

test('markReady refuses a report for an earlier version of the proposal', async () => {
  const { git } = setupMerged();
  const ticket = stubTicket({ status: 'verifying', existingComments: [formatReportComment(reportFor(git, 'pass', [], '0'.repeat(40)))] });
  await assert.rejects(markReady({ git, ticket, accession: 'PRJNA000002' }), /is for an earlier version of PRJNA000002; run validate-proposal\.js PRJNA000002 again/);
  assert.equal(setsStatus(ticket), false);
});

test('markReady refuses a failing latest report, and accepts a later passing one', async () => {
  const { git } = setupMerged();
  const failed = formatReportComment(reportFor(git, 'fail', [{ validator: 'stf', severity: 'error', message: 'bad' }]));
  await assert.rejects(markReady({ git, ticket: stubTicket({ status: 'proposed', existingComments: [failed] }), accession: 'PRJNA000002' }),
    /latest verification report on .* failed; send it back with request-revision\.js/);
  const fixed = stubTicket({ status: 'proposed', existingComments: [failed, formatReportComment(reportFor(git, 'pass'))] });
  await markReady({ git, ticket: fixed, accession: 'PRJNA000002' });
  assert.deepEqual(fixed.calls.filter((c) => c[0] === 'setStatus'), [['setStatus', '43', 'ready']]);
});

test('markReady records the report, accepted warnings and the note', async () => {
  const { git } = setupMerged();
  const r = reportFor(git, 'needs-review', [{ validator: 'libraryType', severity: 'warning', message: 'DNBSEQ (SRR1): adapters' }]);
  const ticket = stubTicket({ status: 'verifying', existingComments: [formatReportComment(r)] });
  const result = await markReady({ git, ticket, accession: 'PRJNA000002', note: ' presenter read ' });
  assert.equal(ticket.notes.at(-1), verifiedComment(r, 'presenter read'));
  assert.deepEqual(result.report, r);
});
```

- [ ] **Step 2: Run them**

Run: `node --test tests/validation-ops.test.js`
Expected: FAIL; `markReady` sets ready without a report.

- [ ] **Step 3: Implement in `verification-ops.js`**

Add to the imports:

```js
import { readOnRef, readWorkingTreeTicket, proposalBranch, proposalRelativePath, MANIFEST_FILENAME, PROPOSALS_DIR } from './manifest.js';
import { validatorsFor } from '../dataset-types/validators.js';
import { latestReport, verifiedComment } from './validation.js';
```

(the first line replaces the existing `./manifest.js` import). Replace `markReady` and add `currentReport` above it:

```js
/** The latest report on the ticket, refused when absent, stale or failing. */
async function currentReport(git, ticket, ref, accession) {
  const again = `run validate-proposal.js ${accession}`;
  const report = latestReport(await ticket.listComments(ref));
  if (!report) throw new Error(`The ticket ${ref.url} has no verification report; ${again} first`);
  if (report.proposalTree !== git.treeHash('origin/master', proposalRelativePath(accession))) {
    throw new Error(`The latest verification report on ${ref.url} is for an earlier version of ${accession}; ${again} again`);
  }
  if (report.verdict === 'fail') {
    throw new Error(`The latest verification report on ${ref.url} failed; send it back with request-revision.js, or ${again} again once the validation workspace is fixed`);
  }
  return report;
}

/**
 * Records that a person verified a merged proposal and sets the ticket `ready`,
 * the only status load accepts. For a dataset type with validators it needs a
 * current, non-failing report on the ticket, and its comment carries that
 * report's verdict, tools and the warnings the person accepted. Returns { ticket, status, notice, report }.
 */
export async function markReady({ git, ticket, accession, note }) {
  const { ticket: ref, manifest } = verifiableTicket(git, accession, 'it is not marked ready');
  const { status, notice } = resolveDraft(git, ticket, accession, await ticket.getStatus(ref), true, 'it is not marked ready');
  if (!UNVERIFIED_STATUSES.includes(status)) {
    throw new Error(`The ticket ${ref.url} is at "${ticket.statusOption(status)}"; only a ${quoteOptions(ticket, UNVERIFIED_STATUSES)} proposal can be marked ready`);
  }
  const report = validatorsFor(manifest.datasetType).length ? await currentReport(git, ticket, ref, accession) : null;
  const why = (note ?? '').trim();
  const comment = report ? verifiedComment(report, why) : why ? `Verified: ${why}` : null;
  if (comment) await ticket.commentOnce(ref, comment);
  await ticket.setStatus(ref, 'ready');
  return { ticket: ref, status: 'ready', notice, report };
}
```

- [ ] **Step 4: `mark-ready.js` prints the report it relied on**

After `if (result.notice) ...` add:

```js
  if (result.report) console.log(`Report: ${result.report.verdict} (${Object.entries(result.report.tools).map(([n, v]) => `${n} ${v}`).join(', ')})`);
```

- [ ] **Step 5: Run all tests**

Run: `node --test tests/*.test.js`
Expected: PASS; the existing genome `markReady` tests in `proposal-ops.test.js` are unchanged because genomes have no validators.

- [ ] **Step 6: Commit**

```bash
git add shared/scripts/lib/verification-ops.js shared/scripts/mark-ready.js tests/validation-ops.test.js
git commit -m "mark-ready needs a current, non-failing verification report"
```

---

### Task 14: Load re-runs the content validators

**Files:**
- Modify: `shared/scripts/lib/load-ops.js`, `shared/scripts/load-proposal.js`
- Test: `tests/load-ops.test.js`

- [ ] **Step 1: Thread `validate` through the existing tests**

Add after `const REBUILD = 'rebuild02';`:

```js
const noFindings = async () => [];
```

```bash
sed -i 's/rebuildBranch: REBUILD, /rebuildBranch: REBUILD, validate: noFindings, /' tests/load-ops.test.js
```

- [ ] **Step 2: Write the failing tests** (append)

```js
test('a load is refused before any branch when content validation reports an error', async () => {
  const { repo } = setupRepo();
  const git = createGit(repo);
  const failing = async () => [{ validator: 'libraryType', severity: 'error', message: 'OXFORD_NANOPORE (SRR1) is not a short-read platform' }];
  await assert.rejects(loadProposal({ git, ticket: tickets(), repoPath: repo, rebuildBranch: REBUILD, validate: failing, accession: 'GCA_000001.1' }),
    /Validation of GCA_000001\.1 failed; request a revision, or fix the validation workspace:\n {2}- ERROR \[libraryType\] OXFORD_NANOPORE/);
  assert.equal(git.branchExists('load/GCA_000001.1'), false);
});

test('validation warnings do not stop a load', async () => {
  const { repo } = setupRepo();
  const warn = async () => [{ validator: 'libraryType', severity: 'warning', message: 'DNBSEQ' }];
  const result = await loadProposal({ git: createGit(repo), ticket: tickets(), repoPath: repo, rebuildBranch: REBUILD, validate: warn, accession: 'GCA_000001.1', dryRun: true });
  assert.equal(result.dryRun, true);
});

test('a load without validate is refused', async () => {
  const { repo } = setupRepo();
  await assert.rejects(checkLoadPreconditions({ git: createGit(repo), ticket: tickets(), repoPath: repo, rebuildBranch: REBUILD, accession: 'GCA_000001.1' }),
    /validate is required: content validation runs before every load/);
});

test('validation sees the proposal directory and manifest it loads', async () => {
  const { repo } = setupRepo();
  let seen;
  const peek = async ({ proposalDir, manifest }) => { seen = { proposalDir, accession: manifest.accession }; return []; };
  await loadProposal({ git: createGit(repo), ticket: tickets(), repoPath: repo, rebuildBranch: REBUILD, validate: peek, accession: 'GCA_000001.1', dryRun: true });
  assert.equal(seen.accession, 'GCA_000001.1');
  assert.equal(seen.proposalDir, join(repo, 'Proposals/GCA_000001.1'));
});
```

- [ ] **Step 3: Run them**

Run: `node --test tests/load-ops.test.js`
Expected: FAIL on the four new tests.

- [ ] **Step 4: Implement in `load-ops.js`**

Add to the imports:

```js
import { formatFinding } from './validation.js';
```

In `checkLoadPreconditions`, add `validate` to the destructured arguments and, right after `assertRebuildBranch(rebuildBranch);`:

```js
  if (typeof validate !== 'function') throw new Error('validate is required: content validation runs before every load');
```

Pass `validate` as a new last argument to both `renderAndCheck` calls in `checkLoadPreconditions`:

```js
    const rendered = await renderAndCheck(git, manifest, proposalDir, presenterPath, repoPath, build, settled, validate);
```

```js
    (dir) => renderAndCheck(git, manifest, dir, presenterPath, repoPath, build, settled, validate));
```

Add above `renderAndCheck`:

```js
/** Runs the content validators; any error stops the load before anything changes. */
async function assertValidContent(validate, proposalDir, manifest) {
  const errors = (await validate({ proposalDir, manifest })).filter((f) => f.severity === 'error');
  if (errors.length) {
    throw new Error(`Validation of ${manifest.accession} failed; request a revision, or fix the validation workspace:\n  - ${errors.map(formatFinding).join('\n  - ')}`);
  }
}
```

Change `renderAndCheck`:

```js
async function renderAndCheck(git, manifest, proposalDir, presenterPath, repoPath, build, settled, validate) {
  await assertValidContent(validate, proposalDir, manifest);
  return withSettledProposal(proposalDir, manifest, settled, async (dir, m) => {
```

(the rest of its body unchanged). In `loadProposal`, add `validate` to the destructured arguments, pass it to `checkLoadPreconditions({ ..., validate, ... })`, and pass it as the last argument to the post-cherry-pick `renderAndCheck(git, onBranch, proposalDir, presenterPath, repoPath, build, pre.settled, validate)`.

- [ ] **Step 5: `load-proposal.js` takes `--workspace`**

Add the import `import { contentValidation } from './lib/validation-ops.js';`, the option `workspace: { type: 'string' }`, `[--workspace <dir>]` to the usage strings, and pass `validate: contentValidation({ workspace: values.workspace })` to `loadProposal`. Header comment, after the first paragraph:

```
 * --workspace is the validation workspace the data loader names; the content
 * validators run before anything changes and any error stops the load.
```

- [ ] **Step 6: Run all tests**

Run: `node --test tests/*.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add shared/scripts/lib/load-ops.js shared/scripts/load-proposal.js tests/load-ops.test.js
git commit -m "Load re-runs the content validators and refuses on any error"
```

---

### Task 15: The skill, the sync, the docs

**Files:**
- Create: `skills/verify-bulk-rnaseq/SKILL.md`
- Modify: `package.json` (`sharedFiles`), `skills/load-proposals/SKILL.md`, `skills/load-proposals/resources/preconditions.md`, `shared/resources/proposal-workflow.md`, `CLAUDE.md`

- [ ] **Step 1: `package.json` `sharedFiles`**

1. Add `"verify-bulk-rnaseq"` to every entry whose list contains `"load-proposals"` (its closure covers what the verify scripts import).
2. Remove `"propose-genome-assembly"` and `"propose-bulk-rnaseq"` from `scripts/start-verification.js`, `scripts/mark-ready.js`, `scripts/request-revision.js`, `scripts/lib/verification-ops.js`: curators do not verify their own proposals.
3. Add these entries, each with `["verify-bulk-rnaseq", "load-proposals"]`:

```
scripts/validate-proposal.js
scripts/lib/validation.js
scripts/lib/validation-env.js
scripts/lib/validation-ops.js
scripts/lib/build-fitness.js
scripts/lib/tools/exec.js
scripts/lib/tools/apicommondata.js
scripts/lib/tools/apicommondata-parse.pl
scripts/lib/tools/study-wrangler.js
scripts/lib/tools/study-wrangler-validate.R
scripts/dataset-types/validators.js
scripts/dataset-types/bulk-rnaseq/validators/library-type.js
scripts/dataset-types/bulk-rnaseq/validators/consistency.js
scripts/dataset-types/bulk-rnaseq/validators/perl-parse.js
scripts/dataset-types/bulk-rnaseq/validators/stf.js
```

4. Remove the synced copies the propose skills no longer get, then sync:

```bash
git rm -q skills/propose-{genome-assembly,bulk-rnaseq}/scripts/{start-verification,mark-ready,request-revision}.js \
  skills/propose-{genome-assembly,bulk-rnaseq}/scripts/lib/verification-ops.js
yarn sync-shared
node --test tests/skill-imports.test.js
```

Expected: `skill-imports` PASS. A failure names a missing import (`skills/verify-bulk-rnaseq/scripts/... imports ./x.js`): add `verify-bulk-rnaseq` to that file's `sharedFiles` entry and sync again. `merge-proposal.js` and `lib/merge-ops.js` stay in the propose skills.

- [ ] **Step 2: Write `skills/verify-bulk-rnaseq/SKILL.md`**

````markdown
---
name: verify-bulk-rnaseq
description: Data loading team - verify a merged bulk RNA-seq proposal before it loads. Claims it, runs validate-proposal (library type and depth, sample labels and runs across samplesheet, analysisConfig and STF, ApiCommonData's analysisConfig parser, study-wrangler STF validation, optional build fitness) with the validation workspace the data loader names, posts the report on the ticket, reviews warnings and presenter text with the user, then mark-ready or request-revision
---

# Verify a Bulk RNA-seq Proposal

Between merge (`Proposed`) and load (`Ready to load`). The automated part is
`validate-proposal.js`; the judgment part is yours and the user's.
See [proposal workflow](resources/proposal-workflow.md) for the statuses.

## Before you start

```bash
node scripts/check-workspace.js
git fetch
```

Run from the top of a VEuPathDatasets checkout. Validation reads the proposal
from `origin/master`, so the checked-out branch does not matter.

**Ask the data loader for the validation workspace.** It is the directory
holding `validation-env.json` (paths to ApiCommonData, perl, Rscript and the
R library with study.wrangler). Never guess it, search for it, or reuse one
from an earlier conversation without asking.

## Step 1: Pick and claim

```bash
node scripts/list-proposals.js --status proposed
node scripts/start-verification.js <ACCESSION>
```

Claiming is optional; it assigns the issue to the user and sets
`Verification in progress`.

## Step 2: Validate

```bash
node scripts/validate-proposal.js --workspace <dir> <ACCESSION>
```

Add `--against origin/rebuild<RR>` when the user names a rebuild branch, to
also run the load checks (organisms settle, names free, organism dataset
files present) without checking anything out. Use `--no-post` only for a
trial run; mark-ready reads the posted report.

Verdicts: `pass`; `needs-review` (warnings: each needs the user's explicit
acceptance); `fail` (errors). Show the user every finding.

- `could not verify: ...` is a workspace problem, not a proposal problem:
  tell the data loader what is missing and re-run. Never mark ready around it.
- Depth, library type and consistency errors go back to the curator.

## Step 3: Review with the user

- Every warning in the report (the text says what can go wrong).
- The curator's notes on the ticket.
- Presenter text: `Proposals/<ACCESSION>/curated/presenter.json` on
  `origin/master` (display name, summary, description, contacts).

## Step 4: Decide

```bash
node scripts/mark-ready.js <ACCESSION> "<what was checked>"
node scripts/request-revision.js <ACCESSION> "<what the curator must fix>"
```

mark-ready refuses without a report for the current version of the proposal,
or when the latest report failed. Its comment records the verdict, tool
versions and the warnings the user accepted. A republished proposal returns
to `Proposed` and needs validating again.

## Rules

- Never pass a workspace the data loader did not name.
- Never mark ready on a `fail` verdict, and never accept a warning on the
  user's behalf.
- Never push; these scripts change only the ticket.
````

- [ ] **Step 3: `skills/load-proposals/SKILL.md`**

Replace the frontmatter `description` with:

```
description: Data loading team - bring Ready to load proposals from VEuPathDatasets Proposals/ into presenter and dataset XML on a rebuild branch, re-running content validation first, copy the curated loading artifacts out for the server, one PR per proposal, set each ticket's project Status to Loading in progress, and to Post Load QA once the load PR merges
```

In the intro paragraph replace `A person first verifies each merged proposal and marks it \`Ready to load\` or sends it back (\`Needs revision\`).` with `Proposals are verified before this skill runs (\`verify-bulk-rnaseq\`; genomes by hand for now).`

Replace everything from the line `### Step 2: Verification` up to, not including, `### Step 3: Dry run each Ready to load proposal again` with:

```markdown
### Step 2: Verification

Verification is not part of loading. Bulk RNA-seq proposals are verified with
the `verify-bulk-rnaseq` skill, which leaves a verification report on the
ticket and moves it to `Ready to load`. Genome proposals have no verify skill
yet: check them by hand (the dry run in Step 3 is the automated part), then
`node scripts/mark-ready.js <ACCESSION> "<what was checked>"` or
`node scripts/request-revision.js <ACCESSION> "<reason>"`.

```

Every `node scripts/load-proposal.js` command line gains `--workspace <dir>` after `--rebuild-branch rebuild<RR>`, and under "## Required Information" add:

```markdown
- The **validation workspace** `<dir>` (ask the data loader; never guess). Load re-runs the content validators with it and refuses on any error.
```

- [ ] **Step 4: `skills/load-proposals/resources/preconditions.md`**

Add a row after "Ticket verified":

```markdown
| Content validates | `Validation of <accession> failed` | Each line is a validator finding. `could not verify` means the validation workspace is missing a tool; ask the data loader. Anything else goes back to the curator with `request-revision.js` |
```

- [ ] **Step 5: `shared/resources/proposal-workflow.md`**

Replace item 2 of "Phase 2: loading" with:

```markdown
2. Verification: a person checks each merged proposal with its type's
   `verify-*` skill (`verify-bulk-rnaseq`; genome proposals by hand for now),
   optionally claiming it first with `start-verification.js`. For a type with
   validators, `validate-proposal.js` runs them with the validation workspace
   the data loader names and posts a report on the ticket; `mark-ready.js`
   refuses without a current, non-failing one. The outcome is `mark-ready.js`
   (`Ready to load`) or `request-revision.js` (`Needs revision`, back to the
   curator). Merging a proposal PR is not verification; it moves the ticket
   from `Initial draft` to `Proposed`.
```

In the status table, change the `Ready to load` row's "Set by" to `` `mark-ready.js`, after verification (and, for types with validators, a current report) ``.

- [ ] **Step 6: `CLAUDE.md`**

In the repository tree add, after the `propose-bulk-rnaseq` line:

```
│   ├── verify-bulk-rnaseq/                 # Verification: validate, then mark ready or send back
```

and under "Who Are You Helping?" add:

```markdown
**Data loading team verifying a proposal?**
→ Say "verify <accession>" and I'll activate the matching `verify-*` skill
```

- [ ] **Step 7: Run everything and commit**

Run: `node --test tests/*.test.js`
Expected: PASS.

```bash
git add package.json skills/ shared/resources/proposal-workflow.md CLAUDE.md
git commit -m "verify-bulk-rnaseq skill; verification leaves load-proposals and the propose skills"
```

---

### Task 16: End to end on PRJNA525426

No code. Needs John.

- [ ] **Step 1: Ask John for the validation workspace path.** Do not search for one.
- [ ] **Step 2: Run the real-tool tests**

```bash
VALIDATION_WORKSPACE=<path John gave> node --test tests/*.test.js
```

Expected: PASS with no skips.

- [ ] **Step 3: Trial run without posting** (in John's VEuPathDatasets checkout, using the synced skill scripts)

```bash
cd /home/jbrestel/workspaces/misc/VEuPathDatasets
node /home/jbrestel/workspaces/misc/dataset-curator/skills/verify-bulk-rnaseq/scripts/validate-proposal.js --workspace <path> --no-post PRJNA525426
```

Expected: six `ERROR [libraryType] ... spots in SRR866... ; at least 1,000,000 are needed` lines, `INFO [libraryType] library_selection cDNA (6 runs)`, no `perlParse`/`stf`/`consistency` findings, `Verdict: fail`, exit 1.

- [ ] **Step 4: Report to John** with the output. Posting the report on #117, and whether to send it back with `request-revision.js`, are his calls.

- [ ] **Step 5: Push and open the PR (after John says so)**

```bash
git push -u origin verify-bulk-rnaseq
env -u GITHUB_TOKEN gh pr create --base main --title "verify-bulk-rnaseq: validators, report on the ticket, mark-ready gate" --body "Spec: docs/superpowers/specs/2026-10-23-verify-bulk-rnaseq-design.md
Plan: docs/superpowers/plans/2026-10-23-verify-bulk-rnaseq.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```
