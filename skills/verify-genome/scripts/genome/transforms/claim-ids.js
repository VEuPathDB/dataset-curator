import { features, idOf } from '../gff.js';

/** A created ID that already exists is an error; the fix is an ids.tsv line renaming a source, never a suffix. */
export function claimIds(graph, transform) {
  const taken = new Set(features(graph).map(idOf).filter((id) => id !== null));
  return (id, forId) => {
    if (taken.has(id)) throw Object.assign(new Error(`${transform}: created ID ${id} (for ${forId}) already exists`), { code: 'ID_COLLISION', id, source: forId });
    taken.add(id);
    return id;
  };
}
