import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as genome from '../shared/scripts/dataset-types/genome-assembly.js';
import { assertValidEntries } from '../shared/scripts/dataset-types/_common.js';
import { entriesFrom, FUNCTIONAL_DEFAULTS } from '../shared/scripts/dataset-types/genome-assembly/entries.js';
import { readPreprocessed } from '../shared/scripts/dataset-types/genome-assembly/preprocess.js';
import { parseDatasetClass, IDENTITY_PROPS } from '../shared/scripts/lib/dataset-classes.js';
import { fixtures } from './helpers.js';
import { genomeWorkArea, genomeProposal, amendedProposal, editJson, FETCH_URLS, PARTITIONS } from './genome-work-area.js';

const classes = readFileSync(join(fixtures, 'classes.xml'), 'utf-8');
const classOf = (className) => parseDatasetClass(classes, className);
const amend = (workArea, { given = { orthomclAbbrev: 'tfak' }, ...options } = {}) => {
  const { dir, manifest } = genomeProposal(options);
  return genome.preprocessedAmendment({ workArea, proposalDir: dir, manifest, given });
};
const SEQUENCE_SOURCE = { type: 'url', urls: [FETCH_URLS.fasta, FETCH_URLS.report] };
const GFF_SOURCE = { type: 'url', urls: [FETCH_URLS.gff] };

test('entriesFrom gives sequences, then features where ISF loads anything, then the functional datasets', () => {
  const entries = entriesFrom(readPreprocessed(genomeWorkArea()));
  assert.deepEqual(entries.map((e) => [e.datasetClass, e.name, e.version]), [
    ['fasta_primary_genome_sequence', '$$genomeSource$$', '$$genomeVersion$$'],
    ['fasta_secondary_genome', '$$genomeSource$$', '$$genomeVersion$$'],
    ['fasta_organelle_genome', '$$genomeSource$$', '$$genomeVersion$$'],
    ['NoPreprocess_primary_genome_features', '$$genomeSource$$', '$$genomeVersion$$'],
    ['NoPreprocess_secondary_genome_features', '$$genomeSource$$', '$$genomeVersion$$'],
    ['productNames', 'GenBank', '$$functAnnotVersion$$'],
    ['geneName', 'GenBank', '$$functAnnotVersion$$'],
    ['dbxref_simple', 'uniprot_from_annotation', '$$functAnnotVersion$$'],
    ['dbxref_simple', 'ensemblgenomes_gn_from_annotation', '$$functAnnotVersion$$']
  ]);
  assert.deepEqual(entries[0], {
    datasetClass: 'fasta_primary_genome_sequence', name: '$$genomeSource$$', version: '$$genomeVersion$$',
    props: { ncbiTaxonId: '$$ncbiTaxonId$$', table: 'DoTS::ExternalNASequence', soTerm: 'chromosome', sourceIdRegex: '^>(\\S+)', releaseDate: '' },
    source: SEQUENCE_SOURCE
  });
  assert.deepEqual(entries[1].props, { ncbiTaxonId: '$$ncbiTaxonId$$', table: 'DoTS::ExternalNASequence', soTerm: 'contig', sourceIdRegex: '^>(\\S+)' });
  assert.deepEqual(entries[2].props, { ncbiTaxonId: '$$ncbiTaxonId$$', table: 'DoTS::ExternalNASequence', soTerm: 'mitochondrial_chromosome', sourceIdRegex: '^>(\\S+)', organelle: 'mitochondrion' });
  assert.deepEqual(entries[3].props, { ncbiTaxonId: '$$ncbiTaxonId$$', soTerm: 'chromosome', source: '$$genomeSource$$', mapFile: 'genemRNAExonCDS2Gus.xml' });
  assert.deepEqual(entries[4].props, { ncbiTaxonId: '$$ncbiTaxonId$$', soTerm: 'contig', mapFile: 'genemRNAExonCDS2Gus.xml' });
  assert.deepEqual(entries[3].source, GFF_SOURCE);
  assert.deepEqual(entries[5].props, {});
  assert.deepEqual(entries[6].props, { genomeVersion: '$$genomeVersion$$' });
  assert.deepEqual(entries[7].props, {
    columnSpec: 'primary_identifier', target: 'NAFeature', url: 'http://www.uniprot.org/uniprot/EXTERNAL_ID_HERE', urlUsesSecondaryId: 'false',
    genomeVersion: '$$genomeVersion$$', viewName: 'Transcript'
  });
  assert.equal(entries[8].props.url, '');
  assert.equal(entries[8].props.viewName, 'GeneFeature');
  assert.deepEqual(entries[8].source, GFF_SOURCE);
});

test('each functional default names exactly its class\'s props other than identity', () => {
  for (const [className, defaults] of Object.entries(FUNCTIONAL_DEFAULTS)) {
    assert.deepEqual(Object.keys(defaults).sort(), classOf(className).props.filter((p) => !IDENTITY_PROPS.includes(p)).sort(), className);
  }
});

test('an amended proposal validates against classes.xml', () => {
  const { dir, manifest } = amendedProposal(genomeWorkArea());
  assert.equal(assertValidEntries(dir, manifest, genome, { classOf }).length, 9);
});

test('preprocessedAmendment derives the constants and organism props, each with its source', () => {
  const a = amend(genomeWorkArea());
  assert.deepEqual(a.constants, { genomeSource: 'GenBank', genomeVersion: '2024-03-05', functAnnotVersion: '2024-04-01' });
  assert.deepEqual(a.organism, {
    annotationIncludesTRNAs: 'true', maxIntronSize: '1000', isHugeGenome: 'false', isNotEbiGenome: 'true', isCore: 'false', runExportPred: 'false',
    isFamilyRepresentative: 'false', familyNcbiTaxonIds: '', familyNameForFiles: '', orthomclAbbrev: 'tfak'
  });
  assert.equal(a.entries.length, 9);
  assert.equal(a.sources['constants.genomeVersion'], 'curated/organism.json genomeVersion');
  assert.equal(a.sources['constants.functAnnotVersion'], 'report annotation_info.release_date');
  assert.equal(a.sources['organism.annotationIncludesTRNAs'], 'genome-build.json featureTypes: 1 tRNA');
  assert.equal(a.sources['organism.maxIntronSize'], 'genome-build.json maxIntron 599, rounded up to a multiple of 500, at least 1000');
  assert.equal(a.sources['organism.isHugeGenome'], 'report assembly_stats.total_sequence_length 12000000');
  assert.equal(a.sources['organism.isCore'], 'rule');
  assert.equal(a.sources['organism.isFamilyRepresentative'], 'curated/organism.json familyRepOrganismAbbrev "tfakST1"');
  assert.equal(a.sources['organism.orthomclAbbrev'], 'given (--organism orthomclAbbrev)');
});

test('derived props follow the build and the report', () => {
  const primaryWith = (over) => PARTITIONS.map((p, i) => (i === 0 ? { ...p, ...over } : p));
  const plain = amend(genomeWorkArea({ partitions: primaryWith({ featureTypes: { exon: 2, gene: 2, mRNA: 1 }, maxIntron: 1234 }) }));
  assert.equal(plain.organism.annotationIncludesTRNAs, 'false');
  assert.equal(plain.organism.maxIntronSize, '1500');
  assert.equal(amend(genomeWorkArea(), { report: { assembly_stats: { total_sequence_length: '1000000001' } } }).organism.isHugeGenome, 'true');
  const undated = amend(genomeWorkArea(), { report: { annotation_info: undefined } });
  assert.equal(undated.constants.functAnnotVersion, '2024-03-05');
  assert.equal(undated.sources['constants.functAnnotVersion'], 'genomeVersion (the report has no annotation_info.release_date)');
});

test('a given value overrides anything, and the record keeps the values it was asked for', () => {
  const workArea = genomeWorkArea();
  const given = amend(workArea, { given: { orthomclAbbrev: 'tfak', isCore: 'true', maxIntronSize: '5000' } });
  assert.equal(given.organism.isCore, 'true');
  assert.equal(given.organism.maxIntronSize, '5000');
  assert.equal(given.sources['organism.isCore'], 'given (--organism isCore)');
  const kept = amend(workArea, { given: {}, record: { orthomclAbbrev: 'tfkp', familyNameForFiles: 'Testaceae' } });
  assert.equal(kept.organism.orthomclAbbrev, 'tfkp');
  assert.equal(kept.organism.familyNameForFiles, 'Testaceae');
  assert.equal(kept.sources['organism.orthomclAbbrev'], 'curated/organism.json');
});

test('preprocessedAmendment refuses organism props it cannot settle, naming the fix', () => {
  const workArea = genomeWorkArea();
  assert.throws(() => amend(workArea, { given: {} }), /orthomclAbbrev is never derived; pass --organism orthomclAbbrev=<4 to 8 lowercase letters>/);
  assert.throws(() => amend(workArea, { given: { orthomclAbbrev: 'tfak', colour: 'red' } }), /--organism takes annotationIncludesTRNAs, .*; not colour/);
  const rep = amend(workArea, { record: { familyRepOrganismAbbrev: 'tfakST-1' }, given: { orthomclAbbrev: 'tfak', familyNcbiTaxonIds: '999000', familyNameForFiles: 'Testus' } });
  assert.equal(rep.organism.isFamilyRepresentative, 'true');
  assert.throws(() => amend(workArea, { report: { assembly_stats: {} } }), /no assembly_stats\.total_sequence_length; pass --organism isHugeGenome=true or false/);
  assert.throws(() => amend(workArea, { record: { isAnnotatedGenome: 'false' } }),
    /GCA_000001\.1 has annotation source "none"; provider GFF annotation is not supported yet and unannotated genomes are not handled by verify-genome/);
});

test('an empty familyRepOrganismAbbrev is never taken to mean the organism represents its family', () => {
  const workArea = genomeWorkArea();
  const record = { familyRepOrganismAbbrev: '' };
  assert.throws(() => amend(workArea, { record }),
    /familyRepOrganismAbbrev is empty: pass --organism familyRepOrganismAbbrev=<abbrev>, or --organism isFamilyRepresentative=true if this organism represents its family/);
  assert.throws(() => amend(workArea, { record, given: { orthomclAbbrev: 'tfak', isFamilyRepresentative: 'false' } }), /familyRepOrganismAbbrev is empty/);
  const named = amend(workArea, { record, given: { orthomclAbbrev: 'tfak', familyRepOrganismAbbrev: 'tgenST-2' } });
  assert.equal(named.organism.familyRepOrganismAbbrev, 'tgenST-2');
  assert.equal(named.organism.isFamilyRepresentative, 'false');
  assert.equal(named.sources['organism.familyRepOrganismAbbrev'], 'given (--organism familyRepOrganismAbbrev)');
  const own = amend(workArea, { record, given: { orthomclAbbrev: 'tfak', isFamilyRepresentative: 'true', familyNcbiTaxonIds: '999000', familyNameForFiles: 'Testus' } });
  assert.equal(own.organism.isFamilyRepresentative, 'true');
  assert.equal(Object.hasOwn(own.organism, 'familyRepOrganismAbbrev'), false);
  assert.throws(() => amend(workArea, { record, given: { orthomclAbbrev: 'tfak', isFamilyRepresentative: 'true' } }), /pass --organism familyNcbiTaxonIds=<taxon ids> and --organism familyNameForFiles=<name>/);
  assert.throws(() => amend(workArea, { record, given: { orthomclAbbrev: 'tfak', familyRepOrganismAbbrev: '' } }), /familyRepOrganismAbbrev must be an organism abbreviation, not ""/);
});

test('preprocessedAmendment refuses an undeliverable work area, another accession\'s, an older finalize and an unknown functional class', () => {
  assert.throws(() => amend(genomeWorkArea({ trial: { result: 'failed' } })), /cannot amend GCA_000001\.1:\n  - trial\/trial\.json: the trial result is "failed"/);
  const other = genomeWorkArea();
  editJson(join(other, 'genome-build.json'), (b) => ({ ...b, accession: 'GCA_000002.1' }));
  assert.throws(() => amend(other), /holds GCA_000002\.1, not GCA_000001\.1/);
  const older = genomeWorkArea({ partitions: PARTITIONS.map(({ featureTypes, maxIntron, ...p }) => p) });
  assert.throws(() => amend(older), /genome-build\.json has no featureTypes or maxIntron/);
  const unknown = genomeWorkArea({ functionalDatasets: [{ datasetClass: 'ECAssocGeneFeatureMappings', name: 'GenBank', file: 'ec.txt', level: 'gene', text: 'TST_0010\t1.1.1.1\n', props: {} }] });
  assert.throws(() => amend(unknown), /functional\.json has a ECAssocGeneFeatureMappings dataset, which has no defaults/);
});

test('preprocessedAmendment refuses values the organismRecord validator would refuse', () => {
  const workArea = genomeWorkArea();
  assert.throws(() => amend(workArea, { given: { orthomclAbbrev: '' } }), /orthomclAbbrev must be 4 to 8 lowercase letters, not ""/);
  assert.throws(() => amend(workArea, { given: { orthomclAbbrev: 'tfak', isCore: 'yes' } }), /isCore must be "true" or "false", not "yes"/);
  assert.throws(() => amend(workArea, { given: { orthomclAbbrev: 'tfak', maxIntronSize: 'abc' } }), /maxIntronSize must be a positive integer, not "abc"/);
  assert.throws(() => amend(workArea, { given: {}, record: { orthomclAbbrev: '' } }), /orthomclAbbrev must be 4 to 8 lowercase letters, not ""/);
});

test('a re-run re-derives what an earlier --organism set, and keeps what was asked for', () => {
  const workArea = genomeWorkArea();
  const first = amendedProposal(workArea, {
    record: { familyRepOrganismAbbrev: 'tfakST-1' },
    given: { orthomclAbbrev: 'tfak', isCore: 'true', familyNcbiTaxonIds: '999000', familyNameForFiles: 'Testus' }
  });
  assert.equal(first.amendment.organism.isCore, 'true');
  const again = genome.preprocessedAmendment({ workArea, proposalDir: first.dir, manifest: first.manifest, given: {} });
  assert.equal(again.organism.isCore, 'false');
  assert.equal(again.organism.orthomclAbbrev, 'tfak');
  assert.equal(again.organism.familyNcbiTaxonIds, '999000');
  assert.equal(again.organism.familyNameForFiles, 'Testus');
});

test('isHugeGenome is true only above a billion bases, and maxIntronSize rounds up to 500 from 1000', () => {
  const total = (n) => amend(genomeWorkArea(), { report: { assembly_stats: { total_sequence_length: String(n) } } }).organism.isHugeGenome;
  assert.equal(total(1_000_000_000), 'false');
  assert.equal(total(1_000_000_001), 'true');
  const intron = (maxIntron) => amend(genomeWorkArea({ partitions: PARTITIONS.map((p, i) => (i === 0 ? { ...p, maxIntron } : p)) })).organism.maxIntronSize;
  assert.equal(intron(0), '1000');
  assert.equal(intron(1000), '1000');
  assert.equal(intron(1001), '1500');
});

test('a functional dataset whose url is null gets an empty url, for every class that has one', () => {
  const classesWithUrl = Object.entries(FUNCTIONAL_DEFAULTS).filter(([, d]) => 'url' in d).map(([c]) => c);
  assert.deepEqual(classesWithUrl, ['aliases', 'dbxref_simple']);
  const functionalDatasets = classesWithUrl.map((datasetClass) => ({ datasetClass, name: 'GenBank', file: 'f.txt', level: 'gene', text: 'TST_0010\tx\n', props: { url: null } }));
  const entries = entriesFrom(readPreprocessed(genomeWorkArea({ functionalDatasets })));
  assert.deepEqual(entries.filter((e) => classesWithUrl.includes(e.datasetClass)).map((e) => e.props.url), ['', '']);
});
