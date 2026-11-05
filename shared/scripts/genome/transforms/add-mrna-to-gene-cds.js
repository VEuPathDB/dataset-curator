import { cloneGraph, featureGroups, indexGraph, newFeature, parentsOf, setRawAttr, withInsertions } from '../gff.js';
import { levelOf } from '../feature-types.js';
import { claimIds } from './claim-ids.js';

export function addMrnaToGeneCds(input) {
  const graph = cloneGraph(input);
  const { childrenOf } = indexGraph(graph);
  const claim = claimIds(graph, 'addMrnaToGeneCds');
  const after = new Map();
  const changes = [];
  for (const g of featureGroups(graph)) {
    if (levelOf(g.type) !== 'gene' || g.id === null) continue;
    const kids = childrenOf(g.id);
    const cds = kids.filter((f) => f.type === 'CDS');
    if (!cds.length || kids.some((f) => levelOf(f.type) === 'transcript')) continue;
    const mrnaId = claim(`${g.id}_mRNA`, g.id);
    const [first] = g.lines;
    after.set(g.lines.at(-1), [newFeature({
      seqId: first.seqId, source: first.source, type: 'mRNA',
      start: Math.min(...g.lines.map((f) => f.start)), end: Math.max(...g.lines.map((f) => f.end)), strand: first.strand,
      attrs: [['ID', mrnaId], ['Parent', g.id]]
    })]);
    for (const f of cds) setRawAttr(f, 'Parent', parentsOf(f).map((p) => (p === g.id ? mrnaId : p)).join(','));
    changes.push({ id: g.id, created: [mrnaId], from: { level: 'gene', id: g.id } });
  }
  return { graph: withInsertions(graph, { after }), changes };
}
