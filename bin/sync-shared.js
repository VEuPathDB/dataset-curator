#!/usr/bin/env node
/**
 * sync-shared.js - Syncs shared files into skills, or with --check reports copies that differ.
 *
 * Usage: node bin/sync-shared.js [--check]
 *        yarn sync-shared
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Copies each package.json sharedFiles source into its skills, or with check compares them
 * byte for byte and writes nothing. Returns { synced, errors, problems }.
 */
export function syncShared({ rootDir, check = false, log = console.log, error = console.error }) {
  const sharedFiles = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf-8')).sharedFiles || {};
  let synced = 0;
  let errors = 0;
  const problems = [];
  for (const [sharedPath, targetSkills] of Object.entries(sharedFiles)) {
    const sourcePath = join(rootDir, 'shared', sharedPath);
    if (!existsSync(sourcePath)) {
      error(`✗ Source file not found: shared/${sharedPath}`);
      errors++;
      continue;
    }
    const content = readFileSync(sourcePath);
    for (const skill of targetSkills) {
      const rel = `skills/${skill}/${sharedPath}`;
      const targetPath = join(rootDir, rel);
      if (check) {
        if (!existsSync(targetPath)) problems.push(`${rel} is missing`);
        else if (!readFileSync(targetPath).equals(content)) problems.push(`${rel} differs from shared/${sharedPath}`);
        continue;
      }
      try {
        mkdirSync(dirname(targetPath), { recursive: true });
        writeFileSync(targetPath, content);
        log(`✓ Synced shared/${sharedPath} → ${rel}`);
        synced++;
      } catch (e) {
        error(`✗ Failed to sync to ${rel}: ${e.message}`);
        errors++;
      }
    }
  }
  return { synced, errors, problems };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
  if (!check) console.log('Syncing shared files into skills...\n');
  const { synced, errors, problems } = syncShared({ rootDir, check });
  for (const p of problems) console.error(`✗ ${p}`);
  if (check) console.log(problems.length || errors ? `\n${problems.length} out of sync, ${errors} errors` : 'All shared copies match.');
  else console.log(`\nSync complete: ${synced} files synced, ${errors} errors`);
  if (errors || problems.length) process.exit(1);
}
