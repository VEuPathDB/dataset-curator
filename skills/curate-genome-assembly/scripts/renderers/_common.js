import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { read as readManifest } from '../lib/manifest.js';

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

export function loadOverrides(proposalDir) {
  const path = join(proposalDir, 'curated', 'presenter-overrides.json');
  return existsSync(path) ? parseJson(path) : {};
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
  for (const id of ids) {
    if (!/^\d+$/.test(id)) throw new Error(`Invalid PubMed id "${id}"`);
  }
  return ids.map(id => `    <pubmedId>${escapeXml(id)}</pubmedId>`).join('\n');
}

const INJECTOR_PROP_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;

/** Renders <prop> lines, letting overrides.injectorProps replace defaults by name. */
export function injectorProps(defaults, overrides = {}) {
  return Object.entries({ ...defaults, ...overrides })
    .map(([name, value]) => {
      if (!INJECTOR_PROP_NAME.test(name)) throw new Error(`Invalid injector prop name "${name}"`);
      return `      <prop name="${escapeXml(name)}">${escapeXml(value)}</prop>`;
    })
    .join('\n');
}

/** Returns override keys absent from the renderer's injectorDefaults, for the CLI's stderr warning. */
export function unknownInjectorProps(defaults, overrides = {}) {
  return Object.keys(overrides).filter(k => !(k in defaults));
}
