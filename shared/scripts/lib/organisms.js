export const ABBREV_SHAPE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
export const SHAPE_RULE = 'letters, digits, ".", "_" or "-", starting with a letter or digit';

export const strainAbbrevOf = (strain) => strain.trim().replace(/\./g, '-').replace(/\s+/g, '_');

/** <g><sp><Strain>, or null when species is not a genus and a lettered epithet of three or more letters. */
export function conventionalAbbrev({ species, strain = '' }) {
  const [genus, epithet] = (species ?? '').trim().split(/\s+/);
  if (!/^[A-Za-z]/.test(genus ?? '') || !/^[A-Za-z]{3,}$/.test(epithet ?? '')) return null;
  return `${genus[0]}${epithet.slice(0, 3)}`.toLowerCase() + strainAbbrevOf(strain);
}
