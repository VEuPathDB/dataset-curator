import { features, parentsOf } from './gff.js';

/** { <GFF type>: count } over the feature lines of a GFF, sorted by type; column 3 only, so either attribute syntax reads. */
export function featureTypesOf(gffText) {
  const counts = {};
  for (const line of gffText.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const type = line.split('\t')[2];
    if (type) counts[type] = (counts[type] ?? 0) + 1;
  }
  return Object.fromEntries(Object.keys(counts).sort().map((type) => [type, counts[type]]));
}

/** The longest gap between consecutive exons of one parent, in bases, or 0. */
export function maxIntronOf(graph) {
  const exons = new Map();
  for (const f of features(graph)) {
    if (f.type !== 'exon') continue;
    for (const parent of parentsOf(f)) exons.set(parent, [...(exons.get(parent) ?? []), f]);
  }
  let max = 0;
  for (const list of exons.values()) {
    const sorted = [...list].sort((a, b) => a.start - b.start);
    for (let i = 1; i < sorted.length; i++) max = Math.max(max, sorted[i].start - sorted[i - 1].end - 1);
  }
  return max;
}
