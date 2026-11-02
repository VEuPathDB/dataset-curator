import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, cpSync, rmSync, writeFileSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import * as chipseq from '../shared/scripts/dataset-types/chipseq.js';
import { DATASET_TYPES } from '../shared/scripts/dataset-types/index.js';
import { organismRuleOf } from '../shared/scripts/lib/manifest.js';
import { validationWorkspaceFor } from '../shared/scripts/dataset-types/validators.js';
import { readDatasetClass, expandPattern, identityValues, CLASSES_RELATIVE_PATH } from '../shared/scripts/lib/dataset-classes.js';
import { loadManifest, PREVIEW_BUILD } from '../shared/scripts/dataset-types/_common.js';

const fixtures = new URL('./fixtures/', import.meta.url).pathname;
const src = join(fixtures, 'proposals', 'PRJNA000011');
const classDef = (() => {
  const repo = mkdtempSync(join(tmpdir(), 'classes-'));
  mkdirSync(join(repo, 'Model/lib/xml/datasetClass'), { recursive: true });
  cpSync(join(fixtures, 'classes.xml'), join(repo, CLASSES_RELATIVE_PATH));
  return readDatasetClass(repo, 'chipSeqExperiment');
})();
const HISTONE = { props: { experimentType: 'histonemod' } };
const annotationsPath = (dir) => join(dir, 'curated', 'PRJNA000011_sample_annotations.json');
const editAnnotations = (dir, edit) => {
  const a = JSON.parse(readFileSync(annotationsPath(dir), 'utf-8'));
  edit(a);
  writeFileSync(annotationsPath(dir), JSON.stringify(a, null, 2));
};

/** The fixture as write-proposal leaves it; edit changes the source annotations before anything is derived. */
function staged(t, { dataset = HISTONE, presenter = {}, edit } = {}) {
  const tmp = mkdtempSync(join(tmpdir(), 'chipseq-'));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const dir = join(tmp, basename(src));
  cpSync(src, dir, { recursive: true, filter: (p) => !/expected/.test(p) });
  if (edit) editAnnotations(dir, edit);
  chipseq.normalizeCurated(dir, dataset);
  const p = chipseq.derivePresenter(dir, { shortDisplayName: 'Tfak histone', shortAttribution: 'Doe 2025', ...presenter });
  writeFileSync(join(dir, 'curated', 'presenter.json'), JSON.stringify(p, null, 2) + '\n');
  writeFileSync(join(dir, 'curated', 'dataset.json'), JSON.stringify(chipseq.deriveDataset(dir, classDef, dataset), null, 2) + '\n');
  for (const [f, text] of Object.entries(chipseq.deriveArtifacts(dir))) {
    mkdirSync(dirname(join(dir, 'curated', f)), { recursive: true });
    writeFileSync(join(dir, 'curated', f), text);
  }
  return dir;
}

test('chipseq dataset name follows the classes.xml datasetLoader pattern', () => {
  const m = loadManifest(src);
  assert.equal(chipseq.datasetNameFor('tfakST1', m.name), expandPattern(classDef.datasetNamePattern, identityValues(m, 'tfakST1')));
  assert.deepEqual(chipseq.presenterNames(src), ['tfakST1_Doe_histone_2025_chipSeq_RSRC']);
});

test('EXPERIMENT_TYPES is the class vocabulary', () => {
  const doc = readFileSync(join(fixtures, 'classes.xml'), 'utf-8').match(/name="experimentType">\[([^\]]+)\]/)[1];
  assert.deepEqual(chipseq.EXPERIMENT_TYPES, doc.split(',').map((s) => s.trim()));
});

test('chipseq samplesheet carries each ChIP sample\'s input in the fourth column', (t) => {
  const dir = staged(t);
  assert.equal(readFileSync(join(dir, 'curated', 'tfakST1', 'samplesheet.csv'), 'utf-8'), [
    'sample,fastq_1,fastq_2,input',
    'BF_H3_ChIP,SRR22,,BF_H3_Input',
    'BF_H3_Input,SRR21,,',
    'BF_K125ac_ChIP,SRR24,,BF_K125ac_Input',
    'BF_K125ac_ChIP,SRR25,,BF_K125ac_Input',
    'BF_K125ac_Input,SRR23,,'
  ].join('\n') + '\n');
  assert.deepEqual(chipseq.checkCurated(dir), []);
  assert.deepEqual(chipseq.curatedWarnings(dir), []);
});

test('the STF carries a ChIP role column', (t) => {
  const dir = staged(t);
  const [header, ...rows] = readFileSync(join(dir, 'curated', 'tfakST1', 'entity-sample.tsv'), 'utf-8').trim().split('\n');
  const at = header.split('\t').indexOf('role');
  assert.ok(at > 0, header);
  assert.deepEqual(rows.map((r) => r.split('\t')).map((c) => [c[0], c[at]]).sort(), [
    ['BF_H3_ChIP', 'ChIP'], ['BF_H3_Input', 'Input'], ['BF_K125ac_ChIP', 'ChIP'], ['BF_K125ac_Input', 'Input']
  ]);
});

test('histonemod renders hasCalledPeaks true; the dataset entry matches its golden file', (t) => {
  const dir = staged(t);
  const xml = chipseq.renderPresenter(dir, { build: PREVIEW_BUILD });
  assert.match(xml, /<datasetPresenter name="tfakST1_Doe_histone_2025_chipSeq_RSRC"\s+projectName="FungiDB">/);
  assert.match(xml, /className="org\.apidb\.apicommon\.model\.datasetInjector\.ChIPSeq">\n\s*<prop name="hasCalledPeaks">true<\/prop>/);
  assert.equal(readFileSync(join(src, 'expected.xml'), 'utf-8'), xml + '\n');
  assert.equal(readFileSync(join(src, 'expected-dataset.xml'), 'utf-8'), chipseq.renderDataset(dir, classDef) + '\n');
});

test('tfbinding keeps its input pairs but calls no peaks', (t) => {
  const dir = staged(t, { dataset: { props: { experimentType: 'tfbinding' } } });
  assert.match(chipseq.renderPresenter(dir, { build: PREVIEW_BUILD }), /<prop name="hasCalledPeaks">false<\/prop>/);
  assert.match(readFileSync(join(dir, 'curated', 'tfakST1', 'samplesheet.csv'), 'utf-8'), /BF_H3_ChIP,SRR22,,BF_H3_Input/);
});

test('hasCalledPeaks cannot be curated, in overrides or by hand', (t) => {
  const dir = staged(t);
  assert.throws(() => chipseq.derivePresenter(dir, { injectorProps: { hasCalledPeaks: 'true' } }), /follows dataset\.props\.experimentType/);
  const path = join(dir, 'curated', 'presenter.json');
  const p = JSON.parse(readFileSync(path, 'utf-8'));
  p.injectorProps.hasCalledPeaks = 'true';
  writeFileSync(path, JSON.stringify(p));
  assert.throws(() => chipseq.renderPresenter(dir, { build: PREVIEW_BUILD }), /follows dataset\.props\.experimentType/);
});

test('deriveDataset needs a valid experimentType and derives hasPairedEnds, readsFileType and fromSRA', (t) => {
  const dir = staged(t);
  assert.throws(() => chipseq.deriveDataset(dir, classDef, {}), /experimentType must be one of histonemod, /);
  assert.throws(() => chipseq.deriveDataset(dir, classDef, { props: { experimentType: 'histone' } }), /experimentType must be one of/);
  for (const k of ['hasPairedEnds', 'readsFileType', 'fromSRA']) {
    assert.throws(() => chipseq.deriveDataset(dir, classDef, { props: { experimentType: 'histonemod', [k]: 'x' } }), new RegExp(`props\\.${k} is derived`));
  }
  assert.deepEqual(chipseq.deriveDataset(dir, classDef, { props: { experimentType: 'histonemod', extraBowtieParams: '--very-sensitive' } }).props.extraBowtieParams, '--very-sensitive');
});

test('deriveDataset refuses used runs that mix library layouts', (t) => {
  const dir = staged(t);
  const sra = join(dir, 'inputs', 'PRJNA000011_sra_metadata.json');
  const meta = JSON.parse(readFileSync(sra, 'utf-8'));
  meta.runs[0].library_layout = 'PAIRED';
  writeFileSync(sra, JSON.stringify(meta));
  assert.throws(() => chipseq.deriveDataset(dir, classDef, HISTONE), /mix library layouts \(PAIRED, SINGLE\)/);
});

test('renderDataset re-checks the derived props and experimentType in a hand-edited dataset.json', (t) => {
  for (const [k, v] of [['fromSRA', 'false'], ['readsFileType', 'fasta'], ['hasPairedEnds', 'true'], ['experimentType', 'histone']]) {
    const dir = staged(t);
    const path = join(dir, 'curated', 'dataset.json');
    const d = JSON.parse(readFileSync(path, 'utf-8'));
    d.props[k] = v;
    writeFileSync(path, JSON.stringify(d));
    assert.throws(() => chipseq.renderDataset(dir, classDef), new RegExp(k === 'experimentType' ? 'experimentType must be one of' : `props\\.${k} must be`), k);
  }
});

test('pairing errors: unknown input, input of an input, input that is a ChIP, a missing or inherited role', (t) => {
  const cases = [
    [(a) => { a.samples[1].input = 'Nope'; }, 'Sample BF_H3_ChIP: input Nope is not a sample of this experiment'],
    [(a) => { a.samples[0].input = 'BF_K125ac_Input'; }, 'Sample BF_H3_Input: an input sample may not name an input'],
    [(a) => { a.samples[1].input = 'BF_K125ac_ChIP'; }, 'Sample BF_H3_ChIP: input BF_K125ac_ChIP has role chip, not input'],
    [(a) => { delete a.samples[3].role; }, 'Sample BF_K125ac_ChIP: role must be chip or input'],
    [(a) => { a.samples[3].role = 'toString'; }, 'Sample BF_K125ac_ChIP: role must be chip or input'],
    [(a) => { a.factors.role = { displayName: 'Role' }; }, 'factor "role" is reserved: the STF role column comes from each sample\'s role']
  ];
  for (const [edit, message] of cases) assert.ok(chipseq.checkCurated(staged(t, { edit })).includes(message), message);
});

test('a ChIP sample naming itself as its input is refused', (t) => {
  const dir = staged(t, { edit: (a) => { a.samples[1].input = 'BF_H3_ChIP'; } });
  assert.ok(chipseq.checkCurated(dir).includes('Sample BF_H3_ChIP: input BF_H3_ChIP has role chip, not input'));
});

test('an empty input is no input', (t) => {
  assert.deepEqual(chipseq.checkCurated(staged(t, { edit: (a) => { a.samples[1].input = ''; } })), []);
});

test('the samplesheet input column must agree with the annotations', (t) => {
  const dir = staged(t);
  const sheet = join(dir, 'curated', 'tfakST1', 'samplesheet.csv');
  writeFileSync(sheet, readFileSync(sheet, 'utf-8').replace('BF_H3_ChIP,SRR22,,BF_H3_Input', 'BF_H3_ChIP,SRR22,,BF_K125ac_Input'));
  assert.deepEqual(chipseq.checkCurated(dir), [
    'samplesheet.csv line 2 (BF_H3_ChIP) has input "BF_K125ac_Input" but PRJNA000011_sample_annotations.json has "BF_H3_Input"'
  ]);
});

test('histonemod needs inputs; histonemod_noInput may not have them', (t) => {
  const noInputs = (a) => {
    a.samples = a.samples.filter((s) => s.role === 'chip');
    for (const s of a.samples) delete s.input;
  };
  assert.ok(chipseq.checkCurated(staged(t, { edit: noInputs })).includes('experimentType histonemod needs input samples; use histonemod_noInput for an experiment without them'));
  assert.deepEqual(chipseq.checkCurated(staged(t, { edit: noInputs, dataset: { props: { experimentType: 'histonemod_noInput' } } })), []);
  assert.ok(chipseq.checkCurated(staged(t, { dataset: { props: { experimentType: 'histonemod_noInput' } } }))
    .includes('experimentType histonemod_noInput has input samples; use histonemod, or remove the inputs'));
});

test('warnings: an unused input, a ChIP without its input, a strategy the experiment type does not expect', (t) => {
  const dir = staged(t, {
    edit: (a) => { delete a.samples[3].input; }
  });
  assert.deepEqual(chipseq.curatedWarnings(dir), [
    'input BF_K125ac_Input is not the input of any ChIP sample',
    'ChIP sample BF_K125ac_ChIP has no input, so no peaks are called for it'
  ]);
  const mnase = staged(t, { dataset: { props: { experimentType: 'mnase' } } });
  assert.deepEqual(chipseq.curatedWarnings(mnase), ['SRR21, SRR22, SRR23, SRR24, SRR25: library_strategy ChIP-Seq, but experimentType mnase expects MNase-Seq']);
});

test('a WGS run is never a strategy mismatch', (t) => {
  const dir = staged(t, { dataset: { props: { experimentType: 'mnase' } } });
  const sra = join(dir, 'inputs', 'PRJNA000011_sra_metadata.json');
  const meta = JSON.parse(readFileSync(sra, 'utf-8'));
  meta.runs[0].library_strategy = 'WGS';
  writeFileSync(sra, JSON.stringify(meta));
  assert.deepEqual(chipseq.curatedWarnings(dir), ['SRR22, SRR23, SRR24, SRR25: library_strategy ChIP-Seq, but experimentType mnase expects MNase-Seq']);
});

test('a ChIP without its input calls no peaks only where peaks are called at all', (t) => {
  const dir = staged(t, { dataset: { props: { experimentType: 'tfbinding' } }, edit: (a) => { delete a.samples[3].input; } });
  assert.deepEqual(chipseq.curatedWarnings(dir), [
    'input BF_K125ac_Input is not the input of any ChIP sample',
    'ChIP sample BF_K125ac_ChIP has no input'
  ]);
});

test('no warnings before dataset.json names an experimentType', (t) => {
  const dir = staged(t, { dataset: { props: { experimentType: 'mnase' } } });
  rmSync(join(dir, 'curated', 'dataset.json'));
  assert.deepEqual(chipseq.curatedWarnings(dir), []);
});

test('no inputs at all is not a warning', (t) => {
  const dir = staged(t, {
    dataset: { props: { experimentType: 'tfbinding' } },
    edit: (a) => { a.samples = a.samples.filter((s) => s.role === 'chip'); for (const s of a.samples) delete s.input; }
  });
  assert.deepEqual(chipseq.curatedWarnings(dir), []);
});

test('chipseq artifacts, corpus and organism rule', (t) => {
  const dir = staged(t);
  assert.deepEqual(Object.keys(chipseq.renderArtifacts(dir).files).sort(), ['sampleAnnotations.json', 'samplesheet.csv']);
  assert.deepEqual(chipseq.corpus, { root: 'common/chipSeq/sampleDetailsForEda', layout: 'per-organism' });
  assert.deepEqual(Object.keys(chipseq.corpusFiles(dir)).sort(), ['entity-sample.tsv', 'entity-sample.yaml']);
  assert.deepEqual(chipseq.organismRule, { new: false, max: 1 });
  assert.equal(chipseq.requiredOrganismConstants, undefined);
});

test('chipseq is registered, labelled "chipseq", with its own validation workspace', () => {
  assert.equal(DATASET_TYPES.chipseq, chipseq);
  assert.deepEqual(organismRuleOf('chipseq'), { new: false, max: 1 });
  const cfg = JSON.parse(readFileSync(new URL('../shared/resources/curator.config.json', import.meta.url), 'utf-8'));
  assert.equal(cfg.ticket.github.typeLabels.chipseq, 'chipseq');
  assert.equal(validationWorkspaceFor('chipseq'), 'chipseq-validation');
});

const editRuns = (dir, edit) => {
  const sra = join(dir, 'inputs', 'PRJNA000011_sra_metadata.json');
  const meta = JSON.parse(readFileSync(sra, 'utf-8'));
  edit(meta.runs);
  writeFileSync(sra, JSON.stringify(meta));
};
const PRESENTER_OVERRIDES = { shortDisplayName: 'Tfak histone', shortAttribution: 'Doe 2025' };

test('the presenter assay ignores runs no sample uses', (t) => {
  const dir = staged(t);
  editRuns(dir, (runs) => {
    for (let i = 0; i < 6; i++) runs.push({ ...runs[0], run_accession: `SRR9${i}`, library_strategy: 'MNase-Seq' });
  });
  const p = chipseq.derivePresenter(dir, PRESENTER_OVERRIDES);
  assert.equal(p.displayName, 'ChIP-Seq analysis of Testus fakeus');
  assert.equal(p.summary, 'ChIP-Seq analysis of <i>Testus fakeus</i>');
});

test('the presenter names DNase-Hypersensitivity runs DNase-Seq', (t) => {
  const dir = staged(t);
  editRuns(dir, (runs) => { for (const r of runs) r.library_strategy = 'DNase-Hypersensitivity'; });
  assert.equal(chipseq.derivePresenter(dir, PRESENTER_OVERRIDES).displayName, 'DNase-Seq analysis of Testus fakeus');
});
