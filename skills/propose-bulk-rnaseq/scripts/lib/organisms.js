import { PROPOSALS_DIR, MANIFEST_FILENAME, proposalRelativePath } from './manifest.js';

export { ABBREV_SHAPE, SHAPE_RULE } from './manifest.js';

export const strainAbbrevOf = (strain) => strain.trim().replace(/\./g, '-').replace(/\s+/g, '_');

/** <g><sp><Strain>, or null when species is not a genus and a lettered epithet of three or more letters. */
export function conventionalAbbrev({ species, strain = '' }) {
  const [genus, epithet] = (species ?? '').trim().split(/\s+/);
  if (!/^[A-Za-z]/.test(genus ?? '') || !/^[A-Za-z]{3,}$/.test(epithet ?? '')) return null;
  return `${genus[0]}${epithet.slice(0, 3)}`.toLowerCase() + strainAbbrevOf(strain);
}

const DATASETS_DIR = 'Datasets/lib/xml/datasets';
const ORGANISM_FILE = /^Datasets\/lib\/xml\/datasets\/([^/]+)\/([^/]+)\.xml$/;
const CONSTANT = /<constant\s+name="(ncbiTaxonId|strainAbbrev)"\s+value="([^"]*)"/;

/** Every organism file on ref as { abbrev, project, ncbiTaxonId, strainAbbrev }; a constant the file lacks is undefined. */
export function readOrganismIndex(git, ref) {
  const byPath = new Map();
  for (const path of git.listTree(ref, DATASETS_DIR)) {
    const [, project, abbrev] = ORGANISM_FILE.exec(path) ?? [];
    if (abbrev) byPath.set(path, { abbrev, project, ncbiTaxonId: undefined, strainAbbrev: undefined });
  }
  for (const { path, text } of git.grepOnRef(ref, '<constant +name="(ncbiTaxonId|strainAbbrev)"', DATASETS_DIR)) {
    const [, name, value] = CONSTANT.exec(text) ?? [];
    const entry = byPath.get(path);
    if (entry && name) entry[name] = value;
  }
  return [...byPath.values()];
}

const newOrganismIn = (m) => (Array.isArray(m?.organisms) ? m.organisms.find((o) => o?.source === 'new') : undefined) ?? null;

const parseManifestOn = (git, ref, accession) => {
  try { return JSON.parse(git.showFile(ref, `${proposalRelativePath(accession)}/${MANIFEST_FILENAME}`)); }
  catch { return null; }
};

/** Genome proposals on refs, read unvalidated, as { accession, project, organism }; the first ref to hold an accession wins. */
export function pendingGenomeProposals(git, refs) {
  const found = new Map();
  for (const ref of refs) {
    for (const accession of git.listDir(ref, PROPOSALS_DIR)) {
      if (found.has(accession)) continue;
      const m = parseManifestOn(git, ref, accession);
      const organism = newOrganismIn(m);
      if (organism) found.set(accession, { accession, project: m.project, organism });
    }
  }
  return [...found.values()];
}

/** The new organism of genome proposal accession as ref, or the history behind it, last had it; null if never. */
export function genomeOrganismOf(git, ref, accession) {
  const path = `${proposalRelativePath(accession)}/${MANIFEST_FILENAME}`;
  if (git.fileExistsOnRef(ref, path)) return newOrganismIn(parseManifestOn(git, ref, accession));
  const deletion = git.commitsForPath(ref, path).pop();
  return deletion ? newOrganismIn(parseManifestOn(git, `${deletion}~1`, accession)) : null;
}

const claimedAbbrev = (c) => c.organism.organismAbbrev ?? c.organism.proposedOrganismAbbrev;

/** Why abbrev cannot name the new organism o of proposal accession: it exists, its taxon and strain are loaded, or a rival claims it. */
function newOrganismConflicts(o, abbrev, accession, { index, claims }, where) {
  const conflicts = [];
  const existing = index.find((e) => e.abbrev === abbrev);
  if (existing) conflicts.push(`${abbrev} already names ${existing.project}/${abbrev}.xml on ${where}: the organism is redundant or the abbreviation is wrong`);
  const strainAbbrev = strainAbbrevOf(o.strain ?? '');
  const twin = o.ncbiTaxonId && index.find((e) => e.ncbiTaxonId === o.ncbiTaxonId && e.strainAbbrev === strainAbbrev);
  if (twin) conflicts.push(`taxon ${o.ncbiTaxonId} strain ${strainAbbrev} is already loaded as ${twin.project}/${twin.abbrev} on ${where}`);
  const rival = claims.find((c) => c.accession !== accession && claimedAbbrev(c) === abbrev);
  if (rival) conflicts.push(`${abbrev} is already proposed by genome proposal ${rival.accession}`);
  return conflicts;
}

/** Why abbrev departs from the convention for o, or null when it follows it. */
function conventionProblem(o, abbrev) {
  const conventional = conventionalAbbrev(o);
  if (conventional === null) return `no conventional abbreviation can be derived from species "${o.species}"`;
  return abbrev === conventional ? null : `${abbrev} differs from the convention ${conventional}`;
}

/**
 * Phase 1: checks a draft manifest's proposed organisms against the organisms
 * on the rebuild branch (index) and the genome proposals pending on master
 * (claims), and records where each loaded-type organism comes from.
 * Returns { organisms, errors, warnings }.
 */
export function crossCheckOrganisms(m, { index, claims, rebuild }) {
  const errors = [];
  const warnings = [];
  const organisms = m.organisms.map((o) => {
    const p = o.proposedOrganismAbbrev;
    if (o.source === 'new') {
      errors.push(...newOrganismConflicts(o, p, m.accession, { index, claims }, rebuild));
      const problem = conventionProblem(o, p);
      if (problem) warnings.push(`${problem}; Phase 2 will stop for a person to decide`);
      return o;
    }
    if (index.some((e) => e.abbrev === p && e.project === m.project)) return { proposedOrganismAbbrev: p, source: 'loaded' };
    const elsewhere = index.find((e) => e.abbrev === p);
    if (elsewhere) {
      errors.push(`${p} is a ${elsewhere.project} organism on ${rebuild}, not ${m.project}`);
      return o;
    }
    const genome = claims.find((c) => c.project === m.project && claimedAbbrev(c) === p);
    if (genome) {
      warnings.push(`${p} is not loaded: genome proposal ${genome.accession} proposes it, so it is not settled. This dataset loads in the same build as that genome or later.`);
      return { proposedOrganismAbbrev: p, source: { proposal: genome.accession } };
    }
    errors.push(`${p} is not an organism on ${rebuild} and no genome proposal on master proposes it`);
    return o;
  });
  return { organisms, errors, warnings };
}
