import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSpec } from '../shared/scripts/lib/tabular/spec.js';
import { STF_CONSTANTS } from '../shared/scripts/lib/tabular/stf-constants.js';

function minimal() {
  return {
    specVersion: 1,
    study: { name: 'Demo' },
    inputDir: 'raw-data',
    entities: [
      {
        name: 'household', displayName: 'Household', displayNamePlural: 'Households',
        file: 'household.csv', idColumn: 'household_id',
        variables: [{ column: 'size', displayName: 'Size' }],
      },
      {
        name: 'participant', displayName: 'Participant', displayNamePlural: 'Participants',
        file: 'participants.csv', idColumn: 'participant_id',
        parent: 'household', parentColumn: 'household_id',
        variables: [{ column: 'age', name: 'age_years', displayName: 'Age', dataType: 'integer', dataShape: 'continuous' }],
        categories: [{ category: 'demo', displayName: 'Demo' }],
      },
    ],
    transforms: [],
  };
}

test('constants are frozen with the expected values', () => {
  assert.deepEqual(STF_CONSTANTS.DATA_TYPES, ['string', 'number', 'integer', 'date', 'longitude']);
  assert.deepEqual(STF_CONSTANTS.HIDDEN, ['download', 'variableTree', 'map', 'everywhere']);
  assert.ok(Object.isFrozen(STF_CONSTANTS.DATA_SHAPES));
});

test('valid minimal spec gives no errors', () => {
  assert.deepEqual(validateSpec(minimal()), []);
});

test('two roots are reported', () => {
  const s = minimal();
  delete s.entities[1].parent;
  delete s.entities[1].parentColumn;
  assert.ok(validateSpec(s).some((e) => /root/.test(e)));
});

test('parent cycle is reported', () => {
  const s = minimal();
  s.entities[0].parent = 'participant';
  s.entities[0].parentColumn = 'participant_id';
  const errs = validateSpec(s);
  assert.ok(errs.some((e) => /cycle/.test(e)));
});

test('unknown parent entity is reported', () => {
  const s = minimal();
  s.entities[1].parent = 'nowhere';
  assert.ok(validateSpec(s).some((e) => /entities\[1\]\.parent/.test(e)));
});

test('unknown parentCategory is reported', () => {
  const s = minimal();
  s.entities[1].variables[0].parentCategory = 'missing';
  assert.ok(validateSpec(s).some((e) => /entities\[1\]\.variables\[0\]\.parentCategory/.test(e)));
});

test('category cycle is reported', () => {
  const s = minimal();
  s.entities[1].categories = [
    { category: 'a', displayName: 'A', parentCategory: 'b' },
    { category: 'b', displayName: 'B', parentCategory: 'a' },
  ];
  assert.ok(validateSpec(s).some((e) => /category cycle/.test(e)));
});

test('replace-cells cannot be auto', () => {
  const s = minimal();
  s.transforms = [{ op: 'replace-cells', entity: 'participant', column: 'age', cells: [], reason: 'r', approval: 'auto' }];
  assert.ok(validateSpec(s).some((e) => /transforms\[0\]\.approval/.test(e)));
});

test('blank-placeholders auto only for unambiguous values', () => {
  const s = minimal();
  s.transforms = [{ op: 'blank-placeholders', entity: 'participant', values: ['unknown'], reason: 'r', approval: 'auto' }];
  assert.ok(validateSpec(s).some((e) => /transforms\[0\]\.approval/.test(e)));
  s.transforms[0].values = ['NA'];
  assert.deepEqual(validateSpec(s), []);
  s.transforms[0].values = ['unknown'];
  s.transforms[0].approval = 'user';
  assert.deepEqual(validateSpec(s), []);
});

test('bad dataType, bad name, bad approval, missing instead, unknown entity', () => {
  const s = minimal();
  s.entities[1].variables[0].dataType = 'float';
  s.entities[1].variables[0].name = '1bad';
  s.entities[0].idName = 'bad name';
  s.transforms = [
    { op: 'trim', entity: 'ghost', reason: 'r', approval: 'auto' },
    { op: 'trim', entity: 'participant', reason: 'r', approval: 'maybe' },
    { op: 'trim', entity: 'participant', reason: 'r', approval: 'rejected' },
  ];
  const errs = validateSpec(s);
  assert.ok(errs.some((e) => /entities\[1\]\.variables\[0\]\.dataType/.test(e)));
  assert.ok(errs.some((e) => /entities\[1\]\.variables\[0\]\.name/.test(e)));
  assert.ok(errs.some((e) => /entities\[0\]\.idName/.test(e)));
  assert.ok(errs.some((e) => /transforms\[0\]\.entity/.test(e)));
  assert.ok(errs.some((e) => /transforms\[1\]\.approval/.test(e)));
  assert.ok(errs.some((e) => /transforms\[2\]\.instead/.test(e)));
});

test('non-object spec does not throw', () => {
  assert.ok(validateSpec(null).length > 0);
  assert.ok(validateSpec({}).length > 0);
});
