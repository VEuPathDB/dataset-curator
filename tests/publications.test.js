import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { findPublications, titleWords } from '../shared/scripts/lib/publications.js';

const SK2_TITLE = 'A fungal plant pathogen overcomes conserved broad-spectrum plant disease resistance by rapid gene loss';

const esearch = (ids) => ({ header: { type: 'esearch' }, esearchresult: { count: String(ids.length), idlist: ids } });
const elinkNone = (uid) => ({ header: { type: 'elink' }, linksets: [{ dbfrom: 'bioproject', ids: [uid] }] });
const elinkTo = (uid, pmids) => ({
  header: { type: 'elink' },
  linksets: [{ dbfrom: 'bioproject', ids: [uid], linksetdbs: [{ dbto: 'pubmed', linkname: 'bioproject_pubmed', links: pmids }] }]
});
const esummary = (uid, title) => ({ header: { type: 'esummary' }, result: { uids: [uid], [uid]: { uid, project_acc: 'PRJNA639160', project_title: title } } });
const epmc = (results) => ({ version: '6.9', hitCount: results.length, resultList: { result: results } });

const MED_SK2 = {
  id: '39155769', source: 'MED', pmid: '39155769', doi: '10.1111/nph.20063',
  title: 'A fungal plant pathogen overcomes mlo-mediated broad-spectrum disease resistance by rapid gene loss.', pubYear: '2024',
  fullTextUrlList: { fullTextUrl: [
    { availability: 'Open access', availabilityCode: 'OA', documentStyle: 'doi', site: 'Unpaywall', url: 'https://doi.org/10.1111/nph.20063' },
    { availability: 'Subscription required', availabilityCode: 'S', documentStyle: 'doi', site: 'DOI', url: 'https://doi.org/10.1111/nph.20063' }
  ] }
};
const PPR_SK2 = {
  id: 'PPR430765', source: 'PPR', doi: '10.1101/2021.12.09.471931',
  title: 'A fungal plant pathogen overcomes  <i>mlo</i>  -mediated broad-spectrum disease resistance by rapid gene loss', pubYear: '2021',
  fullTextUrlList: { fullTextUrl: [
    { availability: 'Open access', availabilityCode: 'OA', documentStyle: 'pdf', site: 'Unpaywall', url: 'https://www.biorxiv.org/content/biorxiv/early/2021/12/09/2021.12.09.471931.full.pdf' },
    { availability: 'Free', availabilityCode: 'F', documentStyle: 'doi', site: 'DOI', url: 'https://doi.org/10.1101/2021.12.09.471931' }
  ] }
};
const MED_LINKED = {
  id: '31235750', source: 'MED', pmid: '31235750', pmcid: 'PMC6591234', doi: '10.1000/linked', title: 'Linked paper', pubYear: '2019',
  fullTextUrlList: { fullTextUrl: [{ availability: 'Free', documentStyle: 'html', url: 'https://europepmc.org/articles/PMC6591234' }] }
};

/** A fetch that answers by matching the decoded URL and records every call. */
function fakeFetch(routes) {
  const calls = [];
  const fetchImpl = async (url) => {
    const decoded = decodeURIComponent(url);
    calls.push(decoded);
    const hit = routes.find(([match]) => (typeof match === 'string' ? decoded.includes(match) : match.test(decoded)));
    if (!hit) throw new Error(`unrouted ${decoded}`);
    const body = typeof hit[1] === 'function' ? hit[1](decoded) : hit[1];
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  };
  return { fetchImpl, calls };
}

const titleQuery = (decoded) => decoded.match(/query=TITLE:\(([^)]*)\)/)?.[1];

test('titleWords drops stop words, short words and repeats, keeps internal hyphens, caps at 12', () => {
  assert.deepEqual(titleWords(SK2_TITLE),
    ['fungal', 'plant', 'pathogen', 'overcomes', 'conserved', 'broad-spectrum', 'disease', 'resistance', 'rapid', 'gene', 'loss']);
  assert.deepEqual(titleWords('RNA-seq of "Plasmodium" (falciparum): the -stage- study and analysis'), ['rna-seq', 'plasmodium', 'falciparum', 'stage']);
  assert.equal(titleWords('one two three four five six seven eight nine ten eleven twelve thirteen').length, 12);
});

test('SK2: no link and no full-title hit, so a leave-one-out title search finds the paper and preprint as candidates', async () => {
  const { fetchImpl, calls } = fakeFetch([
    ['db=bioproject&term=PRJNA639160', esearch(['639160'])],
    ['elink.fcgi', elinkNone('639160')],
    ['esummary.fcgi?db=bioproject', esummary('639160', SK2_TITLE)],
    ['query="PRJNA639160"', epmc([])],
    [/query=TITLE:/, (d) => epmc(titleQuery(d).split(' ').includes('conserved') ? [] : [MED_SK2, PPR_SK2])]
  ]);
  const result = await findPublications('PRJNA639160', { fetchImpl });
  assert.deepEqual(result.linked, []);
  assert.deepEqual(result.candidates.map((c) => [c.source, c.pmid, c.doi, c.year]),
    [['MED', '39155769', '10.1111/nph.20063', '2024'], ['PPR', null, '10.1101/2021.12.09.471931', '2021']]);
  const [med, ppr] = result.candidates;
  assert.equal(med.title, 'A fungal plant pathogen overcomes mlo-mediated broad-spectrum disease resistance by rapid gene loss.');
  assert.equal(ppr.title, 'A fungal plant pathogen overcomes mlo -mediated broad-spectrum disease resistance by rapid gene loss');
  assert.deepEqual(med.fullText, [{ url: 'https://doi.org/10.1111/nph.20063', availability: 'Open access' }]);
  assert.equal(ppr.fullText.length, 2);
  assert.equal(med.foundBy, 'title without "conserved"');
  const titleCalls = calls.filter((c) => c.includes('TITLE:'));
  assert.equal(titleCalls.length, 1 + 11, 'the full title, then each word left out once');
  assert.ok(calls.every((c) => !c.includes('db=pubmed&id=') || c.includes('elink')));
});

test('a linked PMID comes back with Europe PMC details and no candidate searches run', async () => {
  const { fetchImpl, calls } = fakeFetch([
    ['db=bioproject&term=PRJNA525426', esearch(['525426'])],
    ['elink.fcgi', elinkTo('525426', ['31235750'])],
    ['EXT_ID:31235750 AND SRC:MED', epmc([MED_LINKED])]
  ]);
  const result = await findPublications('PRJNA525426', { fetchImpl });
  assert.deepEqual(result.candidates, []);
  assert.deepEqual(result.linked, [{
    pmid: '31235750', pmcid: 'PMC6591234', doi: '10.1000/linked', title: 'Linked paper', year: '2019', source: 'MED',
    fullText: [{ url: 'https://europepmc.org/articles/PMC6591234', availability: 'Free' }]
  }]);
  assert.equal(calls.length, 3);
  assert.ok(!calls.some((c) => c.includes('esummary') || c.includes('TITLE:') || c.includes('"PRJNA525426"')));
});

test('the echoed BioProject id in an empty elink linkset is not a PMID', async () => {
  const { fetchImpl } = fakeFetch([
    ['term=PRJNA639160', esearch(['639160'])],
    ['elink.fcgi', elinkNone('639160')],
    ['esummary.fcgi', esummary('639160', '')],
    ['query="PRJNA639160"', epmc([])]
  ]);
  assert.deepEqual(await findPublications('PRJNA639160', { fetchImpl }), { linked: [], candidates: [] });
});

test('GEO PubMed IDs merge into linked, deduplicated against elink', async () => {
  const other = { ...MED_LINKED, id: '22222222', pmid: '22222222', doi: '10.1000/geo', title: 'GEO paper' };
  const { fetchImpl, calls } = fakeFetch([
    ['term=PRJNA525426', esearch(['525426'])],
    ['elink.fcgi', elinkTo('525426', ['31235750'])],
    ['EXT_ID:31235750', epmc([MED_LINKED])],
    ['EXT_ID:22222222', epmc([other])]
  ]);
  const result = await findPublications('PRJNA525426', { fetchImpl, geoPubmedIds: ['31235750', 22222222] });
  assert.deepEqual(result.linked.map((p) => p.pmid), ['31235750', '22222222']);
  assert.equal(calls.filter((c) => c.includes('EXT_ID:31235750')).length, 1);
  assert.deepEqual(result.candidates, []);
});

test('a linked PMID Europe PMC does not know still comes back, without details', async () => {
  const { fetchImpl } = fakeFetch([
    ['term=PRJNA525426', esearch(['525426'])],
    ['elink.fcgi', elinkTo('525426', ['99999999'])],
    ['EXT_ID:99999999', epmc([])]
  ]);
  const { linked } = await findPublications('PRJNA525426', { fetchImpl });
  assert.deepEqual(linked, [{ pmid: '99999999', pmcid: null, doi: null, title: null, year: null, source: 'MED', fullText: [] }]);
});

test('an accession hit is a candidate, deduplicated by DOI against title hits', async () => {
  const { fetchImpl, calls } = fakeFetch([
    ['term=PRJNA639160', esearch(['639160'])],
    ['elink.fcgi', elinkNone('639160')],
    ['esummary.fcgi', esummary('639160', SK2_TITLE)],
    ['query="PRJNA639160"', epmc([MED_SK2])],
    [/query=TITLE:/, epmc([MED_SK2, PPR_SK2])]
  ]);
  const { candidates } = await findPublications('PRJNA639160', { fetchImpl });
  assert.deepEqual(candidates.map((c) => [c.doi, c.foundBy]), [['10.1111/nph.20063', 'accession'], ['10.1101/2021.12.09.471931', 'title']]);
  assert.equal(calls.filter((c) => c.includes('TITLE:')).length, 1, 'no leave-one-out when the full title finds something');
});

test('an unknown BioProject throws', async () => {
  const { fetchImpl } = fakeFetch([['term=PRJNA0', esearch([])]]);
  await assert.rejects(findPublications('PRJNA0', { fetchImpl }), /PRJNA0 is not a BioProject at NCBI/);
});

test('any HTTP failure throws naming the host', async () => {
  const failAt = (host) => async (url) => (new URL(url).host === host
    ? { ok: false, status: 503, text: async () => 'down' }
    : fakeFetch([
      ['term=', esearch(['639160'])], ['elink.fcgi', elinkNone('639160')], ['esummary.fcgi', esummary('639160', SK2_TITLE)]
    ]).fetchImpl(url));
  await assert.rejects(findPublications('PRJNA639160', { fetchImpl: failAt('eutils.ncbi.nlm.nih.gov') }), /eutils\.ncbi\.nlm\.nih\.gov.*HTTP 503/);
  await assert.rejects(findPublications('PRJNA639160', { fetchImpl: failAt('www.ebi.ac.uk') }), /www\.ebi\.ac\.uk.*HTTP 503/);
  await assert.rejects(findPublications('PRJNA639160', { fetchImpl: async () => { throw new Error('ENOTFOUND'); } }), /eutils\.ncbi\.nlm\.nih\.gov.*ENOTFOUND/);
  await assert.rejects(findPublications('PRJNA639160', { fetchImpl: async () => ({ ok: true, status: 200, text: async () => '<html>' }) }), /eutils\.ncbi\.nlm\.nih\.gov.*not JSON/);
});

const SCRIPT = resolve('shared/scripts/find-publications.js');

test('CLI exits 1 with usage when no accession is given', () => {
  const r = spawnSync('node', [SCRIPT], { cwd: mkdtempSync(join(tmpdir(), 'find-pubs-')), encoding: 'utf-8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Usage: node scripts\/find-publications\.js <ACCESSION>/);
});

test('CLI exits 1 for a non-BioProject accession without an xref', () => {
  const r = spawnSync('node', [SCRIPT, 'GSE12345'], { cwd: mkdtempSync(join(tmpdir(), 'find-pubs-')), encoding: 'utf-8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /GSE12345_xref\.json.*resolve-accessions\.js/);
});
