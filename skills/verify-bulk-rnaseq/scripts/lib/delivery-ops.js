import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { proposalRelativePath, organismsOf, projectOf } from './manifest.js';
import { verifiableTicket, currentReport } from './verification-ops.js';
import { validatorsFor } from '../dataset-types/validators.js';
import { loadDatasetType } from '../dataset-types/index.js';
import { readDatasetClassOnRef } from './dataset-classes.js';
import { settlementOn, withSettledProposal } from './load-ops.js';
import { deliveryLocation } from './artifacts.js';
import { openDeliveryDir } from './validation-workspace.js';
import { createRemote } from './remote.js';
import { corpusDir, corpusClashes, corpusStep } from './corpus.js';
import { writeDeliveryTree, assertDeliverable, deliveryHandoff, DELIVERY_SCHEMA_VERSION } from './delivery.js';

const AGAINST = /^origin\/rebuild\d+$/;
const PREPARABLE = ['proposed', 'verifying'];

/** dataStaging/<accession>/ once checked to be there and not to collide with the proposal copy. */
function stagingSource({ remote, staging, accession, proposalId }) {
  const path = join(staging.root, accession);
  const top = remote.list(path);
  if (top === null) throw new Error(`dataStaging/${accession} is missing on ${staging.host} (${path}); the data provider's files must be there first`);
  if (top.includes(proposalId)) throw new Error(`dataStaging/${accession} has an entry named ${proposalId}, which would collide with the proposal copy in fromProvider/`);
  return path;
}

/** Pulls path into dest, incrementally, and checks every listed file; returns the staging summary for the record. */
function pullStaging({ remote, staging, accession, path, listed, dest }) {
  remote.pull(path, dest);
  for (const { path: rel, sha256 } of listed) {
    const local = join(dest, rel);
    if (!existsSync(local)) throw new Error(`dataStaging/${accession} lacks ${rel} on ${staging.host}`);
    if (sha256) {
      const got = createHash('sha256').update(readFileSync(local)).digest('hex');
      if (got !== sha256) throw new Error(`${rel} has sha256 ${got}, not ${sha256}`);
    }
  }
  return { host: staging.host, path, files: listed.map((s) => s.path) };
}

/**
 * Preprocessing: settles the proposal's organisms against `against`, and
 * writes its whole manual delivery (final/, fromProvider/ with the proposal and
 * staging files, workspace/, the STF corpus files) under the validation
 * workspace's delivery/<proposalId>/, with delivery.json. Every cheap check
 * runs before staging is pulled into delivery/<proposalId>.staging, and every
 * check before the delivery is written. remoteOf(host) gives createRemote options.
 * Returns { dir, record, handoff }.
 */
export async function prepareDelivery({ git, ticket, workspace, against, proposalId, settle = {}, remoteOf = (host) => ({ host }) }) {
  if (!AGAINST.test(against ?? '')) throw new Error(`--against must be origin/rebuild<RR>; got "${against}"`);
  const { ticket: ref, manifest } = verifiableTicket(git, proposalId, 'its delivery is not prepared');
  if (!git.refExists(against)) throw new Error(`${against} does not exist; fetch it or name another rebuild branch`);
  const status = await ticket.getStatus(ref);
  if (!PREPARABLE.includes(status)) {
    throw new Error(`The ticket ${ref.url} is at "${ticket.statusOption(status)}"; prepare the delivery while it is "${ticket.statusOption('proposed')}" or "${ticket.statusOption('verifying')}"`);
  }
  const datasetType = await loadDatasetType(manifest.datasetType);
  if (!datasetType.datasetClass) throw new Error(`${manifest.datasetType} has no dataset class yet, so it has no delivery`);
  if (validatorsFor(manifest.datasetType).length) await currentReport(git, ticket, ref, proposalId);
  const { organisms: settled, stops } = settlementOn(git, manifest, against, settle);
  if (stops.length) {
    throw new Error(`Organism abbreviations need a person before ${proposalId} is delivered:\n  - ${stops.join('\n  - ')}\nResolve each with --settle <proposed>=<abbrev>, then re-run.`);
  }
  const build = await ticket.getBuild(ref);
  const release = await ticket.getRelease(ref);
  const { dir, staging, manualDelivery } = openDeliveryDir({ root: workspace, datasetType: manifest.datasetType, proposalId });
  const classDef = readDatasetClassOnRef(git, against, datasetType.datasetClass);
  const relDir = proposalRelativePath(proposalId);
  const proposalTree = git.objectId('origin/master', relDir);

  const scratch = mkdtempSync(join(tmpdir(), 'prepare-delivery-'));
  try {
    git.exportTree('origin/master', relDir, scratch);
    const exported = join(scratch, relDir);
    const problems = datasetType.stagingProblems(exported);
    if (problems.length) throw new Error(`${proposalId}: ${problems.join('; ')}`);

    return await withSettledProposal(exported, manifest, settled, async (d, m) => {
      const parts = organismsOf(m).map((abbrev) => {
        const datasetName = datasetType.datasetNameFor(abbrev, m.name);
        return { abbrev, project: projectOf(m, abbrev), datasetName, delivery: deliveryLocation(m, classDef, abbrev) };
      });
      const finals = parts.map((p) => p.delivery.relative);
      assertDeliverable({ dir, finals });
      const clashes = corpusClashes({ remote: createRemote(remoteOf(manualDelivery.host)), manualRoot: manualDelivery.root, corpus: datasetType.corpus, release, datasets: parts });
      if (clashes.length) throw new Error(`${proposalId} clashes with the STF corpus:\n  - ${clashes.join('\n  - ')}`);
      const files = {};
      for (const p of parts) {
        for (const [name, text] of Object.entries(datasetType.renderArtifacts(d, p.abbrev).files)) files[join(p.delivery.relative, name)] = text;
        for (const [name, text] of Object.entries(datasetType.corpusFiles(d, p.abbrev))) files[join(corpusDir(datasetType.corpus, release, p), name)] = text;
      }
      const listed = manifest.staging ?? [];
      const stagingRemote = createRemote(remoteOf(staging.host));
      const stagingPath = listed.length ? stagingSource({ remote: stagingRemote, staging, accession: manifest.accession, proposalId }) : null;

      // A cache beside the delivery: a re-run after a failed check pulls only what changed.
      const stagingDir = `${dir}.staging`;
      const stagingSummary = stagingPath ? pullStaging({ remote: stagingRemote, staging, accession: manifest.accession, path: stagingPath, listed, dest: stagingDir }) : null;
      const record = {
        schemaVersion: DELIVERY_SCHEMA_VERSION, accession: manifest.accession, proposalId, datasetType: manifest.datasetType, proposalTree, against, build, release,
        settlement: settled.map((o) => ({ proposed: o.proposed, abbrev: o.abbrev })),
        staging: stagingSummary,
        corpusStep: corpusStep(datasetType.corpus, release, manualDelivery),
        handoff: deliveryHandoff({ dir, manualDelivery })
      };
      const written = writeDeliveryTree({ dir, finals, files, proposalDir: exported, proposalId, stagingDir: stagingSummary ? stagingDir : null, record });
      rmSync(stagingDir, { recursive: true, force: true });
      return { dir, record: written, handoff: record.handoff };
    });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
