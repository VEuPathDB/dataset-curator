import { decode, features, getValues, idOf, parentsOf } from './gff.js';
import { ISF_RNA_TYPES } from './feature-types.js';

export const EXPECTED_PREPROCESSOR = 'ApiCommonData::Load::genemRNAExonCDS2BioperlTree';
/** Keys preprocessGFF3 adds (PMIDs and previous IDs pulled out of product and comment). */
export const ALLOWED_EXTRA_KEYS = new Set(['Dbxref', 'previous_systematic_id']);

const attrOf = (text, name) => text.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`))?.[1] ?? null;

export function readIsfMap(xml) {
  const text = xml.replace(/<!--[\s\S]*?-->/g, '');
  const preprocessor = text.match(/<bioperlSeqPreprocessor\s+class="([^"]+)"/)?.[1] ?? null;
  if (preprocessor !== EXPECTED_PREPROCESSOR) throw new Error(`the map names preprocessor ${preprocessor}; only ${EXPECTED_PREPROCESSOR} is ported`);
  const byName = new Map();
  for (const [, attrs, body = ''] of text.matchAll(/<feature\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/feature>)/g)) {
    const qualifiers = new Set([...body.matchAll(/<qualifier\s+([^>]*?)\/?>/g)].map(([, q]) => attrOf(q, 'name')));
    byName.set(attrOf(attrs, 'name'), { ignore: attrOf(attrs, 'ignore') === 'true', qualifiers });
  }
  return { preprocessor, features: byName };
}

// Port of genemRNAExonCDS2BioperlTree: types, IDs, kept keys and coordinates only.
const STANDALONE_RNA = new Set(['tRNA', 'rRNA', 'snRNA', 'snoRNA']);
const KEPT_AS_IS = new Set(['gap', 'direct_repeat', 'three_prime_utr', 'transposable_element', 'five_prime_utr', 'splice_acceptor_site']);
const UTR_TYPES = new Set(['five_prime_utr', 'three_prime_utr', 'splice_acceptor_site']);
const NOT_COPIED = new Set(['ID', 'Parent', 'Derives_from']);
const STRAND = { '+': 1, '-': -1 };

const copied = (keys) => [...keys].filter((k) => !NOT_COPIED.has(k));
const node = (type, src, id, keys) => ({
  type, id, gffType: src.type, seqId: src.seqId, start: src.start, end: src.end, strand: src.strand,
  keys: [...new Set(keys)].sort(), children: []
});
const exonOf = (src) => node('exon', src, null, ['CodingEnd', 'CodingStart']);

function sourceNodes(graph) {
  const nodes = features(graph).map((f) => ({
    type: f.type, id: idOf(f), seqId: f.seqId, start: f.start, end: f.end, strand: STRAND[f.strand] ?? 0,
    keys: f.attrs.map(([k]) => k), parents: parentsOf(f),
    attr: (key) => { const [v] = getValues(f, key); return v === undefined ? null : decode(v); }
  }));
  const firstById = new Map();
  for (const n of nodes) if (n.id !== null && !firstById.has(n.id)) firstById.set(n.id, n);
  const kids = new Map();
  const top = [];
  const orphans = new Set();
  for (const n of nodes) {
    if (!n.parents.length) { top.push(n); continue; }
    for (const p of n.parents) {
      const parent = firstById.get(p);
      if (!parent) { orphans.add(n); continue; }
      if (!kids.has(parent)) kids.set(parent, []);
      kids.get(parent).push(n);
    }
  }
  return { top, orphans: [...orphans], childrenOf: (n) => kids.get(n) ?? [] };
}

function rnaType(rna, rnaKeys) {
  let type = rna.type;
  if (type === 'misc_RNA') type = 'ncRNA';
  if (type === 'lnc_RNA') type = 'lncRNA';
  if (type === 'srpRNA' || type === 'SRP.RNA') type = 'SRP_RNA';
  if (type === 'pseudogenic_transcript') { rnaKeys.add('pseudo'); type = 'coding'; }
  if (type === 'V_gene_segment' || type === 'C_gene_segment') type = 'misc_feature';
  if (type === 'mRNA') type = 'coding';
  if (type === 'transcript') type = rna.attr('biotype') ?? rna.attr('gbkey') ?? 'coding';
  return type;
}

function traverse(gene, geneKeys, childrenOf) {
  let out = null;
  const utrs = [];
  for (const rna of [...childrenOf(gene)].sort((a, b) => a.start - b.start || a.end - b.end)) {
    if (!ISF_RNA_TYPES.has(rna.type)) continue;
    const rnaKeys = new Set(rna.keys);
    const type = rnaType(rna, rnaKeys);
    if (!out) out = node(`${type}_gene`, gene, gene.id, ['ID', ...copied(geneKeys)]);
    else if (type === 'coding' && out.type !== 'coding_gene') out.type = 'coding_gene';
    const transcript = node(type === 'coding' ? 'mRNA' : type, rna, rna.id, ['ID', ...copied(rnaKeys)]);
    for (const [flag, alt] of [['pseudo', 'Pseudo'], ['partial', 'Partial']]) {
      const has = (keys) => keys.includes(flag) || keys.includes(alt);
      if (has(out.keys) && !has(transcript.keys)) transcript.keys = [...transcript.keys, flag].sort();
    }
    for (const sub of [...childrenOf(rna)].sort((a, b) => a.start - b.start)) {
      if (sub.type === 'exon') transcript.children.push(exonOf(sub));
      else if (UTR_TYPES.has(sub.type.toLowerCase())) utrs.push(node(sub.type.toLowerCase(), sub, null, copied(sub.keys)));
    }
    if (!transcript.children.length) transcript.children.push(exonOf(rna));
    out.start = Math.min(out.start, transcript.start);
    out.end = Math.max(out.end, transcript.end);
    out.children.push(transcript);
  }
  if (out) {
    out.id = out.id.replace(':pseudogene', '');
    if (out.type === 'coding_gene') {
      let coding = false;
      let pseudo = false;
      for (const t of out.children) {
        if (t.keys.includes('pseudo') || t.type === 'pseudogenic_transcript') { pseudo = true; t.type = 'pseudogenic_transcript'; }
        else coding = true;
      }
      if (pseudo && !coding) out.type = 'pseudogene';
    }
  }
  return { gene: out, utrs };
}

function pseudogeneTree(n, keys) {
  const gene = node('pseudogene', n, n.id, [...keys]);
  const transcript = node('pseudogenic_transcript', n, `${n.id}.mRNA`, ['ID', 'pseudo']);
  transcript.children.push(exonOf(n));
  gene.children.push(transcript);
  return gene;
}

function standaloneRnaTree(n, type, keys) {
  const gene = node(`${type}_gene`, n, n.id, ['ID', ...copied(keys)]);
  const transcript = node(type, n, `${n.id}.${type}`, ['ID']);
  transcript.children.push(exonOf(n));
  gene.children.push(transcript);
  return gene;
}

/** The trees ISF builds from a GFF (types, IDs, kept keys, coordinates) and the features it drops. */
export function isfTrees(graph) {
  const { top, orphans, childrenOf } = sourceNodes(graph);
  const trees = [];
  const dropped = [...orphans];
  for (const n of top) {
    let type = n.type;
    const keys = new Set(n.keys);
    if (type === 'protein_coding_gene' || type === 'ncRNA_gene') type = 'gene';
    if (type === 'pseudogene') { type = 'gene'; keys.add('pseudo'); }
    if (type === 'repeat_region' || type === 'STS') {
      const name = type === 'repeat_region' && keys.has('satellite') ? 'microsatellite' : type;
      trees.push(node(name, n, n.id ?? n.seqId, [...keys, 'ID']));
    } else if (STANDALONE_RNA.has(type)) {
      trees.push(standaloneRnaTree(n, type, keys));
    } else if (type === 'gene') {
      if (/pseudogene/i.test(n.attr('Note') ?? '') || /pseudogene/i.test(n.attr('description') ?? '')) keys.add('pseudo');
      if (keys.has('pseudo') && !childrenOf(n).length) { trees.push(pseudogeneTree(n, keys)); continue; }
      const { gene, utrs } = traverse(n, keys, childrenOf);
      if (gene) trees.push(gene); else dropped.push(n);
      trees.push(...utrs);
    } else if (KEPT_AS_IS.has(type)) {
      trees.push(node(type, n, n.id, [...keys]));
    } else {
      dropped.push(n);
    }
  }
  return { trees, dropped };
}
