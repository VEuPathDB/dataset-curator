/** Phase 1 records of a functional-update proposal: curated/update.json and the one entry's props. */
export const UPDATE_FILENAME = 'update.json';
export const UPDATE_SCHEMA_VERSION = 1;
export const DEFAULT_HISTORY_TEXT = 'functional annotation updated';
export const MODES = ['bump', 'new'];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 2026-11-03 → "Nov 03, 2026", the form presenter history rows use. */
export function historyDate(isoDate) {
  const [y, m, d] = isoDate.split('-');
  return `${MONTHS[Number(m) - 1]} ${d}, ${y}`;
}
