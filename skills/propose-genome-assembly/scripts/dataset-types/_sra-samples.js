/** Sample handling shared by dataset types whose reads come from SRA runs or curator-named files. */
import { externalIdKindOf } from '../lib/manifest.js';

export const DEFAULT_SOURCE = { type: 'sra' };

const SAMPLE_ID = /^[A-Za-z0-9_.-]+$/;
const REPLICATE_SUFFIX = /[\s_](replicate[\s_]?|rep|R)\d+$/i;
const FILE_NAME = /^[^/\\\s,]+$/;
const toSampleId = (title) => title.trim().replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/^_+|_+$/g, '');
/** analysisConfig.xml joins label|sampleId, so a label holds no pipe. */
const withoutPipes = (title) => title.replace(/\|/g, ' ').replace(/\s+/g, ' ').trim();

const EXPERIMENT_FIELDS = ['experiment_title', 'library_name', 'submission_accession', 'first_public'];

const groupBy = (items, key) => items.reduce((groups, item) => groups.set(item[key], [...(groups.get(item[key]) ?? []), item]), new Map());

/** BioSamples whose runs span SRA experiments that differ in title, library name, submission or release date. */
export function mixedBioSamples(runs) {
  const missing = runs.filter((r) => !r.experiment_accession).map((r) => r.run_accession);
  if (missing.length) throw new Error(`Runs ${missing.join(', ')} have no experiment_accession; re-run fetch-sra-metadata.js`);
  return [...groupBy(runs, 'sample_accession')].flatMap(([biosample, own]) => {
    const experiments = [...groupBy(own, 'experiment_accession')].map(([experiment, rs]) => ({
      experiment, runs: rs.map((r) => r.run_accession), ...Object.fromEntries(EXPERIMENT_FIELDS.map((f) => [f, rs[0][f] ?? '']))
    }));
    const differing = EXPERIMENT_FIELDS.filter((f) => new Set(experiments.map((e) => e[f])).size > 1);
    return experiments.length > 1 && differing.length ? [{ biosample, experiments, differing }] : [];
  });
}

/** A curator label, trimmed; blank counts as absent, and one with a pipe is refused. */
function curatorLabel(label, who) {
  if (typeof label !== 'string') return label;
  if (label.includes('|')) throw new Error(`Sample ${who}: label "${label}" may not contain |`);
  return label.trim() || undefined;
}

function assertSampleIds(samples) {
  const seen = new Set();
  for (const { sampleId } of samples) {
    if (!SAMPLE_ID.test(sampleId)) throw new Error(`sampleId "${sampleId}" may contain only letters, digits, _, . and -`);
    if (seen.has(sampleId)) throw new Error(`sampleId "${sampleId}" is used twice`);
    seen.add(sampleId);
  }
  return samples;
}

/** Reads not in SRA: the curator names each sample and its files; the source says where they are. */
function normalizeFileSamples(annotations) {
  const listed = new Set();
  return annotations.samples.map((s, i) => {
    const who = s.sampleId ?? s.label ?? `sample #${i + 1}`;
    if (s.runs !== undefined) throw new Error(`Sample ${who}: a server or url source lists files, not runs`);
    const label = curatorLabel(s.label, who);
    if (!s.sampleId) throw new Error(`Sample ${who}: reads not in SRA need a sampleId from the curator`);
    if (!Array.isArray(s.files) || !s.files.length) throw new Error(`Sample ${who}: files must list at least one { fastq_1, fastq_2 }`);
    for (const f of s.files) {
      if (!f?.fastq_1) throw new Error(`Sample ${who}: every files entry needs fastq_1`);
      for (const k of ['fastq_1', 'fastq_2']) {
        if (f[k] !== undefined && !(typeof f[k] === 'string' && FILE_NAME.test(f[k]))) {
          throw new Error(`Sample ${who}: ${k} "${f[k]}" must be a bare file name: no directory, spaces or commas`);
        }
        if (f[k] === undefined) continue;
        if (listed.has(f[k])) throw new Error(`Sample ${who}: file "${f[k]}" is listed twice`);
        listed.add(f[k]);
      }
    }
    return { ...s, label: label ?? s.sampleId };
  });
}

/**
 * Every sample gets a sampleId the samplesheet, STF and analysisConfig all
 * use, and a label replicates share. For SRA reads each also gets its
 * BioSample; the SRA sample title names the samples without a sampleId when
 * each has a distinct one that no curator sampleId uses; otherwise the
 * BioSample does. The label defaults to the title minus any replicate suffix
 * and pipes, however the id was chosen. A sampleId or label already in the
 * annotations is the curator's, and a curator label with a pipe is refused.
 */
export function normalizeSamples(annotations, runs, { source = DEFAULT_SOURCE } = {}) {
  if (source.type !== 'sra') return { ...annotations, samples: assertSampleIds(normalizeFileSamples(annotations)) };
  const byRun = new Map(runs.map((r) => [r.run_accession, r]));
  const drafts = annotations.samples.map((s, i) => {
    const who = s.sampleId ?? s.label ?? ((s.runs || []).join(',') || `sample #${i + 1}`);
    if (s.files !== undefined) throw new Error(`Sample ${who}: an sra source lists runs, not files`);
    const label = curatorLabel(s.label, who);
    if (!(s.runs || []).length) throw new Error(`Sample ${who}: lists no runs`);
    const own = s.runs.map((id) => {
      if (!byRun.has(id)) throw new Error(`Sample ${who}: run ${id} is not in the SRA metadata`);
      return byRun.get(id);
    });
    const distinct = (key) => [...new Set(own.map((r) => r[key]).filter(Boolean))];
    const biosamples = s.biosample ? [s.biosample] : distinct('sample_accession');
    if (biosamples.length !== 1) {
      throw new Error(`Sample ${who}: its runs come from ${biosamples.length} BioSamples (${biosamples.join(', ')}); one sample needs exactly one`);
    }
    const titles = [...new Set(distinct('sample_title').map((t) => t.trim()).filter(Boolean))];
    const sample = { ...s, label, biosample: biosamples[0] };
    if (label === undefined) delete sample.label;
    return { sample, title: titles.length === 1 ? titles[0] : undefined };
  });
  const ids = drafts.map((d) => d.title && toSampleId(d.title));
  const chosen = new Set(drafts.map((d) => d.sample.sampleId).filter(Boolean));
  const unnamed = ids.filter((id, i) => !drafts[i].sample.sampleId);
  const byTitle = unnamed.every(Boolean) && new Set(unnamed).size === unnamed.length && !unnamed.some((id) => chosen.has(id));
  const samples = drafts.map(({ sample, title }, i) => {
    const sampleId = sample.sampleId ?? (byTitle ? ids[i] : sample.biosample);
    const stripped = title ? withoutPipes(title.replace(REPLICATE_SUFFIX, '')) : '';
    return { ...sample, sampleId, label: sample.label ?? (stripped || withoutPipes(title || '') || sampleId) };
  });
  return { ...annotations, samples: assertSampleIds(samples) };
}

/** "only in a: ...; only in b: ..." when the sets differ, else undefined. */
function onlyIn(a, aName, b, bName) {
  const onlyA = [...a].filter((x) => !b.has(x));
  const onlyB = [...b].filter((x) => !a.has(x));
  if (!onlyA.length && !onlyB.length) return undefined;
  return `only in ${aName}: ${onlyA.join(', ') || 'none'}; only in ${bName}: ${onlyB.join(', ') || 'none'}`;
}

export function differ(a, aName, b, bName) {
  const diff = onlyIn(a, aName, b, bName);
  return diff ? [`${aName} and ${bName} disagree: ${diff}`] : [];
}

/** Errors when the samplesheet's fastq_1 values for a sample are not that sample's runs; ids missing from either side are checkSamplesAgree's. */
export function checkSampleRuns({ samplesheet: text, samples, versus }) {
  const sheetRuns = new Map();
  for (const r of parseSamplesheet(text).rows) sheetRuns.set(r.sample, (sheetRuns.get(r.sample) ?? new Set()).add(r.fastq1));
  return samples.filter((s) => sheetRuns.has(s.sampleId)).flatMap((s) => {
    const diff = onlyIn(sheetRuns.get(s.sampleId), 'samplesheet.csv', new Set(s.runs ?? []), versus);
    return diff ? [`samplesheet.csv runs of ${s.sampleId} differ from ${versus}: ${diff}`] : [];
  });
}

/** The manifest's external ids, with the accession's own; older manifests have no externalIds. */
export const externalIdsOf = (m) => ({ ...(externalIdKindOf(m.accession) ? { [externalIdKindOf(m.accession)]: m.accession } : {}), ...m.externalIds });

export function bioprojectLinks(m) {
  const { bioproject } = externalIdsOf(m);
  return bioproject ? [{ text: 'NCBI Bioproject', url: `https://www.ncbi.nlm.nih.gov/bioproject/${bioproject}` }] : [];
}

/** The presenter methodology from the runs' library strategies, layouts and instruments. */
export function methodologyFrom(runs) {
  const uniq = (key) => [...new Set(runs.map((r) => r[key]).filter(Boolean))];
  return [['Library strategy', 'library_strategy'], ['Layout', 'library_layout'], ['Sequencing', 'instrument_model']]
    .map(([label, key]) => [label, uniq(key)]).filter(([, v]) => v.length).map(([label, v]) => `${label}: ${v.join(', ')}`).join('. ');
}

export const SAMPLESHEET_HEADER = 'sample,fastq_1,fastq_2';

/**
 * One row per run or files entry. An SRA run appears once with fastq_2 empty;
 * downstream expands the run into its paired files.
 */
export function samplesheet(samples) {
  const rows = samples
    .flatMap((s) => (s.files
      ? s.files.map((f) => [s.sampleId, f.fastq_1, f.fastq_2 ?? ''])
      : (s.runs || []).map((run) => [s.sampleId, run, ''])))
    .sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
  return [SAMPLESHEET_HEADER, ...rows.map((r) => r.join(','))].join('\n') + '\n';
}

export function parseSamplesheet(text) {
  const [header, ...lines] = text.split(/\r?\n/);
  const errors = header.trim() === SAMPLESHEET_HEADER ? [] : [`samplesheet.csv header must be ${SAMPLESHEET_HEADER}`];
  const rows = lines
    .map((l, i) => ({ l: l.trim(), line: i + 2 }))
    .filter(({ l }) => l)
    .map(({ l, line }) => {
      const cells = l.split(',').map((c) => c.trim());
      const [sample, fastq1, fastq2] = cells;
      if (cells.length !== 3) errors.push(`samplesheet.csv line ${line} has ${cells.length} columns; expected 3`);
      else if (!sample) errors.push(`samplesheet.csv line ${line} has no sample`);
      else if (!fastq1) errors.push(`samplesheet.csv line ${line} (${sample}) has no fastq_1`);
      return { line, sample, fastq1, fastq2: fastq2 ?? '' };
    });
  return { errors, rows };
}

/** The sample ids in an entity-sample.tsv: column 1 of every row after the header. */
export const stfSampleIds = (tsv) => new Set(tsv.split(/\r?\n/).slice(1).filter((l) => l.trim()).map((l) => l.split('\t')[0].trim()));

/**
 * The check that matters most to loading: samplesheet sample names, STF ids and
 * the annotations' sampleIds are one set. versus names the annotations in messages.
 */
export function checkSamplesAgree({ samplesheet: text, tsv, sampleIds, versus }) {
  const sheetIds = new Set(parseSamplesheet(text).rows.map((r) => r.sample));
  return [
    ...differ(sheetIds, 'samplesheet.csv', stfSampleIds(tsv), 'entity-sample.tsv'),
    ...differ(sheetIds, 'samplesheet.csv', new Set(sampleIds), versus)
  ];
}
