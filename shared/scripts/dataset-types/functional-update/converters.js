import { fileText, gafLine, uniqueSorted } from '../../genome/functional/writers.js';
import { GO_EVIDENCE_CODES, isEc } from '../../genome/functional/values.js';
import { AMBIGUOUS, LEVELS, levelOfId, mapId } from './gff-ids.js';

const SAMPLE = 20;
/** Same shape as genome/checks.js finding, without importing the genome pipeline's checks. */
const finding = (check, severity, ids, message, count = ids.length) => ({ group: 'convert', check, severity, count, sample: ids.slice(0, SAMPLE), message, fix: null });

const GO_ID = /^(?:GO:)?(\d{1,7})$/;
const ASPECTS = { f: 'F', p: 'P', c: 'C', 'molecular function': 'F', 'biological process': 'P', 'cellular component': 'C', function: 'F', process: 'P', component: 'C' };
const PREFERRED = /^(1|true|yes|y)$/i;
const EC_PREFIX = /^EC[:\s]*/i;

/** Per class: the ID level it loads at (null: the ID column's own level), its file, required and optional value columns. */
export const CONVERTERS = Object.freeze({
  productNames: { level: 'transcript', file: 'products.txt', values: ['product'], optional: ['preferred'] },
  GeneOntologyAssociations: { level: 'transcript', file: 'associations.gas', values: ['goId'], optional: ['aspect', 'evidence', 'reference', 'qualifier'] },
  EnzymeCommissionAssociations: { level: 'protein', file: 'ec.txt', values: ['ec'], optional: [] },
  geneName: { level: 'gene', file: 'geneName.txt', values: ['name'], optional: [] },
  comments: { level: null, file: 'comments.txt', values: ['comment'], optional: [] },
  aliases: { level: 'transcript', file: 'aliases.txt', values: ['alias'], optional: [] }
});

const cellOf = (raw) => {
  const c = raw.trim();
  return c.length >= 2 && c.startsWith('"') && c.endsWith('"') ? c.slice(1, -1).replace(/""/g, '"').trim() : c;
};

/** Non-blank, non-# lines as { line, cells }; with header, the first non-blank line is the header even when it starts with #. */
export function readRows(text, header = false) {
  const rows = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    if (raw.trim() === '') return;
    let line = raw;
    if (line.startsWith('#')) {
      if (!(header && rows.length === 0)) return;
      line = line.slice(1);
    }
    rows.push({ line: i + 1, cells: line.split('\t').map(cellOf) });
  });
  return rows;
}

export const readTab = (text, header = false) => readRows(text, header).map((r) => r.cells);

const isColumn = (n) => Number.isInteger(n) && n >= 1;

export function columnsProblems(datasetClass, columns) {
  const spec = CONVERTERS[datasetClass];
  if (!spec) return [`no converter for ${datasetClass}`];
  const problems = [];
  if (!isColumn(columns?.id?.column)) problems.push('id.column must be a column number from 1');
  if (!LEVELS.includes(columns?.id?.level)) problems.push('id.level must be gene, transcript or protein');
  const values = columns?.values ?? {};
  const known = [...spec.values, ...spec.optional];
  for (const k of spec.values) if (values[k] === undefined) problems.push(`values.${k} is required for ${datasetClass}`);
  for (const [k, n] of Object.entries(values)) {
    if (!known.includes(k)) problems.push(`values.${k} is not a column ${datasetClass} reads (${known.join(', ')})`);
    else if (!isColumn(n)) problems.push(`values.${k} must be a column number from 1`);
  }
  if (datasetClass === 'comments' && columns?.id?.level === 'protein') problems.push('comments are loaded for gene or transcript IDs, not protein');
  return problems;
}

const BARE_PMID = /^(?:PMID[:\s]\s*)?(\d+(?:\s+\d+)*)$/i;

/** `|` separates references; a piece that is only PMIDs (`123`, `123,456`, `PMID 123`) is split further and prefixed, any other kept whole. */
function referenceOf(raw) {
  const refs = [];
  for (const piece of (raw ?? '').split('|').map((t) => t.trim()).filter(Boolean)) {
    const parts = piece.split(/[,;]/).map((t) => t.trim()).filter(Boolean);
    const pmids = parts.every((p) => BARE_PMID.test(p)) ? parts.flatMap((p) => BARE_PMID.exec(p)[1].split(/\s+/).map((n) => `PMID:${n}`)) : [piece];
    for (const ref of pmids) if (!refs.includes(ref)) refs.push(ref);
  }
  return refs.join('|');
}

const BUILD = {
  productNames(records) {
    const hasPreferred = records.some((r) => r.values.preferred !== undefined);
    const first = new Map();
    const pairs = new Map();
    for (const { id, values } of records) {
      if (!first.has(id)) first.set(id, values.product);
      const key = JSON.stringify([id, values.product]);
      const preferred = hasPreferred ? PREFERRED.test(values.preferred ?? '') : first.get(id) === values.product;
      pairs.set(key, pairs.get(key) || preferred);
    }
    const rows = [...pairs].map(([key, preferred]) => [...JSON.parse(key), preferred ? '1' : '0']);
    const preferredPer = new Map();
    for (const [id, , preferred] of rows) preferredPer.set(id, (preferredPer.get(id) ?? 0) + Number(preferred));
    const off = [...preferredPer].filter(([, n]) => n !== 1).map(([id]) => id);
    return {
      rows: uniqueSorted(rows),
      findings: hasPreferred ? [finding('preferredCount', 'warning', off, 'transcripts with no preferred product or more than one')] : []
    };
  },
  GeneOntologyAssociations(records) {
    const bad = [];
    const badAspects = [];
    const noAspect = [];
    const badQualifiers = [];
    const rows = [];
    for (const { id, values } of records) {
      const go = GO_ID.exec(values.goId.toUpperCase());
      const evidence = (values.evidence || 'IEA').toUpperCase();
      if (!go || !GO_EVIDENCE_CODES.has(evidence)) { bad.push(`${id}: ${values.goId} ${evidence}`); continue; }
      const rawAspect = values.aspect ?? '';
      const aspect = ASPECTS[rawAspect.toLowerCase().replace(/[\s_]+/g, ' ').trim()] ?? '';
      if (!aspect) (rawAspect ? badAspects : noAspect).push(rawAspect || id);
      const qualifier = (values.qualifier ?? '').toUpperCase() === 'NOT' ? 'NOT' : '';
      if (values.qualifier && !qualifier) badQualifiers.push(values.qualifier);
      rows.push([id, `GO:${go[1].padStart(7, '0')}`, referenceOf(values.reference), evidence, aspect, qualifier]);
    }
    return {
      rows: uniqueSorted(rows),
      findings: [
        finding('badGo', 'warning', bad, 'rows whose GO id or evidence code is not valid; they are skipped'),
        finding('badAspect', 'warning', [...new Set(badAspects)], 'aspect values that are not F, P or C (or function, process, component); the GAF aspect column is empty'),
        finding('goAspectMissing', 'warning', noAspect, 'associations with no aspect (F, P or C); the GAF aspect column is empty'),
        finding('badQualifier', 'warning', [...new Set(badQualifiers)], 'qualifier values other than NOT; they are ignored')
      ]
    };
  },
  EnzymeCommissionAssociations(records) {
    const bad = new Set();
    const rows = [];
    for (const { id, values } of records) {
      const tokens = values.ec.replace(EC_PREFIX, '').split(/[;,|\s]+/).filter(Boolean).map((t) => t.replace(EC_PREFIX, ''));
      if (!tokens.length) bad.add(values.ec);
      for (const ec of tokens) {
        if (isEc(ec)) rows.push([id, ec]);
        else bad.add(ec);
      }
    }
    return { rows: uniqueSorted(rows), findings: [finding('badEc', 'warning', [...bad], 'distinct EC numbers that are not four dot-separated numbers or -; they are skipped')] };
  },
  geneName(records) {
    const byGene = new Map();
    for (const { id, values } of records) byGene.set(id, [...new Set([...(byGene.get(id) ?? []), values.name])]);
    const conflicts = [...byGene].filter(([, names]) => names.length > 1).map(([id]) => id);
    return {
      rows: uniqueSorted([...byGene].map(([id, names]) => [id, names[0]])),
      findings: [finding('geneNameConflict', 'warning', conflicts, 'genes given more than one name; the first in file order is kept')]
    };
  },
  comments: (records) => ({ rows: uniqueSorted(records.map((r) => [r.id, r.values.comment])), findings: [] }),
  aliases: (records) => ({ rows: uniqueSorted(records.map((r) => [r.id, r.values.alias])), findings: [] })
};

const atLevel = (index, id, level) => (level === 'gene' ? index.genes.has(id) : level === 'transcript' ? index.geneOf.has(id) : index.transcriptOf.has(id));
const usedWidth = (cells) => {
  let n = cells.length;
  while (n && cells[n - 1] === '') n--;
  return n;
};

/**
 * The curator's tab text as the class's loader file. Each row's ID must be at columns.id.level in the released GFF;
 * it is mapped to the class's level. Returns { file, text, rows, ids: { level, count }, findings }.
 */
export function convert({ datasetClass, name, version, text, columns, index, taxonId }) {
  const problems = columnsProblems(datasetClass, columns);
  if (problems.length) throw new Error(`columns for ${datasetClass}: ${problems.join('; ')}`);
  const spec = CONVERTERS[datasetClass];
  const all = readRows(text, columns.header);
  const lines = columns.header ? all.slice(1) : all;
  const width = columns.header && all.length ? usedWidth(all[0].cells) : Math.max(columns.id.column, ...Object.values(columns.values));
  const at = (row, n) => (n ? row[n - 1] ?? '' : undefined);
  const level = spec.level ?? columns.id.level;
  const unmatched = [];
  const ambiguous = [];
  const ambiguousMapped = [];
  const empty = [];
  const wide = [];
  const records = [];
  for (const { line, cells: row } of lines) {
    if (usedWidth(row) > width) wide.push(String(line));
    const id = at(row, columns.id.column);
    const values = Object.fromEntries(Object.entries(columns.values).map(([k, n]) => [k, at(row, n)]));
    if (spec.values.some((k) => !values[k])) { empty.push(id || '(no id)'); continue; }
    const found = levelOfId(index, id);
    if (found === AMBIGUOUS) {
      if (!atLevel(index, id, columns.id.level)) { ambiguous.push(id); continue; }
      ambiguousMapped.push(id);
    } else if (found !== columns.id.level) { unmatched.push(id); continue; }
    const targets = mapId(index, id, columns.id.level, level);
    if (!targets.length) { unmatched.push(id); continue; }
    for (const target of targets) records.push({ id: target, values });
  }
  const made = BUILD[datasetClass](records);
  const inputIds = new Set(lines.map(({ cells }) => at(cells, columns.id.column))).size;
  const missed = [...new Set(unmatched)];
  const tooMany = inputIds < 100 ? missed.length > 0 : missed.length > inputIds / 100;
  const ctx = { source: name, taxonId, date: version.replace(/-/g, '') };
  const skipped = [...index.skippedTypes];
  const findings = [
    finding('unmatchedIds', tooMany ? 'error' : 'warning', missed, `IDs not found at ${columns.id.level} level in the released GFF (or with nothing at ${level} level)`),
    finding('ambiguousIds', 'error', [...new Set(ambiguous)], `IDs that are at more than one level in the released GFF and not at the stated ${columns.id.level} level`),
    finding('ambiguousIdsResolved', 'warning', [...new Set(ambiguousMapped)], `IDs that are at more than one level in the released GFF; mapped from the stated ${columns.id.level} level`),
    finding('extraColumns', 'warning', wide, `line numbers with more columns than ${columns.header ? 'the header' : 'the widest mapped column'} (a tab inside a value?); the extra columns are ignored`),
    finding('emptyValue', 'warning', empty, 'rows with an empty required value; they are skipped'),
    ...made.findings,
    finding('noRows', 'error', made.rows.length ? [] : [datasetClass], 'nothing to load'),
    finding('skippedTypes', 'info', skipped.map(([type, n]) => `${type}: ${n}`), 'gene children of these feature types are not indexed (not mRNA-like transcripts), so IDs of those features are unmatched',
      skipped.reduce((sum, [, n]) => sum + n, 0))
  ].filter((f) => f.count);
  const format = datasetClass === 'GeneOntologyAssociations' ? gafLine : null;
  return {
    file: spec.file,
    text: made.rows.length ? fileText({ rows: made.rows, format }, ctx) : '',
    rows: made.rows.length,
    ids: { level, count: new Set(made.rows.map((r) => r[0])).size },
    findings
  };
}
