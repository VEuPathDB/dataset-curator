import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shortSpecies, ticketTitle } from '../shared/scripts/lib/proposal-ops.js';

test('shortSpecies abbreviates the genus and drops strain words', () => {
  assert.equal(shortSpecies('Aspergillus fumigatus'), 'A. fumigatus');
  assert.equal(shortSpecies('Plasmodium knowlesi strain A1H1'), 'P. knowlesi');
  assert.equal(shortSpecies('  Candida   albicans SC5314 '), 'C. albicans');
  assert.equal(shortSpecies('[Candida] auris'), 'C. auris');
  assert.equal(shortSpecies('Leishmania (Viannia) braziliensis'), 'L. braziliensis');
  assert.equal(shortSpecies('Candidatus Liberibacter asiaticus'), 'L. asiaticus');
  assert.equal(shortSpecies('Plasmodium'), null);
  assert.equal(shortSpecies(''), null);
  assert.equal(shortSpecies(undefined), null);
});

test('ticketTitle puts the species before each abbreviation', () => {
  const m = { organisms: [{ proposedOrganismAbbrev: 'pknoA1H1', project: 'PlasmoDB' }] };
  const seen = [];
  assert.equal(ticketTitle('PXD084821', m, (o) => { seen.push(o); return 'P. knowlesi'; }), '[PlasmoDB] PXD084821 P. knowlesi pknoA1H1');
  assert.equal(seen[0], m.organisms[0]);
});

test('ticketTitle lists several organisms in manifest order', () => {
  const m = { organisms: [{ proposedOrganismAbbrev: 'tgonME49', project: 'ToxoDB' }, { proposedOrganismAbbrev: 'pfal3D7', project: 'PlasmoDB' }] };
  const species = { tgonME49: 'T. gondii', pfal3D7: 'P. falciparum' };
  assert.equal(ticketTitle('PRJNA1', m, (o) => species[o.proposedOrganismAbbrev]), '[ToxoDB, PlasmoDB] PRJNA1 T. gondii tgonME49, P. falciparum pfal3D7');
});
