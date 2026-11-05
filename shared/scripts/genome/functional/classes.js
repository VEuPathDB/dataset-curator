import { finding } from '../checks.js';
import { dbxrefDataset } from './dbxref-urls.js';
import { proteinIdOf } from './ids.js';
import { attrValues, GO_ASPECTS, goValues, isEc, parseDbxref } from './values.js';

const GENE = (f) => f.kind === 'gene';
const RNA = (f) => f.kind === 'rna';
const CDS = (f) => f.kind === 'cds';
const RNA_WITHOUT_CDS = (f) => RNA(f) && !f.hasCds;
const anyOf = (...kinds) => (f) => kinds.some((kind) => kind(f));
const ID_AT = { gene: (f) => f.gene, transcript: (f) => f.transcript, protein: (f) => proteinIdOf(f.transcript) };

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Rows unique per (ID, value), sorted by ID, then value, by code unit, so a rerun writes the same bytes. */
export function uniqueSorted(rows) {
  const unique = new Map(rows.map((row) => [row.join('\t'), row]));
  const keyed = [...unique.values()].map((row) => [row, row.slice(1).join('\t')]);
  return keyed.sort(([a, aRest], [b, bRest]) => compare(a[0], b[0]) || compare(aRest, bRest)).map(([row]) => row);
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
    const entry = byGene.get(id) ?? { names: [], own: null };
    if (!entry.names.includes(name)) entry.names.push(name);
    if (feature.kind === 'gene' && entry.own === null) entry.own = name;
    byGene.set(id, entry);
  }
  const rows = [];
  for (const [id, { names, own }] of byGene) {
    const name = own ?? names[0];
    if (name !== id && !ctx.locusTagsOf(id).has(name)) rows.push([id, name]);
  }
  const conflicts = [...byGene].filter(([, entry]) => entry.names.length > 1).map(([id]) => id);
  return {
    datasets: [{ name: spec.name(ctx.source), props: {}, rows: uniqueSorted(rows) }],
    findings: [finding('functional', 'geneNameConflict', 'warning', conflicts, "genes whose features disagree on gene; the gene feature's value is kept, else the first in GFF order")]
  };
}

function dbxrefColumns(feature, key) {
  const values = [];
  const bad = [];
  for (const value of attrValues(feature.group, key)) {
    const ref = parseDbxref(value);
    if (ref) values.push({ cols: [ref.id], prefix: ref.prefix });
    else bad.push(value);
  }
  return { values, bad };
}

function goColumns(feature, key) {
  const { values, bad } = goValues(feature.group, key);
  return { values: values.map((go) => ({ cols: [go.goId, go.reference, go.evidence, GO_ASPECTS[key]] })), bad };
}

function ecColumns(feature, key) {
  const values = attrValues(feature.group, key);
  return { values: values.filter(isEc).map((ec) => ({ cols: [ec] })), bad: values.filter((ec) => !isEc(ec)) };
}

const dbxrefIds = (feature, level, ctx) => {
  if (level === 'gene') return [feature.gene];
  return feature.transcript !== null ? [feature.transcript] : ctx.transcriptsOf(feature.gene);
};

/**
 * One dataset per resolved name; override prefixes sharing a name merge. A sanitized name that two prefixes, or a
 * prefix and an override, would share is a clash: none of its prefixes is written.
 */
function dbxrefDatasets(found, ctx) {
  const byName = new Map();
  for (const { cols: [value], prefix, feature } of found) {
    const resolved = dbxrefDataset(prefix);
    const entry = byName.get(resolved.name) ?? { resolved, prefixes: new Set(), sanitized: false, rows: [] };
    entry.prefixes.add(prefix);
    entry.sanitized ||= !resolved.override;
    for (const id of dbxrefIds(feature, resolved.level, ctx)) entry.rows.push([id, value]);
    byName.set(resolved.name, entry);
  }
  const entries = [...byName.values()].sort((a, b) => compare(a.resolved.name, b.resolved.name));
  const isClash = (e) => e.sanitized && e.prefixes.size > 1;
  const prefixList = (e) => [...e.prefixes].sort(compare);
  const clashes = entries.filter(isClash);
  const datasets = entries.filter((e) => !isClash(e) && e.rows.length).map((e) => ({
    name: e.resolved.name, level: e.resolved.level, rows: uniqueSorted(e.rows),
    props: { prefixes: prefixList(e), url: e.resolved.url, target: 'NAFeature', viewName: e.resolved.viewName }
  }));
  return {
    datasets,
    findings: [
      finding('functional', 'dbxrefNameClash', 'error', clashes.map((e) => e.resolved.name),
        `Dbxref prefixes that give one dataset name: ${clashes.map((e) => `${e.resolved.name} ← ${prefixList(e).join(' and ')}`).join('; ')}`),
      finding('functional', 'unknownDbxrefPrefix', 'warning', datasets.filter((d) => d.props.url === null).flatMap((d) => d.props.prefixes),
        'Dbxref prefixes with no override or URL template in functional/dbxref-urls.js; their datasets get url null')
    ]
  };
}

function gafLine([id, goId, reference, evidence, aspect], { source, taxonId, date }) {
  return [source, id, id, '', goId, reference, evidence, '', aspect, '', '', 'transcript', `taxon:${taxonId}`, date, source, '', ''];
}

/** The extraction table: per dataset, the attributes it reads, the features it reads them from, the ID level and the file. */
export const DATASETS = Object.freeze([
  { datasetClass: 'productNames', name: (source) => source, keys: ['product'], from: anyOf(CDS, RNA_WITHOUT_CDS), level: 'transcript', file: 'products.txt', finish: products },
  { datasetClass: 'geneName', name: (source) => source, keys: ['gene'], from: anyOf(GENE, RNA, CDS), level: 'gene', file: 'geneName.txt', finish: geneNames },
  { datasetClass: 'comments', name: (source) => `${source}_transcript`, keys: ['Note'], from: anyOf(RNA, CDS), level: 'transcript', file: 'comments.txt' },
  { datasetClass: 'comments', name: (source) => `${source}_gene`, keys: ['Note'], from: GENE, level: 'gene', file: 'comments.txt' },
  { datasetClass: 'aliases', name: () => 'gbProteinId', keys: ['protein_id'], from: CDS, level: 'transcript', file: 'aliases.txt' },
  { datasetClass: 'dbxref_synonym', name: (source) => source, keys: ['gene_synonym'], from: GENE, level: 'gene', file: 'synonyms.txt' },
  {
    // level here only labels badDbxref samples; each dataset takes its level from dbxrefDataset
    datasetClass: 'dbxref_simple', name: null, keys: ['Dbxref'], from: anyOf(GENE, RNA, CDS), level: 'gene', file: 'mapping.txt',
    columns: dbxrefColumns, finish: dbxrefDatasets, badCheck: { check: 'badDbxref', message: 'Dbxref values with no "prefix:" part; they are skipped' }
  },
  {
    datasetClass: 'GeneOntologyAssociations', name: (source) => source, keys: Object.keys(GO_ASPECTS), from: anyOf(RNA, CDS), level: 'transcript',
    file: 'associations.gas', columns: goColumns, format: gafLine,
    badCheck: { check: 'badGo', message: 'go_* values that are not term|GO id|PMIDs|evidence; they are skipped' }
  },
  {
    datasetClass: 'EnzymeCommissionAssociations', name: (source) => source, keys: ['EC_number'], from: CDS, level: 'protein', file: 'ec.txt',
    columns: ecColumns, badCheck: { check: 'badEc', message: 'EC_number values that are not four dot-separated numbers or -; they are skipped' }
  }
]);

const GENE_ATTRIBUTES = new Set(['Note', 'gene', 'gene_synonym', 'Dbxref']);

function occurrences(spec, features, ctx) {
  const columns = spec.columns ?? plainColumns;
  const found = [];
  const bad = [];
  for (const feature of features) {
    if (!spec.from(feature)) continue;
    const id = ID_AT[spec.level](feature);
    for (const key of spec.keys) {
      if (ctx.synthesized.has(feature) && GENE_ATTRIBUTES.has(key)) continue;
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
  const locusTags = new Map();
  for (const f of features) {
    const tags = locusTags.get(f.gene) ?? new Set();
    for (const tag of attrValues(f.group, 'locus_tag')) tags.add(tag);
    locusTags.set(f.gene, tags);
  }
  const geneGroups = new Set(features.filter(GENE).map((f) => f.group));
  const ctx = {
    source,
    codingTranscripts,
    transcriptsOf: (gene) => transcripts.get(gene) ?? [],
    locusTagsOf: (gene) => locusTags.get(gene) ?? new Set(),
    // a transcript ISF synthesizes shares its gene's GFF group, so gene-level attributes are not its own
    synthesized: new Set(features.filter((f) => RNA(f) && geneGroups.has(f.group)))
  };
  const datasets = [];
  const findings = [];
  const empty = [];
  for (const spec of DATASETS) {
    const { found, bad } = occurrences(spec, features, ctx);
    if (spec.badCheck) findings.push(finding('functional', spec.badCheck.check, 'warning', bad, spec.badCheck.message));
    const made = (spec.finish ?? single)(found, ctx, spec);
    findings.push(...made.findings);
    if (!made.datasets.length && !found.length) empty.push(spec.datasetClass);
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
