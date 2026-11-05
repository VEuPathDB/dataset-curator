import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { BUILD_FILES, SCHEMA_VERSION } from '../record.js';
import { inspectImage, readImageFile, selectRows } from '../trial/gus.js';
import { releasesSql, sqlString } from '../trial/qa.js';
import { isfMapIn, partitionName } from '../trial/steps.js';
import { PipelineError, readJson, sha256, sha256File, workPaths } from '../workdir.js';

export const DATABASE_SQL = '-- trial:database\nSELECT current_database() AS name';
export const SO_SQL = '-- trial:soRelease\nSELECT count(*) AS n FROM sres.externaldatabase d'
  + " JOIN sres.externaldatabaserelease r ON r.external_database_id = d.external_database_id WHERE d.name = 'SO_RSRC'";
export const taxonSql = (taxonId) => '-- trial:taxon\nSELECT t.taxon_id, t.genetic_code_id,'
  + ' (SELECT count(*) FROM sres.geneticcode g WHERE g.genetic_code_id = t.genetic_code_id) AS codes'
  + ` FROM sres.taxon t WHERE t.ncbi_tax_id = ${Number(taxonId)}`;
const likeEscape = (text) => text.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Every external database this accession's trials create, matched exactly: `_` is a LIKE wildcard, so it is escaped. */
export const leftoverDatabasesSql = (accession) => '-- trial:leftoverDatabases\nSELECT d.name FROM sres.externaldatabase d'
  + ` WHERE d.name LIKE ${sqlString(`${likeEscape('curatorTrial_')}${likeEscape(accession)}${likeEscape('_')}%`)} ESCAPE '\\'`
  + ' ORDER BY d.name';
const REFINALIZE = 'run build and finalize again';
const GUS_CONFIG_NEXT = 'pass --gusConfig <the gus.config naming the target database>';

export function checkTrialOptions({ image, gusConfig, taxonId }, { undo = false } = {}) {
  if (!image) throw new PipelineError('trial', '--image', 'is required', 'pass --image <a gus_isf image>');
  if (!gusConfig) throw new PipelineError('trial', '--gusConfig', 'is required', GUS_CONFIG_NEXT);
  if (!existsSync(gusConfig)) throw new PipelineError('trial', gusConfig, 'is missing', GUS_CONFIG_NEXT);
  if (!statSync(gusConfig).isFile()) throw new PipelineError('trial', gusConfig, 'is not a file', GUS_CONFIG_NEXT);
  if (!undo && !(Number.isInteger(taxonId) && taxonId > 0)) {
    throw new PipelineError('trial', '--taxonId', 'must be an NCBI taxon id', 'pass --taxonId <ncbi taxon id>');
  }
}

/** genome-build.json as finalize wrote it, every final/ file it lists, and the build GFF3 QA reads gene trees from. */
export function readGenomeBuild(workDir) {
  const p = workPaths(workDir);
  const build = readJson(p.genomeBuildJson, 'trial', 'run finalize first');
  if (build?.schemaVersion !== SCHEMA_VERSION) {
    throw new PipelineError('trial', p.genomeBuildJson, `has schemaVersion ${build?.schemaVersion}, not ${SCHEMA_VERSION}`, REFINALIZE);
  }
  const complete = /^[\w.]+$/.test(build.accession ?? '') && typeof build.apiCommonData?.isfMap?.sha256 === 'string'
    && Array.isArray(build.partitions) && build.partitions.length > 0
    && build.partitions.every((part) => typeof part?.dir === 'string' && part.final && typeof part.soTerm === 'string' && Number.isInteger(part.featureCount));
  if (!complete) throw new PipelineError('trial', p.genomeBuildJson, 'is incomplete: it needs accession, apiCommonData.isfMap.sha256 and partitions', REFINALIZE);
  for (const part of build.partitions) {
    for (const name of Object.values(part.final).filter(Boolean)) {
      const file = join(workDir, part.dir, name);
      if (!existsSync(file) || statSync(file).size === 0) throw new PipelineError('trial', file, 'is missing or empty', 'run finalize again');
    }
    const gff3 = join(p.buildDir, partitionName(part), BUILD_FILES.gff3);
    if (part.featureCount > 0 && (!existsSync(gff3) || sha256File(gff3) !== part.buildFiles?.gff3)) {
      throw new PipelineError('trial', gff3, 'does not match genome-build.json', REFINALIZE);
    }
  }
  return { build, sha256: sha256File(p.genomeBuildJson) };
}

export function imageInfo(image, { exec }) {
  const info = inspectImage(image, { exec });
  if (!info) throw new PipelineError('trial', image, 'is not a local Docker image', 'build gus_isf (docker-tools gus_isf/Dockerfile) and tag it, or pass another --image');
  if (!info.gusHome) throw new PipelineError('trial', image, 'sets no GUS_HOME', 'pass a gus_isf image');
  return info;
}

export function checkImageMap(image, gusHome, build, { exec }) {
  const text = readImageFile(image, isfMapIn(gusHome), { exec });
  if (text === null || sha256(text) !== build.apiCommonData.isfMap.sha256) {
    throw new PipelineError('trial', `${image}:${isfMapIn(gusHome)}`, 'differs from the ISF map genome-build.json was built against',
      'use a gus_isf image built at the ApiCommonData commit finalize used, or run build and finalize with this one');
  }
}

export const contextOf = ({ workDir, image, gusConfig, user }, gusHome) =>
  ({ workDir: resolve(workDir), image, gusHome, gusConfig: resolve(gusConfig), user });

export function currentDatabase(ctx, expected, { exec }) {
  const database = selectRows(ctx, DATABASE_SQL, { exec, mounted: true })[0]?.name ?? null;
  if (expected && database !== expected) {
    throw new PipelineError('trial', ctx.gusConfig, `names database ${database}, but the trial loaded into ${expected}`,
      `pass the gus.config for ${expected}; to remove a half-loaded trial, run trial --undo with it`);
  }
  return database;
}

/** The global rows the trial reads (SO, taxon, genetic code), and, for a fresh trial, no database or release left by an earlier one. */
export function preflightReferenceData(ctx, { database, accession, taxonId, names, release, fresh }, { exec }) {
  const select = (sql) => selectRows(ctx, sql, { exec, mounted: true });
  if (Number(select(SO_SQL)[0]?.n ?? 0) === 0) {
    throw new PipelineError('trial', database, 'has no SO_RSRC release', 'load the Sequence Ontology (InsertSequenceOntologyOBO), or use a seeded database');
  }
  const [taxon] = select(taxonSql(taxonId));
  if (!taxon) throw new PipelineError('trial', database, `has no sres.taxon row for NCBI taxon ${taxonId}`, 'check --taxonId, or load the taxon (LoadTaxon or a taxonomy patch)');
  if (taxon.genetic_code_id === null || Number(taxon.codes) === 0) {
    throw new PipelineError('trial', database, `has no genetic code for NCBI taxon ${taxonId}`, 'load NCBI genetic codes with the taxonomy');
  }
  if (!fresh) return;
  const leftover = select(leftoverDatabasesSql(accession));
  if (leftover.length) {
    throw new PipelineError('trial', database, `already has trial database ${leftover.map((r) => r.name).join(', ')}`,
      'InsertExternalDatabase would reuse it and its Undo would delete nothing: run trial --undo for the earlier trial, or remove the rows by hand');
  }
  const existing = select(releasesSql(names, release));
  if (existing.length) {
    throw new PipelineError('trial', database, `already has release ${release} of ${existing.map((r) => r.name).join(', ')}`,
      'run trial --undo, or run trial again in a second');
  }
}
