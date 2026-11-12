/**
 * Static facts about each dataset type, with no imports, so code that only needs a type's name,
 * validation workspace or library strategies need not load the type module and everything it reaches.
 * Each type module re-exports its own entries here as before.
 */

/** ChIP-seq experiment type -> the SRA library_strategy a run of that type should carry. */
export const CHIPSEQ_STRATEGY_OF = {
  histonemod: 'ChIP-Seq', histonemod_noInput: 'ChIP-Seq', tfbinding: 'ChIP-Seq', mnase: 'MNase-Seq', faire: 'FAIRE-seq', dnase: 'DNase-Hypersensitivity'
};

export const DATASET_TYPE_META = {
  'genome-assembly': { validationWorkspace: 'annotated-genome-validation' },
  'bulk-rnaseq': { validationWorkspace: 'rnaseq-validation' },
  dnaseq: { validationWorkspace: 'dnaseq-validation', libraryStrategies: ['WGS'] },
  /** Submitters often label input libraries WGS. */
  chipseq: { validationWorkspace: 'chipseq-validation', libraryStrategies: [...new Set(Object.values(CHIPSEQ_STRATEGY_OF)), 'WGS'] },
  'functional-update': { validationWorkspace: 'functional-update-validation' }
};

/** Every dataset type name a manifest may carry. */
export const DATASET_TYPE_NAMES = Object.keys(DATASET_TYPE_META);

export const isDatasetTypeName = (name) => Object.hasOwn(DATASET_TYPE_META, name);
