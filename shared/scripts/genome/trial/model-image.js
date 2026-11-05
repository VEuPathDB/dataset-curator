import { randomBytes } from 'node:crypto';
import { failureOutput } from '../../lib/tools/exec.js';
import { PipelineError, sha256, sha256File } from '../workdir.js';
import { bindMount, inspectImage, runLogged, SELECT_ROWS_MOUNT, SELECT_ROWS_SCRIPT, selectRows, tail } from './gus.js';

export const FINGERPRINT_SQL = '-- trial:schemaFingerprint\nSELECT table_id, name, database_id FROM core.tableinfo ORDER BY table_id';
export const COLUMNS_SQL = '-- trial:schemaColumns\nSELECT table_schema, table_name, column_name, data_type FROM information_schema.columns'
  + ' WHERE lower(table_schema) IN (SELECT lower(name) FROM core.databaseinfo) ORDER BY table_schema, table_name, column_name';
export const SELECT_ROWS_LABEL = 'org.veupathdb.curator.selectRows.sha256';
export const BASE_IMAGE_LABEL = 'org.veupathdb.curator.baseImage.id';
export const BUILD_MODEL = `rm -rf $GUS_HOME/lib/perl/GUS/Model && bld GUS/Model && install -m 755 ${SELECT_ROWS_MOUNT} $GUS_HOME/bin/selectRows`;
const TAG_PART_MAX = 128;
const FINGERPRINT_CHARS = 12;

/** Hashes the table list and the GUS schemas' columns: what bld GUS/Model generates its classes from. */
export function schemaFingerprint(tableRows, columnRows) {
  if (tableRows.length === 0 || columnRows.length === 0) {
    throw new PipelineError('trial', 'core.tableinfo', 'or its schemas returned no rows', 'check that gus.config names a GUS database');
  }
  const tables = tableRows.map((r) => `${r.table_id}\t${r.name}\t${r.database_id}`).join('\n');
  const columns = columnRows.map((r) => `${r.table_schema}\t${r.table_name}\t${r.column_name}\t${r.data_type}`).join('\n');
  return sha256(`${tables}\n--columns--\n${columns}`);
}

export function modelTag(database, fingerprint) {
  const name = database.toLowerCase().replace(/[^a-z0-9_.-]/g, '_');
  if (name === '' || /^[.-]/.test(name)) {
    throw new PipelineError('trial', database, 'cannot be used in a Docker tag: it is empty or starts with "." or "-"', 'use a database whose name starts with a letter or digit');
  }
  const suffix = `-${fingerprint.slice(0, FINGERPRINT_CHARS)}`;
  return `gus_isf-model:${name.slice(0, TAG_PART_MAX - suffix.length)}${suffix}`;
}

function removeContainer(name, exec) {
  try {
    exec('docker', ['rm', '-f', name]);
  } catch { /* nothing to remove */ }
}

/** GUS::Model must match the target schema: reuse the image for this fingerprint, or generate it and commit the container. */
export function ensureModelImage(baseCtx, database, { exec, logPath, suffix = randomBytes(4).toString('hex') }) {
  const fingerprint = schemaFingerprint(
    selectRows(baseCtx, FINGERPRINT_SQL, { exec, mounted: true }),
    selectRows(baseCtx, COLUMNS_SQL, { exec, mounted: true })
  );
  const tag = modelTag(database, fingerprint);
  const scriptSha = sha256File(SELECT_ROWS_SCRIPT);
  const base = inspectImage(baseCtx.image, { exec });
  if (!base) throw new PipelineError('trial', baseCtx.image, 'is not a local image', 'build or pull it, then run trial again');
  const labels = inspectImage(tag, { exec })?.labels ?? {};
  if (labels[SELECT_ROWS_LABEL] === scriptSha && labels[BASE_IMAGE_LABEL] === base.id) {
    return { modelTag: tag, schemaFingerprint: fingerprint, built: false };
  }
  const container = `gus_isf-model-build-${fingerprint.slice(0, FINGERPRINT_CHARS)}-${suffix}`;
  removeContainer(container, exec);
  try {
    const { exitCode, log } = runLogged([
      'run', '--name', container, '--pull', 'never', '--network', 'host',
      '--mount', bindMount(baseCtx.gusConfig, `${baseCtx.gusHome}/config/gus.config`, { readonly: true }),
      '--mount', bindMount(SELECT_ROWS_SCRIPT, SELECT_ROWS_MOUNT, { readonly: true }),
      baseCtx.image, 'bash', '-c', BUILD_MODEL
    ], logPath, { exec });
    if (exitCode !== 0) {
      throw new PipelineError('trial', logPath, `bld GUS/Model exited ${exitCode}:\n${tail(log)}`,
        'check that gus.config names the target database, then run trial again');
    }
    try {
      exec('docker', [
        'commit', '--change', `LABEL ${SELECT_ROWS_LABEL}=${scriptSha}`, '--change', `LABEL ${BASE_IMAGE_LABEL}=${base.id}`,
        '--change', 'CMD ["bash"]', container, tag
      ]);
    } catch (e) {
      throw new PipelineError('trial', tag, `docker commit failed: ${failureOutput(e)}`, 'check Docker, then run trial again');
    }
  } finally {
    removeContainer(container, exec);
  }
  return { modelTag: tag, schemaFingerprint: fingerprint, built: true };
}
