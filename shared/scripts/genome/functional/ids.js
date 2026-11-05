import { levelOf } from '../feature-types.js';
import { featureGroups, parentsOf, spanLabel } from '../gff.js';

/** GusSkeletonMaker names translations `<transcript>-p<n>`; ISF makes one per transcript. */
export const proteinIdOf = (transcriptId) => `${transcriptId}-p1`;
const labelOf = (group) => group.id ?? spanLabel(group.lines[0]);

/**
 * The genes, RNAs and CDSs of one GFF3 with the gene and transcript IDs ISF loads them under, found through Parent.
 * A CDS under several transcripts appears once for each.
 */
export function resolveFeatures(graph) {
  const groups = featureGroups(graph);
  const ofLevel = (level) => new Map(groups.filter((g) => g.id !== null && levelOf(g.type) === level).map((g) => [g.id, g]));
  const genes = ofLevel('gene');
  const transcripts = ofLevel('transcript');
  const geneOf = (rna) => parentsOf(rna.lines[0]).find((p) => genes.has(p)) ?? null;
  const features = [];
  const unresolved = [];
  for (const group of groups) {
    const level = levelOf(group.type);
    if (level === 'gene' && group.id !== null) {
      features.push({ kind: 'gene', group, gene: group.id, transcript: null });
    } else if (level === 'transcript') {
      const gene = group.id === null ? null : geneOf(group);
      if (gene === null) unresolved.push(labelOf(group));
      else features.push({ kind: 'rna', group, gene, transcript: group.id, hasCds: false });
    } else if (group.type === 'CDS') {
      const owners = parentsOf(group.lines[0]).filter((p) => transcripts.has(p))
        .map((transcript) => ({ gene: geneOf(transcripts.get(transcript)), transcript })).filter((o) => o.gene !== null);
      if (!owners.length) unresolved.push(labelOf(group));
      for (const owner of owners) features.push({ kind: 'cds', group, ...owner });
    }
  }
  const coding = new Set(features.filter((f) => f.kind === 'cds').map((f) => f.transcript));
  for (const f of features) if (f.kind === 'rna') f.hasCds = coding.has(f.transcript);
  return { features, unresolved, codingTranscripts: [...coding] };
}
