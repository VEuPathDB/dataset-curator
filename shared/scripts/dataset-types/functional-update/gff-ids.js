import { closeSync, openSync, readSync } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
import { levelOf } from '../../genome/feature-types.js';
import { proteinIdOf } from '../../genome/functional/ids.js';

export const LEVELS = ['gene', 'transcript', 'protein'];
export const AMBIGUOUS = 'ambiguous';

const attrOf = (col9, key) => {
  for (const kv of col9.split(';')) if (kv.startsWith(`${key}=`)) return kv.slice(key.length + 1);
  return null;
};
const parentsIn = (col9) => attrOf(col9, 'Parent')?.split(',') ?? [];

/** Lines of a file in bounded memory. */
export function* linesOfFile(path) {
  const fd = openSync(path, 'r');
  const decoder = new StringDecoder('utf8');
  const buffer = Buffer.alloc(1 << 16);
  let rest = '';
  try {
    for (let n = readSync(fd, buffer, 0, buffer.length, null); n > 0; n = readSync(fd, buffer, 0, buffer.length, null)) {
      const parts = (rest + decoder.write(buffer.subarray(0, n))).split('\n');
      rest = parts.pop();
      yield* parts;
    }
  } finally {
    closeSync(fd);
  }
  const last = rest + decoder.end();
  if (last) yield last;
}

/**
 * Gene, transcript and protein IDs of a released GFF, from its lines (stopping at ##FASTA): transcripts are the RNA
 * children of a gene; proteins come from their CDSs (protein_source_id, else GusSkeletonMaker's `<transcript>-p1`).
 * IDs found at two levels are listed in `ambiguous`.
 */
export function idIndexOfLines(lines) {
  const genes = new Set();
  const rnas = [];
  const cdss = [];
  for (const line of lines) {
    if (line.startsWith('##FASTA')) break;
    if (line === '' || line.startsWith('#')) continue;
    const cols = line.split('\t');
    const level = levelOf(cols[2]);
    if (!level || cols.length < 9) continue;
    const id = attrOf(cols[8], 'ID');
    if (level === 'gene') { if (id) genes.add(id); }
    else if (level === 'transcript') { if (id) rnas.push({ id, parents: parentsIn(cols[8]) }); }
    else cdss.push({ parents: parentsIn(cols[8]), protein: attrOf(cols[8], 'protein_source_id') });
  }
  const geneOf = new Map();
  const transcriptsOf = new Map();
  for (const { id, parents } of rnas) {
    const gene = parents.find((p) => genes.has(p));
    if (!gene || geneOf.has(id)) continue;
    geneOf.set(id, gene);
    transcriptsOf.set(gene, [...(transcriptsOf.get(gene) ?? []), id]);
  }
  const proteinOf = new Map();
  const transcriptOf = new Map();
  for (const { parents, protein } of cdss) {
    for (const t of parents.filter((p) => geneOf.has(p) && !proteinOf.has(p))) {
      const id = protein ?? proteinIdOf(t);
      proteinOf.set(t, id);
      transcriptOf.set(id, t);
    }
  }
  const levels = new Map();
  for (const ids of [genes, geneOf.keys(), transcriptOf.keys()]) {
    for (const id of ids) levels.set(id, (levels.get(id) ?? 0) + 1);
  }
  const ambiguous = new Set([...levels].filter(([, n]) => n > 1).map(([id]) => id));
  return { genes, geneOf, transcriptsOf, proteinOf, transcriptOf, ambiguous };
}

export const idIndex = (text) => idIndexOfLines(text.split('\n'));
export const idIndexOfFile = (path) => idIndexOfLines(linesOfFile(path));

export function levelOfId(index, id) {
  if (index.ambiguous.has(id)) return AMBIGUOUS;
  if (index.genes.has(id)) return 'gene';
  if (index.geneOf.has(id)) return 'transcript';
  if (index.transcriptOf.has(id)) return 'protein';
  return null;
}

/** The IDs at level `to` that id (at level `from`) stands for; [] when it has none. */
export function mapId(index, id, from, to) {
  if (from === to) return [id];
  const transcripts = from === 'gene' ? index.transcriptsOf.get(id) ?? []
    : from === 'transcript' ? (index.geneOf.has(id) ? [id] : [])
      : [index.transcriptOf.get(id)].filter(Boolean);
  if (to === 'transcript') return transcripts;
  if (to === 'gene') return [...new Set(transcripts.map((t) => index.geneOf.get(t)).filter(Boolean))];
  return transcripts.map((t) => index.proteinOf.get(t)).filter(Boolean);
}
