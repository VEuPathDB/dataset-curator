import { featureGroups, getValues, idOf, indexGraph, parentsOf, seqIdsOf } from './gff.js';
import { levelOf } from './feature-types.js';
import { ALLOWED_EXTRA_KEYS, isfTrees } from './isf-map.js';

const SAMPLE = 20;
const finding = (group, check, severity, ids, message, fix = null, count = ids.length) =>
  ({ group, check, severity, count, sample: ids.slice(0, SAMPLE), message, fix });
const labelOf = (x) => x.id ?? `${x.seqId}:${x.start}..${x.end}`;
const lineLabel = (f) => idOf(f) ?? labelOf(f);
const groupLabel = (g) => g.id ?? lineLabel(g.lines[0]);
function tally(items) {
  const counts = new Map();
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1);
  return [...counts].map(([item, n]) => `${item} ${n}`).join(', ');
}
function walk(trees, visit) {
  for (const t of trees) { visit(t); walk(t.children, visit); }
}

export const formatFinding = (f) =>
  `${f.stage ? `${f.stage} ` : ''}${f.severity} ${f.group}/${f.check} (${f.count}): ${f.message}${f.sample.length ? ` [${f.sample.join(', ')}]` : ''}`;

/** A new ids.tsv line for an input ID, or a pointer to the line that already renames it. */
const idsFixLine = (level, old, idsEntries) => {
  const existing = idsEntries.find((e) => e.old === old);
  return existing ? `ids.tsv line ${existing.line} already renames ${old}; give it a different new ID` : `${level}\t${old}\t<new id>`;
};
const idsFix = (lines) => (lines.length ? { ids: [...new Set(lines)] } : null);

export function runChecks({
  graph, isfMap, fastaIds, plan, synthesized = new Map(), inputIdOf = new Map(), inputSequenceIdOf = new Map(), idsEntries = []
}) {
  const groups = featureGroups(graph);
  const { childrenOf } = indexGraph(graph);
  const { trees, dropped } = isfTrees(graph);
  const inputOf = (id) => inputIdOf.get(id) ?? id;
  const rootInputOf = (from) => (from.level === 'sequence' ? inputSequenceIdOf.get(from.id) ?? from.id : inputOf(from.id));
  return [
    ...structureFindings(groups, childrenOf),
    ...unhandledFindings(trees, dropped, isfMap),
    ...attributeFindings(trees, isfMap),
    ...idFindings(groups, childrenOf, synthesized, { inputOf, rootInputOf, idsEntries }),
    ...sequenceFindings(graph, fastaIds, plan)
  ];
}

const contains = (outer, inner) => outer.seqId === inner.seqId && outer.start <= inner.start && inner.end <= outer.end;

function structureFindings(groups, childrenOf) {
  const kids = (g) => (g.id === null ? [] : childrenOf(g.id));
  const genes = groups.filter((g) => levelOf(g.type) === 'gene');
  const transcripts = groups.filter((g) => levelOf(g.type) === 'transcript');
  const hasCds = (g) => kids(g).some((f) => f.type === 'CDS');
  const parentless = (g) => levelOf(g.type) === 'transcript' && g.lines.every((f) => !parentsOf(f).length);
  const hasRna = (g) => kids(g).some((f) => levelOf(f.type) === 'transcript');
  const cdsUnderGene = [...new Set(genes.filter((g) => hasCds(g) && hasRna(g))
    .flatMap((g) => kids(g).filter((f) => f.type === 'CDS').map(lineLabel)))];
  const strandsOf = (g) => {
    const direct = kids(g);
    const grandchildren = direct.filter((t) => levelOf(t.type) === 'transcript' && idOf(t) !== null).flatMap((t) => childrenOf(idOf(t)));
    return new Set([...g.lines, ...direct, ...grandchildren].map((f) => f.strand));
  };
  const cdsOutsideExons = (g) => {
    const exons = kids(g).filter((f) => f.type === 'exon');
    const cds = kids(g).filter((f) => f.type === 'CDS');
    const placed = (e) => cds.filter((c) => contains(e, c)).length;
    return exons.length > 0 && (cds.some((c) => !exons.some((e) => contains(e, c))) || exons.some((e) => placed(e) > 1));
  };
  return [
    finding('structure', 'geneCdsNoRna', 'error',
      genes.filter((g) => hasCds(g) && !hasRna(g)).map(groupLabel),
      'genes with CDS children and no RNA; ISF drops them', { transforms: [{ name: 'addMrnaToGeneCds' }, { name: 'addExonPerCds' }] }),
    finding('structure', 'transcriptCdsNoExon', 'error',
      transcripts.filter((g) => hasCds(g) && !kids(g).some((f) => f.type === 'exon')).map(groupLabel),
      'transcripts with CDS and no exons; ISF loads them as one exon or dies', { transforms: [{ name: 'addExonPerCds' }] }),
    finding('structure', 'repeatedGeneLines', 'error', genes.filter((g) => g.lines.length > 1).map(groupLabel),
      'genes repeated over several lines with one ID', { transforms: [{ name: 'collapseSplitGenes' }] }),
    finding('structure', 'parentlessRna', 'error', transcripts.filter(parentless).map(groupLabel),
      'RNAs with no parent gene', { transforms: [{ name: 'parentOrphanRnas' }] }),
    finding('structure', 'childlessGene', 'warning', genes.filter((g) => !kids(g).length).map(groupLabel), 'genes with no children; ISF drops them'),
    finding('structure', 'cdsUnderGene', 'error', cdsUnderGene,
      'CDS whose parent is a gene that also has an RNA child; no transform moves it, fix the input GFF'),
    finding('structure', 'missingId', 'error', [...genes, ...transcripts].filter((g) => g.id === null && !parentless(g)).map(groupLabel),
      'gene or RNA lines with no ID; ISF dies on them, fix the input GFF'),
    finding('structure', 'strandMismatch', 'error', genes.filter((g) => g.id !== null && strandsOf(g).size > 1).map(groupLabel),
      'genes whose transcripts or exons are not all on the gene\'s strand; ISF dies on them, fix the input GFF'),
    finding('structure', 'cdsOutsideExons', 'error', transcripts.filter(cdsOutsideExons).map(groupLabel),
      'transcripts with a CDS segment outside their exons or several CDS segments in one exon; ISF dies on them, fix the input GFF')
  ].filter((f) => f.count);
}

function unhandledFindings(trees, dropped, isfMap) {
  const lost = dropped.map((d) => ({ type: d.type, label: labelOf(d) }));
  walk(trees, (n) => { if (!isfMap.features.has(n.type)) lost.push({ type: `${n.type} (not in the map)`, label: labelOf(n) }); });
  if (!lost.length) return [];
  return [finding('structure', 'unhandledType', 'warning', lost.map((l) => l.label), `ISF drops these features: ${tally(lost.map((l) => l.type))}`)];
}

function attributeFindings(trees, isfMap) {
  const bad = new Map();
  walk(trees, (n) => {
    const spec = isfMap.features.get(n.type);
    if (!spec || spec.ignore) return;
    const keys = n.keys.filter((k) => !spec.qualifiers.has(k) && !ALLOWED_EXTRA_KEYS.has(k));
    if (!keys.length) return;
    if (!bad.has(n.gffType)) bad.set(n.gffType, { isfTypes: new Set(), keys: new Set(), ids: [] });
    const entry = bad.get(n.gffType);
    entry.isfTypes.add(n.type);
    keys.forEach((k) => entry.keys.add(k));
    entry.ids.push(labelOf(n));
  });
  return [...bad].map(([gffType, entry]) => {
    const keys = [...entry.keys].sort();
    return finding('attributes', 'attributeNotInMap', 'error', entry.ids,
      `${gffType} (ISF ${[...entry.isfTypes].join(', ')}) carries keys the map does not list: ${keys.join(', ')}`,
      { transforms: [{ name: 'stripAttributes', args: { type: gffType, keys } }] });
  });
}

/** IDs carried by more than one feature group (groups differ in ID or type). */
export function duplicateIds(groups) {
  const owners = new Map();
  for (const g of groups) {
    if (g.id === null) continue;
    if (!owners.has(g.id)) owners.set(g.id, []);
    owners.get(g.id).push(g.type);
  }
  return [...owners].filter(([, types]) => types.length > 1).map(([id, types]) => ({ id, types }));
}

function idFindings(groups, childrenOf, synthesized, { inputOf, rootInputOf, idsEntries }) {
  const dups = duplicateIds(groups);
  const dupLines = dups.flatMap((d) => {
    const owner = d.types.filter((t) => levelOf(t)).at(-1);
    return owner ? [idsFixLine(levelOf(owner), inputOf(d.id), idsEntries)] : [];
  });
  const present = new Set(groups.filter((g) => g.id !== null).map((g) => g.id));
  const punct = [...synthesized.keys()].filter((id) => present.has(id) && /[:-]/.test(id));
  const sourceLines = punct.map((id) => synthesized.get(id)).map((from) => idsFixLine(from.level, rootInputOf(from), idsEntries));
  const proteinIds = (g) => new Set(childrenOf(g.id).filter((f) => f.type === 'CDS').flatMap((f) => getValues(f, 'protein_id')));
  const multi = groups.filter((g) => g.id !== null && levelOf(g.type) === 'transcript' && proteinIds(g).size > 1).map((g) => g.id);
  return [
    finding('ids', 'duplicateId', 'error', dups.map((d) => d.id),
      `IDs used by several features: ${dups.slice(0, SAMPLE).map((d) => `${d.id} (${d.types.join(', ')})`).join('; ')}`, idsFix(dupLines)),
    finding('ids', 'synthesizedIdPunctuation', 'error', punct, 'created IDs containing ":" or "-"; rename what they are made from', idsFix(sourceLines)),
    finding('ids', 'multipleProteinIds', 'error', multi, 'transcripts whose CDSs carry more than one protein_id')
  ].filter((f) => f.count);
}

/** The phase-1 collisions of an ID policy, as a duplicateId finding naming input IDs. */
export function collisionFinding(collisions, idsEntries = []) {
  const lines = collisions.flatMap((c) => {
    const owners = c.olds.filter((o) => o.level);
    return (owners.length > 1 ? owners.slice(1) : owners).map((o) => idsFixLine(o.level, o.id, idsEntries));
  });
  return finding('ids', 'duplicateId', 'error', collisions.map((c) => c.id),
    `the ID policy gives one ID to several features: ${collisions.slice(0, SAMPLE).map((c) => `${c.id} ← ${c.olds.map((o) => o.id).join(' and ')}`).join('; ')}`,
    idsFix(lines));
}

/** A transform's ID_COLLISION as a duplicateId finding naming the root input whose ids.tsv line fixes it. */
export function collisionFromError(e, policy, idsEntries = []) {
  const { level, id } = e.from;
  const root = (level === 'sequence' ? policy.inputSequenceIdOf : policy.inputIdOf).get(id) ?? id;
  return finding('ids', 'duplicateId', 'error', [e.id], `${e.message}; it derives from input ${level} ${root}`,
    idsFix([idsFixLine(level, root, idsEntries)]));
}

const PROBLEMS = {
  notInReport: 'sequences missing from the assembly report',
  missingAccession: 'sequences with no GenBank accession in the assembly report',
  unknownRole: 'sequences with a Sequence-Role this pipeline does not rank',
  unknownLocationType: 'sequences with a location type this pipeline does not rank',
  duplicateAccession: 'accessions on more than one assembly report row',
  unusedOverride: 'partitions.tsv rows for sequences not in the GFF or FASTA; remove them',
  multiplePrimary: 'more than one primary partition',
  noPrimary: 'no primary partition',
  conflictingSoTerm: 'organelle partitions whose sequences have different soTerms'
};
const NOT_A_SEQUENCE = new Set(['multiplePrimary', 'noPrimary', 'conflictingSoTerm', 'unusedOverride']);

function problemFinding(kind, message, problems) {
  const hits = problems.filter((p) => p.kind === kind);
  if (NOT_A_SEQUENCE.has(kind)) {
    const details = hits.map((p) => p.sequence).filter((s) => s !== null);
    const sample = kind === 'unusedOverride' ? details : [];
    return finding('sequences', kind, 'error', sample, details.length && !sample.length ? `${message}: ${details.join('; ')}` : message, null, hits.length);
  }
  const ids = hits.map((p) => p.sequence);
  return finding('sequences', kind, 'error', ids, message, { partitions: ids.map((s) => `${s}\t<role>\t<soTerm>\t<organelle>`) });
}

function sequenceFindings(graph, fastaIds, plan) {
  const out = [finding('sequences', 'seqIdNotInFasta', 'error', seqIdsOf(graph).filter((id) => !fastaIds.has(id)), 'GFF sequences missing from the FASTA')];
  for (const [kind, message] of Object.entries(PROBLEMS)) out.push(problemFinding(kind, message, plan.problems));
  out.push(finding('sequences', 'partitionCounts', 'info', plan.partitions.map((p) => p.dir),
    plan.partitions.map((p) => `${p.dir.slice('final/'.length)}: ${p.sequences.length}`).join(', ')));
  return out.filter((f) => f.count);
}
