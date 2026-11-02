export const projectFileRelativePath = (project) => `Datasets/lib/xml/datasets/${project}.xml`;

const ORGANISM_DATASET = /<dataset\s+class="organism"\s*>([\s\S]*?)<\/dataset>/g;
const PROP = /<prop\s+name="(\w+)">([^<]*)<\/prop>/g;

/** The organism datasets of a project file; commented-out ones are skipped. */
export function readProjectOrganisms(xml) {
  const live = xml.replace(/<!--[\s\S]*?-->/g, '');
  return [...live.matchAll(ORGANISM_DATASET)].map(([, body]) => {
    const p = Object.fromEntries([...body.matchAll(PROP)].map(([, k, v]) => [k, v.trim()]));
    return {
      organismAbbrev: p.organismAbbrev,
      speciesNcbiTaxonId: p.speciesNcbiTaxonId,
      isReferenceStrain: p.isReferenceStrain === 'true',
      isFamilyRepresentative: p.isFamilyRepresentative === 'true',
      familyNcbiTaxonIds: (p.familyNcbiTaxonIds ?? '').split(/[\s,]+/).filter(Boolean)
    };
  });
}

/** The abbreviation of the species' reference strain in the project, or null if it has none. */
export function referenceStrainFor(organisms, speciesNcbiTaxonId) {
  return organisms.find((o) => o.isReferenceStrain && o.speciesNcbiTaxonId === speciesNcbiTaxonId)?.organismAbbrev ?? null;
}

/**
 * The family representative for a lineage ordered most specific first: the
 * representative listing the first lineage taxon any representative lists.
 * Several listing that taxon is ambiguous and names none.
 */
export function familyRepFor(organisms, lineage) {
  const reps = organisms.filter((o) => o.isFamilyRepresentative);
  for (const taxonId of lineage.map(String)) {
    const hits = reps.filter((o) => o.familyNcbiTaxonIds.includes(taxonId));
    if (hits.length === 1) return { abbrev: hits[0].organismAbbrev, taxonId };
    if (hits.length > 1) return { abbrev: null, taxonId, ambiguous: hits.map((o) => o.organismAbbrev) };
  }
  return { abbrev: null, taxonId: null };
}
