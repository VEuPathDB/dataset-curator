import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EXPECTED_PREPROCESSOR, readIsfMap } from '../shared/scripts/genome/isf-map.js';
import { genomeFixtures } from './genome-helpers.js';

const MINI_MAP_XML = readFileSync(join(genomeFixtures, 'isf-map-mini.xml'), 'utf-8');
const ACD = process.env.APICOMMONDATA_DIR;

test('readIsfMap reads features, their qualifiers and the feature-level ignore', () => {
  const map = readIsfMap(MINI_MAP_XML);
  assert.equal(map.preprocessor, EXPECTED_PREPROCESSOR);
  assert.deepEqual([...map.features.keys()], ['coding_gene', 'mRNA', 'tRNA_gene', 'tRNA', 'snRNA_gene', 'snRNA', 'exon', 'three_prime_utr', 'five_prime_UTR']);
  assert.deepEqual([...map.features.get('mRNA').qualifiers], ['ID', 'gbkey', 'pseudo']);
  assert.equal(map.features.get('coding_gene').ignore, false);
  assert.equal(map.features.get('three_prime_utr').ignore, true);
  assert.deepEqual([...map.features.get('five_prime_UTR').qualifiers], []);
  assert.equal(map.features.has('commented_out'), false);
});

test('a map naming another preprocessor is refused; only one is ported', () => {
  const other = MINI_MAP_XML.replace('genemRNAExonCDS2BioperlTree', 'GeneDBBioperlTree');
  assert.throws(() => readIsfMap(other), /names preprocessor ApiCommonData::Load::GeneDBBioperlTree; only ApiCommonData::Load::genemRNAExonCDS2BioperlTree is ported/);
});

test('the real ApiCommonData map parses', { skip: !ACD && 'APICOMMONDATA_DIR is not set; point it at an ApiCommonData checkout' }, () => {
  const map = readIsfMap(readFileSync(join(ACD, 'Load/lib/xml/isf/genemRNAExonCDS2Gus.xml'), 'utf-8'));
  assert.ok(map.features.size >= 60, `only ${map.features.size} features`);
  assert.deepEqual([...map.features.get('gap').qualifiers], ['ID', 'estimated_length', 'gap_type']);
  assert.equal(map.features.get('coding_gene').qualifiers.has('is_ordered'), false);
});
