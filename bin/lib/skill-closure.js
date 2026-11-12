/**
 * skill-closure.js - What a skill actually reaches, and which shared copies it carries for nothing.
 *
 * Roots: SKILL.md and every resources/*.md (the docs a skill is run from), every top-level scripts/*.js
 * (the CLIs), and any scripts/... path a doc names (e.g. scripts/genome/genome-pipeline.js).
 * Edges: static and dynamic relative imports (a static import that does not resolve is an error; a dynamic
 * import() of a file the skill does not carry is optional, as in the dataset-type loaders), and string literals naming a file that exists
 * (resources/*.json, a sibling script). Computed dynamic import paths are invisible here: use literal paths.
 * skills/<skill>/closure-roots.json (optional) can still add roots by hand.
 */

import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const CODE = /\.(js|mjs|cjs)$/;
const IMPORT = /(\bimport\s*\(\s*|\bfrom\s+|\brequire\s*\(\s*|\bimport\s+)['"`](\.[^'"`]+)['"`]/g;
const FILE_STRING = /['"`]([\w./-]+\.(?:json|md|js|tsv|yaml|yml|txt|xml|pl|R|sql|sh|py))['"`]/g;
const DOC_SCRIPT = /\b(scripts\/[\w./-]+\.js)\b/g;

const isFile = (p) => existsSync(p) && statSync(p).isFile();

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)]));
}

const resolveImport = (from, spec) => {
  const p = resolve(dirname(from), spec);
  return [p, `${p}.js`, join(p, 'index.js')].find(isFile);
};

/**
 * Returns { reachable: Set<abs path>, unresolved: [{ file, spec }], carried: [rel paths of every script and
 * resource file in the skill] } for the skill at skillDir.
 */
export function analyzeSkill(skillDir) {
  const reachable = new Set();
  const unresolved = [];
  const queue = [];
  const visit = (f) => {
    if (!isFile(f) || reachable.has(f)) return;
    reachable.add(f);
    queue.push(f);
  };

  const scripts = join(skillDir, 'scripts');
  const docs = [join(skillDir, 'SKILL.md'), ...walk(join(skillDir, 'resources')).filter((f) => f.endsWith('.md'))].filter(isFile);
  for (const d of docs) visit(d);
  if (existsSync(scripts)) for (const e of readdirSync(scripts, { withFileTypes: true })) if (e.isFile() && CODE.test(e.name)) visit(join(scripts, e.name));
  for (const d of docs) for (const [, rel] of readFileSync(d, 'utf-8').matchAll(DOC_SCRIPT)) visit(join(skillDir, rel));
  const declared = join(skillDir, 'closure-roots.json');
  if (isFile(declared)) for (const rel of JSON.parse(readFileSync(declared, 'utf-8'))) visit(join(skillDir, rel));

  while (queue.length) {
    const f = queue.pop();
    if (!CODE.test(f)) continue;
    const text = readFileSync(f, 'utf-8');
    for (const [, how, spec] of text.matchAll(IMPORT)) {
      const target = resolveImport(f, spec);
      if (target) visit(target);
      else if (!how.startsWith('import(')) unresolved.push({ file: relative(skillDir, f), spec });
    }
    for (const [, name] of text.matchAll(FILE_STRING)) {
      const target = [dirname(f), skillDir, join(skillDir, 'resources'), scripts].map((d) => resolve(d, name)).find(isFile);
      if (target) visit(target);
    }
  }

  const carried = [...walk(scripts), ...walk(join(skillDir, 'resources'))].map((f) => relative(skillDir, f)).sort();
  return { reachable, unresolved, carried };
}

/** Files the skill carries that nothing reaches (relative to the skill dir). */
export function unreachableFiles(skillDir) {
  const { reachable, carried } = analyzeSkill(skillDir);
  return carried.filter((rel) => !reachable.has(join(skillDir, rel)));
}

export function skillDirs(rootDir) {
  const base = join(rootDir, 'skills');
  return readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => join(base, d.name)).sort();
}
