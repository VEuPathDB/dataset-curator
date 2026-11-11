/** Row and file writing shared by GFF extraction (functional) and curator updates (functional-update convert). */

export const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Rows unique per (ID, value), sorted by ID, then value, by code unit, so a rerun writes the same bytes. */
export function uniqueSorted(rows) {
  const unique = new Map(rows.map((row) => [row.join('\t'), row]));
  const keyed = [...unique.values()].map((row) => [row, row.slice(1).join('\t')]);
  return keyed.sort(([a, aRest], [b, bRest]) => compare(a[0], b[0]) || compare(aRest, bRest)).map(([row]) => row);
}

/** [transcriptId, product] pairs in input order: rows with is_preferred 1 for each transcript's first product, and the products per transcript. */
export function productRows(pairs) {
  const byTranscript = new Map();
  for (const [id, product] of pairs) {
    const list = byTranscript.get(id) ?? [];
    if (!list.includes(product)) list.push(product);
    byTranscript.set(id, list);
  }
  const rows = [...byTranscript].flatMap(([id, list]) => list.map((product, i) => [id, product, i === 0 ? '1' : '0']));
  return { rows: uniqueSorted(rows), byTranscript };
}

export function gafLine([id, goId, reference, evidence, aspect], { source, taxonId, date }) {
  return [source, id, id, '', goId, reference, evidence, '', aspect, '', '', 'transcript', `taxon:${taxonId}`, date, source, '', ''];
}

/** A dataset's file: tab-separated lines, no header, LF. */
export function fileText(dataset, ctx) {
  return `${dataset.rows.map((row) => (dataset.format ? dataset.format(row, ctx) : row).join('\t')).join('\n')}\n`;
}
