import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { constantsOf, escapeXml, readCuratedJson, ORGANISM_RECORD_FILENAME, AMENDED_ORGANISM_KEYS } from '../_common.js';
import { projectOf } from '../../lib/manifest.js';
import { datasetFilePath, datasetFileRelativePath, insertDataset } from '../../lib/dataset-file.js';
import { organismDatasetProps, projectFileRelativePath, DATASETS_DIR } from '../../lib/project-organisms.js';
import { readClassProps } from '../../lib/dataset-classes.js';
import { ORGANISM_RECORD_SCHEMA_VERSION } from './amendment.js';

/** Datasets a new organism file holds before its entries, in this order; referenceOnly ones for a reference strain only. */
export const ORGANISM_FILE_BOILERPLATE = [
  {
    datasetClass: 'validateOrganismInfo',
    props: {
      projectName: '$$projectName$$', organismAbbrev: '$$organismAbbrev$$', strainAbbrev: '$$strainAbbrev$$', ncbiTaxonId: '$$ncbiTaxonId$$',
      speciesNcbiTaxonId: '$$speciesNcbiTaxonId$$', genomeVersion: '$$genomeVersion$$'
    }
  },
  { datasetClass: 'ECAssocFromUniprot', props: { speciesNcbiTaxonId: '$$speciesNcbiTaxonId$$', organismAbbrev: '$$organismAbbrev$$', version: 'TODAY' } },
  { datasetClass: 'referenceStrain-dbEST', referenceOnly: true, props: { projectName: '$$projectName$$', organismAbbrev: '$$organismAbbrev$$', speciesNcbiTaxonId: '$$speciesNcbiTaxonId$$' } },
  { datasetClass: 'transcriptsFromReferenceStrain', props: { referenceStrainOrganismAbbrev: '$$referenceStrainOrganismAbbrev$$' } }
];

const constantLine = (name, value) => `  <constant name="${escapeXml(name)}" value="${escapeXml(value)}"/>`;
const datasetBlock = (datasetClass, props) =>
  `  <dataset class="${escapeXml(datasetClass)}">\n${Object.entries(props).map(([k, v]) => `    <prop name="${escapeXml(k)}">${escapeXml(v)}</prop>`).join('\n')}\n  </dataset>`;

/** Inserts block after a project file's last top-level <constant>, one blank line either side. */
export function insertAfterConstants(content, block) {
  const nl = content.includes('\r\n') ? '\r\n' : '\n';
  const firstDataset = content.search(/<dataset\b/);
  const head = firstDataset === -1 ? content : content.slice(0, firstDataset);
  const last = [...head.matchAll(/<constant\b[^>]*\/>[^\S\r\n]*(?:\r?\n)?/g)].at(-1);
  if (!last) throw new Error('The project file has no top-level <constant> to place the organism after');
  const at = last.index + last[0].length;
  return `${content.slice(0, at)}${nl}${block.replace(/\r?\n/g, nl)}${nl}${content.slice(at)}`;
}

const readProjectFiles = (repoPath) => readdirSync(join(repoPath, DATASETS_DIR)).filter((n) => n.endsWith('.xml'))
  .map((n) => ({ relFile: `${DATASETS_DIR}/${n}`, xml: readFileSync(join(repoPath, DATASETS_DIR, n), 'utf-8') }));

function propsInOrder(classProps, values, className) {
  const missing = classProps.filter((p) => typeof values[p] !== 'string');
  if (missing.length) throw new Error(`curated/organism.json has no ${missing.join(', ')} for the ${className} dataset; run amend-proposal.js`);
  return Object.fromEntries(classProps.map((p) => [p, values[p]]));
}

const AMEND = 'run amend-proposal.js';

/** What stops a new organism loading, from the record and every project file's contents ([{ relFile, xml }]), wherever they are read from. */
export function newOrganismProblems({ proposalDir, manifest, organism, projectFiles }) {
  const record = readCuratedJson(proposalDir, ORGANISM_RECORD_FILENAME);
  if (record.schemaVersion !== ORGANISM_RECORD_SCHEMA_VERSION) {
    return [`curated/organism.json of ${manifest.accession} has no preprocessing props (schema version ${record.schemaVersion}); verify it with verify-genome first`];
  }
  const projectRel = projectFileRelativePath(projectOf(manifest, organism));
  const own = projectFiles.find((f) => f.relFile === projectRel);
  if (!own) return [`Project file missing: ${projectRel}`];
  const missing = AMENDED_ORGANISM_KEYS.filter((k) => typeof record[k] !== 'string');
  if (missing.length) return [`curated/organism.json has no ${missing.join(', ')}; ${AMEND}`];
  const problems = [];
  const constants = constantsOf(proposalDir);
  for (const k of ['genomeSource', 'genomeVersion']) {
    if (constants[k] !== record[k]) problems.push(`constant ${k} is "${constants[k] ?? ''}" but the organism record says "${record[k]}"; ${AMEND}`);
  }
  if (record.isFamilyRepresentative !== 'true' && !record.familyRepOrganismAbbrev) {
    problems.push(`${organism} does not represent its family, so familyRepOrganismAbbrev may not be empty; ${AMEND}`);
  }
  const all = projectFiles.flatMap((f) => organismDatasetProps(f.xml).map((p) => ({ ...p, relFile: f.relFile })));
  const holder = all.find((p) => p.organismAbbrev === organism);
  if (holder) problems.push(`${organism} is already an organism in ${holder.relFile}; it may already be loaded; ask before continuing`);
  if (record.isReferenceStrain === 'true') {
    const rival = all.find((p) => p.speciesNcbiTaxonId === record.speciesNcbiTaxonId && p.isReferenceStrain === 'true');
    if (rival) problems.push(`${organism} would be a second reference strain of species ${record.speciesNcbiTaxonId}: ${rival.organismAbbrev} already is one in ${rival.relFile}; amend isReferenceStrain`);
  } else {
    const reference = organismDatasetProps(own.xml).find((p) => p.organismAbbrev === record.referenceStrainOrganismAbbrev);
    if (!reference) problems.push(`${organism}'s reference strain ${record.referenceStrainOrganismAbbrev} is not an organism in ${projectRel}; load the reference strain first, or amend the organism record`);
    else if (reference.isReferenceStrain !== 'true') problems.push(`${organism}'s reference strain ${reference.organismAbbrev} is not a reference strain in ${projectRel}; amend the organism record`);
  }
  const twin = all.find((p) => p.orthomclAbbrev === record.orthomclAbbrev);
  if (twin) {
    problems.push(`orthomclAbbrev ${record.orthomclAbbrev} is already used by ${twin.organismAbbrev} in ${twin.relFile}; choose another with amend-proposal.js --organism orthomclAbbrev=<abbrev> and publish`);
  }
  return problems;
}

/**
 * Load, for a genome's new organism: { organismFile, projectFile: { relFile, content, organism } }, the organism file before
 * its entries and the project file with the organism dataset (and referenceStrain). Refuses what newOrganismProblems names.
 */
export function newOrganismFiles({ proposalDir, manifest, organism, repoPath }) {
  const project = projectOf(manifest, organism);
  if (existsSync(datasetFilePath(repoPath, project, organism))) {
    throw new Error(`${datasetFileRelativePath(project, organism)} already exists; ${organism} is new in ${manifest.accession}, so it may already be loaded; ask before continuing`);
  }
  const projectFiles = readProjectFiles(repoPath);
  const problems = newOrganismProblems({ proposalDir, manifest, organism, projectFiles });
  if (problems.length) throw new Error(problems.join('\n'));
  const record = readCuratedJson(proposalDir, ORGANISM_RECORD_FILENAME);
  const projectRel = projectFileRelativePath(project);
  const projectXml = projectFiles.find((f) => f.relFile === projectRel).xml;

  const entry = manifest.organisms.find((o) => (o.organismAbbrev ?? o.proposedOrganismAbbrev) === organism);
  const isReference = record.isReferenceStrain === 'true';
  const referenceStrain = isReference ? organism : record.referenceStrainOrganismAbbrev;
  const familyRep = record.isFamilyRepresentative === 'true' ? organism : record.familyRepOrganismAbbrev;
  const strings = Object.fromEntries(Object.entries(record).filter(([, v]) => typeof v === 'string'));
  const values = {
    ...strings, organismAbbrev: organism, projectName: '$$projectName$$', publicOrganismAbbrev: organism, ncbiTaxonId: entry.ncbiTaxonId,
    referenceStrainOrganismAbbrev: referenceStrain, familyRepOrganismAbbrev: familyRep
  };
  const blocks = [
    datasetBlock('organism', propsInOrder(readClassProps(repoPath, 'organism'), values, 'organism')),
    ...(isReference ? [datasetBlock('referenceStrain', propsInOrder(readClassProps(repoPath, 'referenceStrain'), values, 'referenceStrain'))] : [])
  ].join('\n\n');
  // classes.xml: reference strains must precede other strains in the project file.
  const content = isReference ? insertAfterConstants(projectXml, blocks) : insertDataset(projectXml, blocks);

  const base = {
    organismAbbrev: organism, strainAbbrev: record.strainAbbrev, referenceStrainOrganismAbbrev: referenceStrain, familyRepOrganismAbbrev: familyRep,
    projectName: project, ncbiTaxonId: entry.ncbiTaxonId, speciesNcbiTaxonId: record.speciesNcbiTaxonId
  };
  const constants = { ...base, ...Object.fromEntries(Object.entries(constantsOf(proposalDir)).filter(([k]) => !Object.hasOwn(base, k))) };
  const boilerplate = ORGANISM_FILE_BOILERPLATE.filter((b) => isReference || !b.referenceOnly).map((b) => datasetBlock(b.datasetClass, b.props));
  const organismFile = ['<?xml version="1.0"?>', '<datasets>', ...Object.entries(constants).map(([k, v]) => constantLine(k, v)), '', boilerplate.join('\n\n'), '</datasets>', ''].join('\n');
  return { organismFile, projectFile: { relFile: projectRel, content, organism } };
}
