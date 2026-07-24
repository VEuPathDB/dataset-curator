#!/usr/bin/env node
'use strict';

/*
 * deseq-suitability.js
 *
 * Final QC test for a build's STF outputs: which datasets can support a
 * DESeq differential-expression contrast?
 *
 * Rule: a dataset is DESeq-suitable ONLY if its samples can be partitioned,
 * by the `label` field, into TWO non-empty groups each containing at least
 * two samples. Whole labels go to one side or the other, so:
 *   - two distinct labels each with >=2 replicates (WT x3 vs mut x3), OR
 *   - several labels combined into two groups of >=2 (1h+2h vs 3h+4h).
 * Combinatorially this is: some subset of the per-label counts sums to a
 * value s with 2 <= s <= N-2 (N = total samples). Equivalent consequences:
 *   - single label (any count)  -> NOT suitable (no contrast)
 *   - fewer than 4 samples       -> NOT suitable (can't make two groups of 2)
 *   - one label with only 1 rep and one other label -> NOT suitable
 *
 * Usage:
 *   node deseq-suitability.js <outputsDir> [reportPath]
 *
 * Scans <outputsDir>/<datasetName>/entity-sample.tsv for every dataset,
 * writes a human-readable markdown report (default: <outputsDir>/../files/
 * deseq-suitability.md if it exists, else <outputsDir>/deseq-suitability.md),
 * and prints a one-line summary to stdout.
 */

import fs from 'fs';
import path from 'path';

const LARGE_THRESHOLD = 10; // >= this many samples: almost certainly suitable

function die(msg) {
  process.stderr.write(msg + '\n');
  process.exit(1);
}

const outputsDir = process.argv[2];
if (!outputsDir) die('Usage: node deseq-suitability.js <outputsDir> [reportPath]');
if (!fs.existsSync(outputsDir)) die(`No such directory: ${outputsDir}`);

let reportPath = process.argv[3];
if (!reportPath) {
  const sibling = path.join(outputsDir, '..', 'files');
  reportPath = fs.existsSync(sibling)
    ? path.join(sibling, 'deseq-suitability.md')
    : path.join(outputsDir, 'deseq-suitability.md');
}

// --- parse one dataset's entity-sample.tsv into label -> count -------------
function labelCounts(tsvPath) {
  const lines = fs.readFileSync(tsvPath, 'utf8').split('\n');
  const header = lines[0].split('\t');
  const labelIdx = header.indexOf('label');
  if (labelIdx === -1) throw new Error(`no 'label' column in ${tsvPath}`);
  const counts = new Map();
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') continue;
    const label = (line.split('\t')[labelIdx] || '').trim();
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return counts;
}

// --- subset-sum: is there a subset of counts summing to [lo, hi]? -----------
// Returns { ok, subsetIdx } where subsetIdx is one witnessing subset (indices
// into `counts`), or null if none.
function findSplit(counts) {
  const N = counts.reduce((a, b) => a + b, 0);
  const lo = 2, hi = N - 2;
  if (hi < lo) return { ok: false, subsetIdx: null };
  // 0/1 subset sum with reconstruction.
  const reachable = new Array(N + 1).fill(false);
  const fromItem = new Array(N + 1).fill(-1); // item added to reach this sum
  const prevSum = new Array(N + 1).fill(-1);
  reachable[0] = true;
  for (let i = 0; i < counts.length; i++) {
    const c = counts[i];
    for (let s = N; s >= c; s--) {
      if (reachable[s - c] && !reachable[s]) {
        reachable[s] = true;
        fromItem[s] = i;
        prevSum[s] = s - c;
      }
    }
  }
  for (let s = lo; s <= hi; s++) {
    if (reachable[s]) {
      const subsetIdx = [];
      let cur = s;
      while (cur > 0) {
        subsetIdx.push(fromItem[cur]);
        cur = prevSum[cur];
      }
      return { ok: true, subsetIdx: subsetIdx.reverse() };
    }
  }
  return { ok: false, subsetIdx: null };
}

// --- classify every dataset -------------------------------------------------
const datasets = fs.readdirSync(outputsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .filter((name) => fs.existsSync(path.join(outputsDir, name, 'entity-sample.tsv')))
  .sort();

const results = [];
for (const name of datasets) {
  const counts = labelCounts(path.join(outputsDir, name, 'entity-sample.tsv'));
  const labels = [...counts.keys()];
  const countArr = labels.map((l) => counts.get(l));
  const N = countArr.reduce((a, b) => a + b, 0);
  const { ok, subsetIdx } = findSplit(countArr);

  let reason = '';
  if (ok) {
    reason = '';
  } else if (labels.length < 2) {
    reason = 'single label (no contrast)';
  } else if (N < 4) {
    reason = `only ${N} samples`;
  } else {
    reason = 'no label partition yields two groups of >=2';
  }

  // Build a human-readable example split for suitable datasets.
  let split = '';
  if (ok) {
    const inA = new Set(subsetIdx);
    const groupA = labels.filter((_, i) => inA.has(i));
    const groupB = labels.filter((_, i) => !inA.has(i));
    const sum = (g) => g.reduce((a, l) => a + counts.get(l), 0);
    split = `{${groupA.join(', ')}} (${sum(groupA)}) vs {${groupB.join(', ')}} (${sum(groupB)})`;
  }

  const composition = labels
    .map((l) => `${l}×${counts.get(l)}`)
    .join(', ');

  results.push({ name, N, nLabels: labels.length, composition, ok, reason, split });
}

// --- render markdown --------------------------------------------------------
const suitable = results.filter((r) => r.ok);
const unsuitable = results.filter((r) => !r.ok);
const large = suitable.filter((r) => r.N >= LARGE_THRESHOLD);
const smallSuitable = suitable.filter((r) => r.N < LARGE_THRESHOLD);

function block(rows) {
  return '```\n' + (rows.length ? rows.map((r) => r.name).join('\n') : '(none)') + '\n```';
}

const md = [];
md.push('# DESeq-suitability test — Build 71 STF outputs');
md.push('');
md.push('A dataset is **DESeq-suitable** only if its samples can be partitioned, by the');
md.push('`label` field, into **two non-empty groups each with at least two samples**');
md.push('(whole labels assigned to one side or the other). Equivalent to: some subset of');
md.push('the per-label sample counts sums to a value between 2 and N−2 (N = total samples).');
md.push('');
md.push(`Datasets with ≥ ${LARGE_THRESHOLD} samples are almost always suitable and weren't the`);
md.push('point of the check, but are included since the test is scripted.');
md.push('');
md.push(`Source: \`${path.relative(process.cwd(), outputsDir)}/<dataset>/entity-sample.tsv\``);
md.push('');
md.push(`- Datasets tested: **${results.length}**`);
md.push(`- DESeq-suitable: **${suitable.length}**`);
md.push(`- NOT suitable: **${unsuitable.length}**`);
md.push('');
md.push('## DESeq-suitable');
md.push('');
md.push(block(suitable));
md.push('');
md.push('## NOT DESeq-suitable');
md.push('');
md.push(block(unsuitable));
md.push('');
md.push(`## Suitable, small (< ${LARGE_THRESHOLD} samples) — the ones the check actually mattered for`);
md.push('');
md.push(block(smallSuitable));
md.push('');
md.push(`## Suitable, large (≥ ${LARGE_THRESHOLD} samples) — trivially expected`);
md.push('');
md.push(block(large));
md.push('');
md.push('## Details');
md.push('');
md.push('| Dataset | N | Labels | Composition | Suitable | Example split / reason |');
md.push('|---|---|---|---|---|---|');
for (const r of results) {
  const verdict = r.ok ? '✅' : '❌';
  const detail = r.ok ? r.split : `— ${r.reason}`;
  md.push(`| ${r.name} | ${r.N} | ${r.nLabels} | ${r.composition} | ${verdict} | ${detail} |`);
}
md.push('');

fs.writeFileSync(reportPath, md.join('\n'));
process.stdout.write(
  `Tested ${results.length} datasets: ${suitable.length} suitable, ${unsuitable.length} not. ` +
  `Report written to ${reportPath}\n`
);
