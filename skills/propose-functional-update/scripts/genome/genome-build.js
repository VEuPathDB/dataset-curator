import { existsSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { BUILD_FILES, SCHEMA_VERSION } from './record.js';
import { PipelineError, readJson, sha256File, workPaths } from './workdir.js';

const REFINALIZE = 'run build and finalize again';
const hasContent = (file) => existsSync(file) && statSync(file).size > 0;

export const partitionName = (part) => basename(part.dir);

/** genome-build.json as finalize wrote it, every final/ file it lists, and each annotated partition's build GFF3 unchanged. */
export function readGenomeBuild(workDir, command) {
  const p = workPaths(workDir);
  const build = readJson(p.genomeBuildJson, command, 'run finalize first');
  if (build?.schemaVersion !== SCHEMA_VERSION) {
    throw new PipelineError(command, p.genomeBuildJson, `has schemaVersion ${build?.schemaVersion}, not ${SCHEMA_VERSION}`, REFINALIZE);
  }
  const complete = /^[\w.]+$/.test(build.accession ?? '') && typeof build.apiCommonData?.isfMap?.sha256 === 'string'
    && Array.isArray(build.partitions) && build.partitions.length > 0
    && build.partitions.every((part) => typeof part?.dir === 'string' && part.final && typeof part.soTerm === 'string' && Number.isInteger(part.featureCount));
  if (!complete) throw new PipelineError(command, p.genomeBuildJson, 'is incomplete: it needs accession, apiCommonData.isfMap.sha256 and partitions', REFINALIZE);
  for (const part of build.partitions) {
    if (!part.final.fasta) throw new PipelineError(command, p.genomeBuildJson, `${partitionName(part)} has no final FASTA`, REFINALIZE);
    if (part.featureCount > 0 && !part.final.gff) {
      throw new PipelineError(command, p.genomeBuildJson, `${partitionName(part)} has featureCount ${part.featureCount} but no final GFF`, REFINALIZE);
    }
    for (const name of Object.values(part.final).filter(Boolean)) {
      const file = join(workDir, part.dir, name);
      if (!hasContent(file)) throw new PipelineError(command, file, 'is missing or empty', 'run finalize again');
    }
    const gff3 = join(p.buildDir, partitionName(part), BUILD_FILES.gff3);
    if (part.featureCount > 0 && (!existsSync(gff3) || sha256File(gff3) !== part.buildFiles?.gff3)) {
      throw new PipelineError(command, gff3, 'does not match genome-build.json', REFINALIZE);
    }
  }
  return { build, sha256: sha256File(p.genomeBuildJson) };
}
