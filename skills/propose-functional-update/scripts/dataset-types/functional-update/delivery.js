import { join } from 'node:path';
import { loadManifest, onlyEntry } from '../_common.js';
import { checkConvertCurrent, tryReadConverted } from './record.js';

/** The convert.json read and checked once per delivery, with the problems every location shares. */
function checkedConversion(proposalDir, workArea, report, cache) {
  if (cache.shared) return cache.shared;
  const entry = onlyEntry(proposalDir, loadManifest(proposalDir));
  const converted = tryReadConverted(workArea);
  const problems = checkConvertCurrent(workArea, entry, converted);
  if (!problems.length) {
    if (!report?.preprocess?.convert) problems.push('the verification report records no conversion; validate again');
    else if (report.preprocess.convert !== converted.sha256) problems.push('the work area changed since validation; validate again');
  }
  cache.shared = { record: converted?.record ?? null, sha256: converted?.sha256 ?? null, problems };
  return cache.shared;
}

/** prepare-delivery: the converted file for the one entry location, once the current report validated that conversion. */
export function preprocessedFiles(proposalDir, location, { workArea, report = null, cache = {} }) {
  const { record, sha256, problems: shared } = checkedConversion(proposalDir, workArea, report, cache);
  if (!record?.gff || !record.input) return { files: [], problems: [...shared], provenance: null };
  const problems = [...shared];
  if (!problems.length && record.file !== location.file) problems.push(`convert.json gives ${record.file}, but the class loads ${location.file}`);
  return {
    files: problems.length ? [] : [{ path: location.file, from: join(workArea, 'final', record.file) }],
    problems,
    provenance: { convert: sha256, gff: record.gff.pinnedUrl ?? record.gff.url, gffSha256: record.gff.sha256, input: record.input.sha256 }
  };
}
