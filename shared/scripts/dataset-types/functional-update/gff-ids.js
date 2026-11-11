import { features, getAttr, idOf, parentsOf, parseGff } from '../../genome/gff.js';
import { GENE_TYPES } from '../../genome/feature-types.js';
import { proteinIdOf } from '../../genome/functional/ids.js';

export const LEVELS = ['gene', 'transcript', 'protein'];
const PARTS = new Set(['exon', 'CDS', 'five_prime_UTR', 'three_prime_UTR', 'intron', 'start_codon', 'stop_codon', 'polypeptide']);

/** Gene, transcript and protein IDs of a released GFF: transcripts are a gene's direct non-part children; proteins come from their CDSs. */
export function idIndex(text) {
  const fasta = text.indexOf('\n##FASTA');
  const all = features(parseGff(fasta < 0 ? text : text.slice(0, fasta + 1)));
  const genes = new Set(all.filter((f) => GENE_TYPES.has(f.type) && idOf(f)).map(idOf));
  const geneOf = new Map();
  const transcriptsOf = new Map();
  for (const f of all) {
    const id = idOf(f);
    if (!id || PARTS.has(f.type) || genes.has(id) || geneOf.has(id)) continue;
    const gene = parentsOf(f).find((p) => genes.has(p));
    if (!gene) continue;
    geneOf.set(id, gene);
    transcriptsOf.set(gene, [...(transcriptsOf.get(gene) ?? []), id]);
  }
  const proteinOf = new Map();
  const transcriptOf = new Map();
  for (const f of all.filter((x) => x.type === 'CDS')) {
    for (const t of parentsOf(f).filter((p) => geneOf.has(p) && !proteinOf.has(p))) {
      const protein = getAttr(f, 'protein_source_id') ?? proteinIdOf(t);
      proteinOf.set(t, protein);
      transcriptOf.set(protein, t);
    }
  }
  return { genes, geneOf, transcriptsOf, proteinOf, transcriptOf };
}

export function levelOfId(index, id) {
  if (index.genes.has(id)) return 'gene';
  if (index.geneOf.has(id)) return 'transcript';
  if (index.transcriptOf.has(id)) return 'protein';
  return null;
}

/** The IDs at level `to` that id (at level `from`) stands for; [] when it has none. */
export function mapId(index, id, from, to) {
  if (from === to) return [id];
  const transcripts = from === 'gene' ? index.transcriptsOf.get(id) ?? []
    : from === 'transcript' ? [id] : [index.transcriptOf.get(id)].filter(Boolean);
  if (to === 'transcript') return transcripts;
  if (to === 'gene') return [...new Set(transcripts.map((t) => index.geneOf.get(t)))];
  return transcripts.map((t) => index.proteinOf.get(t)).filter(Boolean);
}
