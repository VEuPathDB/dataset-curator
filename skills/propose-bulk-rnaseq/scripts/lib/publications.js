/**
 * Publications for a BioProject: PubMed links NCBI records (plus GEO's), else
 * Europe PMC candidates found by the accession or the BioProject title.
 * Candidates are unconfirmed: a curator reads them before trusting them.
 */

const EUTILS = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
const EUROPE_PMC = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search';
const MAX_TITLE_WORDS = 12;
const STOP_WORDS = new Set([
  'the', 'and', 'for', 'from', 'with', 'into', 'via', 'using', 'under', 'between', 'during', 'across', 'within',
  'study', 'analysis', 'project', 'data'
]);

async function getJson(url, fetchImpl) {
  const { host } = new URL(url);
  let res, text;
  try {
    res = await fetchImpl(url);
    text = await res.text();
  } catch (err) {
    throw new Error(`${host} request failed: ${err.message}`);
  }
  if (!res.ok) throw new Error(`${host} request failed: HTTP ${res.status} for ${url}`);
  try { return JSON.parse(text); } catch { throw new Error(`${host} response is not JSON for ${url}`); }
}

const shapeError = (host, what) => new Error(`${host} ${what}; the response shape has changed`);

async function bioprojectUid(accession, fetchImpl) {
  const json = await getJson(`${EUTILS}/esearch.fcgi?db=bioproject&term=${encodeURIComponent(accession)}&retmode=json`, fetchImpl);
  const ids = json.esearchresult?.idlist;
  if (!Array.isArray(ids)) throw shapeError('eutils.ncbi.nlm.nih.gov', 'esearch has no idlist');
  if (!ids.length) throw new Error(`${accession} is not a BioProject at NCBI`);
  return ids[0];
}

/** PubMed IDs only from pubmed linksetdbs: NCBI echoes the BioProject id in every linkset. */
async function linkedPmids(uid, fetchImpl) {
  const json = await getJson(`${EUTILS}/elink.fcgi?dbfrom=bioproject&db=pubmed&id=${uid}&retmode=json`, fetchImpl);
  if (!Array.isArray(json.linksets)) throw shapeError('eutils.ncbi.nlm.nih.gov', 'elink has no linksets');
  return json.linksets.flatMap((s) => (s.linksetdbs ?? []).filter((d) => d.dbto === 'pubmed').flatMap((d) => d.links ?? []));
}

async function bioprojectTitle(uid, fetchImpl) {
  const json = await getJson(`${EUTILS}/esummary.fcgi?db=bioproject&id=${uid}&retmode=json`, fetchImpl);
  if (!json.result) throw shapeError('eutils.ncbi.nlm.nih.gov', 'esummary has no result');
  return json.result[uid]?.project_title || '';
}

const cleanTitle = (title) => (title ? title.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : null);

function toPublication(r) {
  const seen = new Set();
  const fullText = (r.fullTextUrlList?.fullTextUrl ?? [])
    .filter((u) => u.url && !seen.has(u.url) && seen.add(u.url))
    .map((u) => ({ url: u.url, availability: u.availability ?? null }));
  return {
    pmid: r.pmid ?? null, pmcid: r.pmcid ?? null, doi: r.doi ?? null, title: cleanTitle(r.title),
    year: r.pubYear ?? null, source: r.source ?? null, fullText
  };
}

async function searchEuropePmc(query, fetchImpl) {
  const json = await getJson(`${EUROPE_PMC}?query=${encodeURIComponent(query)}&format=json&resultType=core&pageSize=25`, fetchImpl);
  const results = json.resultList?.result;
  if (!Array.isArray(results)) throw shapeError('www.ebi.ac.uk', 'Europe PMC search has no resultList');
  return results.map(toPublication);
}

/** Significant title words: no stop words, none under 3 letters, no repeats; internal hyphens kept. */
export function titleWords(title) {
  const words = (title || '').toLowerCase().split(/[^\p{L}\p{N}-]+/u)
    .map((w) => w.replace(/^-+|-+$/g, ''))
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
  return [...new Set(words)].slice(0, MAX_TITLE_WORDS);
}

/** First of each paper, matched by DOI, then PMID. */
function dedupe(pubs) {
  const seen = new Set();
  return pubs.filter((p) => {
    const keys = [p.doi && `doi:${p.doi.toLowerCase()}`, p.pmid && `pmid:${p.pmid}`].filter(Boolean);
    if (keys.some((k) => seen.has(k))) return false;
    keys.forEach((k) => seen.add(k));
    return true;
  });
}

/** Title search on all significant words; when that finds nothing, each word left out once. */
async function titleCandidates(words, fetchImpl) {
  if (!words.length) return [];
  const search = (ws) => searchEuropePmc(`TITLE:(${ws.join(' ')})`, fetchImpl);
  const full = await search(words);
  if (full.length) return full.map((p) => ({ ...p, foundBy: 'title' }));
  const found = [];
  for (const left of words) {
    for (const p of await search(words.filter((w) => w !== left))) found.push({ ...p, foundBy: `title without "${left}"` });
  }
  return found;
}

/**
 * { linked, candidates } for a BioProject. linked: PubMed IDs from NCBI elink and
 * geoPubmedIds, with Europe PMC details. candidates are searched only when nothing
 * is linked, and carry foundBy. Any HTTP failure or shape change throws.
 */
export async function findPublications(bioproject, { fetchImpl = fetch, geoPubmedIds = [] } = {}) {
  const uid = await bioprojectUid(bioproject, fetchImpl);
  const pmids = [...new Set([...(await linkedPmids(uid, fetchImpl)), ...geoPubmedIds].map(String))];
  const linked = [];
  for (const pmid of pmids) {
    const [hit] = await searchEuropePmc(`EXT_ID:${pmid} AND SRC:MED`, fetchImpl);
    linked.push(hit ?? { pmid, pmcid: null, doi: null, title: null, year: null, source: 'MED', fullText: [] });
  }
  if (linked.length) return { linked, candidates: [] };

  const byAccession = (await searchEuropePmc(`"${bioproject}"`, fetchImpl)).map((p) => ({ ...p, foundBy: 'accession' }));
  const byTitle = await titleCandidates(titleWords(await bioprojectTitle(uid, fetchImpl)), fetchImpl);
  return { linked, candidates: dedupe([...byAccession, ...byTitle]) };
}
