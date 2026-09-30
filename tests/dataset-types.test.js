import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import * as genome from '../shared/scripts/dataset-types/genome-assembly.js';
import * as rnaseq from '../shared/scripts/dataset-types/bulk-rnaseq.js';
import { readOverrides, validatePresenter, validateDataset } from '../shared/scripts/dataset-types/_common.js';
import { readDatasetClass, CLASSES_RELATIVE_PATH } from '../shared/scripts/lib/dataset-classes.js';
import { extractPresenterName } from '../shared/scripts/lib/presenter-file.js';

const fixtures = new URL('./fixtures/', import.meta.url).pathname;
const proposal = (acc) => join(fixtures, 'proposals', acc);
const presenterOverridesFor = (acc) => {
  const path = join(fixtures, 'overrides', `${acc}.json`);
  return existsSync(path) ? readOverrides(path).presenter : {};
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
  assert.deepEqual(p.history, { genomeSource: 'INSDC', genomeVersion: 'GCA_000001.1', annotationSource: 'GenBank', annotationVersion: 'Apr 1, 2024' });
  assert.deepEqual(p.pubmedIds, ['11111111']);
  assert.equal(p.description, 'Whole genome of Testus fakeus ST-1.');
  assert.match(p.methodology, /^WGS Project: JAAAAA01\. Assembly method: Flye v\. 2\.9\. Genome coverage: 80\.0x\. Sequencing technology: Oxford Nanopore$/);
  assert.deepEqual(p.links.map(l => l.text), ['NCBI Bioproject', 'GenBank Assembly']);
  assert.deepEqual(p.injectorProps, {});
});

test('rnaseq derive applies overrides, merging injectorProps by name', () => {
  const p = rnaseq.derivePresenter(rnaDir, presenterOverridesFor('PRJNA000002'));
  assert.equal(p.name, undefined);
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
    assert.deepEqual(mod.derivePresenter(proposal(acc), presenterOverridesFor(acc)), readJson(join(proposal(acc), 'curated', 'presenter.json')));
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

function overridesFile(t, content) {
  const dir = mkdtempSync(join(tmpdir(), 'overrides-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'o.json');
  writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content));
  return path;
}

test('readOverrides refuses keys it does not know, at every level', (t) => {
  assert.throws(() => readOverrides(overridesFile(t, { nmae: 'x' })), /unknown keys nmae; allowed: name, version, presenter, dataset/);
  assert.throws(() => readOverrides(overridesFile(t, { presenter: { shortDisplayname: 'typo' } })),
    /unknown presenter keys shortDisplayname; allowed: displayName/);
  assert.throws(() => readOverrides(overridesFile(t, { dataset: { prop: {} } })), /unknown dataset keys prop; allowed: props, source/);
});

test('readOverrides names the new shape when given presenter keys at the top', (t) => {
  assert.throws(() => readOverrides(overridesFile(t, { shortDisplayName: 'x' })),
    /shortDisplayName now go under "presenter"/);
});

test('rnaseq deriveIdentity takes the GEO series release date, not the platform one', () => {
  assert.deepEqual(rnaseq.deriveIdentity(rnaDir, { primaryContactName: 'Jane Doe' }), { version: '2024-05-01', name: 'Doe_2024' });
});

test('rnaseq deriveIdentity drops diacritics from the surname and gives up without a series date', (t) => {
  assert.equal(rnaseq.deriveIdentity(rnaDir, { primaryContactName: 'Sébastien Duplessis-Müller' }).name, 'DuplessisMuller_2024');
  const dir = copyOf(t, rnaDir);
  rmSync(join(dir, 'inputs', 'GSE0002_family.xml'));
  assert.deepEqual(rnaseq.deriveIdentity(dir, { primaryContactName: 'Jane Doe' }), { version: undefined, name: undefined });
});

test('rnaseq presenter name follows the rnaSeqExperiment datasetName pattern', () => {
  assert.equal(rnaseq.presenterName(rnaDir), 'tfakST1_Doe_heat_shock_2024_rnaSeq_RSRC');
});

test('rnaseq refuses a manifest without identity', (t) => {
  const dir = copyOf(t, rnaDir);
  const manifestPath = join(dir, 'manifest.json');
  const { datasetClass, name, version, ...rest } = readJson(manifestPath);
  writeFileSync(manifestPath, JSON.stringify(rest));
  assert.throws(() => rnaseq.renderPresenter(dir, { build: '02' }), /needs datasetClass "rnaSeqExperiment", name and version/);
});

test('readOverrides fails clearly on malformed JSON', (t) => {
  assert.throws(() => readOverrides(overridesFile(t, '{ not json')), /o\.json is not valid JSON:/);
});

// --- render (Phase 2) --------------------------------------------------------

for (const [acc, mod] of [['GCA_000001.1', genome], ['PRJNA000002', rnaseq], ['PRJNA000003', rnaseq]]) {
  test(`render(${acc}) matches its golden expected.xml`, () => {
    assert.equal(mod.renderPresenter(proposal(acc), { build: '02' }) + '\n', readFileSync(join(proposal(acc), 'expected.xml'), 'utf-8'));
  });
}

test('render reads only the manifest and presenter.json, never the inputs', (t) => {
  for (const [src, mod] of [[genomeDir, genome], [rnaDir, rnaseq]]) {
    const dir = copyOf(t, src);
    const expected = mod.renderPresenter(dir, { build: '02' });
    rmSync(join(dir, 'inputs'), { recursive: true });
    assert.equal(mod.renderPresenter(dir, { build: '02' }), expected);
  }
});

test('render applies current injector defaults for props the record does not set', (t) => {
  const dir = copyOf(t, rnaDir);
  editPresenter(dir, (p) => ({ ...p, injectorProps: {} }));
  const xml = rnaseq.renderPresenter(dir, { build: '02' });
  assert.match(xml, /<prop name="graphType">bar<\/prop>/);
  assert.match(xml, /<prop name="graphColor">#336699<\/prop>/);
});

test('render takes the build from its caller, not from the proposal', (t) => {
  const dir = copyOf(t, rnaDir);
  assert.match(rnaseq.renderPresenter(dir, { build: '74' }), /<history buildNumber="74"\/>/);
  assert.match(genome.renderPresenter(copyOf(t, genomeDir), { build: '74' }), /<history buildNumber="74"/);
});

test('render refuses to guess a build', (t) => {
  assert.throws(() => rnaseq.renderPresenter(copyOf(t, rnaDir)), /renderPresenter needs a build/);
});

test('render refuses a proposal without presenter.json', (t) => {
  const dir = copyOf(t, rnaDir);
  rmSync(join(dir, 'curated', 'presenter.json'));
  assert.throws(() => rnaseq.renderPresenter(dir, { build: '02' }), /No curated\/presenter\.json in .*; re-run write-proposal\.js/);
});

test('rnaseq render refuses a presenter missing a required field', (t) => {
  const dir = copyOf(t, rnaDir);
  editPresenter(dir, (p) => ({ ...p, shortAttribution: '  ' }));
  assert.throws(() => rnaseq.renderPresenter(dir, { build: '02' }), /shortAttribution is required and is empty/);
});

test('render escapes hostile presenter text', (t) => {
  for (const [src, mod] of [[genomeDir, genome], [rnaDir, rnaseq]]) {
    const dir = copyOf(t, src);
    editPresenter(dir, (p) => ({ ...p, shortAttribution: "O'Brien & co <2024>", summary: 'x ]]> y', injectorProps: { graphType: 'a&b' } }));
    const xml = mod.renderPresenter(dir, { build: '02' });
    assert.match(xml, /O'Brien &amp; co &lt;2024&gt;/);
    assert.match(xml, /x \]\]&gt; y/);
    assert.match(xml, />a&amp;b</);
  }
});

test('extractPresenterName reads the rendered name', () => {
  assert.equal(extractPresenterName(genome.renderPresenter(genomeDir, { build: '02' })), 'tfakST1_primary_genome_RSRC');
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

// --- dataset record ----------------------------------------------------------

const classDef = (() => {
  const repo = mkdtempSync(join(tmpdir(), 'classes-'));
  mkdirSync(join(repo, 'Model/lib/xml/datasetClass'), { recursive: true });
  cpSync(join(fixtures, 'classes.xml'), join(repo, CLASSES_RELATIVE_PATH));
  return readDatasetClass(repo, 'rnaSeqExperiment');
})();

function editJson(path, edit) {
  writeFileSync(path, JSON.stringify(edit(readJson(path))));
}

for (const acc of ['PRJNA000002', 'PRJNA000003']) {
  test(`deriveDataset(${acc}) reproduces its committed dataset.json`, () => {
    assert.deepEqual(rnaseq.deriveDataset(proposal(acc), classDef), readJson(join(proposal(acc), 'curated', 'dataset.json')));
  });
  test(`renderDataset(${acc}) matches its golden expected-dataset.xml`, () => {
    assert.equal(rnaseq.renderDataset(proposal(acc), classDef) + '\n', readFileSync(join(proposal(acc), 'expected-dataset.xml'), 'utf-8'));
  });
}

test('renderDataset reads only the manifest and dataset.json', (t) => {
  const dir = copyOf(t, rnaDir);
  const expected = rnaseq.renderDataset(dir, classDef);
  rmSync(join(dir, 'inputs'), { recursive: true });
  assert.equal(rnaseq.renderDataset(dir, classDef), expected);
});

test('deriveDataset refuses mixed layouts unless the curator decides', (t) => {
  const dir = copyOf(t, rnaDir);
  editJson(join(dir, 'inputs', 'PRJNA000002_sra_metadata.json'), (sra) => {
    sra.runs[1].library_layout = 'SINGLE';
    return sra;
  });
  assert.throws(() => rnaseq.deriveDataset(dir, classDef), /library layouts PAIRED, SINGLE; one experiment needs one layout/);
  assert.equal(rnaseq.deriveDataset(dir, classDef, { props: { hasPairedEnds: 'true' } }).props.hasPairedEnds, 'true');
});

test('deriveDataset refuses unknown strandedness unless the curator decides', (t) => {
  const dir = copyOf(t, rnaDir);
  editJson(join(dir, 'curated', 'PRJNA000002_sample_annotations.json'), (a) => ({ ...a, strandedness: 'unknown' }));
  assert.throws(() => rnaseq.deriveDataset(dir, classDef), /strandedness "unknown"; rnaSeqExperiment needs isStrandSpecific true or false/);
  assert.equal(rnaseq.deriveDataset(dir, classDef, { props: { isStrandSpecific: 'false' } }).props.isStrandSpecific, 'false');
});

test('a server source makes fromSRA false and needs absolute paths', () => {
  const d = rnaseq.deriveDataset(rnaDir, classDef, { source: { type: 'server', paths: ['/data/incoming/x'] } });
  assert.equal(d.props.fromSRA, 'false');
  assert.throws(() => rnaseq.deriveDataset(rnaDir, classDef, { source: { type: 'server', paths: ['relative/x'] } }),
    /source "server" needs paths: a non-empty array of absolute paths/);
  assert.throws(() => rnaseq.deriveDataset(rnaDir, classDef, { source: { type: 'sra' }, props: { fromSRA: 'false' } }),
    /props\.fromSRA must be true when source\.type is "sra"/);
});

test('an sra source needs real run accessions', (t) => {
  const dir = copyOf(t, rnaDir);
  editJson(join(dir, 'inputs', 'PRJNA000002_sra_metadata.json'), (sra) => {
    sra.runs[0].run_accession = 'sample1';
    return sra;
  });
  assert.throws(() => rnaseq.deriveDataset(dir, classDef), /needs SRA\/ENA\/DDBJ run accessions; not: sample1/);
});

test('validateDataset holds the record to the classes.xml props', () => {
  const d = readJson(join(rnaDir, 'curated', 'dataset.json'));
  const { limitNU, ...missing } = d.props;
  assert.deepEqual(validateDataset({ ...d, props: missing }, classDef), ['props.limitNU is required by class rnaSeqExperiment']);
  assert.deepEqual(validateDataset({ ...d, props: { ...d.props, colour: 'red' } }, classDef), ['props.colour is not a prop of class rnaSeqExperiment']);
  assert.deepEqual(validateDataset({ ...d, props: { ...d.props, name: 'x' } }, classDef), ['props.name comes from the manifest and must not be set here']);
  assert.deepEqual(validateDataset({ ...d, source: { type: 'ftp' } }, classDef), ['source.type must be one of sra, server, url']);
});

test('rnaseq renderDataset refuses boolean props that are not true or false', (t) => {
  const dir = copyOf(t, rnaDir);
  editJson(join(dir, 'curated', 'dataset.json'), (d) => ({ ...d, props: { ...d.props, hasPairedEnds: 'yes', limitNU: '40' } }));
  assert.throws(() => rnaseq.renderDataset(dir, classDef), /props\.hasPairedEnds must be "true" or "false"\n  - props\.limitNU must be an integer from 1 to 30/);
});
