#!/usr/bin/env node
/**
 * skill-closure.js - Reports, per skill, imports that do not resolve and copied files nothing reaches.
 *
 * Usage: node bin/skill-closure.js [skill ...]
 */

import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeSkill, skillDirs, unreachableFiles } from './lib/skill-closure.js';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const wanted = process.argv.slice(2);
let bad = 0;
for (const dir of skillDirs(rootDir)) {
  if (wanted.length && !wanted.includes(basename(dir))) continue;
  const { unresolved, carried } = analyzeSkill(dir);
  const unused = unreachableFiles(dir);
  console.log(`${basename(dir)}: ${carried.length} files carried, ${unused.length} unreachable, ${unresolved.length} unresolved imports`);
  for (const u of unresolved) console.log(`  unresolved  ${u.file} -> ${u.spec}`);
  for (const f of unused) console.log(`  unreachable ${f}`);
  bad += unresolved.length;
}
process.exit(bad ? 1 : 0);
