import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { readContactIds, readContactIdsOnRef, CONTACTS_RELATIVE_PATH } from '../shared/scripts/lib/contacts.js';
import { createGit } from '../shared/scripts/lib/git-ops.js';
import { initRepo } from './helpers.js';

const fixture = new URL('./fixtures/allContacts.xml', import.meta.url).pathname;

test('readContactIds returns every contactId in file order', () => {
  assert.deepEqual(readContactIds(fixture), ['jane.doe', 'ravi.kumar', 'padded.id']);
});

test('readContactIds tolerates whitespace padding inside <contactId>', () => {
  assert.ok(readContactIds(fixture).includes('padded.id'));
});

test('CONTACTS_RELATIVE_PATH points at the VEuPathDatasets contacts file', () => {
  assert.equal(CONTACTS_RELATIVE_PATH, 'Model/lib/xml/datasetPresenters/contacts/allContacts.xml');
});

test('readContactIdsOnRef reads the contacts as they stand on a ref', () => {
  const { repo } = initRepo('contacts-');
  const git = createGit(repo);
  const path = join(repo, CONTACTS_RELATIVE_PATH);
  const before = readContactIds(path);

  writeFileSync(path, readFileSync(path, 'utf-8').replace(
    '</contacts>',
    '  <contact>\n    <contactId>late.arrival</contactId>\n  </contact>\n</contacts>'));
  execFileSync('git', ['-C', repo, 'commit', '-q', '-a', '-m', 'add a contact']);

  assert.deepEqual(readContactIdsOnRef(git, 'HEAD~1'), before);
  assert.deepEqual(readContactIdsOnRef(git, 'HEAD'), [...before, 'late.arrival']);
});
