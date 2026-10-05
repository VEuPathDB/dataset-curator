import { ABBREV_SHAPE, SHAPE_RULE, PROPOSALS_DIR, MANIFEST_FILENAME, proposalRelativePath } from './manifest.js';

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

/**
 * Every organism file on ref as { abbrev, project, ncbiTaxonId, strainAbbrev }; a constant the file lacks is undefined.
 * strainAbbrev is read through strainAbbrevOf, so a legacy dotted strain compares like a new one.
 */
export function readOrganismIndex(git, ref) {
  const byPath = new Map();
  for (const path of git.listTree(ref, DATASETS_DIR)) {
    const [, project, abbrev] = ORGANISM_FILE.exec(path) ?? [];
    if (abbrev) byPath.set(path, { abbrev, project, ncbiTaxonId: undefined, strainAbbrev: undefined });
  }
  for (const { path, text } of git.grepOnRef(ref, '<constant +name="(ncbiTaxonId|strainAbbrev)"', DATASETS_DIR)) {
    const [, name, value] = CONSTANT.exec(text) ?? [];
    const entry = byPath.get(path);
    if (entry && name) entry[name] = name === 'strainAbbrev' ? strainAbbrevOf(value) : value;
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
      if (organism) found.set(accession, { accession, project: organism.project ?? m.project, organism });
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

/**
 * Why abbrev cannot name the new organism o of proposal accession, as
 * { message, ofAbbrev }: ofAbbrev conflicts depend on the abbreviation chosen,
 * the others (a loaded or rival taxon and strain) do not.
 */
function newOrganismProblems(o, abbrev, accession, { index, claims }, where) {
  const problems = [];
  const existing = index.find((e) => e.abbrev === abbrev);
  if (existing) problems.push({ ofAbbrev: true, message: `${abbrev} already names ${existing.project}/${abbrev}.xml on ${where}: the organism is redundant or the abbreviation is wrong` });
  const undotted = (a) => a.replace(/\./g, '-');
  const dotted = !existing && index.find((e) => undotted(e.abbrev) === undotted(abbrev));
  if (dotted) problems.push({ ofAbbrev: true, message: `${abbrev} matches ${dotted.project}/${dotted.abbrev}.xml once "." is read as "-": the organism is redundant or the abbreviation is wrong` });
  const strainAbbrev = strainAbbrevOf(o.strain ?? '');
  const twin = o.ncbiTaxonId && index.find((e) => e.ncbiTaxonId === o.ncbiTaxonId && (e.strainAbbrev ?? '') === strainAbbrev);
  if (twin) problems.push({ ofAbbrev: false, message: `taxon ${o.ncbiTaxonId} strain ${strainAbbrev} is already loaded as ${twin.project}/${twin.abbrev} on ${where}` });
  const rival = claims.find((c) => c.accession !== accession && claimedAbbrev(c) === abbrev);
  if (rival) problems.push({ ofAbbrev: true, message: `${abbrev} is already proposed by genome proposal ${rival.accession}` });
  const rivalTwin = o.ncbiTaxonId && claims.find((c) => c.accession !== accession && c !== rival && c.organism.ncbiTaxonId === o.ncbiTaxonId && strainAbbrevOf(c.organism.strain ?? '') === strainAbbrev);
  if (rivalTwin) problems.push({ ofAbbrev: false, message: `taxon ${o.ncbiTaxonId} strain ${strainAbbrev} is also proposed by genome proposal ${rivalTwin.accession} as ${claimedAbbrev(rivalTwin)}` });
  return problems;
}

const newOrganismConflicts = (...args) => newOrganismProblems(...args).map((p) => p.message);

/** Why abbrev departs from the convention for o, or null when it follows it. */
function conventionProblem(o, abbrev) {
  const conventional = conventionalAbbrev(o);
  if (conventional === null) return `no conventional abbreviation can be derived from species "${o.species}"`;
  return abbrev === conventional ? null : `${abbrev} differs from the convention ${conventional}`;
}

/**
 * Phase 1: checks a draft manifest's proposed organisms against the organisms
 * on the rebuild branch (index) and the genome proposals pending on master
 * (claims), and records where each loaded-type organism comes from and its
 * project; an organism without a project takes the one it is found in.
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
    const placed = o.project !== undefined;
    const here = index.find((e) => e.abbrev === p && (!placed || e.project === o.project)) ?? index.find((e) => e.abbrev === p);
    if (here) {
      if (placed && here.project !== o.project) {
        errors.push(`${p} is a ${here.project} organism on ${rebuild}, not ${o.project}`);
        return o;
      }
      return { proposedOrganismAbbrev: p, source: 'loaded', project: here.project };
    }
    const genome = claims.find((c) => (!placed || c.project === o.project) && claimedAbbrev(c) === p);
    if (genome) {
      warnings.push(`${p} is not loaded: genome proposal ${genome.accession} proposes it, so it is not settled. This dataset loads in the same build as that genome or later.`);
      return { proposedOrganismAbbrev: p, source: { proposal: genome.accession }, project: genome.project };
    }
    errors.push(`${p} is not an organism on ${rebuild} and no genome proposal on master proposes it`);
    return o;
  });
  return { organisms, errors, warnings };
}

/** Why abbrev is not a loaded organism of project on the index, or null when it is. */
function loadedProblem(abbrev, project, index) {
  if (index.some((e) => e.abbrev === abbrev && e.project === project)) return null;
  const elsewhere = index.find((e) => e.abbrev === abbrev);
  return elsewhere ? `${abbrev} is a ${elsewhere.project} organism, not ${project}` : `no organism file ${project}/${abbrev}.xml on this branch`;
}

function settleLinked(o, chosen, { index, genomeOf }, notes) {
  const accession = o.source.proposal;
  const genome = genomeOf(accession);
  if (!genome) return { stop: `genome proposal ${accession} cannot be found on this branch, on origin/master or in their history` };
  const strainAbbrev = strainAbbrevOf(genome.strain ?? '');
  const recordsGenome = (e) => e.project === o.project && e.ncbiTaxonId === genome.ncbiTaxonId && (e.strainAbbrev ?? '') === strainAbbrev;
  if (chosen !== undefined) {
    const problem = loadedProblem(chosen, o.project, index);
    if (problem) return { stop: problem };
    if (genome.ncbiTaxonId && !recordsGenome(index.find((e) => e.abbrev === chosen && e.project === o.project))) {
      notes.push(`${chosen} does not record genome ${accession} taxon ${genome.ncbiTaxonId} and strain ${strainAbbrev}`);
    }
    return { abbrev: chosen };
  }
  if (!genome.ncbiTaxonId) {
    const problem = loadedProblem(o.proposedOrganismAbbrev, o.project, index);
    if (problem) return { stop: `genome proposal ${accession} is not loaded: ${problem}` };
    notes.push(`matched by abbreviation only: genome proposal ${accession} records no taxon id`);
    return { abbrev: o.proposedOrganismAbbrev };
  }
  const matches = index.filter(recordsGenome);
  if (matches.length === 0) {
    return { stop: `genome proposal ${accession} (taxon ${genome.ncbiTaxonId}, strain ${strainAbbrev}) is not loaded on this branch; load it first, in this build or an earlier one`, clearable: true };
  }
  if (matches.length > 1) return { stop: `taxon ${genome.ncbiTaxonId} strain ${strainAbbrev} matches ${matches.map((e) => e.abbrev).join(', ')}`, clearable: true };
  if (matches[0].abbrev !== o.proposedOrganismAbbrev) notes.push(`genome ${accession} loaded as ${matches[0].abbrev}`);
  return { abbrev: matches[0].abbrev };
}

/**
 * Phase 2: the abbreviation each of the manifest's organisms loads under.
 * index is the rebuild branch's organism files; claims the genome proposals
 * pending anywhere; genomeOf(accession) a genome proposal's new organism or
 * null. settle ({ proposed: abbrev }) is a person's decision: it clears a
 * convention, matching or unloaded-genome stop, never an abbreviation that is
 * taken or missing.
 * Returns { organisms: [{ proposed, abbrev, notes }], stops }.
 */
export function settleOrganisms(m, { index, claims, genomeOf, settle }) {
  const decisions = settle ?? {};
  const stops = [];
  const proposedAll = m.organisms.map((o) => o.proposedOrganismAbbrev);
  for (const k of Object.keys(decisions)) {
    if (!proposedAll.includes(k)) stops.push(`--settle names ${k}, which is not an organism of ${m.accession}`);
  }
  const organisms = m.organisms.map((o) => {
    const proposed = o.proposedOrganismAbbrev;
    const chosen = Object.hasOwn(decisions, proposed) ? decisions[proposed] : undefined;
    const notes = chosen === undefined ? [] : ['settled by the loader'];
    const stop = (msg, clearable = false) => {
      for (const one of [msg].flat()) stops.push(`${proposed}: ${one}${clearable ? ` (a person may decide with --settle ${proposed}=<abbrev>)` : ''}`);
      return { proposed, abbrev: null, notes };
    };
    const known = o.source === 'new' || o.source === 'loaded' || typeof o.source?.proposal === 'string';
    if (!known) return stop('source must be "new", "loaded" or { "proposal": <accession> }');
    const candidate = chosen ?? proposed;
    if (!ABBREV_SHAPE.test(candidate)) return stop(`${candidate} must be ${SHAPE_RULE}`);
    if (o.source === 'new') {
      const problems = newOrganismProblems(o, candidate, m.accession, { index, claims }, 'this branch');
      if (problems.length) return stop(problems.map((p) => p.message));
      if (chosen !== undefined) {
        if (chosen !== proposed) {
          for (const p of newOrganismProblems(o, proposed, m.accession, { index, claims }, 'this branch')) {
            if (p.ofAbbrev) notes.push(`proposed ${proposed}: ${p.message}`);
          }
        }
        return { proposed, abbrev: candidate, notes };
      }
      const clearable = [conventionProblem(o, candidate), o.ncbiTaxonId ? null : 'no taxon id, so it cannot be checked against loaded organisms'].filter(Boolean);
      return clearable.length ? stop(clearable, true) : { proposed, abbrev: candidate, notes };
    }
    if (o.source === 'loaded') {
      const problem = loadedProblem(candidate, o.project, index);
      return problem ? stop(problem) : { proposed, abbrev: candidate, notes };
    }
    const linked = settleLinked(o, chosen, { index, genomeOf }, notes);
    return linked.stop ? stop(linked.stop, linked.clearable) : { proposed, abbrev: linked.abbrev, notes };
  });
  const byAbbrev = new Map();
  for (const o of organisms) if (o.abbrev) byAbbrev.set(o.abbrev, [...(byAbbrev.get(o.abbrev) ?? []), o.proposed]);
  for (const [a, names] of byAbbrev) {
    if (names.length < 2) continue;
    const list = names.length === 2 ? `both ${names[0]} and ${names[1]}` : `all of ${names.join(', ')}`;
    stops.push(`${a} is settled for ${list}`);
  }
  return { organisms, stops };
}
