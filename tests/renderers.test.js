import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { render as renderGenome } from '../shared/scripts/renderers/genome-assembly.js';
import { render as renderRnaSeq } from '../shared/scripts/renderers/bulk-rnaseq.js';
import { extractPresenterName } from '../shared/scripts/lib/presenter-file.js';

const fixtures = new URL('./fixtures/proposals/', import.meta.url).pathname;
const genomeDir = fixtures + 'GCA_000001.1';
const rnaDir = fixtures + 'PRJNA000002';

/** Copies a fixture proposal dir to a temp location and writes hostile overrides into it. Never mutates committed fixtures. */
function hostileOverridesCopy(t, srcDir, overrides) {
  const tmp = mkdtempSync(join(tmpdir(), 'renderer-hostile-'));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const dest = join(tmp, basename(srcDir));
  cpSync(srcDir, dest, { recursive: true });
  mkdirSync(join(dest, 'curated'), { recursive: true });
  writeFileSync(join(dest, 'curated', 'presenter-overrides.json'), JSON.stringify(overrides));
  return dest;
}

const HOSTILE_OVERRIDES = {
  shortAttribution: "O'Brien & co <2024>",
  summary: 'x ]]> y',
  injectorProps: { graphType: 'a&b' }
};

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

test('genome renderer escapes hostile override text', (t) => {
  const dir = hostileOverridesCopy(t, genomeDir, HOSTILE_OVERRIDES);
  const xml = renderGenome(dir);
  assert.match(xml, /&amp;/);
  assert.match(xml, /&lt;/);
  assert.match(xml, /\]\]&gt;/);
  assert.doesNotMatch(xml, /O'Brien & co <2024>/);
  assert.doesNotMatch(xml, /x \]\]> y/);
  assert.doesNotMatch(xml, />a&b</);
});

test('rnaseq renderer escapes hostile override text', (t) => {
  const dir = hostileOverridesCopy(t, rnaDir, HOSTILE_OVERRIDES);
  const xml = renderRnaSeq(dir);
  assert.match(xml, /&amp;/);
  assert.match(xml, /&lt;/);
  assert.match(xml, /\]\]&gt;/);
  assert.doesNotMatch(xml, /O'Brien & co <2024>/);
  assert.doesNotMatch(xml, /x \]\]> y/);
  assert.doesNotMatch(xml, />a&b</);
});

test('findInputBySuffix throws when more than one file matches', (t) => {
  const tmp = mkdtempSync(join(tmpdir(), 'renderer-dup-'));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const dest = join(tmp, basename(rnaDir));
  cpSync(rnaDir, dest, { recursive: true });
  writeFileSync(join(dest, 'inputs', 'GSE0003_family.xml'), '<x/>');
  assert.throws(() => renderRnaSeq(dest), /Multiple _family\.xml files in .*: GSE0002_family\.xml, GSE0003_family\.xml/);
});

test('bulk-rnaseq render throws a clear error when no run has scientific_name', (t) => {
  const tmp = mkdtempSync(join(tmpdir(), 'renderer-noorganism-'));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const dest = join(tmp, basename(rnaDir));
  cpSync(rnaDir, dest, { recursive: true });
  const sraPath = join(dest, 'inputs', 'PRJNA000002_sra_metadata.json');
  const sra = JSON.parse(readFileSync(sraPath, 'utf-8'));
  sra.runs.forEach(r => { delete r.scientific_name; });
  writeFileSync(sraPath, JSON.stringify(sra));
  assert.throws(() => renderRnaSeq(dest), /No scientific_name in any run of PRJNA000002/);
});

test('readInputJson fails clearly on malformed JSON', (t) => {
  const tmp = mkdtempSync(join(tmpdir(), 'renderer-badjson-'));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const dest = join(tmp, basename(rnaDir));
  cpSync(rnaDir, dest, { recursive: true });
  writeFileSync(join(dest, 'inputs', 'PRJNA000002_sra_metadata.json'), '{ not json');
  assert.throws(() => renderRnaSeq(dest), /PRJNA000002_sra_metadata\.json is not valid JSON:/);
});

test('loadOverrides fails clearly on malformed JSON', (t) => {
  const tmp = mkdtempSync(join(tmpdir(), 'renderer-badoverrides-'));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const dest = join(tmp, basename(rnaDir));
  cpSync(rnaDir, dest, { recursive: true });
  writeFileSync(join(dest, 'curated', 'presenter-overrides.json'), '{ not json');
  assert.throws(() => renderRnaSeq(dest), /presenter-overrides\.json is not valid JSON:/);
});

test('genome renderer throws a clear error when the dataset report has no reports[0]', (t) => {
  const tmp = mkdtempSync(join(tmpdir(), 'renderer-noreport-'));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const dest = join(tmp, basename(genomeDir));
  cpSync(genomeDir, dest, { recursive: true });
  writeFileSync(join(dest, 'inputs', 'GCA_000001.1_dataset_report.json'), JSON.stringify({ reports: [] }));
  assert.throws(() => renderGenome(dest), /GCA_000001\.1_dataset_report\.json has no reports\[0\]/);
});

test('genome renderer rejects an invalid bioproject_accession in the assembly report', (t) => {
  const tmp = mkdtempSync(join(tmpdir(), 'renderer-badbioproject-'));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const dest = join(tmp, basename(genomeDir));
  cpSync(genomeDir, dest, { recursive: true });
  const reportPath = join(dest, 'inputs', 'GCA_000001.1_dataset_report.json');
  const report = JSON.parse(readFileSync(reportPath, 'utf-8'));
  report.reports[0].assembly_info.bioproject_accession = 'PRJNA"000001';
  writeFileSync(reportPath, JSON.stringify(report));
  assert.throws(() => renderGenome(dest), /Invalid bioproject_accession "PRJNA"000001" in assembly report/);
});

test('pubmedIds must be numeric', (t) => {
  const dir = hostileOverridesCopy(t, genomeDir, { pubmedIds: ['not-a-number'] });
  assert.throws(() => renderGenome(dir), /Invalid PubMed id "not-a-number"/);
});

test('injectorProps rejects an invalid prop name', (t) => {
  const dir = hostileOverridesCopy(t, genomeDir, { injectorProps: { '1bad-name': 'x' } });
  assert.throws(() => renderGenome(dir), /Invalid injector prop name "1bad-name"/);
});

for (const [dir, render] of [
  [genomeDir, renderGenome],
  [rnaDir, renderRnaSeq],
  [fixtures + 'PRJNA000002_no_overrides', renderRnaSeq]
]) {
  test(`render(${basename(dir)}) matches its golden expected.xml`, () => {
    const expected = readFileSync(join(dir, 'expected.xml'), 'utf-8');
    assert.equal(render(dir) + '\n', expected);
  });
}
