import { existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { organismsOf, homeProject } from '../lib/manifest.js';
import { strainAbbrevOf } from '../lib/organisms.js';
import { referenceStrainFor, familyRepFor } from '../lib/project-organisms.js';
import {
  loadManifest, parseJson, readInputJson, readCuratedJson, readPresenter, applyOverrides, PRESENTER_SCHEMA_VERSION,
  escapeForCDATA, escapeXml, contactElements, pubmedElements, linkElements, injectorProps, requireBuild, ORGANISM_RECORD_KEYS
} from './_common.js';

export const injectorDefaults = {
  isEuPathDBSite: 'true',
  optionalSpecies: '',
  specialLinkDisplayText: '',
  updatedAnnotationText: '',
  isCurated: 'false',
  specialLinkExternalDbName: '',
  showReferenceTranscriptomics: 'false'
};

export const requiredFields = [];

export const organismRule = { new: true, max: 1 };

/** The curator's strain, else the report's strain, else its isolate (with a warning), else none. */
function strainFrom(overrides, names, warn) {
  if (overrides.strain !== undefined) return overrides.strain;
  if (names?.strain !== undefined) return names.strain;
  if (names?.isolate === undefined) return '';
  warn(`Warning: the assembly report has no strain; using isolate "${names.isolate}" as the strain. Set "organism": { "strain": ... } in --overrides to change it.`);
  return names.isolate;
}

/** Phase 1: species, strain and NCBI taxon id from the assembly report, curator overrides winning. */
export function deriveOrganism(inputs, accession, overrides = {}, warn = () => {}) {
  const reportFile = inputs.find((f) => basename(f) === `${accession}_dataset_report.json`);
  const organism = reportFile ? parseJson(reportFile).reports?.[0]?.organism : undefined;
  const rawTaxId = overrides.ncbiTaxonId ?? organism?.tax_id;
  const taxId = rawTaxId === undefined ? undefined : String(rawTaxId);
  return {
    species: overrides.species ?? (organism?.organism_name ?? '').trim().split(/\s+/).slice(0, 2).join(' '),
    strain: strainFrom(overrides, organism?.infraspecific_names, warn),
    ...(taxId === undefined ? {} : { ncbiTaxonId: taxId })
  };
}

export const ORGANISM_RECORD_FILENAME = 'organism.json';
export const ORGANISM_RECORD_SCHEMA_VERSION = 1;
const BOOLEAN_RECORD_KEYS = ['hasTemporaryNcbiTaxonId', 'isAnnotatedGenome', 'isReferenceStrain'];

function readTaxonomy(proposalDir, taxId) {
  const taxonomy = readInputJson(proposalDir, `${taxId}_taxonomy.json`, { optional: true })?.reports?.[0]?.taxonomy;
  if (!taxonomy) throw new Error(`No taxonomy for taxon ${taxId}: run node scripts/fetch-taxonomy.js ${taxId} and pass .curation/tmp/${taxId}_taxonomy.json as an --input`);
  return taxonomy;
}

function familyRepFrom(projectOrganisms, lineage, { taxId, project, checkedAgainst }, warn) {
  const rep = familyRepFor(projectOrganisms, lineage);
  if (rep.ambiguous) {
    warn(`Warning: ${rep.ambiguous.join(' and ')} both represent taxon ${rep.taxonId} in ${project} on ${checkedAgainst}; set "organism": { "familyRepOrganismAbbrev": ... } in --overrides, or leave it for Phase 2`);
  } else if (!rep.abbrev) {
    warn(`Warning: no family representative in ${project} on ${checkedAgainst} lists a taxon of ${taxId}'s lineage; set "organism": { "familyRepOrganismAbbrev": ... } in --overrides, or leave it for Phase 2`);
  }
  return rep.abbrev ?? '';
}

function assertValidRecord(r) {
  for (const k of BOOLEAN_RECORD_KEYS) {
    if (r[k] !== 'true' && r[k] !== 'false') throw new Error(`organism record: ${k} must be "true" or "false", got "${r[k]}"`);
  }
  if (r.isReferenceStrain === 'false' && !r.referenceStrainOrganismAbbrev) {
    throw new Error('organism record: isReferenceStrain "false" needs referenceStrainOrganismAbbrev, the species\' reference strain');
  }
}

/**
 * Phase 1: the organism facts Phase 2 renders the organism dataset and file
 * from. Nothing derived from the abbreviation is stored, since Phase 2 settles
 * it; reference strain and family representative are as of checkedAgainst.
 */
export function deriveOrganismRecord(proposalDir, { projectOrganisms, claims, checkedAgainst }, overrides = {}, warn = () => {}) {
  const m = loadManifest(proposalDir);
  const o = m.organisms.find((x) => x.source === 'new');
  const report = readInputJson(proposalDir, `${m.accession}_dataset_report.json`).reports?.[0] ?? {};
  const taxonomy = readTaxonomy(proposalDir, o.ncbiTaxonId);
  const taxId = String(taxonomy.tax_id);
  const speciesTaxId = String(taxonomy.classification?.species?.id ?? taxId);
  const isTemporary = Boolean(o.strain) && taxId === speciesTaxId;
  const [genus, epithet] = o.species.split(/\s+/);
  const strainAbbrev = strainAbbrevOf(o.strain ?? '');
  const reference = referenceStrainFor(projectOrganisms, speciesTaxId);
  const project = homeProject(m);
  const lineage = [taxId, ...[...(taxonomy.parents ?? [])].reverse().map(String)];

  for (const c of claims) {
    if (c.accession !== m.accession && c.project === project && c.organism?.species === o.species && !reference) {
      warn(`Warning: genome proposal ${c.accession} (${c.organism.proposedOrganismAbbrev}) is also ${o.species} in ${project}; whichever loads first is the reference strain, and Phase 2 rechecks`);
    }
  }

  const chosen = Object.fromEntries(Object.entries(overrides).filter(([k]) => ORGANISM_RECORD_KEYS.includes(k)));
  const record = {
    schemaVersion: ORGANISM_RECORD_SCHEMA_VERSION,
    checkedAgainst,
    organismFullName: isTemporary ? `${o.species} ${o.strain}` : taxonomy.current_scientific_name?.name ?? `${o.species} ${o.strain}`.trim(),
    organismNameForFiles: `${genus[0].toUpperCase()}${epithet}${strainAbbrev}`,
    strainAbbrev,
    speciesNcbiTaxonId: speciesTaxId,
    hasTemporaryNcbiTaxonId: String(isTemporary),
    genomeSource: (report.source_database ?? '').includes('REFSEQ') ? 'RefSeq' : 'GenBank',
    genomeVersion: report.assembly_info?.release_date ?? '',
    isAnnotatedGenome: String(Boolean(report.annotation_info)),
    taxonFilterForNRProteinsAlignedToGenome: genus,
    isReferenceStrain: String(!reference),
    ...(reference ? { referenceStrainOrganismAbbrev: reference } : {}),
    familyRepOrganismAbbrev: 'familyRepOrganismAbbrev' in chosen ? '' : familyRepFrom(projectOrganisms, lineage, { taxId, project, checkedAgainst }, warn),
    ...chosen
  };
  assertValidRecord(record);
  return record;
}

/**
 * Publish: which typeLabels entry labels the ticket, from the organism record,
 * or from the assembly report for a proposal written before it existed.
 */
export function ticketLabelVariant(proposalDir) {
  const annotated = existsSync(join(proposalDir, 'curated', ORGANISM_RECORD_FILENAME))
    ? readCuratedJson(proposalDir, ORGANISM_RECORD_FILENAME).isAnnotatedGenome === 'true'
    : Boolean(readInputJson(proposalDir, `${loadManifest(proposalDir).accession}_dataset_report.json`).reports?.[0]?.annotation_info);
  return annotated ? 'annotated' : 'unannotated';
}

function formatDate(isoDate) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const [year, month, day] = isoDate.split('-');
  return `${months[parseInt(month, 10) - 1]} ${parseInt(day, 10)}, ${year}`;
}

function methodologyFrom(report) {
  const parts = [];
  if (report.wgs_info?.wgs_project_accession) parts.push(`WGS Project: ${report.wgs_info.wgs_project_accession}`);
  if (report.assembly_info?.assembly_method) parts.push(`Assembly method: ${report.assembly_info.assembly_method}`);
  if (report.assembly_stats?.genome_coverage) parts.push(`Genome coverage: ${report.assembly_stats.genome_coverage}x`);
  if (report.assembly_info?.sequencing_tech) parts.push(`Sequencing technology: ${report.assembly_info.sequencing_tech}`);
  return parts.join('. ');
}

const yearOf = (date) => String(date ?? '').match(/\d{4}/)?.[0] ?? '';

/** PubMed lists authors as "Surname Initials"; the initials are the last word. */
const surnameOf = (name) => name.trim().replace(/\s+[A-Z]{1,4}$/, '');

function paperAttribution(paper) {
  const authors = (paper?.authors ?? []).filter((a) => a.authtype === 'Author' && a.name);
  const year = yearOf(paper?.pubdate);
  if (!authors.length || !year) return '';
  return `${surnameOf(authors[0].name)}${authors.length > 1 ? ' et al.' : ''} ${year}`;
}

/** The first listed paper's authors, else the submitter and release year. */
function shortAttributionFrom(papers, pubmedIds, report) {
  const first = papers.find((p) => String(p.pmid) === pubmedIds[0]);
  const fromPaper = paperAttribution(first);
  if (fromPaper) return fromPaper;
  const submitter = report.assembly_info?.submitter;
  const year = yearOf(report.assembly_info?.release_date);
  return submitter && year ? `${submitter}, ${year}` : '';
}

/** Phase 1: the presenter record from the proposal's inputs plus curator overrides. */
export function derivePresenter(proposalDir, overrides = {}) {
  const m = loadManifest(proposalDir);
  const reportFilename = `${m.accession}_dataset_report.json`;
  const report = readInputJson(proposalDir, reportFilename).reports?.[0];
  if (!report) throw new Error(`${join(proposalDir, 'inputs', reportFilename)} has no reports[0]`);
  const bioProjectAccession = report.assembly_info?.bioproject_accession;
  if (!bioProjectAccession) throw new Error('BioProject accession not found in assembly report');
  if (!/^[A-Za-z0-9_.]+$/.test(bioProjectAccession)) {
    throw new Error(`Invalid bioproject_accession "${bioProjectAccession}" in assembly report`);
  }

  const bioProject = readInputJson(proposalDir, `${bioProjectAccession}_bioproject.json`, { optional: true });
  const pubmed = readInputJson(proposalDir, `${m.accession}_pubmed.json`, { optional: true });

  const organismName = report.organism?.organism_name || '';
  const strain = report.organism?.infraspecific_names?.strain || '';
  const organismForSummary = strain ? `<i>${organismName}</i> ${strain}` : `<i>${organismName}</i>`;
  const isRefSeq = (report.source_database || '').includes('REFSEQ');
  const annotationDate = report.annotation_info?.release_date || report.assembly_info?.release_date || '';
  const papers = pubmed?.papers ?? [];
  const pubmedIds = papers.map((p) => String(p.pmid));

  return applyOverrides({
    schemaVersion: PRESENTER_SCHEMA_VERSION,
    displayName: 'Genome Sequence and Annotation',
    shortDisplayName: organismsOf(m)[0],
    shortAttribution: shortAttributionFrom(papers, (Array.isArray(overrides.pubmedIds) ? overrides.pubmedIds : pubmedIds).map(String), report),
    summary: `Genome Sequence and Annotation of ${organismForSummary}`,
    description: bioProject?.description ?? bioProject?.title
      ?? report.assembly_info?.bioproject_lineage?.[0]?.bioprojects?.[0]?.title ?? '',
    methodology: methodologyFrom(report),
    protocol: '', caveat: '', acknowledgement: '', releasePolicy: '',
    pubmedIds,
    links: [
      { text: 'NCBI Bioproject', url: `https://www.ncbi.nlm.nih.gov/bioproject/${bioProjectAccession}` },
      { text: 'GenBank Assembly', url: `https://www.ncbi.nlm.nih.gov/assembly/${m.accession}` }
    ],
    history: {
      genomeSource: 'INSDC',
      genomeVersion: m.accession,
      annotationSource: isRefSeq ? 'RefSeq' : 'GenBank',
      annotationVersion: annotationDate ? formatDate(annotationDate) : ''
    },
    injectorProps: {}
  }, overrides);
}

const nameFor = (m) => `${organismsOf(m)[0]}_primary_genome_RSRC`;

export function presenterNames(proposalDir) {
  return [nameFor(loadManifest(proposalDir))];
}

/** Phase 2: XML from the manifest and the presenter record only. */
export function renderPresenter(proposalDir, { build } = {}) {
  requireBuild(build);
  const m = loadManifest(proposalDir);
  const p = readPresenter(proposalDir, { requiredFields });
  const h = p.history;
  const contacts = contactElements(m.contacts.additional);
  const pubmeds = pubmedElements(p.pubmedIds);

  return `  <datasetPresenter name="${escapeXml(nameFor(m))}"
                    >
    <displayName><![CDATA[${escapeForCDATA(p.displayName)}]]></displayName>
    <shortDisplayName>${escapeXml(p.shortDisplayName)}</shortDisplayName>
    <shortAttribution>${escapeXml(p.shortAttribution)}</shortAttribution>
    <summary><![CDATA[${escapeForCDATA(p.summary)}
                  ]]></summary>
    <description><![CDATA[

<b>General Description:</b> ${escapeForCDATA(p.description)}
<br><br><b>Methodology used:</b> ${escapeForCDATA(p.methodology)}

                  ]]></description>
    <protocol>${escapeXml(p.protocol)}</protocol>
    <caveat>${escapeXml(p.caveat)}</caveat>
    <acknowledgement>${escapeXml(p.acknowledgement)}</acknowledgement>
    <releasePolicy>${escapeXml(p.releasePolicy)}</releasePolicy>
    <history buildNumber="${escapeXml(build)}"
             genomeSource="${escapeXml(h.genomeSource ?? '')}" genomeVersion="${escapeXml(h.genomeVersion ?? '')}"
             annotationSource="${escapeXml(h.annotationSource ?? '')}" annotationVersion="${escapeXml(h.annotationVersion ?? '')}"/>
    <primaryContactId>${escapeXml(m.contacts.primary)}</primaryContactId>
${contacts ? contacts + '\n' : ''}${linkElements(p.links)}
${pubmeds ? pubmeds + '\n' : ''}    <templateInjector projectName="${homeProject(m)}" className="org.apidb.apicommon.model.datasetInjector.AnnotatedGenome">
${injectorProps(injectorDefaults, p.injectorProps)}
    </templateInjector>
  </datasetPresenter>`;
}
