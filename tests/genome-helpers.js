import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const genomeFixtures = new URL('./fixtures/genome/', import.meta.url).pathname;
const ecunFetch = join(genomeFixtures, 'ecun/fetch');
export const ECUN_GFF = join(ecunFetch, 'GCA_000091225.2_ASM9122v2_genomic.gff.gz');
export const ECUN_FASTA = join(ecunFetch, 'GCA_000091225.2_ASM9122v2_genomic.fna.gz');
export const ECUN_REPORT = join(ecunFetch, 'GCA_000091225.2_ASM9122v2_assembly_report.txt');
export const tempDir = (prefix) => mkdtempSync(join(tmpdir(), prefix));

/** One GFF3 feature line; CDS lines get phase 0. */
export const gffLine = (seqId, type, start, end, strand, attrs) =>
  [seqId, 'EMBL', type, start, end, '.', strand, type === 'CDS' ? '0' : '.', attrs].join('\t');
export const gffText = (...lines) => `##gff-version 3\n${lines.join('\n')}\n`;

export const CM = 'CM000001.1';
export const KZ = 'KZ000002.1';

/** A two-sequence NCBI GenBank-style GFF with every shape the transforms fix. */
export const TINY_GFF = [
  '##gff-version 3',
  `##sequence-region ${CM} 1 2000`,
  gffLine(CM, 'region', 1, 2000, '+', `ID=${CM}:1..2000;gbkey=Src;mol_type=genomic DNA`),
  gffLine(CM, 'gene', 100, 400, '+', 'ID=gene-TST_0010;Name=TST_0010;gbkey=Gene;gene=TST_0010;gene_biotype=protein_coding'),
  gffLine(CM, 'CDS', 100, 200, '+', 'ID=cds-PRT1.1;Parent=gene-TST_0010;Dbxref=NCBI_GP:PRT1.1,UniProtKB/TrEMBL:Q00001;gbkey=CDS;product=hypothetical protein;protein_id=PRT1.1'),
  gffLine(CM, 'CDS', 300, 400, '+', 'ID=cds-PRT1.1;Parent=gene-TST_0010;Dbxref=NCBI_GP:PRT1.1,UniProtKB/TrEMBL:Q00001;gbkey=CDS;product=hypothetical protein;protein_id=PRT1.1'),
  gffLine(CM, 'gene', 800, 900, '-', 'ID=gene-TST_0020;Name=TST_0020;gbkey=Gene;gene=TST_0020;gene_biotype=protein_coding;is_ordered=true'),
  gffLine(CM, 'gene', 500, 700, '-', 'ID=gene-TST_0020;Name=TST_0020;gbkey=Gene;gene=TST_0020;gene_biotype=protein_coding;is_ordered=true'),
  gffLine(CM, 'CDS', 800, 900, '-', 'ID=cds-PRT2.1;Parent=gene-TST_0020;gbkey=CDS;protein_id=PRT2.1'),
  gffLine(CM, 'CDS', 500, 700, '-', 'ID=cds-PRT2.1;Parent=gene-TST_0020;gbkey=CDS;protein_id=PRT2.1'),
  gffLine(CM, 'gene', 1000, 1072, '+', 'ID=gene-TST_0030;Name=TST_0030;gbkey=Gene;gene=TST_0030;gene_biotype=tRNA'),
  gffLine(CM, 'tRNA', 1000, 1072, '+', 'ID=rna-TST_0030;Parent=gene-TST_0030;Note=tRNA-Leu%2C anticodon TAG;gbkey=tRNA;product=tRNA-Leu'),
  gffLine(CM, 'exon', 1000, 1072, '+', 'ID=exon-TST_0030-1;Parent=rna-TST_0030;gbkey=tRNA;product=tRNA-Leu'),
  gffLine(CM, 'snRNA', 1200, 1300, '+', `ID=rna-${CM}:1200..1300;gbkey=ncRNA;product=U4 snRNA`),
  gffLine(CM, 'exon', 1200, 1300, '+', `ID=exon-${CM}:1200..1300-1;Parent=rna-${CM}:1200..1300;gbkey=ncRNA;product=U4 snRNA`),
  `##sequence-region ${KZ} 1 600`,
  gffLine(KZ, 'gene', 10, 300, '+', 'ID=gene-TST_0040;Name=TST_0040;gbkey=Gene;gene=TST_0040;gene_biotype=protein_coding'),
  gffLine(KZ, 'CDS', 10, 300, '+', 'ID=cds-PRT4.1;Parent=gene-TST_0040;gbkey=CDS;protein_id=PRT4.1'),
  '###'
].join('\n') + '\n';

/** TINY_GFF plus ECU11_0375's shape: a tRNA gene "-2" whose RNA strips to the other gene's ID. */
export const TINY_COLLIDING_GFF = TINY_GFF.replace(`##sequence-region ${KZ}`, [
  gffLine(CM, 'gene', 1400, 1500, '+', 'ID=gene-TST_0050;Name=TST_0050;gbkey=Gene;gene=TST_0050;gene_biotype=protein_coding'),
  gffLine(CM, 'CDS', 1400, 1500, '+', 'ID=cds-PRT5.1;Parent=gene-TST_0050;gbkey=CDS;protein_id=PRT5.1'),
  gffLine(CM, 'gene', 1600, 1672, '-', 'ID=gene-TST_0050-2;Name=TST_0050;gbkey=Gene;gene=TST_0050;gene_biotype=tRNA'),
  gffLine(CM, 'tRNA', 1600, 1672, '-', 'ID=rna-TST_0050;Parent=gene-TST_0050-2;gbkey=tRNA;product=tRNA-Ser'),
  gffLine(CM, 'exon', 1600, 1672, '-', 'ID=exon-TST_0050-1;Parent=rna-TST_0050;gbkey=tRNA;product=tRNA-Ser'),
  `##sequence-region ${KZ}`
].join('\n'));
