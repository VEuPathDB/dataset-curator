export const EXPECTED_PREPROCESSOR = 'ApiCommonData::Load::genemRNAExonCDS2BioperlTree';
/** Keys preprocessGFF3 adds (PMIDs and previous IDs pulled out of product and comment). */
export const ALLOWED_EXTRA_KEYS = new Set(['Dbxref', 'previous_systematic_id']);

const attrOf = (text, name) => text.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`))?.[1] ?? null;

export function readIsfMap(xml) {
  const text = xml.replace(/<!--[\s\S]*?-->/g, '');
  const preprocessor = text.match(/<bioperlSeqPreprocessor\s+class="([^"]+)"/)?.[1] ?? null;
  if (preprocessor !== EXPECTED_PREPROCESSOR) throw new Error(`the map names preprocessor ${preprocessor}; only ${EXPECTED_PREPROCESSOR} is ported`);
  const byName = new Map();
  for (const [, attrs, body = ''] of text.matchAll(/<feature\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/feature>)/g)) {
    const qualifiers = new Set([...body.matchAll(/<qualifier\s+([^>]*?)\/?>/g)].map(([, q]) => attrOf(q, 'name')));
    byName.set(attrOf(attrs, 'name'), { ignore: attrOf(attrs, 'ignore') === 'true', qualifiers });
  }
  return { preprocessor, features: byName };
}
