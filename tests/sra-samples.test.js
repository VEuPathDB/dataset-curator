import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import * as sra from '../shared/scripts/dataset-types/_sra-samples.js';
import * as rnaseq from '../shared/scripts/dataset-types/bulk-rnaseq.js';

const runs = [
  { run_accession: 'SRR1', sample_accession: 'SAMN1', experiment_accession: 'SRX1', sample_title: 'WT rep1' },
  { run_accession: 'SRR2', sample_accession: 'SAMN1', experiment_accession: 'SRX1', sample_title: 'WT rep1' },
  { run_accession: 'SRR3', sample_accession: 'SAMN2', experiment_accession: 'SRX2', sample_title: 'WT rep2' }
];

test('normalizeSamples lives in _sra-samples and bulk-rnaseq re-exports the same function', () => {
  assert.equal(rnaseq.normalizeSamples, sra.normalizeSamples);
});

test('runs of one BioSample are one sample; BioSamples with one title share a label', () => {
  const { samples } = sra.normalizeSamples({ samples: [{ runs: ['SRR1', 'SRR2'] }, { runs: ['SRR3'] }] }, runs);
  assert.deepEqual(samples.map((s) => [s.sampleId, s.label, s.biosample]), [['WT_rep1', 'WT', 'SAMN1'], ['WT_rep2', 'WT', 'SAMN2']]);
});

test('samplesheet has one row per run or files entry, sorted, with no strandedness column', () => {
  const text = sra.samplesheet([
    { sampleId: 'B', runs: ['SRR3'] },
    { sampleId: 'A', runs: ['SRR2', 'SRR1'] },
    { sampleId: 'C', files: [{ fastq_1: 'c_1.fq.gz', fastq_2: 'c_2.fq.gz' }] }
  ]);
  assert.equal(text, 'sample,fastq_1,fastq_2\nA,SRR1,\nA,SRR2,\nB,SRR3,\nC,c_1.fq.gz,c_2.fq.gz\n');
});

test('parseSamplesheet returns rows with line numbers and refuses the old 4-column header', () => {
  assert.deepEqual(sra.parseSamplesheet('sample,fastq_1,fastq_2\nA,SRR1,\n\n'), {
    errors: [], rows: [{ line: 2, sample: 'A', fastq1: 'SRR1', fastq2: '' }]
  });
  const old = sra.parseSamplesheet('sample,fastq_1,fastq_2,strandedness\nA,SRR1,,stranded\n');
  assert.equal(old.errors[0], 'samplesheet.csv header must be sample,fastq_1,fastq_2');
});

const H = 'sample,fastq_1,fastq_2\n';

test('parseSamplesheet errors on rows with extra or missing cells and keeps the row', () => {
  const extra = sra.parseSamplesheet(`${H}A,SRR1,,stranded\n`);
  assert.deepEqual(extra.errors, ['samplesheet.csv line 2 has 4 columns; expected 3']);
  assert.equal(extra.rows.length, 1);
  assert.deepEqual(sra.parseSamplesheet(`${H}A,SRR1\n`).errors, ['samplesheet.csv line 2 has 2 columns; expected 3']);
});

test('parseSamplesheet errors on an empty sample or empty fastq_1', () => {
  assert.deepEqual(sra.parseSamplesheet(`${H},SRR1,\n`).errors, ['samplesheet.csv line 2 has no sample']);
  assert.deepEqual(sra.parseSamplesheet(`${H}A,,\n`).errors, ['samplesheet.csv line 2 (A) has no fastq_1']);
});

const tsvOf = (...ids) => ['sample.ID \\\\ Descriptors\tlabel', ...ids.map((id) => `${id}\tx`)].join('\n') + '\n';
const sheetOf = (...ids) => sra.samplesheet(ids.map((sampleId, i) => ({ sampleId, runs: [`SRR${i}`] })));

test('checkSamplesAgree passes when samplesheet, STF and annotations hold the same ids', () => {
  assert.deepEqual(sra.checkSamplesAgree({ samplesheet: sheetOf('A', 'B'), tsv: tsvOf('B', 'A'), sampleIds: ['A', 'B'], versus: 'annotations.json' }), []);
});

test('checkSamplesAgree names an id found only in the samplesheet, only in the STF, or only in the annotations', () => {
  const errors = sra.checkSamplesAgree({ samplesheet: sheetOf('A', 'S'), tsv: tsvOf('A', 'T'), sampleIds: ['A', 'S', 'N'], versus: 'annotations.json' });
  assert.deepEqual(errors, [
    'samplesheet.csv and entity-sample.tsv disagree: only in samplesheet.csv: S; only in entity-sample.tsv: T',
    'samplesheet.csv and annotations.json disagree: only in samplesheet.csv: none; only in annotations.json: N'
  ]);
});

test('checkSamplesAgree treats ids differing only in case as different', () => {
  const errors = sra.checkSamplesAgree({ samplesheet: sheetOf('abc'), tsv: tsvOf('ABC'), sampleIds: ['abc'], versus: 'annotations.json' });
  assert.deepEqual(errors, ['samplesheet.csv and entity-sample.tsv disagree: only in samplesheet.csv: abc; only in entity-sample.tsv: ABC']);
});

test('checkSampleRuns passes when every sample lists the runs the samplesheet gives it', () => {
  const sheet = 'sample,fastq_1,fastq_2\nA,SRR1,\nA,SRR2,\nB,SRR3,\n';
  assert.deepEqual(sra.checkSampleRuns({ samplesheet: sheet, samples: [{ sampleId: 'A', runs: ['SRR2', 'SRR1'] }, { sampleId: 'B', runs: ['SRR3'] }], versus: 'x.json' }), []);
});

test('checkSampleRuns names the runs only in the samplesheet and only in the annotations', () => {
  const sheet = 'sample,fastq_1,fastq_2\nA,SRR1,\nA,SRR9,\nB,SRR3,\n';
  assert.deepEqual(sra.checkSampleRuns({ samplesheet: sheet, samples: [{ sampleId: 'A', runs: ['SRR1', 'SRR2'] }, { sampleId: 'B', runs: ['SRR3'] }], versus: 'x.json' }), [
    'samplesheet.csv runs of A differ from x.json: only in samplesheet.csv: SRR9; only in x.json: SRR2'
  ]);
});

test('bioprojectLinks and methodologyFrom are shared by the SRA types', () => {
  assert.deepEqual(sra.bioprojectLinks({ accession: 'PRJNA1' }), [{ text: 'NCBI Bioproject', url: 'https://www.ncbi.nlm.nih.gov/bioproject/PRJNA1' }]);
  assert.deepEqual(sra.bioprojectLinks({ accession: 'GSE1', externalIds: { geo: 'GSE1' } }), []);
  assert.deepEqual(sra.externalIdsOf({ accession: 'GSE1', externalIds: { bioproject: 'PRJNA2' } }), { geo: 'GSE1', bioproject: 'PRJNA2' });
  assert.equal(sra.methodologyFrom([{ library_strategy: 'WGS', library_layout: 'PAIRED', instrument_model: 'X' }, { library_strategy: 'WXS' }]),
    'Library strategy: WGS, WXS. Layout: PAIRED. Sequencing: X');
});

const mixed = JSON.parse(readFileSync(new URL('./fixtures/sra-mixed-biosample.json', import.meta.url), 'utf-8')).runs;

test('mixedBioSamples flags a BioSample whose experiments differ and lists each experiment', () => {
  const [flag, ...rest] = sra.mixedBioSamples(mixed);
  assert.equal(rest.length, 0);
  assert.equal(flag.biosample, 'SAMN15226360');
  assert.deepEqual(flag.differing, ['experiment_title', 'library_name', 'submission_accession', 'first_public']);
  assert.deepEqual(flag.experiments.map((e) => [e.experiment, e.runs, e.library_name, e.submission_accession, e.first_public]), [
    ['SRX8538680', ['SRR12005499'], 'S1147Nr3', 'SRA1086590', '2021-07-04'],
    ['SRX24431285', ['SRR28871819'], 'S7922Nr1', 'SRA1857086', '2024-05-03'],
    ['SRX24431286', ['SRR28871818'], 'S7922Nr2', 'SRA1857086', '2024-05-03']
  ]);
  assert.match(flag.experiments[1].experiment_title, /generation 5$/);
});

test('mixedBioSamples reports only the fields that differ', () => {
  const [flag] = sra.mixedBioSamples(mixed.slice(1));
  assert.deepEqual(flag.differing, ['experiment_title', 'library_name']);
});

test('mixedBioSamples ignores experiments that agree on all four fields', () => {
  const twin = (run, experiment) => ({ run_accession: run, sample_accession: 'SAMN1', experiment_accession: experiment, experiment_title: 'T', library_name: 'L', submission_accession: 'SRA1', first_public: '2024-01-01' });
  assert.deepEqual(sra.mixedBioSamples([twin('SRR1', 'SRX1'), twin('SRR2', 'SRX2')]), []);
});

test('mixedBioSamples ignores several runs in one experiment', () => {
  const run = (id) => ({ ...mixed[0], run_accession: id });
  assert.deepEqual(sra.mixedBioSamples([run('SRR1'), run('SRR2')]), []);
});

test('mixedBioSamples asks for a re-fetch when a run has no experiment_accession', () => {
  assert.throws(() => sra.mixedBioSamples([{ run_accession: 'SRR9', sample_accession: 'SAMN1' }]), /SRR9.*experiment_accession.*re-run fetch-sra-metadata\.js/);
});

test('mixedBioSamples asks for a re-fetch when a run has a blank sample_accession', () => {
  assert.throws(() => sra.mixedBioSamples([{ run_accession: 'SRR8', sample_accession: '', experiment_accession: 'SRX1' }]), /SRR8.*sample_accession.*re-run fetch-sra-metadata\.js/);
});

const [isolate, gen5, gen10] = mixed.map((r) => r.run_accession);
const normalizeMixed = (samples) => sra.normalizeSamples({ samples }, mixed);
const lib = (run, experiment, library_name) => ({ run_accession: run, sample_accession: 'SAMN5', experiment_accession: experiment, library_name });
const shared5 = [lib('SRR51', 'SRX51', 'L1'), lib('SRR52', 'SRX52', 'L2'), lib('SRR53', 'SRX53', 'L3')];

test('normalizeSamples refuses a sample merging differing experiments without experimentsMerged', () => {
  assert.throws(() => normalizeMixed([{ runs: [isolate, gen5, gen10] }]),
    /SAMN15226360.*experiment_title, library_name, submission_accession, first_public.*split the runs by SRX.*experimentsMerged/s);
});

test('normalizeSamples accepts merged differing experiments with a reason and keeps it', () => {
  const [s] = normalizeMixed([{ runs: [isolate, gen5, gen10], experimentsMerged: 'Top-up sequencing of one library' }]).samples;
  assert.equal(s.experimentsMerged, 'Top-up sequencing of one library');
  assert.deepEqual(s.experiments, ['SRX8538680', 'SRX24431285', 'SRX24431286']);
});

test('normalizeSamples treats a blank experimentsMerged as missing', () => {
  assert.throws(() => normalizeMixed([{ runs: [isolate, gen5, gen10], experimentsMerged: '  ' }]), /SAMN15226360.*experimentsMerged/s);
});

test('normalizeSamples ids a BioSample split by SRX as <title>_<SRX> when the suffixed titles are distinct', () => {
  const { samples } = normalizeMixed([{ runs: [isolate] }, { runs: [gen5] }, { runs: [gen10] }]);
  assert.deepEqual(samples.map((s) => [s.sampleId, s.biosample, s.experiments]), [
    ['Microbe_sample_from_Blumeria_hordei_K1_SRX8538680', 'SAMN15226360', ['SRX8538680']],
    ['Microbe_sample_from_Blumeria_hordei_K1_SRX24431285', 'SAMN15226360', ['SRX24431285']],
    ['Microbe_sample_from_Blumeria_hordei_K1_SRX24431286', 'SAMN15226360', ['SRX24431286']]
  ]);
});

test('normalizeSamples gives split SK2 samples distinct default labels ending in their SRX', () => {
  const { samples } = normalizeMixed([{ runs: [isolate] }, { runs: [gen5] }, { runs: [gen10] }]);
  assert.deepEqual(samples.map((s) => s.label), [
    'Microbe sample from Blumeria hordei K1 SRX8538680',
    'Microbe sample from Blumeria hordei K1 SRX24431285',
    'Microbe sample from Blumeria hordei K1 SRX24431286'
  ]);
});

test('normalizeSamples keeps a curator label on a split sample', () => {
  const { samples } = normalizeMixed([{ runs: [isolate], label: 'SK2 isolate' }, { runs: [gen5] }, { runs: [gen10] }]);
  assert.deepEqual(samples.map((s) => s.label), ['SK2 isolate', 'Microbe sample from Blumeria hordei K1 SRX24431285', 'Microbe sample from Blumeria hordei K1 SRX24431286']);
});

test('normalizeSamples joins the SRX of a curator-named split sample spanning several with +', () => {
  const titled = shared5.map((r) => ({ ...r, sample_title: 'Line A' }));
  const { samples } = sra.normalizeSamples({ samples: [{ runs: ['SRR51'] }, { sampleId: 'merged', runs: ['SRR52', 'SRR53'], experimentsMerged: 'Same line' }] }, titled);
  assert.deepEqual(samples.map((s) => s.label), ['Line A SRX51', 'Line A SRX52+SRX53']);
});

test('normalizeSamples labels an untitled split sample by its sampleId alone', () => {
  const { samples } = sra.normalizeSamples({ samples: [{ runs: ['SRR51'] }, { sampleId: 'merged', runs: ['SRR52', 'SRR53'], experimentsMerged: 'Same line' }] }, shared5);
  assert.deepEqual(samples.map((s) => s.label), ['SAMN5_SRX51', 'merged']);
});

test('normalizeSamples leaves default labels of unsplit BioSamples unsuffixed', () => {
  const { samples } = normalizeMixed([{ runs: [isolate, gen5, gen10], experimentsMerged: 'One line' }]);
  assert.equal(samples[0].label, 'Microbe sample from Blumeria hordei K1');
});

test('normalizeSamples ids a split BioSample as <BioSample>_<SRX> when other BioSamples share its generic title', () => {
  const other = (n) => ({ ...mixed[0], run_accession: `SRR1200550${n}`, sample_accession: `SAMN1522636${n}`, experiment_accession: `SRX853868${n}` });
  const project = [...mixed, other(1), other(2)];
  const { samples } = sra.normalizeSamples({ samples: [isolate, gen5, gen10, 'SRR12005501', 'SRR12005502'].map((r) => ({ runs: [r] })) }, project);
  assert.deepEqual(samples.map((s) => s.sampleId), [
    'SAMN15226360_SRX8538680', 'SAMN15226360_SRX24431285', 'SAMN15226360_SRX24431286', 'SAMN15226361', 'SAMN15226362'
  ]);
});

test('normalizeSamples falls back to BioSample ids when one other BioSample shares the split BioSample title', () => {
  const project = [...mixed, { ...mixed[0], run_accession: 'SRR12005501', sample_accession: 'SAMN15226361', experiment_accession: 'SRX8538681' }];
  const { samples } = sra.normalizeSamples({ samples: [isolate, gen5, gen10, 'SRR12005501'].map((r) => ({ runs: [r] })) }, project);
  assert.deepEqual(samples.map((s) => s.sampleId), [
    'SAMN15226360_SRX8538680', 'SAMN15226360_SRX24431285', 'SAMN15226360_SRX24431286', 'SAMN15226361'
  ]);
});

test('normalizeSamples ids a BioSample split by SRX as <BioSample>_<SRX> when titles are missing', () => {
  const { samples } = sra.normalizeSamples({ samples: [{ runs: ['SRR51'] }, { runs: ['SRR52'] }] }, shared5);
  assert.deepEqual(samples.map((s) => s.sampleId), ['SAMN5_SRX51', 'SAMN5_SRX52']);
});

test('normalizeSamples asks for a sampleId when a shared BioSample sample spans several SRX', () => {
  assert.throws(() => normalizeMixed([{ runs: [isolate] }, { runs: [gen5, gen10], experimentsMerged: 'Same line' }]),
    /SAMN15226360.*SRX24431285, SRX24431286.*sampleId/s);
});

test('normalizeSamples records experiments for every SRA sample and is idempotent', () => {
  const first = sra.normalizeSamples({ samples: [{ runs: ['SRR1', 'SRR2'] }, { runs: ['SRR3'] }] }, runs);
  assert.deepEqual(first.samples.map((s) => s.experiments), [['SRX1'], ['SRX2']]);
  assert.deepEqual(sra.normalizeSamples(first, runs), first);
  const split = normalizeMixed([{ runs: [isolate] }, { runs: [gen5] }, { runs: [gen10] }]);
  assert.deepEqual(sra.normalizeSamples(split, mixed), split);
});

test('normalizeSamples asks for a re-fetch when a run has no experiment_accession, even with a reason', () => {
  const bare = [{ run_accession: 'SRR9', sample_accession: 'SAMN9' }];
  assert.throws(() => sra.normalizeSamples({ samples: [{ runs: ['SRR9'], experimentsMerged: 'x' }] }, bare), /SRR9.*experiment_accession.*re-run fetch-sra-metadata\.js/);
});

test('normalizeSamples refuses one SRX split across samples, even with curator sampleIds', () => {
  assert.throws(() => sra.normalizeSamples({ samples: [{ sampleId: 'a', runs: ['SRR1'] }, { sampleId: 'b', runs: ['SRR2'] }] }, runs),
    /SRX1 is split across samples a; b;.*put those runs in one sample/s);
  const withSrx4 = [...runs, { ...runs[0], run_accession: 'SRR4', experiment_accession: 'SRX4' }];
  assert.throws(() => sra.normalizeSamples({ samples: [{ runs: ['SRR1'] }, { runs: ['SRR2', 'SRR4'] }] }, withSrx4),
    /SRX1 is split across samples SRR1; SRR2,SRR4;/);
});

test('normalizeSamples refuses an experimentsMerged reason when the runs do not span differing experiments', () => {
  assert.throws(() => sra.normalizeSamples({ samples: [{ runs: ['SRR3'], experimentsMerged: 'Top-up' }] }, runs),
    /experimentsMerged is set but its runs do not span differing SRA experiments; remove it/);
});

test('normalizeSamples ids an unnamed sample sharing a BioSample with a curator-named one by <BioSample>_<SRX>', () => {
  const { samples } = sra.normalizeSamples({ samples: [{ sampleId: 'ctl', runs: ['SRR51'] }, { runs: ['SRR52'] }] }, shared5);
  assert.deepEqual(samples.map((s) => s.sampleId), ['ctl', 'SAMN5_SRX52']);
});

test('normalizeSamples asks for a sampleId, and says why, when an unnamed sample sharing a BioSample spans two SRX', () => {
  assert.throws(() => sra.normalizeSamples({ samples: [{ sampleId: 'ctl', runs: ['SRR51'] }, { runs: ['SRR52', 'SRR53'], experimentsMerged: 'Same line' }] }, shared5),
    /SAMN5.*<BioSample or title>_<SRX>.*one SRX.*SRX52, SRX53.*sampleId/s);
});

test('normalizeSamples splitting one BioSample keeps title ids elsewhere and suffixes the split titles with their SRX', () => {
  const four = [
    { run_accession: 'SRR1', sample_accession: 'SAMN1', experiment_accession: 'SRX1', sample_title: 'WT rep1' },
    { run_accession: 'SRR2', sample_accession: 'SAMN2', experiment_accession: 'SRX2', sample_title: 'WT rep2' },
    { run_accession: 'SRR3', sample_accession: 'SAMN3', experiment_accession: 'SRX3', sample_title: 'KO rep1' },
    { run_accession: 'SRR4', sample_accession: 'SAMN4', experiment_accession: 'SRX4', sample_title: 'KO rep2' },
    { run_accession: 'SRR5', sample_accession: 'SAMN4', experiment_accession: 'SRX5', sample_title: 'KO rep2' }
  ];
  const { samples } = sra.normalizeSamples({ samples: ['SRR1', 'SRR2', 'SRR3', 'SRR4', 'SRR5'].map((r) => ({ runs: [r] })) }, four);
  assert.deepEqual(samples.map((s) => [s.sampleId, s.label]), [
    ['WT_rep1', 'WT'], ['WT_rep2', 'WT'], ['KO_rep1', 'KO'], ['KO_rep2_SRX4', 'KO SRX4'], ['KO_rep2_SRX5', 'KO SRX5']
  ]);
});

test('normalizeSamples recomputes a stored experiments list', () => {
  const [s] = sra.normalizeSamples({ samples: [{ runs: ['SRR3'], experiments: ['SRX9'] }] }, runs).samples;
  assert.deepEqual(s.experiments, ['SRX2']);
});

test('normalizeSamples refuses runs from two BioSamples even when the sample records a biosample', () => {
  assert.throws(() => sra.normalizeSamples({ samples: [{ biosample: 'SAMN1', runs: ['SRR1', 'SRR3'] }] }, runs),
    /runs come from 2 BioSamples \(SAMN1, SAMN2\); one sample needs exactly one/);
});

test('normalizeSamples refuses a recorded biosample its runs do not come from, naming both', () => {
  assert.throws(() => sra.normalizeSamples({ samples: [{ biosample: 'SAMN9', runs: ['SRR3'] }] }, runs),
    /Sample SRR3: biosample SAMN9 is recorded but its runs come from BioSample SAMN2/);
});

test('checkSampleProvenance has nothing to check in an empty entity-sample.tsv', () => {
  const samples = [{ sampleId: 'S1', biosample: 'SAMN1', experiments: ['SRX1'] }];
  for (const tsv of ['', '\n', '\r\n  \n']) assert.deepEqual(sra.checkSampleProvenance({ tsv, samples, versus: 'annotations' }), []);
});
