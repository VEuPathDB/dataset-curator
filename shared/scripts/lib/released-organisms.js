/** Organisms on the released VEuPathDB site, from the Genome Info and Stats search. No API key is needed. */

export const GENOME_INFO_URL = 'https://veupathdb.org/veupathdb/service/record-types/organism/searches/GenomeDataTypes/reports/standard';
const REQUEST = {
  searchConfig: { parameters: {} },
  reportConfig: { attributes: ['organism_name', 'strain', 'project_id', 'chromosomeCount'], pagination: { offset: 0, numRecords: 5000 } }
};

/** Every released organism as { sourceId, organismName, strain, project, chromosomeCount }; any failure throws. */
export async function fetchReleasedOrganisms(fetchImpl = fetch) {
  const res = await fetchImpl(GENOME_INFO_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(REQUEST) });
  const text = await res.text();
  if (!res.ok) throw new Error(`veupathdb.org Genome Info and Stats query failed: HTTP ${res.status}`);
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error('veupathdb.org Genome Info and Stats response is not JSON'); }
  if (!Array.isArray(parsed.records)) throw new Error('veupathdb.org Genome Info and Stats response has no records');
  return parsed.records.map(({ id, attributes: a }) => ({
    sourceId: id?.find((k) => k.name === 'source_id')?.value, organismName: a.organism_name, strain: a.strain, project: a.project_id, chromosomeCount: Number(a.chromosomeCount) || 0
  }));
}

const genusSpecies = (name) => (name || '').trim().split(/\s+/).slice(0, 2).join(' ').toLowerCase();

/**
 * The released record for an organism: by the curator's pick (a source_id), else
 * by NCBITAXON_<ncbiTaxonId> in the project. Unmatched returns same-species candidates.
 */
export function matchReleased(records, { ncbiTaxonId, project, species, pick }) {
  if (pick !== undefined) {
    const record = records.find((r) => r.sourceId === pick);
    if (!record) throw new Error(`${pick} is not a released organism on veupathdb.org`);
    if (record.project !== project) throw new Error(`${pick} is a ${record.project} organism, not ${project}`);
    return { matched: true, record, by: 'curator' };
  }
  const record = ncbiTaxonId && records.find((r) => r.sourceId === `NCBITAXON_${ncbiTaxonId}` && r.project === project);
  if (record) return { matched: true, record, by: 'taxon' };
  const want = genusSpecies(species);
  return { matched: false, candidates: want ? records.filter((r) => genusSpecies(r.organismName) === want) : [] };
}
