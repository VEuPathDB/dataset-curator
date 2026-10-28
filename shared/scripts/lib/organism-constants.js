/** Top-level <constant> elements an organism file must define for a dataset type, checked and inserted at load. */

const constantRe = (name) => new RegExp(`<constant\\s+name="${name}"\\s+value="([^"]*)"\\s*/>`);

/**
 * Returns { content, added }. A constant already in the file wins and a differing
 * given value stops; a missing one needs a given value, which a person confirmed.
 */
export function withOrganismConstants(fileContent, required = {}, given = {}, organism) {
  let content = fileContent;
  const added = [];
  for (const [name, valid] of Object.entries(required)) {
    const present = constantRe(name).exec(content)?.[1];
    const value = given[name];
    if (value !== undefined && !valid.test(value)) throw new Error(`${name} "${value}" for ${organism} is not valid`);
    if (present !== undefined) {
      if (value !== undefined && value !== present) throw new Error(`${organism} already has ${name} ${present}; --${name} says ${value}`);
      continue;
    }
    if (value === undefined) throw new Error(`${organism} has no ${name} constant; confirm the value with the data loader, then pass --${name} ${organism}=<N>`);
    const constants = [...content.matchAll(/^([ \t]*)<constant\b[^>]*\/>[ \t]*$/gm)];
    const last = constants.at(-1);
    if (!last) throw new Error(`${organism}'s organism file has no <constant> to place ${name} after`);
    const at = last.index + last[0].length;
    content = `${content.slice(0, at)}\n${last[1]}<constant name="${name}" value="${value}"/>${content.slice(at)}`;
    added.push(`${name}=${value}`);
  }
  return { content, added };
}
