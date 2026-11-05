import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DBXREF_OVERRIDES, DBXREF_URLS, dbxrefDataset } from '../shared/scripts/genome/functional/dbxref-urls.js';
import { attrValues, dbxrefDatasetName, goValues, isEc, parseDbxref, parseGo } from '../shared/scripts/genome/functional/values.js';
import { featureGroups, parseGff } from '../shared/scripts/genome/gff.js';
import { CM, gffLine, gffText } from './genome-helpers.js';

const groupOf = (...lines) => featureGroups(parseGff(gffText(...lines)))[0];

test('attrValues splits on raw commas, then decodes, so an encoded comma stays inside a value', () => {
  const cds = groupOf(gffLine(CM, 'CDS', 1, 9, '+', 'ID=P1;Note=10_0010%2C unknown%2C gene found by Glimmer;product=a,b'));
  assert.deepEqual(attrValues(cds, 'Note'), ['10_0010, unknown, gene found by Glimmer']);
  assert.deepEqual(attrValues(cds, 'product'), ['a', 'b']);
  assert.deepEqual(attrValues(cds, 'gene'), []);
});

test('attrValues reads every line of a feature once, and keeps a decoded tab from breaking a TSV cell', () => {
  const cds = groupOf(
    gffLine(CM, 'CDS', 1, 9, '+', 'ID=P1;product=kinase;Note=tab%09inside'),
    gffLine(CM, 'CDS', 20, 29, '+', 'ID=P1;product=kinase,phosphatase')
  );
  assert.deepEqual(attrValues(cds, 'product'), ['kinase', 'phosphatase']);
  assert.deepEqual(attrValues(cds, 'Note'), ['tab inside']);
});

test('parseGo reads term|GO id|PMIDs|evidence, padding the id and defaulting the evidence to IEA', () => {
  assert.deepEqual(parseGo('ATP binding|0005524|12345678|IEA'), { goId: 'GO:0005524', reference: 'PMID:12345678', evidence: 'IEA' });
  assert.deepEqual(parseGo('translation|6412||'), { goId: 'GO:0006412', reference: '', evidence: 'IEA' });
  assert.deepEqual(parseGo('nucleus|0005634|111,222|IDA'), { goId: 'GO:0005634', reference: 'PMID:111|PMID:222', evidence: 'IDA' });
  for (const bad of ['ATP binding', 'ATP binding|GO:0005524||IEA', 'x|00055241||IEA', 'x|0005524|PMID 1|IEA', 'x|0005524||IDA,broken', 'a|1|2|3|4']) {
    assert.equal(parseGo(bad), null, bad);
  }
});

test('goValues splits terms on raw commas and rejoins a PMID list that a comma split', () => {
  const cds = groupOf(gffLine(CM, 'CDS', 1, 9, '+',
    'ID=P1;go_function=ATP binding|0005524|12345678|IEA,protein kinase activity|0004672|111,222|IDA,broken'));
  const { values, bad } = goValues(cds, 'go_function');
  assert.deepEqual(values.map((v) => [v.goId, v.reference, v.evidence]), [
    ['GO:0005524', 'PMID:12345678', 'IEA'], ['GO:0004672', 'PMID:111|PMID:222', 'IDA']
  ]);
  assert.deepEqual(bad, ['broken']);
});

test('isEc takes four dot-separated numbers, with - for an unknown level', () => {
  for (const ec of ['2.7.11.1', '1.2.3.-', '3.-.-.-']) assert.ok(isEc(ec), ec);
  for (const ec of ['2.7.11', '2.7.11.1.5', 'EC:2.7.11.1', '2.7.11.n1', '']) assert.ok(!isEc(ec), ec);
});

test('parseDbxref splits at the first colon', () => {
  assert.deepEqual(parseDbxref('UniProtKB/Swiss-Prot:Q8ST30'), { prefix: 'UniProtKB/Swiss-Prot', id: 'Q8ST30' });
  assert.deepEqual(parseDbxref('HGNC:HGNC:5'), { prefix: 'HGNC', id: 'HGNC:5' });
  for (const bad of ['Q8ST30', ':Q8ST30', 'InterPro:']) assert.equal(parseDbxref(bad), null, bad);
});

test('dbxrefDatasetName lower-cases the prefix and turns each run of other characters into _', () => {
  assert.equal(dbxrefDatasetName('UniProtKB/Swiss-Prot'), 'uniprotkb_swiss_prot_from_annotation');
  assert.equal(dbxrefDatasetName('InterPro'), 'interpro_from_annotation');
  assert.equal(dbxrefDatasetName('EnsemblGenomes-Gn'), 'ensemblgenomes_gn_from_annotation');
  assert.equal(dbxrefDatasetName('NCBI_GP'), 'ncbi_gp_from_annotation');
});

test('dbxrefDataset reuses an established dataset for an override prefix', () => {
  const uniprot = { name: 'uniprot_from_annotation', level: 'transcript', viewName: 'Transcript', url: 'http://www.uniprot.org/uniprot/EXTERNAL_ID_HERE', override: true };
  assert.deepEqual(dbxrefDataset('UniProtKB/Swiss-Prot'), uniprot);
  assert.deepEqual(dbxrefDataset('UniProtKB/TrEMBL'), uniprot);
  assert.deepEqual(dbxrefDataset('PDB'),
    { name: 'pdb_from_annotation', level: 'transcript', viewName: 'Transcript', url: 'http://www.rcsb.org/structure/EXTERNAL_ID_HERE', override: true });
});

test('dbxrefDataset gives any other prefix its sanitized gene-level dataset, with a URL template or null', () => {
  assert.deepEqual(dbxrefDataset('GeneID'),
    { name: 'geneid_from_annotation', level: 'gene', viewName: 'GeneFeature', url: 'https://www.ncbi.nlm.nih.gov/gene/?term=EXTERNAL_ID_HERE', override: false });
  assert.deepEqual(dbxrefDataset('EnsemblGenomes-Gn'),
    { name: 'ensemblgenomes_gn_from_annotation', level: 'gene', viewName: 'GeneFeature', url: null, override: false });
  assert.equal(dbxrefDataset('constructor').override, false);
});

test('the tables are consistent: one EXTERNAL_ID_HERE per URL, one level/view/URL per override name, no prefix in both', () => {
  const urls = [...Object.values(DBXREF_URLS), ...Object.values(DBXREF_OVERRIDES).map((o) => o.url)];
  for (const url of urls) assert.equal(url.split('EXTERNAL_ID_HERE').length, 2, url);
  const byName = new Map();
  for (const o of Object.values(DBXREF_OVERRIDES)) {
    assert.ok(['gene', 'transcript'].includes(o.level) && o.viewName === (o.level === 'gene' ? 'GeneFeature' : 'Transcript'), o.name);
    const key = JSON.stringify([o.level, o.viewName, o.url]);
    assert.equal(byName.get(o.name) ?? key, key, o.name);
    byName.set(o.name, key);
  }
  for (const prefix of Object.keys(DBXREF_URLS)) {
    assert.ok(!Object.hasOwn(DBXREF_OVERRIDES, prefix), prefix);
    assert.ok(!byName.has(dbxrefDatasetName(prefix)), prefix);
  }
});
