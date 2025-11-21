#!/usr/bin/env node
/**
 * sync-shared.js - Syncs shared files into skills
 *
 * Reads the `sharedFiles` configuration from package.json and copies
 * files from shared/ into the specified skill directories.
 *
 * Usage: node bin/sync-shared.js
 *        yarn sync-shared
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

// Read package.json
const packageJsonPath = join(rootDir, 'package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));

const sharedFiles = packageJson.sharedFiles || {};

if (Object.keys(sharedFiles).length === 0) {
  console.log('No shared files configured in package.json');
  process.exit(0);
}

console.log('Syncing shared files into skills...\n');

let syncCount = 0;
let errorCount = 0;

for (const [sharedPath, targetSkills] of Object.entries(sharedFiles)) {
  const sourcePath = join(rootDir, 'shared', sharedPath);

  // Check if source file exists
  if (!existsSync(sourcePath)) {
    console.error(`✗ Source file not found: shared/${sharedPath}`);
    errorCount++;
    continue;
  }

  // Copy to each target skill
  for (const skill of targetSkills) {
    const targetPath = join(rootDir, 'skills', skill, sharedPath);
    const targetDir = dirname(targetPath);

    try {
      // Create target directory if it doesn't exist
      if (!existsSync(targetDir)) {
        mkdirSync(targetDir, { recursive: true });
      }

      // Read source content
      const content = readFileSync(sourcePath, 'utf-8');

      // Write to target
      writeFileSync(targetPath, content, 'utf-8');

      console.log(`✓ Synced shared/${sharedPath} → skills/${skill}/${sharedPath}`);
      syncCount++;
    } catch (error) {
      console.error(`✗ Failed to sync to skills/${skill}/${sharedPath}: ${error.message}`);
      errorCount++;
    }
  }
}

console.log(`\nSync complete: ${syncCount} files synced, ${errorCount} errors`);

if (errorCount > 0) {
  process.exit(1);
}
