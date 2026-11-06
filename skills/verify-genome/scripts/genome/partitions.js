import { classifySequence, findReportRow } from './assembly-report.js';

const NUCLEAR_RANKS = ['chromosome', 'supercontig', 'contig'];
const ROLES = ['primary', 'secondary', 'organelle'];
const HEADER = 'sequence\trole\tsoTerm\torganelle';

const NAME = /^[A-Za-z0-9_]+$/;

export function readPartitionsTsv(text) {
  const numbered = text.split(/\r?\n/).map((line, i) => ({ line, number: i + 1 })).filter((l) => l.line.trim() !== '');
  const [header, ...rows] = numbered;
  if (header?.line !== HEADER) throw new Error('partitions.tsv header must be "sequence\\trole\\tsoTerm\\torganelle"');
  const lineOf = new Map();
  return rows.map(({ line, number }) => {
    const where = `partitions.tsv line ${number}`;
    const cells = line.split('\t');
    if (cells.length > 4) throw new Error(`${where}: expected 4 columns, found ${cells.length}`);
    const [sequence, role, soTerm, organelle = ''] = cells;
    if (!sequence) throw new Error(`${where}: sequence is empty`);
    if (lineOf.has(sequence)) throw new Error(`${where}: ${sequence} is already on line ${lineOf.get(sequence)}`);
    lineOf.set(sequence, number);
    if (!ROLES.includes(role)) throw new Error(`${where}: role must be one of ${ROLES.join(', ')}`);
    if (!soTerm) throw new Error(`${where}: soTerm is empty`);
    if (!NAME.test(soTerm)) throw new Error(`${where}: soTerm must be letters, digits and underscores`);
    if (role === 'organelle') {
      if (!organelle) throw new Error(`${where}: an organelle partition needs its organelle`);
      if (!NAME.test(organelle)) throw new Error(`${where}: organelle must be letters, digits and underscores`);
    } else {
      if (organelle) throw new Error(`${where}: only an organelle partition takes an organelle`);
      if (!NUCLEAR_RANKS.includes(soTerm)) throw new Error(`${where}: soTerm must be one of ${NUCLEAR_RANKS.join(', ')} for a ${role} partition`);
    }
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
  const usedOverrides = new Set();
  for (const id of sequenceIds) {
    const found = findReportRow(report, id);
    const seq = { id: renames.get(id) ?? id, name: found?.row.sequenceName ?? id, order: found?.index ?? Infinity };
    const override = overrideOf.get(id) ?? overrideOf.get(seq.id);
    if (override) {
      usedOverrides.add(override);
      placed.push({ ...seq, role: override.role, soTerm: override.soTerm, organelle: override.organelle });
      continue;
    }
    if (report.duplicateAccessions.has(id)) { problems.push({ kind: 'duplicateAccession', sequence: id }); continue; }
    if (!found) { problems.push({ kind: 'notInReport', sequence: id }); continue; }
    const c = classifySequence(found.row);
    if (c.problem) { problems.push({ kind: c.problem, sequence: id }); continue; }
    placed.push(c.rank === 'organelle'
      ? { ...seq, role: 'organelle', soTerm: c.soTerm, organelle: c.organelle }
      : { ...seq, rank: c.rank });
  }
  for (const o of overrides) {
    if (!usedOverrides.has(o)) problems.push({ kind: 'unusedOverride', sequence: o.sequence });
  }
  const rankPresent = (r) => placed.some((p) => (p.rank ?? (p.role === 'primary' ? p.soTerm : null)) === r);
  const primaryRank = NUCLEAR_RANKS.find(rankPresent);
  for (const p of placed) {
    if (p.rank) Object.assign(p, { role: p.rank === primaryRank ? 'primary' : 'secondary', soTerm: p.rank, organelle: null });
  }
  const groups = new Map();
  for (const p of [...placed].sort(byOrder)) {
    const dir = dirOf(p);
    if (!groups.has(dir)) groups.set(dir, { role: p.role, soTerm: p.soTerm, organelle: p.organelle, dir, sequences: [], soTerms: new Set() });
    const group = groups.get(dir);
    group.soTerms.add(p.soTerm);
    group.sequences.push({ id: p.id, name: p.name });
  }
  for (const g of groups.values()) {
    if (g.soTerms.size > 1) problems.push({ kind: 'conflictingSoTerm', sequence: `${g.organelle}: ${[...g.soTerms].join(', ')}` });
    delete g.soTerms;
  }
  const partitions = [...groups.values()]
    .sort((a, b) => ROLES.indexOf(a.role) - ROLES.indexOf(b.role) || rankOf(a) - rankOf(b) || String(a.organelle).localeCompare(String(b.organelle)));
  const primaries = partitions.filter((p) => p.role === 'primary');
  if (primaries.length > 1) problems.push({ kind: 'multiplePrimary', sequence: primaries.map((p) => p.soTerm).join(', ') });
  if (partitions.length && !primaries.length) problems.push({ kind: 'noPrimary', sequence: null });
  return { partitions, problems };
}

export const publicPartition = (p) =>
  ({ role: p.role, soTerm: p.soTerm, organelle: p.organelle, sequenceCount: p.sequences.length, dir: p.dir });

export const isChromosomePrimary = (p) => p.role === 'primary' && p.soTerm === 'chromosome';

export const chromosomeMapText = (p) => p.sequences.map((s, i) => `${s.id}\t${s.name}\t${i + 1}\n`).join('');
