import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const CONTACTS_RELATIVE_PATH = 'Model/lib/xml/datasetPresenters/contacts/allContacts.xml';

export function contactsPath(repoPath) {
  return join(repoPath, CONTACTS_RELATIVE_PATH);
}

/** Regex scan rather than an XML parser: the file is ~40k lines and flat. */
export function readContactIds(filePath) {
  const xml = readFileSync(filePath, 'utf-8');
  return [...xml.matchAll(/<contactId>\s*([^<\s]+)\s*<\/contactId>/g)].map(m => m[1]);
}
