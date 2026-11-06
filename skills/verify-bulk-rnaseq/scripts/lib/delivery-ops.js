import { mkdtempSync, rmSync, existsSync, readdirSync, rmdirSync, lstatSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { tmpdir } from 'node:os';
import { sha256File } from './file-hash.js';
import { proposalRelativePath, projectOf } from './manifest.js';
import { verifiableTicket, currentReport } from './verification-ops.js';
import { validatorsFor } from '../dataset-types/validators.js';
import { loadDatasetType } from '../dataset-types/index.js';
import { memoClassOf, readDatasetClassOnRef } from './dataset-classes.js';
import { settlementOn, withSettledProposal } from './load-ops.js';
import { assertValidEntries, entryDeliveries, constantsOf, readerOnRef } from '../dataset-types/_common.js';
import { openDeliveryDir, workAreaOf } from './validation-workspace.js';
import { collectPreprocessed } from './preprocessed.js';
import { createRemote } from './remote.js';
import { corpusDir, corpusClashes, corpusStep } from './corpus.js';
import { writeDeliveryTree, assertDeliverable, deliveryHandoff, deliveryProblems, DELIVERY_SCHEMA_VERSION } from './delivery.js';

const AGAINST = /^origin\/rebuild\d+$/;
const PREPARABLE = ['proposed', 'verifying'];

/** dataStaging/<proposal id>/ once checked to be there and that no listed path collides with the proposal copy. */
function stagingSource({ remote, staging, proposalId, listed }) {
  const path = join(staging.root, proposalId);
  if (remote.list(path) === null) throw new Error(`dataStaging/${proposalId} is missing on ${staging.host} (${path}); the data provider's files must be there first`);
  const clash = listed.find((s) => normalize(s.path).split('/')[0] === proposalId);
  if (clash) throw new Error(`staging lists ${clash.path}, which would collide with the proposal copy fromProvider/${proposalId}/`);
  return path;
}

/** Removes everything under dir but the kept relative paths, and directories left empty. */
function pruneTo(dir, kept, rel = '') {
  for (const entry of readdirSync(join(dir, rel), { withFileTypes: true })) {
    const at = join(rel, entry.name);
    if (kept.has(at)) continue;
    if (!entry.isDirectory()) { rmSync(join(dir, at)); continue; }
    pruneTo(dir, kept, at);
    if (!readdirSync(join(dir, at)).length) rmdirSync(join(dir, at));
  }
}

/** Pulls the listed files into dest, incrementally, leaves only them there, and checks each; returns the staging summary for the record. */
function pullStaging({ remote, staging, proposalId, path, listed, dest }) {
  const files = listed.map((s) => s.path);
  remote.pull(path, dest, { files });
  pruneTo(dest, new Set(files.map((f) => normalize(f).replace(/\/+$/, ''))));
  for (const { path: rel, sha256 } of listed) {
    const local = join(dest, rel);
    if (!existsSync(local)) throw new Error(`dataStaging/${proposalId} lacks ${rel} on ${staging.host}`);
    if (lstatSync(local).isDirectory()) throw new Error(`dataStaging/${proposalId}: staging lists ${rel}, which is a directory; list its files`);
    if (sha256) {
      const got = sha256File(local);
      if (got !== sha256) throw new Error(`${rel} has sha256 ${got}, not ${sha256}`);
    }
  }
  return { host: staging.host, path, files };
}

/**
 * Preprocessing: settles the proposal's organisms against `against`, and
 * writes its whole manual delivery (final/, fromProvider/ with the proposal and
 * staging files, workspace/, the STF corpus files) under the validation
 * workspace's delivery/<proposalId>/, with delivery.json. Every cheap check
 * runs before staging is pulled into delivery/<proposalId>.staging, and every
 * check before the delivery is written. remoteOf(host) gives createRemote options.
 * loadType is for tests; a type with preprocessedFiles also delivers files from
 * <type>-validation/proposals/<id>/preprocess/, recording their provenance.
 * Returns { dir, record, handoff }.
 */
export async function prepareDelivery({ git, ticket, workspace, against, proposalId, settle = {}, remoteOf = (host) => ({ host }), loadType = loadDatasetType }) {
  if (!AGAINST.test(against ?? '')) throw new Error(`--against must be origin/rebuild<RR>; got "${against}"`);
  const { ticket: ref, manifest } = verifiableTicket(git, proposalId, 'its delivery is not prepared');
  if (!git.refExists(against)) throw new Error(`${against} does not exist; fetch it or name another rebuild branch`);
  const status = await ticket.getStatus(ref);
  if (!PREPARABLE.includes(status)) {
    throw new Error(`The ticket ${ref.url} is at "${ticket.statusOption(status)}"; prepare the delivery while it is "${ticket.statusOption('proposed')}" or "${ticket.statusOption('verifying')}"`);
  }
  const datasetType = await loadType(manifest.datasetType);
  const relDir = proposalRelativePath(proposalId);
  const classOf = memoClassOf(null, (_, className) => readDatasetClassOnRef(git, against, className));
  const entries = assertValidEntries(relDir, manifest, datasetType, { read: readerOnRef(git, 'origin/master'), classOf });
  if (!entries.length) throw new Error(`Proposal ${proposalId} has no dataset entries, so it has no delivery`);
  const report = validatorsFor(manifest.datasetType).length ? await currentReport(git, ticket, ref, proposalId) : null;
  const { organisms: settled, stops } = settlementOn(git, manifest, against, settle);
  if (stops.length) {
    throw new Error(`Organism abbreviations need a person before ${proposalId} is delivered:\n  - ${stops.join('\n  - ')}\nResolve each with --settle <proposed>=<abbrev>, then re-run.`);
  }
  const build = await ticket.getBuild(ref);
  const release = await ticket.getRelease(ref);
  const { dir, typeDir, staging, manualDelivery } = openDeliveryDir({ root: workspace, datasetType: manifest.datasetType, proposalId });
  const proposalTree = git.objectId('origin/master', relDir);

  const scratch = mkdtempSync(join(tmpdir(), 'prepare-delivery-'));
  try {
    git.exportTree('origin/master', relDir, scratch);
    const exported = join(scratch, relDir);
    const problems = datasetType.stagingProblems?.(exported) ?? [];
    if (problems.length) throw new Error(`${proposalId}: ${problems.join('; ')}`);

    return await withSettledProposal(exported, manifest, settled, async (d, m) => {
      const locations = entryDeliveries(m, entries, { classOf, constants: constantsOf(d), datasetType });
      const finals = locations.map((l) => l.relative);
      assertDeliverable({ dir, finals });
      const parts = datasetType.corpus
        ? locations.map((l) => ({ abbrev: l.organism, project: projectOf(m, l.organism), datasetName: l.datasetName }))
        : [];
      if (parts.length) {
        const clashes = corpusClashes({ remote: createRemote(remoteOf(manualDelivery.host)), manualRoot: manualDelivery.root, corpus: datasetType.corpus, release, datasets: parts });
        if (clashes.length) throw new Error(`${proposalId} clashes with the STF corpus:\n  - ${clashes.join('\n  - ')}`);
      }
      const files = {};
      for (const l of locations) {
        const rendered = datasetType.renderArtifacts ? datasetType.renderArtifacts(d, l.organism).files : {};
        for (const [name, text] of Object.entries(rendered)) files[join(l.relative, name)] = text;
      }
      for (const p of parts) {
        for (const [name, text] of Object.entries(datasetType.corpusFiles(d, p.abbrev))) files[join(corpusDir(datasetType.corpus, release, p), name)] = text;
      }
      const pre = datasetType.preprocessedFiles
        ? collectPreprocessed({ datasetType, proposalDir: d, proposalId, locations, workArea: workAreaOf(typeDir, proposalId), rendered: files, report })
        : null;
      const sources = pre?.sources ?? {};
      const missing = deliveryProblems(locations, files, sources);
      if (missing.length) throw new Error(`${proposalId}: the delivery lacks what its dataset entries load:\n  - ${missing.join('\n  - ')}`);
      const listed = manifest.staging ?? [];
      const stagingRemote = createRemote(remoteOf(staging.host));
      const stagingPath = listed.length ? stagingSource({ remote: stagingRemote, staging, proposalId, listed }) : null;

      // A cache beside the delivery: a re-run after a failed check pulls only what changed.
      const stagingDir = `${dir}.staging`;
      const stagingSummary = stagingPath ? pullStaging({ remote: stagingRemote, staging, proposalId, path: stagingPath, listed, dest: stagingDir }) : null;
      const record = {
        schemaVersion: DELIVERY_SCHEMA_VERSION, accession: manifest.accession, proposalId, datasetType: manifest.datasetType, proposalTree, against, againstCommit: git.commitOf(against), build, release,
        settlement: settled.map((o) => ({ proposed: o.proposed, abbrev: o.abbrev })),
        staging: stagingSummary,
        corpusStep: datasetType.corpus ? corpusStep(datasetType.corpus, release, manualDelivery) : null,
        handoff: deliveryHandoff({ dir, manualDelivery }),
        ...(pre ? { provenance: pre.provenance } : {}),
        ...(report?.preprocess ? { preprocess: report.preprocess } : {})
      };
      const written = writeDeliveryTree({ dir, finals, files, sources, proposalDir: exported, proposalId, stagingDir: stagingSummary ? stagingDir : null, record });
      rmSync(stagingDir, { recursive: true, force: true });
      return { dir, record: written, handoff: record.handoff };
    });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
