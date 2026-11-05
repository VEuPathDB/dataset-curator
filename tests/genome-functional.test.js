import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gafDate, mergeModels, runFunctional, sourceOf } from '../shared/scripts/genome/commands/functional.js';
import { PipelineError, sha256File } from '../shared/scripts/genome/workdir.js';
import { FUNCTIONAL_GFF3, functionalWorkDir, REPORT_NAME } from './genome-functional-helpers.js';
import { CM, gffLine, gffText } from './genome-helpers.js';
import { PRIMARY } from './genome-trial-helpers.js';

const read = (workDir, rel) => readFileSync(join(workDir, rel), 'utf-8');
const refuses = (fn, problem) => assert.throws(fn, (e) => e instanceof PipelineError && e.command === 'functional' && e.problem === problem);
const gaf = (source, goId, reference, aspect) =>
  `${[source, 'TST_0010_mRNA', 'TST_0010_mRNA', '', goId, reference, 'IEA', '', aspect, '', '', 'transcript', 'taxon:284813', '20261104', source, '', ''].join('\t')}\n`;

test('sourceOf and gafDate', () => {
  assert.equal(sourceOf('GCA_000091225.2'), 'GenBank');
  assert.equal(sourceOf('GCF_000091225.2'), 'RefSeq');
  assert.equal(sourceOf('ASM9122v2'), null);
  assert.equal(gafDate('2026-11-04T00:00:00.000Z'), '20261104');
  assert.equal(gafDate(undefined), null);
});

test('functional writes each dataset under final/function and lists it in functional.json', () => {
  const workDir = functionalWorkDir();
  const record = runFunctional({ workDir });
  assert.deepEqual(record.datasets.map((d) => [d.datasetClass, d.name, d.rows, d.ids.level, d.ids.count]), [
    ['productNames', 'GenBank', 2, 'transcript', 2],
    ['geneName', 'GenBank', 1, 'gene', 1],
    ['comments', 'GenBank_transcript', 2, 'transcript', 2],
    ['aliases', 'gbProteinId', 1, 'transcript', 1],
    ['dbxref_synonym', 'GenBank', 2, 'gene', 1],
    ['dbxref_simple', 'geneid_from_annotation', 1, 'gene', 1],
    ['dbxref_simple', 'interpro_from_annotation', 1, 'transcript', 1],
    ['dbxref_simple', 'uniprot_from_annotation', 1, 'transcript', 1],
    ['GeneOntologyAssociations', 'GenBank', 2, 'transcript', 1],
    ['EnzymeCommissionAssociations', 'GenBank', 2, 'protein', 1]
  ]);
  assert.equal(read(workDir, 'final/function/productNames/GenBank/products.txt'), 'TST_0010_mRNA\tkinase, putative\t1\nrna-TST_0030\ttRNA-Leu\t1\n');
  assert.equal(read(workDir, 'final/function/geneName/GenBank/geneName.txt'), 'TST_0010\ttstA\n');
  assert.equal(read(workDir, 'final/function/comments/GenBank_transcript/comments.txt'),
    'TST_0010_mRNA\tkinase domain, N-terminal\nrna-TST_0030\ttRNA-Leu (TAG)\n');
  assert.equal(read(workDir, 'final/function/aliases/gbProteinId/aliases.txt'), 'TST_0010_mRNA\tPRT1.1\n');
  assert.equal(read(workDir, 'final/function/dbxref_synonym/GenBank/synonyms.txt'), 'TST_0010\ttstA1\nTST_0010\ttstA2\n');
  assert.equal(read(workDir, 'final/function/dbxref_simple/geneid_from_annotation/mapping.txt'), 'TST_0010\t1001\n');
  assert.equal(read(workDir, 'final/function/dbxref_simple/uniprot_from_annotation/mapping.txt'), 'TST_0010_mRNA\tQ00001\n');
  assert.equal(read(workDir, 'final/function/GeneOntologyAssociations/GenBank/associations.gas'),
    gaf('GenBank', 'GO:0005524', 'PMID:12345678', 'F') + gaf('GenBank', 'GO:0006468', '', 'P'));
  assert.equal(read(workDir, 'final/function/EnzymeCommissionAssociations/GenBank/ec.txt'), 'TST_0010_mRNA-p1\t1.2.3.-\nTST_0010_mRNA-p1\t2.7.11.1\n');
  for (const d of record.datasets) assert.equal(sha256File(join(workDir, d.file)), d.sha256, d.file);
  assert.ok(!existsSync(join(workDir, 'final/function/comments/GenBank_gene')));
  assert.deepEqual(record.findings.map((f) => [f.severity, f.check, f.sample]), [['info', 'emptyClass', ['comments/GenBank_gene']]]);
  assert.equal(record.source, 'GenBank');
  assert.equal(record.taxonId, '284813');
  assert.equal(record.gafDate, '20261104');
  assert.equal(record.genomeBuild.sha256, sha256File(join(workDir, 'genome-build.json')));
  assert.deepEqual(JSON.parse(read(workDir, 'functional.json')), record);
});

test('a GCF_ accession is RefSeq, in dataset names and GAF columns', () => {
  const workDir = functionalWorkDir({ accession: 'GCF_000000001.1' });
  const record = runFunctional({ workDir });
  assert.equal(record.source, 'RefSeq');
  assert.ok(record.datasets.some((d) => d.datasetClass === 'comments' && d.name === 'RefSeq_transcript'));
  assert.equal(read(workDir, 'final/function/GeneOntologyAssociations/RefSeq/associations.gas'),
    gaf('RefSeq', 'GO:0005524', 'PMID:12345678', 'F') + gaf('RefSeq', 'GO:0006468', '', 'P'));
});

test('a rerun writes the same bytes and replaces final/function as a whole', () => {
  const workDir = functionalWorkDir();
  runFunctional({ workDir });
  const first = read(workDir, 'functional.json');
  mkdirSync(join(workDir, 'final/function/stale'), { recursive: true });
  writeFileSync(join(workDir, 'final/function/stale/x.txt'), 'left over\n');
  runFunctional({ workDir });
  assert.equal(read(workDir, 'functional.json'), first);
  for (const rel of ['final/function/stale', 'final/function.tmp', 'final/function.old']) assert.ok(!existsSync(join(workDir, rel)), rel);
});

test('error findings are recorded after the files are written', () => {
  const extra = [
    gffLine(CM, 'gene', 3000, 3300, '+', 'ID=TST_0050'),
    gffLine(CM, 'mRNA', 3000, 3300, '+', 'ID=TST_0050_mRNA;Parent=TST_0050'),
    gffLine(CM, 'CDS', 3000, 3300, '+', 'ID=PRT5.1;Parent=TST_0050_mRNA'),
    gffLine(CM, 'ncRNA', 2000, 2072, '+', 'ID=rna-orphan;product=orphan ncRNA')
  ];
  const workDir = functionalWorkDir({ gff3: `${FUNCTIONAL_GFF3}${extra.join('\n')}\n` });
  const record = runFunctional({ workDir });
  assert.deepEqual(record.findings.filter((f) => f.severity === 'error').map((f) => [f.check, f.sample]),
    [['unresolvedFeature', ['rna-orphan']], ['noProducts', ['TST_0050_mRNA']]]);
  assert.ok(existsSync(join(workDir, 'final/function/productNames/GenBank/products.txt')));
  assert.deepEqual(JSON.parse(read(workDir, 'functional.json')).findings, record.findings);
});

test('features ISF does not load are a notLoaded warning, not an error, and get no rows', () => {
  const extra = [
    gffLine(CM, 'gene', 4000, 4100, '+', 'ID=TST_0060'),
    gffLine(CM, 'RNase_P_RNA', 4000, 4100, '+', 'ID=rna-TST_0060;Parent=TST_0060;product=RNase P RNA')
  ];
  const workDir = functionalWorkDir({ gff3: `${FUNCTIONAL_GFF3}${extra.join('\n')}\n` });
  const record = runFunctional({ workDir });
  assert.deepEqual(record.findings.filter((f) => f.check === 'notLoaded').map((f) => [f.severity, f.count, f.sample]),
    [['warning', 2, ['TST_0060 (gene)', 'rna-TST_0060 (RNase_P_RNA)']]]);
  assert.ok(!record.findings.some((f) => f.severity === 'error'));
  assert.ok(!read(workDir, 'final/function/productNames/GenBank/products.txt').includes('RNase P RNA'));
});

test('functional refuses a build GFF3 that changed since finalize, and writes nothing', () => {
  const workDir = functionalWorkDir();
  appendFileSync(join(workDir, `build/${PRIMARY}/genome.gff3`), '# edited\n');
  assert.throws(() => runFunctional({ workDir }), (e) => e instanceof PipelineError && e.command === 'functional'
    && e.problem === 'does not match genome-build.json' && e.next === 'run build and finalize again');
  assert.ok(!existsSync(join(workDir, 'functional.json')));
  assert.ok(!existsSync(join(workDir, 'final/function')));
});

test('a stale-GFF3 refusal leaves no functional.json from an earlier run', () => {
  const workDir = functionalWorkDir();
  runFunctional({ workDir });
  assert.ok(existsSync(join(workDir, 'functional.json')));
  appendFileSync(join(workDir, `build/${PRIMARY}/genome.gff3`), '# edited\n');
  refuses(() => runFunctional({ workDir }), 'does not match genome-build.json');
  assert.ok(!existsSync(join(workDir, 'functional.json')));
});

test('annotated partitions are merged into one file per dataset, sorted, with counts and IDs summed', () => {
  const organelle = gffText(
    gffLine('CM000003.1', 'gene', 1, 900, '+', 'ID=MIT_0010;Dbxref=GeneID:2002'),
    gffLine('CM000003.1', 'mRNA', 1, 900, '+', 'ID=MIT_0010_mRNA;Parent=MIT_0010'),
    gffLine('CM000003.1', 'CDS', 1, 900, '+', 'ID=MPRT1.1;Parent=MIT_0010_mRNA;product=cytochrome b')
  );
  const workDir = functionalWorkDir({ organelleGff3: organelle });
  const record = runFunctional({ workDir });
  const counts = (name) => record.datasets.filter((d) => d.name === name).map((d) => [d.datasetClass, d.rows, d.ids.count]);
  assert.deepEqual(counts('GenBank').slice(0, 1), [['productNames', 3, 3]]);
  assert.deepEqual(counts('geneid_from_annotation'), [['dbxref_simple', 2, 2]]);
  assert.equal(read(workDir, 'final/function/productNames/GenBank/products.txt'),
    'MIT_0010_mRNA\tcytochrome b\t1\nTST_0010_mRNA\tkinase, putative\t1\nrna-TST_0030\ttRNA-Leu\t1\n');
  assert.equal(read(workDir, 'final/function/dbxref_simple/geneid_from_annotation/mapping.txt'), 'MIT_0010\t2002\nTST_0010\t1001\n');
});

test('mergeModels joins partition models without spreading them onto the stack', () => {
  const model = (offset) => ({
    features: Array.from({ length: 100000 }, (_, i) => ({ id: offset + i })),
    unresolved: Array.from({ length: 100000 }, (_, i) => `u${offset + i}`),
    notLoaded: [{ id: `n${offset}`, type: 'gene' }],
    codingTranscripts: Array.from({ length: 100000 }, (_, i) => `t${offset + i}`)
  });
  const merged = mergeModels([model(0), model(100000)]);
  assert.equal(merged.features.length, 200000);
  assert.equal(merged.unresolved.length, 200000);
  assert.equal(merged.codingTranscripts.length, 200000);
  assert.deepEqual(merged.notLoaded, [{ id: 'n0', type: 'gene' }, { id: 'n100000', type: 'gene' }]);
});

test('functional refuses an accession that is neither GCA_ nor GCF_', () => {
  refuses(() => runFunctional({ workDir: functionalWorkDir({ accession: 'ASM9122v2' }) }), 'has accession ASM9122v2, neither GCA_ nor GCF_');
});

test('functional reads the taxon from the fetched report, refusing one without # Taxid or changed since fetch', () => {
  refuses(() => runFunctional({ workDir: functionalWorkDir({ report: '# Assembly name:  TEST1\n# Sequence-Name\tSequence-Role\n' }) }),
    'has no "# Taxid:" line');
  const edited = functionalWorkDir();
  appendFileSync(join(edited, 'fetch', REPORT_NAME), '# edited\n');
  refuses(() => runFunctional({ workDir: edited }), 'does not match fetch/fetch.json');
});
