import { dbxrefDatasetName } from './values.js';

const transcriptDataset = (name, url) => Object.freeze({ name, level: 'transcript', viewName: 'Transcript', url });
const UNIPROT = transcriptDataset('uniprot_from_annotation', 'http://www.uniprot.org/uniprot/EXTERNAL_ID_HERE');

/** Prefixes with an established VEuPathDB dbxref_simple dataset; loads reuse its name, view and URL. */
export const DBXREF_OVERRIDES = Object.freeze({
  'UniProtKB/Swiss-Prot': UNIPROT,
  'UniProtKB/TrEMBL': UNIPROT,
  GOA: transcriptDataset('goa_from_annotation', 'https://www.ebi.ac.uk/QuickGO/searchproducts/EXTERNAL_ID_HERE'),
  InterPro: transcriptDataset('interpro_from_annotation', 'http://www.ebi.ac.uk/interpro/entry/EXTERNAL_ID_HERE'),
  PDB: transcriptDataset('pdb_from_annotation', 'http://www.rcsb.org/structure/EXTERNAL_ID_HERE'),
  PMID: transcriptDataset('pmid_from_annotation', 'http://www.ncbi.nlm.nih.gov/pubmed/?term=EXTERNAL_ID_HERE')
});

/** URL templates for prefixes without an override. */
export const DBXREF_URLS = Object.freeze({
  GeneID: 'https://www.ncbi.nlm.nih.gov/gene/?term=EXTERNAL_ID_HERE',
  NCBI_GP: 'http://www.ncbi.nlm.nih.gov/protein/EXTERNAL_ID_HERE'
});

export function dbxrefDataset(prefix) {
  if (Object.hasOwn(DBXREF_OVERRIDES, prefix)) return { ...DBXREF_OVERRIDES[prefix], override: true };
  const url = Object.hasOwn(DBXREF_URLS, prefix) ? DBXREF_URLS[prefix] : null;
  return { name: dbxrefDatasetName(prefix), level: 'gene', viewName: 'GeneFeature', url, override: false };
}
