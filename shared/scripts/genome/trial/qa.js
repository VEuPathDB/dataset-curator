import { finding } from '../checks.js';
import { parseGff } from '../gff.js';
import { isfTrees } from '../isf-map.js';

export const sqlString = (value) => `'${String(value).replace(/'/g, "''")}'`;
export const sqlList = (values) => values.map(sqlString).join(', ');
const idList = (ids) => (ids.length ? ids.map(Number).join(', ') : 'NULL');
const GENE_TREE = /^pseudogene$|_gene$/;

export const releasesSql = (names, release) => [
  '-- trial:releases',
  'SELECT d.name, r.external_database_release_id AS release_id',
  'FROM sres.externaldatabase d JOIN sres.externaldatabaserelease r ON r.external_database_id = d.external_database_id',
  `WHERE d.name IN (${sqlList(names)}) AND r.version = ${sqlString(release)}`
].join('\n');

export const genesSql = (releaseIds) => [
  '-- trial:genes',
  `SELECT external_database_release_id AS release_id, source_id FROM dots.genefeature WHERE external_database_release_id IN (${idList(releaseIds)})`
].join('\n');

export const transcriptsSql = (releaseIds) => [
  '-- trial:transcripts',
  'SELECT t.external_database_release_id AS release_id, t.na_feature_id, t.source_id, count(a.aa_feature_id) AS proteins',
  'FROM dots.transcript t LEFT JOIN dots.translatedaafeature a ON a.na_feature_id = t.na_feature_id',
  `WHERE t.external_database_release_id IN (${idList(releaseIds)})`,
  'GROUP BY t.external_database_release_id, t.na_feature_id, t.source_id'
].join('\n');

export const internalStopsSql = (releaseIds) => [
  '-- trial:internalStops',
  'SELECT t.external_database_release_id AS release_id, t.source_id',
  'FROM dots.transcript t',
  'JOIN dots.translatedaafeature a ON a.na_feature_id = t.na_feature_id',
  'JOIN dots.translatedaasequence s ON s.aa_sequence_id = a.aa_sequence_id',
  `WHERE t.external_database_release_id IN (${idList(releaseIds)}) AND rtrim(s.sequence, '*') LIKE '%*%'`
].join('\n');

const LEFTOVER_TABLES = ['sres.externaldatabase', 'sres.externaldatabaserelease', 'dots.nasequenceimp', 'dots.nafeatureimp', 'dots.aafeatureimp', 'dots.aasequenceimp'];

export const leftoversSql = (names, release, invocationIds) => [
  '-- trial:leftovers',
  "SELECT 'trialRelease' AS what, count(*) AS n",
  'FROM sres.externaldatabase d JOIN sres.externaldatabaserelease r ON r.external_database_id = d.external_database_id',
  `WHERE d.name IN (${sqlList(names)}) AND r.version = ${sqlString(release)}`,
  `UNION ALL SELECT 'trialDatabases', count(*) FROM sres.externaldatabase WHERE name IN (${sqlList(names)})`,
  ...(invocationIds.length
    ? LEFTOVER_TABLES.map((table) => `UNION ALL SELECT '${table}', count(*) FROM ${table} WHERE row_alg_invocation_id IN (${idList(invocationIds)})`)
    : [])
].join('\n');

/** Not part of the blocking check: a killed run's invocation row keeps row_alg_invocation_id 1, so Undo cannot remove it. */
export const invocationRowsSql = (invocationIds) => [
  '-- trial:invocationRows',
  `SELECT algorithm_invocation_id FROM core.algorithminvocation WHERE algorithm_invocation_id IN (${idList(invocationIds)}) ORDER BY algorithm_invocation_id`
].join('\n');

export const invocationRowFindings = (rows) => rows.map((r) => finding('trial', 'invocationNotRemovable', 'warning', [String(r.algorithm_invocation_id)],
  `invocation ${r.algorithm_invocation_id} not removable by Undo (run was killed); delete it by hand: core.algorithmparam then core.algorithminvocation`
  + ` where algorithm_invocation_id = ${r.algorithm_invocation_id}`));

/** Gene trees from D's ISF port: what dots.genefeature should hold. featureCount also counts repeat, gap and UTR trees. */
export function expectedModels(gff3Text) {
  const genes = isfTrees(parseGff(gff3Text)).trees.filter((t) => GENE_TREE.test(t.type));
  return {
    geneIds: genes.map((g) => g.id),
    codingTranscriptIds: genes.flatMap((g) => g.children).filter((t) => t.type === 'mRNA' && !t.keys.includes('pseudo')).map((t) => t.id)
  };
}

export const parseTranscriptInfo = (text) => text.split('\n').filter((line) => line.trim() !== '')
  .map((line) => {
    const columns = line.split('\t');
    return { gene: columns[0], transcript: columns[4] ?? null };
  });

function partitionFindings(p, db) {
  const at = (message) => `${p.name}: ${message}`;
  const loaded = new Set(db.genes);
  const missing = p.expected.geneIds.filter((id) => !loaded.has(id));
  const coding = new Set(p.expected.codingTranscriptIds);
  const inDb = new Set(db.transcripts.map((t) => t.source_id));
  const inFile = new Set(p.transcriptInfo.map((r) => r.transcript));
  const validation = p.validationLogs.filter((v) => v.text.trim() !== '');
  return [
    finding('trial', 'geneCount', 'error', missing,
      at(`${db.genes.length} genes loaded, ${p.expected.geneIds.length} gene trees expected (featureCount ${p.featureCount}); sample: GFF genes not in dots.genefeature`),
      null, Math.max(Math.abs(p.expected.geneIds.length - db.genes.length), missing.length)),
    finding('trial', 'multipleProteins', 'error', db.transcripts.filter((t) => Number(t.proteins) > 1).map((t) => t.source_id),
      at('transcripts with more than one protein')),
    finding('trial', 'codingNoProtein', 'error',
      db.transcripts.filter((t) => coding.has(t.source_id) && Number(t.proteins) === 0).map((t) => t.source_id),
      at('coding transcripts with no protein')),
    finding('trial', 'transcriptIds', 'error',
      [...[...inDb].filter((id) => !inFile.has(id)), ...[...inFile].filter((id) => !inDb.has(id))],
      at('transcript source_ids in only one of dots.transcript and column 5 of transcriptInfoAndIds')),
    finding('trial', 'transcriptInfoRows', 'error', [],
      at(`transcriptInfoAndIds has ${p.transcriptInfo.length} rows for ${db.transcripts.length} transcripts loaded`), null,
      Math.abs(p.transcriptInfo.length - db.transcripts.length)),
    finding('trial', 'internalStop', 'warning', db.internalStops, at('proteins with an internal stop codon; a CDS may span an intron')),
    ...validation.map((v) => {
      const lines = v.text.trimEnd().split('\n');
      return finding('trial', 'validationLog', 'warning', lines, at(`${v.key} wrote ${lines.length} lines to its validation.log`));
    })
  ].filter((f) => f.count > 0);
}

const TOP = 10;
export const PROFILE_SOURCE_SQL = '-- trial:profileSource\nSELECT n.nspname AS schema FROM pg_extension e'
  + " JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'pg_stat_statements'";
export const sqlIdentifier = (name) => `"${String(name).replace(/"/g, '""')}"`;
/** Qualified by the extension's schema: a GUS login's search_path need not include it. */
export const statementsSql = (schema) => '-- trial:statements\nSELECT queryid, calls, total_exec_time, left(query, 300) AS query'
  + ` FROM ${sqlIdentifier(schema)}.pg_stat_statements WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())`;
export const TABLES_SQL = "-- trial:tables\nSELECT schemaname || '.' || relname AS name, seq_scan, idx_scan, n_tup_ins FROM pg_stat_user_tables";

export const TABLES_PROBE = { source: 'pg_stat_user_tables' };
export function profileSource(select) {
  const schema = select(PROFILE_SOURCE_SQL)[0]?.schema;
  return schema ? { source: 'pg_stat_statements', schema } : TABLES_PROBE;
}
export const snapshot = (probe, select) => select(probe.source === 'pg_stat_statements' ? statementsSql(probe.schema) : TABLES_SQL);

function totals(rows, keyOf, fields) {
  const out = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    const total = out.get(key) ?? { key, row, ...Object.fromEntries(fields.map((f) => [f, 0])) };
    for (const f of fields) total[f] += Number(row[f] ?? 0);
    out.set(key, total);
  }
  return out;
}

function differences(before, after, keyOf, fields) {
  const was = totals(before, keyOf, fields);
  return [...totals(after, keyOf, fields).values()]
    .map((t) => ({ ...t, ...Object.fromEntries(fields.map((f) => [f, t[f] - (was.get(t.key)?.[f] ?? 0)])) }))
    .filter((t) => fields.some((f) => t[f] > 0));
}

const top = (rows, field, shape) => rows.filter((r) => r[field] > 0).sort((a, b) => b[field] - a[field]).slice(0, TOP).map(shape);

/** The work one ISF run did, from snapshots taken before and after it. */
export function profileDiff(source, before, after) {
  if (source === 'pg_stat_statements') {
    const rows = differences(before, after, (r) => r.queryid ?? r.query, ['calls', 'total_exec_time']);
    const shape = (t) => ({ query: t.row.query, calls: t.calls, totalMs: Math.round(t.total_exec_time) });
    return { source, byCalls: top(rows, 'calls', shape), byTotalTime: top(rows, 'total_exec_time', shape) };
  }
  const rows = differences(before, after, (r) => r.name, ['seq_scan', 'idx_scan', 'n_tup_ins']);
  const shape = (t) => ({ table: t.key, seqScans: t.seq_scan, idxScans: t.idx_scan, inserts: t.n_tup_ins });
  return { source, byScans: top(rows, 'seq_scan', shape), byInserts: top(rows, 'n_tup_ins', shape) };
}

export const profileEntry = (diff, { seconds, genes }) =>
  ({ ...diff, seconds, secondsPerGene: genes > 0 ? Math.round((seconds / genes) * 1000) / 1000 : null });

export function profileFindings(profile) {
  return Object.entries(profile).flatMap(([key, p]) => {
    const time = finding('trial', 'isfTime', 'info', [], `${key}: ${p.seconds} s, ${p.secondsPerGene ?? 'n/a'} s per gene`, null, 1);
    if (p.error) return [time, finding('trial', 'isfProfile', 'info', [], `${key}: profiling unavailable: ${p.error}`, null, 1)];
    const statements = p.source === 'pg_stat_statements';
    const busiest = statements
      ? p.byTotalTime.map((q) => `${q.totalMs} ms in ${q.calls} calls: ${q.query}`)
      : p.byScans.map((t) => `${t.table}: ${t.seqScans} sequential scans, ${t.inserts} inserts`);
    const why = p.fallback ? `; pg_stat_statements failed: ${p.fallback}` : '';
    return [
      time,
      finding('trial', 'isfProfile', 'info', busiest, `${key}: busiest ${statements ? 'queries by total time' : 'tables by sequential scans'} (${p.source}${why})`)
    ].filter((f) => f.count > 0);
  });
}

/** parts: [{ name, featureCount, releaseId, expected, transcriptInfo, validationLogs }]; rows from the three QA SELECTs. */
export function qaFindings(parts, { genes, transcripts, internalStops }) {
  return parts.flatMap((p) => {
    const mine = (rows) => rows.filter((r) => p.releaseId != null && String(r.release_id) === String(p.releaseId));
    return partitionFindings(p, {
      genes: mine(genes).map((r) => r.source_id),
      transcripts: mine(transcripts),
      internalStops: mine(internalStops).map((r) => r.source_id)
    });
  });
}
