import { join } from 'node:path';
import {
  loadManifest, readInputJson, loadOverrides, escapeForCDATA, escapeXml, contactElements, pubmedElements, injectorProps
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

export function presenterName(proposalDir) {
  return `${loadManifest(proposalDir).organismAbbrev}_primary_genome_RSRC`;
}

export function render(proposalDir) {
  const m = loadManifest(proposalDir);
  const o = loadOverrides(proposalDir);

  const reportFilename = `${m.accession}_dataset_report.json`;
  const reportData = readInputJson(proposalDir, reportFilename);
  const report = reportData.reports?.[0];
  if (!report) throw new Error(`${join(proposalDir, 'inputs', reportFilename)} has no reports[0]`);
  const bioProjectAccession = report.assembly_info?.bioproject_accession;
  if (!bioProjectAccession) throw new Error('BioProject accession not found in assembly report');

  const bioProject = readInputJson(proposalDir, `${bioProjectAccession}_bioproject.json`, { optional: true });
  const pubmed = readInputJson(proposalDir, `${m.accession}_pubmed.json`, { optional: true });

  const organismName = report.organism?.organism_name || '';
  const strain = report.organism?.infraspecific_names?.strain || '';
  const organismForSummary = strain ? `<i>${organismName}</i> ${strain}` : `<i>${organismName}</i>`;

  const isRefSeq = (report.source_database || '').includes('REFSEQ');
  const annotationDate = report.annotation_info?.release_date || report.assembly_info?.release_date || '';

  const description = o.description ?? bioProject?.description ?? bioProject?.title
    ?? report.assembly_info?.bioproject_lineage?.[0]?.bioprojects?.[0]?.title ?? '';
  const methodology = o.methodology ?? methodologyFrom(report);
  const pubmedIds = o.pubmedIds ?? (pubmed?.papers?.map(p => p.pmid) || []);
  const name = `${m.organismAbbrev}_primary_genome_RSRC`;

  const contacts = contactElements(m.contacts.additional);
  const pubmeds = pubmedElements(pubmedIds);

  return `  <datasetPresenter name="${name}"
                    >
    <displayName><![CDATA[${escapeForCDATA(o.displayName ?? 'Genome Sequence and Annotation')}]]></displayName>
    <shortDisplayName>${escapeXml(o.shortDisplayName ?? '')}</shortDisplayName>
    <shortAttribution>${escapeXml(o.shortAttribution ?? '')}</shortAttribution>
    <summary><![CDATA[${escapeForCDATA(o.summary ?? `Genome Sequence and Annotation of ${organismForSummary}`)}
                  ]]></summary>
    <description><![CDATA[

<b>General Description:</b> ${escapeForCDATA(description)}
<br><br><b>Methodology used:</b> ${escapeForCDATA(methodology)}

                  ]]></description>
    <protocol></protocol>
    <caveat></caveat>
    <acknowledgement></acknowledgement>
    <releasePolicy></releasePolicy>
    <history buildNumber="${m.targetBuild}"
             genomeSource="INSDC" genomeVersion="${m.accession}"
             annotationSource="${isRefSeq ? 'RefSeq' : 'GenBank'}" annotationVersion="${annotationDate ? formatDate(annotationDate) : ''}"/>
    <primaryContactId>${escapeXml(m.contacts.primary)}</primaryContactId>
${contacts ? contacts + '\n' : ''}    <link>
      <text>NCBI Bioproject</text>
      <url>https://www.ncbi.nlm.nih.gov/bioproject/${bioProjectAccession}</url>
    </link>
    <link>
      <text>GenBank Assembly</text>
      <url>https://www.ncbi.nlm.nih.gov/assembly/${m.accession}</url>
    </link>
${pubmeds ? pubmeds + '\n' : ''}    <templateInjector projectName="${m.project}" className="org.apidb.apicommon.model.datasetInjector.AnnotatedGenome">
${injectorProps(injectorDefaults, o.injectorProps)}
    </templateInjector>
  </datasetPresenter>`;
}
