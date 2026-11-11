import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendHistory } from '../shared/scripts/lib/presenter-file.js';
import { setEntryVersion, datasetsOfClass, organismFileConstants } from '../shared/scripts/lib/dataset-file.js';

const PRESENTERS = `<?xml version="1.0"?>
<datasetPresenters>
  <datasetPresenter name="tfakST1_primary_genome_RSRC"
                    >
    <displayName><![CDATA[Genome Sequence and Annotation]]></displayName>
    <history buildNumber="60"
            genomeSource="GenBank" genomeVersion="GCA_1.1"
            annotationSource="GenBank" annotationVersion="Sep 01, 2020"/>
    <history buildNumber="66"
            genomeSource="GenBank" genomeVersion="GCA_1.2"
            annotationSource="GeneDB" annotationVersion="Oct 01, 2022"
            functionalAnnotationSource="VEuPathDB" functionalAnnotationVersion="Oct 06, 2023">functional annotation updated</history>
    <primaryContactId>jane.doe</primaryContactId>
  </datasetPresenter>
  <datasetPresenter name="other_RSRC">
    <history buildNumber="51"/>
  </datasetPresenter>
</datasetPresenters>
`;

const op = (over = {}) => ({
  presenter: 'tfakST1_primary_genome_RSRC', build: '69',
  functional: { source: 'VEuPathDB', version: 'Nov 03, 2026' }, text: 'functional annotation updated', carry: {}, ...over
});

test('appendHistory adds a row after the last one, carrying genome and annotation values from the latest build', () => {
  const out = appendHistory(PRESENTERS, op());
  assert.match(out, /functionalAnnotationVersion="Oct 06, 2023">functional annotation updated<\/history>\n    <history buildNumber="69"\n            genomeSource="GenBank" genomeVersion="GCA_1\.2"\n            annotationSource="GeneDB" annotationVersion="Oct 01, 2022"\n            functionalAnnotationSource="VEuPathDB" functionalAnnotationVersion="Nov 03, 2026">functional annotation updated<\/history>\n    <primaryContactId>/);
});

test('appendHistory is idempotent', () => {
  const once = appendHistory(PRESENTERS, op());
  assert.equal(appendHistory(once, op()), once);
});

test('a second update in the same build only moves the functional version forward', () => {
  const first = appendHistory(PRESENTERS, op());
  const later = appendHistory(first, op({ functional: { source: 'VEuPathDB', version: 'Dec 01, 2026' } }));
  assert.equal(later.split('buildNumber="69"').length - 1, 1);
  assert.match(later, /functionalAnnotationVersion="Dec 01, 2026"/);
  assert.equal(appendHistory(later, op()), later);
});

test('carry overrides the latest row; a value neither gives is refused, naming --history', () => {
  const out = appendHistory(PRESENTERS, op({ carry: { annotationVersion: 'Jan 01, 2026' } }));
  assert.match(out, /annotationSource="GeneDB" annotationVersion="Jan 01, 2026"\n/);
  const bare = PRESENTERS.replace('tfakST1_primary_genome_RSRC', 'x').replace('other_RSRC', 'tfakST1_primary_genome_RSRC');
  assert.throws(() => appendHistory(bare, op()), /has no genomeSource, genomeVersion, annotationSource, annotationVersion; pass --history genomeSource=<value>/);
});

test('appendHistory refuses a missing or duplicated presenter and a non-numeric build', () => {
  assert.throws(() => appendHistory(PRESENTERS, op({ presenter: 'nope_RSRC' })), /no presenter is named nope_RSRC/);
  const twice = PRESENTERS.replace('other_RSRC', 'tfakST1_primary_genome_RSRC');
  assert.throws(() => appendHistory(twice, op()), /2 presenters are named tfakST1_primary_genome_RSRC/);
  assert.throws(() => appendHistory(PRESENTERS, op({ build: 'NN' })), /needs a build number/);
});

test('appendHistory escapes attribute values and keeps CRLF files CRLF', () => {
  const out = appendHistory(PRESENTERS.replace(/\n/g, '\r\n'), op({ functional: { source: 'A&B "x"', version: 'Nov 03, 2026' } }));
  assert.match(out, /functionalAnnotationSource="A&amp;B &quot;x&quot;"/);
  assert.ok(!/[^\r]\n/.test(out));
});

const ORGANISM = `<?xml version="1.0"?>
<datasets>
  <constant name="organismAbbrev" value="tfakST1"/>
  <constant name="functAnnotVersion" value="2020-01-01"/>
  <!-- <constant name="old" value="x"/> -->

  <dataset class="productNames">
    <prop name="name">VEuPathDB</prop>
    <prop name="version">2026-07-22</prop>
    <prop name="projectName">$$projectName$$</prop>
    <prop name="organismAbbrev">$$organismAbbrev$$</prop>
  </dataset>

  <dataset class="productNames">
    <prop name="name">GenBank</prop>
    <prop name="version">$$functAnnotVersion$$</prop>
  </dataset>
</datasets>
`;

const bump = (over = {}) => ({ datasetClass: 'productNames', name: 'VEuPathDB', version: '2026-11-03', ...over });

test('datasetsOfClass and organismFileConstants read the organism file', () => {
  assert.deepEqual(datasetsOfClass(ORGANISM, 'productNames').map((d) => [d.props.name, d.props.version]), [['VEuPathDB', '2026-07-22'], ['GenBank', '$$functAnnotVersion$$']]);
  assert.deepEqual(organismFileConstants(ORGANISM), { organismAbbrev: 'tfakST1', functAnnotVersion: '2020-01-01' });
});

test('setEntryVersion replaces an earlier literal version on the one named entry only', () => {
  const out = setEntryVersion(ORGANISM, bump());
  assert.match(out, /<prop name="name">VEuPathDB<\/prop>\n    <prop name="version">2026-11-03<\/prop>/);
  assert.match(out, /<prop name="version">\$\$functAnnotVersion\$\$<\/prop>/);
  assert.equal(setEntryVersion(out, bump()), out);
});

test('setEntryVersion turns $$functAnnotVersion$$ into the literal', () => {
  assert.match(setEntryVersion(ORGANISM, bump({ name: 'GenBank' })), /<prop name="name">GenBank<\/prop>\n    <prop name="version">2026-11-03<\/prop>/);
});

test('setEntryVersion refuses a later version, a missing entry and a non-date', () => {
  assert.throws(() => setEntryVersion(ORGANISM, bump({ version: '2026-01-01' })), /has version 2026-07-22; only an earlier date or \$\$functAnnotVersion\$\$ is replaced by 2026-01-01/);
  assert.throws(() => setEntryVersion(ORGANISM, bump({ name: 'Nope' })), /no productNames dataset is named Nope/);
  assert.throws(() => setEntryVersion(ORGANISM, bump({ version: 'soon' })), /version must be a date/);
});
