#!/usr/bin/env node
/**
 * genome-pipeline.js - NCBI annotated genome in, ISF-ready partitions and genome-build.json out.
 * Spec: docs/superpowers/specs/2026-11-04-gff-pipeline-design.md
 */
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { formatFinding } from './checks.js';
import { runBuild } from './commands/build.js';
import { runFetch } from './commands/fetch.js';
import { runFinalize } from './commands/finalize.js';
import { runSurvey } from './commands/survey.js';

const USAGE = [
  'Usage: node genome-pipeline.js fetch <assemblyAccession> --workDir <dir>',
  '       node genome-pipeline.js survey --workDir <dir> --apiCommonData <ApiCommonData checkout>',
  '       node genome-pipeline.js build --workDir <dir> --apiCommonData <ApiCommonData checkout>',
  '       node genome-pipeline.js finalize --workDir <dir> --apiCommonData <ApiCommonData checkout> [--preprocessGFF3 <script>]'
].join('\n');

const COMMANDS = ['fetch', 'survey', 'build', 'finalize'];

function fail(message) {
  console.error(message);
  process.exit(1);
}

const print = (lines) => console.log(lines.join('\n'));

async function main() {
  const { values, positionals } = parseArgs({
    options: { workDir: { type: 'string' }, apiCommonData: { type: 'string' }, preprocessGFF3: { type: 'string' } },
    allowPositionals: true
  });
  const [command, ...rest] = positionals;
  if (!COMMANDS.includes(command)) fail(USAGE);
  const { workDir, apiCommonData, preprocessGFF3 } = values;
  if (!workDir) fail(`--workDir is required.\n${USAGE}`);

  if (command === 'fetch') {
    if (rest.length !== 1) fail(`fetch takes one assembly accession.\n${USAGE}`);
    const record = await runFetch({ workDir, accession: rest[0] });
    print([`Fetched ${record.assembly} into ${join(workDir, 'fetch')}`,
      ...Object.entries(record.files).map(([role, f]) => `  ${role}: ${f.name} (sha256 ${f.sha256.slice(0, 12)})`)]);
  } else if (command === 'survey') {
    const survey = await runSurvey({ workDir, apiCommonData });
    print([...survey.findings.map(formatFinding), `Suggested recipe: ${JSON.stringify(survey.suggestedRecipe)}`, `Wrote ${join(workDir, 'survey.json')}`]);
  } else if (command === 'build') {
    const record = await runBuild({ workDir, apiCommonData });
    print([...record.transforms.map((t) => `  ${t.name}: ${t.changes}`), ...record.warnings.map((w) => `warning: ${w}`),
      ...record.findings.map(formatFinding), `Wrote ${join(workDir, 'build')} (normalized.gff3 sha256 ${record.normalized.sha256.slice(0, 12)})`]);
  } else {
    const record = await runFinalize({ workDir, apiCommonData, preprocessGFF3 });
    const dirty = record.apiCommonData.dirty ? ['warning: the ApiCommonData checkout has uncommitted changes; genome-build.json records that'] : [];
    print([...record.partitions.map((part) => `  ${part.dir}: ${part.sequenceCount} sequences`), ...dirty, `Wrote ${join(workDir, 'genome-build.json')}`]);
  }
}

main().catch((err) => fail(`Error: ${err.message}`));
