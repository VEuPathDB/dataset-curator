const COLUMNS = {
  'Sequence-Name': 'sequenceName',
  'Sequence-Role': 'role',
  'Assigned-Molecule': 'assignedMolecule',
  'Assigned-Molecule-Location/Type': 'locationType',
  'GenBank-Accn': 'genbank',
  'RefSeq-Accn': 'refseq',
  'Sequence-Length': 'length'
};
const ORGANELLES = {
  Mitochondrion: { organelle: 'mitochondrion', soTerm: 'mitochondrial_chromosome' },
  Apicoplast: { organelle: 'apicoplast', soTerm: 'apicoplast_chromosome' },
  Chloroplast: { organelle: 'chloroplast', soTerm: 'chloroplast_chromosome' }
};
const NUCLEAR_ROLES = new Set(['assembled-molecule', 'unlocalized-scaffold', 'unplaced-scaffold', 'alt-scaffold', 'fix-patch', 'novel-patch']);
const NUCLEAR_LOCATIONS = new Set(['Chromosome', 'na']);
const WGS_CONTIG = /^[A-Z]{4,6}\d{8,}(\.\d+)?$/;

export function parseAssemblyReport(text) {
  const lines = text.split(/\r?\n/);
  const header = lines.find((l) => l.startsWith('# Sequence-Name'));
  if (!header) throw new Error('the assembly report has no "# Sequence-Name" header line');
  const names = header.slice(2).split('\t');
  const rows = lines.filter((l) => l && !l.startsWith('#')).map((l) => {
    const cells = l.split('\t');
    const row = {};
    names.forEach((name, i) => { if (COLUMNS[name]) row[COLUMNS[name]] = cells[i]; });
    return row;
  });
  const byAccession = new Map();
  rows.forEach((row, index) => {
    for (const acc of [row.genbank, row.refseq]) if (acc && acc !== 'na') byAccession.set(acc, { row, index });
  });
  return { rows, byAccession };
}

export const findReportRow = (report, seqId) => report.byAccession.get(seqId) ?? null;

export function classifySequence(row) {
  if (!row.genbank || row.genbank === 'na') return { problem: 'missingAccession' };
  if (ORGANELLES[row.locationType]) return { rank: 'organelle', ...ORGANELLES[row.locationType] };
  if (!NUCLEAR_ROLES.has(row.role)) return { problem: 'unknownRole' };
  if (!NUCLEAR_LOCATIONS.has(row.locationType)) return { problem: 'unknownLocationType' };
  if (row.role === 'assembled-molecule') return row.locationType === 'Chromosome' ? { rank: 'chromosome' } : { problem: 'unknownLocationType' };
  return { rank: WGS_CONTIG.test(row.genbank) ? 'contig' : 'supercontig' };
}
