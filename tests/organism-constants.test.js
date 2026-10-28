import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withOrganismConstants } from '../shared/scripts/lib/organism-constants.js';

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

test('an invalid value is refused', () => {
  assert.throws(() => withOrganismConstants(file, required, { ploidy: '0' }, 'tfakST1'), /ploidy "0" for tfakST1 is not valid/);
});
