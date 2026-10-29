import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkCurated, samplesFor, unescapeXml, annotationsFile } from '../../bulk-rnaseq.js';
import { readCuratedJson, readDataset } from '../../_common.js';

const NAME = 'consistency';
const SRA_COLUMN = 'SRA.ID.s.';
const BIOSAMPLE_COLUMN = 'BioSample';
const EXPERIMENT_COLUMN = 'SRA.experiment.s.';
const error = (message, organism) => ({ validator: NAME, severity: 'error', ...(organism ? { organism } : {}), message });

function tsvRows(text) {
  const [header, ...rows] = text.split(/\r?\n/).filter((l) => l.trim());
  const cols = header.split('\t');
  return rows.map((r) => Object.fromEntries(r.split('\t').map((v, i) => [cols[i], v.trim()])));
}

/** sampleId -> label from the label|sampleId values of analysisConfig.xml. */
function configLabels(xml) {
  const labels = new Map();
  for (const [, raw] of xml.matchAll(/<value\s*>([^<]*)<\/value\s*>/g)) {
    const [label, id] = unescapeXml(raw).trim().split('|');
    if (id !== undefined) labels.set(id.trim(), label.trim());
  }
  return labels;
}

/** sample -> the fastq_1 values of its samplesheet rows. */
function sheetRuns(csv) {
  const runs = new Map();
  for (const row of csv.split(/\r?\n/).slice(1).filter((l) => l.trim())) {
    const [sample, run] = row.split(',').map((c) => c.trim());
    runs.set(sample, new Set([...(runs.get(sample) ?? []), run]));
  }
  return runs;
}

const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
const list = (set) => [...set].join(',') || 'none';
const splitList = (cell) => new Set((cell ?? '').split(',').map((v) => v.trim()).filter(Boolean));

/** checkCurated (sample IDs), plus each sample's label, runs, BioSample and SRA experiments across every file that names them. */
export const consistency = {
  name: NAME,
  tools: [],
  async run({ proposalDir, manifest }) {
    const curated = checkCurated(proposalDir);
    if (curated.length) return curated.map((m) => error(m));
    const annotations = readCuratedJson(proposalDir, annotationsFile(manifest));
    const sra = (readDataset(proposalDir).source ?? { type: 'sra' }).type === 'sra';
    return manifest.organisms.flatMap(({ proposedOrganismAbbrev: p }) => {
      const dir = join(proposalDir, 'curated', p);
      const tsv = tsvRows(readFileSync(join(dir, 'entity-sample.tsv'), 'utf-8'));
      const idColumn = Object.keys(tsv[0] ?? {})[0];
      const labels = configLabels(readFileSync(join(dir, 'analysisConfig.xml'), 'utf-8'));
      const runs = sheetRuns(readFileSync(join(dir, 'samplesheet.csv'), 'utf-8'));
      const found = [];
      for (const s of samplesFor(annotations, manifest, p)) {
        const row = tsv.find((r) => r[idColumn] === s.sampleId);
        const seen = { annotations: s.label, 'analysisConfig.xml': labels.get(s.sampleId), 'entity-sample.tsv': row?.label };
        if (new Set(Object.values(seen)).size > 1) {
          found.push(error(`${s.sampleId} has different labels: ${Object.entries(seen).map(([f, l]) => `${f} "${l}"`).join(', ')}`, p));
        }
        if (!sra) continue;
        const fromAnnotations = new Set(s.runs ?? []);
        const fromSheet = runs.get(s.sampleId) ?? new Set();
        const fromTsv = splitList(row?.[SRA_COLUMN]);
        if (!sameSet(fromAnnotations, fromSheet) || !sameSet(fromAnnotations, fromTsv)) {
          found.push(error(`${s.sampleId} has different runs: annotations ${list(fromAnnotations)}, samplesheet.csv ${list(fromSheet)}, entity-sample.tsv ${list(fromTsv)}`, p));
        }
        // Proposals written before these columns existed lack them, so there is nothing to compare.
        if (row && BIOSAMPLE_COLUMN in row && (s.biosample ?? '') !== row[BIOSAMPLE_COLUMN]) {
          found.push(error(`${s.sampleId} has different BioSample: annotations ${s.biosample || 'none'}, entity-sample.tsv ${row[BIOSAMPLE_COLUMN] || 'none'}`, p));
        }
        if (row && EXPERIMENT_COLUMN in row) {
          const fromAnnotationsSrx = new Set(s.experiments ?? []);
          const fromTsvSrx = splitList(row[EXPERIMENT_COLUMN]);
          if (!sameSet(fromAnnotationsSrx, fromTsvSrx)) {
            found.push(error(`${s.sampleId} has different SRA experiments: annotations ${list(fromAnnotationsSrx)}, entity-sample.tsv ${list(fromTsvSrx)}`, p));
          }
        }
      }
      return found;
    });
  }
};
