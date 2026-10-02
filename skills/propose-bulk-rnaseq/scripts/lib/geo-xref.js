/**
 * Cross-references a BioProject and its GEO series, in either direction.
 * Network access goes through the injected fetchText(url) so tests stay offline.
 */
import { EXTERNAL_ID_PATTERNS } from './manifest.js';

const EUTILS = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
const GEO_ACC = 'https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi';

/** The !Series_ lines of a GEO SOFT "brief" record as { key: [values] }. */
export function parseSoftBrief(text) {
  const fields = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^!Series_(\w+)\s*=\s*(.*?)\s*$/);
    if (m) (fields[m[1]] ??= []).push(m[2]);
  }
  return fields;
}

/** What one GEO series says about itself and its relations. */
export function seriesFacts(gse, text) {
  const f = parseSoftBrief(text);
  if (!f.geo_accession?.includes(gse)) throw new Error(`GEO has no series ${gse}`);
  const related = (kind) => (f.relation ?? [])
    .map((r) => r.match(new RegExp(`^${kind}:\\s*(\\S+)`))?.[1]).filter(Boolean);
  const bioprojects = related('BioProject').map((url) => url.split('/').pop());
  return {
    gse,
    bioproject: bioprojects[0] ?? null,
    bioprojects,
    subSeries: related('SuperSeries of'),
    superSeries: related('SubSeries of'),
    types: f.type ?? [],
    pubmedIds: f.pubmed_id ?? []
  };
}

export async function fetchSeries(gse, fetchText) {
  return seriesFacts(gse, await fetchText(`${GEO_ACC}?acc=${gse}&targ=self&form=text&view=brief`));
}

/** GEO series that GDS links to a BioProject. */
export async function seriesForBioProject(bioproject, fetchText) {
  const search = JSON.parse(await fetchText(`${EUTILS}/esearch.fcgi?db=gds&term=${bioproject}[BioProject]+AND+gse[ETYP]&retmode=json`));
  const ids = search.esearchresult?.idlist ?? [];
  if (!ids.length) return [];
  const summary = JSON.parse(await fetchText(`${EUTILS}/esummary.fcgi?db=gds&id=${ids.join(',')}&retmode=json`));
  return (summary.result?.uids ?? []).map((u) => summary.result[u])
    .filter((r) => r?.entrytype === 'GSE').map((r) => r.accession).sort();
}

const proposal = (accession, ids, series, warnings = []) => ({
  accession,
  externalIds: Object.fromEntries(Object.entries(ids).filter(([, v]) => v)),
  seriesTypes: series?.types ?? [],
  pubmedIds: series?.pubmedIds ?? [],
  warnings
});

/** A SuperSeries becomes one proposal per sub-series with a BioProject, keyed by that BioProject. */
async function superSeriesProposals(superSeries, fetchText) {
  const proposals = [];
  const skipped = [];
  for (const gse of superSeries.subSeries) {
    const sub = await fetchSeries(gse, fetchText);
    if (sub.bioproject) proposals.push(proposal(sub.bioproject, { bioproject: sub.bioproject, geo: gse }, sub));
    else skipped.push({ gse, types: sub.types, reason: 'no BioProject, so no SRA reads' });
  }
  return { kind: 'superseries', superSeries: superSeries.gse, superSeriesBioProject: superSeries.bioproject, proposals, skipped };
}

/**
 * Resolves a BioProject or GSE to the proposals it makes:
 *   one-to-one   - one proposal under the id given, with both ids
 *   no-geo       - a BioProject GEO does not link to
 *   superseries  - one proposal per sub-series BioProject
 * A GSE without a BioProject, or a BioProject with several unrelated series, is refused.
 */
export async function resolveAccession(id, { fetchText }) {
  if (EXTERNAL_ID_PATTERNS.geo.test(id)) {
    const series = await fetchSeries(id, fetchText);
    if (series.subSeries.length) return superSeriesProposals(series, fetchText);
    if (!series.bioproject) throw new Error(`${id} links to no BioProject, so its reads are not in SRA; this skill needs SRA reads`);
    const warnings = series.bioprojects.length > 1 ? [`${id} links to BioProjects ${series.bioprojects.join(', ')}; using ${series.bioproject}`] : [];
    if (series.superSeries.length) warnings.push(`${id} is a sub-series of ${series.superSeries.join(', ')}`);
    return { kind: 'one-to-one', proposals: [proposal(id, { bioproject: series.bioproject, geo: id }, series, warnings)] };
  }
  if (!EXTERNAL_ID_PATTERNS.bioproject.test(id)) throw new Error(`"${id}" is neither a BioProject (PRJNA…) nor a GEO series (GSE…)`);

  const gses = await seriesForBioProject(id, fetchText);
  if (!gses.length) return { kind: 'no-geo', proposals: [proposal(id, { bioproject: id }, null)] };
  const all = await Promise.all(gses.map((g) => fetchSeries(g, fetchText)));
  const own = all.filter((s) => !s.subSeries.length && s.bioprojects.includes(id));
  const supers = all.filter((s) => s.subSeries.length);
  if (own.length !== 1 && supers.length === 1 && all.every((s) => s === supers[0] || supers[0].subSeries.includes(s.gse))) {
    return superSeriesProposals(supers[0], fetchText);
  }
  if (own.length === 1 || all.length === 1) {
    const [series] = own.length === 1 ? own : all;
    const warnings = series.bioprojects.includes(id) ? [] : [`${series.gse} lists BioProject ${series.bioproject ?? 'none'}, not ${id}`];
    if (series.superSeries.length) warnings.push(`${series.gse} is a sub-series of ${series.superSeries.join(', ')}`);
    return { kind: 'one-to-one', proposals: [proposal(id, { bioproject: id, geo: series.gse }, series, warnings)] };
  }
  throw new Error(`${id} is linked to GEO series ${gses.join(', ')}; ask the curator which one, and start from that GSE`);
}
