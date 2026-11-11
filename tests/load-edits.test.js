import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendHistory, parseHistoryDate } from '../shared/scripts/lib/presenter-file.js';
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

test('setEntryVersion refuses an ambiguous target', () => {
  const twice = ORGANISM.replace('<prop name="name">GenBank</prop>', '<prop name="name">VEuPathDB</prop>');
  assert.throws(() => setEntryVersion(twice, bump()), /2 productNames datasets are named VEuPathDB/);
});

test('setEntryVersion and datasetsOfClass ignore commented-out datasets and props', () => {
  const only = ORGANISM.replace('  <dataset class="productNames">\n    <prop name="name">VEuPathDB', '  <!--\n  <dataset class="productNames">\n    <prop name="name">VEuPathDB')
    .replace('<prop name="organismAbbrev">$$organismAbbrev$$</prop>\n  </dataset>', '<prop name="organismAbbrev">$$organismAbbrev$$</prop>\n  </dataset>\n  -->');
  assert.throws(() => setEntryVersion(only, bump()), /no productNames dataset is named VEuPathDB/);
  assert.equal(datasetsOfClass(only, 'productNames').length, 1);
  const dup = ORGANISM.replace('</datasets>', '  <!-- <dataset class="productNames"><prop name="name">VEuPathDB</prop><prop name="version">2020-01-01</prop></dataset> -->\n</datasets>');
  assert.match(setEntryVersion(dup, bump()), /<prop name="version">2026-11-03<\/prop>\n    <prop name="projectName">/);
  const propInComment = ORGANISM.replace('    <prop name="version">2026-07-22</prop>', '    <!-- <prop name="version">1999-01-01</prop> -->\n    <prop name="version">2026-07-22</prop>');
  const bumped = setEntryVersion(propInComment, bump());
  assert.match(bumped, /<!-- <prop name="version">1999-01-01<\/prop> -->\n    <prop name="version">2026-11-03<\/prop>/);
});

test('appendHistory ignores commented-out rows and presenters, and inserts outside the comment', () => {
  const xml = PRESENTERS.replace('    <history buildNumber="66"', '    <!-- <history buildNumber="66"')
    .replace('functional annotation updated</history>', 'functional annotation updated</history> -->')
    .replace('<datasetPresenter name="other_RSRC">', '<!--\n  <datasetPresenter name="tfakST1_primary_genome_RSRC">\n    <history buildNumber="99"/>\n  </datasetPresenter>\n  -->\n  <datasetPresenter name="other_RSRC">');
  const out = appendHistory(xml, op());
  assert.match(out, /annotationVersion="Sep 01, 2020"\/>\n    <history buildNumber="69"\n            genomeSource="GenBank" genomeVersion="GCA_1\.1"\n            annotationSource="GenBank" annotationVersion="Sep 01, 2020"/);
  assert.ok(out.includes('<!-- <history buildNumber="66"'));
  const live60 = out.indexOf('buildNumber="60"');
  assert.ok(live60 < out.indexOf('buildNumber="69"') && out.indexOf('buildNumber="69"') < out.indexOf('<!-- <history'));
  assert.throws(() => appendHistory('<datasetPresenters>\n<!-- <datasetPresenter name="a_RSRC">\n</datasetPresenter> -->\n</datasetPresenters>', op({ presenter: 'a_RSRC' })), /no presenter is named a_RSRC/);
});

test('appendHistory validates the op', () => {
  assert.throws(() => appendHistory(PRESENTERS, op({ functional: { source: '', version: 'Nov 03, 2026' } })), /needs functional\.source/);
  assert.throws(() => appendHistory(PRESENTERS, op({ functional: { version: 'Nov 03, 2026' } })), /needs functional\.source/);
  assert.throws(() => appendHistory(PRESENTERS, op({ functional: { source: 'VEuPathDB', version: '2026-11-03' } })), /functional\.version as "Mon DD, YYYY"/);
  assert.throws(() => appendHistory(PRESENTERS, op({ functional: undefined })), /needs functional\.source/);
});

test('parseHistoryDate reads Mon D, YYYY and Mon DD, YYYY only', () => {
  assert.equal(parseHistoryDate('Nov 3, 2026'), parseHistoryDate('Nov 03, 2026'));
  assert.equal(parseHistoryDate('Nov 03, 2026'), Date.UTC(2026, 10, 3));
  for (const bad of ['2026-11-03', 'Foo 03, 2026', 'November 3, 2026', '', undefined]) assert.ok(Number.isNaN(parseHistoryDate(bad)));
});

const row69 = (attrs) => PRESENTERS.replace('<primaryContactId>', `<history buildNumber="69" ${attrs}/>\n    <primaryContactId>`);

test('a same-build row written as "Nov 3, 2026" counts as the same date', () => {
  const xml = row69('functionalAnnotationSource="VEuPathDB" functionalAnnotationVersion="Nov 3, 2026"');
  assert.equal(appendHistory(xml, op()), xml);
});

test('a same-build row keeps its source unless the version moves forward', () => {
  const xml = row69('functionalAnnotationSource="VEuPathDB" functionalAnnotationVersion="Nov 03, 2026"');
  assert.equal(appendHistory(xml, op({ functional: { source: 'Other', version: 'Nov 03, 2026' } })), xml);
  assert.match(appendHistory(xml, op({ functional: { source: 'Other', version: 'Nov 04, 2026' } })), /functionalAnnotationSource="Other" functionalAnnotationVersion="Nov 04, 2026"\/>/);
});

test('a same-build row without functional attributes gets them added', () => {
  const out = appendHistory(row69('genomeSource="GenBank"'), op());
  assert.match(out, /<history buildNumber="69" genomeSource="GenBank" functionalAnnotationSource="VEuPathDB" functionalAnnotationVersion="Nov 03, 2026"\/>/);
});

test('appendHistory refuses a same-build row whose functional version is not a date, and two rows for one build', () => {
  assert.throws(() => appendHistory(row69('functionalAnnotationVersion="soon"'), op()), /functionalAnnotationVersion "soon", which is not a date/);
  const twice = row69('genomeSource="a"').replace('<primaryContactId>', '<history buildNumber="69"/>\n    <primaryContactId>');
  assert.throws(() => appendHistory(twice, op()), /2 history rows for build 69/);
});

test('a presenter with no history rows gets the row before its closing tag, or is refused naming --history', () => {
  const xml = '<datasetPresenters>\n  <datasetPresenter name="p_RSRC">\n    <displayName>x</displayName>\n  </datasetPresenter>\n</datasetPresenters>\n';
  assert.throws(() => appendHistory(xml, op({ presenter: 'p_RSRC' })), /p_RSRC has no history rows; pass --history genomeSource=<value>/);
  const carry = { genomeSource: 'GenBank', genomeVersion: 'GCA_1', annotationSource: 'GenBank', annotationVersion: 'Sep 01, 2020' };
  const out = appendHistory(xml, op({ presenter: 'p_RSRC', carry }));
  assert.match(out, /<displayName>x<\/displayName>\n    <history buildNumber="69"\n            genomeSource="GenBank" genomeVersion="GCA_1"\n            annotationSource="GenBank" annotationVersion="Sep 01, 2020"\n            functionalAnnotationSource="VEuPathDB" functionalAnnotationVersion="Nov 03, 2026">functional annotation updated<\/history>\n  <\/datasetPresenter>/);
});
