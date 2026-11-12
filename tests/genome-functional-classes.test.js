import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractDatasets } from '../shared/scripts/genome/functional/classes.js';
import { resolveFeatures } from '../shared/scripts/genome/functional/ids.js';
import { fileText } from '../shared/scripts/genome/functional/writers.js';
import { parseGff } from '../shared/scripts/genome/gff.js';
import { CM, gffLine, gffText } from './genome-helpers.js';

const CTX = { source: 'GenBank', taxonId: 284813, date: '20261104' };
const extract = (...lines) => {
  const { features, codingTranscripts } = resolveFeatures(parseGff(gffText(...lines)));
  return extractDatasets(features, { source: 'GenBank', codingTranscripts });
};
const dataset = (result, datasetClass, name) => result.datasets.find((d) => d.datasetClass === datasetClass && d.name === name);
const text = (result, datasetClass, name) => fileText(dataset(result, datasetClass, name), CTX);
const checks = (result) => result.findings.map((f) => [f.severity, f.check, f.count, f.sample]);

const codingGene = (id, { gene = '', rna = '', cds = '' } = {}) => [
  gffLine(CM, 'gene', 100, 900, '+', `ID=${id}${gene}`),
  gffLine(CM, 'mRNA', 100, 900, '+', `ID=${id}_mRNA;Parent=${id}${rna}`),
  gffLine(CM, 'exon', 100, 900, '+', `ID=${id}_mRNA_exon1;Parent=${id}_mRNA`),
  gffLine(CM, 'CDS', 100, 900, '+', `ID=${id}.p;Parent=${id}_mRNA${cds}`)
];
const trnaGene = (id, rna) => [
  gffLine(CM, 'gene', 1000, 1072, '+', `ID=${id}`),
  gffLine(CM, 'tRNA', 1000, 1072, '+', `ID=rna-${id};Parent=${id}${rna}`)
];

test('productNames reads product from the CDS, and from an RNA that has no CDS', () => {
  const r = extract(
    ...codingGene('ECU10_0010', { rna: ';product=ignored mRNA product', cds: ';product=hypothetical protein' }),
    ...trnaGene('ECU10_0155', ';product=tRNA-Asn')
  );
  assert.equal(text(r, 'productNames', 'GenBank'), 'ECU10_0010_mRNA\thypothetical protein\t1\nrna-ECU10_0155\ttRNA-Asn\t1\n');
  assert.equal(dataset(r, 'productNames', 'GenBank').level, 'transcript');
  assert.equal(dataset(r, 'productNames', 'GenBank').file, 'products.txt');
});

test('is_preferred marks the first product in GFF order, then rows sort by ID and product', () => {
  const r = extract(
    ...codingGene('B_0020', { cds: ';product=zinc finger%2C C2H2 type,DNA binding protein' }),
    ...codingGene('A_0010', { cds: ';product=kinase' })
  );
  assert.equal(text(r, 'productNames', 'GenBank'),
    'A_0010_mRNA\tkinase\t1\nB_0020_mRNA\tDNA binding protein\t0\nB_0020_mRNA\tzinc finger, C2H2 type\t1\n');
  assert.deepEqual(checks(r).filter(([, check]) => check === 'multipleProducts'), [['info', 'multipleProducts', 1, ['B_0020_mRNA']]]);
});

test('a coding transcript with no product is a noProducts error; an RNA without one is not', () => {
  const r = extract(...codingGene('ECU10_0010', { cds: ';product=kinase' }), ...codingGene('ECU10_0020'), ...trnaGene('ECU10_0155', ''));
  assert.deepEqual(checks(r).filter(([severity]) => severity === 'error'), [['error', 'noProducts', 1, ['ECU10_0020_mRNA']]]);
});

test('geneName keeps the gene feature\'s own name, skips one equal to its ID or a locus_tag, and warns when its features disagree', () => {
  const r = extract(
    ...codingGene('ECU10_0010', { gene: ';gene=ECU10_0010', cds: ';gene=ECU10_0010;product=p' }),
    gffLine(CM, 'gene', 53670, 53750, '-', 'ID=ECU11_0375_2;gene=ECU11_0375'),
    gffLine(CM, 'tRNA', 53670, 53750, '-', 'ID=rna-ECU11_0375;Parent=ECU11_0375_2;gene=ECU11_0375;product=tRNA-Leu'),
    ...codingGene('TST_0030', { gene: ';gene=tstC;locus_tag=TST_0030', cds: ';gene=tstC2;product=p' }),
    ...codingGene('TST_0040', { gene: ';gene=TST_0040x;locus_tag=TST_0040x', cds: ';product=p' }),
    ...codingGene('TST_0050', { cds: ';gene=tstE;product=p' })
  );
  assert.equal(text(r, 'geneName', 'GenBank'), 'ECU11_0375_2\tECU11_0375\nTST_0030\ttstC\nTST_0050\ttstE\n');
  assert.deepEqual(checks(r).filter(([, check]) => check === 'geneNameConflict'), [['warning', 'geneNameConflict', 1, ['TST_0030']]]);
  assert.equal(r.findings.find((f) => f.check === 'geneNameConflict').message,
    "genes whose features disagree on gene; the gene feature's value is kept, else the first in GFF order");
});

test('geneName skips a name equal to a locus_tag on any feature of the gene, not only on those carrying gene', () => {
  const r = extract(
    ...codingGene('TST_0070', { gene: ';locus_tag=TST_0070x', cds: ';gene=TST_0070x;product=p' }),
    ...codingGene('TST_0071', { gene: ';gene=tstQ', cds: ';product=p' })
  );
  assert.equal(text(r, 'geneName', 'GenBank'), 'TST_0071\ttstQ\n');
});

test('a transcript ISF synthesizes from its gene\'s feature gets no gene-level attributes, but keeps its product', () => {
  const r = extract(
    gffLine(CM, 'gene', 1, 99, '+', 'ID=PSG2;Note=pseudogene;pseudo=true;product=hypothetical pseudogene product;Dbxref=PDB:1ABC'),
    gffLine(CM, 'tRNA', 400, 472, '+', 'ID=rna-T1;product=tRNA-Gly;Note=tRNA found by tRNAscan-SE')
  );
  assert.equal(text(r, 'comments', 'GenBank_gene'), 'PSG2\tpseudogene\nrna-T1\ttRNA found by tRNAscan-SE\n');
  assert.equal(dataset(r, 'comments', 'GenBank_transcript'), undefined);
  assert.equal(text(r, 'productNames', 'GenBank'), 'PSG2.mRNA\thypothetical pseudogene product\t1\nrna-T1.tRNA\ttRNA-Gly\t1\n');
  assert.equal(text(r, 'dbxref_simple', 'pdb_from_annotation'), 'PSG2.mRNA\t1ABC\n');
});

test('comments: Notes on RNAs and CDSs go to transcripts, Notes on genes to genes', () => {
  const r = extract(
    ...codingGene('ECU10_0010', { gene: ';Note=gene note', cds: ';Note=10_0010%2C unknown%2C gene found by Glimmer;product=p' }),
    ...trnaGene('ECU10_0155', ';Note=tRNA found by tRNAscan-SE;product=tRNA-Asn')
  );
  assert.equal(text(r, 'comments', 'GenBank_transcript'),
    'ECU10_0010_mRNA\t10_0010, unknown, gene found by Glimmer\nrna-ECU10_0155\ttRNA found by tRNAscan-SE\n');
  assert.equal(text(r, 'comments', 'GenBank_gene'), 'ECU10_0010\tgene note\n');
});

test('aliases take protein_id per transcript; dbxref_synonym takes gene_synonym per gene', () => {
  const r = extract(...codingGene('ECU10_0010', { gene: ';gene_synonym=ecuA,ecu-a', cds: ';product=p;protein_id=CAD25721.2' }));
  assert.equal(text(r, 'aliases', 'gbProteinId'), 'ECU10_0010_mRNA\tCAD25721.2\n');
  assert.equal(text(r, 'dbxref_synonym', 'GenBank'), 'ECU10_0010\tecu-a\nECU10_0010\tecuA\n');
});

test('a dataset with no rows is left out and named in one emptyClass info finding', () => {
  const r = extract(...codingGene('ECU10_0010', { cds: ';product=p' }));
  assert.deepEqual(r.datasets.map((d) => `${d.datasetClass}/${d.name}`), ['productNames/GenBank']);
  assert.deepEqual(checks(r), [['info', 'emptyClass', 8, [
    'geneName/GenBank', 'comments/GenBank_transcript', 'comments/GenBank_gene', 'aliases/gbProteinId', 'dbxref_synonym/GenBank',
    'dbxref_simple', 'GeneOntologyAssociations/GenBank', 'EnzymeCommissionAssociations/GenBank'
  ]]]);
});

const props = (prefixes, viewName, url) => ({ prefixes, url, target: 'NAFeature', viewName });

test('dbxref_simple reuses established datasets for override prefixes, merging them, and gives other prefixes gene-level ones', () => {
  const r = extract(...codingGene('ECU10_0010', {
    gene: ';Dbxref=GeneID:1001',
    rna: ';Dbxref=GeneID:1001',
    cds: ';Dbxref=EnsemblGenomes-Gn:CAD25721,InterPro:IPR011667,UniProtKB/Swiss-Prot:Q8ST30,UniProtKB/TrEMBL:A0A000,NCBI_GP:CAD25721.2,InterPro:IPR000001;product=p'
  }));
  assert.deepEqual(r.datasets.filter((d) => d.datasetClass === 'dbxref_simple').map((d) => [d.name, d.level, d.file, d.props]), [
    ['ensemblgenomes_gn_from_annotation', 'gene', 'mapping.txt', props(['EnsemblGenomes-Gn'], 'GeneFeature', null)],
    ['geneid_from_annotation', 'gene', 'mapping.txt', props(['GeneID'], 'GeneFeature', 'https://www.ncbi.nlm.nih.gov/gene/?term=EXTERNAL_ID_HERE')],
    ['interpro_from_annotation', 'transcript', 'mapping.txt', props(['InterPro'], 'Transcript', 'http://www.ebi.ac.uk/interpro/entry/EXTERNAL_ID_HERE')],
    ['ncbi_gp_from_annotation', 'gene', 'mapping.txt', props(['NCBI_GP'], 'GeneFeature', 'http://www.ncbi.nlm.nih.gov/protein/EXTERNAL_ID_HERE')],
    ['uniprot_from_annotation', 'transcript', 'mapping.txt',
      props(['UniProtKB/Swiss-Prot', 'UniProtKB/TrEMBL'], 'Transcript', 'http://www.uniprot.org/uniprot/EXTERNAL_ID_HERE')]
  ]);
  assert.equal(text(r, 'dbxref_simple', 'geneid_from_annotation'), 'ECU10_0010\t1001\n');
  assert.equal(text(r, 'dbxref_simple', 'interpro_from_annotation'), 'ECU10_0010_mRNA\tIPR000001\nECU10_0010_mRNA\tIPR011667\n');
  assert.equal(text(r, 'dbxref_simple', 'uniprot_from_annotation'), 'ECU10_0010_mRNA\tA0A000\nECU10_0010_mRNA\tQ8ST30\n');
  assert.deepEqual(checks(r).filter(([severity]) => severity === 'error'), []);
  assert.deepEqual(checks(r).filter(([severity]) => severity === 'warning'), [['warning', 'unknownDbxrefPrefix', 1, ['EnsemblGenomes-Gn']]]);
});

test('a transcript-level Dbxref on a CDS maps to its transcript; a url-less override still warns', () => {
  const r = extract(...codingGene('ECU10_0010', { cds: ';Dbxref=EnsemblGenomes-Tr:CAD25721-1,EnsemblGenomes-Gn:CAD25721;product=p' }));
  assert.equal(text(r, 'dbxref_simple', 'ensemblgenomes_tr_from_annotation'), 'ECU10_0010_mRNA\tCAD25721-1\n');
  assert.equal(text(r, 'dbxref_simple', 'ensemblgenomes_gn_from_annotation'), 'ECU10_0010\tCAD25721\n');
  assert.deepEqual(checks(r).filter(([severity]) => severity === 'warning'), [['warning', 'unknownDbxrefPrefix', 2, ['EnsemblGenomes-Gn', 'EnsemblGenomes-Tr']]]);
});

test('a gene\'s Dbxref at transcript level goes to each of its transcripts', () => {
  const r = extract(
    gffLine(CM, 'gene', 1, 900, '+', 'ID=G1;Dbxref=PDB:1ABC'),
    gffLine(CM, 'mRNA', 1, 900, '+', 'ID=T1;Parent=G1'),
    gffLine(CM, 'mRNA', 1, 900, '+', 'ID=T2;Parent=G1')
  );
  assert.equal(text(r, 'dbxref_simple', 'pdb_from_annotation'), 'T1\t1ABC\nT2\t1ABC\n');
});

test('a sanitized name two prefixes share, or one an override uses, is a dbxrefNameClash error and is not written; a value with no prefix is badDbxref', () => {
  const r = extract(...codingGene('ECU10_0010', { cds: ';Dbxref=PDB:1ABC,pdb:2XYZ,Uni-Prot:Q1,Uni_Prot:Q2,InterPro:IPR1,Q8ST30;product=p' }));
  assert.deepEqual(r.datasets.filter((d) => d.datasetClass === 'dbxref_simple').map((d) => d.name), ['interpro_from_annotation']);
  const clash = r.findings.find((f) => f.check === 'dbxrefNameClash');
  assert.deepEqual([clash.severity, clash.sample], ['error', ['pdb_from_annotation', 'uni_prot_from_annotation']]);
  assert.match(clash.message, /pdb_from_annotation ← PDB and pdb; uni_prot_from_annotation ← Uni-Prot and Uni_Prot/);
  assert.deepEqual(checks(r).filter(([, check]) => check === 'badDbxref'), [['warning', 'badDbxref', 1, ['ECU10_0010: Q8ST30']]]);
});

test('dbxref_simple is an emptyClass only when no Dbxref values were found, not when every name clashed', () => {
  const clashed = extract(...codingGene('ECU10_0010', { cds: ';Dbxref=PDB:1ABC,pdb:2XYZ;product=p' }));
  assert.ok(clashed.findings.some((f) => f.check === 'dbxrefNameClash'));
  assert.ok(!clashed.findings.find((f) => f.check === 'emptyClass').sample.includes('dbxref_simple'));
});

test('GeneOntologyAssociations writes GAF 2.2 lines per transcript from go_function, go_process and go_component', () => {
  const r = extract(...codingGene('XP_0010', {
    cds: ';go_function=ATP binding|0005524|12345678|IEA;go_process=translation|0006412||;go_component=nucleus|0005634|111,222|IDA,broken;product=p'
  }));
  const gaf = (goId, reference, evidence, aspect) =>
    ['GenBank', 'XP_0010_mRNA', 'XP_0010_mRNA', '', goId, reference, evidence, '', aspect, '', '', 'transcript', 'taxon:284813', '20261104', 'GenBank', '', ''].join('\t');
  assert.equal(text(r, 'GeneOntologyAssociations', 'GenBank'), [
    gaf('GO:0005524', 'PMID:12345678', 'IEA', 'F'),
    gaf('GO:0005634', 'PMID:111|PMID:222', 'IDA', 'C'),
    gaf('GO:0006412', '', 'IEA', 'P')
  ].map((line) => `${line}\n`).join(''));
  assert.equal(dataset(r, 'GeneOntologyAssociations', 'GenBank').file, 'associations.gas');
  assert.deepEqual(checks(r).filter(([, check]) => check === 'badGo'), [['warning', 'badGo', 1, ['XP_0010_mRNA: broken']]]);
});

test('EnzymeCommissionAssociations maps each EC_number on a CDS to the protein ID, keeping partial ECs', () => {
  const r = extract(...codingGene('XP_0010', { cds: ';EC_number=2.7.11.1,1.2.3.-,2.7.11;product=p' }));
  assert.equal(text(r, 'EnzymeCommissionAssociations', 'GenBank'), 'XP_0010_mRNA-p1\t1.2.3.-\nXP_0010_mRNA-p1\t2.7.11.1\n');
  assert.equal(dataset(r, 'EnzymeCommissionAssociations', 'GenBank').level, 'protein');
  assert.deepEqual(checks(r).filter(([, check]) => check === 'badEc'), [['warning', 'badEc', 1, ['XP_0010_mRNA-p1: 2.7.11']]]);
});
