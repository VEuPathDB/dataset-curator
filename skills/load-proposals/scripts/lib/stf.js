/**
 * Sample annotations to STF (study-wrangler) entity files: entity-sample.tsv
 * and entity-sample.yaml. Pure; callers decide where the text goes.
 */

function toColName(key) {
  return key.replace(/\s+/g, '.');
}

function inferType(values) {
  const nonNull = values.filter(v => v !== null && v !== undefined && v !== '');
  if (nonNull.length === 0) return { data_type: 'string', data_shape: 'categorical' };
  if (nonNull.every(v => /^-?\d+$/.test(String(v)))) return { data_type: 'integer', data_shape: 'continuous' };
  if (nonNull.every(v => /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(String(v)))) return { data_type: 'number', data_shape: 'continuous' };
  if (nonNull.every(v => /^\d{4}-\d{2}-\d{2}$/.test(String(v)))) return { data_type: 'date', data_shape: 'continuous' };
  return { data_type: 'string', data_shape: 'categorical' };
}

// YAML is built by hand to stay dependency-free, so scalars are quoted here:
// single-quote style, whose only escape is doubling a literal single quote.
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
  if (v.definition) out += `    definition: ${yamlScalar(v.definition)}\n`;
  out += `    data_type: ${v.data_type}\n`;
  out += `    data_shape: ${v.data_shape}\n`;
  if (v.unit) out += `    unit: ${yamlScalar(v.unit)}\n`;
  if (v.is_multi_valued) {
    out += `    is_multi_valued: ${v.is_multi_valued}\n`;
    out += `    multi_value_delimiter: ${yamlScalar(v.multi_value_delimiter)}\n`;
  }
  if (v.hidden) {
    out += `    hidden:\n`;
    v.hidden.forEach(h => { out += `      - ${yamlScalar(h)}\n`; });
  }
  return out;
}

/** The entity-sample columns every STF writes besides the factors; validators read them by these names. */
export const STF_COLUMNS = {
  sampleId: 'sample.ID', runs: 'SRA.ID.s.', biosample: 'BioSample', experiments: 'SRA.experiment.s.', label: 'label'
};

const categorical = { data_type: 'string', data_shape: 'categorical' };
const multiValued = { is_multi_valued: 'yes', multi_value_delimiter: ',' };

/** For reads in SRA; BioSample and SRA experiment(s) are provenance, hidden from EDA. */
const SRA_VARIABLES = [
  { variable: STF_COLUMNS.runs, value: s => (s.runs || []).join(','), provider_label: ['SRA ID(s)'], display_name: 'SRA ID(s)', ...categorical, ...multiValued },
  { variable: STF_COLUMNS.biosample, value: s => s.biosample ?? '', provider_label: ['BioSample'], display_name: 'BioSample', ...categorical, hidden: ['everywhere'] },
  {
    variable: STF_COLUMNS.experiments, value: s => (s.experiments || []).join(','), provider_label: ['SRA experiment(s)'], display_name: 'SRA experiment(s)',
    ...categorical, ...multiValued, hidden: ['everywhere']
  }
];
const LABEL_VARIABLE = { variable: STF_COLUMNS.label, value: s => s.label, provider_label: ['label'], display_name: 'label', ...categorical };

function factorVariable(key, f, samples) {
  const v = {
    variable: toColName(key), provider_label: [key], display_name: f.displayName || key,
    value: s => {
      const val = s.factors ? s.factors[key] : '';
      return val !== null && val !== undefined ? String(val) : '';
    },
    ...inferType(samples.map(s => (s.factors ? s.factors[key] : null)))
  };
  if (f.definition) v.definition = f.definition;
  if (f.unit) v.unit = f.unit;
  return v;
}

/**
 * Returns { tsv, yaml } for annotations shaped { samples, factors: { key: { displayName, definition, unit } } }.
 * sra: false leaves out the SRA variables, for reads not in SRA.
 */
export function sampleAnnotationsToStf({ samples, factors }, { sra = true } = {}) {
  const fixed = [...(sra ? SRA_VARIABLES : []), LABEL_VARIABLE];
  const taken = new Set([STF_COLUMNS.sampleId, ...fixed.map(v => v.variable)]);
  for (const key of Object.keys(factors || {})) {
    if (taken.has(toColName(key))) throw new Error(`Factor "${key}" would be column ${toColName(key)}, which entity-sample already has`);
  }
  const variables = [...fixed, ...Object.keys(factors || {}).map(key => factorVariable(key, factors[key] || {}, samples))];

  const headers = [`${STF_COLUMNS.sampleId} \\\\ Descriptors`, ...variables.map(v => v.variable)];
  const rows = samples.map(s => [s.sampleId, ...variables.map(v => v.value(s))]);
  const tsv = [headers, ...rows].map(r => r.join('\t')).join('\n') + '\n';

  let yaml = `name: sample
display_name: Sample
display_name_plural: Samples

id_columns:
  - id_column: ${STF_COLUMNS.sampleId}
    entity_name: sample
    provider_label:
      - sample ID

variables:\n`;
  variables.forEach(v => { yaml += serializeVariable(v); });
  yaml += `\ncategories: []\ncollections: []\n`;
  return { tsv, yaml };
}
