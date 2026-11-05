import { finding } from '../checks.js';
import { attrValues } from './values.js';

const GENE = (f) => f.kind === 'gene';
const RNA = (f) => f.kind === 'rna';
const CDS = (f) => f.kind === 'cds';
const RNA_WITHOUT_CDS = (f) => RNA(f) && !f.hasCds;
const anyOf = (...kinds) => (f) => kinds.some((kind) => kind(f));
const ID_AT = { gene: (f) => f.gene, transcript: (f) => f.transcript };

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Rows unique per (ID, value), sorted by ID, then value, by code unit, so a rerun writes the same bytes. */
export function uniqueSorted(rows) {
  const unique = new Map(rows.map((row) => [row.join('\t'), row]));
  return [...unique.values()].sort((a, b) => compare(a[0], b[0]) || compare(a.slice(1).join('\t'), b.slice(1).join('\t')));
}

function plainColumns(feature, key) {
  return { values: attrValues(feature.group, key).map((value) => ({ cols: [value] })), bad: [] };
}

function single(found, ctx, spec) {
  return { datasets: [{ name: spec.name(ctx.source), props: {}, rows: uniqueSorted(found.map((o) => [o.id, ...o.cols])) }], findings: [] };
}

/** is_preferred is set from GFF order before the rows are sorted: 1 for a transcript's first product, 0 for the rest. */
function products(found, ctx, spec) {
  const byTranscript = new Map();
  for (const { id, cols: [product] } of found) {
    const list = byTranscript.get(id) ?? [];
    if (!list.includes(product)) list.push(product);
    byTranscript.set(id, list);
  }
  const rows = [...byTranscript].flatMap(([id, list]) => list.map((product, i) => [id, product, i === 0 ? '1' : '0']));
  return {
    datasets: [{ name: spec.name(ctx.source), props: {}, rows: uniqueSorted(rows) }],
    findings: [
      finding('functional', 'noProducts', 'error', ctx.codingTranscripts.filter((t) => !byTranscript.has(t)),
        'coding transcripts with no product; productNames needs one for each'),
      finding('functional', 'multipleProducts', 'info', [...byTranscript].filter(([, list]) => list.length > 1).map(([id]) => id),
        'transcripts with more than one product; the first in GFF order is preferred')
    ]
  };
}

/** One name per gene: the gene feature's own `gene`, else the first its RNAs or CDSs carry; none when that is the ID or a locus_tag. */
function geneNames(found, ctx, spec) {
  const byGene = new Map();
  for (const { id, cols: [name], feature } of found) {
    const entry = byGene.get(id) ?? { names: [], own: null, locusTags: new Set() };
    if (!entry.names.includes(name)) entry.names.push(name);
    if (feature.kind === 'gene' && entry.own === null) entry.own = name;
    for (const tag of attrValues(feature.group, 'locus_tag')) entry.locusTags.add(tag);
    byGene.set(id, entry);
  }
  const rows = [];
  for (const [id, { names, own, locusTags }] of byGene) {
    const name = own ?? names[0];
    if (name !== id && !locusTags.has(name)) rows.push([id, name]);
  }
  const conflicts = [...byGene].filter(([, entry]) => entry.names.length > 1).map(([id]) => id);
  return {
    datasets: [{ name: spec.name(ctx.source), props: {}, rows: uniqueSorted(rows) }],
    findings: [finding('functional', 'geneNameConflict', 'warning', conflicts, "genes whose features disagree on gene; the gene feature's value is kept")]
  };
}

/** The extraction table: per dataset, the attributes it reads, the features it reads them from, the ID level and the file. */
export const DATASETS = Object.freeze([
  { datasetClass: 'productNames', name: (source) => source, keys: ['product'], from: anyOf(CDS, RNA_WITHOUT_CDS), level: 'transcript', file: 'products.txt', finish: products },
  { datasetClass: 'geneName', name: (source) => source, keys: ['gene'], from: anyOf(GENE, RNA, CDS), level: 'gene', file: 'geneName.txt', finish: geneNames },
  { datasetClass: 'comments', name: (source) => `${source}_transcript`, keys: ['Note'], from: anyOf(RNA, CDS), level: 'transcript', file: 'comments.txt' },
  { datasetClass: 'comments', name: (source) => `${source}_gene`, keys: ['Note'], from: GENE, level: 'gene', file: 'comments.txt' },
  { datasetClass: 'aliases', name: () => 'gbProteinId', keys: ['protein_id'], from: CDS, level: 'transcript', file: 'aliases.txt' },
  { datasetClass: 'dbxref_synonym', name: (source) => source, keys: ['gene_synonym'], from: GENE, level: 'gene', file: 'synonyms.txt' }
]);

function occurrences(spec, features) {
  const columns = spec.columns ?? plainColumns;
  const found = [];
  const bad = [];
  for (const feature of features) {
    if (!spec.from(feature)) continue;
    const id = ID_AT[spec.level](feature);
    for (const key of spec.keys) {
      const read = columns(feature, key);
      for (const value of read.values) found.push({ id, cols: value.cols, prefix: value.prefix ?? null, feature });
      for (const value of read.bad) bad.push(`${id}: ${value}`);
    }
  }
  return { found, bad };
}

/** Every dataset of the table with its rows, and the findings; a dataset without rows is left out and named in emptyClass. */
export function extractDatasets(features, { source, codingTranscripts }) {
  const transcripts = new Map();
  for (const f of features.filter(RNA)) transcripts.set(f.gene, [...(transcripts.get(f.gene) ?? []), f.transcript]);
  const ctx = { source, codingTranscripts, transcriptsOf: (gene) => transcripts.get(gene) ?? [] };
  const datasets = [];
  const findings = [];
  const empty = [];
  for (const spec of DATASETS) {
    const { found, bad } = occurrences(spec, features);
    if (spec.badCheck) findings.push(finding('functional', spec.badCheck.check, 'warning', bad, spec.badCheck.message));
    const made = (spec.finish ?? single)(found, ctx, spec);
    findings.push(...made.findings);
    if (!made.datasets.length) empty.push(spec.datasetClass);
    for (const d of made.datasets) {
      if (d.rows.length) datasets.push({ datasetClass: spec.datasetClass, level: spec.level, file: spec.file, format: spec.format ?? null, ...d });
      else empty.push(`${spec.datasetClass}/${d.name}`);
    }
  }
  findings.push(finding('functional', 'emptyClass', 'info', empty, 'datasets with no rows; no file is written for them'));
  return { datasets, findings: findings.filter((f) => f.count) };
}

/** A dataset's file: tab-separated lines, no header, LF. */
export function fileText(dataset, ctx) {
  return `${dataset.rows.map((row) => (dataset.format ? dataset.format(row, ctx) : row).join('\t')).join('\n')}\n`;
}
