/** A genome work area as D, C and E leave it, and GCA_000001.1 as Phase 1 and the amendment leave it, built in temp dirs. */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { fixtures } from './helpers.js';
import * as genome from '../shared/scripts/dataset-types/genome-assembly.js';

export const ACCESSION = 'GCA_000001.1';
const sha = (text) => createHash('sha256').update(text).digest('hex');
const GENERATOR = { name: 'dataset-curator genome-pipeline', version: '4.0.0' };
const NCBI = 'https://ftp.ncbi.nlm.nih.gov/genomes/all/GCA/000/000/001/GCA_000001.1_Tfak/GCA_000001.1_Tfak';
export const FETCH_URLS = { gff: `${NCBI}_genomic.gff.gz`, fasta: `${NCBI}_genomic.fna.gz`, report: `${NCBI}_assembly_report.txt` };

export const editJson = (path, edit) => writeFileSync(path, JSON.stringify(edit(JSON.parse(readFileSync(path, 'utf-8'))), null, 2) + '\n');

const gff = (rows) => `##gff-version 3\n${rows.map((r) => r.join('\t')).join('\n')}\n`;

/** A chromosome primary with two genes, a contig secondary with one, and a mitochondrion ISF loads nothing from. */
export const PARTITIONS = [
  {
    role: 'primary', soTerm: 'chromosome', organelle: null, sequenceCount: 1, dir: 'final/primary_chromosome', featureCount: 2, gffLines: 6,
    final: { gff: 'genome.gff', fasta: 'genome.fasta', chromosomeMap: 'chromosomeMap.txt' }, featureTypes: { exon: 2, gene: 2, mRNA: 1, tRNA: 1 }, maxIntron: 599,
    gff3: gff([
      ['CM1', 'EMBL', 'gene', '100', '900', '.', '+', '.', 'ID=TST_0010'],
      ['CM1', 'EMBL', 'mRNA', '100', '900', '.', '+', '.', 'ID=TST_0010_mRNA;Parent=TST_0010'],
      ['CM1', 'EMBL', 'exon', '100', '200', '.', '+', '.', 'ID=e1;Parent=TST_0010_mRNA'],
      ['CM1', 'EMBL', 'exon', '800', '900', '.', '+', '.', 'ID=e2;Parent=TST_0010_mRNA'],
      ['CM1', 'EMBL', 'gene', '1000', '1072', '.', '+', '.', 'ID=TST_0030'],
      ['CM1', 'EMBL', 'tRNA', '1000', '1072', '.', '+', '.', 'ID=TST_0030_tRNA;Parent=TST_0030']
    ]),
    fasta: '>CM1\nACGT\n', chromosomeMap: 'CM1\t1\t1\n', transcripts: [['TST_0010', 'TST_0010_mRNA'], ['TST_0030', 'TST_0030_tRNA']]
  },
  {
    role: 'secondary', soTerm: 'contig', organelle: null, sequenceCount: 1, dir: 'final/secondary_contig', featureCount: 1, gffLines: 2,
    final: { gff: 'genome.gff', fasta: 'genome.fasta', chromosomeMap: null }, featureTypes: { gene: 1, mRNA: 1 }, maxIntron: 0,
    gff3: gff([
      ['JA1', 'EMBL', 'gene', '10', '300', '.', '+', '.', 'ID=TST_0040'],
      ['JA1', 'EMBL', 'mRNA', '10', '300', '.', '+', '.', 'ID=TST_0040_mRNA;Parent=TST_0040']
    ]),
    fasta: '>JA1\nTTGA\n', transcripts: [['TST_0040', 'TST_0040_mRNA']]
  },
  {
    role: 'organelle', soTerm: 'mitochondrial_chromosome', organelle: 'mitochondrion', sequenceCount: 1, dir: 'final/organelle_mitochondrion', featureCount: 0, gffLines: 0,
    final: { gff: null, fasta: 'genome.fasta', chromosomeMap: null }, featureTypes: {}, maxIntron: 0, fasta: '>MT1\nAAAA\n', transcripts: []
  }
];

export const FUNCTIONAL = [
  { datasetClass: 'productNames', name: 'GenBank', file: 'products.txt', level: 'transcript', text: 'TST_0010_mRNA\thypothetical protein\t1\nTST_0040_mRNA\tkinase\t1\n', props: {} },
  { datasetClass: 'geneName', name: 'GenBank', file: 'geneName.txt', level: 'gene', text: 'TST_0010\tabcA\n', props: {} },
  {
    datasetClass: 'dbxref_simple', name: 'uniprot_from_annotation', file: 'mapping.txt', level: 'transcript', text: 'TST_0010_mRNA\tQ00001\n',
    props: { prefixes: ['UniProtKB/TrEMBL'], url: 'http://www.uniprot.org/uniprot/EXTERNAL_ID_HERE', target: 'NAFeature', viewName: 'Transcript' }
  },
  {
    datasetClass: 'dbxref_simple', name: 'ensemblgenomes_gn_from_annotation', file: 'mapping.txt', level: 'gene', text: 'TST_0010\tECU_0010\n',
    props: { prefixes: ['EnsemblGenomes-Gn'], url: null, target: 'NAFeature', viewName: 'GeneFeature' }
  }
];

const partitionRecord = ({ role, soTerm, organelle, sequenceCount, dir, featureCount, gffLines, final, featureTypes, maxIntron }) =>
  ({ role, soTerm, organelle, sequenceCount, dir, featureCount, gffLines, final, featureTypes, maxIntron });

/**
 * A finalized, trialled and functionally extracted work area for GCA_000001.1, at `at` or in a new temp dir.
 * trial overrides fields of trial.json; partitions and functionalDatasets replace the defaults above.
 */
export function genomeWorkArea({ at, trial = {}, partitions = PARTITIONS, functionalDatasets = FUNCTIONAL, buildFindings = [], buildWarnings = [], functionalFindings = [] } = {}) {
  const workArea = at ?? join(mkdtempSync(join(tmpdir(), 'work-area-')), 'preprocess');
  const write = (rel, text) => {
    mkdirSync(dirname(join(workArea, rel)), { recursive: true });
    writeFileSync(join(workArea, rel), text);
    return sha(text);
  };
  write('fetch/fetch.json', JSON.stringify({
    accession: ACCESSION, assembly: 'GCA_000001.1_Tfak', fetchedAt: '2026-11-05T00:00:00.000Z',
    files: Object.fromEntries(Object.entries(FETCH_URLS).map(([role, url]) => [role, { name: url.split('/').at(-1), url, sha256: sha(role) }]))
  }, null, 2));
  const loaded = {};
  const outputs = {};
  const records = partitions.map((p) => {
    const name = p.dir.split('/').at(-1);
    const finalFile = (key, text) => (p.final[key] ? write(`${p.dir}/${p.final[key]}`, text) : null);
    loaded[name] = { gff: finalFile('gff', p.gff3 ?? ''), fasta: finalFile('fasta', p.fasta), chromosomeMap: finalFile('chromosomeMap', p.chromosomeMap ?? '') };
    const gff3 = p.featureCount > 0 ? write(`build/${name}/genome.gff3`, p.gff3) : null;
    if (p.featureCount > 0) {
      outputs[name] = { transcriptInfoAndIds: write(`${p.dir}/transcriptInfoAndIds`, p.transcripts.map(([gene, transcript]) => `${gene}\tACGT\t1\t1-4\t${transcript}\n`).join('')) };
    }
    return { ...partitionRecord(p), buildFiles: { gff3, fasta: sha(p.fasta), chromosomeMap: p.final.chromosomeMap ? sha(p.chromosomeMap) : null } };
  });
  const genomeBuildSha = write('genome-build.json', JSON.stringify({
    schemaVersion: 1, generator: GENERATOR, source: 'ncbi', accession: ACCESSION, findings: buildFindings, warnings: buildWarnings, partitions: records,
    apiCommonData: { commit: 'c0ffee', dirty: false, isfMap: { path: 'Load/lib/xml/isf/genemRNAExonCDS2Gus.xml', sha256: 'm'.repeat(64) } }
  }, null, 2));
  write('trial/trial.json', JSON.stringify({
    schemaVersion: 2, generator: GENERATOR, result: 'passed', genomeBuild: { sha256: genomeBuildSha }, loaded, outputs,
    image: { name: 'gus_isf:local', digest: 'sha256:d', apiCommonDataCommit: 'c0ffee', modelTag: 'gus_isf-model:t', schemaFingerprint: 'f' },
    database: 'UniDB_test', release: '20261105T000000', taxonId: '999001', trialDatabases: {}, startedAt: '2026-11-05T00:00:00.000Z',
    steps: [], findings: [], profile: {}, kept: false, undone: true, ...trial
  }, null, 2));
  const datasets = functionalDatasets.map((d) => {
    const file = `final/function/${d.datasetClass}/${d.name}/${d.file}`;
    const rows = d.text.split('\n').filter(Boolean);
    return {
      datasetClass: d.datasetClass, name: d.name, file, rows: rows.length, sha256: write(file, d.text),
      ids: { level: d.level, count: new Set(rows.map((r) => r.split('\t')[0])).size }, props: d.props
    };
  });
  write('functional.json', JSON.stringify({
    schemaVersion: 1, generator: GENERATOR, genomeBuild: { sha256: genomeBuildSha }, source: 'GenBank', taxonId: '999001', gafDate: '20261105',
    datasets, findings: functionalFindings
  }, null, 2));
  return workArea;
}

/** The organism record Phase 1 writes for GCA_000001.1 into a FungiDB whose tfakST1 is the species' reference and the family's representative. */
export const PHASE1_RECORD = {
  schemaVersion: 1, checkedAgainst: 'origin/rebuild02', organismFullName: 'Testus fakeus ST-1', organismNameForFiles: 'TfakeusST-1',
  strainAbbrev: 'ST-1', speciesNcbiTaxonId: '999000', hasTemporaryNcbiTaxonId: 'false', genomeSource: 'GenBank', genomeVersion: '2024-03-05',
  isAnnotatedGenome: 'true', taxonFilterForNRProteinsAlignedToGenome: 'Testus', isReferenceStrain: 'false',
  referenceStrainOrganismAbbrev: 'tfakST1', familyRepOrganismAbbrev: 'tfakST1'
};

/**
 * GCA_000001.1 as Phase 1 leaves it, in a new temp dir: no entries and a version 1 organism record. record overrides
 * record fields; report overrides fields of the assembly report, which gains a total sequence length of 12 Mb.
 */
export function genomeProposal({ record = {}, report = {} } = {}) {
  const dir = join(mkdtempSync(join(tmpdir(), 'genome-proposal-')), ACCESSION);
  cpSync(join(fixtures, 'proposals', ACCESSION), dir, { recursive: true });
  editJson(join(dir, 'inputs', `${ACCESSION}_dataset_report.json`), (r) => ({
    reports: [{ ...r.reports[0], assembly_stats: { ...r.reports[0].assembly_stats, total_sequence_length: '12000000' }, ...report }]
  }));
  writeFileSync(join(dir, 'curated', 'organism.json'), JSON.stringify({ ...PHASE1_RECORD, ...record }, null, 2) + '\n');
  writeFileSync(join(dir, 'curated', 'datasets.json'), JSON.stringify({ schemaVersion: 2, datasets: [] }, null, 2) + '\n');
  return { dir, manifest: JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf-8')) };
}

/** genomeProposal with preprocessedAmendment's output from workArea written into it, as amend-proposal.js writes it. */
export function amendedProposal(workArea, { given = { orthomclAbbrev: 'tfak' }, ...options } = {}) {
  const { dir, manifest } = genomeProposal(options);
  const amendment = genome.preprocessedAmendment({ workArea, proposalDir: dir, manifest, given });
  editJson(join(dir, 'curated', 'organism.json'), (r) => ({ ...r, ...amendment.organism, schemaVersion: 2, constants: { ...r.constants, ...amendment.constants } }));
  writeFileSync(join(dir, 'curated', 'datasets.json'), JSON.stringify({ schemaVersion: 2, datasets: amendment.entries }, null, 2) + '\n');
  return { dir, manifest, amendment };
}
