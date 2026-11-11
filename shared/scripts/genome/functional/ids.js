import { GENE_TYPES, ISF_RNA_TYPES, TRANSCRIPT_TYPES } from '../feature-types.js';
import { featureGroups, parentsOf, spanLabel } from '../gff.js';
import { isfTrees } from '../isf-map.js';

const labelOf = (group) => group.id ?? spanLabel(group.lines[0]);
const parentsOfGroup = (group) => [...new Set(group.lines.flatMap(parentsOf))];
const isGeneTree = (tree) => tree.type === 'pseudogene' || tree.type.endsWith('_gene');

/**
 * What ISF loads from isfTrees: gene trees and their transcripts, with the IDs ISF gives them. Attributes still come
 * from the GFF groups: a transcript ISF synthesizes (a childless pseudogene, a standalone RNA) uses its gene's group.
 */
function loadedTrees(groups, graph) {
  const byId = new Map();
  for (const g of groups) if (g.id !== null && !byId.has(g.id)) byId.set(g.id, g);
  const genes = [];
  const transcriptGenes = new Map();
  for (const tree of isfTrees(graph).trees.filter((t) => t.id !== null && isGeneTree(t))) {
    const group = byId.get(tree.id) ?? byId.get(`${tree.id}:pseudogene`);
    if (!group) continue;
    const transcripts = tree.children.filter((c) => c.id !== null).map((c) => ({ id: c.id, group: byId.get(c.id) ?? group }));
    genes.push({ id: tree.id, group, transcripts });
    for (const t of transcripts) transcriptGenes.set(t.id, [...(transcriptGenes.get(t.id) ?? []), tree.id]);
  }
  return { genes, transcriptGenes };
}

/**
 * The genes, RNAs and CDSs of one GFF3 with the gene and transcript IDs ISF loads them under. A CDS under several
 * transcripts appears once for each. Features ISF does not load are returned in notLoaded.
 */
export function resolveFeatures(graph) {
  const groups = featureGroups(graph);
  const { genes, transcriptGenes } = loadedTrees(groups, graph);
  const ambiguous = new Set([...transcriptGenes].filter(([, owners]) => owners.length > 1).map(([id]) => id));
  const geneOfGroup = new Map(genes.map((g) => [g.group, g]));
  const transcriptsOfGroup = new Map();
  for (const gene of genes) {
    for (const t of gene.transcripts.filter((x) => !ambiguous.has(x.id))) {
      transcriptsOfGroup.set(t.group, [...(transcriptsOfGroup.get(t.group) ?? []), { transcript: t.id, gene: gene.id }]);
    }
  }
  const transcriptGene = new Map([...transcriptGenes].filter(([id]) => !ambiguous.has(id)).map(([id, owners]) => [id, owners[0]]));
  const skippedRnas = new Set(groups.filter((g) => g.id !== null && TRANSCRIPT_TYPES.has(g.type) && !ISF_RNA_TYPES.has(g.type)).map((g) => g.id));
  const features = [];
  const unresolved = [];
  const notLoaded = [];
  for (const group of groups) {
    const loadedGene = geneOfGroup.get(group);
    const loadedRnas = transcriptsOfGroup.get(group);
    if (loadedGene) features.push({ kind: 'gene', group, gene: loadedGene.id, transcript: null });
    for (const { transcript, gene } of loadedRnas ?? []) features.push({ kind: 'rna', group, gene, transcript, hasCds: false });
    if (loadedGene || loadedRnas) continue;
    if (group.id !== null && ambiguous.has(group.id)) unresolved.push(`${group.id} (more than one gene parent)`);
    else if (group.id !== null && GENE_TYPES.has(group.type)) notLoaded.push({ id: group.id, type: group.type });
    else if (TRANSCRIPT_TYPES.has(group.type)) {
      if (ISF_RNA_TYPES.has(group.type)) unresolved.push(labelOf(group));
      else notLoaded.push({ id: labelOf(group), type: group.type });
    } else if (group.type === 'CDS') {
      const parents = parentsOfGroup(group);
      const owners = parents.filter((p) => transcriptGene.has(p));
      for (const transcript of owners) features.push({ kind: 'cds', group, gene: transcriptGene.get(transcript), transcript });
      if (owners.length) continue;
      if (parents.some((p) => skippedRnas.has(p))) notLoaded.push({ id: labelOf(group), type: group.type });
      else unresolved.push(labelOf(group));
    }
  }
  const coding = new Set(features.filter((f) => f.kind === 'cds').map((f) => f.transcript));
  for (const f of features) if (f.kind === 'rna') f.hasCds = coding.has(f.transcript);
  return { features, unresolved, notLoaded, codingTranscripts: [...coding] };
}
