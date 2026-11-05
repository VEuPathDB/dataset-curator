import { mkdirSync, writeFileSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { MAP_PATH } from '../shared/scripts/genome/preprocess-gff3.js';
import { SELECT_ROWS_MOUNT } from '../shared/scripts/genome/trial/gus.js';
import { sha256 } from '../shared/scripts/genome/workdir.js';
import { gffLine, gffText, tempDir } from './genome-helpers.js';

export const GUS_HOME = '/opt/veupathdb/gus_home';
export const IMAGE = 'gus_isf:local';
export const IMAGE_ID = 'sha256:4f1c2a9be0d7c3e6f5a8b9d0e1f2a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4';
export const ACD_COMMIT = '585237ffed0bfaa2f1c047c813a7f584091dbe5d';
export const ACCESSION = 'GCA_000000001.1';
export const TAXON_ID = 284813;
export const DATABASE = 'UniDB_shu_m';
export const USER = '1000:1000';
export const START = new Date('2026-11-05T10:23:45.000Z');
export const RELEASE = '20261105T102345';
export const PRIMARY = 'primary_chromosome';
export const ORGANELLE = 'organelle_mitochondrion';
export const MAP_IN_IMAGE = `${GUS_HOME}/lib/xml/isf/genemRNAExonCDS2Gus.xml`;
export const MAP_TEXT = '<mapping>\n  <gusSkeletonMaker class="ApiCommonData::Load::GusSkeletonMaker"/>\n</mapping>\n';
export const trialDb = (partition) => `curatorTrial_${ACCESSION}_${partition}_RSRC`;

export const PLUGIN = Object.freeze({
  externalDatabase: 'GUS::Supported::Plugin::InsertExternalDatabase',
  externalDatabaseRls: 'GUS::Supported::Plugin::InsertExternalDatabaseRls',
  sequences: 'GUS::Supported::Plugin::LoadFastaSequences',
  isf: 'GUS::Supported::Plugin::InsertSequenceFeatures',
  isfUndo: 'GUS::Supported::Plugin::InsertSequenceFeaturesUndo',
  undo: 'GUS::Community::Plugin::Undo'
});

/** build/primary_chromosome/genome.gff3: a coding gene and a tRNA gene, as D's build writes them. */
export const PRIMARY_GFF3 = gffText(
  gffLine('CM000001.1', 'gene', 100, 400, '+', 'ID=TST_0010'),
  gffLine('CM000001.1', 'mRNA', 100, 400, '+', 'ID=TST_0010_mRNA;Parent=TST_0010'),
  gffLine('CM000001.1', 'exon', 100, 400, '+', 'ID=TST_0010_mRNA_exon1;Parent=TST_0010_mRNA'),
  gffLine('CM000001.1', 'CDS', 100, 400, '+', 'ID=PRT1.1;Parent=TST_0010_mRNA;protein_id=PRT1.1'),
  gffLine('CM000001.1', 'gene', 1000, 1072, '+', 'ID=TST_0030'),
  gffLine('CM000001.1', 'tRNA', 1000, 1072, '+', 'ID=rna-TST_0030;Parent=TST_0030'),
  gffLine('CM000001.1', 'exon', 1000, 1072, '+', 'ID=exon-TST_0030-1;Parent=rna-TST_0030')
);
export const PRIMARY_GFF = 'CM000001.1\tEMBL\tgene\t100\t400\t.\t+\t.\tID "TST_0010";\n';
export const PRIMARY_FASTA = '>CM000001.1\nACGT\n';
export const PRIMARY_CHROMOSOME_MAP = 'CM000001.1\tchr1\t1\n';
export const ORGANELLE_FASTA = '>CM000003.1\nACGT\n';

/** ISF's PRINT_TRANSCRIPT_IDS output for PRIMARY_GFF3: gene, sequence, exon orders, exon coordinates, transcript. */
export const TRANSCRIPT_IDS_TEXT = 'TST_0010\tATGAAACCCTAA\t1\t100,400\tTST_0010_mRNA\nTST_0030\tGCGGATTTAGCTCAG\t1\t1000,1072\trna-TST_0030\n';

export function trialBuild() {
  return {
    schemaVersion: 1,
    generator: { name: 'dataset-curator genome-pipeline', version: '3.1.0' },
    source: 'ncbi',
    accession: ACCESSION,
    apiCommonData: {
      commit: ACD_COMMIT, dirty: false, isfMap: { path: MAP_PATH, sha256: sha256(MAP_TEXT) },
      preprocessGFF3: { sha256: sha256('preprocessGFF3'), override: false }
    },
    partitions: [
      {
        role: 'primary', soTerm: 'chromosome', organelle: null, sequenceCount: 1, dir: `final/${PRIMARY}`, featureCount: 2, gffLines: 7,
        final: { gff: 'genome.gff', fasta: 'genome.fasta', chromosomeMap: 'chromosomeMap.txt' },
        buildFiles: { gff3: sha256(PRIMARY_GFF3), fasta: sha256(PRIMARY_FASTA), chromosomeMap: sha256(PRIMARY_CHROMOSOME_MAP) }
      },
      {
        role: 'organelle', soTerm: 'mitochondrial_chromosome', organelle: 'mitochondrion', sequenceCount: 1, dir: `final/${ORGANELLE}`,
        featureCount: 0, gffLines: 1, final: { gff: null, fasta: 'genome.fasta', chromosomeMap: null },
        buildFiles: { gff3: sha256('##gff-version 3\n'), fasta: sha256(ORGANELLE_FASTA), chromosomeMap: null }
      }
    ],
    builtAt: '2026-11-04T00:00:00.000Z',
    finalizedAt: '2026-11-04T00:00:00.000Z'
  };
}

/** A finalized work area for `build`, and a gus.config the runner never reads. */
export function trialWorkDir(build = trialBuild()) {
  const workDir = tempDir('trial-work-');
  const write = (rel, text) => {
    mkdirSync(dirname(join(workDir, rel)), { recursive: true });
    writeFileSync(join(workDir, rel), text);
  };
  write(`build/${PRIMARY}/genome.gff3`, PRIMARY_GFF3);
  write(`final/${PRIMARY}/genome.gff`, PRIMARY_GFF);
  write(`final/${PRIMARY}/genome.fasta`, PRIMARY_FASTA);
  write(`final/${PRIMARY}/chromosomeMap.txt`, PRIMARY_CHROMOSOME_MAP);
  write(`final/${ORGANELLE}/genome.fasta`, ORGANELLE_FASTA);
  write('genome-build.json', `${JSON.stringify(build, null, 2)}\n`);
  const gusConfig = join(tempDir('trial-config-'), 'gus.config');
  writeFileSync(gusConfig, 'dbiDsn=dbi:Pg:dbname=UniDB_shu_m;host=localhost;port=5432\n');
  return { workDir, gusConfig };
}

/** Each call returns the next second, starting at `start`. */
export function fakeClock(start = START) {
  let t = start.getTime();
  return () => {
    const d = new Date(t);
    t += 1000;
    return d;
  };
}

/** `docker image inspect gus_isf:local`, trimmed to the fields the runner reads. */
export const INSPECT_BASE = `[
  {
    "Id": "${IMAGE_ID}",
    "RepoTags": ["gus_isf:local"],
    "Config": {
      "Env": [
        "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/opt/veupathdb/project_home/install/bin:/opt/veupathdb/gus_home/bin:/opt/java/bin:/usr/lib/postgresql/16/bin",
        "GUS_HOME=/opt/veupathdb/gus_home",
        "PROJECT_HOME=/opt/veupathdb/project_home"
      ],
      "Labels": null,
      "WorkingDir": "/work"
    }
  }
]`;

export const modelInspect = (labels) => JSON.stringify([{
  Id: 'sha256:7c2e0d4f9b8a6c5e3d2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b1c0d',
  RepoTags: [],
  Config: { Env: [`GUS_HOME=${GUS_HOME}`], Labels: labels }
}]);

/** What GusApplication writes to stdout and stderr for one `ga` run. */
export function gaLog(id, plugin, failure = null) {
  const at = 'Thu Nov  5 10:23:45 2026';
  const invocation = id === null ? [] : [`${at}\tAlgInvocationId\t${id}`, `${at}\tCOMMIT\tcommit on`];
  const end = failure
    ? ['', 'ERROR:', failure, '', 'STACK TRACE:', `  at ${GUS_HOME}/lib/perl/GUS/PluginMgr/GusApplication.pm line 598.`]
    : [`${at}\tTIME\t10 sec  (0:00:10)`, `${at}\tRESULT\tdone`, ...invocation];
  return [
    `${at}\tDSN\tdbi:Pg:dbname=UniDB_shu_m;host=localhost;port=5432`, `${at}\tPLUGIN\t${plugin}`,
    `${at}\tARGS\t--commit --verbose`, ...invocation, ...end, ''
  ].join('\n');
}

/** selectRows output, keyed by each query's `-- trial:<name>` tag. */
export const SELECTS = {
  database: 'name\nUniDB_shu_m\n',
  soRelease: 'n\n1\n',
  leftoverDatabases: 'name\n',
  taxon: 'taxon_id\tgenetic_code_id\tcodes\n91245\t1\t1\n',
  schemaFingerprint: 'table_id\tname\tdatabase_id\n1\tAlgorithm\t1\n2\tAlgorithmImplementation\t1\n56\tExternalNASequence\t3\n',
  genes: 'release_id\tsource_id\n501\tTST_0010\n501\tTST_0030\n',
  transcripts: 'release_id\tsource_id\tproteins\n501\tTST_0010_mRNA\t1\n501\trna-TST_0030\t0\n',
  internalStops: 'release_id\tsource_id\n',
  profileSource: 'schema\npublic\n',
  takenSourceIds: 'source_id\tname\n',
  leftovers: 'what\tn\ntrialRelease\t0\ntrialDatabases\t0\nsres.externaldatabase\t0\nsres.externaldatabaserelease\t0\ndots.nasequenceimp\t0\ndots.nafeatureimp\t0\ndots.aafeatureimp\t0\ndots.aasequenceimp\t0\n',
  invocationRows: 'algorithm_invocation_id\n',
  schemaColumns: 'table_schema\ttable_name\tcolumn_name\tdata_type\ncore\talgorithm\talgorithm_id\tinteger\ncore\talgorithm\tname\tcharacter varying\ndots\tnafeatureimp\tna_feature_id\tbigint\n'
};
export const RELEASES_LOADED = `name\trelease_id\n${trialDb(PRIMARY)}\t501\n${trialDb(ORGANELLE)}\t502\n`;
export const statementsAt = (k) => 'queryid\tcalls\ttotal_exec_time\tquery\n'
  + `-4211\t${2 * k}\t${1.5 * k}\tselect name, ontology_term_id from SRES.ontologyterm where external_database_release_id=$1\n`
  + `881\t${k}\t${30 * k}\tINSERT INTO DoTS.NAFeatureImp (na_feature_id, subclass_view) VALUES ($1, $2)\n`;
export const tablesAt = (k) => 'name\tseq_scan\tidx_scan\tn_tup_ins\n'
  + `sres.ontologyterm\t${3 * k}\t${k}\t0\n`
  + `dots.nafeatureimp\t${k}\t${2 * k}\t${4 * k}\n`;

const DEFAULT_FILES = { [MAP_IN_IMAGE]: MAP_TEXT, [`${GUS_HOME}/APICOMMONDATA_COMMIT`]: `${ACD_COMMIT}\n` };
const VALUE_OPTIONS = new Set(['--network', '-u', '-e', '--mount', '-w', '--pull', '--name', '--entrypoint']);
const failure = (status, stderr) => Object.assign(new Error(`Command failed with status ${status}`), { status, stdout: '', stderr });
const argAfter = (args, flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : null);
const wrongShape = (problem) => new Error(`fakeDocker: ${problem}`);

/** `docker run [options] IMAGE command...`: the command is whatever follows the image, or the entrypoint plus the rest. */
function parseRun(args) {
  const options = [];
  let i = 1;
  while (i < args.length && args[i].startsWith('-')) {
    if (VALUE_OPTIONS.has(args[i])) {
      options.push([args[i], args[i + 1]]);
      i += 2;
    } else if (['--rm', '-i', '--init'].includes(args[i])) {
      options.push([args[i], true]);
      i += 1;
    } else {
      throw wrongShape(`unknown docker run option ${args[i]}`);
    }
  }
  const all = (flag) => options.filter(([f]) => f === flag).map(([, v]) => v);
  const rest = args.slice(i + 1);
  const mounts = all('--mount').map((m) => Object.fromEntries(m.split(',').map((kv) => kv.split('=')).map(([k, v]) => [k, v ?? true])));
  return { image: args[i], command: all('--entrypoint').length ? [all('--entrypoint')[0], ...rest] : rest, options, all, mounts };
}

/** Throws on a run that real Docker or the GUS image would not accept as the runner intends. */
export function assertRunShape(args, { stdin = false, images = [IMAGE] } = {}) {
  const run = parseRun(args);
  if (!images.includes(run.image) && !/^gus_isf-model:/.test(run.image)) throw wrongShape(`unknown image ${run.image}`);
  const [program, script] = run.command;
  if (run.all('--pull')[0] !== 'never') throw wrongShape('docker run without --pull never');
  if (program !== 'bash' && program !== 'cat' && !run.all('-u').includes(USER)) throw wrongShape(`no -u ${USER}`);
  const gusConfig = run.mounts.find((m) => m.dst === `${GUS_HOME}/config/gus.config`);
  if (program !== 'cat' && !(gusConfig?.readonly === true && gusConfig.type === 'bind')) throw wrongShape('no read-only gus.config mount');
  if (program === 'perl') {
    const mountedScript = run.mounts.some((m) => m.dst === SELECT_ROWS_MOUNT && m.readonly === true);
    if (!(script === `${GUS_HOME}/bin/selectRows` || (script === SELECT_ROWS_MOUNT && mountedScript))) throw wrongShape(`perl script ${script} is not selectRows`);
  }
  if (stdin && !run.options.some(([f]) => f === '-i')) throw wrongShape('stdin input without -i');
  return run;
}

/** The same check selectRows.pl makes: one SELECT or WITH, no ; outside a string literal. */
function assertSelect(sql) {
  const body = sql.replace(/^(?:\s*--[^\n]*\n)*\s*/, '').replace(/;\s*$/, '');
  if (!/^(?:SELECT|WITH)\b/i.test(body)) throw wrongShape(`not a SELECT or WITH: ${body.slice(0, 40)}`);
  if (body.replace(/'(?:[^']|'')*'/g, '').includes(';')) throw wrongShape('more than one statement');
}

/**
 * A Docker stand-in for the exec seam. `ga(call, state)` may return { exitCode, id, log, writes } to override the
 * default success (next AlgInvocationId; a PRINT run writes transcriptIds). `selects` overrides SELECTS by tag,
 * with a string or (sql, state) => string. `files` overrides what `cat` reads from an image (null: missing).
 */
export function fakeDocker({ ga = null, selects = {}, files = {}, images = { [IMAGE]: INSPECT_BASE }, buildExit = 0, running = [] } = {}) {
  const calls = [];
  const state = { images: { ...images }, nextId: 7319, plugins: [], snapshots: 0, running: [...running] };

  const select = (sql) => {
    assertSelect(sql);
    const name = sql.match(/^-- trial:(\w+)/)[1];
    const override = selects[name];
    if (typeof override === 'function') return override(sql, state);
    if (override !== undefined) return override;
    if (name === 'releases') return state.plugins.includes(PLUGIN.externalDatabaseRls) ? RELEASES_LOADED : 'name\trelease_id\n';
    if (name === 'statements') return statementsAt(++state.snapshots);
    if (name === 'tables') return tablesAt(++state.snapshots);
    if (!(name in SELECTS)) throw failure(1, `DBD::Pg::st execute failed: no fake for ${name}`);
    return SELECTS[name];
  };

  const runGa = (run, opts) => {
    const mount = run.mounts.find((m) => m.dst === '/work');
    if (!mount) throw wrongShape('ga without the work area mounted at /work');
    if (opts.stdio?.[1] === undefined || opts.stdio[1] !== opts.stdio[2]) throw wrongShape('ga stdout and stderr are not the same descriptor');
    const call = { plugin: run.command[1], args: run.command.slice(2), host: mount.src, container: run.all('--name')[0] ?? null };
    call.directive = argAfter(call.args, '--postprocessingDirective');
    const result = ga?.(call, state) ?? {};
    const id = 'id' in result ? result.id : state.nextId++;
    const exitCode = result.exitCode ?? 0;
    const printed = call.directive === 'PRINT_TRANSCRIPT_IDS' && exitCode === 0
      ? { [`${argAfter(call.args, '--postprocessingDir')}transcriptIds`]: TRANSCRIPT_IDS_TEXT } : {};
    for (const [path, text] of Object.entries(result.writes ?? printed)) {
      const host = path.replace(/^\/work/, call.host);
      mkdirSync(dirname(host), { recursive: true });
      writeFileSync(host, text);
    }
    if (call.plugin === PLUGIN.undo && call.args.includes(PLUGIN.externalDatabaseRls)) {
      state.plugins = state.plugins.filter((p) => p !== PLUGIN.externalDatabaseRls);
    } else {
      state.plugins.push(call.plugin);
    }
    writeSync(opts.stdio[1], result.log ?? gaLog(id, call.plugin, exitCode === 0 ? null : 'died'));
    if (exitCode !== 0) throw failure(exitCode, '');
    return null;
  };

  const exec = (cmd, args, opts = {}) => {
    const run = cmd === 'docker' && args[0] === 'run' ? assertRunShape(args, { stdin: opts.input !== undefined, images: Object.keys(state.images) }) : null;
    calls.push({ cmd, args, input: opts.input ?? null, command: run?.command ?? null });
    if (cmd !== 'docker') throw failure(127, `${cmd}: not faked`);
    if (args[0] === 'image' && args[1] === 'inspect') {
      if (state.images[args[2]]) return state.images[args[2]];
      throw failure(1, `Error response from daemon: No such image: ${args[2]}`);
    }
    if (args[0] === 'rm') return '';
    if (args[0] === 'ps') return state.running.map((name) => `${name}\n`).join('');
    if (args[0] === 'commit') {
      const labels = args.flatMap((a, i) => (args[i - 1] === '--change' && a.startsWith('LABEL ') ? [a.slice('LABEL '.length).split('=')] : []));
      state.images[args.at(-1)] = modelInspect(Object.fromEntries(labels));
      return 'sha256:7c2e0d4f9b8a\n';
    }
    if (!run) throw failure(125, `unexpected docker call: ${args.join(' ')}`);
    const [program, path] = run.command;
    if (program === 'cat') {
      const text = path in files ? files[path] : DEFAULT_FILES[path];
      if (text === undefined || text === null) throw failure(1, `cat: ${path}: No such file or directory`);
      return text;
    }
    if (program === 'bash') {
      writeSync(opts.stdio[1], buildExit === 0 ? 'generateGusObjects: done\nBUILD SUCCESSFUL\n' : 'DBI connect failed\nBUILD FAILED\n');
      if (buildExit !== 0) throw failure(buildExit, '');
      return null;
    }
    if (program === 'perl') return select(opts.input);
    if (program === 'ga') return runGa(run, opts);
    throw failure(125, `unexpected docker call: ${args.join(' ')}`);
  };

  const gaCalls = () => calls.filter((c) => c.command?.[0] === 'ga').map((c) => ({ plugin: c.command[1], args: c.command.slice(2) }));
  const queries = () => calls.filter((c) => c.input !== null).map((c) => c.input.match(/^-- trial:(\w+)/)[1]);
  return { exec, calls, state, gaCalls, queries };
}
