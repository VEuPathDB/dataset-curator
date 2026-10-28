#!/usr/bin/env node
/**
 * check-released-organism.js - Confirms a DNA-seq proposal's organism is on the
 * released site (gene CNV needs its orthomcl paralogs) and records its chromosome
 * count. Writes .curation/tmp/<accession>_released_organism.json for write-proposal.js.
 * Exits 2 with candidates when no record matches: the curator picks one with
 * --released-organism <source_id>, or confirms it is not released (a hard stop).
 *
 * Usage: node check-released-organism.js <accession> --organism <abbrev> --project <Project> --rebuild-branch rebuildRR [--released-organism <source_id>]
 */
import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { openWorkspace } from './lib/config.js';
import { createGit } from './lib/git-ops.js';
import { readOrganismIndex } from './lib/organisms.js';
import { fetchReleasedOrganisms, matchReleased, GENOME_INFO_URL } from './lib/released-organisms.js';

async function main() {
  const { values, positionals: [accession] } = parseArgs({
    options: { organism: { type: 'string' }, project: { type: 'string' }, 'rebuild-branch': { type: 'string' }, 'released-organism': { type: 'string' } },
    allowPositionals: true
  });
  if (!accession || !values.organism || !values.project || !values['rebuild-branch']) {
    console.error('Usage: node check-released-organism.js <accession> --organism <abbrev> --project <Project> --rebuild-branch rebuildRR [--released-organism <source_id>]');
    process.exit(1);
  }
  const config = openWorkspace();
  const git = createGit(config.repoPath);
  git.fetch();
  const ref = `origin/${values['rebuild-branch']}`;
  const entry = readOrganismIndex(git, ref).find((e) => e.abbrev === values.organism && e.project === values.project);
  if (!entry) throw new Error(`${values.organism} is not a ${values.project} organism on ${ref}`);
  const sraPath = resolve(`.curation/tmp/${accession}_sra_metadata.json`);
  const species = existsSync(sraPath) ? JSON.parse(readFileSync(sraPath, 'utf-8')).runs?.find((r) => r.scientific_name)?.scientific_name : undefined;

  const result = matchReleased(await fetchReleasedOrganisms(), { ncbiTaxonId: entry.ncbiTaxonId, project: values.project, species, pick: values['released-organism'] });
  if (!result.matched) {
    console.error(`No released ${values.project} organism has taxon ${entry.ncbiTaxonId ?? '(none in the organism file)'}. Ask the curator which candidate is ${values.organism}, or whether it is not released yet (then it cannot be proposed: gene CNV needs its orthomcl paralogs).`);
    console.log(JSON.stringify({ candidates: result.candidates }, null, 2));
    process.exit(2);
  }
  const out = {
    organism: values.organism, project: values.project, ncbiTaxonId: entry.ncbiTaxonId ?? null,
    released: { sourceId: result.record.sourceId, organismName: result.record.organismName, strain: result.record.strain, chromosomeCount: result.record.chromosomeCount },
    matchedBy: result.by, service: GENOME_INFO_URL, queriedAt: new Date().toISOString()
  };
  const path = resolve(`.curation/tmp/${accession}_released_organism.json`);
  writeFileSync(path, JSON.stringify(out, null, 2) + '\n');
  console.log(path);
}

main().catch((err) => { console.error(`Error: ${err.message}`); process.exit(1); });
