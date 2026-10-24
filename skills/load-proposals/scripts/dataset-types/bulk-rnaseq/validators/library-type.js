import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readInputJson, readDataset } from '../../_common.js';

const NAME = 'libraryType';
export const MIN_SPOTS = 1_000_000;
export const MGI_WARNING = 'bulk-rnaseq-nextflow clips only Illumina adapters (Trimmomatic ILLUMINACLIP with All_adaptors-*.fa). MGI adapter read-through stays in the reads, lowering alignment rates and adding soft-clipped or mismatched bases near the 3\' end, worst with short inserts. Confirm the library\'s insert size, or add MGI adapters to the pipeline.';
export const ION_TORRENT_WARNING = 'Single-end reads of variable length with homopolymer indel errors. The pipeline does not clip Ion Torrent adapters, and indels near splice sites can shift HISAT2 junction calls and lower unique-alignment rates. Expect noisier junctions and counts.';
const PLATFORM_WARNINGS = { BGISEQ: MGI_WARNING, DNBSEQ: MGI_WARNING, ION_TORRENT: ION_TORRENT_WARNING };
const LONG_READ = ['OXFORD_NANOPORE', 'PACBIO_SMRT'];

const finding = (severity, message) => ({ validator: NAME, severity, message });
const runList = (ids) => (ids.length > 3 ? `${ids.slice(0, 3).join(', ')} and ${ids.length - 3} more` : ids.join(', '));

/** Run ids grouped by the value they have for field, in first-seen order. */
function byValue(runs, field) {
  const groups = new Map();
  for (const r of runs) {
    const v = r[field] || '(missing)';
    groups.set(v, [...(groups.get(v) ?? []), r.run_accession]);
  }
  return groups;
}

const expect = (runs, field, expected) => [...byValue(runs, field)]
  .filter(([v]) => v !== expected)
  .map(([v, ids]) => finding('error', `${field} is ${v} for ${runList(ids)}; bulk RNA-seq needs ${expected}`));

const platforms = (runs) => [...byValue(runs, 'instrument_platform')].flatMap(([platform, ids]) => {
  if (platform === 'ILLUMINA') return [];
  if (PLATFORM_WARNINGS[platform]) return [finding('warning', `${platform} (${runList(ids)}): ${PLATFORM_WARNINGS[platform]}`)];
  const hint = LONG_READ.includes(platform) ? '; long reads belong in long-read-rnaseq-nextflow' : '';
  return [finding('error', `${platform} (${runList(ids)}) is not a short-read platform bulk-rnaseq-nextflow handles${hint}`)];
});

/** Samplesheet sample -> its runs, across organisms; rows sharing a name are technical replicates. */
function sampleRuns(proposalDir, manifest) {
  const samples = new Map();
  for (const { proposedOrganismAbbrev } of manifest.organisms) {
    const [, ...rows] = readFileSync(join(proposalDir, 'curated', proposedOrganismAbbrev, 'samplesheet.csv'), 'utf-8').split(/\r?\n/);
    for (const row of rows.filter((l) => l.trim())) {
      const [sample, run] = row.split(',').map((c) => c.trim());
      samples.set(sample, new Set([...(samples.get(sample) ?? []), run]));
    }
  }
  return samples;
}

function depth(runs, samples) {
  const byRun = new Map(runs.map((r) => [r.run_accession, r]));
  return [...samples].flatMap(([sample, set]) => {
    const ids = [...set];
    const absent = ids.filter((id) => !byRun.has(id));
    if (absent.length) return [finding('error', `${sample}: ${absent.join(', ')} not in the SRA metadata`)];
    const counts = ids.map((id) => {
      const raw = byRun.get(id).read_count;
      return raw === undefined || raw === '' ? NaN : Number(raw);
    });
    const uncounted = ids.filter((id, i) => !Number.isFinite(counts[i]));
    if (uncounted.length) return [finding('error', `${sample}: no read_count for ${uncounted.join(', ')}`)];
    const total = counts.reduce((a, b) => a + b, 0);
    return total < MIN_SPOTS
      ? [finding('error', `${sample} has ${total.toLocaleString('en-US')} spots in ${ids.join(', ')}; at least ${MIN_SPOTS.toLocaleString('en-US')} are needed`)]
      : [];
  });
}

/** Bulk short-read RNA-seq with enough spots per sample, from the SRA metadata snapshot taken at proposal time. */
export const libraryType = {
  name: NAME,
  tools: [],
  async run({ proposalDir, manifest }) {
    const source = readDataset(proposalDir).source ?? { type: 'sra' };
    const file = `${manifest.accession}_sra_metadata.json`;
    const metadata = readInputJson(proposalDir, file, { optional: true });
    if (!metadata) {
      return source.type === 'sra'
        ? [finding('error', `inputs/${file} is missing, so library type and depth cannot be checked`)]
        : [finding('warning', 'No SRA metadata: library type and depth not checked; confirm by hand')];
    }
    const all = metadata.runs ?? [];
    const samples = source.type === 'sra' ? sampleRuns(proposalDir, manifest) : null;
    const proposed = samples && new Set([...samples.values()].flatMap((set) => [...set]));
    const runs = proposed ? all.filter((r) => proposed.has(r.run_accession)) : all;
    const omitted = all.length - runs.length;
    return [
      ...(omitted ? [finding('info', `${omitted} runs in the SRA metadata are not in this proposal`)] : []),
      ...expect(runs, 'library_strategy', 'RNA-Seq'),
      ...expect(runs, 'library_source', 'TRANSCRIPTOMIC'),
      ...platforms(runs),
      ...[...byValue(runs, 'library_selection')].map(([v, ids]) => finding('info', `library_selection ${v} (${ids.length} runs)`)),
      ...(samples
        ? depth(runs, samples)
        : [finding('warning', `Reads come from ${source.type}: depth not checked; confirm by hand`)])
    ];
  }
};
