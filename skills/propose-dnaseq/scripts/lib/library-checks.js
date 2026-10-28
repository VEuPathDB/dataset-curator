/** Quick checks that ENA runs are DNA sequencing with reads. Pure: runs in, messages out. */

export const MIN_SAMPLE_READS = 1_000_000;
export const MAX_ILLUMINA_READ_LENGTH = 300;
const RNA_SELECTIONS = new Set(['PolyA', 'cDNA', 'Oligo-dT', 'cDNA_randomPriming', 'cDNA_oligo_dT']);

const count = (v) => (/^\d+$/.test(String(v ?? '')) ? Number(v) : 0);
const isIllumina = (r) => (r.instrument_platform || '').toUpperCase() === 'ILLUMINA' || /illumina|novaseq|hiseq|nextseq|miseq/i.test(r.instrument_model || '');

/** { errors, warnings }: errors are hard stops; warnings are for the curator to accept or act on. */
export function libraryProblems(runs) {
  if (!runs.length) return { errors: ['No runs: the BioProject has no reads in SRA'], warnings: [] };
  const errors = [];
  const warnings = [];
  for (const r of runs) {
    const id = r.run_accession;
    for (const k of ['read_count', 'base_count']) if (!count(r[k])) errors.push(`${id}: ${k} is 0 or missing`);
    if (r.library_source !== 'GENOMIC') errors.push(`${id}: library_source is ${r.library_source || 'missing'}, not GENOMIC`);
  }
  for (const r of runs) {
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
  for (const r of runs) bySample.set(r.sample_accession, (bySample.get(r.sample_accession) ?? 0) + count(r.read_count));
  for (const [sample, reads] of bySample) if (reads < MIN_SAMPLE_READS) warnings.push(`${sample}: ${reads} reads, under ${MIN_SAMPLE_READS}`);
  return { errors, warnings };
}
