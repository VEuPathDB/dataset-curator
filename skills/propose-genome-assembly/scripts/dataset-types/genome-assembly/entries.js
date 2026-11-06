export const MAP_FILE = 'genemRNAExonCDS2Gus.xml';
const SOURCE_ID_REGEX = '^>(\\S+)';
const GENOME_SOURCE = '$$genomeSource$$';
const GENOME_VERSION = '$$genomeVersion$$';
const SEQUENCE_CLASS = { primary: 'fasta_primary_genome_sequence', secondary: 'fasta_secondary_genome', organelle: 'fasta_organelle_genome' };
const FEATURES_CLASS = {
  primary: 'NoPreprocess_primary_genome_features', secondary: 'NoPreprocess_secondary_genome_features', organelle: 'NoPreprocess_organelle_genome_features'
};

export const isSequenceClass = (datasetClass) => Object.values(SEQUENCE_CLASS).includes(datasetClass);
export const isFeaturesClass = (datasetClass) => Object.values(FEATURES_CLASS).includes(datasetClass);
/** primary, secondary or organelle for a sequence or features class; undefined for any other. */
export const roleOf = (datasetClass) => Object.keys(SEQUENCE_CLASS).find((role) => SEQUENCE_CLASS[role] === datasetClass || FEATURES_CLASS[role] === datasetClass);

/** Each functional class's props other than identity, with the value used when functional.json gives none. */
export const FUNCTIONAL_DEFAULTS = {
  productNames: {},
  GeneOntologyAssociations: {},
  EnzymeCommissionAssociations: {},
  dbxref_synonym: {},
  comments: {},
  geneName: { genomeVersion: GENOME_VERSION },
  aliases: {
    columnSpec: 'primary_identifier', url: 'http://www.ncbi.nlm.nih.gov/protein/EXTERNAL_ID_HERE', urlUsesSecondaryId: 'false',
    target: 'NAFeature', idType: 'alternate id', viewName: 'Transcript'
  },
  dbxref_simple: { columnSpec: 'primary_identifier', target: 'NAFeature', url: '', urlUsesSecondaryId: 'false', genomeVersion: GENOME_VERSION, viewName: 'GeneFeature' }
};

function sequenceEntry(part, urls) {
  const props = {
    ncbiTaxonId: '$$ncbiTaxonId$$', table: 'DoTS::ExternalNASequence', soTerm: part.soTerm, sourceIdRegex: SOURCE_ID_REGEX,
    ...(part.role === 'primary' ? { releaseDate: '' } : {}),
    ...(part.role === 'organelle' ? { organelle: part.organelle } : {})
  };
  return { datasetClass: SEQUENCE_CLASS[part.role], name: GENOME_SOURCE, version: GENOME_VERSION, props, source: { type: 'url', urls } };
}

function featuresEntry(part, urls) {
  const props = { ncbiTaxonId: '$$ncbiTaxonId$$', soTerm: part.soTerm, ...(part.role === 'primary' ? { source: GENOME_SOURCE } : {}), mapFile: MAP_FILE };
  return { datasetClass: FEATURES_CLASS[part.role], name: GENOME_SOURCE, version: GENOME_VERSION, props, source: { type: 'url', urls } };
}

function functionalEntry(dataset, urls) {
  const defaults = FUNCTIONAL_DEFAULTS[dataset.datasetClass];
  if (!defaults) throw new Error(`functional.json has a ${dataset.datasetClass} dataset, which has no defaults in genome-assembly/entries.js`);
  const given = (key) => (key === 'url' && dataset.props?.url === null ? '' : dataset.props?.[key]);
  const props = Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, given(key) ?? value]));
  return { datasetClass: dataset.datasetClass, name: dataset.name, version: '$$functAnnotVersion$$', props, source: { type: 'url', urls } };
}

/** The dataset entries a work area's records give: sequences, then features where ISF loads anything, then functional datasets. */
export function entriesFrom(records) {
  const { files } = records.fetch;
  const partitions = records.genomeBuild.partitions;
  return [
    ...partitions.map((part) => sequenceEntry(part, [files.fasta.url, files.report.url])),
    ...partitions.filter((part) => part.featureCount > 0).map((part) => featuresEntry(part, [files.gff.url])),
    ...records.functional.datasets.map((dataset) => functionalEntry(dataset, [files.gff.url]))
  ];
}

/** The partition a sequence or features entry loads: its role and soTerm, and its organelle when it names one; else null. */
export function partitionOf(entry, partitions) {
  const role = roleOf(entry.datasetClass);
  return partitions.find((p) => p.role === role && p.soTerm === entry.props.soTerm
    && (entry.props.organelle === undefined || p.organelle === entry.props.organelle)) ?? null;
}
