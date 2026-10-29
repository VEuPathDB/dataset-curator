/**
 * Parse CSV manually (no dependencies)
 */
export function parseCsv(content) {
  const lines = content.split(/\r?\n/).filter(line => line.trim());
  if (lines.length < 2) return [];

  // Parse header - handle quoted fields
  const parseRow = (line) => {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  };

  const headers = parseRow(lines[0]);
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseRow(lines[i]);
    const row = {};
    headers.forEach((header, idx) => {
      row[header] = values[idx] || '';
    });
    rows.push(row);
  }

  return rows;
}

/**
 * Convert CSV rows to our JSON format
 */
export function csvToRuns(rows) {
  return rows.map(row => {
    // Map common CSV column names to our format
    const run = {
      run_accession: row['Run'] || row['run_accession'] || '',
      sample_accession: row['BioSample'] || row['sample_accession'] || '',
      sample_alias: row['Sample Name'] || row['sample_alias'] || '',
      sample_title: row['sample_title'] || '',
      experiment_accession: row['Experiment'] || row['experiment_accession'] || '',
      experiment_title: row['experiment_title'] || '',
      library_name: row['LibraryName'] || row['Library Name'] || row['library_name'] || '',
      submission_accession: row['Submission'] || row['submission_accession'] || '',
      first_public: (row['ReleaseDate'] || row['first_public'] || '').slice(0, 10),
      library_layout: row['LibraryLayout'] || row['library_layout'] || '',
      library_strategy: row['LibraryStrategy'] || row['library_strategy'] || '',
      library_source: row['LibrarySource'] || row['library_source'] || '',
      library_selection: row['LibrarySelection'] || row['library_selection'] || '',
      instrument_platform: row['Platform'] || row['instrument_platform'] || '',
      instrument_model: row['Model'] || row['Instrument'] || row['instrument_model'] || '',
      read_count: parseInt(row['spots'] || row['read_count'] || '0', 10) || null,
      base_count: parseInt(row['bases'] || row['Bases'] || row['base_count'] || '0', 10) || null,
      scientific_name: row['Organism'] || row['scientific_name'] || '',
      tax_id: row['TaxID'] || row['tax_id'] || ''
    };

    // Collect remaining columns as sample_attributes
    const knownKeys = new Set([
      'Run', 'run_accession', 'BioSample', 'sample_accession', 'Sample Name', 'sample_alias',
      'sample_title', 'Experiment', 'experiment_title', 'LibraryLayout', 'library_layout',
      'LibraryStrategy', 'library_strategy', 'LibrarySource', 'library_source',
      'LibrarySelection', 'library_selection', 'Platform', 'instrument_platform',
      'Model', 'instrument_model', 'spots', 'read_count', 'bases', 'base_count',
      'Organism', 'scientific_name', 'TaxID', 'tax_id', 'Bytes', 'AvgSpotLen',
      'Consent', 'DATASTORE_filetype', 'DATASTORE_provider', 'DATASTORE_region',
      'Assay Type', 'BioProject', 'Center Name', 'SRA Study', 'ReleaseDate',
      'experiment_accession', 'LibraryName', 'library_name', 'Submission', 'submission_accession', 'first_public',
      'Library Name', 'Instrument', 'Bases', 'DATASTORE filetype', 'DATASTORE provider', 'DATASTORE region',
      'create_date', 'version'
    ]);

    const attributes = {};
    for (const [key, value] of Object.entries(row)) {
      if (!knownKeys.has(key) && value) {
        const normalizedKey = key.toLowerCase().replace(/\s+/g, '_');
        attributes[normalizedKey] = value;
      }
    }

    if (Object.keys(attributes).length > 0) {
      run.sample_attributes = attributes;
    }

    return run;
  });
}
