const line = (type, attrs, start = 1, end = 90) => ['chr1', 'VEuPathDB', type, start, end, '.', '+', '.', attrs].join('\t');

/** A released-site GFF: a coding gene with two transcripts (one CDS has protein_source_id, one not) and an ncRNA gene. */
export const RELEASED_GFF = [
  '##gff-version 3',
  line('protein_coding_gene', 'ID=TFAK_0010;description=kinase'),
  line('mRNA', 'ID=TFAK_0010.1;Parent=TFAK_0010'),
  line('mRNA', 'ID=TFAK_0010.2;Parent=TFAK_0010'),
  line('exon', 'ID=exon_TFAK_0010.1-E1;Parent=TFAK_0010.1'),
  line('CDS', 'ID=TFAK_0010.1-p1-CDS1;Parent=TFAK_0010.1;protein_source_id=TFAK_0010.1-p1'),
  line('CDS', 'ID=TFAK_0010.2-CDS1;Parent=TFAK_0010.2'),
  line('ncRNA_gene', 'ID=TFAK_0020'),
  line('ncRNA', 'ID=TFAK_0020.1;Parent=TFAK_0020'),
  ''
].join('\n');
