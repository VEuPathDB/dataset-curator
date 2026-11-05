import { createReadStream, createWriteStream } from 'node:fs';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';

function lines(path) {
  const raw = createReadStream(path);
  return createInterface({ input: path.endsWith('.gz') ? raw.pipe(createGunzip()) : raw, crlfDelay: Infinity });
}

export const fastaId = (header) => header.slice(1).split(/\s/)[0];

export async function readFastaIndex(path) {
  const seqs = [];
  let current = null;
  for await (const line of lines(path)) {
    if (line.startsWith('>')) { current = { id: fastaId(line), length: 0 }; seqs.push(current); }
    else if (current) current.length += line.trim().length;
  }
  return seqs;
}

/** Copies the sequences whose (renamed) ID is in `ids`; a renamed header keeps its description. */
export async function writeFastaSubset(src, dest, ids, rename = new Map()) {
  const out = createWriteStream(dest);
  let keep = false;
  for await (const line of lines(src)) {
    let text = line;
    if (line.startsWith('>')) {
      const id = fastaId(line);
      const newId = rename.get(id) ?? id;
      keep = ids.has(newId);
      text = `>${newId}${line.slice(1 + id.length)}`;
    }
    if (keep && !out.write(`${text}\n`)) await once(out, 'drain');
  }
  out.end();
  await once(out, 'finish');
}
