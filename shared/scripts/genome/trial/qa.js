import { finding } from '../checks.js';
import { parseGff } from '../gff.js';
import { isfTrees } from '../isf-map.js';

export const sqlString = (value) => `'${String(value).replace(/'/g, "''")}'`;
export const sqlList = (values) => values.map(sqlString).join(', ');
const idList = (ids) => ids.map(Number).join(', ');
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
  'SELECT t.external_database_release_id AS release_id, t.source_id, count(a.aa_feature_id) AS proteins',
  'FROM dots.transcript t LEFT JOIN dots.translatedaafeature a ON a.na_feature_id = t.na_feature_id',
  `WHERE t.external_database_release_id IN (${idList(releaseIds)})`,
  'GROUP BY t.external_database_release_id, t.source_id'
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
  ...(invocationIds.length
    ? LEFTOVER_TABLES.map((table) => `UNION ALL SELECT '${table}', count(*) FROM ${table} WHERE row_alg_invocation_id IN (${idList(invocationIds)})`)
    : [])
].join('\n');

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

/** parts: [{ name, featureCount, releaseId, expected, transcriptInfo, validationLogs }]; rows from the three QA SELECTs. */
export function qaFindings(parts, { genes, transcripts, internalStops }) {
  return parts.flatMap((p) => {
    const mine = (rows) => rows.filter((r) => p.releaseId !== null && r.release_id === p.releaseId);
    return partitionFindings(p, {
      genes: mine(genes).map((r) => r.source_id),
      transcripts: mine(transcripts),
      internalStops: mine(internalStops).map((r) => r.source_id)
    });
  });
}
