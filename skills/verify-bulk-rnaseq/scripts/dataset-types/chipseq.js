import {
  loadManifest, readCuratedJson, readPresenter, applyOverrides, blankPropErrors, datasetsOf, onlyEntry,
  assertValidDataset, PRESENTER_SCHEMA_VERSION, DATASET_SCHEMA_VERSION, escapeXml, injectorProps,
  requireBuild, presenterBodyXml
} from './_common.js';
import { DEFAULT_SOURCE, bioprojectLinks, methodologyFrom } from './_sra-samples.js';
import { sraExperimentType, annotationsFile, runsOf, usedRuns, organismOf } from './_sra-experiment.js';
import { libraryProblems } from '../lib/library-checks.js';

export const datasetClasses = ['chipSeqExperiment'];
export const singleEntry = true;
export const EXPERIMENT_TYPES = ['histonemod', 'histonemod_noInput', 'tfbinding', 'mnase', 'faire', 'dnase'];
/** The build calls peaks for these experiment types and no others. */
export const PEAK_CALLING_TYPES = ['histonemod'];
const STRATEGY_OF = {
  histonemod: 'ChIP-Seq', histonemod_noInput: 'ChIP-Seq', tfbinding: 'ChIP-Seq', mnase: 'MNase-Seq', faire: 'FAIRE-seq', dnase: 'DNase-Hypersensitivity'
};
const DISPLAY_STRATEGY = { 'DNase-Hypersensitivity': 'DNase-Seq', 'FAIRE-seq': 'FAIRE-Seq' };
/** Submitters often label input libraries WGS. */
export const libraryStrategies = [...new Set(Object.values(STRATEGY_OF)), 'WGS'];
export const injectorDefaults = { hasCalledPeaks: 'false', key: '', subTrackAttr: 'name' };
export const requiredFields = ['shortDisplayName', 'shortAttribution'];

const INJECTOR = 'org.apidb.apicommon.model.datasetInjector.ChIPSeq';
const ROLE_LABELS = { chip: 'ChIP', input: 'Input' };
const DERIVED_PROPS = ['hasPairedEnds', 'readsFileType', 'fromSRA'];
const OPTIONAL_PROPS = ['extraBowtieParams'];
const PEAKS_DERIVED = 'hasCalledPeaks follows dataset.props.experimentType (peaks are called only for histonemod); remove it';
export const datasetNameFor = (organism, name) => `${organism}_${name}_chipSeq_RSRC`;
export const corpus = { root: 'common/chipSeq/sampleDetailsForEda', layout: 'per-organism' };

const experimentTypeOf = (proposalDir, m = loadManifest(proposalDir)) => datasetsOf(proposalDir, m)[0]?.props?.experimentType;
const isRole = (role) => Object.hasOwn(ROLE_LABELS, role);

/** hasPairedEnds from the used runs' one library layout. */
function pairedEndsOf(proposalDir, m) {
  const used = usedRuns(proposalDir, m);
  const layouts = [...new Set(runsOf(proposalDir, m).filter((r) => used.has(r.run_accession)).map((r) => (r.library_layout || 'missing').toUpperCase()))].sort();
  if (layouts.length !== 1) throw new Error(`Runs of ${m.accession} mix library layouts (${layouts.join(', ')}); the mapper takes one layout per experiment`);
  return String(layouts[0] === 'PAIRED');
}

/** The role column in the STF, ahead of the curator's factors. */
const withRole = (a) => ({
  ...a,
  factors: { role: { displayName: 'ChIP role' }, ...a.factors },
  samples: a.samples.map((s) => ({ ...s, factors: { role: isRole(s.role) ? ROLE_LABELS[s.role] : '', ...s.factors } }))
});

function pairingErrors({ proposalDir, annotations, sheet, versus }) {
  const errors = [];
  if (annotations.factors?.role) errors.push('factor "role" is reserved: the STF role column comes from each sample\'s role');
  const byId = new Map(annotations.samples.map((s) => [s.sampleId, s]));
  for (const s of annotations.samples) {
    if (!isRole(s.role)) { errors.push(`Sample ${s.sampleId}: role must be chip or input`); continue; }
    if (!s.input) continue;
    const target = byId.get(s.input);
    if (s.role === 'input') errors.push(`Sample ${s.sampleId}: an input sample may not name an input`);
    else if (!target) errors.push(`Sample ${s.sampleId}: input ${s.input} is not a sample of this experiment`);
    else if (target.role !== 'input') errors.push(`Sample ${s.sampleId}: input ${s.input} has role ${target.role}, not input`);
  }
  for (const r of sheet.rows) {
    if (!byId.has(r.sample)) continue;
    const want = byId.get(r.sample).input || '';
    if (r.extra.input !== want) errors.push(`samplesheet.csv line ${r.line} (${r.sample}) has input "${r.extra.input}" but ${versus} has "${want}"`);
  }
  const type = experimentTypeOf(proposalDir);
  const hasInputs = annotations.samples.some((s) => s.role === 'input');
  if (type === 'histonemod' && !hasInputs) errors.push('experimentType histonemod needs input samples; use histonemod_noInput for an experiment without them');
  if (type === 'histonemod_noInput' && hasInputs) errors.push('experimentType histonemod_noInput has input samples; use histonemod, or remove the inputs');
  return errors;
}

export const {
  derivedCuratedFiles, presenterNames, normalizeCurated, deriveArtifacts, checkCurated, assertCuratedAgree, renderArtifacts, corpusFiles, stagingProblems
} = sraExperimentType({
  type: 'chipseq', datasetNameFor, extraColumns: ['input'], stfAnnotations: withRole, extraChecks: pairingErrors
});

/** No GEO series dates a ChIP-seq proposal, so the curator supplies name and version. */
export const deriveIdentity = () => ({ version: undefined, name: undefined });

/** Phase 1: the presenter record. The assay in the display name is the used runs' commonest non-WGS strategy. */
export function derivePresenter(proposalDir, overrides = {}) {
  if (overrides.injectorProps?.hasCalledPeaks !== undefined) throw new Error(`presenter.injectorProps.${PEAKS_DERIVED}`);
  const m = loadManifest(proposalDir);
  const runs = runsOf(proposalDir, m);
  const species = runs.map((r) => r.scientific_name).find(Boolean);
  if (!species) throw new Error(`No scientific_name in any run of ${m.accession}`);
  const used = usedRuns(proposalDir, m);
  const counts = new Map();
  for (const r of runs) {
    if (used.has(r.run_accession) && r.library_strategy && r.library_strategy !== 'WGS') counts.set(r.library_strategy, (counts.get(r.library_strategy) ?? 0) + 1);
  }
  const strategy = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'ChIP-Seq';
  const assay = DISPLAY_STRATEGY[strategy] ?? strategy;
  return applyOverrides({
    schemaVersion: PRESENTER_SCHEMA_VERSION,
    displayName: `${assay} analysis of ${species}`,
    shortDisplayName: '',
    shortAttribution: '',
    summary: `${assay} analysis of <i>${species}</i>`,
    description: [...new Set(runs.map((r) => r.experiment_title).filter(Boolean))][0] || '',
    methodology: methodologyFrom(runs),
    protocol: '', caveat: '', acknowledgement: '', releasePolicy: '',
    pubmedIds: [],
    links: bioprojectLinks(m),
    history: {},
    injectorProps: {}
  }, overrides);
}

export function renderPresenter(proposalDir, { build } = {}) {
  requireBuild(build);
  const m = loadManifest(proposalDir);
  const entry = onlyEntry(proposalDir, m);
  const p = readPresenter(proposalDir, { requiredFields });
  if (p.injectorProps?.hasCalledPeaks !== undefined) throw new Error(`curated/presenter.json of ${m.accession}: injectorProps.${PEAKS_DERIVED}`);
  const hasCalledPeaks = String(PEAK_CALLING_TYPES.includes(entry.props.experimentType));
  return `  <datasetPresenter name="${escapeXml(datasetNameFor(organismOf(m), entry.name))}"
                    projectName="${escapeXml(m.organisms[0].project)}">
${presenterBodyXml(p, m, build)}    <templateInjector className="${INJECTOR}">
${injectorProps(injectorDefaults, { ...p.injectorProps, hasCalledPeaks })}
    </templateInjector>
  </datasetPresenter>`;
}

const derivedProps = (proposalDir, m) => ({ hasPairedEnds: pairedEndsOf(proposalDir, m), fromSRA: 'true', readsFileType: 'fastq' });

/** Phase 1: the chipSeqExperiment record. The curator picks experimentType; layout, file type and source are derived. */
export function deriveDataset(proposalDir, classDef, overrides = {}) {
  const m = loadManifest(proposalDir);
  if (overrides.source && overrides.source.type !== 'sra') throw new Error('chipseq reads from SRA only');
  for (const k of DERIVED_PROPS) if (overrides.props?.[k] !== undefined) throw new Error(`dataset.props.${k} is derived; remove it from --overrides`);
  const experimentType = overrides.props?.experimentType;
  if (!EXPERIMENT_TYPES.includes(experimentType)) {
    throw new Error(`dataset.props.experimentType must be one of ${EXPERIMENT_TYPES.join(', ')}; set it under "dataset": { "props": { ... } } in --overrides`);
  }
  const runs = runsOf(proposalDir, m);
  const { errors } = libraryProblems(runs, { used: usedRuns(proposalDir, m), strategies: libraryStrategies });
  if (errors.length) throw new Error(`Runs of ${m.accession} fail the library checks:\n  - ${errors.join('\n  - ')}`);
  const record = {
    schemaVersion: DATASET_SCHEMA_VERSION,
    props: { extraBowtieParams: '', ...overrides.props, ...derivedProps(proposalDir, m) },
    source: DEFAULT_SOURCE
  };
  assertValidDataset(record, classDef, { runAccessions: runs.map((r) => r.run_accession), optionalProps: OPTIONAL_PROPS }, `dataset for ${m.accession} (set values under "dataset" in --overrides)`);
  return record;
}

/** Render-time rules beyond the class props: no empty prop but the optional ones, the experimentType vocabulary, derived props as derived. */
export function entryProblems(proposalDir, manifest, entry, classDef) {
  const derived = Object.entries(derivedProps(proposalDir, manifest))
    .filter(([k, v]) => entry.props[k] !== v)
    .map(([k, v]) => `props.${k} must be ${v} (it is derived; re-run write-proposal.js)`);
  return [
    ...blankPropErrors(entry, classDef, OPTIONAL_PROPS),
    ...(EXPERIMENT_TYPES.includes(entry.props.experimentType) ? [] : [`props.experimentType must be one of ${EXPERIMENT_TYPES.join(', ')}`]),
    ...derived
  ];
}

/** Phase 1: what write-proposal prints for the curator once the records agree. */
export function curatedWarnings(proposalDir) {
  const m = loadManifest(proposalDir);
  const { samples = [] } = readCuratedJson(proposalDir, annotationsFile(m));
  const type = experimentTypeOf(proposalDir, m);
  if (type === undefined) return [];
  const inputs = samples.filter((s) => s.role === 'input');
  const named = new Set(samples.map((s) => s.input).filter(Boolean));
  const warnings = inputs.filter((s) => !named.has(s.sampleId)).map((s) => `input ${s.sampleId} is not the input of any ChIP sample`);
  if (inputs.length) {
    const peaks = PEAK_CALLING_TYPES.includes(type) ? ', so no peaks are called for it' : '';
    for (const s of samples.filter((x) => x.role === 'chip' && !x.input)) warnings.push(`ChIP sample ${s.sampleId} has no input${peaks}`);
  }
  const expected = STRATEGY_OF[type];
  const used = usedRuns(proposalDir, m);
  const off = new Map();
  for (const r of runsOf(proposalDir, m)) {
    if (!used.has(r.run_accession) || r.library_strategy === expected || r.library_strategy === 'WGS') continue;
    off.set(r.library_strategy, [...(off.get(r.library_strategy) ?? []), r.run_accession]);
  }
  for (const [strategy, ids] of off) warnings.push(`${ids.join(', ')}: library_strategy ${strategy || 'missing'}, but experimentType ${type} expects ${expected}`);
  return warnings;
}
