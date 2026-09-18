import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readContactIds, CONTACTS_RELATIVE_PATH } from '../shared/scripts/lib/contacts.js';

const fixture = new URL('./fixtures/allContacts.xml', import.meta.url).pathname;

test('readContactIds returns every contactId in file order', () => {
  assert.deepEqual(readContactIds(fixture), ['jane.doe', 'ravi.kumar']);
});

test('CONTACTS_RELATIVE_PATH points at the VEuPathDatasets contacts file', () => {
  assert.equal(CONTACTS_RELATIVE_PATH, 'Model/lib/xml/datasetPresenters/contacts/allContacts.xml');
});
