/** What single-organism SRA experiment types share: annotations, loading artifacts, the agreement check and the corpus. */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadManifest, readInputJson, readCuratedJson, onlyEntry, assertCuratedAgreeWith } from './_common.js';
import {
  DEFAULT_SOURCE, SAMPLESHEET_COLUMNS, normalizeSamples, samplesheet, parseSamplesheet, checkSamplesAgree, checkSampleRuns, checkSampleProvenance
} from './_sra-samples.js';
import { sampleAnnotationsToStf } from '../lib/stf.js';
import { organismsOf } from '../lib/manifest.js';

export const annotationsFile = (m) => `${m.accession}_sample_annotations.json`;
export const sraFile = (m) => `${m.accession}_sra_metadata.json`;
export const runsOf = (proposalDir, m) => readInputJson(proposalDir, sraFile(m)).runs || [];
export const organismOf = (m) => organismsOf(m)[0];
/** The run accessions the curated annotations keep. */
export const usedRuns = (proposalDir, m) => new Set((readCuratedJson(proposalDir, annotationsFile(m)).samples ?? []).flatMap((s) => s.runs ?? []));

const DERIVED_CURATED_FILES = ['samplesheet.csv', 'entity-sample.tsv', 'entity-sample.yaml'];
const abbrevOf = (m) => m.organisms[0].proposedOrganismAbbrev;
const curatedText = (proposalDir, abbrev, file) => readFileSync(join(proposalDir, 'curated', abbrev, file), 'utf-8');

/**
 * The shared exports of a single-organism, SRA-only type. extraColumns are its samplesheet columns after fastq_2,
 * each filled from the sample field of that name;
 * stfAnnotations adds type-specific STF columns; extraChecks({ proposalDir, annotations, sheet, versus }) adds agreement errors.
 */
export function sraExperimentType({ type, datasetNameFor, extraColumns = [], stfAnnotations = (a) => a, extraChecks = () => [] }) {

  function presenterNames(proposalDir) {
    const m = loadManifest(proposalDir);
    return [datasetNameFor(organismOf(m), onlyEntry(proposalDir, m).name)];
  }

  /** Phase 1: rewrites the staged annotations in normalized form; SRA only, one organism. */
  function normalizeCurated(proposalDir, datasetOverrides = {}) {
    const m = loadManifest(proposalDir);
    if (datasetOverrides?.source && datasetOverrides.source.type !== 'sra') throw new Error(`${type} reads from SRA only`);
    const annotations = readCuratedJson(proposalDir, annotationsFile(m));
    if (annotations.samples?.some((s) => s.organisms !== undefined)) throw new Error(`${type} proposals are single-organism; remove "organisms" from the samples in ${annotationsFile(m)}`);
    const normalized = normalizeSamples(annotations, runsOf(proposalDir, m), { source: DEFAULT_SOURCE });
    writeFileSync(join(proposalDir, 'curated', annotationsFile(m)), JSON.stringify(normalized, null, 2) + '\n');
  }

  /** Phase 1: the organism's loading artifacts, keyed <proposed abbreviation>/<file>. */
  function deriveArtifacts(proposalDir) {
    const m = loadManifest(proposalDir);
    const annotations = readCuratedJson(proposalDir, annotationsFile(m));
    const p = abbrevOf(m);
    const columns = [...SAMPLESHEET_COLUMNS, ...extraColumns];
    const { tsv, yaml } = sampleAnnotationsToStf(stfAnnotations(annotations), { sra: true });
    return { [`${p}/samplesheet.csv`]: samplesheet(annotations.samples, { columns }), [`${p}/entity-sample.tsv`]: tsv, [`${p}/entity-sample.yaml`]: yaml };
  }

  /** Errors when the curated artifacts and the sample annotations disagree. */
  function checkCurated(proposalDir) {
    const m = loadManifest(proposalDir);
    const p = abbrevOf(m);
    const name = annotationsFile(m);
    const missing = [name, ...DERIVED_CURATED_FILES.map((f) => `${p}/${f}`)].filter((f) => !existsSync(join(proposalDir, 'curated', f)));
    if (missing.length) return missing.map((f) => `curated/${f} is missing; re-run write-proposal.js`);
    let annotations;
    try { annotations = JSON.parse(readFileSync(join(proposalDir, 'curated', name), 'utf-8')); }
    catch (e) { return [`${name} is not valid JSON: ${e.message}`]; }
    if (annotations === null || typeof annotations !== 'object' || Array.isArray(annotations)) return [`${name} must be a JSON object`];
    if (!Array.isArray(annotations.samples)) return [`${name} has no "samples" array`];
    const text = curatedText(proposalDir, p, 'samplesheet.csv');
    const tsv = curatedText(proposalDir, p, 'entity-sample.tsv');
    const sheet = parseSamplesheet(text, { columns: [...SAMPLESHEET_COLUMNS, ...extraColumns] });
    return [
      ...sheet.errors,
      ...sheet.rows.filter((r) => r.fastq2).map((r) => `samplesheet.csv line ${r.line} (${r.sample}) has a fastq_2, but an SRA source lists each run once`),
      ...checkSamplesAgree({ samplesheet: text, tsv, sampleIds: annotations.samples.map((s) => s.sampleId), versus: name }),
      ...checkSampleRuns({ samplesheet: text, samples: annotations.samples, versus: name }),
      ...checkSampleProvenance({ tsv, samples: annotations.samples, versus: name }),
      ...extraChecks({ proposalDir, annotations, sheet, versus: name })
    ];
  }

  const assertCuratedAgree = assertCuratedAgreeWith(checkCurated);

  /** Phase 2 (and the Phase 1 preview): the curated artifacts laid out for the delivery directory. */
  function renderArtifacts(proposalDir) {
    const m = loadManifest(proposalDir);
    assertCuratedAgree(proposalDir);
    return {
      files: {
        'samplesheet.csv': curatedText(proposalDir, abbrevOf(m), 'samplesheet.csv'),
        'sampleAnnotations.json': readFileSync(join(proposalDir, 'curated', annotationsFile(m)), 'utf-8')
      }
    };
  }

  function corpusFiles(proposalDir) {
    const p = abbrevOf(loadManifest(proposalDir));
    return { 'entity-sample.tsv': curatedText(proposalDir, p, 'entity-sample.tsv'), 'entity-sample.yaml': curatedText(proposalDir, p, 'entity-sample.yaml') };
  }

  return {
    derivedCuratedFiles: DERIVED_CURATED_FILES, presenterNames, normalizeCurated, deriveArtifacts, checkCurated, assertCuratedAgree, renderArtifacts, corpusFiles,
    stagingProblems: () => []
  };
}
