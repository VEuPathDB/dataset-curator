import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync, existsSync, renameSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import * as genome from '../shared/scripts/dataset-types/genome-assembly.js';
import * as rnaseq from '../shared/scripts/dataset-types/bulk-rnaseq.js';
import { readOverrides, validatePresenter, validateDataset } from '../shared/scripts/dataset-types/_common.js';
import { readDatasetClass, CLASSES_RELATIVE_PATH } from '../shared/scripts/lib/dataset-classes.js';
import { extractPresenterName } from '../shared/scripts/lib/presenter-file.js';
import { handoffNote } from '../shared/scripts/lib/artifacts.js';
import { loaded, alignTo } from './helpers.js';

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
  assert.deepEqual(p.injectorProps, { hasMultipleSamples: 'true', isDESeq: 'false', graphXAxisSamplesDescription: 'condition', graphType: 'line' });
});

test('rnaseq derive sets isDESeq only when samples share a label, i.e. have biological replicates', (t) => {
  const dir = copyOf(t, rnaDir);
  const path = join(dir, 'curated', 'PRJNA000002_sample_annotations.json');
  const withLabels = (...labels) => {
    const a = readJson(path);
    writeFileSync(path, JSON.stringify({ ...a, samples: labels.map((label, i) => ({ ...a.samples[0], sampleId: `S${i}`, label })) }));
    return rnaseq.derivePresenter(dir).injectorProps;
  };
  assert.deepEqual([withLabels('Control', 'Control', 'Stressed').isDESeq, withLabels('Control', 'Stressed').isDESeq], ['true', 'false']);
  assert.deepEqual([withLabels('Control', 'Stressed').hasMultipleSamples, withLabels('Control').hasMultipleSamples], ['true', 'false']);
});

/** A host+parasite copy: two host-only Control samples and one Stressed sample aligned to both. */
function controlsToHost(t) {
  const dir = copyOf(t, rnaDir);
  alignTo(dir, [{ abbrev: 'tfakST1' }, { abbrev: 'hfakH1', project: 'HostDB' }], { SAMN1: ['hfakH1'], SAMN2: ['tfakST1', 'hfakH1'] });
  const path = join(dir, 'curated', 'PRJNA000002_sample_annotations.json');
  const a = readJson(path);
  const [control, stressed] = a.samples;
  writeFileSync(path, JSON.stringify({ ...a, samples: [control, { ...control, sampleId: 'SAMN3', runs: ['SRR3'] }, stressed] }));
  return dir;
}

test('rnaseq derive gives an organism its own sample flags where they differ from all samples', (t) => {
  const p = rnaseq.derivePresenter(controlsToHost(t));
  assert.deepEqual(p.injectorProps, { hasMultipleSamples: 'true', isDESeq: 'true', graphXAxisSamplesDescription: 'condition' });
  assert.deepEqual(p.organisms, { tfakST1: { injectorProps: { hasMultipleSamples: 'false', isDESeq: 'false' } } });
});

test('a curator override of one organism prop keeps that organism\'s other derived props', (t) => {
  const p = rnaseq.derivePresenter(controlsToHost(t), { organisms: { tfakST1: { injectorProps: { isDESeq: 'true' } }, hfakH1: { injectorProps: { graphType: 'line' } } } });
  assert.deepEqual(p.organisms, {
    tfakST1: { injectorProps: { hasMultipleSamples: 'false', isDESeq: 'true' } },
    hfakH1: { injectorProps: { graphType: 'line' } }
  });
});

test('rnaseq derive omits organisms when every organism has the same samples', (t) => {
  const dir = copyOf(t, rnaDir);
  alignTo(dir, [{ abbrev: 'tfakST1' }, { abbrev: 'hfakH1', project: 'HostDB' }], { SAMN1: ['tfakST1', 'hfakH1'], SAMN2: ['tfakST1', 'hfakH1'] });
  assert.equal('organisms' in rnaseq.derivePresenter(dir), false);
});

test('rnaseq derive names the home organism\'s species when runs differ by species', (t) => {
  const dir = copyOf(t, rnaDir);
  alignTo(dir, [{ abbrev: 'tfakST1' }, { abbrev: 'hfakH1', project: 'HostDB' }], { SAMN1: ['hfakH1'], SAMN2: ['tfakST1', 'hfakH1'] });
  const sraPath = join(dir, 'inputs', 'PRJNA000002_sra_metadata.json');
  const sra = readJson(sraPath);
  writeFileSync(sraPath, JSON.stringify({ ...sra, runs: sra.runs.map((r) => (r.run_accession === 'SRR1' ? { ...r, scientific_name: 'Hostus fakeus' } : r)) }));
  const p = rnaseq.derivePresenter(dir);
  assert.equal(p.displayName, 'RNA-Seq analysis of <i>Testus fakeus</i>');
  assert.equal(p.summary, p.displayName);
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
  assert.throws(() => readOverrides(overridesFile(t, { nmae: 'x' })), /unknown keys nmae; allowed: name, version, presenter, dataset, organism$/);
  assert.throws(() => readOverrides(overridesFile(t, { presenter: { shortDisplayname: 'typo' } })),
    /unknown presenter keys shortDisplayname; allowed: displayName/);
  assert.throws(() => readOverrides(overridesFile(t, { dataset: { prop: {} } })), /unknown dataset keys prop; allowed: props, source/);
  assert.throws(() => readOverrides(overridesFile(t, { organism: { taxon: '1' } })), /unknown organism keys taxon; allowed: species, strain, ncbiTaxonId/);
  assert.throws(() => readOverrides(overridesFile(t, { organism: 'Testus fakeus' })), /"organism" must be an object/);
});

test('genome deriveOrganism reads species, strain and taxon id from the assembly report; overrides win', () => {
  const inputs = [join(genomeDir, 'inputs', 'GCA_000001.1_dataset_report.json')];
  assert.deepEqual(genome.deriveOrganism(inputs, 'GCA_000001.1'), { species: 'Testus fakeus', strain: 'ST-1', ncbiTaxonId: '999001' });
  assert.deepEqual(genome.deriveOrganism(inputs, 'GCA_000001.1', { strain: 'ST 1', ncbiTaxonId: '42' }),
    { species: 'Testus fakeus', strain: 'ST 1', ncbiTaxonId: '42' });
  assert.deepEqual(genome.deriveOrganism([], 'GCA_000001.1'), { species: '', strain: '' });
  assert.equal(genome.deriveOrganism(inputs, 'GCA_000001.1', { ncbiTaxonId: 42 }).ncbiTaxonId, '42');
});

test('genome deriveOrganism takes the strain from overrides, then the report strain, then its isolate, then none', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'derive-strain-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const report = join(dir, 'GCA_000001.1_dataset_report.json');
  const strainOf = (names, overrides) => {
    writeFileSync(report, JSON.stringify({ reports: [{ organism: { organism_name: 'Testus fakeus', infraspecific_names: names } }] }));
    const warnings = [];
    return [genome.deriveOrganism([report], 'GCA_000001.1', overrides, (m) => warnings.push(m)).strain, warnings.length];
  };
  assert.deepEqual(strainOf({ strain: 'ST-1', isolate: 'I1' }, { strain: 'X' }), ['X', 0]);
  assert.deepEqual(strainOf({ strain: 'ST-1', isolate: 'I1' }), ['ST-1', 0]);
  assert.deepEqual(strainOf({ isolate: 'I1' }), ['I1', 1]);
  assert.deepEqual(strainOf({ isolate: 'I1' }, { strain: '' }), ['', 0]);
  assert.deepEqual(strainOf(undefined), ['', 0]);
});

test('genome deriveOrganism names a malformed assembly report', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'derive-organism-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const report = join(dir, 'GCA_000001.1_dataset_report.json');
  writeFileSync(report, '{ not json');
  assert.throws(() => genome.deriveOrganism([report], 'GCA_000001.1'), (e) => e.message.startsWith(`${report} is not valid JSON`));
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
  assert.deepEqual(rnaseq.presenterNames(rnaDir), ['tfakST1_Doe_heat_shock_2024_rnaSeq_RSRC']);
});

test('a multi-organism rnaseq proposal has one presenter with an injector per organism', (t) => {
  const dir = copyOf(t, rnaDir);
  alignTo(dir, [{ abbrev: 'tfakST1' }, { abbrev: 'hfakH1', project: 'HostDB' }], { SAMN1: ['hfakH1'], SAMN2: ['tfakST1', 'hfakH1'] });
  editPresenter(dir, (p) => ({ ...p, organisms: { hfakH1: { injectorProps: { isDESeq: 'true', switchStrandsProfiles: 'true' } } } }));
  assert.deepEqual(rnaseq.presenterNames(dir), ['Doe_heat_shock_2024_rnaSeq_RSRC']);
  const xml = rnaseq.renderPresenter(dir, { build: '02' });
  assert.match(xml, /^  <datasetPresenter name="Doe_heat_shock_2024_rnaSeq_RSRC"\n\s+datasetNamePattern="%_Doe_heat_shock_2024_rnaSeq_RSRC">/);
  assert.doesNotMatch(xml.split('\n')[0] + xml.split('\n')[1], /projectName=/);
  const injectors = [...xml.matchAll(/<templateInjector ([^>]*)>([\s\S]*?)<\/templateInjector>/g)];
  assert.deepEqual(injectors.map((i) => i[1]), [
    'projectName="FungiDB" datasourceName="tfakST1_Doe_heat_shock_2024_rnaSeq_RSRC" className="org.apidb.apicommon.model.datasetInjector.RNASeq"',
    'projectName="HostDB" datasourceName="hfakH1_Doe_heat_shock_2024_rnaSeq_RSRC" className="org.apidb.apicommon.model.datasetInjector.RNASeq"'
  ]);
  assert.match(injectors[0][2], /<prop name="isDESeq">false<\/prop>/);
  assert.match(injectors[0][2], /<prop name="graphType">line<\/prop>/);
  assert.match(injectors[1][2], /<prop name="isDESeq">true<\/prop>/);
  assert.match(injectors[1][2], /<prop name="switchStrandsProfiles">true<\/prop>/);
  assert.match(injectors[1][2], /<prop name="graphType">line<\/prop>/);
});

test('rnaseq refuses per-organism injector props for an organism the proposal does not have', (t) => {
  const dir = copyOf(t, rnaDir);
  editPresenter(dir, (p) => ({ ...p, organisms: { hfakH1: { injectorProps: { isDESeq: 'true' } } } }));
  assert.throws(() => rnaseq.renderPresenter(dir, { build: '02' }), /presenter\.json organisms names hfakH1, which is not an organism of PRJNA000002/);
});

test('a multi-organism presenter uses settled abbreviations in datasourceName', (t) => {
  const dir = copyOf(t, rnaDir);
  alignTo(dir, [{ abbrev: 'tfakST1' }, { abbrev: 'hfakH1', project: 'HostDB' }], { SAMN1: ['hfakH1'], SAMN2: ['tfakST1', 'hfakH1'] });
  const path = join(dir, 'manifest.json');
  const m = readJson(path);
  writeFileSync(path, JSON.stringify({ ...m, organisms: m.organisms.map((o, i) => ({ ...o, organismAbbrev: i ? 'hfakREF' : o.proposedOrganismAbbrev })) }));
  assert.match(rnaseq.renderPresenter(dir, { build: '02' }), /datasourceName="hfakREF_Doe_heat_shock_2024_rnaSeq_RSRC"/);
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
  editPresenter(dir, (p) => ({ ...p, injectorProps: { graphXAxisSamplesDescription: 'condition' } }));
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
    editPresenter(dir, (p) => ({ ...p, shortAttribution: "O'Brien & co <2024>", summary: 'x ]]> y', injectorProps: { graphType: 'a&b', graphXAxisSamplesDescription: 'x' } }));
    const xml = mod.renderPresenter(dir, { build: '02' });
    assert.match(xml, /O'Brien &amp; co &lt;2024&gt;/);
    assert.match(xml, /x \]\]&gt; y/);
    assert.match(xml, />a&amp;b</);
  }
});

test('extractPresenterName reads the rendered name', () => {
  assert.equal(extractPresenterName(genome.renderPresenter(genomeDir, { build: '02' })), 'tfakST-1_primary_genome_RSRC');
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

/** Replaces a copy's samples with curator-named files. */
function withFileSamples(dir, samples = [
  { sampleId: 'a', label: 'A', files: [{ fastq_1: 'a1.fq.gz', fastq_2: 'a2.fq.gz' }] },
  { sampleId: 'b', label: 'B', files: [{ fastq_1: 'b1.fq.gz', fastq_2: 'b2.fq.gz' }] }
]) {
  const path = join(dir, 'curated', 'PRJNA000002_sample_annotations.json');
  writeFileSync(path, JSON.stringify({ ...readJson(path), samples }));
}

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

test('a server source makes fromSRA false and needs absolute paths', (t) => {
  const dir = copyOf(t, rnaDir);
  withFileSamples(dir);
  const d = rnaseq.deriveDataset(dir, classDef, { source: { type: 'server', paths: ['/data/incoming/x'] } });
  assert.equal(d.props.fromSRA, 'false');
  assert.throws(() => rnaseq.deriveDataset(dir, classDef, { source: { type: 'server', paths: ['relative/x'] } }),
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

const run = (id, sample, title) => ({ run_accession: id, sample_accession: sample, ...(title ? { sample_title: title } : {}) });

test('normalizeSamples names samples by their SRA title when every title is present and unique', () => {
  const runs = [run('SRR1', 'SAMN1', 'Pycnia replicate 1'), run('SRR2', 'SAMN2', 'Pycnia_replicate_2'), run('SRR3', 'SAMN3', 'Aecia_rep1')];
  const out = rnaseq.normalizeSamples({ samples: [{ runs: ['SRR1'] }, { runs: ['SRR2'] }, { runs: ['SRR3'] }] }, runs);
  assert.deepEqual(out.samples.map((s) => [s.sampleId, s.biosample, s.label]), [
    ['Pycnia_replicate_1', 'SAMN1', 'Pycnia'],
    ['Pycnia_replicate_2', 'SAMN2', 'Pycnia'],
    ['Aecia_rep1', 'SAMN3', 'Aecia']
  ]);
});

test('normalizeSamples falls back to the BioSample accession when titles are missing or collide', () => {
  const collide = [run('SRR1', 'SAMN1', 'Liver'), run('SRR2', 'SAMN2', 'Liver')];
  const out = rnaseq.normalizeSamples({ samples: [{ runs: ['SRR1'] }, { runs: ['SRR2'] }] }, collide);
  assert.deepEqual(out.samples.map((s) => [s.sampleId, s.label]), [['SAMN1', 'Liver'], ['SAMN2', 'Liver']]);
  const missing = rnaseq.normalizeSamples({ samples: [{ runs: ['SRR1'] }, { runs: ['SRR2'] }] }, [run('SRR1', 'SAMN1', 'A'), run('SRR2', 'SAMN2')]);
  assert.deepEqual(missing.samples.map((s) => [s.sampleId, s.label]), [['SAMN1', 'A'], ['SAMN2', 'SAMN2']]);
});

test('normalizeSamples gives replicates a shared title-derived label when ids fall back to BioSamples', () => {
  const runs = [run('SRR1', 'SAMN1', 'WT'), run('SRR2', 'SAMN2', 'WT'), run('SRR3', 'SAMN3', 'KO rep1')];
  const out = rnaseq.normalizeSamples({ samples: [{ runs: ['SRR1'] }, { runs: ['SRR2'] }, { runs: ['SRR3'] }] }, runs);
  assert.deepEqual(out.samples.map((s) => [s.sampleId, s.label]), [['SAMN1', 'WT'], ['SAMN2', 'WT'], ['SAMN3', 'KO']]);
});

test('normalizeSamples keeps a sampleId and label the curator chose', () => {
  const out = rnaseq.normalizeSamples({ samples: [{ sampleId: 'ctl_1', label: 'Control', runs: ['SRR1'] }] }, [run('SRR1', 'SAMN1', 'x')]);
  assert.deepEqual(out.samples[0], { sampleId: 'ctl_1', label: 'Control', runs: ['SRR1'], biosample: 'SAMN1' });
});

test('normalizeSamples refuses what the three files cannot share', () => {
  const runs = [run('SRR1', 'SAMN1'), run('SRR2', 'SAMN2')];
  assert.throws(() => rnaseq.normalizeSamples({ samples: [{ runs: ['SRR9'] }] }, runs), /run SRR9 is not in the SRA metadata/);
  assert.throws(() => rnaseq.normalizeSamples({ samples: [{ runs: ['SRR1', 'SRR2'] }] }, runs), /its runs come from 2 BioSamples \(SAMN1, SAMN2\); one sample needs exactly one/);
  assert.throws(() => rnaseq.normalizeSamples({ samples: [{ sampleId: 'a b', runs: ['SRR1'] }] }, runs), /sampleId "a b" may contain only letters, digits, _, \. and -/);
  assert.throws(() => rnaseq.normalizeSamples({ samples: [{ sampleId: 'x', runs: ['SRR1'] }, { sampleId: 'x', runs: ['SRR2'] }] }, runs), /sampleId "x" is used twice/);
});

test('normalizeSamples exempts curator sampleIds from the title rule', () => {
  const runs = [run('SRR1', 'SAMN1'), run('SRR2', 'SAMN2', 'Liver'), run('SRR3', 'SAMN3', 'Brain')];
  const out = rnaseq.normalizeSamples({ samples: [{ sampleId: 'ctl_1', runs: ['SRR1'] }, { runs: ['SRR2'] }, { runs: ['SRR3'] }] }, runs);
  assert.deepEqual(out.samples.map((s) => s.sampleId), ['ctl_1', 'Liver', 'Brain']);
  const clash = rnaseq.normalizeSamples({ samples: [{ sampleId: 'Liver', runs: ['SRR1'] }, { runs: ['SRR2'] }, { runs: ['SRR3'] }] }, runs);
  assert.deepEqual(clash.samples.map((s) => s.sampleId), ['Liver', 'SAMN2', 'SAMN3']);
});

test('normalizeSamples refuses a sample with no runs and names it by position when nothing else does', () => {
  assert.throws(() => rnaseq.normalizeSamples({ samples: [{ sampleId: 'a', runs: [] }] }, []), /Sample a: lists no runs/);
  assert.throws(() => rnaseq.normalizeSamples({ samples: [{}] }, []), /Sample sample #1: lists no runs/);
});

test('normalizeSamples falls back to the BioSample when a title leaves no id, keeping the title as label', () => {
  const runs = [run('SRR1', 'SAMN1', '!!!'), run('SRR2', 'SAMN2', '!!!'), run('SRR3', 'SAMN3', '  ')];
  const out = rnaseq.normalizeSamples({ samples: [{ runs: ['SRR1'] }, { runs: ['SRR2'] }, { runs: ['SRR3'] }] }, runs);
  assert.deepEqual(out.samples.map((s) => [s.sampleId, s.label]), [['SAMN1', '!!!'], ['SAMN2', '!!!'], ['SAMN3', 'SAMN3']]);
});

test('normalizeSamples refuses a curator label with a pipe, for SRA and file samples alike', () => {
  assert.throws(() => rnaseq.normalizeSamples({ samples: [{ sampleId: 'a', label: 'WT|heat', runs: ['SRR1'] }] }, [run('SRR1', 'SAMN1')]),
    /Sample a: label "WT\|heat" may not contain \|/);
  assert.throws(() => rnaseq.normalizeSamples({ samples: [{ sampleId: 'b', label: 'KO|cold', files: [{ fastq_1: 'b.fq.gz' }] }] }, [],
    { source: { type: 'server', paths: ['/data'] } }), /Sample b: label "KO\|cold" may not contain \|/);
});

test('normalizeSamples trims a curator label, for SRA and file samples alike', () => {
  const sra = rnaseq.normalizeSamples({ samples: [{ sampleId: 'a', label: '  Wild  type ', runs: ['SRR1'] }] }, [run('SRR1', 'SAMN1')]);
  const files = rnaseq.normalizeSamples({ samples: [{ sampleId: 'b', label: ' KO\t', files: [{ fastq_1: 'b.fq.gz' }] }] }, [],
    { source: { type: 'server', paths: ['/data'] } });
  assert.deepEqual([sra.samples[0].label, files.samples[0].label], ['Wild  type', 'KO']);
});

test('normalizeSamples treats a blank curator label as absent, for SRA and file samples alike', () => {
  const sra = rnaseq.normalizeSamples({ samples: [{ label: '  ', runs: ['SRR1'] }, { sampleId: 'x', label: '', runs: ['SRR2'] }] },
    [run('SRR1', 'SAMN1', 'WT rep1'), run('SRR2', 'SAMN2')]);
  assert.deepEqual(sra.samples.map((s) => s.label), ['WT', 'x']);
  const files = rnaseq.normalizeSamples({ samples: [{ sampleId: 'b', label: ' \t', files: [{ fastq_1: 'b.fq.gz' }] }] }, [],
    { source: { type: 'server', paths: ['/data'] } });
  assert.equal(files.samples[0].label, 'b');
});

test('deriveArtifacts treats a dataset.json without a source as SRA', (t) => {
  const dir = copyOf(t, rnaDir);
  editJson(join(dir, 'curated', 'dataset.json'), ({ source, ...d }) => d);
  assert.match(rnaseq.deriveArtifacts(dir)['tfakST1/entity-sample.tsv'].split('\n')[0], /\tSRA\.ID\.s\.\t/);
});

test('normalizeSamples drops pipes from a title-derived label', () => {
  const runs = [run('SRR1', 'SAMN1', 'WT | heat rep1'), run('SRR2', 'SAMN2', 'WT|heat_rep2'), run('SRR3', 'SAMN3', '|')];
  const out = rnaseq.normalizeSamples({ samples: [{ runs: ['SRR1'] }, { runs: ['SRR2'] }, { runs: ['SRR3'] }] }, runs);
  assert.deepEqual(out.samples.map((s) => s.label), ['WT heat', 'WT heat', 'SAMN3']);
});

test('normalizeSamples keeps the raw title when stripping the replicate suffix empties it', () => {
  const out = rnaseq.normalizeSamples({ samples: [{ runs: ['SRR1'] }] }, [run('SRR1', 'SAMN1', ' R1')]);
  assert.deepEqual([out.samples[0].sampleId, out.samples[0].label], ['R1', 'R1']);
});

test('rnaseq derive drafts the x-axis description from the factor display names', (t) => {
  const dir = copyOf(t, rnaDir);
  const path = join(dir, 'curated', 'PRJNA000002_sample_annotations.json');
  const a = readJson(path);
  writeFileSync(path, JSON.stringify({ ...a, factors: { ...a.factors, time: { displayName: 'time point' } } }));
  assert.equal(rnaseq.derivePresenter(dir).injectorProps.graphXAxisSamplesDescription, 'condition, time point');
});

test('rnaseq refuses an empty x-axis description', (t) => {
  const dir = copyOf(t, rnaDir);
  editPresenter(dir, (p) => ({ ...p, injectorProps: { ...p.injectorProps, graphXAxisSamplesDescription: ' ' } }));
  assert.throws(() => rnaseq.renderPresenter(dir, { build: '02' }), /injectorProps\.graphXAxisSamplesDescription is required and is empty/);
});

test('normalizeSamples with a server source takes curator-named files and needs a sampleId', () => {
  const server = { source: { type: 'server', paths: ['/data'] } };
  const out = rnaseq.normalizeSamples({ samples: [{ sampleId: 'a', files: [{ fastq_1: 'a.fq.gz' }] }] }, [], server);
  assert.deepEqual(out.samples[0], { sampleId: 'a', files: [{ fastq_1: 'a.fq.gz' }], label: 'a' });
  const n = (samples, runs = [], opts = server) => () => rnaseq.normalizeSamples({ samples }, runs, opts);
  assert.throws(n([{ files: [{ fastq_1: 'a.fq.gz' }] }]), /reads not in SRA need a sampleId from the curator/);
  assert.throws(n([{ sampleId: 'a', runs: ['SRR1'] }]), /a server or url source lists files, not runs/);
  assert.throws(n([{ sampleId: 'a', files: [] }]), /files must list at least one \{ fastq_1, fastq_2 \}/);
  assert.throws(n([{ sampleId: 'a', files: [{ fastq_2: 'b.fq.gz' }] }]), /every files entry needs fastq_1/);
  assert.throws(n([{ sampleId: 'a', files: [{ fastq_1: '/data/a.fq.gz' }] }]), /fastq_1 "\/data\/a\.fq\.gz" must be a bare file name: no directory, spaces or commas/);
  assert.throws(n([{ sampleId: 'a', files: [{ fastq_1: 'a,b.fq.gz' }] }]), /fastq_1 "a,b\.fq\.gz" must be a bare file name: no directory, spaces or commas/);
  assert.throws(n([{ sampleId: 'a', files: [{ fastq_1: 'x.fq.gz', fastq_2: 'x.fq.gz' }] }]), /Sample a: file "x\.fq\.gz" is listed twice/);
  assert.throws(n([{ sampleId: 'a', files: [{ fastq_1: 'x.fq.gz' }] }, { sampleId: 'b', files: [{ fastq_1: 'x.fq.gz' }] }]),
    /Sample b: file "x\.fq\.gz" is listed twice/);
  assert.throws(n([{ sampleId: 'a', runs: ['SRR1'], files: [{ fastq_1: 'x' }] }], [{ run_accession: 'SRR1', sample_accession: 'SAMN1' }], {}),
    /an sra source lists runs, not files/);
});

test('deriveDataset takes the layout from curator-named files and refuses a mix', (t) => {
  const dir = copyOf(t, rnaDir);
  const path = join(dir, 'curated', 'PRJNA000002_sample_annotations.json');
  const withFiles = (files) => writeFileSync(path, JSON.stringify({
    ...readJson(path), samples: [{ sampleId: 'a', label: 'A', files }, { sampleId: 'b', label: 'B', files: [{ fastq_1: 'b1.fq.gz', fastq_2: 'b2.fq.gz' }] }]
  }));
  const server = { source: { type: 'server', paths: ['/data/doe'] } };
  withFiles([{ fastq_1: 'a1.fq.gz', fastq_2: 'a2.fq.gz' }]);
  assert.equal(rnaseq.deriveDataset(dir, classDef, server).props.hasPairedEnds, 'true');
  withFiles([{ fastq_1: 'a1.fq.gz' }]);
  assert.throws(() => rnaseq.deriveDataset(dir, classDef, server), /Sample files of PRJNA000002 mix paired and single entries; one experiment needs one layout/);
  assert.throws(() => rnaseq.deriveDataset(dir, classDef, { ...server, props: { hasPairedEnds: 'true' } }), (e) =>
    /mix paired and single entries/.test(e.message) && !/Set dataset\.props\.hasPairedEnds/.test(e.message));
});

test('deriveDataset refuses a server source whose annotations list no files', () => {
  assert.throws(() => rnaseq.deriveDataset(rnaDir, classDef, { source: { type: 'server', paths: ['/data/doe'] } }),
    /Sample annotations of PRJNA000002 list no files; a server source needs files per sample\./);
});

test('deriveDataset refuses a layout override that contradicts the files', (t) => {
  const dir = copyOf(t, rnaDir);
  withFileSamples(dir);
  assert.throws(() => rnaseq.deriveDataset(dir, classDef, { source: { type: 'server', paths: ['/data/doe'] }, props: { hasPairedEnds: 'false' } }),
    /dataset\.props\.hasPairedEnds is false but the sample files of PRJNA000002 say true; for a server source the layout comes from the files/);
});

test('a url source carries curator-named files through to the samplesheet and hand-off', (t) => {
  const dir = copyOf(t, rnaDir);
  rmSync(join(dir, 'inputs', 'PRJNA000002_sra_metadata.json'));
  withFileSamples(dir, [
    { sampleId: 'a', files: [{ fastq_1: 'a_R1.fq.gz' }] },
    { sampleId: 'b', files: [{ fastq_1: 'b_L1_R1.fq.gz' }, { fastq_1: 'b_L2_R1.fq.gz' }] }
  ]);
  const url = { type: 'url', urls: ['https://example.org/reads/'] };
  rnaseq.normalizeCurated(dir, { source: url });
  const d = rnaseq.deriveDataset(dir, classDef, { source: url });
  assert.deepEqual([d.props.hasPairedEnds, d.props.fromSRA], ['false', 'false']);
  writeFileSync(join(dir, 'curated', 'dataset.json'), JSON.stringify(d));
  assert.equal(rnaseq.deriveArtifacts(dir)['tfakST1/samplesheet.csv'], [
    'sample,fastq_1,fastq_2,strandedness', 'a,a_R1.fq.gz,,stranded', 'b,b_L1_R1.fq.gz,,stranded', 'b,b_L2_R1.fq.gz,,stranded'
  ].join('\n') + '\n');
  assert.match(handoffNote({ deliveries: [], source: url }), /Reads: files named in the samplesheet, at: https:\/\/example\.org\/reads\//);
});

test('normalizeCurated needs the SRA metadata for an sra source and a known source type', (t) => {
  const dir = copyOf(t, rnaDir);
  assert.throws(() => rnaseq.normalizeCurated(dir, { source: { type: 'ftp' } }), /source\.type must be one of sra, server, url/);
  rmSync(join(dir, 'inputs', 'PRJNA000002_sra_metadata.json'));
  assert.throws(() => rnaseq.normalizeCurated(dir), /Required input missing: .*PRJNA000002_sra_metadata\.json/);
  assert.throws(() => rnaseq.deriveDataset(dir, classDef), /Required input missing: .*PRJNA000002_sra_metadata\.json/);
});

test('rnaseq derive without SRA metadata leaves the organism-based text to the curator', (t) => {
  const dir = copyOf(t, rnaDir);
  rmSync(join(dir, 'inputs', 'PRJNA000002_sra_metadata.json'));
  const p = rnaseq.derivePresenter(dir);
  assert.equal(p.displayName, '');
  assert.equal(p.summary, '');
  assert.equal(p.methodology, '');
  assert.deepEqual(p.links.map((l) => l.text), ['NCBI Bioproject']);
});

test('rnaseq derive links NCBI BioProject only for a BioProject accession', (t) => {
  assert.deepEqual(rnaseq.derivePresenter(rnaDir).links.map((l) => l.text), ['NCBI Bioproject']);
  const tmp = mkdtempSync(join(tmpdir(), 'renderer-'));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const dir = join(tmp, 'DoeLab_heat_2024');
  cpSync(rnaDir, dir, { recursive: true });
  const m = readJson(join(dir, 'manifest.json'));
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ ...m, accession: 'DoeLab_heat_2024' }));
  renameSync(join(dir, 'curated', 'PRJNA000002_sample_annotations.json'), join(dir, 'curated', 'DoeLab_heat_2024_sample_annotations.json'));
  renameSync(join(dir, 'inputs', 'PRJNA000002_sra_metadata.json'), join(dir, 'inputs', 'DoeLab_heat_2024_sra_metadata.json'));
  assert.deepEqual(rnaseq.derivePresenter(dir).links, []);
});

test('rnaseq derive links NCBI GEO from externalIds and takes PubMed ids from the GEO series', (t) => {
  const dir = copyOf(t, rnaDir);
  const m = readJson(join(dir, 'manifest.json'));
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ ...m, externalIds: { bioproject: 'PRJNA000002', geo: 'GSE0002' } }));
  const miniml = join(dir, 'inputs', 'GSE0002_family.xml');
  writeFileSync(miniml, readFileSync(miniml, 'utf-8').replace('</Summary>', '</Summary><Pubmed-ID>123</Pubmed-ID><Pubmed-ID>123</Pubmed-ID>'));
  const p = rnaseq.derivePresenter(dir);
  assert.deepEqual(p.links, [
    { text: 'NCBI Bioproject', url: 'https://www.ncbi.nlm.nih.gov/bioproject/PRJNA000002' },
    { text: 'NCBI GEO', url: 'https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSE0002' }
  ]);
  assert.deepEqual(p.pubmedIds, ['123']);
});

test('rnaseq derive refuses a recorded GEO series without its MINiML', (t) => {
  const dir = copyOf(t, rnaDir);
  const m = readJson(join(dir, 'manifest.json'));
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ ...m, externalIds: { bioproject: 'PRJNA000002', geo: 'GSE0009' } }));
  assert.throws(() => rnaseq.derivePresenter(dir), /records GEO series GSE0009; pass --input \.curation\/tmp\/GSE0009_family\.xml/);
});

const twoOrganisms = { accession: 'PRJNA9', organisms: [...loaded('tfakST1'), ...loaded('hfakH1')] };
const tagged = (...tags) => ({ samples: tags.map((organisms, i) => ({ sampleId: `S${i + 1}`, ...(organisms ? { organisms } : {}) })) });

test('membershipErrors accepts each way samples can map to organisms', () => {
  assert.deepEqual(rnaseq.membershipErrors(tagged(['tfakST1', 'hfakH1'], ['tfakST1', 'hfakH1']), twoOrganisms), []);
  assert.deepEqual(rnaseq.membershipErrors(tagged(['hfakH1'], ['tfakST1', 'hfakH1']), twoOrganisms), []);
  assert.deepEqual(rnaseq.membershipErrors(tagged(['tfakST1'], ['hfakH1']), twoOrganisms), []);
});

test('membershipErrors needs every sample tagged when there are two organisms, and every organism used', () => {
  assert.deepEqual(rnaseq.membershipErrors(tagged(['tfakST1'], undefined), twoOrganisms), [
    'Sample S2: list the organisms it aligns to under "organisms"; PRJNA9 aligns to tfakST1, hfakH1'
  ]);
  assert.deepEqual(rnaseq.membershipErrors(tagged(['tfakST1'], ['tfakST1']), twoOrganisms), ['No sample aligns to hfakH1']);
  assert.deepEqual(rnaseq.membershipErrors(tagged([], ['tfakST1', 'nope1']), twoOrganisms), [
    'Sample S1: organisms must be a non-empty array of organism abbreviations',
    'Sample S2: nope1 is not an organism of PRJNA9; use one of tfakST1, hfakH1',
    'No sample aligns to hfakH1'
  ]);
});

test('membershipErrors lets one organism go untagged', () => {
  const one = { accession: 'PRJNA9', organisms: loaded('tfakST1') };
  assert.deepEqual(rnaseq.membershipErrors(tagged(undefined, undefined), one), []);
  assert.deepEqual(rnaseq.membershipErrors(tagged(['hfakH1']), one), ['Sample S1: hfakH1 is not an organism of PRJNA9; use one of tfakST1', 'No sample aligns to tfakST1']);
});

test('samplesFor filters by tag; untagged samples belong to every organism', () => {
  const ids = (a, p) => rnaseq.samplesFor(a, twoOrganisms, p).map((s) => s.sampleId);
  assert.deepEqual(ids(tagged(['hfakH1'], ['tfakST1', 'hfakH1']), 'tfakST1'), ['S2']);
  assert.deepEqual(ids(tagged(['hfakH1'], ['tfakST1', 'hfakH1']), 'hfakH1'), ['S1', 'S2']);
  assert.deepEqual(ids(tagged(undefined), 'hfakH1'), ['S1']);
});

test('normalizeCurated refuses annotations whose membership does not cover the organisms', (t) => {
  const dir = copyOf(t, rnaDir);
  const path = join(dir, 'manifest.json');
  writeFileSync(path, JSON.stringify({ ...readJson(path), organisms: [...loaded('tfakST1'), ...loaded('tfakST2')] }));
  assert.throws(() => rnaseq.normalizeCurated(dir), /Sample organisms of PRJNA000002 do not match its organisms:\n  - Sample SAMN1: list the organisms/);
});

test('membershipErrors refuses non-array tags without coercing them, and they do not count as alignment', () => {
  const notArray = 'must be a non-empty array of organism abbreviations';
  assert.deepEqual(rnaseq.membershipErrors(tagged('tfakST1', ['hfakH1']), twoOrganisms), [`Sample S1: organisms ${notArray}`, 'No sample aligns to tfakST1']);
  assert.deepEqual(rnaseq.membershipErrors(tagged(5, ['tfakST1', 'hfakH1']), twoOrganisms), [`Sample S1: organisms ${notArray}`]);
  assert.deepEqual(rnaseq.samplesFor(tagged('tfakST1'), twoOrganisms, 'tfakST1'), []);
});

test('membershipErrors needs a samples array', () => {
  assert.deepEqual(rnaseq.membershipErrors({}, twoOrganisms), ['PRJNA9_sample_annotations.json has no "samples" array']);
});

test('membershipErrors flags a duplicate tag', () => {
  assert.deepEqual(rnaseq.membershipErrors(tagged(['tfakST1', 'tfakST1'], ['hfakH1']), twoOrganisms), ['Sample S1: lists tfakST1 twice']);
});

test('membershipErrors names a sample without an id by position', () => {
  assert.deepEqual(rnaseq.membershipErrors({ samples: [{ organisms: ['nope1'] }] }, { accession: 'PRJNA9', organisms: loaded('tfakST1') }), [
    'Sample sample #1: nope1 is not an organism of PRJNA9; use one of tfakST1',
    'No sample aligns to tfakST1'
  ]);
});

test('presenter overrides may set injector props per organism', (t) => {
  const path = overridesFile(t, JSON.stringify({ presenter: { organisms: { hfakH1: { injectorProps: { isDESeq: 'false' } } } } }));
  const { presenter } = readOverrides(path);
  const p = rnaseq.derivePresenter(rnaDir, { ...presenterOverridesFor('PRJNA000002'), ...presenter });
  assert.deepEqual(p.organisms, { hfakH1: { injectorProps: { isDESeq: 'false' } } });
  assert.equal('organisms' in rnaseq.derivePresenter(rnaDir, presenterOverridesFor('PRJNA000002')), false);
});

test('validatePresenter holds per-organism injector props to the same rules', () => {
  const p = readJson(join(rnaDir, 'curated', 'presenter.json'));
  const opts = { requiredInjectorProps: rnaseq.requiredInjectorProps };
  assert.deepEqual(validatePresenter({ ...p, organisms: { hfakH1: { injectorProps: { isDESeq: 'false' } } } }, opts), []);
  assert.deepEqual(validatePresenter({ ...p, organisms: [] }, opts), ['organisms must be an object of { injectorProps } by organism']);
  assert.deepEqual(validatePresenter({ ...p, organisms: { hfakH1: { color: 'x' } } }, opts), ['organisms.hfakH1 may hold only injectorProps']);
  assert.deepEqual(validatePresenter({ ...p, organisms: { hfakH1: { injectorProps: { 'bad name': 'x', isDESeq: 1 } } } }, opts),
    ['organisms.hfakH1.injectorProps must be an object of string values']);
  assert.deepEqual(validatePresenter({ ...p, organisms: { hfakH1: { injectorProps: { graphXAxisSamplesDescription: ' ' } } } }, opts),
    ['organisms.hfakH1.injectorProps.graphXAxisSamplesDescription is required and is empty']);
});
