import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { read as readManifest } from '../lib/manifest.js';

export function loadManifest(proposalDir) {
  return readManifest(proposalDir);
}

export function readInputJson(proposalDir, filename, { optional = false } = {}) {
  const path = join(proposalDir, 'inputs', filename);
  if (!existsSync(path)) {
    if (optional) return null;
    throw new Error(`Required input missing: ${path}`);
  }
  return JSON.parse(readFileSync(path, 'utf-8'));
}

export function findInputBySuffix(proposalDir, suffix) {
  const dir = join(proposalDir, 'inputs');
  if (!existsSync(dir)) return null;
  const name = readdirSync(dir).sort().find(f => f.endsWith(suffix));
  return name ? readFileSync(join(dir, name), 'utf-8') : null;
}

export function loadOverrides(proposalDir) {
  const path = join(proposalDir, 'curated', 'presenter-overrides.json');
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf-8')) : {};
}

export function escapeForCDATA(text) {
  return String(text).replace(/\]\]>/g, ']]&gt;');
}

export function contactElements(ids) {
  return ids.map(id => `    <contactId>${id}</contactId>`).join('\n');
}

export function pubmedElements(ids) {
  return ids.map(id => `    <pubmedId>${id}</pubmedId>`).join('\n');
}

/** Renders <prop> lines, letting overrides.injectorProps replace defaults by name. */
export function injectorProps(defaults, overrides = {}) {
  return Object.entries({ ...defaults, ...overrides })
    .map(([name, value]) => `      <prop name="${name}">${value}</prop>`)
    .join('\n');
}
