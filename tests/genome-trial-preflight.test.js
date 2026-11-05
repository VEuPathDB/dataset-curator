import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  checkImageMap, checkTrialOptions, contextOf, currentDatabase, imageInfo, leftoverDatabasesSql, preflightReferenceData, readGenomeBuild
} from '../shared/scripts/genome/commands/trial.js';
import { PipelineError, sha256 } from '../shared/scripts/genome/workdir.js';
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

test('readGenomeBuild returns the record and its sha256', () => {
  const { workDir } = trialWorkDir();
  const { build, sha256: digest } = readGenomeBuild(workDir);
  assert.deepEqual(build, trialBuild());
  assert.equal(digest, sha256(`${JSON.stringify(trialBuild(), null, 2)}\n`));
});

test('readGenomeBuild refuses a missing, other-version or incomplete genome-build.json', () => {
  assert.throws(() => readGenomeBuild(tempDir('empty-')), /trial: .*genome-build\.json: is missing\nNext: run finalize first/);
  const { workDir: older } = trialWorkDir({ ...trialBuild(), schemaVersion: 2 });
  assert.throws(() => readGenomeBuild(older), /has schemaVersion 2, not 1\nNext: run build and finalize again/);
  const { workDir: bad } = trialWorkDir({ ...trialBuild(), accession: '../x' });
  assert.throws(() => readGenomeBuild(bad), /is incomplete: it needs accession, apiCommonData\.isfMap\.sha256 and partitions/);
});

test('readGenomeBuild refuses a final/ file that is missing or empty, and a build GFF3 that changed', () => {
  const { workDir } = trialWorkDir();
  const fasta = join(workDir, `final/${ORGANELLE}/genome.fasta`);
  writeFileSync(fasta, '');
  assert.throws(() => readGenomeBuild(workDir), (e) => e.file === fasta && e.problem === 'is missing or empty' && e.next === 'run finalize again');
  const { workDir: changed } = trialWorkDir();
  appendFileSync(join(changed, `build/${PRIMARY}/genome.gff3`), '# edited\n');
  assert.throws(() => readGenomeBuild(changed), /genome\.gff3: does not match genome-build\.json/);
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

test('leftoverDatabasesSql matches this accession exactly: _ is escaped, so no other accession is a match', () => {
  const sql = leftoverDatabasesSql(ACCESSION);
  assert.match(sql, /^-- trial:leftoverDatabases\n/);
  assert.ok(sql.includes("d.name LIKE 'curatorTrial\\_GCA\\_000000001.1\\_%' ESCAPE '\\'"), sql);
  assert.ok(leftoverDatabasesSql("GCA_0'1").includes("'curatorTrial\\_GCA\\_0''1\\_%'"));
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
  preflight(ctxOf(trialWorkDir()), docker, { fresh: false });
  assert.deepEqual(docker.queries(), ['soRelease', 'taxon']);
});
