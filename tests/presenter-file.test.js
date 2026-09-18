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
