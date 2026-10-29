/**
 * Publications for a BioProject: PubMed links NCBI records (plus GEO's), else
 * Europe PMC candidates found by the accession or the BioProject title.
 * Candidates are unconfirmed: a curator reads them before trusting them.
 */

const EUTILS = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
const EUROPE_PMC = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search';
const EUTILS_HOST = new URL(EUTILS).host;
const MAX_TITLE_WORDS = 12;
const MIN_TITLE_WORDS = 2;
const MIN_LEAVE_ONE_OUT_WORDS = 4;
const TIMEOUT_MS = 30_000;
const STOP_WORDS = new Set([
  'the', 'and', 'for', 'from', 'with', 'into', 'via', 'using', 'under', 'between', 'during', 'across', 'within',
  'study', 'analysis', 'project', 'data'
]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function request(url, host, fetchImpl) {
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    return { res, text: await res.text() };
  } catch (err) {
    if (err.name === 'TimeoutError') throw new Error(`${host} request timed out after ${TIMEOUT_MS / 1000}s for ${url}`);
    throw new Error(`${host} request failed: ${err.message}`);
  }
}

/** eutils rate-limits keyless clients to 3 requests a second; a 429 there is retried once. */
async function getJson(url, { fetchImpl, wait }) {
  const { host } = new URL(url);
  let { res, text } = await request(url, host, fetchImpl);
  if (res.status === 429 && host === EUTILS_HOST) {
    const seconds = Number(res.headers?.get?.('retry-after'));
    await wait(seconds > 0 ? seconds * 1000 : 1000);
    ({ res, text } = await request(url, host, fetchImpl));
  }
  if (!res.ok) throw new Error(`${host} request failed: HTTP ${res.status} for ${url}`);
  try { return JSON.parse(text); } catch { throw new Error(`${host} response is not JSON for ${url}`); }
}

const shapeError = (host, what) => new Error(`${host} ${what}; the response shape has changed`);

async function bioprojectUid(accession, http) {
  const json = await getJson(`${EUTILS}/esearch.fcgi?db=bioproject&term=${encodeURIComponent(`${accession}[Project Accession]`)}&retmode=json`, http);
  if (json.esearchresult?.ERROR) throw new Error(`${EUTILS_HOST} esearch error: ${json.esearchresult.ERROR}`);
  const ids = json.esearchresult?.idlist;
  if (!Array.isArray(ids)) throw shapeError(EUTILS_HOST, 'esearch has no idlist');
  if (!ids.length) throw new Error(`${accession} is not a BioProject at NCBI`);
  return ids[0];
}

/** PubMed IDs only from pubmed linksetdbs: NCBI echoes the BioProject id in every linkset. */
async function linkedPmids(uid, http) {
  const json = await getJson(`${EUTILS}/elink.fcgi?dbfrom=bioproject&db=pubmed&id=${uid}&retmode=json`, http);
  if (!Array.isArray(json.linksets)) throw shapeError(EUTILS_HOST, 'elink has no linksets');
  return json.linksets.flatMap((s) => (s.linksetdbs ?? []).filter((d) => d.dbto === 'pubmed').flatMap((d) => d.links ?? []));
}

async function bioprojectTitle(uid, http) {
  const json = await getJson(`${EUTILS}/esummary.fcgi?db=bioproject&id=${uid}&retmode=json`, http);
  if (!json.result) throw shapeError(EUTILS_HOST, 'esummary has no result');
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

async function searchEuropePmc(query, http) {
  const json = await getJson(`${EUROPE_PMC}?query=${encodeURIComponent(query)}&format=json&resultType=core&pageSize=25`, http);
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

/** Title search on all significant words; when that finds nothing and there are enough words, each left out once. */
async function titleCandidates(words, http) {
  if (words.length < MIN_TITLE_WORDS) return [];
  const search = (ws) => searchEuropePmc(`TITLE:(${ws.join(' AND ')})`, http);
  const full = await search(words);
  if (full.length) return full.map((p) => ({ ...p, foundBy: 'title' }));
  if (words.length < MIN_LEAVE_ONE_OUT_WORDS) return [];
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
export async function findPublications(bioproject, { fetchImpl = fetch, wait = sleep, geoPubmedIds = [] } = {}) {
  const http = { fetchImpl, wait };
  const uid = await bioprojectUid(bioproject, http);
  const pmids = [...new Set([...(await linkedPmids(uid, http)), ...geoPubmedIds].map(String))];
  const linked = [];
  for (const pmid of pmids) {
    const [hit] = await searchEuropePmc(`EXT_ID:${pmid} AND SRC:MED`, http);
    linked.push(hit ?? { pmid, pmcid: null, doi: null, title: null, year: null, source: 'MED', fullText: [] });
  }
  if (linked.length) return { linked, candidates: [] };

  const byAccession = (await searchEuropePmc(`"${bioproject}"`, http)).map((p) => ({ ...p, foundBy: 'accession' }));
  const byTitle = await titleCandidates(titleWords(await bioprojectTitle(uid, http)), http);
  return { linked, candidates: dedupe([...byAccession, ...byTitle]) };
}
