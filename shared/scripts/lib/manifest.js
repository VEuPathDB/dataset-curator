import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';

export const MANIFEST_FILENAME = 'manifest.json';
export const SUPPORTED_SCHEMA_VERSIONS = [1];
export const TICKET_SYSTEMS = ['redmine', 'github'];

const VALID_PROJECTS = JSON.parse(
  readFileSync(new URL('../../resources/valid-projects.json', import.meta.url), 'utf-8')
);

function rendererExists(datasetType) {
  if (typeof datasetType !== 'string' || !/^[a-z0-9-]+$/.test(datasetType)) return false;
  return existsSync(new URL(`../renderers/${datasetType}.js`, import.meta.url));
}

/**
 * Returns an array of error strings; empty means valid.
 * opts.dirName    - proposal directory basename to compare with accession
 * opts.contactIds - known contact ids from allContacts.xml
 */
export function validate(m, { dirName, contactIds } = {}) {
  const errors = [];
  const push = (msg) => errors.push(msg);

  if (!SUPPORTED_SCHEMA_VERSIONS.includes(m.schemaVersion)) {
    push(`schemaVersion must be one of ${SUPPORTED_SCHEMA_VERSIONS.join(', ')}`);
  }
  if (typeof m.accession !== 'string' || m.accession.length === 0) {
    push('accession is required');
  } else if (dirName && dirName !== m.accession) {
    push(`accession "${m.accession}" does not match proposal directory "${dirName}"`);
  }
  if (!rendererExists(m.datasetType)) {
    push(`datasetType "${m.datasetType}" has no renderer in renderers/`);
  }
  if (!VALID_PROJECTS.includes(m.project)) {
    push(`project "${m.project}" is not valid; expected one of ${VALID_PROJECTS.join(', ')}`);
  }
  if (typeof m.organismAbbrev !== 'string' || m.organismAbbrev.length === 0) {
    push('organismAbbrev is required');
  }
  if (typeof m.targetBuild !== 'string' || !/^\d{2,}$/.test(m.targetBuild)) {
    push('targetBuild must be a string of two or more digits, e.g. "02"');
  }

  if (!m.contacts || typeof m.contacts.primary !== 'string' || m.contacts.primary.length === 0) {
    push('contacts.primary is required');
  }
  if (!m.contacts || !Array.isArray(m.contacts.additional)) {
    push('contacts.additional must be an array');
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
  if (typeof m.createdAt !== 'string' || Number.isNaN(Date.parse(m.createdAt))) {
    push('createdAt must be an ISO 8601 timestamp');
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
  const m = JSON.parse(readFileSync(path, 'utf-8'));
  assertValid(m, { dirName: basename(proposalDir), ...opts });
  return m;
}

export function write(proposalDir, m, opts = {}) {
  assertValid(m, { dirName: basename(proposalDir), ...opts });
  writeFileSync(join(proposalDir, MANIFEST_FILENAME), JSON.stringify(m, null, 2) + '\n');
}
