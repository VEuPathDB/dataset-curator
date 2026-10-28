/** Quick checks that ENA runs are DNA sequencing with reads. Pure: runs in, messages out. */

export const MIN_SAMPLE_READS = 1_000_000;
export const MAX_ILLUMINA_READ_LENGTH = 300;
const RNA_SELECTIONS = new Set([
  'PolyA', 'cDNA', 'Oligo-dT', 'cDNA_randomPriming', 'cDNA_oligo_dT', 'RT-PCR', 'Inverse rRNA', 'Inverse rRNA selection'
]);

const count = (v) => (/^\d+$/.test(String(v ?? '')) ? Number(v) : 0);
const isIllumina = (r) => (r.instrument_platform || '').toUpperCase() === 'ILLUMINA' || /illumina|novaseq|hiseq|nextseq|miseq/i.test(r.instrument_model || '');

/**
 * { errors, projectErrors, runErrors, warnings }: errors (project then run) are hard stops.
 * used, a set of run accessions, limits the per-run checks and depth to the runs a proposal keeps.
 */
export function libraryProblems(runs, { used } = {}) {
  if (!runs.length) return problems(['No runs: the BioProject has no reads in SRA'], [], []);
  const projectErrors = runs.some((r) => r.library_source === 'GENOMIC') ? [] : ['No GENOMIC runs: the BioProject has no DNA sequencing'];
  const kept = used ? runs.filter((r) => used.has(r.run_accession)) : runs;
  const runErrors = [];
  const warnings = [];
  for (const r of kept) {
    const id = r.run_accession;
    for (const k of ['read_count', 'base_count']) if (!count(r[k])) runErrors.push(`${id}: ${k} is 0 or missing`);
    if (r.library_source !== 'GENOMIC') runErrors.push(`${id}: library_source is ${r.library_source || 'missing'}, not GENOMIC`);
  }
  for (const r of kept) {
    const id = r.run_accession;
    if (r.library_strategy !== 'WGS') warnings.push(`${id}: library_strategy is ${r.library_strategy || 'missing'}, not WGS`);
    if (RNA_SELECTIONS.has(r.library_selection)) warnings.push(`${id}: library_selection ${r.library_selection} is an RNA selection`);
    const reads = count(r.read_count);
    const mates = (r.library_layout || '').toUpperCase() === 'PAIRED' ? 2 : 1;
    const length = reads ? Math.round(count(r.base_count) / reads / mates) : 0;
    if (isIllumina(r) && length > MAX_ILLUMINA_READ_LENGTH) {
      warnings.push(`${id}: mean read length ${length} bp is implausible for ${r.instrument_model || 'Illumina'} (over ${MAX_ILLUMINA_READ_LENGTH})`);
    }
  }
  const bySample = new Map();
  for (const r of kept) bySample.set(r.sample_accession, [...(bySample.get(r.sample_accession) ?? []), r]);
  for (const [sample, own] of bySample) {
    const reads = own.reduce((n, r) => n + count(r.read_count), 0);
    if (own.every(isIllumina) && reads < MIN_SAMPLE_READS) warnings.push(`${sample}: ${reads} reads, under ${MIN_SAMPLE_READS}`);
  }
  return problems(projectErrors, runErrors, warnings);
}

const problems = (projectErrors, runErrors, warnings) => ({ errors: [...projectErrors, ...runErrors], projectErrors, runErrors, warnings });
