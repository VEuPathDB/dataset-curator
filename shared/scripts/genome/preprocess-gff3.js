import { existsSync, statSync } from 'node:fs';
import { defaultExec, failureOutput } from '../lib/tools/exec.js';

export const MAP_PATH = 'Load/lib/xml/isf/genemRNAExonCDS2Gus.xml';
export const SCRIPT_PATH = 'Load/bin/preprocessGFF3';
export const BIO_SEQIO_FIX = 'preprocessGFF3 needs only core Perl modules once its unused `use Bio::SeqIO;` line is removed '
  + '(a separate ApiCommonData change); until then install BioPerl, or pass --preprocessGFF3 <a copy without that line>';

/** null when the script compiles, else what perl printed. Throws when perl itself is missing. */
export function compileProblem(script, { exec = defaultExec, perl = 'perl' } = {}) {
  try {
    exec(perl, ['-c', script]);
    return null;
  } catch (e) {
    if (e.code === 'ENOENT') throw new Error(`${perl} is not on PATH`);
    return failureOutput(e);
  }
}

export function runPreprocessGFF3(script, input, output, { exec = defaultExec, perl = 'perl' } = {}) {
  try {
    exec(perl, [script, '--input_gff', input, '--output_gff', output]);
  } catch (e) {
    throw new Error(`preprocessGFF3 failed on ${input}: ${failureOutput(e)}`);
  }
  if (!existsSync(output) || statSync(output).size === 0) throw new Error(`preprocessGFF3 wrote nothing to ${output}`);
}

export function apiCommonDataCommit(dir, { exec = defaultExec } = {}) {
  try {
    return exec('git', ['-C', dir, 'rev-parse', 'HEAD']).trim();
  } catch (e) {
    throw new Error(`${dir} is not a git checkout: ${failureOutput(e)}`);
  }
}
