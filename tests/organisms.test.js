import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ABBREV_SHAPE, strainAbbrevOf, conventionalAbbrev } from '../shared/scripts/lib/organisms.js';

test('the shape admits every abbreviation in use and refuses path and markup characters', () => {
  for (const ok of ['pfal3D7', 'bcinB05-10', 'acspSK_2022a', 'aellCBS707.79']) assert.ok(ABBREV_SHAPE.test(ok), ok);
  for (const bad of ['', '.hidden', '-flag', 'a/b', 'a b', 'a"b', 'a&b']) assert.ok(!ABBREV_SHAPE.test(bad), bad);
});

test('a strain abbreviation replaces "." with "-" and spaces with "_"', () => {
  assert.equal(strainAbbrevOf('B05.10'), 'B05-10');
  assert.equal(strainAbbrevOf(' Friedlin V1 '), 'Friedlin_V1');
  assert.equal(strainAbbrevOf('3D7'), '3D7');
});

test('the convention is genus initial, three species letters, then the strain abbreviation', () => {
  assert.equal(conventionalAbbrev({ species: 'Plasmodium falciparum', strain: '3D7' }), 'pfal3D7');
  assert.equal(conventionalAbbrev({ species: 'Botrytis cinerea', strain: 'B05.10' }), 'bcinB05-10');
  assert.equal(conventionalAbbrev({ species: 'Leishmania major', strain: 'Friedlin V1' }), 'lmajFriedlin_V1');
  assert.equal(conventionalAbbrev({ species: 'Testus fakeus', strain: '' }), 'tfak');
});

test('no convention applies without a genus and a lettered species epithet', () => {
  assert.equal(conventionalAbbrev({ species: 'Leishmania sp.', strain: 'X' }), null);
  assert.equal(conventionalAbbrev({ species: 'Plasmodium', strain: '3D7' }), null);
  assert.equal(conventionalAbbrev({ species: undefined, strain: '3D7' }), null);
});
