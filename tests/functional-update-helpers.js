import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { runFetch, inferColumns, writeColumns, runConvert } from '../shared/scripts/dataset-types/functional-update/commands.js';
import { workFiles } from '../shared/scripts/dataset-types/functional-update/record.js';

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

export const INPUT = 'gene_id\tproduct\nTFAK_0010\tkinase\nTFAK_0020\tncRNA\n';
export const sha = (s) => createHash('sha256').update(s).digest('hex');
/** The fixture proposal's entry. */
export const ENTRY = { datasetClass: 'productNames', name: 'VEuPathDB', version: '2026-11-03' };

/** A fetched work area: the staged file pulled by a local "remote", the GFF from a stub fetch. */
export async function fetched() {
  const root = mkdtempSync(join(tmpdir(), 'fu-work-'));
  const staging = join(root, 'staging', 'p1');
  mkdirSync(staging, { recursive: true });
  writeFileSync(join(staging, 'products.tsv'), INPUT);
  const workArea = join(root, 'preprocess');
  const remote = { pull: (path, dest, { files }) => { mkdirSync(dest, { recursive: true }); for (const f of files) writeFileSync(join(dest, f), readFileSync(join(path, f))); } };
  const fetchImpl = async (url) => new Response(url.endsWith('/') ? '<a href="FungiDB-68_TfakeusST1.gff">' : RELEASED_GFF);
  const record = await runFetch({
    workArea, proposalId: 'p1', staged: { path: 'products.tsv', sha256: sha(INPUT) }, stagingPath: staging, remote,
    organism: { abbrev: 'tfakST1', project: 'FungiDB', nameForFiles: 'TfakeusST1', ncbiTaxonId: '999001' }, pendingGenomes: [], fetchImpl
  });
  return { workArea, record };
}

/** A fetched, column-mapped and converted work area for ENTRY; pendingGenomes rewrites gff.json first. */
export async function convertedWorkArea({ pendingGenomes } = {}) {
  const { workArea } = await fetched();
  if (pendingGenomes) {
    const path = workFiles(workArea).gffJson;
    writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf-8')), pendingGenomes }, null, 2) + '\n');
  }
  writeColumns(workArea, 'productNames', inferColumns(workArea, 'productNames').columns);
  runConvert({ workArea, entry: ENTRY });
  return workArea;
}
