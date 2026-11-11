import { fileText, gafLine, productRows, uniqueSorted } from '../../genome/functional/writers.js';
import { isEc } from '../../genome/functional/values.js';
import { AMBIGUOUS, LEVELS, levelOfId, mapId } from './gff-ids.js';

const SAMPLE = 20;
/** Same shape as genome/checks.js finding, without importing the genome pipeline's checks. */
const finding = (check, severity, ids, message, count = ids.length) => ({ group: 'convert', check, severity, count, sample: ids.slice(0, SAMPLE), message });

const GO_ID = /^(?:GO:)?(\d{1,7})$/;
const EVIDENCE = /^[A-Z]{2,3}$/;
const ASPECTS = { F: 'F', P: 'P', C: 'C', molecular_function: 'F', biological_process: 'P', cellular_component: 'C', function: 'F', process: 'P', component: 'C' };
const PREFERRED = /^(1|true|yes|y)$/i;

/** Per class: the ID level it loads at (null: the ID column's own level), its file, required and optional value columns. */
export const CONVERTERS = Object.freeze({
  productNames: { level: 'transcript', file: 'products.txt', values: ['product'], optional: ['preferred'] },
  GeneOntologyAssociations: { level: 'transcript', file: 'associations.gas', values: ['goId'], optional: ['aspect', 'evidence', 'reference'] },
  EnzymeCommissionAssociations: { level: 'protein', file: 'ec.txt', values: ['ec'], optional: [] },
  geneName: { level: 'gene', file: 'geneName.txt', values: ['name'], optional: [] },
  comments: { level: null, file: 'comments.txt', values: ['comment'], optional: [] },
  aliases: { level: 'transcript', file: 'aliases.txt', values: ['alias'], optional: [] }
});

export function readTab(text) {
  return text.split(/\r?\n/).filter((l) => l.trim() !== '' && !l.startsWith('#')).map((l) => l.split('\t').map((c) => c.trim()));
}

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

const BUILD = {
  productNames(records) {
    if (records.every((r) => r.values.preferred === undefined)) return { rows: productRows(records.map((r) => [r.id, r.values.product])).rows, findings: [] };
    return { rows: uniqueSorted(records.map((r) => [r.id, r.values.product, PREFERRED.test(r.values.preferred ?? '') ? '1' : '0'])), findings: [] };
  },
  GeneOntologyAssociations(records) {
    const bad = [];
    const noAspect = [];
    const rows = [];
    for (const { id, values } of records) {
      const go = GO_ID.exec(values.goId);
      const evidence = values.evidence || 'IEA';
      if (!go || !EVIDENCE.test(evidence)) { bad.push(`${id}: ${values.goId} ${evidence}`); continue; }
      const aspect = ASPECTS[values.aspect ?? ''] ?? '';
      if (!aspect) noAspect.push(id);
      rows.push([id, `GO:${go[1].padStart(7, '0')}`, values.reference ?? '', evidence, aspect]);
    }
    return {
      rows: uniqueSorted(rows),
      findings: [
        finding('badGo', 'warning', bad, 'rows whose GO id or evidence code is not valid; they are skipped'),
        finding('goAspectMissing', 'warning', noAspect, 'associations with no aspect (F, P or C); the GAF aspect column is empty')
      ]
    };
  },
  EnzymeCommissionAssociations(records) {
    const bad = [...new Set(records.filter((r) => !isEc(r.values.ec)).map((r) => r.values.ec))];
    return { rows: uniqueSorted(records.filter((r) => isEc(r.values.ec)).map((r) => [r.id, r.values.ec])), findings: [finding('badEc', 'warning', bad, 'distinct EC numbers that are not four dot-separated numbers or -; they are skipped')] };
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

/**
 * The curator's tab text as the class's loader file. Each row's ID must be at columns.id.level in the released GFF;
 * it is mapped to the class's level. Returns { file, text, rows, ids: { level, count }, findings }.
 */
export function convert({ datasetClass, name, version, text, columns, index, taxonId }) {
  const spec = CONVERTERS[datasetClass];
  const lines = readTab(text).slice(columns.header ? 1 : 0);
  const at = (row, n) => (n ? row[n - 1] ?? '' : undefined);
  const level = spec.level ?? columns.id.level;
  const unmatched = [];
  const ambiguous = [];
  const empty = [];
  const records = [];
  for (const row of lines) {
    const id = at(row, columns.id.column);
    const values = Object.fromEntries(Object.entries(columns.values).map(([k, n]) => [k, at(row, n)]));
    if (spec.values.some((k) => !values[k])) { empty.push(id || '(no id)'); continue; }
    const found = levelOfId(index, id);
    if (found === AMBIGUOUS) { ambiguous.push(id); continue; }
    const targets = found === columns.id.level ? mapId(index, id, columns.id.level, level) : [];
    if (!targets.length) { unmatched.push(id); continue; }
    for (const target of targets) records.push({ id: target, values });
  }
  const made = BUILD[datasetClass](records);
  const inputIds = new Set(lines.map((row) => at(row, columns.id.column))).size;
  const missed = [...new Set(unmatched)];
  const tooMany = inputIds < 100 ? missed.length > 0 : missed.length > inputIds / 100;
  const ctx = { source: name, taxonId, date: version.replace(/-/g, '') };
  const skipped = [...index.skippedTypes];
  const findings = [
    finding('unmatchedIds', tooMany ? 'error' : 'warning', missed, `IDs not found at ${columns.id.level} level in the released GFF (or with nothing at ${level} level)`),
    finding('ambiguousIds', 'error', [...new Set(ambiguous)], 'IDs that are at more than one level (gene, transcript, protein) in the released GFF, so their level cannot be told'),
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
