#!/usr/bin/env node
/**
 * genome-pipeline.js - NCBI annotated genome in, ISF-ready partitions and genome-build.json out; `trial` loads them into GUS,
 * `functional` writes the functional annotation files.
 * Specs: docs/superpowers/specs/2026-11-04-gff-pipeline-design.md, docs/superpowers/specs/2026-11-05-trial-isf-runner-design.md,
 * docs/superpowers/specs/2026-11-05-functional-extraction-design.md
 */
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { formatFinding } from './checks.js';
import { runBuild } from './commands/build.js';
import { runFetch } from './commands/fetch.js';
import { runFinalize } from './commands/finalize.js';
import { runFunctional } from './commands/functional.js';
import { runSurvey } from './commands/survey.js';
import { runTrial, runTrialUndo } from './commands/trial.js';
import { PipelineError } from './workdir.js';

const USAGE = [
  'Usage: node genome-pipeline.js fetch <assemblyAccession> --workDir <dir>',
  '       node genome-pipeline.js survey --workDir <dir> --apiCommonData <ApiCommonData checkout>',
  '       node genome-pipeline.js build --workDir <dir> --apiCommonData <ApiCommonData checkout>',
  '       node genome-pipeline.js finalize --workDir <dir> --apiCommonData <ApiCommonData checkout> [--preprocessGFF3 <script>]',
  '       node genome-pipeline.js functional --workDir <dir>',
  '       node genome-pipeline.js trial --workDir <dir> --image <name> --gusConfig <file> --taxonId <ncbi taxon id> [--keep]',
  '       node genome-pipeline.js trial --workDir <dir> --image <name> --gusConfig <file> --undo'
].join('\n');

const ACCEPTED = {
  fetch: ['workDir'],
  survey: ['workDir', 'apiCommonData'],
  build: ['workDir', 'apiCommonData'],
  finalize: ['workDir', 'apiCommonData', 'preprocessGFF3'],
  functional: ['workDir'],
  trial: ['workDir', 'image', 'gusConfig', 'taxonId', 'keep', 'undo']
};
const COMMANDS = Object.keys(ACCEPTED);

function fail(message, exitCode = 1) {
  console.error(message);
  process.exit(exitCode);
}

const print = (lines) => console.log(lines.join('\n'));

function trialLines(record, workDir) {
  const last = new Map(record.steps.map((s) => [s.key, s]));
  const rows = record.undone ? 'Undo removed the trial rows'
    : record.kept ? 'Kept the trial rows; run trial --undo to remove them'
      : 'The trial rows are still loaded; run trial --undo to remove them';
  return [
    ...[...last.values()].map((s) => `  ${s.key}: ${s.status}${s.algInvocationId == null ? '' : ` (AlgInvocationId ${s.algInvocationId})`}, ${s.seconds} s`),
    ...record.findings.map(formatFinding),
    rows,
    `Wrote ${join(workDir, 'trial', 'trial.json')}`
  ];
}

async function main() {
  const { values, positionals } = parseArgs({
    options: {
      workDir: { type: 'string' }, apiCommonData: { type: 'string' }, preprocessGFF3: { type: 'string' },
      image: { type: 'string' }, gusConfig: { type: 'string' }, taxonId: { type: 'string' }, keep: { type: 'boolean' }, undo: { type: 'boolean' }
    },
    allowPositionals: true
  });
  const [command, ...rest] = positionals;
  if (!COMMANDS.includes(command)) fail(USAGE);
  const { workDir, apiCommonData, preprocessGFF3 } = values;
  if (!workDir) fail(`--workDir is required.\n${USAGE}`);
  const stray = Object.keys(values).filter((name) => !ACCEPTED[command].includes(name));
  if (stray.length) fail(`${command} does not take ${stray.map((s) => `--${s}`).join(', ')}.\n${USAGE}`);

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
  } else if (command === 'finalize') {
    const record = await runFinalize({ workDir, apiCommonData, preprocessGFF3 });
    const dirty = record.apiCommonData.dirty ? ['warning: the ApiCommonData checkout has uncommitted changes; genome-build.json records that'] : [];
    print([...record.partitions.map((part) => `  ${part.dir}: ${part.sequenceCount} sequences`), ...dirty, `Wrote ${join(workDir, 'genome-build.json')}`]);
  } else if (command === 'functional') {
    const record = runFunctional({ workDir });
    print([...record.datasets.map((d) => `  ${d.datasetClass} ${d.name}: ${d.rows}`), ...record.findings.map(formatFinding),
      `Wrote ${join(workDir, 'functional.json')}`]);
    if (record.findings.some((f) => f.severity === 'error')) process.exit(1);
  } else {
    const { image, gusConfig, taxonId, keep, undo } = values;
    if (undo && (keep || taxonId !== undefined)) fail(`trial --undo takes no --keep or --taxonId.\n${USAGE}`);
    const record = undo
      ? await runTrialUndo({ workDir, image, gusConfig })
      : await runTrial({ workDir, image, gusConfig, taxonId: taxonId === undefined ? undefined : Number(taxonId), keep: Boolean(keep) });
    print(trialLines(record, workDir));
    if (record.findings.some((f) => f.severity === 'error')) process.exit(1);
  }
}

main().catch((err) => {
  if (err instanceof PipelineError) fail(`Error: ${err.message}`, err.exitCode);
  if (err.code?.startsWith('ERR_PARSE_ARGS')) fail(`${err.message}\n${USAGE}`);
  fail(err.stack ?? String(err));
});
