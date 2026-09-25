import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { read as readManifest } from '../lib/manifest.js';

export const PRESENTER_FILENAME = 'presenter.json';
export const PRESENTER_SCHEMA_VERSION = 1;
export const TEXT_FIELDS = [
  'displayName', 'shortDisplayName', 'shortAttribution', 'summary', 'description',
  'methodology', 'protocol', 'caveat', 'acknowledgement', 'releasePolicy'
];
export const PRESENTER_OVERRIDE_KEYS = [...TEXT_FIELDS, 'pubmedIds', 'injectorProps'];
const ALWAYS_REQUIRED = ['displayName', 'summary', 'description'];
const XML_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;

/** Mirrors datasetTypeExists in lib/manifest.js: both derive the datasetType path from datasetType. */
export function loadDatasetType(datasetType) {
  return import(new URL(`./${datasetType}.js`, import.meta.url));
}

export function loadManifest(proposalDir) {
  return readManifest(proposalDir);
}

function parseJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch (e) {
    throw new Error(`${path} is not valid JSON: ${e.message}`);
  }
}

export function readInputJson(proposalDir, filename, { optional = false } = {}) {
  const path = join(proposalDir, 'inputs', filename);
  if (!existsSync(path)) {
    if (optional) return null;
    throw new Error(`Required input missing: ${path}`);
  }
  return parseJson(path);
}

export function findInputBySuffix(proposalDir, suffix) {
  const dir = join(proposalDir, 'inputs');
  if (!existsSync(dir)) return null;
  const matches = readdirSync(dir).sort().filter(f => f.endsWith(suffix));
  if (matches.length > 1) throw new Error(`Multiple ${suffix} files in ${dir}: ${matches.join(', ')}`);
  return matches.length ? readFileSync(join(dir, matches[0]), 'utf-8') : null;
}

export const OVERRIDE_SECTIONS = ['name', 'version', 'presenter', 'dataset'];
const DATASET_OVERRIDE_KEYS = ['props', 'source'];

const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

/**
 * Curator overrides: { name, version, presenter: {...}, dataset: { props, source } }.
 * An unknown key is a typo, not a no-op, so it is refused.
 */
export function readOverrides(path) {
  if (!path) return {};
  const o = parseJson(path);
  if (!isObject(o)) throw new Error(`${path} must be a JSON object`);
  const flat = Object.keys(o).filter(k => PRESENTER_OVERRIDE_KEYS.includes(k));
  if (flat.length) {
    throw new Error(`${path}: ${flat.join(', ')} now go under "presenter", e.g. { "presenter": { "${flat[0]}": ... } }`);
  }
  const refuse = (where, keys, allowed) => {
    const unknown = keys.filter(k => !allowed.includes(k));
    if (unknown.length) throw new Error(`${path}: unknown ${where}keys ${unknown.join(', ')}; allowed: ${allowed.join(', ')}`);
  };
  refuse('', Object.keys(o), OVERRIDE_SECTIONS);
  for (const [section, allowed] of [['presenter', PRESENTER_OVERRIDE_KEYS], ['dataset', DATASET_OVERRIDE_KEYS]]) {
    if (o[section] === undefined) continue;
    if (!isObject(o[section])) throw new Error(`${path}: "${section}" must be an object`);
    refuse(`${section} `, Object.keys(o[section]), allowed);
  }
  return o;
}

/** Throws unless the manifest carries the identity this dataset type needs. */
export function requireIdentity(m, datasetClass) {
  if (m.datasetClass !== datasetClass || !m.name || !m.version) {
    throw new Error(`Proposal ${m.accession} needs datasetClass "${datasetClass}", name and version in its manifest; re-run write-proposal.js`);
  }
}

/** Derived values first, curator overrides on top; injectorProps merge by name. */
export function applyOverrides(derived, overrides = {}) {
  const { injectorProps, ...rest } = overrides;
  return { ...derived, ...rest, injectorProps: { ...derived.injectorProps, ...injectorProps } };
}

export const presenterPath = (proposalDir) => join(proposalDir, 'curated', PRESENTER_FILENAME);

/** Returns error strings; empty means the record can be rendered. */
export function validatePresenter(p, { requiredFields = [] } = {}) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return ['presenter must be a JSON object'];
  const errors = [];
  if (p.schemaVersion !== PRESENTER_SCHEMA_VERSION) errors.push(`schemaVersion must be ${PRESENTER_SCHEMA_VERSION}`);
  if (p.name !== undefined) errors.push('name is derived from the manifest and must not be stored in the presenter record');
  for (const f of TEXT_FIELDS) {
    if (typeof p[f] !== 'string') errors.push(`${f} must be a string`);
  }
  for (const f of [...ALWAYS_REQUIRED, ...requiredFields]) {
    if (typeof p[f] === 'string' && p[f].trim() === '') errors.push(`${f} is required and is empty`);
  }
  if (!Array.isArray(p.pubmedIds) || !p.pubmedIds.every(id => typeof id === 'string' && /^\d+$/.test(id))) {
    errors.push('pubmedIds must be an array of numeric strings');
  }
  if (!Array.isArray(p.links) || !p.links.every(l => typeof l?.text === 'string' && /^https?:\/\//.test(l?.url))) {
    errors.push('links must be an array of { text, url } with http(s) URLs');
  }
  for (const key of ['history', 'injectorProps']) {
    const v = p[key];
    if (!v || typeof v !== 'object' || Array.isArray(v) || !Object.values(v).every(x => typeof x === 'string')) {
      errors.push(`${key} must be an object of string values`);
    } else {
      for (const name of Object.keys(v)) {
        if (!XML_NAME.test(name)) errors.push(`${key} has an invalid name "${name}"`);
      }
    }
  }
  return errors;
}

export function assertValidPresenter(p, opts, where = PRESENTER_FILENAME) {
  const errors = validatePresenter(p, opts);
  if (errors.length) throw new Error(`Invalid ${where}:\n  - ${errors.join('\n  - ')}`);
}

export function readPresenter(proposalDir, opts) {
  const path = presenterPath(proposalDir);
  if (!existsSync(path)) throw new Error(`No curated/${PRESENTER_FILENAME} in ${proposalDir}; re-run write-proposal.js`);
  const p = parseJson(path);
  assertValidPresenter(p, opts, path);
  return p;
}

export function escapeForCDATA(text) {
  return String(text).replace(/\]\]>/g, ']]&gt;');
}

export function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function contactElements(ids) {
  return ids.map(id => `    <contactId>${escapeXml(id)}</contactId>`).join('\n');
}

export function pubmedElements(ids) {
  return ids.map(id => `    <pubmedId>${escapeXml(id)}</pubmedId>`).join('\n');
}

export function linkElements(links) {
  return links.map(l => `    <link>
      <text>${escapeXml(l.text)}</text>
      <url>${escapeXml(l.url)}</url>
    </link>`).join('\n');
}


/** Renders <prop> lines: the datasetType's current defaults, replaced by name from the presenter record. */
export function injectorProps(defaults, chosen = {}) {
  return Object.entries({ ...defaults, ...chosen })
    .map(([name, value]) => `      <prop name="${escapeXml(name)}">${escapeXml(value)}</prop>`)
    .join('\n');
}

/** Returns chosen prop names absent from the datasetType's injectorDefaults, for the CLI's stderr warning. */
export function unknownInjectorProps(defaults, chosen = {}) {
  return Object.keys(chosen).filter(k => !(k in defaults));
}
