import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { assemblyDirUrl, runFetch } from '../shared/scripts/genome/commands/fetch.js';
import { runSurvey } from '../shared/scripts/genome/commands/survey.js';
import { MAP_PATH, SCRIPT_PATH } from '../shared/scripts/genome/preprocess-gff3.js';

export const genomeFixtures = new URL('./fixtures/genome/', import.meta.url).pathname;
const ecunFetch = join(genomeFixtures, 'ecun/fetch');
export const ECUN_GFF = join(ecunFetch, 'GCA_000091225.2_ASM9122v2_genomic.gff.gz');
export const ECUN_FASTA = join(ecunFetch, 'GCA_000091225.2_ASM9122v2_genomic.fna.gz');
export const ECUN_REPORT = join(ecunFetch, 'GCA_000091225.2_ASM9122v2_assembly_report.txt');
const tempDirs = [];
process.on('exit', () => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});
/** A temp dir removed when the test process exits. */
export const tempDir = (prefix) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
};

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

/** TINY_GFF plus a gene whose mRNA is named for the same locus: ncbiDefault gives both the ID TST_0050. */
export const TINY_COLLIDING_GFF = TINY_GFF.replace(`##sequence-region ${KZ}`, [
  gffLine(CM, 'gene', 1400, 1500, '+', 'ID=gene-TST_0050;Name=TST_0050;gbkey=Gene;gene=TST_0050;gene_biotype=protein_coding'),
  gffLine(CM, 'mRNA', 1400, 1500, '+', 'ID=rna-TST_0050;Parent=gene-TST_0050;gbkey=mRNA'),
  gffLine(CM, 'exon', 1400, 1500, '+', 'ID=exon-TST_0050-1;Parent=rna-TST_0050;gbkey=mRNA'),
  gffLine(CM, 'CDS', 1400, 1500, '+', 'ID=cds-PRT5.1;Parent=rna-TST_0050;gbkey=CDS;protein_id=PRT5.1'),
  `##sequence-region ${KZ}`
].join('\n'));

export const TINY_IDS_DEFAULT = [
  'level\told\tnew',
  'gene\tgene-TST_0010\tTST_0010',
  'gene\tgene-TST_0020\tTST_0020',
  'gene\tgene-TST_0030\tTST_0030',
  'gene\tgene-TST_0040\tTST_0040',
  'protein\tcds-PRT1.1\tPRT1.1',
  'protein\tcds-PRT2.1\tPRT2.1',
  'protein\tcds-PRT4.1\tPRT4.1',
  ''
].join('\n');

const REPORT_HEADER ='# Sequence-Name\tSequence-Role\tAssigned-Molecule\tAssigned-Molecule-Location/Type\tGenBank-Accn\tRelationship\tRefSeq-Accn\tAssembly-Unit\tSequence-Length\tUCSC-style-name';

/** An NCBI assembly report (CRLF) from [name, role, locationType, genbank, refseq?] rows. */
export function reportText(rows) {
  const body = rows.map(([name, role, location, genbank, refseq = 'na']) =>
    [name, role, location === 'Chromosome' ? name : 'na', location, genbank, '=', refseq, 'Primary Assembly', '1000', 'na'].join('\t'));
  return [`# Assembly name:  TINY1`, REPORT_HEADER, ...body].join('\r\n') + '\r\n';
}

export const TINY_REPORT = reportText([
  ['chr1', 'assembled-molecule', 'Chromosome', CM, 'NC_000001.1'],
  ['scaffold2', 'unplaced-scaffold', 'na', KZ, 'NW_000002.1']
]);

/** ISF's --bioperlTreeOutput as nested { type, id, start, end, strand, keys, children }. */
export function parseBioperlTree(text) {
  const roots = [];
  const stack = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const head = line.match(/^( *)< (\S+) >$/);
    if (head) {
      const depth = head[1].length / 2;
      const node = { type: head[2], id: null, keys: [], children: [] };
      stack.length = depth;
      if (depth === 0) roots.push(node); else stack[depth - 1].children.push(node);
      stack[depth] = node;
      continue;
    }
    const node = stack.at(-1);
    const loc = line.match(/^\s*(\d+)-(\d+) strand:(-?\d+)$/);
    if (loc) { Object.assign(node, { start: Number(loc[1]), end: Number(loc[2]), strand: Number(loc[3]) }); continue; }
    if (/ gus source_id: /.test(line)) continue;
    const qualifier = line.match(/^\s*([^:\s]+): ?(.*)$/);
    if (!qualifier) continue;
    if (!node.keys.includes(qualifier[1])) node.keys.push(qualifier[1]);
    if (qualifier[1] === 'ID') node.id = qualifier[2];
  }
  return roots;
}

/** What the port must reproduce: types, IDs, coordinates, and qualifier keys except on exons. */
export const treeShape = (t) => ({
  type: t.type,
  id: t.type === 'exon' ? null : t.id,
  start: t.start,
  end: t.end,
  strand: t.strand,
  keys: t.type === 'exon' ? null : [...t.keys].sort(),
  children: t.children.map(treeShape)
});
export const byId = (a, b) => a.id.localeCompare(b.id);

/** A copy of preprocessGFF3 without its unused `use Bio::SeqIO;`, so it runs on core perl. */
export function withoutBioSeqIO(script, dir) {
  const dest = join(dir, 'preprocessGFF3');
  writeFileSync(dest, readFileSync(script, 'utf-8').replace(/^use Bio::SeqIO;\s*\n/m, ''));
  return dest;
}

export const perlMissing = spawnSync('perl', ['-v']).status !== 0 && 'perl is not on PATH';

export const TINY_ACCESSION = 'GCA_000000001.1';
export const TINY_ASSEMBLY = 'GCA_000000001.1_TINY1';
export const TINY_FASTA = `>${CM} Testus tinyus chromosome 1\n${'ACGT'.repeat(15)}\n${'ACGT'.repeat(15)}\n>${KZ} Testus tinyus scaffold2\n${'TTGA'.repeat(15)}\n`;
export const FIXED_NOW = () => '2026-11-04T00:00:00.000Z';

export const tinyFiles = ({ gff = TINY_GFF, fasta = TINY_FASTA, report = TINY_REPORT } = {}) => ({
  [`${TINY_ASSEMBLY}_genomic.gff.gz`]: gzipSync(gff),
  [`${TINY_ASSEMBLY}_genomic.fna.gz`]: gzipSync(fasta),
  [`${TINY_ASSEMBLY}_assembly_report.txt`]: Buffer.from(report)
});

/** NCBI FTP over HTTPS, served from memory: the directory listing, then the assembly's files. */
export function stubNcbi(accession, assembly, files) {
  const dirUrl = assemblyDirUrl(accession);
  const fileBase = `${dirUrl}${assembly}/`;
  const requests = [];
  const fetchBytes = async (url) => {
    requests.push(url);
    if (url === dirUrl) return Buffer.from(`<html><body>\n<a href="../">../</a>\n<a href="${assembly}/">${assembly}/</a>\n</body></html>\n`);
    const name = url.startsWith(fileBase) ? url.slice(fileBase.length) : null;
    return name && files[name] ? Buffer.from(files[name]) : null;
  };
  return { fetchBytes, requests };
}

/** Stands in for preprocessGFF3: copies input to output without comment lines. Core perl only. */
export const FAKE_PREPROCESS = String.raw`use strict;
use Getopt::Long;
my ($in, $out);
GetOptions('input_gff=s' => \$in, 'output_gff=s' => \$out);
open(my $i, '<', $in) or die "no $in";
open(my $o, '>', $out) or die "no $out";
while (<$i>) { print $o $_ unless /^#/; }
`;

/** A git checkout laid out like ApiCommonData with the mini ISF map and a stand-in preprocessGFF3. */
export function fakeApiCommonData({ script = FAKE_PREPROCESS } = {}) {
  const dir = tempDir('apicommondata-');
  mkdirSync(join(dir, 'Load/lib/xml/isf'), { recursive: true });
  mkdirSync(join(dir, 'Load/bin'), { recursive: true });
  cpSync(join(genomeFixtures, 'isf-map-mini.xml'), join(dir, MAP_PATH));
  writeFileSync(join(dir, SCRIPT_PATH), script);
  execFileSync('git', ['init', '-q', dir]);
  execFileSync('git', ['-C', dir, 'add', '.']);
  execFileSync('git', ['-C', dir, '-c', 'user.email=t@apidb.org', '-c', 'user.name=T', 'commit', '-q', '-m', 'fake ApiCommonData']);
  return dir;
}

export async function fetchedWorkDir(options) {
  const workDir = tempDir('genome-work-');
  await runFetch({ workDir, accession: TINY_ACCESSION, fetchBytes: stubNcbi(TINY_ACCESSION, TINY_ASSEMBLY, tinyFiles(options)).fetchBytes, now: FIXED_NOW });
  return workDir;
}

export const TINY_RECIPE = {
  idPolicy: 'ncbiDefault',
  transforms: [
    { name: 'collapseSplitGenes' }, { name: 'addMrnaToGeneCds' }, { name: 'parentOrphanRnas' }, { name: 'addExonPerCds' },
    { name: 'stripAttributes', args: { type: 'gene', keys: ['is_ordered'] } }
  ]
};

export const TINY_NORMALIZED = [
  '##gff-version 3',
  `##sequence-region ${CM} 1 2000`,
  gffLine(CM, 'region', 1, 2000, '+', `ID=${CM}:1..2000;gbkey=Src;mol_type=genomic DNA`),
  gffLine(CM, 'gene', 100, 400, '+', 'ID=TST_0010;Name=TST_0010;gbkey=Gene;gene=TST_0010;gene_biotype=protein_coding'),
  gffLine(CM, 'mRNA', 100, 400, '+', 'ID=TST_0010_mRNA;Parent=TST_0010'),
  gffLine(CM, 'exon', 100, 200, '+', 'ID=TST_0010_mRNA_exon1;Parent=TST_0010_mRNA'),
  gffLine(CM, 'exon', 300, 400, '+', 'ID=TST_0010_mRNA_exon2;Parent=TST_0010_mRNA'),
  gffLine(CM, 'CDS', 100, 200, '+', 'ID=PRT1.1;Parent=TST_0010_mRNA;Dbxref=NCBI_GP:PRT1.1,UniProtKB/TrEMBL:Q00001;gbkey=CDS;product=hypothetical protein;protein_id=PRT1.1'),
  gffLine(CM, 'CDS', 300, 400, '+', 'ID=PRT1.1;Parent=TST_0010_mRNA;Dbxref=NCBI_GP:PRT1.1,UniProtKB/TrEMBL:Q00001;gbkey=CDS;product=hypothetical protein;protein_id=PRT1.1'),
  gffLine(CM, 'gene', 500, 900, '-', 'ID=TST_0020;Name=TST_0020;gbkey=Gene;gene=TST_0020;gene_biotype=protein_coding'),
  gffLine(CM, 'mRNA', 500, 900, '-', 'ID=TST_0020_mRNA;Parent=TST_0020'),
  gffLine(CM, 'exon', 800, 900, '-', 'ID=TST_0020_mRNA_exon1;Parent=TST_0020_mRNA'),
  gffLine(CM, 'exon', 500, 700, '-', 'ID=TST_0020_mRNA_exon2;Parent=TST_0020_mRNA'),
  gffLine(CM, 'CDS', 800, 900, '-', 'ID=PRT2.1;Parent=TST_0020_mRNA;gbkey=CDS;protein_id=PRT2.1'),
  gffLine(CM, 'CDS', 500, 700, '-', 'ID=PRT2.1;Parent=TST_0020_mRNA;gbkey=CDS;protein_id=PRT2.1'),
  gffLine(CM, 'gene', 1000, 1072, '+', 'ID=TST_0030;Name=TST_0030;gbkey=Gene;gene=TST_0030;gene_biotype=tRNA'),
  gffLine(CM, 'tRNA', 1000, 1072, '+', 'ID=rna-TST_0030;Parent=TST_0030;Note=tRNA-Leu%2C anticodon TAG;gbkey=tRNA;product=tRNA-Leu'),
  gffLine(CM, 'exon', 1000, 1072, '+', 'ID=exon-TST_0030-1;Parent=rna-TST_0030;gbkey=tRNA;product=tRNA-Leu'),
  gffLine(CM, 'gene', 1200, 1300, '+', `ID=gene_${CM}_1200_1300`),
  gffLine(CM, 'snRNA', 1200, 1300, '+', `ID=rna_${CM}_1200_1300_snRNA;Parent=gene_${CM}_1200_1300;gbkey=ncRNA;product=U4 snRNA`),
  gffLine(CM, 'exon', 1200, 1300, '+', `ID=exon-${CM}:1200..1300-1;Parent=rna_${CM}_1200_1300_snRNA;gbkey=ncRNA;product=U4 snRNA`),
  `##sequence-region ${KZ} 1 600`,
  gffLine(KZ, 'gene', 10, 300, '+', 'ID=TST_0040;Name=TST_0040;gbkey=Gene;gene=TST_0040;gene_biotype=protein_coding'),
  gffLine(KZ, 'mRNA', 10, 300, '+', 'ID=TST_0040_mRNA;Parent=TST_0040'),
  gffLine(KZ, 'exon', 10, 300, '+', 'ID=TST_0040_mRNA_exon1;Parent=TST_0040_mRNA'),
  gffLine(KZ, 'CDS', 10, 300, '+', 'ID=PRT4.1;Parent=TST_0040_mRNA;gbkey=CDS;protein_id=PRT4.1'),
  '###'
].join('\n') + '\n';

/** A fetched and surveyed tiny work area with its fake ApiCommonData. */
export async function surveyedWorkDir(options) {
  const workDir = await fetchedWorkDir(options);
  const apiCommonData = fakeApiCommonData();
  await runSurvey({ workDir, apiCommonData, now: FIXED_NOW });
  return { workDir, apiCommonData };
}

export const writeRecipe = (workDir, recipe = TINY_RECIPE) => writeFileSync(join(workDir, 'recipe.json'), JSON.stringify(recipe));

/** Sorts the Dbxref and previous_systematic_id segments of each preprocessGFF3 line, which Perl emits in hash order. */
export function normalizeDbxrefs(gffText) {
  return gffText.split('\n').map((line) => {
    const cols = line.split('\t');
    if (cols.length !== 9) return line;
    const segs = cols[8].split(';');
    const at = segs.flatMap((s, i) => (/^(Dbxref|previous_systematic_id)\s/.test(s) ? [i] : []));
    const sorted = at.map((i) => segs[i].replace(/^(\S+)\s+/, '$1 ')).sort();
    at.forEach((i, n) => { segs[i] = sorted[n]; });
    cols[8] = segs.join(';');
    return cols.join('\t');
  }).join('\n');
}
