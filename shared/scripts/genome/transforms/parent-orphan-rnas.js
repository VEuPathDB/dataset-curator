import { cloneGraph, featureGroups, newFeature, parentsOf, renameIds, setRawAttr, withInsertions } from '../gff.js';
import { levelOf } from '../feature-types.js';
import { claimIds } from './claim-ids.js';

export function parentOrphanRnas(input) {
  const graph = cloneGraph(input);
  const claim = claimIds(graph, 'parentOrphanRnas');
  const before = new Map();
  const rename = new Map();
  const changes = [];
  for (const g of featureGroups(graph)) {
    if (levelOf(g.type) !== 'transcript' || g.lines.some((f) => parentsOf(f).length)) continue;
    const [first] = g.lines;
    const start = Math.min(...g.lines.map((f) => f.start));
    const end = Math.max(...g.lines.map((f) => f.end));
    const label = g.id ?? `${first.seqId}:${start}..${end}`;
    const geneId = claim(`gene_${first.seqId}_${start}_${end}`, first.seqId);
    const rnaId = claim(`rna_${first.seqId}_${start}_${end}_${g.type}`, first.seqId);
    before.set(first, [newFeature({ seqId: first.seqId, source: first.source, type: 'gene', start, end, strand: first.strand, attrs: [['ID', geneId]] })]);
    for (const f of g.lines) {
      if (g.id === null) setRawAttr(f, 'ID', rnaId);
      setRawAttr(f, 'Parent', geneId);
    }
    if (g.id !== null) rename.set(g.id, rnaId);
    changes.push({ id: label, created: [geneId, rnaId], from: { level: 'sequence', id: first.seqId } });
  }
  renameIds(graph, rename);
  return { graph: withInsertions(graph, { before }), changes };
}
