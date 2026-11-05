import { failureOutput } from '../../lib/tools/exec.js';
import { PipelineError, sha256, sha256File } from '../workdir.js';
import { bindMount, inspectImage, runLogged, SELECT_ROWS_MOUNT, SELECT_ROWS_SCRIPT, selectRows, tail } from './gus.js';

export const FINGERPRINT_SQL = '-- trial:schemaFingerprint\nSELECT table_id, name, database_id FROM core.tableinfo ORDER BY table_id';
export const SELECT_ROWS_LABEL = 'org.veupathdb.curator.selectRows.sha256';
export const BUILD_MODEL = `rm -rf $GUS_HOME/lib/perl/GUS/Model && bld GUS/Model && install -m 755 ${SELECT_ROWS_MOUNT} $GUS_HOME/bin/selectRows`;

export const schemaFingerprint = (rows) => sha256(rows.map((r) => `${r.table_id}\t${r.name}\t${r.database_id}`).join('\n'));
export const modelTag = (database, fingerprint) =>
  `gus_isf-model:${database.toLowerCase().replace(/[^a-z0-9_.-]/g, '_')}-${fingerprint.slice(0, 12)}`;

function removeContainer(name, exec) {
  try {
    exec('docker', ['rm', '-f', name]);
  } catch { /* nothing to remove */ }
}

/** GUS::Model must match the target schema: reuse the image for this fingerprint, or generate it and commit the container. */
export function ensureModelImage(baseCtx, database, { exec, logPath }) {
  const fingerprint = schemaFingerprint(selectRows(baseCtx, FINGERPRINT_SQL, { exec, mounted: true }));
  const tag = modelTag(database, fingerprint);
  const scriptSha = sha256File(SELECT_ROWS_SCRIPT);
  if (inspectImage(tag, { exec })?.labels[SELECT_ROWS_LABEL] === scriptSha) return { modelTag: tag, schemaFingerprint: fingerprint, built: false };
  const container = `gus_isf-model-build-${fingerprint.slice(0, 12)}`;
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
      exec('docker', ['commit', '--change', `LABEL ${SELECT_ROWS_LABEL}=${scriptSha}`, container, tag]);
    } catch (e) {
      throw new PipelineError('trial', tag, `docker commit failed: ${failureOutput(e)}`, 'check Docker, then run trial again');
    }
  } finally {
    removeContainer(container, exec);
  }
  return { modelTag: tag, schemaFingerprint: fingerprint, built: true };
}
