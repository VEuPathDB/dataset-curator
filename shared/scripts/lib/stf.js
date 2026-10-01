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
  return out;
}

/**
 * Returns { tsv, yaml } for annotations shaped { samples, factors: { key: { displayName, definition, unit } } }.
 * sra: false leaves out the SRA ID(s) variable, for reads not in SRA.
 */
export function sampleAnnotationsToStf({ samples, factors }, { sra = true } = {}) {
  const factorKeys = Object.keys(factors || {});

  const headers = ['sample.ID \\\\ Descriptors', ...(sra ? ['SRA.ID.s.'] : []), 'label', ...factorKeys.map(toColName)];
  const rows = samples.map(s => {
    const factorVals = factorKeys.map(key => {
      const val = s.factors ? s.factors[key] : '';
      return val !== null && val !== undefined ? String(val) : '';
    });
    return [s.sampleId, ...(sra ? [(s.runs || []).join(',')] : []), s.label, ...factorVals];
  });
  const tsv = [headers, ...rows].map(r => r.join('\t')).join('\n') + '\n';

  const variables = [
    ...(sra ? [{
      variable: 'SRA.ID.s.', provider_label: ['SRA ID(s)'], display_name: 'SRA ID(s)',
      data_type: 'string', data_shape: 'categorical', is_multi_valued: 'yes', multi_value_delimiter: ','
    }] : []),
    { variable: 'label', provider_label: ['label'], display_name: 'label', data_type: 'string', data_shape: 'categorical' }
  ];
  for (const key of factorKeys) {
    const f = (factors && factors[key]) || {};
    const v = {
      variable: toColName(key), provider_label: [key], display_name: f.displayName || key,
      ...inferType(samples.map(s => (s.factors ? s.factors[key] : null)))
    };
    if (f.definition) v.definition = f.definition;
    if (f.unit) v.unit = f.unit;
    variables.push(v);
  }

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
  return { tsv, yaml };
}
