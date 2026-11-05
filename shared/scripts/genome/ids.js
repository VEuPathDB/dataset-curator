import { cloneGraph, encode, featureGroups, getAttr, renameIds, renameSequences, seqIdsOf } from './gff.js';
import { levelOf } from './feature-types.js';

export const LEVELS = ['sequence', 'gene', 'transcript', 'protein'];
export const ID_POLICIES = ['ncbiDefault', 'none'];
const HEADER = 'level\told\tnew';

export function readIdsTsv(text) {
  const [header, ...lines] = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (header !== HEADER) return { entries: [], errors: ['ids.tsv header must be "level\\told\\tnew"'] };
  const entries = [];
  const errors = [];
  const seen = new Set();
  lines.forEach((text, i) => {
    const line = i + 2;
    const [level, old, nu] = text.split('\t');
    if (!LEVELS.includes(level)) errors.push(`ids.tsv line ${line}: level must be one of ${LEVELS.join(', ')}`);
    else if (!old || !nu) errors.push(`ids.tsv line ${line}: needs level, old and new`);
    else if (seen.has(old)) errors.push(`ids.tsv line ${line}: old ${old} is repeated`);
    else { seen.add(old); entries.push({ level, old, new: encode(nu), line }); }
  });
  return { entries, errors };
}

export const idsTsvText = (rows) => [HEADER, ...rows.map((r) => `${r.level}\t${r.old}\t${r.new}`), ''].join('\n');

const strip = (id, prefix) => (id.startsWith(prefix) ? id.slice(prefix.length) : id);

function ncbiDefaultRows(groups) {
  const renamed = (level, pick) => groups.filter((g) => pick(g)).map((g) => ({ level, old: g.id, new: newIdOf(g) }));
  const newIdOf = (g) => {
    if (levelOf(g.type) === 'gene') return getAttr(g.lines[0], 'locus_tag') ?? strip(g.id, 'gene-');
    if (g.type === 'mRNA') return strip(g.id, 'rna-');
    return getAttr(g.lines[0], 'protein_id') ?? g.id;
  };
  return [
    ...renamed('gene', (g) => levelOf(g.type) === 'gene'),
    ...renamed('transcript', (g) => g.type === 'mRNA'),
    ...renamed('protein', (g) => levelOf(g.type) === 'protein')
  ].filter((r) => r.old !== r.new);
}

/** Renames by the settled mapping; collisions are reported, not thrown, so survey can show them. */
function settle(graph, groups, mapping, sequenceRenames) {
  const owners = new Map();
  for (const g of groups) {
    const id = mapping.get(g.id) ?? g.id;
    if (!owners.has(id)) owners.set(id, []);
    owners.get(id).push({ id: g.id, level: levelOf(g.type), type: g.type });
  }
  const collisions = [...owners].filter(([, olds]) => olds.length > 1).map(([id, olds]) => ({ id, olds }));
  const out = cloneGraph(graph);
  renameIds(out, mapping);
  renameSequences(out, sequenceRenames);
  const inputIdOf = new Map([...mapping, ...sequenceRenames].map(([old, nu]) => [nu, old]));
  return { graph: out, collisions, sequenceRenames, inputIdOf };
}

/**
 * Phase 1: the policy's IDs, then ids.tsv lines keyed by input IDs (features and sequences),
 * then the collision check. Any ids.tsv error returns the input graph untouched.
 */
export function applyIdPolicy(graph, { policy, overrides = [], sequenceIds = seqIdsOf(graph) }) {
  if (!ID_POLICIES.includes(policy)) throw new Error(`idPolicy must be one of ${ID_POLICIES.join(', ')}`);
  const groups = featureGroups(graph).filter((g) => g.id !== null);
  const defaults = policy === 'ncbiDefault' ? ncbiDefaultRows(groups) : [];
  const mapping = new Map(defaults.map((r) => [r.old, r.new]));
  const inputLevel = new Map(groups.map((g) => [g.id, levelOf(g.type)]));
  const sequences = new Set(sequenceIds);
  const sequenceRenames = new Map();
  const errors = [];
  const applied = [];
  for (const o of overrides) {
    const present = o.level === 'sequence' ? sequences.has(o.old) : inputLevel.get(o.old) === o.level;
    if (!present) {
      errors.push(`ids.tsv line ${o.line}: ${o.level} ${o.old} is not an input ${o.level} ID (see the old column of ids.default.tsv)`);
      continue;
    }
    (o.level === 'sequence' ? sequenceRenames : mapping).set(o.old, o.new);
    applied.push(o);
  }
  const holders = new Map();
  const hold = (level, input, settled) => {
    const key = `${level}\t${settled}`;
    if (!holders.has(key)) holders.set(key, []);
    holders.get(key).push(input);
  };
  for (const g of groups) hold(inputLevel.get(g.id), g.id, mapping.get(g.id) ?? g.id);
  for (const s of sequences) hold('sequence', s, sequenceRenames.get(s) ?? s);
  for (const o of applied) {
    if (holders.get(`${o.level}\t${o.new}`).some((id) => id !== o.old)) errors.push(`ids.tsv line ${o.line}: new ${o.level} ID ${o.new} is already taken`);
  }
  if (errors.length) return { graph, defaults, collisions: [], errors, applied: 0, sequenceRenames: new Map(), inputIdOf: new Map() };
  return { ...settle(graph, groups, mapping, sequenceRenames), defaults, errors, applied: applied.length };
}
