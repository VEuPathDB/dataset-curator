import { mkdirSync, mkdtempSync, copyFileSync, cpSync, existsSync, rmSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import {
  write as writeManifest, read as readManifest, readOnRef, readWorkingTreeTicket, validate, organismsOf, organismRuleOf, namesGenusAndSpecies,
  idsOf, projectsOf, proposalRelativePath, proposalBranch, MANIFEST_FILENAME, PROPOSALS_DIR, IDENTITY_FIELDS
} from './manifest.js';
import { readContactIds, readContactName, contactsPath, CONTACTS_RELATIVE_PATH } from './contacts.js';
import { assertClean, assertOnBranch } from './guards.js';
import {
  loadDatasetType, readOverrides, assertValidPresenter, presenterPath, datasetPath, PRESENTER_FILENAME, DATASET_FILENAME, PREVIEW_BUILD
} from '../dataset-types/_common.js';
import { readDatasetClass } from './dataset-classes.js';
import { datasetFileRelativePath, datasetNameExists, namePatternClash } from './dataset-file.js';
import { readOrganismIndex, pendingGenomeProposals, crossCheckOrganisms } from './organisms.js';

export { PROPOSALS_DIR, proposalRelativePath, proposalBranch };

/** Every stop message names how to get back on the proposal branch. */
const assertOnProposalBranch = (git, accession, recovery) =>
  assertOnBranch(git, proposalBranch(accession), recovery);

// Before loading starts; a proposal on master waiting for its build, or sent back, is still editable.
const UPDATABLE_STATUSES = ['draft', 'proposed', 'verifying', 'ready', 'revision'];
// An updated proposal needs review again.
const REREVIEW_STATUSES = ['verifying', 'ready', 'revision'];

const readWorkingTreeExternalIds = (manifestPath) => {
  try { return JSON.parse(readFileSync(manifestPath, 'utf-8'))?.externalIds; }
  catch { return undefined; }
};

const manifestOn = (git, ref, accession) => {
  try { return JSON.parse(git.showFile(ref, `${proposalRelativePath(accession)}/${MANIFEST_FILENAME}`)); }
  catch { return null; }
};

/**
 * Refuses when a proposal under another accession already covers one of ids:
 * a proposal branch named for one of them, or a manifest recording one, on
 * origin/master or on another proposal branch on origin. Call after git.fetch().
 */
export function assertNoOtherProposalFor(git, accession, ids) {
  const covering = (other, where) => {
    const shared = ids.find((id) => id === other) ?? idsOf(manifestOn(git, where, other) ?? {}).find((id) => ids.includes(id));
    if (shared) throw new Error(`Proposal ${other} (${where}) already covers ${shared}. Propose under ${other} instead: node scripts/start-proposal.js ${other}`);
  };
  for (const id of ids) {
    if (id !== accession && git.branchExists(proposalBranch(id))) covering(id, `branch ${proposalBranch(id)} here`);
  }
  for (const other of git.listDir('origin/master', PROPOSALS_DIR)) {
    if (other !== accession) covering(other, 'origin/master');
  }
  for (const branch of git.remoteBranches(proposalBranch(''))) {
    const other = branch.slice(proposalBranch('').length);
    if (other !== accession) covering(other, `origin/${branch}`);
  }
}

/**
 * Verifies the checkout is on a clean, current master with no proposal branch
 * here or on origin, and that no other proposal covers one of externalIds; if
 * a proposal already exists on origin/master, consults its ticket. Creates
 * proposal/<accession>.
 * Returns { mode: 'new' } or { mode: 'update', existingTicket }.
 */
export async function startProposal({ git, ticket, accession, externalIds = {}, forceUpdate = false }) {
  const branch = proposalBranch(accession);
  git.fetch();

  assertOnBranch(git, 'master', `git -C '${git.repoPath}' checkout master`);
  assertClean(git);
  if (!git.isUpToDate('master')) {
    throw new Error(`master is behind origin/master; run: git -C '${git.repoPath}' pull`);
  }
  if (git.branchExists(branch)) {
    throw new Error(`Branch ${branch} already exists here. Delete it to start over:\n  git -C '${git.repoPath}' branch -D ${branch}`);
  }
  if (git.remoteBranchExists(branch)) {
    throw new Error(`Branch ${branch} already exists on origin. Delete it to start over:\n  git -C '${git.repoPath}' push origin --delete ${branch}`);
  }
  assertNoOtherProposalFor(git, accession, idsOf({ accession, externalIds }));

  let result = { mode: 'new' };
  const existing = readOnRef(git, 'origin/master', accession);
  if (existing) {
    if (existing.ticket) {
      const status = await ticket.getStatus(existing.ticket);
      if (!UPDATABLE_STATUSES.includes(status)) {
        throw new Error(`Proposal ${accession} exists and its ticket ${existing.ticket.url} status is "${status}". Only a ${UPDATABLE_STATUSES.slice(0, -1).join(', ')} or ${UPDATABLE_STATUSES.at(-1)} ticket can be updated.`);
      }
    } else if (!forceUpdate) {
      throw new Error(`Proposal ${accession} exists on master but its manifest has no ticket, so its status cannot be checked. Add the ticket to ${proposalRelativePath(accession)}/${MANIFEST_FILENAME} on master, or re-run with --force-update to treat it as proposed.`);
    }
    result = { mode: 'update', existingTicket: existing.ticket };
  }

  git.createBranch(branch, 'master');
  return result;
}

const MANIFEST_ORDER = [
  'schemaVersion', 'accession', 'externalIds', 'datasetType', 'organisms',
  ...IDENTITY_FIELDS, 'contacts', 'curator', 'createdAt', 'skill', 'ticket'
];
const inManifestOrder = (m) => Object.fromEntries(MANIFEST_ORDER.filter((k) => k in m).map((k) => [k, m[k]]));

/** Other proposals on master are read unvalidated. */
const organismsIn = (m) => (Array.isArray(m.organisms) ? m.organisms : [])
  .map((o) => o?.proposedOrganismAbbrev).filter((a) => typeof a === 'string' && a !== '');

const CHOOSE_NAME = 'choose another "name" in --overrides';

/**
 * The experiment name must be new for each loaded organism, in its file on the
 * rebuild branch, and not claimed by another proposal already on master. When
 * the type's multi-organism presenter matches datasets by pattern, a
 * multi-organism name must be new in every organism, and a single-organism
 * name must not be one a multi-organism presenter or proposal already uses.
 */
function assertNameIsFree(git, rebuildRef, m, pattern) {
  for (const o of m.organisms.filter((x) => x.source === 'loaded')) {
    const relFile = datasetFileRelativePath(o.project, o.proposedOrganismAbbrev);
    if (datasetNameExists(git.showFile(rebuildRef, relFile), m.datasetClass, m.name)) {
      throw new Error(`${relFile} on ${rebuildRef} already has a ${m.datasetClass} named "${m.name}"; ${CHOOSE_NAME}`);
    }
  }
  const multi = m.organisms.length > 1;
  const clash = pattern && namePatternClash(git, rebuildRef, { className: m.datasetClass, name: m.name, pattern, multi });
  if (clash) throw new Error(`${clash}; ${CHOOSE_NAME}`);
  const organisms = organismsOf(m);
  for (const other of git.listDir('origin/master', PROPOSALS_DIR)) {
    if (other === m.accession) continue;
    let theirs;
    try { theirs = JSON.parse(git.showFile('origin/master', `${proposalRelativePath(other)}/${MANIFEST_FILENAME}`)); }
    catch { continue; }
    if (theirs.name !== m.name) continue;
    const shared = organisms.find((organism) => organismsIn(theirs).includes(organism));
    if (shared) {
      throw new Error(`Proposal ${other} on master already uses the name "${m.name}" for ${shared}; ${CHOOSE_NAME}`);
    }
    if (pattern && theirs.datasetClass === m.datasetClass && (multi || organismsIn(theirs).length > 1)) {
      throw new Error(`Proposal ${other} on master already uses the name "${m.name}" for ${organismsIn(theirs).join(', ')}; a multi-organism proposal's name must be unique across all organisms; ${CHOOSE_NAME}`);
    }
  }
}

/**
 * name and version for a dataset type that makes a classes.xml dataset:
 * curator overrides first, then what the type can derive from the inputs.
 */
function identityFor(datasetType, stagedDir, manifest, overrides, repoPath) {
  if (!datasetType.datasetClass) {
    if (overrides.name !== undefined || overrides.version !== undefined) {
      throw new Error(`${manifest.datasetType} proposals do not take a name or version yet`);
    }
    return {};
  }
  const derived = datasetType.deriveIdentity(stagedDir, {
    primaryContactName: readContactName(contactsPath(repoPath), manifest.contacts.primary)
  });
  const identity = {
    datasetClass: datasetType.datasetClass,
    name: overrides.name ?? derived.name,
    version: overrides.version ?? derived.version
  };
  const missing = ['name', 'version'].filter((k) => !identity[k]);
  if (missing.length) {
    throw new Error(`No ${missing.join(' or ')} could be derived for ${manifest.accession}; set ${missing.map((k) => `"${k}"`).join(' and ')} in the --overrides file`);
  }
  return identity;
}

const CURATED_EDITS = ['keep', 'replace'];
const ASK_CURATOR = 'Ask the curator, then re-run with --keep-edits to keep them or --replace-edits to rewrite them (or per file: --keep-edit <file>, --replace-edit <file>).';

function assertCuratedEditsShape(curatedEdits) {
  if (curatedEdits === undefined || CURATED_EDITS.includes(curatedEdits)) return;
  const lists = curatedEdits && typeof curatedEdits === 'object' && Object.keys(curatedEdits).every((k) => CURATED_EDITS.includes(k))
    && Object.values(curatedEdits).every((v) => Array.isArray(v) && v.every((f) => typeof f === 'string'));
  if (!lists) throw new Error('curatedEdits must be "keep", "replace" or { keep: [...], replace: [...] }');
}

/** Per-file choices: each differing file chosen exactly once, and nothing else. */
function choicesFor(differing, { keep = [], replace = [] }) {
  const named = [...keep, ...replace].map((f) => f.replace(/^curated\//, ''));
  const problems = [
    ...differing.filter((f) => !named.includes(f)).map((f) => `curated/${f} differs and has no choice`),
    ...[...new Set(named.filter((f, i) => named.indexOf(f) !== i))].map((f) => `curated/${f} is chosen more than once`),
    ...[...new Set(named.filter((f) => !differing.includes(f)))].map((f) => `curated/${f} is not a curated artifact that differs`)
  ];
  if (problems.length) throw new Error(`Choices for the hand-edited curated artifacts do not cover each differing file exactly once:\n  - ${problems.join('\n  - ')}\n${ASK_CURATOR}`);
  return new Set(keep.map((f) => f.replace(/^curated\//, '')));
}

/** Every derived artifact name already in the proposal: flat, or under any organism directory of curated/. */
function artifactsOnDisk(dir, names) {
  const curated = join(dir, 'curated');
  if (!existsSync(curated)) return [];
  const subdirs = readdirSync(curated, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  return [...names, ...subdirs.flatMap((d) => names.map((f) => `${d}/${f}`))];
}

const orphanProblem = (f, organisms) => (organisms?.length > 1 && !f.includes('/')
  ? `curated/${f} is in the schemaVersion 3 flat layout and belongs to no one organism; replace it to drop it, or copy your edits into curated/<abbrev>/${f} first`
  : `curated/${f} belongs to no current organism; replace it to drop it`);

/**
 * The curated artifacts for the staged proposal. Listed artifacts already in
 * the proposal that differ from the derived text (or that are no longer
 * derived) are only replaced, or kept, when the curator has decided which.
 * organisms are the proposal's proposed abbreviations: with one, a flat
 * schemaVersion 3 curated/<f> stands for <abbrev>/<f> when that is absent.
 */
export function artifactsToWrite(dir, derived, listed, curatedEdits, { organisms } = {}) {
  const onDisk = (f) => existsSync(join(dir, 'curated', f));
  const home = organisms?.length === 1 ? organisms[0] : undefined;
  const targetOf = (f) => (home && !f.includes('/') && !onDisk(`${home}/${f}`) ? `${home}/${f}` : f);
  const existing = {};
  for (const f of new Set([...Object.keys(derived), ...listed])) {
    if (onDisk(f)) existing[f] = readFileSync(join(dir, 'curated', f), 'utf-8');
  }
  const differing = Object.keys(existing).filter((f) => existing[f] !== derived[targetOf(f)]);
  if (!differing.length || curatedEdits === 'replace') return derived;
  if (curatedEdits === undefined) {
    throw new Error(`${differing.map((f) => `curated/${f}`).join(', ')} ${differing.length === 1 ? 'differs' : 'differ'} from what write-proposal would derive (hand edits, or changed annotations). ${ASK_CURATOR}`);
  }
  const kept = curatedEdits === 'keep' ? new Set(differing) : choicesFor(differing, curatedEdits);
  const orphans = [...kept].filter((f) => !(targetOf(f) in derived));
  if (orphans.length) throw new Error(orphans.map((f) => orphanProblem(f, organisms)).join('\n'));
  const artifacts = { ...derived };
  for (const f of kept) artifacts[targetOf(f)] = existing[f];
  return artifacts;
}

/** The proposal's organisms as the curator named them: introduced by a genome, otherwise loaded. */
function organismsFrom(typeModule, { accession, datasetType, project, organism, additionalOrganisms = [] }, inputs, organismOverrides, warn) {
  const rule = organismRuleOf(datasetType);
  if (organismOverrides && !rule.new) throw new Error(`${datasetType} proposals take no "organism" overrides; they apply to genome proposals`);
  if (rule.max && 1 + additionalOrganisms.length > rule.max) throw new Error(`${datasetType} proposals align to one organism; --also-organism is not allowed`);
  return [organism, ...additionalOrganisms].map((proposedOrganismAbbrev, i) => {
    if (!rule.new) return i === 0 ? { proposedOrganismAbbrev, source: 'loaded', project } : { proposedOrganismAbbrev, source: 'loaded' };
    const derived = typeModule.deriveOrganism(inputs, accession, organismOverrides, warn);
    if (!namesGenusAndSpecies(derived.species)) {
      throw new Error(`organisms[${i}].species must name a genus and species; set "organism": { "species": "<Genus species>" } in --overrides`);
    }
    return { proposedOrganismAbbrev, source: 'new', project, ...derived };
  });
}

/**
 * Writes Proposals/<accession>/ with inputs/, curated/ (including the derived
 * presenter.json) and manifest.json, replacing any existing directory. The
 * proposal is built and trial-rendered in a staging directory first, so a
 * missing input or an incomplete presenter leaves the existing one untouched.
 * overrides is an optional path to curator presenter overrides. curatedEdits
 * ('keep', 'replace', or per file { keep: [...], replace: [...] }) is the
 * curator's choice for curated artifacts that differ from what would be
 * derived; without it such a difference is refused. Organisms are checked
 * against origin/<rebuildBranch> and the genome proposals on origin/master.
 * Returns { dir, presenter, dataset, manifest }.
 */
export async function writeProposal({ git, repoPath, rebuildBranch, manifestInput, curator, inputs, curated, overrides, curatedEdits, warn = (m) => console.error(m) }) {
  const accession = manifestInput.accession;
  assertCuratedEditsShape(curatedEdits);
  assertOnProposalBranch(git, accession, `node scripts/start-proposal.js ${accession}`);
  if (!/^rebuild\d+$/.test(rebuildBranch ?? '')) {
    throw new Error(`--rebuild-branch must name the build's rebuild branch, e.g. rebuild73; got "${rebuildBranch}"`);
  }
  const missing = [...inputs, ...curated, ...(overrides ? [overrides] : [])].filter((f) => !existsSync(f));
  if (missing.length) {
    throw new Error(`These files do not exist:\n  - ${missing.join('\n  - ')}\nRe-run the fetch steps that write them, then run this script again.`);
  }
  git.fetch();
  if (!git.remoteBranchExists(rebuildBranch)) {
    throw new Error(`origin/${rebuildBranch} does not exist; ask the curator which rebuild branch they mean`);
  }
  const rebuildRef = `origin/${rebuildBranch}`;

  const dir = join(repoPath, PROPOSALS_DIR, accession);
  const contactIds = readContactIds(contactsPath(repoPath));
  // A proposal keeps its ticket across re-writes, whether it was published from this
  // branch (not yet merged) or is already on master, so the branch describes itself.
  const recordedTicket = readWorkingTreeTicket(join(dir, MANIFEST_FILENAME), warn) ?? readOnRef(git, 'origin/master', accession)?.ticket;
  const externalIds = {
    ...(manifestOn(git, 'origin/master', accession)?.externalIds ?? {}),
    ...(readWorkingTreeExternalIds(join(dir, MANIFEST_FILENAME)) ?? {}),
    ...(manifestInput.externalIds ?? {})
  };

  const overrideValues = readOverrides(overrides);
  const datasetType = await loadDatasetType(manifestInput.datasetType);
  const manifest = {
    schemaVersion: 4,
    accession,
    ...(Object.keys(externalIds).length ? { externalIds } : {}),
    datasetType: manifestInput.datasetType,
    organisms: organismsFrom(datasetType, manifestInput, inputs, overrideValues.organism, warn),
    contacts: { primary: manifestInput.contacts.primary, additional: manifestInput.contacts.additional || [] },
    curator,
    createdAt: new Date().toISOString(),
    skill: manifestInput.skill
  };
  const ticketRef = manifestInput.ticket ?? recordedTicket;
  if (ticketRef) manifest.ticket = ticketRef;

  const crossCheck = crossCheckOrganisms(manifest, {
    index: readOrganismIndex(git, rebuildRef), claims: pendingGenomeProposals(git, ['origin/master']), rebuild: rebuildRef
  });
  manifest.organisms = crossCheck.organisms;
  const unplaced = manifest.organisms.flatMap((o, i) => (o.project === undefined ? [`organisms[${i}].project "undefined" is not valid`] : []));
  const errors = validate(manifest, { dirName: accession, contactIds }).filter((e) => !unplaced.some((u) => e.startsWith(u)));
  const sections = [
    ...(errors.length ? [`Invalid manifest:\n  - ${errors.join('\n  - ')}`] : []),
    ...(crossCheck.errors.length ? [`Organisms do not check out against ${rebuildRef}:\n  - ${crossCheck.errors.join('\n  - ')}`] : [])
  ];
  if (sections.length) throw new Error(sections.join('\n'));
  for (const w of crossCheck.warnings) warn(`Warning: ${w}`);
  const derivedNames = [PRESENTER_FILENAME, DATASET_FILENAME, ...(datasetType.derivedCuratedFiles ?? [])];
  const clash = curated.find((f) => derivedNames.includes(basename(f)));
  if (clash) throw new Error(`${clash}: ${basename(clash)} is derived by this script; pass curator edits with --overrides`);

  const staging = mkdtempSync(join(tmpdir(), 'proposal-'));
  try {
    const staged = join(staging, accession);
    mkdirSync(join(staged, 'inputs'), { recursive: true });
    mkdirSync(join(staged, 'curated'), { recursive: true });
    for (const f of inputs) copyFileSync(f, join(staged, 'inputs', basename(f)));
    for (const f of curated) copyFileSync(f, join(staged, 'curated', basename(f)));

    const full = inManifestOrder({ ...manifest, ...identityFor(datasetType, staged, manifest, overrideValues, repoPath) });
    writeManifest(staged, full, { contactIds });
    datasetType.normalizeCurated?.(staged, overrideValues.dataset);

    const presenter = datasetType.derivePresenter(staged, overrideValues.presenter);
    assertValidPresenter(presenter, { requiredFields: datasetType.requiredFields, requiredInjectorProps: datasetType.requiredInjectorProps },
      `presenter for ${accession} (set missing fields under "presenter" in --overrides; injector props go under "presenter": { "injectorProps": { ... } })`);
    writeFileSync(presenterPath(staged), JSON.stringify(presenter, null, 2) + '\n');

    let dataset;
    if (datasetType.datasetClass) {
      const classDef = readDatasetClass(repoPath, datasetType.datasetClass);
      assertNameIsFree(git, rebuildRef, full, datasetType.namePatternFor?.(full.name));
      dataset = datasetType.deriveDataset(staged, classDef, overrideValues.dataset);
      writeFileSync(datasetPath(staged), JSON.stringify(dataset, null, 2) + '\n');
      datasetType.renderDataset(staged, classDef);
      if (datasetType.deriveArtifacts) {
        const derived = datasetType.deriveArtifacts(staged);
        const listed = [...Object.keys(derived), ...artifactsOnDisk(dir, datasetType.derivedCuratedFiles ?? [])];
        const artifacts = artifactsToWrite(dir, derived, listed, curatedEdits, { organisms: full.organisms.map((o) => o.proposedOrganismAbbrev) });
        for (const [f, text] of Object.entries(artifacts)) {
          mkdirSync(dirname(join(staged, 'curated', f)), { recursive: true });
          writeFileSync(join(staged, 'curated', f), text);
        }
        datasetType.assertCuratedAgree?.(staged);
      }
    } else if (overrideValues.dataset) {
      throw new Error(`${manifest.datasetType} proposals do not take dataset overrides yet`);
    }
    datasetType.renderPresenter(staged, { build: PREVIEW_BUILD });

    if (existsSync(dir)) rmSync(dir, { recursive: true });
    cpSync(staged, dir, { recursive: true });
    return { dir, presenter, dataset, manifest: full };
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

/**
 * Creates the ticket (or reuses the recorded one) and records it in the
 * manifest, commits the proposal and contacts, pushes, opens a PR against
 * master that cites the ticket, and notes the PR on the ticket.
 * Idempotent: a re-run after a failure reuses the commit, the open pull
 * request and the recorded ticket. build is required when a ticket must be
 * created (it becomes the ticket's milestone) and must match the milestone of
 * a ticket already recorded. Returns { prUrl, ticket, title, resumed }.
 */
export async function publishProposal({ git, ticket, repoPath, accession, build }) {
  if (build !== undefined && !/^\d{2,}$/.test(build)) throw new Error(`--build must be two or more digits, e.g. 02; got "${build}"`);
  const branch = proposalBranch(accession);
  const dir = join(repoPath, PROPOSALS_DIR, accession);

  // Preflight: nothing below mutates git, the ticket system or the manifest.
  // A ticket an earlier run recorded but did not commit must survive the way back.
  const treeTicket = readWorkingTreeTicket(join(dir, MANIFEST_FILENAME), () => {});
  let headTicket;
  try { headTicket = treeTicket ? readOnRef(git, 'HEAD', accession)?.ticket : undefined; } catch { headTicket = undefined; }
  const strayTicket = treeTicket && !(headTicket && headTicket.system === treeTicket.system && headTicket.id === treeTicket.id) ? treeTicket : null;
  assertOnProposalBranch(git, accession, strayTicket
    ? `git -C '${repoPath}' checkout ${branch}   (uncommitted changes come along; then re-run publish)\n${proposalRelativePath(accession)}/${MANIFEST_FILENAME} records ticket ${strayTicket.url}, which must not be lost: do not discard it.`
    : `git -C '${repoPath}' checkout -- ${proposalRelativePath(accession)} ${CONTACTS_RELATIVE_PATH}`);
  git.checkGhAuth();
  await ticket.checkProject();
  const contactIds = readContactIds(contactsPath(repoPath));
  const manifest = readManifest(dir, { contactIds });
  const datasetType = await loadDatasetType(manifest.datasetType);
  datasetType.assertCuratedAgree?.(dir);
  ticket.checkDatasetType(manifest.datasetType);
  git.fetch();
  assertNoOtherProposalFor(git, accession, idsOf(manifest));

  const projects = projectsOf(manifest).join(', ');
  const title = `[${projects}] ${manifest.datasetType} ${accession}`;
  const summary = [
    `Proposal: \`${proposalRelativePath(accession)}\``,
    `Dataset type: ${manifest.datasetType}`,
    `Project: ${projects}`,
    `Organisms: ${manifest.organisms.map((o) => o.source?.proposal ? `${o.proposedOrganismAbbrev} (pending genome ${o.source.proposal})` : o.proposedOrganismAbbrev).join(', ')}`,
    ...(manifest.name ? [`Name: ${manifest.name}`, `Version: ${manifest.version}`] : []),
    `Primary contact: ${manifest.contacts.primary}`,
    `Additional contacts: ${manifest.contacts.additional.join(', ') || 'none'}`,
    `Curator: ${manifest.curator}`
  ].join('\n');

  const ahead = git.aheadOf('origin/master');
  if (git.isClean() && ahead === 0) {
    throw new Error(`Nothing to publish: ${branch} has no commit beyond origin/master and the working tree is clean. Write the proposal first: node scripts/write-proposal.js --accession ${accession} ...`);
  }

  // The ticket comes first so the pull request is opened citing it. An update
  // is a proposal already on master and keeps that proposal's ticket.
  const priorTicket = readOnRef(git, 'origin/master', accession)?.ticket ?? null;
  const known = manifest.ticket ?? priorTicket;
  if (!known && build === undefined) throw new Error('A new ticket needs a build: re-run with --build NN');
  let knownStatus = null;
  if (known) {
    try { knownStatus = await ticket.getStatus(known); }
    catch (e) {
      // A ticket only this branch knows may lack a status an earlier run failed to set; publish sets it below.
      if (priorTicket || e.code !== 'NO_STATUS') throw e;
      if (!(await ticket.isOpen(known))) {
        throw new Error(`The ticket ${known.url} is closed and has no project status; reopen it, or remove it from ${proposalRelativePath(accession)}/${MANIFEST_FILENAME} to file a new one`);
      }
    }
    if (knownStatus !== null && !UPDATABLE_STATUSES.includes(knownStatus)) {
      throw new Error(`The ticket ${known.url} is at "${ticket.statusOption(knownStatus)}"; only ${UPDATABLE_STATUSES.map(s => ticket.statusOption(s)).join(', ').replace(/, ([^,]*)$/, ' or $1')} proposals can be updated`);
    }
  }
  if (known && build !== undefined) {
    const current = await ticket.getBuild(known);
    if (current !== build) throw new Error(`The ticket ${known.url} is in build ${current}, not ${build}; move its milestone instead of passing --build`);
  }
  const manifestRelativePath = `${proposalRelativePath(accession)}/${MANIFEST_FILENAME}`;
  let ref = known;
  if (!ref) {
    try {
      ref = await ticket.create({ title, body: summary, build, datasetType: manifest.datasetType });
    } catch (e) {
      // A ticket that exists but failed a later step is recorded, so the re-run reuses it.
      if (!e.ticket) throw e;
      writeManifest(dir, { ...manifest, ticket: e.ticket }, { contactIds });
      throw new Error(`${e.message}\nIt is recorded in ${manifestRelativePath}: do not discard the working-tree changes in ${proposalRelativePath(accession)}/. Fix the cause first (usually gh auth refresh -s project, or add the missing options to the project's Status field by hand), then re-run publish.`, { cause: e });
    }
  }
  if (!manifest.ticket) writeManifest(dir, { ...manifest, ticket: ref }, { contactIds });

  if (!git.isClean()) {
    git.add([proposalRelativePath(accession), CONTACTS_RELATIVE_PATH]);
    // A branch already ahead was committed by an earlier run; folding the
    // changes in keeps one commit.
    if (ahead >= 1) git.amendNoEdit();
    else git.commit(`Propose ${accession} (${manifest.datasetType}, ${projects})`);
  }

  const alreadyPushed = git.remoteBranchExists(branch);
  git.push(branch, { force: alreadyPushed });

  const openPr = git.findPullRequest(branch);
  const prUrl = openPr ?? git.openPullRequest({
    base: 'master', head: branch, title,
    body: `Part of ${ticket.mention(ref)}\n\n${summary}`
  });

  // The URL in the note keeps a re-run from repeating it.
  await ticket.commentOnce(ref, priorTicket
    ? `Proposal updated. Pull request: ${prUrl}\n\n${summary}`
    : `Pull request: ${prUrl}`);

  if (known && !priorTicket) {
    // Not on master yet, so the ticket is this proposal's own initial draft:
    // re-setting repairs a status an earlier run could not set, or returns one sent back for revision.
    await ticket.setStatus(ref, 'draft');
  } else if (priorTicket && REREVIEW_STATUSES.includes(knownStatus)) {
    await ticket.setStatus(ref, 'proposed');
  }

  return { prUrl, ticket: ref, title, resumed: alreadyPushed || openPr !== null };
}
