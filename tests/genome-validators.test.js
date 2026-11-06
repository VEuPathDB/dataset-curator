import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { validatorsFor } from '../shared/scripts/dataset-types/validators.js';
import { datasetsOf } from '../shared/scripts/dataset-types/_common.js';
import { entryShape, entryShapeProblems } from '../shared/scripts/dataset-types/genome-assembly/validators/entry-shape.js';
import { organismRecord } from '../shared/scripts/dataset-types/genome-assembly/validators/organism-record.js';
import { genomeWorkArea, amendedProposal } from './genome-work-area.js';

const messages = async (validator, { dir, manifest }, ctx = {}) => (await validator.run({ proposalDir: dir, manifest, ...ctx })).map((f) => f.message);
const AMEND = 'run amend-proposal.js and publish';

test('genome-assembly registers its content validators', () => {
  assert.deepEqual(validatorsFor('genome-assembly').map((v) => [v.name, v.kind]), [['entryShape', 'content'], ['organismRecord', 'content']]);
});

test('entryShape passes an amended genome', async () => {
  assert.deepEqual(await messages(entryShape, amendedProposal(genomeWorkArea())), []);
});

test('entryShape refuses each shape a genome cannot load', () => {
  const { dir, manifest } = amendedProposal(genomeWorkArea());
  const [primary, contig, mito, primaryFeatures, contigFeatures, products] = datasetsOf(dir, manifest);
  const annotated = (list) => entryShapeProblems(list, { source: 'genbank' });
  assert.deepEqual(annotated([contig, contigFeatures, products]), [`a genome needs exactly one fasta_primary_genome_sequence entry; this one has 0; ${AMEND}`]);
  assert.deepEqual(annotated([primary, primary, primaryFeatures, products]), [`a genome needs exactly one fasta_primary_genome_sequence entry; this one has 2; ${AMEND}`]);
  assert.deepEqual(annotated([primary, contig, contig, primaryFeatures, products]), ['two fasta_secondary_genome entries have soTerm contig; each lower sequence type needs its own']);
  assert.deepEqual(annotated([primary, mito, mito, primaryFeatures, products]), ['two fasta_organelle_genome entries are for organelle mitochondrion']);
  assert.deepEqual(annotated([primary, contigFeatures, primaryFeatures, products]),
    ['NoPreprocess_secondary_genome_features $$genomeSource$$ (contig) has no secondary sequence entry with soTerm contig']);
  assert.deepEqual(annotated([primary, primaryFeatures]), [`an annotated genome needs a productNames entry; ${AMEND}`]);
  assert.deepEqual(annotated([primary, products]), [`an annotated genome needs at least one features entry; ${AMEND}`]);
  const unannotated = (list) => entryShapeProblems(list, { source: 'none' });
  assert.deepEqual(unannotated([primary, contig, mito]), []);
  assert.deepEqual(unannotated([primary, primaryFeatures]),
    ['an unannotated genome loads sequence entries only, not NoPreprocess_primary_genome_features $$genomeSource$$ (chromosome)']);
});

test('organismRecord passes an amended record', async () => {
  assert.deepEqual(await messages(organismRecord, amendedProposal(genomeWorkArea())), []);
});

test('organismRecord asks for an amendment of a Phase 1 record, and checks each amended prop', async () => {
  const proposal = amendedProposal(genomeWorkArea());
  const path = join(proposal.dir, 'curated/organism.json');
  const amended = JSON.parse(readFileSync(path, 'utf-8'));
  const check = async (record) => { writeFileSync(path, JSON.stringify(record)); return messages(organismRecord, proposal); };
  assert.deepEqual(await check({ ...amended, schemaVersion: 1 }), [`curated/organism.json is schema version 1, without the props preprocessing adds; ${AMEND}`]);
  const { isCore, ...withoutIsCore } = amended;
  assert.deepEqual(await check(withoutIsCore), [`curated/organism.json has no isCore; ${AMEND}`]);
  assert.deepEqual(await check({ ...amended, isHugeGenome: 'yes' }), ['isHugeGenome must be "true" or "false", not "yes"']);
  assert.deepEqual(await check({ ...amended, maxIntronSize: '0' }), ['maxIntronSize must be a positive integer, not "0"']);
  assert.deepEqual(await check({ ...amended, orthomclAbbrev: 'TFAK' }), ['orthomclAbbrev must be 4 to 8 lowercase letters, not "TFAK"']);
  assert.deepEqual(await check({ ...amended, genomeVersion: '2025-01-01' }),
    [`constant genomeVersion is "2024-03-05" but the organism record says "2025-01-01"; ${AMEND}`]);
  assert.deepEqual(await check({ ...amended, isFamilyRepresentative: 'true' }), [
    'a family representative needs familyNcbiTaxonIds; run amend-proposal.js --organism familyNcbiTaxonIds=... and publish',
    'a family representative needs familyNameForFiles; run amend-proposal.js --organism familyNameForFiles=... and publish'
  ]);
});
