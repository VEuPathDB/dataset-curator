import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sha256 } from '../shared/scripts/genome/workdir.js';
import { CM, gffLine, gffText } from './genome-helpers.js';
import { PRIMARY, trialBuild, trialWorkDir } from './genome-trial-helpers.js';

export const REPORT_NAME = 'GCA_000000001.1_TEST1_assembly_report.txt';
export const REPORT = '# Assembly name:  TEST1\n# Taxid:          284813\n#\n# Sequence-Name\tSequence-Role\n';

/** A coding gene and a tRNA gene as D's build writes them, carrying every attribute functional reads. */
export const FUNCTIONAL_GFF3 = gffText(
  gffLine(CM, 'gene', 100, 900, '+', 'ID=TST_0010;Name=tstA;gbkey=Gene;gene=tstA;gene_synonym=tstA1,tstA2;locus_tag=TST_0010;Dbxref=GeneID:1001'),
  gffLine(CM, 'mRNA', 100, 900, '+', 'ID=TST_0010_mRNA;Parent=TST_0010;Dbxref=GeneID:1001'),
  gffLine(CM, 'exon', 100, 900, '+', 'ID=TST_0010_mRNA_exon1;Parent=TST_0010_mRNA'),
  gffLine(CM, 'CDS', 100, 900, '+', 'ID=PRT1.1;Parent=TST_0010_mRNA;Dbxref=GeneID:1001,InterPro:IPR000719,UniProtKB/Swiss-Prot:Q00001;'
    + 'Note=kinase domain%2C N-terminal;product=kinase%2C putative;protein_id=PRT1.1;EC_number=2.7.11.1,1.2.3.-;'
    + 'go_function=ATP binding|0005524|12345678|IEA;go_process=protein phosphorylation|0006468||IEA'),
  gffLine(CM, 'gene', 1000, 1072, '+', 'ID=TST_0030;gbkey=Gene;gene=TST_0030;locus_tag=TST_0030'),
  gffLine(CM, 'tRNA', 1000, 1072, '+', 'ID=rna-TST_0030;Parent=TST_0030;Note=tRNA-Leu (TAG);gbkey=tRNA;product=tRNA-Leu'),
  gffLine(CM, 'exon', 1000, 1072, '+', 'ID=exon-TST_0030-1;Parent=rna-TST_0030')
);

/** A finalized work area for functional: the trial helpers' build with this GFF3, and fetch/ holding the assembly report. */
export function functionalWorkDir({ gff3 = FUNCTIONAL_GFF3, accession = 'GCA_000000001.1', report = REPORT } = {}) {
  const build = { ...trialBuild(), accession };
  build.partitions[0].buildFiles.gff3 = sha256(gff3);
  const { workDir } = trialWorkDir(build);
  writeFileSync(join(workDir, `build/${PRIMARY}/genome.gff3`), gff3);
  mkdirSync(join(workDir, 'fetch'), { recursive: true });
  writeFileSync(join(workDir, 'fetch', REPORT_NAME), report);
  const fetched = {
    accession, assembly: 'GCA_000000001.1_TEST1', fetchedAt: '2026-11-04T00:00:00.000Z',
    files: { report: { name: REPORT_NAME, url: 'https://ftp.ncbi.nlm.nih.gov/test/report', sha256: sha256(report) } }
  };
  writeFileSync(join(workDir, 'fetch', 'fetch.json'), `${JSON.stringify(fetched, null, 2)}\n`);
  return workDir;
}
