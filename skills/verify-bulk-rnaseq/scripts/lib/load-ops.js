import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  write as writeManifest, readOnRef, proposalRelativePath, organismsOf, homeProject, projectOf, projectsOf,
  MANIFEST_FILENAME, PROPOSALS_DIR
} from './manifest.js';
import { readOrganismIndex, pendingGenomeProposals, genomeOrganismOf, settleOrganisms } from './organisms.js';
import {
  presenterFilePath, presenterFileRelativePath, presenterNameExists,
  insertPresenter, extractPresenterName
} from './presenter-file.js';
import { readContactIdsOnRef, CONTACTS_RELATIVE_PATH } from './contacts.js';
import { assertClean, assertOnBranch } from './guards.js';
import { loadDatasetType } from '../dataset-types/_common.js';
import { readDatasetClass } from './dataset-classes.js';
import { datasetFilePath, datasetFileRelativePath, datasetNameExists, insertDataset, namePatternClash } from './dataset-file.js';
import { withOrganismConstants, unusedOrganismConstants } from './organism-constants.js';
import { assertStatus } from './ticket/index.js';
import { formatFinding, latestDeliveryRecord } from './validation.js';

export { PROPOSALS_DIR, proposalRelativePath };
// A dry run changes nothing, so it also serves verification before mark-ready.
const DRY_RUN_STATUSES = ['proposed', 'verifying', 'ready', 'revision'];
export const loadBranch = (accession) => `load/${accession}`;
// Build NN milestones are website releases; rebuildRR branches are database rebuilds.
const REBUILD_BRANCH = /^rebuild\d+$/;

export function assertRebuildBranch(rebuildBranch) {
  if (!REBUILD_BRANCH.test(rebuildBranch ?? '')) throw new Error(`rebuildBranch must name a rebuild branch (rebuildRR); got "${rebuildBranch}"`);
}


/**
 * Proposals on origin/master with the build and status their ticket has,
 * optionally filtered by build and status. Read-only; callers fetch first.
 * One unreadable manifest or ticket must not hide the rest, so it is reported
 * in `errors` rather than thrown.
 * Returns { proposals: [{ manifest, build, status }], errors: [{ accession, message }] }.
 */
export async function listProposals(git, { ticket, build, status } = {}) {
  if (status !== undefined) assertStatus(status);
  const proposals = [];
  const errors = [];
  const contactIds = readContactIdsOnRef(git, 'origin/master');
  for (const accession of git.listDir('origin/master', PROPOSALS_DIR)) {
    try {
      const manifest = readOnRef(git, 'origin/master', accession, { contactIds });
      if (!manifest) continue;
      const found = manifest.ticket ? await ticket.getBuild(manifest.ticket) : null;
      if (build && found !== build) continue;
      const current = manifest.ticket ? await ticket.getStatus(manifest.ticket) : null;
      if (status && current !== status) continue;
      proposals.push({ manifest, build: found, status: current });
    } catch (err) {
      errors.push({ accession, message: err.message });
    }
  }
  return { proposals, errors };
}

/**
 * Rejects with a precise, actionable message on the first failed check.
 * The build (the website release) comes from the milestone of the proposal's
 * ticket, so a proposal with no ticket is refused; the rebuild branch is given,
 * never derived from it. Only a verified (`ready`) proposal loads, though a
 * dry run also accepts one awaiting or failing verification; a resumed load is
 * past that check.
 * The proposal and the contacts it names are read from origin/master, where
 * proposals live; the rebuild branch never holds them. Everything a load writes
 * is rendered here, from a scratch export of origin/master, so the
 * name-collision checks run before anything is touched. The load commit at
 * HEAD of load/<acc>, cut from the rebuild branch, is a previous run that
 * failed after committing, and is reported as `resume` rather than refused.
 * Every organism is settled (see settleOrganisms) before any branch exists.
 * A type with a dataset class settles as the delivery record on the ticket
 * says (see recordedDelivery). For a type without one, settle
 * ({ proposed: abbrev }) is a person's decision on a stop, and a resumed load
 * needs the same settle as the run that committed it.
 * organismConstants ({ abbrev: { name: value } }) supplies, after the data
 * loader confirms them, constants a type requires that an organism file lacks.
 */
export async function checkLoadPreconditions({ git, ticket, repoPath, rebuildBranch, accession, dryRun = false, settle = {}, organismConstants = {}, validate }) {
  assertRebuildBranch(rebuildBranch);
  if (typeof validate !== 'function') throw new Error('validate is required: content validation runs before every load');
  const relDir = proposalRelativePath(accession);
  const branch = loadBranch(accession);
  git.fetch();

  const onLoadBranch = (git.currentBranch() || '') === branch;
  const dirty = onLoadBranch ? dirtyTreeMessage(repoPath, accession, rebuildBranch) : undefined;
  assertClean(git, () => dirty);

  // Contacts are edited on master only; the load commit copies them over.
  const manifest = readOnRef(git, 'origin/master', accession, { contactIds: readContactIdsOnRef(git, 'origin/master') });
  if (!manifest) {
    throw new Error(`No proposal found at ${relDir} on origin/master. Check the accession, or confirm its proposal pull request was merged.`);
  }
  if (!manifest.ticket) {
    throw new Error(`Proposal ${accession} has no ticket, so it has no build. Record its ticket in ${relDir}/${MANIFEST_FILENAME} on master.`);
  }
  await ticket.checkProject();
  const build = await ticket.getBuild(manifest.ticket);
  const base = rebuildBranch;
  const presenterPath = presenterFilePath(repoPath, homeProject(manifest));

  if (isResume(git, accession, base)) {
    const recorded = await recordedDelivery(git, ticket, manifest, relDir, rebuildBranch, { build, dryRun, settle });
    const settled = settledAsRecorded(git, manifest, recorded, settle);
    await assertSettledAsCommitted(git, manifest, { relDir, build, settled, repoPath, base, branch, byRecord: Boolean(recorded) });
    return { manifest, base, branch, build, resume: true, settled, recorded };
  }
  if (onLoadBranch) {
    throw new Error(`Branch ${branch} is checked out but does not hold a load commit for ${accession}; to start over: ${startOverCommand(repoPath, base, branch)}`);
  }
  const status = await ticket.getStatus(manifest.ticket);
  const draftNote = status === 'draft'
    ? ` An "${ticket.statusOption('draft')}" ticket's proposal PR is still being worked on, or was merged without moving the ticket to "${ticket.statusOption('proposed')}".`
    : '';
  if (dryRun && !DRY_RUN_STATUSES.includes(status)) {
    throw new Error(`The proposal's ticket ${manifest.ticket.url} is at "${ticket.statusOption(status)}"; a dry run needs ${DRY_RUN_STATUSES.map(s => `"${ticket.statusOption(s)}"`).join(', ').replace(/, ([^,]*)$/, ' or $1')}.${draftNote}`);
  }
  if (!dryRun && status !== 'ready') {
    throw new Error(`The proposal's ticket ${manifest.ticket.url} is at "${ticket.statusOption(status)}"; only "${ticket.statusOption('ready')}" proposals load. Verify it and run mark-ready, or request-revision.${draftNote}`);
  }
  const recorded = await recordedDelivery(git, ticket, manifest, relDir, rebuildBranch, { build, dryRun, settle });
  assertOnCurrentRebuild(git, repoPath, base, `Loading targets ${base}.`);
  const settled = settledAsRecorded(git, manifest, recorded, settle);
  if (git.branchExists(branch)) {
    throw new Error(`Branch ${branch} already exists. Inspect it, then delete it to rerun:\n  git -C '${repoPath}' branch -D ${branch}`);
  }
  if (git.remoteBranchExists(branch)) {
    throw new Error(`Branch origin/${branch} already exists. Inspect its pull request, then delete it to rerun:\n  git -C '${repoPath}' push origin --delete ${branch}`);
  }
  if (!existsSync(presenterPath)) {
    throw new Error(`Presenter file missing: ${presenterFileRelativePath(homeProject(manifest))}. Ask which project file this dataset belongs in.`);
  }

  const rendered = await withProposalFromRef(git, 'origin/master', relDir, async (dir) => {
    await assertValidContent(validate, dir, manifest);
    return renderAndCheck(git, manifest, dir, presenterPath, repoPath, build, settled, organismConstants);
  });
  return { manifest, base, branch, build, resume: false, settled, recorded, ...rendered };
}

/** On load/<acc>, cut from base, with this accession's load commit at HEAD: a run that failed after committing. */
function isResume(git, accession, base) {
  const branch = loadBranch(accession);
  if ((git.currentBranch() || '') !== branch || git.aheadOf(base) < 1) return false;
  if (!git.isAncestor(base, 'HEAD')) {
    throw new Error(`Branch ${branch} was not cut from ${base}; resume with the --rebuild-branch it was loaded from`);
  }
  const subject = git.headSubject();
  // A load commit that removed the proposal predates loading from master.
  return subject.startsWith(`Load ${accession}: `) && !subject.endsWith(', remove proposal');
}

const startOverCommand = (repoPath, base, branch) => `git -C '${repoPath}' checkout -f ${base} && git -C '${repoPath}' branch -D ${branch}`;

function assertOnCurrentRebuild(git, repoPath, base, because) {
  assertOnBranch(git, base, `git -C '${repoPath}' checkout ${base}`, { because });
  if (!git.isUpToDate(base)) {
    throw new Error(`${base} is not at origin/${base}; run: git -C '${repoPath}' pull`);
  }
}

/** Settlement of the manifest's organisms against ref's organism files and every pending genome proposal; never throws on a stop. */
export function settlementOn(git, manifest, ref, settle = {}) {
  return settleOrganisms(manifest, {
    index: readOrganismIndex(git, ref),
    claims: pendingGenomeProposals(git, ['origin/master']),
    // A rebuild branch holds the Proposals/ it was cut with, so master's copy comes first.
    genomeOf: (accession) => genomeOrganismOf(git, 'origin/master', accession) ?? genomeOrganismOf(git, ref, accession),
    settle
  });
}

export const settlementFor = (git, manifest, settle = {}) => settlementOn(git, manifest, 'HEAD', settle);

/**
 * Every Ready to load proposal on origin/master (optionally only those
 * whose ticket is in build) with the abbreviation each organism would load
 * under and the stops a person must resolve first. Runs only on the rebuild branch, at origin.
 * Returns { results: [{ accession, organisms, stops }], errors }.
 */
export async function checkOrganisms({ git, ticket, repoPath, rebuildBranch, build }) {
  assertRebuildBranch(rebuildBranch);
  git.fetch();
  assertOnCurrentRebuild(git, repoPath, rebuildBranch, `Organisms are checked on ${rebuildBranch}.`);
  const { proposals, errors } = await listProposals(git, { ticket, build, status: 'ready' });
  const results = proposals.map(({ manifest }) => ({ accession: manifest.accession, ...settlementFor(git, manifest) }));
  return { results, errors };
}

function settledOrStop(git, manifest, settle, resolve) {
  const { organisms, stops } = settlementFor(git, manifest, settle);
  if (stops.length) {
    throw new Error(`Organism abbreviations need a person before ${manifest.accession} loads:\n  - ${stops.join('\n  - ')}\n${resolve}`);
  }
  return organisms;
}

/**
 * The delivery mark-ready recorded, for a type with a dataset class (null
 * otherwise): { record }, refusing a missing or unreadable record, one for an
 * earlier proposal, one prepared against another rebuild branch, or one for
 * another build or release than the ticket now has. A dry run
 * gets { record: null, warning } instead, so verification can still dry-run.
 * Such a type settles at preprocessing, so a settle given here is refused.
 */
async function recordedDelivery(git, ticket, manifest, relDir, rebuildBranch, { build, dryRun, settle }) {
  const { datasetClass } = await loadDatasetType(manifest.datasetType);
  if (!datasetClass) return null;
  const decisions = Object.entries(settle ?? {});
  if (decisions.length) {
    const pairs = decisions.map(([proposed, abbrev]) => `--settle ${proposed}=${abbrev}`).join(' ');
    throw new Error(`--settle is decided at preprocessing for ${manifest.datasetType}: run prepare-delivery.js --against origin/${rebuildBranch} ${pairs} ${manifest.accession}, then mark-ready.js again`);
  }
  const again = `run prepare-delivery.js --against origin/${rebuildBranch} ${manifest.accession}, then mark-ready.js again`;
  const refuse = (problem, warning = `${problem}; this dry run settles organisms afresh`) => {
    if (dryRun) return { record: null, warning };
    throw new Error(`${problem}; ${again}`);
  };
  const found = latestDeliveryRecord(await ticket.listComments(manifest.ticket));
  if (!found) return refuse(`The ticket ${manifest.ticket.url} has no delivery record`, 'No delivery record yet: this dry run settles organisms afresh; run prepare-delivery.js and mark-ready.js before loading.');
  const { record } = found;
  if (!record) return refuse(`The latest delivery record on ${manifest.ticket.url} is unreadable`);
  if (record.proposalTree !== git.objectId('origin/master', relDir)) return refuse(`The delivery record is for an earlier version of ${manifest.accession}`);
  if (record.against !== `origin/${rebuildBranch}`) return refuse(`The delivery of ${manifest.accession} was prepared against ${record.against}, not origin/${rebuildBranch}`);
  const release = await ticket.getRelease(manifest.ticket);
  if (record.build !== build || record.release !== release) {
    return refuse(`The delivery of ${manifest.accession} was prepared for build ${record.build} / release ${record.release}; the ticket now says build ${build} / release ${release}`);
  }
  return { record };
}

/**
 * Settles as the record says, or refuses: the delivery on the server is named
 * by that settlement. Only organisms that would not settle to the recorded
 * abbreviation on their own take it as a decision, so derived notes survive.
 * Without a record (a type with no dataset class), a person's settle decides.
 */
function settledAsRecorded(git, manifest, recorded, settle) {
  if (!recorded) return settledOrStop(git, manifest, settle, 'Resolve each, then re-run.');
  const resolve = 'Resolve each with prepare-delivery.js --settle, then mark-ready.js again.';
  if (!recorded.record) return settledOrStop(git, manifest, {}, resolve);
  const own = settlementFor(git, manifest).organisms;
  const { settlement } = recorded.record;
  const decisions = Object.fromEntries(settlement
    .filter((s) => own.find((o) => o.proposed === s.proposed)?.abbrev !== s.abbrev)
    .map((s) => [s.proposed, s.abbrev]));
  const settled = settledOrStop(git, manifest, decisions, resolve);
  const here = settled.map((o) => o.abbrev).join(' ');
  const then = settlement.map((s) => s.abbrev).join(' ');
  if (here !== then) throw new Error(`${manifest.accession} settles to ${here} here; the delivery recorded ${then}. Run prepare-delivery.js again, then mark-ready.js.`);
  return settled;
}

/** Runs fn on a scratch copy of the proposal whose manifest carries the settled abbreviations. */
export async function withSettledProposal(proposalDir, manifest, settled, fn) {
  const scratch = mkdtempSync(join(tmpdir(), 'load-settled-'));
  try {
    const dir = join(scratch, manifest.accession);
    cpSync(proposalDir, dir, { recursive: true });
    const settledManifest = {
      ...manifest,
      organisms: manifest.organisms.map((o, i) => {
        if (settled[i]?.proposed !== o.proposedOrganismAbbrev) throw new Error(`Settlement of ${manifest.accession} does not match its organisms at ${o.proposedOrganismAbbrev}`);
        return { ...o, organismAbbrev: settled[i].abbrev };
      })
    };
    writeManifest(dir, settledManifest, { settled: true });
    return await fn(dir, settledManifest);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** Runs fn on a scratch export of the proposal as ref has it, without touching the checkout. */
async function withProposalFromRef(git, ref, relDir, fn) {
  const scratch = mkdtempSync(join(tmpdir(), 'load-from-ref-'));
  try {
    git.exportTree(ref, relDir, scratch);
    return await fn(join(scratch, relDir));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** A dirty load branch is a previous run, so it gets its own way out. */
function dirtyTreeMessage(repoPath, accession, base) {
  const branch = loadBranch(accession);
  return `A previous load left uncommitted changes on ${branch}; to start over: ${startOverCommand(repoPath, base, branch)}`;
}

/**
 * A run that got as far as the load commit can be finished by re-running;
 * anything earlier leaves a half-built branch that is cheaper to discard.
 */
function recoveryFooter({ git, repoPath, accession, base, branch }) {
  let resumable = false;
  try { resumable = isResume(git, accession, base); } catch { resumable = false; }
  if (resumable) return 'Re-run the same command to resume.';
  return `To start over: ${startOverCommand(repoPath, base, branch)}`;
}

/** The load commit names the presenters it inserted, so a resume can recover them. */
function presenterNamesFromCommit(subject) {
  return /^Load \S+: add (.+?) to /.exec(subject)?.[1].split(' ') ?? null;
}

/** The organisms the load commit added the dataset entry to, or null. */
function datasetOrganismsFromCommit(subject, name) {
  return new RegExp(`, ${name} to (.+)$`).exec(subject)?.[1].split(' ') ?? null;
}

/**
 * A resume pushes the commit an earlier run made, so this run's settlement must
 * name what that commit wrote: the presenters and the dataset organisms it names.
 */
async function assertSettledAsCommitted(git, manifest, { relDir, build, settled, repoPath, base, branch, byRecord }) {
  const subject = git.headSubject();
  const startOver = startOverCommand(repoPath, base, branch);
  const refuse = (committed, settling) => {
    throw new Error(byRecord
      ? `This load was committed with ${committed.join(' ')}; the delivery record settles to ${settling.join(' ')}. Start over: ${startOver}`
      : `This load was committed with ${committed.join(' ')}; this run settles to ${settling.join(' ')}. Re-run with the same --settle as the run that committed, or start over: ${startOver}`);
  };
  const committedPresenters = presenterNamesFromCommit(subject);
  const committedOrganisms = datasetOrganismsFromCommit(subject, manifest.name);
  if (!committedPresenters && !committedOrganisms) {
    throw new Error(`The load commit "${subject}" names neither presenters nor organisms, so this run cannot confirm it settles the same way. Start over: ${startOver}`);
  }
  if (committedPresenters) {
    const datasetType = await loadDatasetType(manifest.datasetType);
    const names = await withProposalFromRef(git, 'origin/master', relDir, (dir) => withSettledProposal(dir, manifest, settled,
      (d) => [extractPresenterName(datasetType.renderPresenter(d, { build }))]));
    if (names.join(' ') !== committedPresenters.join(' ')) refuse(committedPresenters, names);
  }
  const abbrevs = settled.map((o) => o.abbrev);
  if (committedOrganisms && abbrevs.join(' ') !== committedOrganisms.join(' ')) refuse(committedOrganisms, abbrevs);
}

/** Runs the content validators; any error stops the load before anything changes. */
async function assertValidContent(validate, proposalDir, manifest) {
  const errors = (await validate({ proposalDir, manifest })).filter((f) => f.severity === 'error');
  if (errors.length) {
    throw new Error(`Validation of ${manifest.accession} failed; request a revision, or fix the validation workspace:\n  - ${errors.map(formatFinding).join('\n  - ')}`);
  }
}

/**
 * Everything a load commits, rendered from an export of the proposal: the
 * presenter and, for types with a dataset class, each organism's
 * file entry. Refuses a name already present in any file,
 * or one a datasetNamePattern on HEAD would match across organisms.
 */
async function renderAndCheck(git, manifest, proposalDir, presenterPath, repoPath, build, settled, organismConstants) {
  return withSettledProposal(proposalDir, manifest, settled, async (dir, m) => {
    const datasetType = await loadDatasetType(m.datasetType);
    const presenterFile = readFileSync(presenterPath, 'utf-8');
    const xml = datasetType.renderPresenter(dir, { build });
    const presenters = [{ xml, name: extractPresenterName(xml) }];
    const taken = presenters.find((p) => presenterNameExists(presenterFile, p.name));
    if (taken) throw new Error(`Presenter "${taken.name}" already exists in ${presenterFileRelativePath(homeProject(m))}. It may already be loaded; ask before continuing.`);
    const parts = await renderDatasetParts(m, dir, repoPath, { check: true, organismConstants });
    const clash = namePatternClash(git, 'HEAD', datasetType, { className: m.datasetClass, name: m.name, organisms: organismsOf(m) });
    if (clash) throw new Error(`${clash}. Request a revision so the curator chooses another "name" in --overrides.`);
    return { presenters, presenterFile, ...parts };
  });
}

/**
 * The dataset entry (the same for every organism) and each organism's file;
 * check refuses a missing organism file or a taken name.
 */
async function renderDatasetParts(manifest, proposalDir, repoPath, { check, organismConstants = {} }) {
  const datasetType = await loadDatasetType(manifest.datasetType);
  if (!datasetType.datasetClass) return { dataset: null };
  const classDef = readDatasetClass(repoPath, datasetType.datasetClass);
  const xml = datasetType.renderDataset(proposalDir, classDef);
  const organisms = organismsOf(manifest).map((organism) => {
    const project = projectOf(manifest, organism);
    const relFile = datasetFileRelativePath(project, organism);
    let datasetFile = null;
    let constantsAdded = [];
    if (check) {
      const path = datasetFilePath(repoPath, project, organism);
      if (!existsSync(path)) throw new Error(`Dataset file missing: ${relFile}. Is ${organism} a ${project} organism on this build?`);
      datasetFile = readFileSync(path, 'utf-8');
      if (datasetNameExists(datasetFile, classDef.className, manifest.name)) {
        throw new Error(`${relFile} already has a ${classDef.className} named "${manifest.name}". It may already be loaded; ask before continuing.`);
      }
      const constants = withOrganismConstants(datasetFile, datasetType.requiredOrganismConstants, organismConstants[organism] ?? {}, organism);
      datasetFile = constants.content;
      constantsAdded = constants.added;
    }
    return { organism, relFile, datasetFile, constantsAdded };
  });
  return { dataset: { xml, organisms } };
}

/** Warnings for given organism constants the load does not use; a resume (resumedBranch) uses none. */
async function constantWarnings(manifest, settled, given, resumedBranch) {
  if (resumedBranch) {
    return Object.entries(given).flatMap(([abbrev, c]) => Object.keys(c).map((name) => `--${name} ${abbrev} was not used: ${resumedBranch} already holds the load commit`));
  }
  const { requiredOrganismConstants: required } = await loadDatasetType(manifest.datasetType);
  return unusedOrganismConstants(given, { organisms: settled.map((o) => o.abbrev), required, accession: manifest.accession, datasetType: manifest.datasetType });
}

/**
 * Renders, inserts the presenter (and the dataset entry, for types with a
 * dataset class), copies origin/master's allContacts.xml when it differs,
 * commits once, pushes, opens a PR against the rebuild branch of the build the
 * ticket names, comments on and transitions the ticket. It writes nothing
 * outside the repository: preprocessing wrote the delivery. dryRun performs
 * only checks and rendering, reading nothing from the ticket but its build,
 * status and delivery record. Idempotent: a re-run after a
 * failure past the commit reuses that commit and any open pull request, and
 * the ticket hears about the pull request once.
 */
export async function loadProposal({ git, ticket, repoPath, rebuildBranch, accession, dryRun = false, settle = {}, organismConstants = {}, validate }) {
  const pre = await checkLoadPreconditions({ git, ticket, repoPath, rebuildBranch, accession, dryRun, settle, organismConstants, validate });
  const { manifest, base, branch, build, resume } = pre;
  const relDir = proposalRelativePath(accession);
  const warnings = [];
  if (pre.recorded?.warning) warnings.push(pre.recorded.warning);
  if (resume) warnings.push(`Branch ${branch} already holds the load commit; resuming with push, pull request and ticket.`);
  warnings.push(...await constantWarnings(manifest, pre.settled, organismConstants, resume && branch));
  if (dryRun) {
    // A resume renders nothing up front; its commit still names the presenters.
    const presenters = pre.presenters ?? [];
    return {
      presenterNames: pre.presenters ? presenters.map((p) => p.name) : presenterNamesFromCommit(git.headSubject()),
      presenters, dataset: pre.dataset ?? null, manifest, warnings, settled: pre.settled, dryRun: true
    };
  }

  git.checkGhAuth();

  const { presenterFile, presenters } = pre;
  let presenterNames = presenters?.map((p) => p.name);
  let prUrl;
  let dataset = pre.dataset ?? null;
  const corpusStep = pre.recorded?.record?.corpusStep ?? null;
  const corpusLines = corpusStep ? ['', `STF corpus step, once the delivery is on the server: ${corpusStep}`] : [];
  // Everything below changes the repository, the forge or the ticket, so a
  // failure ends with the one recovery the current state allows.
  try {
    if (!resume) {
      git.createBranch(branch, base);
      // Every insert runs before any write, so a refused insert leaves the tree clean.
      const writes = [{ relFile: presenterFileRelativePath(homeProject(manifest)), content: presenters.reduce((c, p) => insertPresenter(c, p.xml), presenterFile) },
        ...(dataset?.organisms ?? []).map((o) => ({ relFile: o.relFile, content: insertDataset(o.datasetFile, dataset.xml) }))];
      for (const w of writes) writeFileSync(join(repoPath, w.relFile), w.content);
      git.add(writes.map((w) => w.relFile));
      // Stages nothing when the rebuild branch already has master's contacts.
      git.checkoutPath('origin/master', CONTACTS_RELATIVE_PATH);
      const alsoDataset = dataset ? `, ${manifest.name} to ${dataset.organisms.map((o) => o.organism).join(' ')}` : '';
      git.commit(`Load ${accession}: add ${presenterNames.join(' ')} to ${homeProject(manifest)}${alsoDataset}`);
    }
    presenterNames ??= presenterNamesFromCommit(git.headSubject());
    if (resume) dataset = await committedDataset(git, manifest, pre.settled, repoPath, relDir);
    git.push(branch, resume ? { force: git.remoteBranchExists(branch) } : {});

    const title = `Load ${accession} (${manifest.datasetType}, ${projectsOf(manifest).join(', ')}) into ${base} for build ${build}`;
    const body = [
      `Presenters: ${presenterNames?.map((n) => `\`${n}\``).join(', ') ?? 'see the commit on this branch'} in \`${presenterFileRelativePath(homeProject(manifest))}\``,
      ...pre.settled.map((o) => `Organism \`${o.abbrev}\`${o.abbrev === o.proposed ? '' : ` (proposed \`${o.proposed}\`)`}${o.notes.length ? `: ${o.notes.join('; ')}` : ''}`),
      ...(dataset ? [`Dataset: \`${manifest.name}\` (${manifest.datasetClass}) in ${dataset.organisms.map((o) => `\`${o.relFile}\``).join(', ')}`] : []),
      ...(dataset?.organisms ?? []).filter((o) => o.constantsAdded?.length).map((o) => `Organism constants added to \`${o.relFile}\`: ${o.constantsAdded.join(', ')} (confirmed by the data loader)`),
      `Proposal: \`${relDir}\` on master (archived in its delivery's fromProvider)`,
      `Part of ${ticket.mention(manifest.ticket)}`,
      ...corpusLines
    ].join('\n');
    const openPr = git.findPullRequest(branch);
    prUrl = openPr ?? git.openPullRequest({ base, head: branch, title, body });

    await ticket.commentOnce(manifest.ticket, [`Loading into ${base}. Pull request: ${prUrl}`, ...corpusLines].join('\n'));
    await ticket.setStatus(manifest.ticket, 'loading');
  } catch (err) {
    throw new Error(`${err.message}\n${recoveryFooter({ git, repoPath, accession, base, branch })}`, { cause: err });
  }
  return { presenterNames, manifest, prUrl, branch, base, warnings, corpusStep, settled: pre.settled, dryRun: false, resumed: Boolean(resume) };
}

/** A resume renders nothing up front, so its pull request recomputes the dataset entry the commit holds. */
async function committedDataset(git, manifest, settled, repoPath, relDir) {
  return withProposalFromRef(git, 'origin/master', relDir, (exported) => withSettledProposal(exported, manifest, settled,
    async (d, m) => (await renderDatasetParts(m, d, repoPath, { check: false })).dataset));
}

// Past loading, people move the ticket on by hand: loaders to Final QA, outreach to Done.
export const LOADED_STATUSES = ['qa', 'finalqa', 'done'];

/**
 * After the load pull request has merged: moves the ticket of a loaded proposal
 * to `qa` (Post Load QA) and notes the pull request on it once. The proposal is
 * still on origin/master (clean-proposals removes it only after Post Load QA).
 * Re-running once the ticket is past loading changes nothing.
 * Returns { prUrl, base, ticket, alreadyLoaded }.
 */
export async function markLoaded({ git, ticket, accession }) {
  const branch = loadBranch(accession);
  git.fetch();
  const pr = git.findMergedPullRequest(branch);
  if (!pr) throw new Error(`No merged pull request from ${branch}; mark ${accession} loaded after its load pull request merges`);
  const manifest = readOnRef(git, 'origin/master', accession);
  if (!manifest) throw new Error(`${proposalRelativePath(accession)} is not on origin/master, so its ticket cannot be found; set its Status by hand`);
  if (!manifest.ticket) throw new Error(`The manifest of ${accession} on origin/master has no ticket`);
  // An accession proposed and loaded again keeps the merged load PR of its earlier ticket.
  if (!pr.body.split(/\r?\n/).some((line) => line.trim() === `Part of ${ticket.mention(manifest.ticket)}`)) {
    throw new Error(`The merged pull request ${pr.url} from ${branch} is not for ${manifest.ticket.url}; mark it loaded after this ticket's load pull request merges`);
  }

  const status = await ticket.getStatus(manifest.ticket);
  const alreadyLoaded = LOADED_STATUSES.includes(status);
  if (status !== 'loading' && !alreadyLoaded) {
    throw new Error(`The ticket ${manifest.ticket.url} status is "${status}", not "loading"; only a loading ticket is marked loaded`);
  }
  if (alreadyLoaded) return { prUrl: pr.url, base: pr.base, ticket: manifest.ticket, alreadyLoaded };
  await ticket.commentOnce(manifest.ticket, `Loaded into ${pr.base}: ${pr.url}`);
  await ticket.setStatus(manifest.ticket, 'qa');
  return { prUrl: pr.url, base: pr.base, ticket: manifest.ticket, alreadyLoaded };
}
