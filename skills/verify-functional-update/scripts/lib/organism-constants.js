/** Top-level <constant> elements an organism file must define for a dataset type, checked and inserted at load. */

/** Comments blanked to spaces (newlines kept), so offsets into the result are offsets into the file. */
const withoutComments = (text) => text.replace(/<!--[\s\S]*?-->/g, (c) => c.replace(/[^\r\n]/g, ' '));

const attrsOf = (tag) => Object.fromEntries([...tag.matchAll(/([\w:.-]+)\s*=\s*(["'])([\s\S]*?)\2/g)].map(([, k, , v]) => [k, v]));

const constantValue = (bare, name) =>
  [...bare.matchAll(/<constant\b([^>]*?)\/?>/g)].map((m) => attrsOf(m[1])).find((a) => a.name === name)?.value;

/** Inside a <dataset> element, by counting opens and closes before the offset. */
function inDataset(bare, at) {
  const before = bare.slice(0, at);
  return (before.match(/<dataset\b[^>]*[^/]>/g) ?? []).length > (before.match(/<\/dataset\s*>/g) ?? []).length;
}

/**
 * Warnings for given constants ({ abbrev: { name: value } }) a load does not use: for an
 * organism the proposal lacks, or one the type does not require. Invalid values still throw.
 */
export function unusedOrganismConstants(given, { organisms, required = {}, accession, datasetType }) {
  const warnings = [];
  for (const [abbrev, constants] of Object.entries(given)) {
    for (const [name, value] of Object.entries(constants)) {
      if (required[name] && !required[name].test(value)) throw new Error(`${name} "${value}" for ${abbrev} is not valid`);
      if (!required[name]) warnings.push(`--${name} ${abbrev} was not used: ${datasetType} requires no ${name} constant`);
      else if (!organisms.includes(abbrev)) warnings.push(`--${name} ${abbrev} was not used: ${abbrev} is not an organism of ${accession}`);
    }
  }
  return warnings;
}

/**
 * Returns { content, added }. A constant already in the file wins and a differing
 * given value stops; a missing one needs a given value, which a person confirmed.
 */
export function withOrganismConstants(fileContent, required = {}, given = {}, organism) {
  let content = fileContent;
  const added = [];
  const eol = fileContent.includes('\r\n') ? '\r\n' : '\n';
  for (const [name, valid] of Object.entries(required)) {
    const bare = withoutComments(content);
    const present = constantValue(bare, name);
    const value = given[name];
    if (value !== undefined && !valid.test(value)) throw new Error(`${name} "${value}" for ${organism} is not valid`);
    if (present !== undefined) {
      if (!valid.test(present)) throw new Error(`${organism} has ${name} "${present}" in its organism file, which is not valid`);
      if (value !== undefined && value !== present) throw new Error(`${organism} already has ${name} ${present}; --${name} says ${value}`);
      continue;
    }
    if (value === undefined) throw new Error(`${organism} has no ${name} constant; confirm the value with the data loader, then pass --${name} ${organism}=<N>`);
    // Matched on the blanked text, so a trailing comment reads as spaces and the line ends where the file's does.
    const last = [...bare.matchAll(/^([ \t]*)<constant\b[^>]*\/>[ \t]*(?=\r?$)/gm)].filter((m) => !inDataset(bare, m.index)).at(-1);
    if (!last) throw new Error(`${organism}'s organism file has no <constant> to place ${name} after`);
    const at = last.index + last[0].length;
    content = `${content.slice(0, at)}${eol}${last[1]}<constant name="${name}" value="${value}"/>${content.slice(at)}`;
    added.push(`${name}=${value}`);
  }
  return { content, added };
}
