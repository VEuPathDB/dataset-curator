#!/usr/bin/env node
// One-off repair for entity-sample.yaml files produced by old versions of
// sample-annotations-to-stf.js, before scalars were quoted/escaped. Source
// JSON for these is gone, so this repairs the YAML text in place rather
// than regenerating it. Uses the same yamlScalar() escaping rules as the
// current generator, applied line-by-line to the known field keys.

import fs from 'fs';

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('Usage: fix-legacy-entity-yaml.js <entity-sample.yaml> [...]');
  process.exit(1);
}

function yamlScalar(value) {
  const str = String(value);
  const needsQuoting =
    str === '' ||
    /^\s|\s$/.test(str) ||
    /: |:$/.test(str) ||
    /\s#/.test(str) ||
    /^[-?:,\[\]{}#&*!|>'"%@`]/.test(str) ||
    /^(true|false|null|yes|no|~)$/i.test(str) ||
    /^-?\d+(\.\d+)?$/.test(str);
  if (!needsQuoting) return str;
  return `'${str.replace(/'/g, "''")}'`;
}

// This generator's output has fixed, predictable indentation: user-data
// "key: value" fields always start at column 4 (either "  - key: " for the
// first field of a list item, or "    key: " for its siblings), and
// provider_label scalar list items always sit at column 6 ("      - ").
// Matching on that indentation (rather than a bare "- " prefix) avoids
// mistaking structural list-of-maps entries like "  - id_column: sample.ID"
// for plain scalars.
const LINE_PATTERN = /^(.{4}(?:variable|display_name|definition|unit|multi_value_delimiter): |      - )(.*)$/;

function isAlreadyQuoted(raw) {
  return (raw.startsWith("'") && raw.endsWith("'") && raw.length >= 2) ||
         (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2);
}

let totalChanged = 0;
for (const file of files) {
  const original = fs.readFileSync(file, 'utf8');
  const lines = original.split('\n');
  let changed = false;

  const fixedLines = lines.map(line => {
    const m = line.match(LINE_PATTERN);
    if (!m) return line;
    const [, prefix, rawValue] = m;
    if (rawValue === '' || rawValue === '[]' || isAlreadyQuoted(rawValue)) return line;
    const fixed = yamlScalar(rawValue);
    if (fixed === rawValue) return line;
    changed = true;
    return prefix + fixed;
  });

  if (changed) {
    fs.writeFileSync(file, fixedLines.join('\n'));
    totalChanged++;
    console.log(`fixed: ${file}`);
  }
}

console.log(`\n${totalChanged}/${files.length} file(s) changed`);
