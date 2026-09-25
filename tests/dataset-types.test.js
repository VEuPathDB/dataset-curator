import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, cpSync, rmSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import * as genome from '../shared/scripts/dataset-types/genome-assembly.js';
import * as rnaseq from '../shared/scripts/dataset-types/bulk-rnaseq.js';
import { readOverrides, validatePresenter } from '../shared/scripts/dataset-types/_common.js';
import { extractPresenterName } from '../shared/scripts/lib/presenter-file.js';

const fixtures = new URL('./fixtures/', import.meta.url).pathname;
const proposal = (acc) => join(fixtures, 'proposals', acc);
const overridesFor = (acc) => {
  const path = join(fixtures, 'overrides', `${acc}.json`);
  return existsSync(path) ? readOverrides(path) : {};
};
const genomeDir = proposal('GCA_000001.1');
const rnaDir = proposal('PRJNA000002');
const readJson = (path) => JSON.parse(readFileSync(path, 'utf-8'));

/** A throwaway copy of a fixture proposal, so tests can damage it freely. */
function copyOf(t, srcDir) {
  const tmp = mkdtempSync(join(tmpdir(), 'renderer-'));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const dest = join(tmp, basename(srcDir));
  cpSync(srcDir, dest, { recursive: true });
  return dest;
}

function editPresenter(dir, edit) {
  const path = join(dir, 'curated', 'presenter.json');
  writeFileSync(path, JSON.stringify(edit(readJson(path))));
}

// --- derive (Phase 1) --------------------------------------------------------

test('genome derive builds the presenter record from manifest and inputs', () => {
  const p = genome.derivePresenter(genomeDir);
  assert.equal(p.name, 'tfakST1_primary_genome_RSRC');
  assert.deepEqual(p.history, { genomeSource: 'INSDC', genomeVersion: 'GCA_000001.1', annotationSource: 'GenBank', annotationVersion: 'Apr 1, 2024' });
  assert.deepEqual(p.pubmedIds, ['11111111']);
  assert.equal(p.description, 'Whole genome of Testus fakeus ST-1.');
  assert.match(p.methodology, /^WGS Project: JAAAAA01\. Assembly method: Flye v\. 2\.9\. Genome coverage: 80\.0x\. Sequencing technology: Oxford Nanopore$/);
  assert.deepEqual(p.links.map(l => l.text), ['NCBI Bioproject', 'GenBank Assembly']);
  assert.deepEqual(p.injectorProps, {});
});

test('rnaseq derive applies overrides, merging injectorProps by name', () => {
  const p = rnaseq.derivePresenter(rnaDir, overridesFor('PRJNA000002'));
  assert.equal(p.name, 'tfak_PRJNA000002_rnaSeq_RSRC');
  assert.equal(p.shortDisplayName, 'Heat shock');
  assert.deepEqual(p.pubmedIds, ['22222222']);
  assert.deepEqual(p.injectorProps, { hasMultipleSamples: 'true', isDESeq: 'true', graphType: 'line' });
});

test('rnaseq derive without overrides leaves the required short fields empty', () => {
  const p = rnaseq.derivePresenter(proposal('PRJNA000003'));
  assert.deepEqual(validatePresenter(p, { requiredFields: rnaseq.requiredFields }), [
    'shortDisplayName is required and is empty',
    'shortAttribution is required and is empty'
  ]);
});

for (const [acc, mod] of [['GCA_000001.1', genome], ['PRJNA000002', rnaseq], ['PRJNA000003', rnaseq]]) {
  test(`derive(${acc}) reproduces its committed presenter.json`, () => {
    assert.deepEqual(mod.derivePresenter(proposal(acc), overridesFor(acc)), readJson(join(proposal(acc), 'curated', 'presenter.json')));
  });
}

test('findInputBySuffix throws when more than one file matches', (t) => {
  const dir = copyOf(t, rnaDir);
  writeFileSync(join(dir, 'inputs', 'GSE0003_family.xml'), '<x/>');
  assert.throws(() => rnaseq.derivePresenter(dir), /Multiple _family\.xml files in .*: GSE0002_family\.xml, GSE0003_family\.xml/);
});

test('rnaseq derive throws a clear error when no run has scientific_name', (t) => {
  const dir = copyOf(t, rnaDir);
  const sraPath = join(dir, 'inputs', 'PRJNA000002_sra_metadata.json');
  const sra = readJson(sraPath);
  sra.runs.forEach(r => { delete r.scientific_name; });
  writeFileSync(sraPath, JSON.stringify(sra));
  assert.throws(() => rnaseq.derivePresenter(dir), /No scientific_name in any run of PRJNA000002/);
});

test('readInputJson fails clearly on malformed JSON', (t) => {
  const dir = copyOf(t, rnaDir);
  writeFileSync(join(dir, 'inputs', 'PRJNA000002_sra_metadata.json'), '{ not json');
  assert.throws(() => rnaseq.derivePresenter(dir), /PRJNA000002_sra_metadata\.json is not valid JSON:/);
});

test('genome derive throws a clear error when the dataset report has no reports[0]', (t) => {
  const dir = copyOf(t, genomeDir);
  writeFileSync(join(dir, 'inputs', 'GCA_000001.1_dataset_report.json'), JSON.stringify({ reports: [] }));
  assert.throws(() => genome.derivePresenter(dir), /GCA_000001\.1_dataset_report\.json has no reports\[0\]/);
});

test('genome derive rejects an invalid bioproject_accession in the assembly report', (t) => {
  const dir = copyOf(t, genomeDir);
  const reportPath = join(dir, 'inputs', 'GCA_000001.1_dataset_report.json');
  const report = readJson(reportPath);
  report.reports[0].assembly_info.bioproject_accession = 'PRJNA"000001';
  writeFileSync(reportPath, JSON.stringify(report));
  assert.throws(() => genome.derivePresenter(dir), /Invalid bioproject_accession "PRJNA"000001" in assembly report/);
});

// --- overrides ---------------------------------------------------------------

test('readOverrides refuses keys it does not know', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'overrides-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'o.json');
  writeFileSync(path, JSON.stringify({ shortDisplayname: 'typo' }));
  assert.throws(() => readOverrides(path), /unknown keys shortDisplayname; allowed: displayName/);
});

test('readOverrides fails clearly on malformed JSON', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'overrides-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'o.json');
  writeFileSync(path, '{ not json');
  assert.throws(() => readOverrides(path), /o\.json is not valid JSON:/);
});

// --- render (Phase 2) --------------------------------------------------------

for (const [acc, mod] of [['GCA_000001.1', genome], ['PRJNA000002', rnaseq], ['PRJNA000003', rnaseq]]) {
  test(`render(${acc}) matches its golden expected.xml`, () => {
    assert.equal(mod.renderPresenter(proposal(acc)) + '\n', readFileSync(join(proposal(acc), 'expected.xml'), 'utf-8'));
  });
}

test('render reads only the manifest and presenter.json, never the inputs', (t) => {
  for (const [src, mod] of [[genomeDir, genome], [rnaDir, rnaseq]]) {
    const dir = copyOf(t, src);
    const expected = mod.renderPresenter(dir);
    rmSync(join(dir, 'inputs'), { recursive: true });
    assert.equal(mod.renderPresenter(dir), expected);
  }
});

test('render applies current injector defaults for props the record does not set', (t) => {
  const dir = copyOf(t, rnaDir);
  editPresenter(dir, (p) => ({ ...p, injectorProps: {} }));
  const xml = rnaseq.renderPresenter(dir);
  assert.match(xml, /<prop name="graphType">bar<\/prop>/);
  assert.match(xml, /<prop name="graphColor">#336699<\/prop>/);
});

test('render takes the build from the manifest, not the presenter record', (t) => {
  const dir = copyOf(t, rnaDir);
  const manifestPath = join(dir, 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify({ ...readJson(manifestPath), targetBuild: '74' }));
  assert.match(rnaseq.renderPresenter(dir), /<history buildNumber="74"\/>/);
});

test('render refuses a proposal without presenter.json', (t) => {
  const dir = copyOf(t, rnaDir);
  rmSync(join(dir, 'curated', 'presenter.json'));
  assert.throws(() => rnaseq.renderPresenter(dir), /No curated\/presenter\.json in .*; re-run write-proposal\.js/);
});

test('rnaseq render refuses a presenter missing a required field', (t) => {
  const dir = copyOf(t, rnaDir);
  editPresenter(dir, (p) => ({ ...p, shortAttribution: '  ' }));
  assert.throws(() => rnaseq.renderPresenter(dir), /shortAttribution is required and is empty/);
});

test('render escapes hostile presenter text', (t) => {
  for (const [src, mod] of [[genomeDir, genome], [rnaDir, rnaseq]]) {
    const dir = copyOf(t, src);
    editPresenter(dir, (p) => ({ ...p, shortAttribution: "O'Brien & co <2024>", summary: 'x ]]> y', injectorProps: { graphType: 'a&b' } }));
    const xml = mod.renderPresenter(dir);
    assert.match(xml, /O'Brien &amp; co &lt;2024&gt;/);
    assert.match(xml, /x \]\]&gt; y/);
    assert.match(xml, />a&amp;b</);
  }
});

test('extractPresenterName reads the rendered name', () => {
  assert.equal(extractPresenterName(genome.renderPresenter(genomeDir)), 'tfakST1_primary_genome_RSRC');
});

// --- validatePresenter -------------------------------------------------------

test('validatePresenter rejects bad pubmed ids, links and prop names', () => {
  const p = readJson(join(rnaDir, 'curated', 'presenter.json'));
  assert.deepEqual(validatePresenter({ ...p, pubmedIds: ['not-a-number'] }), ['pubmedIds must be an array of numeric strings']);
  assert.deepEqual(validatePresenter({ ...p, links: [{ text: 'x', url: 'javascript:alert(1)' }] }), ['links must be an array of { text, url } with http(s) URLs']);
  assert.deepEqual(validatePresenter({ ...p, injectorProps: { '1bad-name': 'x' } }), ['injectorProps has an invalid name "1bad-name"']);
  assert.deepEqual(validatePresenter({ ...p, injectorProps: { graphType: 3 } }), ['injectorProps must be an object of string values']);
  assert.deepEqual(validatePresenter({ ...p, schemaVersion: 2 }), ['schemaVersion must be 1']);
});
