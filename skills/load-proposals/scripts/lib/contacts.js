import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const CONTACTS_RELATIVE_PATH = 'Model/lib/xml/datasetPresenters/contacts/allContacts.xml';

export function contactsPath(repoPath) {
  return join(repoPath, CONTACTS_RELATIVE_PATH);
}

/** Regex scan rather than an XML parser: the file is ~40k lines and flat. */
function scanContactIds(xml) {
  return [...xml.matchAll(/<contactId>\s*([^<\s]+)\s*<\/contactId>/g)].map(m => m[1]);
}

export function readContactIds(filePath) {
  return scanContactIds(readFileSync(filePath, 'utf-8'));
}

/** The contacts as a ref has them, for validating a manifest read from that ref. */
export function readContactIdsOnRef(git, ref) {
  return scanContactIds(git.showFile(ref, CONTACTS_RELATIVE_PATH));
}
