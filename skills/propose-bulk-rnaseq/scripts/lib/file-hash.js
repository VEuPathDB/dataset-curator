import { openSync, readSync, closeSync } from 'node:fs';
import { createHash } from 'node:crypto';

const CHUNK = 1 << 20;

/** sha256 hex of a file, read in 1 MB chunks so large files never sit in memory. */
export function sha256File(path) {
  const hash = createHash('sha256');
  const buf = Buffer.allocUnsafe(CHUNK);
  const fd = openSync(path, 'r');
  try {
    let n;
    while ((n = readSync(fd, buf, 0, CHUNK, null)) > 0) hash.update(buf.subarray(0, n));
  } finally {
    closeSync(fd);
  }
  return hash.digest('hex');
}
