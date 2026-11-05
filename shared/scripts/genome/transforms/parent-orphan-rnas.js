import { cloneGraph, featureGroups, newFeature, parentsOf, renameIds, setRawAttr, spanLabel, withInsertions } from '../gff.js';
import { levelOf } from '../feature-types.js';
import { claimIds } from './claim-ids.js';

export function parentOrphanRnas(input) {
  const graph = cloneGraph(input);
  const claim = claimIds(graph, 'parentOrphanRnas');
  const before = new Map();
  const rename = new Map();
  const spans = new Map();
  const changes = [];
  for (const g of featureGroups(graph)) {
    if (levelOf(g.type) !== 'transcript' || g.lines.some((f) => parentsOf(f).length)) continue;
    const [first] = g.lines;
    const start = Math.min(...g.lines.map((f) => f.start));
    const end = Math.max(...g.lines.map((f) => f.end));
    const label = g.id ?? spanLabel({ seqId: first.seqId, start, end });
    const span = `${first.seqId}\t${start}\t${end}`;
    const seen = spans.get(span);
    if (seen && seen.strand !== first.strand) {
      throw Object.assign(new Error(`parentOrphanRnas: parentless RNAs ${seen.label} and ${label} share span ${first.seqId}:${start}-${end} on opposite strands; give one a parent gene in the input GFF`), { code: 'ORPHAN_OPPOSITE_STRANDS' });
    }
    const geneId = seen?.geneId ?? claim(`gene_${first.seqId}_${start}_${end}`, first.seqId);
    const rnaId = claim(`rna_${first.seqId}_${start}_${end}_${g.type}`, first.seqId);
    if (!seen) {
      spans.set(span, { strand: first.strand, geneId, label });
      before.set(first, [newFeature({ seqId: first.seqId, source: first.source, type: 'gene', start, end, strand: first.strand, attrs: [['ID', geneId]] })]);
    }
    for (const f of g.lines) {
      if (g.id === null) setRawAttr(f, 'ID', rnaId);
      setRawAttr(f, 'Parent', geneId);
    }
    if (g.id !== null) rename.set(g.id, rnaId);
    changes.push({ id: label, created: seen ? [rnaId] : [geneId, rnaId], from: { level: 'sequence', id: first.seqId } });
  }
  renameIds(graph, rename);
  return { graph: withInsertions(graph, { before }), changes };
}
