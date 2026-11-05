import { cloneGraph, featureGroups, withoutFeatures } from '../gff.js';
import { levelOf } from '../feature-types.js';

export function collapseSplitGenes(input) {
  const graph = cloneGraph(input);
  const drop = new Set();
  const changes = [];
  for (const g of featureGroups(graph)) {
    if (levelOf(g.type) !== 'gene' || g.id === null || g.lines.length < 2) continue;
    const [first, ...rest] = g.lines;
    if (rest.some((f) => f.seqId !== first.seqId || f.strand !== first.strand)) {
      throw Object.assign(new Error(`collapseSplitGenes: gene ${g.id} has lines on different sequences or strands`), { code: 'SPLIT_ACROSS', id: g.id });
    }
    first.start = Math.min(...g.lines.map((f) => f.start));
    first.end = Math.max(...g.lines.map((f) => f.end));
    rest.forEach((f) => drop.add(f));
    changes.push({ id: g.id, removedLines: rest.length });
  }
  return { graph: withoutFeatures(graph, drop), changes };
}
