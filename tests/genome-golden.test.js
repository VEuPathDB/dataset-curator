import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { runBuild } from '../shared/scripts/genome/commands/build.js';
import { runFetch } from '../shared/scripts/genome/commands/fetch.js';
import { runFinalize } from '../shared/scripts/genome/commands/finalize.js';
import { runFunctional } from '../shared/scripts/genome/commands/functional.js';
import { runSurvey } from '../shared/scripts/genome/commands/survey.js';
import { parseGff } from '../shared/scripts/genome/gff.js';
import { isfTrees } from '../shared/scripts/genome/isf-map.js';
import { MAP_PATH, SCRIPT_PATH } from '../shared/scripts/genome/preprocess-gff3.js';
import { readText, sha256 } from '../shared/scripts/genome/workdir.js';
import {
  ECUN_FASTA, ECUN_GFF, ECUN_REPORT, FIXED_NOW, genomeFixtures, normalizeDbxrefs, parseBioperlTree, perlMissing,
  stubNcbi, tempDir, withoutBioSeqIO
} from './genome-helpers.js';

const ACD = process.env.APICOMMONDATA_DIR;
const UPDATE = process.env.UPDATE_GOLDEN === '1';
const ECUN = join(genomeFixtures, 'ecun');
const EXPECTED = join(ECUN, 'expected');
/** sha256 of each E. cuniculi functional file; a change means the extraction changed, so review the files of a local run. */
const ECUN_FUNCTIONAL_SHA256 = Object.fromEntries([
  ['productNames/GenBank', '286a150725db32f17445bd4f6cf14d2acc481d64006c63d26d38e3a1be614e03'],
  ['geneName/GenBank', 'bd78d69c909537aed15af3f90f42ccb3c79ba8bb37e2efa43b05efa094995a67'],
  ['comments/GenBank_transcript', '37c942d225e6769475b62f101e95b0744ac7d390cf2b4b9cdc6fc5c500dd33df'],
  ['aliases/gbProteinId', '59b261f3133a069530a258e260c1885beae72c19e2dee175f0a7695b63ba68bc'],
  ['dbxref_synonym/GenBank', '8c3adbcc494ffc7eab4932410f8dbe6927bc2e1d6010cb09320d92adb83f7896'],
  ['dbxref_simple/ensemblgenomes_gn_from_annotation', 'e60bb17ec99e1a15395c1656a86f57a73142b61f71ab717abfc0a3ec54c1e3c2'],
  ['dbxref_simple/ensemblgenomes_tr_from_annotation', 'e60bb17ec99e1a15395c1656a86f57a73142b61f71ab717abfc0a3ec54c1e3c2'],
  ['dbxref_simple/goa_from_annotation', '6094e07b53a8e36179fd7a53498360d09cf2ead96a3ecf099cdcbb8ab57cf817'],
  ['dbxref_simple/interpro_from_annotation', '7c36efab627d79c155a5d802b0a1c27759f0a51aa4e53cb96483fd81fa2acb0d'],
  ['dbxref_simple/ncbi_gp_from_annotation', '0e049a4e09f7a6789b0dcbb3f00b045e54c099033589806938be77cc96fd71fc'],
  ['dbxref_simple/pdb_from_annotation', '254c78d031e61eafa77e77d2cec3cb4e42f4bdbe28d142cc6f6dfd77ce30379b'],
  ['dbxref_simple/uniprot_from_annotation', 'd852fb8910c572129966eb324107467a3c6ef5a0c207f2f636a06c5d4aaa5759']
]);

function skipReason() {
  if (!ACD) return 'APICOMMONDATA_DIR is not set; point it at an ApiCommonData checkout to run the golden genome';
  if (!existsSync(join(ACD, MAP_PATH))) return `${ACD} has no ${MAP_PATH}`;
  if (!existsSync(join(ACD, SCRIPT_PATH))) return `${ACD} has no ${SCRIPT_PATH}`;
  if (spawnSync('git', ['-C', ACD, 'rev-parse', '--is-inside-work-tree']).status !== 0) return `${ACD} is not a git work tree; finalize records its commit`;
  return perlMissing;
}

/** Compares with the checked-in file, or rewrites it under UPDATE_GOLDEN=1. */
function golden(name, actual) {
  const path = join(EXPECTED, name);
  if (UPDATE) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, name.endsWith('.gz') ? gzipSync(actual) : actual);
    return;
  }
  const expected = readText(path);
  if (actual === expected) return;
  const a = actual.split('\n');
  const e = expected.split('\n');
  const line = a.findIndex((l, i) => l !== e[i]);
  assert.fail(`${name} differs from the golden at line ${line + 1}:\n  got:      ${a[line]}\n  expected: ${e[line]}\nIf intended, re-run with UPDATE_GOLDEN=1 and review the diff.`);
}

function gffSummary(text) {
  const rows = text.split('\n').filter(Boolean);
  const types = {};
  for (const row of rows) {
    const type = row.split('\t')[2];
    types[type] = (types[type] ?? 0) + 1;
  }
  return {
    lines: rows.length,
    sha256: sha256(text),
    types: Object.fromEntries(Object.entries(types).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
  };
}

/** Compares line count and type counts first so structural drift reads clearly, then the content hash. */
function goldenGffSummary(name, text) {
  const actual = gffSummary(text);
  const path = join(EXPECTED, name);
  if (UPDATE) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(actual, null, 2)}\n`);
    return;
  }
  const expected = JSON.parse(readText(path));
  assert.equal(actual.lines, expected.lines, `${name}: line count`);
  assert.deepEqual(actual.types, expected.types, `${name}: feature type counts`);
  assert.equal(actual.sha256, expected.sha256, `${name}: content sha256 differs; regenerate with UPDATE_GOLDEN=1 and inspect the diff of a local run`);
}

const shapeNoIds =(t) => `${t.type}:${t.start}-${t.end}:${t.strand}[${t.children.map(shapeNoIds).join(',')}]`;
const counts = (findings, stage) => findings.filter((f) => f.stage === stage).map((f) => [f.check, f.count]);
/** Masks what moves with the ApiCommonData checkout and the package version. */
const masked = (record) => ({
  ...record,
  generator: { ...record.generator, version: '<masked>' },
  apiCommonData: {
    ...record.apiCommonData,
    commit: '<masked>',
    dirty: '<masked>',
    isfMap: { ...record.apiCommonData.isfMap, sha256: '<masked>' },
    preprocessGFF3: { ...record.apiCommonData.preprocessGFF3, sha256: '<masked>' }
  }
});

test('normalizeDbxrefs sorts the Dbxref segments of each line', () => {
  assert.equal(normalizeDbxrefs('c\tE\tgene\t1\t9\t.\t+\t.\tID "g";Dbxref  "PMID:2";Name "n";Dbxref "PMID:1";\n#x'),
    'c\tE\tgene\t1\t9\t.\t+\t.\tID "g";Dbxref "PMID:1";Name "n";Dbxref "PMID:2";\n#x');
});

test('golden: E. cuniculi GB-M1 chromosomes X and XI through fetch, survey, build and finalize', { skip: skipReason() }, async () => {
  const workDir = process.env.GOLDEN_WORKDIR || tempDir('golden-ecun-');
  mkdirSync(workDir, { recursive: true });
  const files = Object.fromEntries([ECUN_GFF, ECUN_FASTA, ECUN_REPORT].map((p) => [basename(p), readFileSync(p)]));
  await runFetch({ workDir, accession: 'GCA_000091225.2', fetchBytes: stubNcbi('GCA_000091225.2', 'GCA_000091225.2_ASM9122v2', files).fetchBytes, now: FIXED_NOW });
  cpSync(join(ECUN, 'recipe.json'), join(workDir, 'recipe.json'));
  cpSync(join(ECUN, 'ids.tsv'), join(workDir, 'ids.tsv'));

  const survey = await runSurvey({ workDir, apiCommonData: ACD, now: FIXED_NOW });
  assert.deepEqual(counts(survey.findings, 'raw'), [['geneCdsNoRna', 428], ['repeatedGeneLines', 1], ['parentlessRna', 6], ['unhandledType', 434], ['partitionCounts', 1]]);
  assert.deepEqual(counts(survey.findings, 'suggested'), [['unhandledType', 2], ['attributeNotInMap', 1], ['partitionCounts', 1]]);
  assert.equal(survey.findings[3].message, 'ISF drops these features: region 2, gene 430, SRP_RNA 1, RNase_MRP_RNA 1');
  assert.deepEqual(survey.findings[1].sample, ['gene-ECU10_0805']);
  assert.deepEqual(survey.findings.find((f) => f.check === 'attributeNotInMap').sample, ['ECU10_0805']);
  assert.deepEqual(survey.suggestedRecipe, JSON.parse(readFileSync(join(ECUN, 'recipe.json'), 'utf-8')));
  golden('survey.json', readFileSync(join(workDir, 'survey.json'), 'utf-8'));

  const build = await runBuild({ workDir, apiCommonData: ACD, now: FIXED_NOW });
  assert.deepEqual(build.transforms.map((t) => [t.name, t.changes]), [
    ['collapseSplitGenes', 1], ['addMrnaToGeneCds', 428], ['parentOrphanRnas', 6], ['addExonPerCds', 428], ['stripAttributes', 1]
  ]);
  assert.deepEqual(build.idPolicy, { name: 'ncbiDefault', renamed: 864 });
  assert.equal(build.ids.applied, 1);
  assert.deepEqual(build.warnings, []);
  assert.equal(build.findings.filter((f) => f.severity === 'error').length, 0);
  assert.deepEqual(build.findings.map((f) => [f.check, f.count]), [['unhandledType', 2], ['partitionCounts', 1]]);
  assert.deepEqual(build.partitions.map((part) => [part.dir, part.featureCount, part.gffLines]), [['final/primary_chromosome', 442, 1777]]);
  const idsDefault = readFileSync(join(workDir, 'ids.default.tsv'), 'utf-8').split('\n');
  assert.equal(idsDefault.length, 866);
  for (const row of ['gene\tgene-ECU11_0375\tECU11_0375', 'gene\tgene-ECU11_0375-2\tECU11_0375-2', 'protein\tcds-SKD10708.1\tSKD10708.1']) {
    assert.ok(idsDefault.includes(row), row);
  }
  const levelCount = (level) => idsDefault.filter((row) => row.startsWith(`${level}\t`)).length;
  assert.deepEqual([levelCount('gene'), levelCount('transcript'), levelCount('protein')], [436, 0, 428]);
  const normalized = readFileSync(join(workDir, 'build/normalized.gff3'), 'utf-8');
  const lines = normalized.split('\n');
  assert.equal(lines.filter((l) => l && !l.startsWith('#')).length, 1777);
  for (const line of [
    'AL590449.1\tEMBL\tgene\t109856\t110296\t.\t-\t.\tID=ECU10_0805;Name=ECU10_0805;gbkey=Gene;gene=ECU10_0805;gene_biotype=protein_coding',
    'AL590449.1\tEMBL\tmRNA\t109856\t110296\t.\t-\t.\tID=ECU10_0805_mRNA;Parent=ECU10_0805',
    'AL590449.1\tEMBL\texon\t110270\t110296\t.\t-\t.\tID=ECU10_0805_mRNA_exon1;Parent=ECU10_0805_mRNA',
    'AL590449.1\tEMBL\texon\t109856\t110061\t.\t-\t.\tID=ECU10_0805_mRNA_exon3;Parent=ECU10_0805_mRNA',
    'AL590449.1\tEMBL\tgene\t138959\t139146\t.\t+\t.\tID=gene_AL590449.1_138959_139146',
    'AL590449.1\tEMBL\tSRP_RNA\t138959\t139146\t.\t+\t.\tID=rna_AL590449.1_138959_139146_SRP_RNA;Parent=gene_AL590449.1_138959_139146;gbkey=ncRNA;product=SRP RNA',
    'AL590450.2\tEMBL\tgene\t53325\t53558\t.\t+\t.\tID=ECU11_0375;Name=ECU11_0375;gbkey=Gene;gene=ECU11_0375;gene_biotype=protein_coding',
    'AL590450.2\tEMBL\tmRNA\t53325\t53558\t.\t+\t.\tID=ECU11_0375_mRNA;Parent=ECU11_0375',
    'AL590450.2\tEMBL\tgene\t53670\t53750\t.\t-\t.\tID=ECU11_0375_2;Name=ECU11_0375;gbkey=Gene;gene=ECU11_0375;gene_biotype=tRNA',
    'AL590450.2\tEMBL\ttRNA\t53670\t53750\t.\t-\t.\tID=rna-ECU11_0375;Parent=ECU11_0375_2;Note=tRNA found by tRNAscan-SE%2C tRNA type: Leu%2C Anticodon: TAG%2C Score: 59.63;gbkey=tRNA;gene=ECU11_0375;product=tRNA-Leu'
  ]) assert.ok(lines.includes(line), line);

  const { trees, dropped } = isfTrees(parseGff(normalized));
  assert.equal(trees.length, 442);
  const types = {};
  for (const t of trees) types[t.type] = (types[t.type] ?? 0) + 1;
  assert.deepEqual(types, { coding_gene: 428, tRNA_gene: 8, snRNA_gene: 3, SRP_RNA_gene: 1, snoRNA_gene: 1, RNase_MRP_RNA_gene: 1 });
  assert.deepEqual(dropped.map((d) => d.type), ['region', 'region']);
  const remaining = trees.map(shapeNoIds);
  const expectedTrees = parseBioperlTree(readText(join(ECUN, 'isf/bioperltree.out.gz')));
  assert.equal(expectedTrees.length, 440);
  for (const shape of expectedTrees.map(shapeNoIds)) {
    const i = remaining.indexOf(shape);
    assert.ok(i >= 0, `ISF built ${shape} from the spike's GFF; the pipeline's build has no such tree`);
    remaining.splice(i, 1);
  }
  assert.deepEqual(remaining.map((s) => s.split(':')[0]), ['SRP_RNA_gene', 'RNase_MRP_RNA_gene']);

  const script = withoutBioSeqIO(join(ACD, SCRIPT_PATH), tempDir('golden-preprocess-'));
  const record = await runFinalize({ workDir, apiCommonData: ACD, preprocessGFF3: script, now: FIXED_NOW });
  const final = join(workDir, 'final/primary_chromosome');
  assert.equal(readFileSync(join(final, 'chromosomeMap.txt'), 'utf-8'), 'AL590449.1\tX\t1\nAL590450.2\tXI\t2\n');
  assert.equal(readFileSync(join(final, 'genome.fasta'), 'utf-8'), readText(ECUN_FASTA));
  const gff = readFileSync(join(final, 'genome.gff'), 'utf-8');
  assert.equal(gff.split('\n').filter(Boolean).length, 1777);
  assert.ok(gff.includes('AL590449.1\tEMBL\tgene\t109856\t110296\t.\t-\t.\tID "ECU10_0805";Name "ECU10_0805";gbkey "Gene";gene "ECU10_0805";gene_biotype "protein_coding";\n'));
  goldenGffSummary('final/primary_chromosome/genome.gff.json', normalizeDbxrefs(gff));
  golden('genome-build.json', `${JSON.stringify(masked(record), null, 2)}\n`);

  const functional = runFunctional({ workDir });
  assert.deepEqual(functional.findings.map((f) => [f.severity, f.check, f.count, f.sample]), [
    ['warning', 'unknownDbxrefPrefix', 2, ['EnsemblGenomes-Gn', 'EnsemblGenomes-Tr']],
    ['info', 'emptyClass', 3, ['comments/GenBank_gene', 'GeneOntologyAssociations/GenBank', 'EnzymeCommissionAssociations/GenBank']]
  ]);
  assert.deepEqual(functional.datasets.map((d) => [`${d.datasetClass}/${d.name}`, d.ids.level, d.rows, d.ids.count]), [
    ['productNames/GenBank', 'transcript', 442, 442],
    ['geneName/GenBank', 'gene', 1, 1],
    ['comments/GenBank_transcript', 'transcript', 407, 407],
    ['aliases/gbProteinId', 'transcript', 428, 428],
    ['dbxref_synonym/GenBank', 'gene', 3, 3],
    ['dbxref_simple/ensemblgenomes_gn_from_annotation', 'gene', 420, 420],
    ['dbxref_simple/ensemblgenomes_tr_from_annotation', 'gene', 420, 420],
    ['dbxref_simple/goa_from_annotation', 'transcript', 286, 286],
    ['dbxref_simple/interpro_from_annotation', 'transcript', 955, 332],
    ['dbxref_simple/ncbi_gp_from_annotation', 'gene', 428, 428],
    ['dbxref_simple/pdb_from_annotation', 'transcript', 15, 7],
    ['dbxref_simple/uniprot_from_annotation', 'transcript', 420, 420]
  ]);
  assert.deepEqual(functional.datasets.find((d) => d.name === 'uniprot_from_annotation').props.prefixes, ['UniProtKB/Swiss-Prot', 'UniProtKB/TrEMBL']);
  assert.equal(readFileSync(join(workDir, 'final/function/geneName/GenBank/geneName.txt'), 'utf-8'), 'ECU11_0375_2\tECU11_0375\n');
  assert.deepEqual(Object.fromEntries(functional.datasets.map((d) => [`${d.datasetClass}/${d.name}`, d.sha256])), ECUN_FUNCTIONAL_SHA256);
});
