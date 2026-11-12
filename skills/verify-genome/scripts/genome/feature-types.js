export const GENE_TYPES = new Set(['gene', 'pseudogene', 'protein_coding_gene', 'ncRNA_gene']);

/** The child types ApiCommonData::Load::genemRNAExonCDS2BioperlTree loads as transcripts. */
export const ISF_RNA_TYPES = new Set([
  'mRNA', 'transcript', 'misc_RNA', 'guide_RNA', 'siRNA', 'rRNA', 'snRNA', 'snoRNA', 'tRNA', 'ncrna', 'ncRNA',
  'lncRNA', 'lincRNA', 'lnc_RNA', 'miRNA', 'scaRNA', 'pseudogenic_transcript', 'scRNA', 'srpRNA', 'SRP.RNA',
  'RNase_MRP_RNA', 'SRP_RNA', 'pre_miRNA', 'antisense_RNA', 'telomerase_RNA', 'V_gene_segment', 'C_gene_segment',
  'primary_transcript', 'piRNA', 'circular_ncRNA', 'miRNA_primary_transcript', 'nc_primary_transcript', 'precursor_RNA'
]);

export const TRANSCRIPT_TYPES = new Set([...ISF_RNA_TYPES, 'ribozyme', 'RNase_P_RNA', 'tmRNA', 'Y_RNA', 'vault_RNA']);

/** GusSkeletonMaker names translations `<transcript>-p<n>`; ISF makes one per transcript. */
export const proteinIdOf = (transcriptId) => `${transcriptId}-p1`;

export function levelOf(type) {
  if (GENE_TYPES.has(type)) return 'gene';
  if (TRANSCRIPT_TYPES.has(type)) return 'transcript';
  return type === 'CDS' ? 'protein' : null;
}
