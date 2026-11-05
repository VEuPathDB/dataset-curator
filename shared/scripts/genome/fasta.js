import { createReadStream, createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { pipeline as pipelineWithCallback } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import { createGunzip } from 'node:zlib';

function chunks(path) {
  const raw = createReadStream(path);
  return path.endsWith('.gz') ? pipelineWithCallback(raw, createGunzip(), () => {}) : raw;
}

async function* lines(path) {
  const decoder = new StringDecoder('utf-8');
  let rest = '';
  for await (const chunk of chunks(path)) {
    const parts = (rest + decoder.write(chunk)).split('\n');
    rest = parts.pop();
    for (const part of parts) yield part.replace(/\r$/, '');
  }
  rest += decoder.end();
  if (rest) yield rest.replace(/\r$/, '');
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

/**
 * Copies the sequences whose (renamed) ID is in `ids`; a renamed header keeps its description.
 * Rejects on a duplicate written ID; resolves with the IDs written, in file order.
 */
export async function writeFastaSubset(src, dest, ids, rename = new Map()) {
  const written = [];
  async function* kept() {
    let keep = false;
    for await (const line of lines(src)) {
      let text = line;
      if (line.startsWith('>')) {
        const id = fastaId(line);
        const newId = rename.get(id) ?? id;
        keep = ids.has(newId);
        if (keep) {
          if (written.includes(newId)) throw new Error(`Duplicate FASTA ID ${newId} in ${src}`);
          written.push(newId);
        }
        text = `>${newId}${line.slice(1 + id.length)}`;
      }
      if (keep) yield `${text}\n`;
    }
  }
  await pipeline(Readable.from(kept()), createWriteStream(dest));
  return written;
}
