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
  assert.equal(files['samplesheet.csv'], 'sample,fastq_1,fastq_2,strandedness\nSAMN1,SRR1,,unstranded\nSAMN2,SRR2,,unstranded\n');
  assert.match(files['analysisConfig.xml'], /<property name="isStrandSpecific" value="0"\/>/);
});

test('the hand-off for a server source says the samplesheet names the files', () => {
  const note = handoffNote({ deliveries: [], source: { type: 'server', paths: ['/data/doe'] } });
  assert.match(note, /Reads: files named in the samplesheet, under: \/data\/doe/);
});

const rewrite = (dir, file, edit) => {
  const p = join(dir, 'curated', file);
  writeFileSync(p, edit(readFileSync(p, 'utf-8')));
};

test('deriveArtifacts produces the derivedCuratedFiles from annotations and dataset.json', () => {
  const files = rnaseq.deriveArtifacts(rnaDir);
  assert.deepEqual(Object.keys(files).sort(), [...rnaseq.derivedCuratedFiles].sort());
  for (const [f, text] of Object.entries(files)) assert.equal(text, readFileSync(join(rnaDir, 'curated', f), 'utf-8'), f);
});

test('checkCurated passes the fixture and names every disagreement', (t) => {
  assert.deepEqual(rnaseq.checkCurated(rnaDir), []);
  const dir = copyOf(t, rnaDir);
  rewrite(dir, 'samplesheet.csv', (s) => s.replace('SAMN2,SRR2,SRR2,stranded', 'SAMN9,SRR2,,unstranded'));
  rewrite(dir, 'analysisConfig.xml', (s) => s.replace('value="1"', 'value="0"'));
  const errors = rnaseq.checkCurated(dir).join('\n');
  assert.match(errors, /samplesheet\.csv and entity-sample\.tsv disagree: only in samplesheet\.csv: SAMN9; only in entity-sample\.tsv: SAMN2/);
  assert.match(errors, /samplesheet\.csv and analysisConfig\.xml disagree: only in samplesheet\.csv: SAMN9; only in analysisConfig\.xml: SAMN2/);
  assert.match(errors, /samplesheet\.csv line 3 \(SAMN9\) has no fastq_2 but dataset\.json says hasPairedEnds true/);
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
  assert.deepEqual(rnaseq.checkCurated(dir), ['samplesheet.csv line 2 (SAMN1) has a fastq_2 but dataset.json says hasPairedEnds false']);
});

test('checkCurated accepts CRLF line endings, blank lines and a sample over several rows', (t) => {
  const dir = copyOf(t, rnaDir);
  rewrite(dir, 'samplesheet.csv', (s) => s.replace('SAMN1,SRR1,SRR1,stranded\n', 'SAMN1,SRR1,SRR1,stranded\nSAMN1,SRR1b,SRR1b,stranded\n\n'));
  for (const f of ['samplesheet.csv', 'entity-sample.tsv', 'analysisConfig.xml']) rewrite(dir, f, (s) => s.replace(/\n/g, '\r\n'));
  assert.deepEqual(rnaseq.checkCurated(dir), []);
});

test('checkCurated compares the sample annotations with the samplesheet', (t) => {
  const dir = copyOf(t, rnaDir);
  rewrite(dir, 'PRJNA000002_sample_annotations.json', (s) => s.replace('"sampleId": "SAMN2"', '"sampleId": "SAMN9"'));
  assert.deepEqual(rnaseq.checkCurated(dir),
    ['samplesheet.csv and PRJNA000002_sample_annotations.json disagree: only in samplesheet.csv: SAMN2; only in PRJNA000002_sample_annotations.json: SAMN9']);
});

test('checkCurated reports a missing curated file', (t) => {
  const dir = copyOf(t, rnaDir);
  rmSync(join(dir, 'curated', 'entity-sample.yaml'));
  assert.deepEqual(rnaseq.checkCurated(dir), ['curated/entity-sample.yaml is missing; re-run write-proposal.js']);
  rmSync(join(dir, 'curated', 'PRJNA000002_sample_annotations.json'));
  assert.deepEqual(rnaseq.checkCurated(dir), ['curated/entity-sample.yaml is missing; re-run write-proposal.js', 'curated/PRJNA000002_sample_annotations.json is missing']);
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
  const manifestPath = join(repo, 'Proposals/PRJNA000002/manifest.json');
  writeFileSync(manifestPath, JSON.stringify({ ...readJson(manifestPath), additionalOrganismAbbrevs: ['tfakST2'] }));
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
