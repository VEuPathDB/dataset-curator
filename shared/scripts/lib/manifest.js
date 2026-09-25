import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { TICKET_SYSTEMS } from './config.js';

export const MANIFEST_FILENAME = 'manifest.json';
export const PROPOSALS_DIR = 'Proposals';
export const proposalRelativePath = (accession) => `${PROPOSALS_DIR}/${accession}`;
export const manifestRelativePath = (accession) => `${proposalRelativePath(accession)}/${MANIFEST_FILENAME}`;
export const SUPPORTED_SCHEMA_VERSIONS = [1];
/** Present for dataset types that produce a classes.xml dataset; all or none. */
export const IDENTITY_FIELDS = ['datasetClass', 'name', 'version'];
export { TICKET_SYSTEMS };

const VALID_PROJECTS = JSON.parse(
  readFileSync(new URL('../../resources/valid-projects.json', import.meta.url), 'utf-8')
);

function datasetTypeExists(datasetType) {
  if (typeof datasetType !== 'string' || !/^[a-z0-9-]+$/.test(datasetType)) return false;
  return existsSync(new URL(`../dataset-types/${datasetType}.js`, import.meta.url));
}

/**
 * Returns an array of error strings; empty means valid.
 * opts.dirName    - proposal directory basename to compare with accession
 * opts.contactIds - known contact ids from allContacts.xml
 */
export function validate(m, { dirName, contactIds } = {}) {
  const errors = [];
  const push = (msg) => errors.push(msg);

  if (!m || typeof m !== 'object' || Array.isArray(m)) return ['manifest must be a JSON object'];

  if (!SUPPORTED_SCHEMA_VERSIONS.includes(m.schemaVersion)) {
    push(`schemaVersion must be one of ${SUPPORTED_SCHEMA_VERSIONS.join(', ')}`);
  }
  if (typeof m.accession !== 'string' || m.accession.length === 0) {
    push('accession is required');
  } else {
    if (!/^[A-Za-z0-9_.]+$/.test(m.accession)) {
      push('accession may contain only letters, digits, underscore and dot');
    }
    if (dirName && dirName !== m.accession) {
      push(`accession "${m.accession}" does not match proposal directory "${dirName}"`);
    }
  }
  if (!datasetTypeExists(m.datasetType)) {
    push(`datasetType "${m.datasetType}" has no renderer in dataset-types/`);
  }
  if (!VALID_PROJECTS.includes(m.project)) {
    push(`project "${m.project}" is not valid; expected one of ${VALID_PROJECTS.join(', ')}`);
  }
  if (typeof m.organismAbbrev !== 'string' || m.organismAbbrev.length === 0) {
    push('organismAbbrev is required');
  } else if (!/^[A-Za-z0-9]+$/.test(m.organismAbbrev)) {
    push('organismAbbrev may contain only letters and digits');
  }
  if (typeof m.targetBuild !== 'string' || !/^\d{2,}$/.test(m.targetBuild)) {
    push('targetBuild must be a string of two or more digits, e.g. "02"');
  }

  const identity = IDENTITY_FIELDS.filter((k) => m[k] !== undefined);
  if (identity.length && identity.length !== IDENTITY_FIELDS.length) {
    push(`${IDENTITY_FIELDS.join(', ')} must be given together`);
  }
  if (m.datasetClass !== undefined && (typeof m.datasetClass !== 'string' || !/^[A-Za-z][A-Za-z0-9]*$/.test(m.datasetClass))) {
    push('datasetClass must be a classes.xml class name');
  }
  if (m.name !== undefined) {
    if (typeof m.name !== 'string' || !/^[A-Za-z][A-Za-z0-9_]*$/.test(m.name)) {
      push('name may contain only letters, digits and underscores, and must start with a letter');
    } else if (typeof m.accession === 'string' && m.accession && m.name.toLowerCase().includes(m.accession.toLowerCase())) {
      push(`name "${m.name}" must be readable, not built from the accession`);
    }
  }
  if (m.version !== undefined &&
      (typeof m.version !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(m.version) || Number.isNaN(Date.parse(m.version)))) {
    push('version must be a date, YYYY-MM-DD');
  }

  if (!m.contacts || typeof m.contacts.primary !== 'string' || m.contacts.primary.length === 0) {
    push('contacts.primary is required');
  }
  if (!m.contacts || !Array.isArray(m.contacts.additional) ||
      !m.contacts.additional.every((id) => typeof id === 'string' && id.length > 0)) {
    push('contacts.additional must be an array of non-empty contact ids');
  }
  if (contactIds && m.contacts) {
    const all = [m.contacts.primary, ...(m.contacts.additional || [])].filter(Boolean);
    for (const id of all) {
      if (!contactIds.includes(id)) push(`contact "${id}" not found in allContacts.xml`);
    }
  }

  if (m.ticket !== undefined) {
    if (!TICKET_SYSTEMS.includes(m.ticket?.system)) push(`ticket.system must be one of ${TICKET_SYSTEMS.join(', ')}`);
    if (typeof m.ticket?.id !== 'string' || m.ticket.id.length === 0) push('ticket.id is required');
    if (typeof m.ticket?.url !== 'string' || !/^https?:\/\//.test(m.ticket.url)) push('ticket.url must be an http(s) URL');
  }

  if (typeof m.curator !== 'string' || !/^[^@\s]+@[^@\s]+$/.test(m.curator)) {
    push('curator must be an email address');
  }
  if (typeof m.createdAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(m.createdAt) ||
      Number.isNaN(Date.parse(m.createdAt))) {
    push('createdAt must be an ISO 8601 UTC timestamp, e.g. 2026-09-18T14:00:00.000Z');
  }
  if (!m.skill || typeof m.skill.name !== 'string' || typeof m.skill.version !== 'string') {
    push('skill.name and skill.version are required');
  }
  return errors;
}

export function assertValid(m, opts) {
  const errors = validate(m, opts);
  if (errors.length > 0) {
    throw new Error(`Invalid manifest:\n  - ${errors.join('\n  - ')}`);
  }
}

export function read(proposalDir, opts = {}) {
  const path = join(proposalDir, MANIFEST_FILENAME);
  if (!existsSync(path)) throw new Error(`No ${MANIFEST_FILENAME} in ${proposalDir}`);
  let m;
  try {
    m = JSON.parse(readFileSync(path, 'utf-8'));
  } catch (e) {
    throw new Error(`${path} is not valid JSON: ${e.message}`);
  }
  assertValid(m, { dirName: basename(proposalDir), ...opts });
  return m;
}

export function write(proposalDir, m, opts = {}) {
  assertValid(m, { dirName: basename(proposalDir), ...opts });
  mkdirSync(proposalDir, { recursive: true });
  writeFileSync(join(proposalDir, MANIFEST_FILENAME), JSON.stringify(m, null, 2) + '\n');
}

/**
 * Reads Proposals/<accession>/manifest.json as it stands on a git ref.
 * Returns the validated manifest, or null when the proposal is not on the ref.
 */
export function readOnRef(git, ref, accession, opts = {}) {
  const path = manifestRelativePath(accession);
  if (!git.fileExistsOnRef(ref, path)) return null;
  let m;
  try {
    m = JSON.parse(git.showFile(ref, path));
  } catch (e) {
    throw new Error(`${ref}:${path} is not valid JSON: ${e.message}`);
  }
  assertValid(m, { dirName: accession, ...opts });
  return m;
}
