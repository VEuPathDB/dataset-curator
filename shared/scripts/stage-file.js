#!/usr/bin/env node
/**
 * stage-file.js - Uploads the curator's file to dataStaging/<proposal>/ on the staging host (curator.config.json "staging"),
 * and writes .curation/tmp/<proposal>_staged.json for write-proposal.js. Prints the "staging" override to pass.
 *
 * Usage: node stage-file.js <proposal> <file>
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { openWorkspace } from './lib/config.js';
import { stageFile } from './lib/staging-upload.js';

function main() {
  const [proposalId, file] = process.argv.slice(2);
  if (!proposalId || !file) { console.error('Usage: node stage-file.js <proposal> <file>'); process.exit(1); }
  const config = openWorkspace();
  const { host, root } = config.staging ?? {};
  if (!host || !root) throw new Error(`${config.configPath} has no "staging": { "host", "root" }`);
  const staged = stageFile({ host, root, proposalId, localPath: resolve(file) });
  const path = resolve(`.curation/tmp/${proposalId}_staged.json`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ schemaVersion: 1, host: staged.host, path: staged.path, file: staged.file, sha256: staged.sha256, bytes: staged.bytes }, null, 2) + '\n');
  console.error(staged.alreadyStaged ? `${staged.file} was already staged at ${host}:${staged.path}` : `Staged ${staged.file} at ${host}:${staged.path}`);
  console.error(`Pass in --overrides: "staging": ${JSON.stringify([{ path: staged.file, sha256: staged.sha256 }])}`);
  console.log(path);
}

try { main(); } catch (err) { console.error(`Error: ${err.message}`); process.exit(1); }
