import { GENE_TYPES, ISF_RNA_TYPES, TRANSCRIPT_TYPES } from '../feature-types.js';
import { featureGroups, parentsOf, spanLabel } from '../gff.js';

/** GusSkeletonMaker names translations `<transcript>-p<n>`; ISF makes one per transcript. */
export const proteinIdOf = (transcriptId) => `${transcriptId}-p1`;
const labelOf = (group) => group.id ?? spanLabel(group.lines[0]);
const parentsOfGroup = (group) => [...new Set(group.lines.flatMap(parentsOf))];

/**
 * The genes, RNAs and CDSs of one GFF3 with the gene and transcript IDs ISF loads them under, found through Parent.
 * A CDS under several transcripts appears once for each. Only RNA types ISF loads are transcripts, and a gene needs one;
 * the rest are returned in notLoaded.
 */
export function resolveFeatures(graph) {
  const groups = featureGroups(graph);
  const genes = new Set(groups.filter((g) => g.id !== null && GENE_TYPES.has(g.type)).map((g) => g.id));
  const geneParentsOf = (rna) => parentsOfGroup(rna).filter((p) => genes.has(p));
  const loadedRnas = groups.filter((g) => g.id !== null && ISF_RNA_TYPES.has(g.type));
  const transcriptGene = new Map();
  for (const rna of loadedRnas) {
    const parents = geneParentsOf(rna);
    if (parents.length === 1) transcriptGene.set(rna.id, parents[0]);
  }
  const loadedGenes = new Set(transcriptGene.values());
  const skippedTranscripts = new Set(groups.filter((g) => g.id !== null && TRANSCRIPT_TYPES.has(g.type) && !ISF_RNA_TYPES.has(g.type)).map((g) => g.id));
  const features = [];
  const unresolved = [];
  const notLoaded = [];
  for (const group of groups) {
    if (group.id !== null && GENE_TYPES.has(group.type)) {
      if (loadedGenes.has(group.id)) features.push({ kind: 'gene', group, gene: group.id, transcript: null });
      else notLoaded.push({ id: group.id, type: group.type });
    } else if (TRANSCRIPT_TYPES.has(group.type)) {
      if (!ISF_RNA_TYPES.has(group.type)) notLoaded.push({ id: labelOf(group), type: group.type });
      else if (group.id !== null && transcriptGene.has(group.id)) {
        features.push({ kind: 'rna', group, gene: transcriptGene.get(group.id), transcript: group.id, hasCds: false });
      } else if (group.id !== null && geneParentsOf(group).length > 1) unresolved.push(`${group.id} (more than one gene parent)`);
      else unresolved.push(labelOf(group));
    } else if (group.type === 'CDS') {
      const parents = parentsOfGroup(group);
      const owners = parents.filter((p) => transcriptGene.has(p)).map((transcript) => ({ gene: transcriptGene.get(transcript), transcript }));
      for (const owner of owners) features.push({ kind: 'cds', group, ...owner });
      if (!owners.length) {
        if (parents.some((p) => skippedTranscripts.has(p))) notLoaded.push({ id: labelOf(group), type: group.type });
        else unresolved.push(labelOf(group));
      }
    }
  }
  const coding = new Set(features.filter((f) => f.kind === 'cds').map((f) => f.transcript));
  for (const f of features) if (f.kind === 'rna') f.hasCds = coding.has(f.transcript);
  return { features, unresolved, notLoaded, codingTranscripts: [...coding] };
}
