#!/usr/bin/env node

import fs from 'fs';
import path from 'path';

const bioproject = process.argv[2];
const datasetName = process.argv[3];
const outputBase = process.argv[4] || 'outputs';

if (!bioproject || !datasetName) {
  console.error('Usage: sample-annotations-to-stf.js <BIOPROJECT> <datasetName> [outputBase]');
  process.exit(1);
}

const annotationsPath = path.join('tmp', `${bioproject}_sample_annotations.json`);
const outputDir = path.join(outputBase, datasetName);

if (!fs.existsSync(annotationsPath)) {
  console.error('Annotations file not found:', annotationsPath);
  process.exit(1);
}

const annotations = JSON.parse(fs.readFileSync(annotationsPath, 'utf8'));
const { samples, factors } = annotations;

fs.mkdirSync(outputDir, { recursive: true });

function toColName(key) {
  return key.replace(/\s+/g, '.');
}

// Placeholder strings for missing data ("N/A", "NA", "n/a", "-", "none") should
// never reach the STF output as literal text — they must become blank cells,
// same as if the value had been omitted from the annotations JSON entirely.
// This guards against upstream annotation errors (values crept in this way in
// Build 70/71 outputs and were remediated by hand after the fact).
const MISSING_VALUE_PATTERN = /^(n\/?a|none|-)$/i;

function normalizeFactorValue(rawKey, sampleId, val) {
  if (val === null || val === undefined) return null;
  const str = String(val).trim();
  if (str === '' || MISSING_VALUE_PATTERN.test(str)) {
    if (str !== '') {
      console.warn(`Warning: sample "${sampleId}" factor "${rawKey}" value "${str}" looks like a missing-data placeholder — writing as blank instead. If this is a real category value, rename it to something unambiguous in the annotations JSON.`);
    }
    return null;
  }
  return str;
}

// A "unit" of "none"/"n/a" is a contradiction — unit is meant to be omitted
// entirely for non-numeric factors, not set to a placeholder string.
function normalizeUnit(rawKey, unit) {
  if (unit === null || unit === undefined) return null;
  const str = String(unit).trim();
  if (str === '' || MISSING_VALUE_PATTERN.test(str)) {
    if (str !== '') {
      console.warn(`Warning: factor "${rawKey}" has unit "${str}" — omitting it. Set "unit" only for factors with a real measurement unit; leave it unset (not "none") for categorical factors.`);
    }
    return null;
  }
  return str;
}

function inferType(values) {
  const nonNull = values.filter(v => v !== null && v !== undefined && v !== '');
  if (nonNull.length === 0) return { data_type: 'string', data_shape: 'categorical' };

  if (nonNull.every(v => /^-?\d+$/.test(String(v)))) {
    return { data_type: 'integer', data_shape: 'continuous' };
  }
  if (nonNull.every(v => /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(String(v)))) {
    return { data_type: 'number', data_shape: 'continuous' };
  }
  if (nonNull.every(v => /^\d{4}-\d{2}-\d{2}$/.test(String(v)))) {
    return { data_type: 'date', data_shape: 'continuous' };
  }
  return { data_type: 'string', data_shape: 'categorical' };
}

// factors is an object: { key: { displayName, definition, unit } }
const factorKeys = Object.keys(factors || {});

// Normalize every sample's factor values once, up front, so the TSV cells
// and the YAML type-inference input are always derived from the same
// missing-data-scrubbed values.
const normalizedFactors = samples.map(s => {
  const out = {};
  factorKeys.forEach(key => {
    out[key] = normalizeFactorValue(key, s.sampleId, s.factors ? s.factors[key] : null);
  });
  return out;
});

// --- TSV ---
// Column names use the factor key (spaces → dots)
const factorCols = factorKeys.map(toColName);
const headers = ['sample.ID \\\\ Descriptors', 'SRA.ID.s.', 'label', ...factorCols];

const rows = samples.map((s, i) => {
  const sraIds = (s.runs || []).join(',');
  const factorVals = factorKeys.map(key => normalizedFactors[i][key] ?? '');
  return [s.sampleId, sraIds, s.label, ...factorVals];
});

const tsv = [headers, ...rows].map(r => r.join('\t')).join('\n') + '\n';
fs.writeFileSync(path.join(outputDir, 'entity-sample.tsv'), tsv);

// --- YAML ---
const factorValues = {};
factorKeys.forEach(key => {
  factorValues[key] = normalizedFactors.map(f => f[key]);
});

// This script builds YAML by hand (no js-yaml dependency, to keep these
// skill scripts runnable with plain node, no npm install). That means
// scalars have to be quoted/escaped ourselves rather than left to a library.
//
// Quote a scalar for embedding in hand-built YAML if it contains characters
// that are unsafe in a plain (unquoted) scalar. Single-quote style: the only
// escaping rule is doubling any literal single quotes.
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

function serializeVariable(v) {
  let out = `  - variable: ${yamlScalar(v.variable)}\n`;
  out += `    provider_label:\n`;
  v.provider_label.forEach(l => { out += `      - ${yamlScalar(l)}\n`; });
  out += `    display_name: ${yamlScalar(v.display_name)}\n`;
  if (v.definition) {
    out += `    definition: ${yamlScalar(v.definition)}\n`;
  }
  out += `    data_type: ${v.data_type}\n`;
  out += `    data_shape: ${v.data_shape}\n`;
  if (v.unit) {
    out += `    unit: ${yamlScalar(v.unit)}\n`;
  }
  if (v.is_multi_valued) {
    out += `    is_multi_valued: ${v.is_multi_valued}\n`;
    out += `    multi_value_delimiter: ${yamlScalar(v.multi_value_delimiter)}\n`;
  }
  return out;
}

const variables = [];

variables.push({
  variable: 'SRA.ID.s.',
  provider_label: ['SRA ID(s)'],
  display_name: 'SRA ID(s)',
  data_type: 'string',
  data_shape: 'categorical',
  is_multi_valued: 'yes',
  multi_value_delimiter: ','
});

variables.push({
  variable: 'label',
  provider_label: ['label'],
  display_name: 'label',
  data_type: 'string',
  data_shape: 'categorical'
});

factorKeys.forEach(key => {
  const f = (factors && factors[key]) || {};
  const colName = toColName(key);
  const { data_type, data_shape } = inferType(factorValues[key]);
  const v = {
    variable: colName,
    provider_label: [key],
    display_name: f.displayName || key,
    data_type,
    data_shape
  };
  if (f.definition) v.definition = f.definition;
  const unit = normalizeUnit(key, f.unit);
  if (unit) v.unit = unit;
  variables.push(v);
});

let yaml = `name: sample
display_name: Sample
display_name_plural: Samples

id_columns:
  - id_column: sample.ID
    entity_name: sample
    provider_label:
      - sample ID

variables:\n`;

variables.forEach(v => { yaml += serializeVariable(v); });
yaml += `\ncategories: []\ncollections: []\n`;

fs.writeFileSync(path.join(outputDir, 'entity-sample.yaml'), yaml);

console.log(`Written to ${outputDir}/entity-sample.{tsv,yaml}`);
