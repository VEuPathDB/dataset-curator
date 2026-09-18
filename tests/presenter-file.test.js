import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  presenterNameExists, insertPresenter, extractPresenterName, presenterFileRelativePath
} from '../shared/scripts/lib/presenter-file.js';

const file = `<?xml version="1.0"?>
<datasetPresenters>
  <datasetPresenter name="existing_RSRC">
    <displayName><![CDATA[x]]></displayName>
  </datasetPresenter>
</datasetPresenters>
`;

const block = `  <datasetPresenter name="new_primary_genome_RSRC"
                    >
    <displayName><![CDATA[y]]></displayName>
  </datasetPresenter>`;

test('presenterNameExists finds exact names only', () => {
  assert.equal(presenterNameExists(file, 'existing_RSRC'), true);
  assert.equal(presenterNameExists(file, 'existing'), false);
  assert.equal(presenterNameExists(file, 'new_primary_genome_RSRC'), false);
});

test('insertPresenter places the block before the closing root tag', () => {
  const out = insertPresenter(file, block);
  const idxBlock = out.indexOf('new_primary_genome_RSRC');
  const idxClose = out.lastIndexOf('</datasetPresenters>');
  assert.ok(idxBlock > 0 && idxBlock < idxClose);
  assert.ok(out.endsWith('</datasetPresenters>\n'));
  assert.equal(out.split('<datasetPresenter ').length - 1, 2);
});

test('insertPresenter refuses a file without the root closing tag', () => {
  assert.throws(() => insertPresenter('<nope/>', block), /closing <\/datasetPresenters>/);
});

test('extractPresenterName reads the name attribute across a line break', () => {
  assert.equal(extractPresenterName(block), 'new_primary_genome_RSRC');
});

test('presenterFileRelativePath builds the project file path', () => {
  assert.equal(presenterFileRelativePath('FungiDB'), 'Model/lib/xml/datasetPresenters/FungiDB.xml');
});

test('insertPresenter preserves CRLF line endings when the file uses them', () => {
  const crlfFile = file.replace(/\n/g, '\r\n');
  const out = insertPresenter(crlfFile, block);
  assert.ok(!/[^\r]\n/.test(out), 'expected no bare LF characters in a CRLF file');
  assert.ok(out.includes('\r\n'));
});

test('presenterNameExists and extractPresenterName tolerate whitespace around =', () => {
  const spaced = '<datasetPresenter name = "spaced_RSRC">\n  <displayName/>\n</datasetPresenter>';
  assert.equal(presenterNameExists(spaced, 'spaced_RSRC'), true);
  assert.equal(extractPresenterName(spaced), 'spaced_RSRC');
});

test('presenterNameExists matches names containing . and + exactly', () => {
  const f = '<datasetPresenter name="a.b+c_RSRC">\n  <displayName/>\n</datasetPresenter>';
  assert.equal(presenterNameExists(f, 'a.b+c_RSRC'), true);
  assert.equal(presenterNameExists(f, 'aXbXc_RSRC'), false);
  assert.equal(presenterNameExists(f, 'a.b+c_RSRC_extra'), false);
});
