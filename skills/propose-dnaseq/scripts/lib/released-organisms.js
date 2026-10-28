/** Organisms on the released VEuPathDB site, from the Genome Info and Stats search. No API key is needed. */

export const GENOME_INFO_URL = 'https://veupathdb.org/veupathdb/service/record-types/organism/searches/GenomeDataTypes/reports/standard';
const REQUEST = {
  searchConfig: { parameters: {} },
  reportConfig: { attributes: ['organism_name', 'strain', 'project_id', 'chromosomeCount'], pagination: { offset: 0, numRecords: 10000 } }
};

/** Every released organism as { sourceId, organismName, strain, project, chromosomeCount }; any failure or change of shape throws. */
export async function fetchReleasedOrganisms(fetchImpl = fetch) {
  const res = await fetchImpl(GENOME_INFO_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(REQUEST) });
  const text = await res.text();
  if (!res.ok) throw new Error(`veupathdb.org Genome Info and Stats query failed: HTTP ${res.status}`);
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error('veupathdb.org Genome Info and Stats response is not JSON'); }
  if (!Array.isArray(parsed.records)) throw new Error('veupathdb.org Genome Info and Stats response has no records');
  const { records } = parsed;
  if (!records.some((r) => r.attributes && 'chromosomeCount' in r.attributes)) {
    throw new Error('veupathdb.org Genome Info and Stats response has no chromosomeCount attribute; the report has changed');
  }
  const total = parsed.meta?.totalCount;
  if (typeof total === 'number' && total !== records.length) {
    throw new Error(`veupathdb.org Genome Info and Stats returned ${records.length} of ${total} records; the response was truncated`);
  }
  return records.map(({ id, attributes: a }) => ({
    sourceId: id?.find((k) => k.name === 'source_id')?.value, organismName: a.organism_name, strain: a.strain, project: a.project_id, chromosomeCount: Number(a.chromosomeCount) || 0
  }));
}

/** An organism name for comparison: no brackets ("[Candida] auris"), single spaces, lowercase. */
export const normalizeName = (name) => (name || '').replace(/[[\]]/g, '').trim().split(/\s+/).join(' ').toLowerCase();

const words = (name, n) => normalizeName(name).split(' ').slice(0, n).join(' ');

/** Same-species records, else same-genus ones. */
function candidatesFor(records, species) {
  for (const n of [2, 1]) {
    const want = words(species, n);
    const found = want ? records.filter((r) => words(r.organismName, n) === want) : [];
    if (found.length) return found;
  }
  return [];
}

/** The abbreviations of the project's organism files whose ncbiTaxonId is this one. */
export const taxonSharers = (index, { project, ncbiTaxonId }) =>
  (ncbiTaxonId ? index.filter((e) => e.project === project && e.ncbiTaxonId === ncbiTaxonId).map((e) => e.abbrev) : []);

/**
 * The released record for an organism: by the curator's pick (a source_id), else
 * by NCBITAXON_<ncbiTaxonId> in the project. A taxon that several organism files
 * share (sharing) cannot say which is released, so that record is the only candidate.
 * Otherwise unmatched returns same-species, else same-genus, candidates.
 */
export function matchReleased(records, { ncbiTaxonId, project, species, pick, sharing = [] }) {
  if (pick !== undefined) {
    const record = records.find((r) => r.sourceId === pick);
    if (!record) throw new Error(`${pick} is not a released organism on veupathdb.org`);
    if (record.project !== project) throw new Error(`${pick} is a ${record.project} organism, not ${project}`);
    return { matched: true, record, by: 'curator' };
  }
  const record = ncbiTaxonId && records.find((r) => r.sourceId === `NCBITAXON_${ncbiTaxonId}` && r.project === project);
  if (record && sharing.length > 1) {
    return { matched: false, candidates: [record], reason: `${sharing.length} organism files share taxon ${ncbiTaxonId}: ${sharing.join(', ')}; confirm which is released` };
  }
  if (record) return { matched: true, record, by: 'taxon' };
  return { matched: false, candidates: candidatesFor(records, species) };
}
