import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAccession, seriesFacts } from '../shared/scripts/lib/geo-xref.js';

const soft = (gse, { bioprojects = [], sub = [], superOf = [], types = ['Expression profiling by high throughput sequencing'], pubmed = [] } = {}) => [
  `!Series_geo_accession = ${gse}`,
  ...types.map((t) => `!Series_type = ${t}`),
  ...pubmed.map((p) => `!Series_pubmed_id = ${p}`),
  ...superOf.map((g) => `!Series_relation = SuperSeries of: ${g}`),
  ...sub.map((g) => `!Series_relation = SubSeries of: ${g}`),
  ...bioprojects.map((b) => `!Series_relation = BioProject: https://www.ncbi.nlm.nih.gov/bioproject/${b}`)
].join('\n');

/** GEO as a map: series SOFT by GSE, and the GSEs GDS links to each BioProject. */
function stubNcbi({ series = {}, linked = {} }) {
  const uid = (gse) => `200${gse.slice(3)}`;
  return async (url) => {
    const acc = url.match(/acc\.cgi\?acc=(GSE\d+)/)?.[1];
    if (acc) return series[acc] ?? `!Series_geo_accession = none`;
    const term = url.match(/term=(\w+)\[BioProject\]/)?.[1];
    if (term) return JSON.stringify({ esearchresult: { idlist: (linked[term] ?? []).map(uid) } });
    const ids = url.match(/esummary\.fcgi\?db=gds&id=([\d,]+)/)?.[1].split(',');
    if (ids) {
      const gses = Object.values(linked).flat().filter((g) => ids.includes(uid(g)));
      return JSON.stringify({ result: { uids: gses.map(uid), ...Object.fromEntries(gses.map((g) => [uid(g), { accession: g, entrytype: 'GSE' }])) } });
    }
    throw new Error(`unexpected url ${url}`);
  };
}

test('seriesFacts reads relations, types and PubMed ids from a SOFT brief record', () => {
  const f = seriesFacts('GSE1', soft('GSE1', { bioprojects: ['PRJNA1'], pubmed: ['123'], sub: ['GSE9'] }));
  assert.equal(f.bioproject, 'PRJNA1');
  assert.deepEqual(f.superSeries, ['GSE9']);
  assert.deepEqual(f.pubmedIds, ['123']);
  assert.throws(() => seriesFacts('GSE2', soft('GSE1')), /GEO has no series GSE2/);
});

test('a GSE resolves one-to-one under the GSE, recording its BioProject', async () => {
  const fetchText = stubNcbi({ series: { GSE1: soft('GSE1', { bioprojects: ['PRJNA1'], pubmed: ['123'] }) } });
  const r = await resolveAccession('GSE1', { fetchText });
  assert.equal(r.kind, 'one-to-one');
  assert.deepEqual(r.proposals.map((p) => [p.accession, p.externalIds, p.pubmedIds]), [['GSE1', { bioproject: 'PRJNA1', geo: 'GSE1' }, ['123']]]);
});

test('a BioProject resolves one-to-one under the BioProject, recording its GSE', async () => {
  const fetchText = stubNcbi({ series: { GSE1: soft('GSE1', { bioprojects: ['PRJNA1'] }) }, linked: { PRJNA1: ['GSE1'] } });
  const r = await resolveAccession('PRJNA1', { fetchText });
  assert.deepEqual(r.proposals.map((p) => [p.accession, p.externalIds, p.warnings]), [['PRJNA1', { bioproject: 'PRJNA1', geo: 'GSE1' }, []]]);
});

test('a BioProject GEO does not link to is no-geo, recorded explicitly', async () => {
  const r = await resolveAccession('PRJEB1', { fetchText: stubNcbi({}) });
  assert.equal(r.kind, 'no-geo');
  assert.deepEqual(r.proposals[0].externalIds, { bioproject: 'PRJEB1' });
});

test('a SuperSeries makes one proposal per sub-series BioProject, from the GSE or its umbrella BioProject', async () => {
  const fetchText = stubNcbi({
    series: {
      GSE10: soft('GSE10', { bioprojects: ['PRJNA10'], superOf: ['GSE11', 'GSE12', 'GSE13'] }),
      GSE11: soft('GSE11', { bioprojects: ['PRJNA11'], sub: ['GSE10'] }),
      GSE12: soft('GSE12', { bioprojects: ['PRJNA12'], sub: ['GSE10'] }),
      GSE13: soft('GSE13', { sub: ['GSE10'], types: ['Expression profiling by array'] })
    },
    linked: { PRJNA10: ['GSE10'], PRJNA11: ['GSE11'] }
  });
  for (const id of ['GSE10', 'PRJNA10']) {
    const r = await resolveAccession(id, { fetchText });
    assert.equal(r.kind, 'superseries');
    assert.deepEqual(r.proposals.map((p) => [p.accession, p.externalIds.geo]), [['PRJNA11', 'GSE11'], ['PRJNA12', 'GSE12']]);
    assert.deepEqual(r.skipped.map((s) => s.gse), ['GSE13']);
  }
  const sub = await resolveAccession('PRJNA11', { fetchText });
  assert.equal(sub.kind, 'one-to-one');
  assert.match(sub.proposals[0].warnings[0], /GSE11 is a sub-series of GSE10/);
});

test('a GSE without a BioProject, or a BioProject with several unrelated series, is refused', async () => {
  const fetchText = stubNcbi({
    series: { GSE1: soft('GSE1'), GSE2: soft('GSE2', { bioprojects: ['PRJNA9'] }), GSE3: soft('GSE3', { bioprojects: ['PRJNA9'] }) },
    linked: { PRJNA9: ['GSE2', 'GSE3'] }
  });
  await assert.rejects(resolveAccession('GSE1', { fetchText }), /links to no BioProject/);
  await assert.rejects(resolveAccession('PRJNA9', { fetchText }), /linked to GEO series GSE2, GSE3; ask the curator/);
  await assert.rejects(resolveAccession('SRP1', { fetchText }), /neither a BioProject/);
});
