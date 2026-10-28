import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withOrganismConstants, unusedOrganismConstants } from '../shared/scripts/lib/organism-constants.js';

const file = `<?xml version="1.0"?>\n<datasets>\n  <constant name="organismAbbrev" value="tfakST1"/>\n  <constant name="projectName" value="FungiDB"/>\n\n  <dataset class="x">\n  </dataset>\n</datasets>\n`;
const required = { ploidy: /^[1-9]\d*$/ };

test('a constant already present is left alone, and a matching value is accepted', () => {
  const withPloidy = file.replace('value="FungiDB"/>', 'value="FungiDB"/>\n  <constant name="ploidy" value="1"/>');
  assert.deepEqual(withOrganismConstants(withPloidy, required, {}, 'tfakST1'), { content: withPloidy, added: [] });
  assert.deepEqual(withOrganismConstants(withPloidy, required, { ploidy: '1' }, 'tfakST1'), { content: withPloidy, added: [] });
});

test('a given value that differs from the file is a hard stop', () => {
  const withPloidy = file.replace('value="FungiDB"/>', 'value="FungiDB"/>\n  <constant name="ploidy" value="1"/>');
  assert.throws(() => withOrganismConstants(withPloidy, required, { ploidy: '2' }, 'tfakST1'), /tfakST1 already has ploidy 1; --ploidy says 2/);
});

test('a missing constant without a value stops and names the organism and the flag', () => {
  assert.throws(() => withOrganismConstants(file, required, {}, 'tfakST1'), /tfakST1 has no ploidy constant; confirm the value with the data loader, then pass --ploidy tfakST1=<N>/);
});

test('a missing constant with a valid value is inserted after the last top-level constant', () => {
  const { content, added } = withOrganismConstants(file, required, { ploidy: '2' }, 'tfakST1');
  assert.deepEqual(added, ['ploidy=2']);
  assert.match(content, /<constant name="projectName" value="FungiDB"\/>\n  <constant name="ploidy" value="2"\/>\n\n  <dataset/);
});

test('a present constant is found with its attributes in any order and either quote style', () => {
  for (const tag of [`<constant value="1" name="ploidy"/>`, `<constant name='ploidy' value='1' />`, `<constant\n    name="ploidy"\n    value="1"/>`]) {
    const content = file.replace('<dataset class', `${tag}\n  <dataset class`);
    assert.deepEqual(withOrganismConstants(content, required, {}, 'tfakST1'), { content, added: [] });
    assert.throws(() => withOrganismConstants(content, required, { ploidy: '2' }, 'tfakST1'), /already has ploidy 1/);
  }
});

test('a constant inside a comment is not present, and is never the anchor', () => {
  const commented = file.replace('<dataset class', '<!-- <constant name="ploidy" value="1"/> -->\n  <!--\n  <constant name="old" value="x"/>\n  -->\n  <dataset class');
  const { content, added } = withOrganismConstants(commented, required, { ploidy: '2' }, 'tfakST1');
  assert.deepEqual(added, ['ploidy=2']);
  assert.match(content, /<constant name="projectName" value="FungiDB"\/>\n  <constant name="ploidy" value="2"\/>\n\n  <!-- <constant name="ploidy" value="1"\/> -->/);
});

test('the anchor may carry a trailing comment; the new constant goes after the whole line', () => {
  const noted = file.replace('value="FungiDB"/>', 'value="FungiDB"/> <!-- the site -->');
  const { content } = withOrganismConstants(noted, required, { ploidy: '2' }, 'tfakST1');
  assert.match(content, /value="FungiDB"\/> <!-- the site -->\n  <constant name="ploidy" value="2"\/>\n/);
});

test('a constant inside a dataset is not the anchor', () => {
  const nested = file.replace('  </dataset>', '    <constant name="inner" value="x"/>\n  </dataset>');
  const { content } = withOrganismConstants(nested, required, { ploidy: '2' }, 'tfakST1');
  assert.match(content, /value="FungiDB"\/>\n  <constant name="ploidy" value="2"\/>\n/);
});

test('a CRLF file keeps CRLF line endings', () => {
  const crlf = file.replace(/\n/g, '\r\n');
  const { content } = withOrganismConstants(crlf, required, { ploidy: '2' }, 'tfakST1');
  assert.ok(content.includes('value="FungiDB"/>\r\n  <constant name="ploidy" value="2"/>\r\n\r\n  <dataset'));
  assert.ok(!/[^\r]\n/.test(content));
});

test('an invalid value already in the organism file is refused', () => {
  const bad = file.replace('value="FungiDB"/>', 'value="FungiDB"/>\n  <constant name="ploidy" value="abc"/>');
  assert.throws(() => withOrganismConstants(bad, required, {}, 'tfakST1'), /tfakST1 has ploidy "abc" in its organism file, which is not valid/);
});

test('unusedOrganismConstants warns about constants for other organisms or that the type does not require', () => {
  const ctx = { organisms: ['tfakST1'], required, accession: 'PRJNA1', datasetType: 'dnaseq' };
  assert.deepEqual(unusedOrganismConstants({ tfakST1: { ploidy: '2' } }, ctx), []);
  assert.deepEqual(unusedOrganismConstants({ tfakST1: { ploidy: '2' }, tfakX: { ploidy: '1' } }, ctx), [
    '--ploidy tfakX was not used: tfakX is not an organism of PRJNA1'
  ]);
  assert.deepEqual(unusedOrganismConstants({ tfakST1: { ploidy: '2' } }, { ...ctx, required: undefined, datasetType: 'bulk-rnaseq' }), [
    '--ploidy tfakST1 was not used: bulk-rnaseq requires no ploidy constant'
  ]);
});

test('unusedOrganismConstants refuses an invalid value even for an organism it does not use', () => {
  assert.throws(() => unusedOrganismConstants({ tfakX: { ploidy: 'two' } }, { organisms: ['tfakST1'], required, accession: 'PRJNA1', datasetType: 'dnaseq' }),
    /ploidy "two" for tfakX is not valid/);
});

test('an invalid value is refused', () => {
  assert.throws(() => withOrganismConstants(file, required, { ploidy: '0' }, 'tfakST1'), /ploidy "0" for tfakST1 is not valid/);
});
