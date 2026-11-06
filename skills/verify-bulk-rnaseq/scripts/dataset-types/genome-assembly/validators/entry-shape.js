import { datasetsOf, entryLabel } from '../../_common.js';
import { annotationOf } from '../../genome-assembly.js';
import { isFeaturesClass, isSequenceClass, roleOf } from '../entries.js';

const NAME = 'entryShape';
const AMEND = 'run amend-proposal.js and publish';
const repeated = (values) => [...new Set(values.filter((v, i) => values.indexOf(v) !== i))];

/** What keeps a genome's entries from loading: sequence partitions, features beside their sequences, and what its annotation needs. */
export function entryShapeProblems(entries, annotation) {
  const problems = [];
  const sequences = entries.filter((e) => isSequenceClass(e.datasetClass));
  const features = entries.filter((e) => isFeaturesClass(e.datasetClass));
  const ofRole = (role) => sequences.filter((e) => roleOf(e.datasetClass) === role);
  const primaries = ofRole('primary');
  if (primaries.length !== 1) problems.push(`a genome needs exactly one fasta_primary_genome_sequence entry; this one has ${primaries.length}; ${AMEND}`);
  for (const soTerm of repeated(ofRole('secondary').map((e) => e.props.soTerm))) {
    problems.push(`two fasta_secondary_genome entries have soTerm ${soTerm}; each lower sequence type needs its own`);
  }
  for (const organelle of repeated(ofRole('organelle').map((e) => e.props.organelle))) problems.push(`two fasta_organelle_genome entries are for organelle ${organelle}`);
  for (const f of features) {
    const role = roleOf(f.datasetClass);
    if (!ofRole(role).some((s) => s.props.soTerm === f.props.soTerm)) problems.push(`${entryLabel(f)} has no ${role} sequence entry with soTerm ${f.props.soTerm}`);
  }
  if (annotation.source === 'none') {
    const others = entries.filter((e) => !isSequenceClass(e.datasetClass));
    if (others.length) problems.push(`an unannotated genome loads sequence entries only, not ${others.map(entryLabel).join(', ')}`);
    return problems;
  }
  if (!entries.some((e) => e.datasetClass === 'productNames')) problems.push(`an annotated genome needs a productNames entry; ${AMEND}`);
  if (!features.length) problems.push(`an annotated genome needs at least one features entry; ${AMEND}`);
  return problems;
}

export const entryShape = {
  name: NAME,
  kind: 'content',
  tools: [],
  run: async ({ proposalDir, manifest }) => entryShapeProblems(datasetsOf(proposalDir, manifest), annotationOf(proposalDir))
    .map((message) => ({ validator: NAME, severity: 'error', message }))
};
