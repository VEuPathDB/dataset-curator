import { cloneGraph, featureGroups, idOf, indexGraph, newFeature, withInsertions } from '../gff.js';
import { levelOf } from '../feature-types.js';
import { claimIds } from './claim-ids.js';

export function addExonPerCds(input) {
  const graph = cloneGraph(input);
  const { childrenOf } = indexGraph(graph);
  const claim = claimIds(graph, 'addExonPerCds');
  const after = new Map();
  const changes = [];
  for (const g of featureGroups(graph)) {
    if (levelOf(g.type) !== 'transcript' || g.id === null) continue;
    const kids = childrenOf(g.id);
    const cds = kids.filter((f) => f.type === 'CDS');
    if (!cds.length || kids.some((f) => f.type === 'exon')) continue;
    const minus = g.lines[0].strand === '-';
    const ordered = [...cds].sort((a, b) => (minus ? b.start - a.start : a.start - b.start));
    const exons = ordered.map((c, i) => newFeature({
      seqId: c.seqId, source: c.source, type: 'exon', start: c.start, end: c.end, strand: c.strand,
      attrs: [['ID', claim(`${g.id}_exon${i + 1}`, g.id)], ['Parent', g.id]]
    }));
    after.set(g.lines.at(-1), exons);
    changes.push({ id: g.id, created: exons.map(idOf), from: { level: 'transcript', id: g.id } });
  }
  return { graph: withInsertions(graph, { after }), changes };
}
