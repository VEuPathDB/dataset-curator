/**
 * Every dataset type, and whether it introduces its organism ({ new: true, max }) or uses
 * loaded ones ({ new: false }); pending: 'refuse' refuses an organism only a pending genome
 * proposal introduces. The manifest schema reads this, so it imports no type module.
 */
export const ORGANISM_RULES = {
  'genome-assembly': { new: true, max: 1 },
  'bulk-rnaseq': { new: false },
  // Gene CNV needs orthomcl paralogs, so the organism must already be released.
  dnaseq: { new: false, max: 1, pending: 'refuse' },
  chipseq: { new: false, max: 1 }
};
