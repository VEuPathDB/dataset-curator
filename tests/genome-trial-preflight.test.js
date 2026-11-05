import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  checkImageMap, checkTrialOptions, contextOf, currentDatabase, fastaSourceIds, imageInfo, leftoverDatabasesSql, preflightReferenceData,
  takenSourceIdsSql
} from '../shared/scripts/genome/commands/trial.js';
import { PipelineError } from '../shared/scripts/genome/workdir.js';
import { tempDir } from './genome-helpers.js';
import {
  ACCESSION, DATABASE, fakeDocker, GUS_HOME, IMAGE, IMAGE_ID, MAP_IN_IMAGE, ORGANELLE, PRIMARY, RELEASE, RELEASES_LOADED, TAXON_ID, trialBuild,
  trialDb, trialWorkDir, USER
} from './genome-trial-helpers.js';

const names = [trialDb(PRIMARY), trialDb(ORGANELLE)];
const ctxOf = ({ workDir, gusConfig }) => contextOf({ workDir, image: IMAGE, gusConfig, user: USER }, GUS_HOME);
const refuses = (fn, problem) => assert.throws(fn, (e) => e instanceof PipelineError && (problem instanceof RegExp ? problem.test(e.problem) : e.problem === problem));
const preflight = (ctx, docker, extra = {}) =>
  preflightReferenceData(ctx, { database: DATABASE, accession: ACCESSION, taxonId: TAXON_ID, names, release: RELEASE, fresh: true, ...extra }, { exec: docker.exec });

test('checkTrialOptions needs an image, an existing gus.config file and, except for --undo, a taxon ID', () => {
  const { gusConfig } = trialWorkDir();
  refuses(() => checkTrialOptions({ gusConfig, taxonId: TAXON_ID }), 'is required');
  refuses(() => checkTrialOptions({ image: IMAGE, taxonId: TAXON_ID }), 'is required');
  refuses(() => checkTrialOptions({ image: IMAGE, gusConfig: '/nowhere/gus.config', taxonId: TAXON_ID }), 'is missing');
  for (const taxonId of [undefined, Number.NaN, 0, 2.5]) refuses(() => checkTrialOptions({ image: IMAGE, gusConfig, taxonId }), 'must be an NCBI taxon id');
  checkTrialOptions({ image: IMAGE, gusConfig, taxonId: TAXON_ID });
  checkTrialOptions({ image: IMAGE, gusConfig }, { undo: true });
});

test('a gus.config that is a directory is refused before any docker run, since Docker would create an empty one', () => {
  const directory = tempDir('trial-config-dir-');
  refuses(() => checkTrialOptions({ image: IMAGE, gusConfig: directory, taxonId: TAXON_ID }), 'is not a file');
  refuses(() => checkTrialOptions({ image: IMAGE, gusConfig: directory }, { undo: true }), 'is not a file');
});

test('imageInfo refuses an image that is not local or sets no GUS_HOME', () => {
  assert.deepEqual(imageInfo(IMAGE, { exec: fakeDocker().exec }), { id: IMAGE_ID, gusHome: GUS_HOME, labels: {} });
  refuses(() => imageInfo(IMAGE, { exec: fakeDocker({ images: {} }).exec }), 'is not a local Docker image');
  const bare = JSON.stringify([{ Id: IMAGE_ID, Config: { Env: ['PATH=/usr/bin'], Labels: null } }]);
  refuses(() => imageInfo(IMAGE, { exec: fakeDocker({ images: { [IMAGE]: bare } }).exec }), 'sets no GUS_HOME');
});

test('checkImageMap refuses an image whose ISF map differs from the one genome-build.json was built against', () => {
  checkImageMap(IMAGE, GUS_HOME, trialBuild(), { exec: fakeDocker().exec });
  refuses(() => checkImageMap(IMAGE, GUS_HOME, trialBuild(), { exec: fakeDocker({ files: { [MAP_IN_IMAGE]: '<other/>' } }).exec }),
    'differs from the ISF map genome-build.json was built against');
  refuses(() => checkImageMap(IMAGE, GUS_HOME, trialBuild(), { exec: fakeDocker({ files: { [MAP_IN_IMAGE]: null } }).exec }),
    'differs from the ISF map genome-build.json was built against');
});

test('currentDatabase asks the database its name and refuses one other than expected', () => {
  const ctx = ctxOf(trialWorkDir());
  assert.equal(currentDatabase(ctx, null, { exec: fakeDocker().exec }), DATABASE);
  assert.equal(currentDatabase(ctx, DATABASE, { exec: fakeDocker().exec }), DATABASE);
  refuses(() => currentDatabase(ctx, DATABASE, { exec: fakeDocker({ selects: { database: 'name\nother_db\n' } }).exec }),
    'names database other_db, but the trial loaded into UniDB_shu_m');
});

test('preflightReferenceData passes with SO_RSRC, the taxon and its genetic code, and nothing left from an earlier trial', () => {
  const docker = fakeDocker();
  preflight(ctxOf(trialWorkDir()), docker);
  assert.deepEqual(docker.queries(), ['soRelease', 'taxon', 'leftoverDatabases', 'releases']);
  assert.match(docker.calls[1].input, /WHERE t\.ncbi_tax_id = 284813$/);
});

test('preflightReferenceData refuses missing reference data', () => {
  const ctx = ctxOf(trialWorkDir());
  const run = (selects) => () => preflight(ctx, fakeDocker({ selects }));
  refuses(run({ soRelease: 'n\n0\n' }), 'has no SO_RSRC release');
  refuses(run({ taxon: 'taxon_id\tgenetic_code_id\tcodes\n' }), 'has no sres.taxon row for NCBI taxon 284813');
  refuses(run({ taxon: 'taxon_id\tgenetic_code_id\tcodes\n91245\t\\N\t0\n' }), 'has no genetic code for NCBI taxon 284813');
  refuses(run({ releases: RELEASES_LOADED }), new RegExp(`^already has release ${RELEASE} of ${trialDb(PRIMARY)}`));
});

test('leftoverDatabasesSql compares a prefix literally, so _ and % are never wildcards', () => {
  const sql = leftoverDatabasesSql(ACCESSION);
  assert.match(sql, /^-- trial:leftoverDatabases\n/);
  assert.ok(sql.includes("left(d.name, 29) = 'curatorTrial_GCA_000000001.1_'"), sql);
  assert.ok(!/LIKE/i.test(sql));
  for (const accession of ['GCF_9000.1', 'GCF_000001405.40', 'GCA_000000001.12345']) {
    const prefix = `curatorTrial_${accession}_`;
    assert.ok(leftoverDatabasesSql(accession).includes(`left(d.name, ${prefix.length}) = '${prefix}'`), accession);
  }
  assert.ok(leftoverDatabasesSql("GCA_0'1").includes("= 'curatorTrial_GCA_0''1_'"));
});

test('a fresh preflight refuses a leftover trial database of this accession, even with no release row', () => {
  const leftover = `name\n${trialDb(PRIMARY)}\n`;
  const docker = fakeDocker({ selects: { leftoverDatabases: leftover } });
  assert.throws(() => preflight(ctxOf(trialWorkDir()), docker),
    (e) => e instanceof PipelineError && e.problem.startsWith(`already has trial database ${trialDb(PRIMARY)}`) && /trial --undo/.test(e.next));
  assert.deepEqual(docker.queries(), ['soRelease', 'taxon', 'leftoverDatabases']);
});

test('a resumed trial does not refuse its own databases or release', () => {
  const docker = fakeDocker({ selects: { releases: RELEASES_LOADED, leftoverDatabases: `name\n${trialDb(PRIMARY)}\n` } });
  preflight(ctxOf(trialWorkDir()), docker, { fresh: false, sourceIds: ['CM000001.1'] });
  assert.deepEqual(docker.queries(), ['soRelease', 'taxon']);
});

test('fastaSourceIds takes each header ID as LoadFastaSequences does, across partitions and chunk boundaries', () => {
  const { workDir } = trialWorkDir();
  assert.deepEqual(fastaSourceIds(trialBuild(), workDir), ['CM000001.1', 'CM000003.1']);
  const long = `>a desc\n${'A'.repeat(3 << 20)}\n>b\r\nAC\n>c`;
  writeFileSync(join(workDir, `final/${PRIMARY}/genome.fasta`), long);
  assert.deepEqual(fastaSourceIds(trialBuild(), workDir), ['a', 'b', 'c', 'CM000003.1']);
});

test('takenSourceIdsSql looks the IDs up in dots.nasequenceimp, with their external database', () => {
  const sql = takenSourceIdsSql(['CM000001.1', "x'y"]);
  assert.match(sql, /^-- trial:takenSourceIds\nSELECT s\.source_id, d\.name FROM dots\.nasequenceimp s LEFT JOIN/);
  assert.ok(sql.includes("WHERE s.source_id IN ('CM000001.1', 'x''y')"), sql);
});

test('a fresh preflight refuses sequence IDs another load already holds, naming its external database', () => {
  const taken = 'source_id\tname\nCM000001.1\tcuratorTrial_ecunGB-M1_primary_genome_RSRC\nCM000003.1\t\\N\n';
  const docker = fakeDocker({ selects: { takenSourceIds: taken } });
  refuses(() => preflight(ctxOf(trialWorkDir()), docker, { sourceIds: ['CM000001.1', 'CM000003.1'] }),
    "already has 2 of this genome's 2 sequence IDs (CM000001.1, CM000003.1) in curatorTrial_ecunGB-M1_primary_genome_RSRC, no external database");
  assert.deepEqual(docker.queries(), ['soRelease', 'taxon', 'leftoverDatabases', 'releases', 'takenSourceIds']);
});

test('the source ID lookup runs in batches of 1000', () => {
  const docker = fakeDocker();
  preflight(ctxOf(trialWorkDir()), docker, { sourceIds: Array.from({ length: 2001 }, (_, i) => `s${i}`) });
  assert.deepEqual(docker.queries().filter((q) => q === 'takenSourceIds').length, 3);
});
