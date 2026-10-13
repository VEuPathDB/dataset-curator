import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readProjectOrganisms, referenceStrainFor, familyRepFor } from '../shared/scripts/lib/project-organisms.js';

const organism = (props) => `  <dataset class="organism">\n${Object.entries(props).map(([k, v]) => `    <prop name="${k}">${v}</prop>`).join('\n')}\n  </dataset>`;
const projectXml = (...blocks) => `<?xml version="1.0"?>\n<datasets>\n${blocks.join('\n\n')}\n</datasets>\n`;

const fgra = organism({ organismAbbrev: 'fgraPH-1', speciesNcbiTaxonId: '5518', isReferenceStrain: 'true', isFamilyRepresentative: 'true', familyNcbiTaxonIds: '5506' });
const fgra2 = organism({ organismAbbrev: 'fgraDAOM', speciesNcbiTaxonId: '5518', isReferenceStrain: 'false', isFamilyRepresentative: 'false', familyNcbiTaxonIds: '' });
const nect = organism({ organismAbbrev: 'nhaeMPVI', speciesNcbiTaxonId: '140110', isReferenceStrain: 'true', isFamilyRepresentative: 'true', familyNcbiTaxonIds: '110618, 5125' });

test('readProjectOrganisms reads the organism datasets, skipping commented-out ones and other classes', () => {
  const xml = projectXml(fgra, `<!--\n${fgra2}\n-->`, '  <dataset class="referenceStrain">\n    <prop name="organismAbbrev">fgraPH-1</prop>\n  </dataset>', nect)
    .replace('<prop name="familyNcbiTaxonIds">5506</prop>', '<prop name="familyNcbiTaxonIds">5506</prop>  <!-- use genus here -->');
  assert.deepEqual(readProjectOrganisms(xml), [
    { organismAbbrev: 'fgraPH-1', speciesNcbiTaxonId: '5518', isReferenceStrain: true, isFamilyRepresentative: true, familyNcbiTaxonIds: ['5506'] },
    { organismAbbrev: 'nhaeMPVI', speciesNcbiTaxonId: '140110', isReferenceStrain: true, isFamilyRepresentative: true, familyNcbiTaxonIds: ['110618', '5125'] }
  ]);
  assert.deepEqual(readProjectOrganisms(''), []);
});

test('referenceStrainFor names the reference strain loaded for the species, else null', () => {
  const organisms = readProjectOrganisms(projectXml(fgra, fgra2));
  assert.equal(referenceStrainFor(organisms, '5518'), 'fgraPH-1');
  assert.equal(referenceStrainFor(organisms, '101028'), null);
});

test('familyRepFor takes the representative of the most specific lineage taxon', () => {
  const organisms = readProjectOrganisms(projectXml(fgra, fgra2, nect));
  const lineage = ['1028729', '101028', '5506', '110618', '5125'];
  assert.deepEqual(familyRepFor(organisms, lineage), { abbrev: 'fgraPH-1', taxonId: '5506' });
  assert.deepEqual(familyRepFor(organisms, ['999', '110618']), { abbrev: 'nhaeMPVI', taxonId: '110618' });
  assert.deepEqual(familyRepFor(organisms, ['999']), { abbrev: null, taxonId: null });
});

test('familyRepFor names every representative when one taxon has several', () => {
  const twin = organism({ organismAbbrev: 'fxyzA', speciesNcbiTaxonId: '1', isReferenceStrain: 'true', isFamilyRepresentative: 'true', familyNcbiTaxonIds: '5506' });
  const organisms = readProjectOrganisms(projectXml(fgra, twin));
  assert.deepEqual(familyRepFor(organisms, ['101028', '5506']), { abbrev: null, taxonId: '5506', ambiguous: ['fgraPH-1', 'fxyzA'] });
});
