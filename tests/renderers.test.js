import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render as renderGenome } from '../shared/scripts/renderers/genome-assembly.js';
import { render as renderRnaSeq } from '../shared/scripts/renderers/bulk-rnaseq.js';
import { extractPresenterName } from '../shared/scripts/lib/presenter-file.js';

const fixtures = new URL('./fixtures/proposals/', import.meta.url).pathname;
const genomeDir = fixtures + 'GCA_000001.1';
const rnaDir = fixtures + 'PRJNA000002';

test('genome renderer builds the presenter from manifest and inputs', () => {
  const xml = renderGenome(genomeDir);
  assert.equal(extractPresenterName(xml), 'tfakST1_primary_genome_RSRC');
  assert.match(xml, /<history buildNumber="02"/);
  assert.match(xml, /genomeVersion="GCA_000001\.1"/);
  assert.match(xml, /annotationSource="GenBank" annotationVersion="Apr 1, 2024"/);
  assert.match(xml, /<primaryContactId>jane\.doe<\/primaryContactId>/);
  assert.match(xml, /<contactId>ravi\.kumar<\/contactId>/);
  assert.match(xml, /<pubmedId>11111111<\/pubmedId>/);
  assert.match(xml, /Whole genome of Testus fakeus ST-1\./);
  assert.match(xml, /WGS Project: JAAAAA01\. Assembly method: Flye v\. 2\.9\. Genome coverage: 80\.0x\. Sequencing technology: Oxford Nanopore/);
  assert.match(xml, /templateInjector projectName="FungiDB" className="org\.apidb\.apicommon\.model\.datasetInjector\.AnnotatedGenome"/);
  assert.doesNotMatch(xml, /TODO/);
});

test('genome renderer is deterministic', () => {
  assert.equal(renderGenome(genomeDir), renderGenome(genomeDir));
});

test('rnaseq renderer builds the presenter and applies overrides', () => {
  const xml = renderRnaSeq(rnaDir);
  assert.equal(extractPresenterName(xml), 'tfak_PRJNA000002_rnaSeq_RSRC');
  assert.match(xml, /<datasetPresenter name="tfak_PRJNA000002_rnaSeq_RSRC"\s+projectName="FungiDB">/);
  assert.match(xml, /<shortDisplayName>Heat shock<\/shortDisplayName>/);
  assert.match(xml, /<shortAttribution>Doe et al\.<\/shortAttribution>/);
  assert.match(xml, /<history buildNumber="02"\/>/);
  assert.match(xml, /<pubmedId>22222222<\/pubmedId>/);
  assert.match(xml, /Heat shock response in Testus fakeus\./);
  assert.match(xml, /<prop name="graphType">line<\/prop>/);
  assert.match(xml, /<prop name="hasMultipleSamples">true<\/prop>/);
  assert.match(xml, /<prop name="isDESeq">true<\/prop>/);
  assert.doesNotMatch(xml, /TODO/);
});

test('rnaseq renderer leaves empty elements when no overrides exist', () => {
  const xml = renderRnaSeq(genomeDir.replace('GCA_000001.1', 'PRJNA000002_no_overrides'));
  assert.match(xml, /<shortDisplayName><\/shortDisplayName>/);
});
