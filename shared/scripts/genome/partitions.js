import { classifySequence, findReportRow } from './assembly-report.js';

const NUCLEAR_RANKS = ['chromosome', 'supercontig', 'contig'];
const ROLES = ['primary', 'secondary', 'organelle'];
const HEADER = 'sequence\trole\tsoTerm\torganelle';

export function readPartitionsTsv(text) {
  const [header, ...rows] = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (header !== HEADER) throw new Error('partitions.tsv header must be "sequence\\trole\\tsoTerm\\torganelle"');
  return rows.map((line, i) => {
    const where = `partitions.tsv line ${i + 2}`;
    const [sequence, role, soTerm, organelle = ''] = line.split('\t');
    if (!sequence) throw new Error(`${where}: sequence is empty`);
    if (!ROLES.includes(role)) throw new Error(`${where}: role must be one of ${ROLES.join(', ')}`);
    if (!soTerm) throw new Error(`${where}: soTerm is empty`);
    if (role === 'organelle' && !organelle) throw new Error(`${where}: an organelle partition needs its organelle`);
    return { sequence, role, soTerm, organelle: role === 'organelle' ? organelle : null };
  });
}

const dirOf = ({ role, soTerm, organelle }) => (role === 'organelle' ? `final/organelle_${organelle}` : `final/${role}_${soTerm}`);
const byOrder = (a, b) => (a.order === b.order ? 0 : a.order < b.order ? -1 : 1);
const rankOf = (p) => (p.role === 'organelle' ? NUCLEAR_RANKS.length : NUCLEAR_RANKS.indexOf(p.soTerm));

/** Sequence IDs are the input IDs; `renames` maps them to their final IDs. */
export function planPartitions({ sequenceIds, report, overrides = [], renames = new Map() }) {
  const overrideOf = new Map(overrides.map((o) => [o.sequence, o]));
  const placed = [];
  const problems = [];
  for (const id of sequenceIds) {
    const found = findReportRow(report, id);
    const seq = { id: renames.get(id) ?? id, name: found?.row.sequenceName ?? id, order: found?.index ?? Infinity };
    const override = overrideOf.get(id) ?? overrideOf.get(seq.id);
    if (override) { placed.push({ ...seq, role: override.role, soTerm: override.soTerm, organelle: override.organelle }); continue; }
    if (!found) { problems.push({ kind: 'notInReport', sequence: id }); continue; }
    const c = classifySequence(found.row);
    if (c.problem) { problems.push({ kind: c.problem, sequence: id }); continue; }
    placed.push(c.rank === 'organelle'
      ? { ...seq, role: 'organelle', soTerm: c.soTerm, organelle: c.organelle }
      : { ...seq, rank: c.rank });
  }
  const primaryRank = NUCLEAR_RANKS.find((r) => placed.some((p) => p.rank === r));
  for (const p of placed) {
    if (p.rank) Object.assign(p, { role: p.rank === primaryRank ? 'primary' : 'secondary', soTerm: p.rank, organelle: null });
  }
  const groups = new Map();
  for (const p of [...placed].sort(byOrder)) {
    const key = `${p.role}\t${p.soTerm}\t${p.organelle}`;
    if (!groups.has(key)) groups.set(key, { role: p.role, soTerm: p.soTerm, organelle: p.organelle, sequences: [] });
    groups.get(key).sequences.push({ id: p.id, name: p.name });
  }
  const partitions = [...groups.values()].map((g) => ({ ...g, dir: dirOf(g) }))
    .sort((a, b) => ROLES.indexOf(a.role) - ROLES.indexOf(b.role) || rankOf(a) - rankOf(b) || String(a.organelle).localeCompare(String(b.organelle)));
  const primaries = partitions.filter((p) => p.role === 'primary');
  if (primaries.length > 1) problems.push({ kind: 'multiplePrimary', sequence: primaries.map((p) => p.soTerm).join(', ') });
  if (partitions.length && !primaries.length) problems.push({ kind: 'noPrimary', sequence: '' });
  return { partitions, problems };
}

export const publicPartition = (p) =>
  ({ role: p.role, soTerm: p.soTerm, organelle: p.organelle, sequenceCount: p.sequences.length, dir: p.dir });

export const isChromosomePrimary = (p) => p.role === 'primary' && p.soTerm === 'chromosome';

export const chromosomeMapText = (p) => p.sequences.map((s, i) => `${s.id}\t${s.name}\t${i + 1}\n`).join('');
