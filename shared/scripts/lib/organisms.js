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
