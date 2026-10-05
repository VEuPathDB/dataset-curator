import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, mkdtempSync, mkdirSync, cpSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import * as rnaseq from '../shared/scripts/dataset-types/bulk-rnaseq.js';
import { renderArtifacts } from '../shared/scripts/dataset-types/bulk-rnaseq.js';
import { deliveryLocation, writeArtifacts, handoffNote } from '../shared/scripts/lib/artifacts.js';
import { readDatasetClass } from '../shared/scripts/lib/dataset-classes.js';
import { sampleAnnotationsToStf } from '../shared/scripts/lib/stf.js';
import { alignTo } from './helpers.js';

const fixtures = new URL('./fixtures/', import.meta.url).pathname;
const rnaDir = join(fixtures, 'proposals', 'PRJNA000002');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf-8'));

function filesUnder(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? filesUnder(p) : [p];
  });
}

function copyOf(t, src) {
  const dest = join(mkdtempSync(join(tmpdir(), 'artifacts-')), 'PRJNA000002');
  t.after(() => rmSync(dest, { recursive: true, force: true }));
  cpSync(src, dest, { recursive: true });
  return dest;
}

/** A throwaway VEuPathDatasets-shaped checkout holding the fixture proposal. */
function checkoutWith(t, src) {
  const repo = mkdtempSync(join(tmpdir(), 'artifacts-repo-'));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q', repo]);
  mkdirSync(join(repo, 'Model/lib/xml/datasetPresenters'), { recursive: true });
  mkdirSync(join(repo, 'Model/lib/xml/datasetClass'), { recursive: true });
  cpSync(join(fixtures, 'classes.xml'), join(repo, 'Model/lib/xml/datasetClass/classes.xml'));
  cpSync(src, join(repo, 'Proposals/PRJNA000002'), { recursive: true });
  return repo;
}

test('renderArtifacts matches the golden files, one for one', () => {
  const golden = join(rnaDir, 'expected-artifacts');
  const { files } = renderArtifacts(rnaDir, 'tfakST1');
  assert.deepEqual(Object.keys(files).sort(), filesUnder(golden).map((p) => relative(golden, p)).sort());
  for (const [name, text] of Object.entries(files)) assert.equal(text, readFileSync(join(golden, name), 'utf-8'), name);
});

test('renderArtifacts reads the manifest and curated records, not inputs/', (t) => {
  const dir = copyOf(t, rnaDir);
  rmSync(join(dir, 'inputs'), { recursive: true });
  assert.deepEqual(renderArtifacts(dir, 'tfakST1'), renderArtifacts(rnaDir, 'tfakST1'));
});

test('single-end, unstranded experiments leave fastq_2 empty and say unstranded', (t) => {
  const dir = copyOf(t, rnaDir);
  const path = join(dir, 'curated', 'dataset.json');
  const d = readJson(path);
  writeFileSync(path, JSON.stringify({ ...d, props: { ...d.props, hasPairedEnds: 'false', isStrandSpecific: 'false' } }));
  const files = rnaseq.deriveArtifacts(dir);
  assert.equal(files['tfakST1/samplesheet.csv'], 'sample,fastq_1,fastq_2,strandedness\nSAMN1,SRR1,,unstranded\nSAMN2,SRR2,,unstranded\n');
  assert.match(files['tfakST1/analysisConfig.xml'], /<property name="isStrandSpecific" value="0"\/>/);
});

test('a paired SRA proposal lists each run once, with fastq_2 empty', () => {
  assert.equal(JSON.parse(readFileSync(join(rnaDir, 'curated', 'dataset.json'), 'utf-8')).props.hasPairedEnds, 'true');
  assert.equal(rnaseq.deriveArtifacts(rnaDir)['tfakST1/samplesheet.csv'],
    'sample,fastq_1,fastq_2,strandedness\nSAMN1,SRR1,,stranded\nSAMN2,SRR2,,stranded\n');
});

test('checkCurated flags an SRA samplesheet row that repeats the run in fastq_2', (t) => {
  const dir = copyOf(t, rnaDir);
  rewrite(dir, 'samplesheet.csv', (s) => s.replace('SAMN2,SRR2,,stranded', 'SAMN2,SRR2,SRR2,stranded'));
  assert.deepEqual(rnaseq.checkCurated(dir), ['samplesheet.csv line 3 (SAMN2) has a fastq_2, but an SRA source lists each run once']);
});

function serverCopy(t, files) {
  const dir = copyOf(t, rnaDir);
  const annPath = join(dir, 'curated', 'PRJNA000002_sample_annotations.json');
  const ann = readJson(annPath);
  writeFileSync(annPath, JSON.stringify({ ...ann, samples: ann.samples.map(({ runs, biosample, ...s }) => ({ ...s, files: files(s.sampleId) })) }));
  const dsPath = join(dir, 'curated', 'dataset.json');
  const d = readJson(dsPath);
  writeFileSync(dsPath, JSON.stringify({ ...d, props: { ...d.props, fromSRA: 'false' }, source: { type: 'server', paths: ['/data/doe'] } }));
  for (const [f, text] of Object.entries(rnaseq.deriveArtifacts(dir))) writeFileSync(join(dir, 'curated', f), text);
  return dir;
}

test('a paired server source keeps the curator second file in fastq_2 and still checks the pairing', (t) => {
  const dir = serverCopy(t, (id) => [{ fastq_1: `${id}_R1.fq.gz`, fastq_2: `${id}_R2.fq.gz` }]);
  assert.equal(readFileSync(join(dir, 'curated', 'tfakST1', 'samplesheet.csv'), 'utf-8'),
    'sample,fastq_1,fastq_2,strandedness\nSAMN1,SAMN1_R1.fq.gz,SAMN1_R2.fq.gz,stranded\nSAMN2,SAMN2_R1.fq.gz,SAMN2_R2.fq.gz,stranded\n');
  assert.deepEqual(rnaseq.checkCurated(dir), []);
  rewrite(dir, 'samplesheet.csv', (s) => s.replace('SAMN2_R2.fq.gz', ''));
  assert.deepEqual(rnaseq.checkCurated(dir), ['samplesheet.csv line 3 (SAMN2) has no fastq_2 but dataset.json says hasPairedEnds true']);
});

test('a single-end server source flags a stray fastq_2', (t) => {
  const dir = serverCopy(t, (id) => [{ fastq_1: `${id}_R1.fq.gz` }]);
  const path = join(dir, 'curated', 'dataset.json');
  writeFileSync(path, JSON.stringify({ ...readJson(path), props: { ...readJson(path).props, hasPairedEnds: 'false' } }));
  for (const [f, text] of Object.entries(rnaseq.deriveArtifacts(dir))) writeFileSync(join(dir, 'curated', f), text);
  assert.deepEqual(rnaseq.checkCurated(dir), []);
  rewrite(dir, 'samplesheet.csv', (s) => s.replace('SAMN1_R1.fq.gz,', 'SAMN1_R1.fq.gz,SAMN1_R2.fq.gz'));
  assert.deepEqual(rnaseq.checkCurated(dir), ['samplesheet.csv line 2 (SAMN1) has a fastq_2 but dataset.json says hasPairedEnds false']);
});

test('the hand-off for a server source says the samplesheet names the files', () => {
  const note = handoffNote({ deliveries: [], source: { type: 'server', paths: ['/data/doe'] } });
  assert.match(note, /Reads: files named in the samplesheet, under: \/data\/doe/);
});

const edit = (p, change) => writeFileSync(p, change(readFileSync(p, 'utf-8')));
const rewrite = (dir, file, change) => edit(join(dir, 'curated', 'tfakST1', file), change);

test('deriveArtifacts produces the derivedCuratedFiles from annotations and dataset.json', () => {
  const files = rnaseq.deriveArtifacts(rnaDir);
  assert.deepEqual(Object.keys(files).sort(), rnaseq.derivedCuratedFiles.map((f) => `tfakST1/${f}`).sort());
  for (const [f, text] of Object.entries(files)) assert.equal(text, readFileSync(join(rnaDir, 'curated', f), 'utf-8'), f);
});

test('checkCurated passes the fixture and names every disagreement', (t) => {
  assert.deepEqual(rnaseq.checkCurated(rnaDir), []);
  const dir = copyOf(t, rnaDir);
  rewrite(dir, 'samplesheet.csv', (s) => s.replace('SAMN2,SRR2,,stranded', 'SAMN9,SRR2,,unstranded'));
  rewrite(dir, 'analysisConfig.xml', (s) => s.replace('value="1"', 'value="0"'));
  const errors = rnaseq.checkCurated(dir).join('\n');
  assert.match(errors, /samplesheet\.csv and entity-sample\.tsv disagree: only in samplesheet\.csv: SAMN9; only in entity-sample\.tsv: SAMN2/);
  assert.match(errors, /samplesheet\.csv and analysisConfig\.xml disagree: only in samplesheet\.csv: SAMN9; only in analysisConfig\.xml: SAMN2/);
  assert.match(errors, /samplesheet\.csv line 3 \(SAMN9\) says unstranded but dataset\.json says isStrandSpecific true/);
  assert.match(errors, /analysisConfig\.xml isStrandSpecific is 0 but dataset\.json says isStrandSpecific true/);
});

test('checkCurated needs exactly one pipe in each value and reads the id XML-unescaped', (t) => {
  const dir = copyOf(t, rnaDir);
  rewrite(dir, 'analysisConfig.xml', (s) => s.replace('Control|SAMN1', 'Ctl &amp; mock|SAMN1'));
  assert.deepEqual(rnaseq.checkCurated(dir), []);
  rewrite(dir, 'analysisConfig.xml', (s) => s.replace('Ctl &amp; mock|SAMN1', 'Ctl &amp; mock|x|SAMN1'));
  assert.match(rnaseq.checkCurated(dir).join('\n'), /analysisConfig\.xml value "Ctl & mock\|x\|SAMN1" is not label\|sampleId/);
  rewrite(dir, 'analysisConfig.xml', (s) => s.replace('Ctl &amp; mock|x|SAMN1', 'SAMN1'));
  assert.match(rnaseq.checkCurated(dir).join('\n'), /analysisConfig\.xml value "SAMN1" is not label\|sampleId/);
});

test('checkCurated tolerates reordered attributes, single quotes and padded values', (t) => {
  const dir = copyOf(t, rnaDir);
  rewrite(dir, 'analysisConfig.xml', (s) => s
    .replace('<property name="samples">', "<property  note='x'\n      name = 'samples' >")
    .replace('<property name="isStrandSpecific" value="1"/>', "<property value='1' name='isStrandSpecific' />")
    .replace('<value>Control|SAMN1</value>', '<value>\n  Control | SAMN1 \n</value>'));
  assert.deepEqual(rnaseq.checkCurated(dir), []);
});

test('checkCurated reports an analysisConfig without samples or isStrandSpecific', (t) => {
  const dir = copyOf(t, rnaDir);
  rewrite(dir, 'analysisConfig.xml', (s) => s.replace('name="samples"', 'name="sample"').replace('name="isStrandSpecific"', 'name="stranded"'));
  assert.deepEqual(rnaseq.checkCurated(dir), ['analysisConfig.xml has no samples property', 'analysisConfig.xml has no isStrandSpecific property']);
});

test('checkCurated passes a consistent single-end, unstranded set and reports a stray fastq_2', (t) => {
  const dir = copyOf(t, rnaDir);
  const path = join(dir, 'curated', 'dataset.json');
  const d = readJson(path);
  writeFileSync(path, JSON.stringify({ ...d, props: { ...d.props, hasPairedEnds: 'false', isStrandSpecific: 'false' } }));
  for (const [f, text] of Object.entries(rnaseq.deriveArtifacts(dir))) writeFileSync(join(dir, 'curated', f), text);
  assert.deepEqual(rnaseq.checkCurated(dir), []);
  rewrite(dir, 'samplesheet.csv', (s) => s.replace('SAMN1,SRR1,,', 'SAMN1,SRR1,SRR1,'));
  assert.deepEqual(rnaseq.checkCurated(dir), ['samplesheet.csv line 2 (SAMN1) has a fastq_2, but an SRA source lists each run once']);
});

test('checkCurated accepts CRLF line endings, blank lines and a sample over several rows', (t) => {
  const dir = copyOf(t, rnaDir);
  rewrite(dir, 'samplesheet.csv', (s) => s.replace('SAMN1,SRR1,,stranded\n', 'SAMN1,SRR1,,stranded\nSAMN1,SRR1b,,stranded\n\n'));
  for (const f of ['samplesheet.csv', 'entity-sample.tsv', 'analysisConfig.xml']) rewrite(dir, f, (s) => s.replace(/\n/g, '\r\n'));
  assert.deepEqual(rnaseq.checkCurated(dir), []);
});

test('checkCurated compares the sample annotations with the samplesheet', (t) => {
  const dir = copyOf(t, rnaDir);
  edit(join(dir, 'curated', 'PRJNA000002_sample_annotations.json'), (s) => s.replace('"sampleId": "SAMN2"', '"sampleId": "SAMN9"'));
  assert.deepEqual(rnaseq.checkCurated(dir),
    ['samplesheet.csv and PRJNA000002_sample_annotations.json disagree: only in samplesheet.csv: SAMN2; only in PRJNA000002_sample_annotations.json: SAMN9']);
});

test('checkCurated reports a missing curated file', (t) => {
  const dir = copyOf(t, rnaDir);
  rmSync(join(dir, 'curated', 'tfakST1', 'entity-sample.yaml'));
  assert.deepEqual(rnaseq.checkCurated(dir), ['curated/tfakST1/entity-sample.yaml is missing; re-run write-proposal.js']);
  rmSync(join(dir, 'curated', 'PRJNA000002_sample_annotations.json'));
  assert.deepEqual(rnaseq.checkCurated(dir), ['curated/tfakST1/entity-sample.yaml is missing; re-run write-proposal.js', 'curated/PRJNA000002_sample_annotations.json is missing']);
});

test('renderArtifacts copies the curated files and refuses them when they disagree', (t) => {
  const dir = copyOf(t, rnaDir);
  rewrite(dir, 'analysisConfig.xml', (s) => s.replace('Control|SAMN1', 'Mock|SAMN1'));
  const { files } = rnaseq.renderArtifacts(dir, 'tfakST1');
  assert.match(files['analysisConfig.xml'], /Mock\|SAMN1/);
  assert.ok('sample-annotations-stf/tfakST1_Doe_heat_shock_2024_rnaSeq_RSRC/entity-sample.tsv' in files);
  rewrite(dir, 'analysisConfig.xml', (s) => s.replace('Mock|SAMN1', 'Mock|SAMN7'));
  assert.throws(() => rnaseq.renderArtifacts(dir, 'tfakST1'), /Curated artifacts of PRJNA000002 disagree:/);
});

test('the delivery location comes from the class unpack path', (t) => {
  const repo = checkoutWith(t, rnaDir);
  const classDef = readDatasetClass(repo, 'rnaSeqExperiment');
  assert.deepEqual(deliveryLocation(readJson(join(rnaDir, 'manifest.json')), classDef, 'tfakST1'), {
    target: '@@manualDeliveryDir@@/FungiDB/tfakST1/rnaSeq/Doe_heat_shock_2024/2024-05-01/final/',
    relative: 'FungiDB/tfakST1/rnaSeq/Doe_heat_shock_2024/2024-05-01/final'
  });
});

test('writeArtifacts lays files out under the relative path and replaces old ones', (t) => {
  const base = mkdtempSync(join(tmpdir(), 'artifacts-out-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  writeArtifacts(base, 'a/b', { 'x.txt': 'old', 'd/y.txt': 'y' });
  const dir = writeArtifacts(base, 'a/b', { 'x.txt': 'new' });
  assert.equal(dir, join(base, 'a/b'));
  assert.equal(readFileSync(join(dir, 'x.txt'), 'utf-8'), 'new');
  assert.equal(readFileSync(join(dir, 'd/y.txt'), 'utf-8'), 'y');
});

test('the hand-off says the data loading team copies and checks', () => {
  const note = handoffNote({
    deliveries: [
      { target: '@@manualDeliveryDir@@/FungiDB/a/x/', localDir: '/tmp/a', files: { 'samplesheet.csv': '', 'stf/a_RSRC/entity-sample.tsv': '' } },
      { target: '@@manualDeliveryDir@@/FungiDB/b/x/', localDir: '/tmp/b', files: { 'samplesheet.csv': '', 'stf/b_RSRC/entity-sample.tsv': '' } }
    ],
    source: { type: 'sra' }
  });
  assert.match(note, /^Artifacts: samplesheet\.csv, stf$/m);
  assert.match(note, /^Copy `\/tmp\/a` to `@@manualDeliveryDir@@\/FungiDB\/a\/x\/`$/m);
  assert.match(note, /^Copy `\/tmp\/b` to `@@manualDeliveryDir@@\/FungiDB\/b\/x\/`$/m);
  assert.match(note, /^Reads: SRA: the samplesheet lists run accessions for the pipeline to fetch$/m);
  assert.match(note, /^Copying these files and checking the data on the server is the data loading team's step\.$/m);
});

test('render-proposal --artifacts writes the preview and prints the hand-off', (t) => {
  const repo = checkoutWith(t, rnaDir);
  const out = join(repo, '.curation', 'delivery');
  const cli = new URL('../shared/scripts/render-proposal.js', import.meta.url).pathname;
  const r = spawnSync('node', [cli, '--artifacts', out, join(repo, 'Proposals/PRJNA000002')], { encoding: 'utf-8' });
  assert.equal(r.status, 0, r.stderr);
  const dir = join(out, 'FungiDB/tfakST1/rnaSeq/Doe_heat_shock_2024/2024-05-01/final');
  assert.match(r.stdout, new RegExp(`Copy \`${dir}\` to `));
  assert.equal(readFileSync(join(dir, 'samplesheet.csv'), 'utf-8'), readFileSync(join(rnaDir, 'expected-artifacts/samplesheet.csv'), 'utf-8'));
});

test('render-proposal --artifacts writes one delivery per organism under a shared Artifacts line', (t) => {
  const repo = checkoutWith(t, rnaDir);
  alignTo(join(repo, 'Proposals/PRJNA000002'), [{ abbrev: 'tfakST1' }, { abbrev: 'tfakST2' }], { SAMN1: ['tfakST1', 'tfakST2'], SAMN2: ['tfakST1', 'tfakST2'] });
  const out = join(repo, '.curation', 'delivery');
  const cli = new URL('../shared/scripts/render-proposal.js', import.meta.url).pathname;
  const r = spawnSync('node', [cli, '--artifacts', out, join(repo, 'Proposals/PRJNA000002')], { encoding: 'utf-8' });
  assert.equal(r.status, 0, r.stderr);
  for (const org of ['tfakST1', 'tfakST2']) {
    const dir = join(out, `FungiDB/${org}/rnaSeq/Doe_heat_shock_2024/2024-05-01/final`);
    assert.ok(existsSync(join(dir, 'samplesheet.csv')), dir);
    assert.match(r.stdout, new RegExp(`^Copy \`${dir}\` to \`@@manualDeliveryDir@@/FungiDB/${org}/rnaSeq/`, 'm'));
  }
  const artifactsLine = r.stdout.split('\n').find((l) => l.startsWith('Artifacts: '));
  assert.equal(artifactsLine, 'Artifacts: analysisConfig.xml, sample-annotations-stf, sampleAnnotations.json, samplesheet.csv');
});

test('STF output quotes YAML scalars that would otherwise parse as something else', () => {
  const { yaml } = sampleAnnotationsToStf({
    samples: [{ sampleId: 'S1', label: 'a', runs: ['SRR1'], factors: { dose: 'yes' } }],
    factors: { dose: { displayName: 'dose: amount', definition: "Patient's dose # given", unit: '10' } }
  });
  assert.match(yaml, /display_name: 'dose: amount'/);
  assert.match(yaml, /definition: 'Patient''s dose # given'/);
  assert.match(yaml, /unit: '10'/);
});

test('STF output has no SRA column for reads not in SRA, and keeps it by default', () => {
  const annotations = { samples: [{ sampleId: 'S1', label: 'a', files: [{ fastq_1: 'a.fq.gz' }] }], factors: {} };
  const files = sampleAnnotationsToStf(annotations, { sra: false });
  assert.equal(files.tsv.split('\n')[0], 'sample.ID \\\\ Descriptors\tlabel');
  assert.doesNotMatch(files.yaml, /SRA/);
  const sra = sampleAnnotationsToStf(annotations);
  assert.match(sra.tsv.split('\n')[0], /\tSRA\.ID\.s\.\t/);
  assert.match(sra.yaml, /variable: SRA\.ID\.s\./);
});

test('the STF skill script still writes the same files from .curation/tmp', (t) => {
  const work = mkdtempSync(join(tmpdir(), 'stf-cli-'));
  t.after(() => rmSync(work, { recursive: true, force: true }));
  mkdirSync(join(work, '.curation/tmp'), { recursive: true });
  cpSync(join(rnaDir, 'curated/PRJNA000002_sample_annotations.json'), join(work, '.curation/tmp/PRJNA000002_sample_annotations.json'));
  const cli = new URL('../skills/sample-annotations-to-stf/scripts/sample-annotations-to-stf.js', import.meta.url).pathname;
  execFileSync('node', [cli, 'PRJNA000002', 'X', 'out'], { cwd: work });
  for (const f of ['entity-sample.tsv', 'entity-sample.yaml']) {
    assert.equal(readFileSync(join(work, 'out/X', f), 'utf-8'), readFileSync(join(fixtures, 'stf', f), 'utf-8'));
  }
});

test('deriveArtifacts writes each organism its own artifacts from its own samples', (t) => {
  const dir = copyOf(t, rnaDir);
  alignTo(dir, [{ abbrev: 'tfakST1' }, { abbrev: 'hfakH1', project: 'HostDB' }], { SAMN1: ['hfakH1'], SAMN2: ['tfakST1', 'hfakH1'] });
  const files = rnaseq.deriveArtifacts(dir);
  assert.deepEqual(Object.keys(files).sort(), ['hfakH1', 'tfakST1'].flatMap((o) => rnaseq.derivedCuratedFiles.map((f) => `${o}/${f}`)).sort());
  assert.equal(files['tfakST1/samplesheet.csv'], 'sample,fastq_1,fastq_2,strandedness\nSAMN2,SRR2,,stranded\n');
  assert.equal(files['hfakH1/samplesheet.csv'], 'sample,fastq_1,fastq_2,strandedness\nSAMN1,SRR1,,stranded\nSAMN2,SRR2,,stranded\n');
  assert.match(files['tfakST1/analysisConfig.xml'], /<property name="profileSetName" value="tfakST1 Testus fakeus stress &amp; recovery"\/>/);
  assert.match(files['hfakH1/analysisConfig.xml'], /value="hfakH1 Testus fakeus stress &amp; recovery"/);
  assert.doesNotMatch(files['tfakST1/entity-sample.tsv'], /SAMN1/);
  assert.match(files['hfakH1/entity-sample.tsv'], /SAMN1/);
  assert.match(files['hfakH1/entity-sample.tsv'], /SAMN2/);
  const values = (xml) => [...xml.matchAll(/<value>([^<]*)<\/value>/g)].map((v) => v[1]);
  assert.deepEqual(values(files['tfakST1/analysisConfig.xml']), ['Stressed|SAMN2']);
  assert.deepEqual(values(files['hfakH1/analysisConfig.xml']), ['Control|SAMN1', 'Stressed|SAMN2']);
  assert.deepEqual(rnaseq.checkCurated(dir), []);
});

test('checkCurated holds each organism to its own samples and names the organism', (t) => {
  const dir = copyOf(t, rnaDir);
  alignTo(dir, [{ abbrev: 'tfakST1' }, { abbrev: 'hfakH1', project: 'HostDB' }], { SAMN1: ['hfakH1'], SAMN2: ['tfakST1', 'hfakH1'] });
  const sheet = join(dir, 'curated', 'tfakST1', 'samplesheet.csv');
  writeFileSync(sheet, readFileSync(sheet, 'utf-8') + 'SAMN1,SRR1,,stranded\n');
  const errors = rnaseq.checkCurated(dir).join('\n');
  assert.match(errors, /^tfakST1: samplesheet\.csv and entity-sample\.tsv disagree: only in samplesheet\.csv: SAMN1/m);
  assert.match(errors, /^tfakST1: samplesheet\.csv and the samples tagged for tfakST1 disagree: only in samplesheet\.csv: SAMN1/m);
});

test('renderArtifacts delivers an organism its own samples and filtered annotations', (t) => {
  const dir = copyOf(t, rnaDir);
  alignTo(dir, [{ abbrev: 'tfakST1' }, { abbrev: 'hfakH1', project: 'HostDB' }], { SAMN1: ['hfakH1'], SAMN2: ['tfakST1', 'hfakH1'] });
  const { files } = rnaseq.renderArtifacts(dir, 'tfakST1');
  assert.deepEqual(JSON.parse(files['sampleAnnotations.json']).samples.map((s) => s.sampleId), ['SAMN2']);
  assert.equal(files['samplesheet.csv'], 'sample,fastq_1,fastq_2,strandedness\nSAMN2,SRR2,,stranded\n');
  assert.ok('sample-annotations-stf/tfakST1_Doe_heat_shock_2024_rnaSeq_RSRC/entity-sample.tsv' in files);
  assert.equal(rnaseq.renderArtifacts(dir, 'hfakH1').files['sampleAnnotations.json'],
    readFileSync(join(dir, 'curated', 'PRJNA000002_sample_annotations.json'), 'utf-8'));
});

test('checkCurated reports unreadable annotations once, before any artifact', (t) => {
  const dir = copyOf(t, rnaDir);
  const path = join(dir, 'curated', 'PRJNA000002_sample_annotations.json');
  writeFileSync(path, '{ not json');
  const errors = rnaseq.checkCurated(dir);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /^PRJNA000002_sample_annotations\.json is not valid JSON: /);
  writeFileSync(path, 'null');
  assert.deepEqual(rnaseq.checkCurated(dir), ['PRJNA000002_sample_annotations.json must be a JSON object']);
  writeFileSync(path, '{}');
  assert.deepEqual(rnaseq.checkCurated(dir), ['PRJNA000002_sample_annotations.json has no "samples" array']);
});

test('alignTo refuses a sample missing from the membership', (t) => {
  const dir = copyOf(t, rnaDir);
  assert.throws(() => alignTo(dir, [{ abbrev: 'tfakST1' }, { abbrev: 'tfakST2' }], { SAMN1: ['tfakST1'] }), /alignTo: no membership for sample SAMN2/);
});
