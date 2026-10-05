import { join, basename } from 'node:path';
import { organismsOf } from '../lib/manifest.js';
import {
  loadManifest, parseJson, readInputJson, readPresenter, applyOverrides, PRESENTER_SCHEMA_VERSION,
  escapeForCDATA, escapeXml, contactElements, pubmedElements, linkElements, injectorProps, requireBuild
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

  return applyOverrides({
    schemaVersion: PRESENTER_SCHEMA_VERSION,
    displayName: 'Genome Sequence and Annotation',
    shortDisplayName: '',
    shortAttribution: '',
    summary: `Genome Sequence and Annotation of ${organismForSummary}`,
    description: bioProject?.description ?? bioProject?.title
      ?? report.assembly_info?.bioproject_lineage?.[0]?.bioprojects?.[0]?.title ?? '',
    methodology: methodologyFrom(report),
    protocol: '', caveat: '', acknowledgement: '', releasePolicy: '',
    pubmedIds: pubmed?.papers?.map(p => String(p.pmid)) || [],
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

/** Phase 2: XML from the manifest and the presenter record only; one organism, so organism is ignored. */
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
${pubmeds ? pubmeds + '\n' : ''}    <templateInjector projectName="${m.project}" className="org.apidb.apicommon.model.datasetInjector.AnnotatedGenome">
${injectorProps(injectorDefaults, p.injectorProps)}
    </templateInjector>
  </datasetPresenter>`;
}
