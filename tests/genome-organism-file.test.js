import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as genome from '../shared/scripts/dataset-types/genome-assembly.js';
import { insertAfterConstants } from '../shared/scripts/dataset-types/genome-assembly/organism-file.js';
import { readClassProps, CLASSES_RELATIVE_PATH } from '../shared/scripts/lib/dataset-classes.js';
import { organismDatasetProps } from '../shared/scripts/lib/project-organisms.js';
import { fixtures } from './helpers.js';
import { genomeWorkArea, amendedProposal } from './genome-work-area.js';

/** A checkout holding the fixture classes.xml and FungiDB project file. */
function fixtureRepo() {
  const repo = mkdtempSync(join(tmpdir(), 'organism-file-'));
  mkdirSync(join(repo, 'Model/lib/xml/datasetClass'), { recursive: true });
  cpSync(join(fixtures, 'classes.xml'), join(repo, CLASSES_RELATIVE_PATH));
  mkdirSync(join(repo, 'Datasets/lib/xml/datasets/FungiDB'), { recursive: true });
  cpSync(join(fixtures, 'FungiDB.xml'), join(repo, 'Datasets/lib/xml/datasets/FungiDB.xml'));
  return repo;
}

test('readClassProps lists a class\'s props in order, a repeated one once', () => {
  const repo = fixtureRepo();
  const props = readClassProps(repo, 'organism');
  assert.equal(props.length, 26);
  assert.deepEqual(props.slice(0, 3), ['organismAbbrev', 'projectName', 'publicOrganismAbbrev']);
  assert.equal(props.filter((p) => p === 'speciesNcbiTaxonId').length, 1);
  assert.deepEqual(readClassProps(repo, 'referenceStrain'), ['organismAbbrev', 'isAnnotatedGenome']);
  assert.throws(() => readClassProps(repo, 'nope'), /Dataset class "nope" not found/);
});

test('organismDatasetProps reads each organism dataset of a project file, skipping commented-out ones', () => {
  const xml = readFileSync(join(fixtures, 'FungiDB.xml'), 'utf-8')
    .replace('</datasets>', '  <!-- <dataset class="organism"><prop name="organismAbbrev">gone</prop></dataset> -->\n</datasets>');
  assert.deepEqual(organismDatasetProps(xml).map((p) => [p.organismAbbrev, p.familyNcbiTaxonIds]), [['tfakST1', '998']]);
});

test('insertAfterConstants places a block after the last top-level constant, one blank line either side', () => {
  const xml = '<?xml version="1.0"?>\n<datasets>\n  <constant name="projectName" value="FungiDB"/>\n  <constant name="x" value="1"/>\n\n  <dataset class="organism">\n  </dataset>\n</datasets>\n';
  assert.equal(insertAfterConstants(xml, '  <dataset class="new">\n  </dataset>'),
    '<?xml version="1.0"?>\n<datasets>\n  <constant name="projectName" value="FungiDB"/>\n  <constant name="x" value="1"/>\n\n  <dataset class="new">\n  </dataset>\n\n  <dataset class="organism">\n  </dataset>\n</datasets>\n');
  assert.throws(() => insertAfterConstants('<datasets>\n</datasets>\n', 'x'), /has no top-level <constant>/);
});

test('newOrganismFiles refuses an organism whose file already exists', () => {
  const repo = fixtureRepo();
  writeFileSync(join(repo, 'Datasets/lib/xml/datasets/FungiDB/tfakST-1.xml'), '<datasets>\n</datasets>\n');
  const { dir, manifest } = amendedProposal(genomeWorkArea());
  const settled = { ...manifest, organisms: [{ ...manifest.organisms[0], organismAbbrev: 'tfakST-1' }] };
  assert.throws(() => genome.newOrganismFiles({ proposalDir: dir, manifest: settled, organism: 'tfakST-1', repoPath: repo }),
    /Datasets\/lib\/xml\/datasets\/FungiDB\/tfakST-1\.xml already exists; tfakST-1 is new in GCA_000001\.1, so it may already be loaded; ask before continuing/);
});
