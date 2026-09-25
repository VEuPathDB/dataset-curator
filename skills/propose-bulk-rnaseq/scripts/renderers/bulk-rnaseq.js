import {
  loadManifest, readInputJson, findInputBySuffix, readPresenter, applyOverrides, PRESENTER_SCHEMA_VERSION,
  escapeForCDATA, escapeXml, contactElements, pubmedElements, linkElements, injectorProps
} from './_common.js';

export const injectorDefaults = {
  switchStrandsGBrowse: 'false',
  switchStrandsProfiles: 'false',
  graphForceXLabelsHorizontal: 'false',
  hasFishersExactTestData: 'false',
  isEuPathDBSite: 'true',
  jbrowseTracksOnly: 'false',
  graphType: 'bar',
  graphColor: '#336699',
  graphBottomMarginSize: '50',
  graphSampleLabels: '',
  showIntronJunctions: 'true',
  includeInUnifiedJunctions: '',
  isAlignedToAnnotatedGenome: 'true',
  hasMultipleSamples: 'false',
  graphXAxisSamplesDescription: '',
  graphPriorityOrderGrouping: '1000',
  optionalQuestionDescription: '',
  isDESeq: 'false',
  isDEGseq: 'false',
  includeProfileSimilarity: 'false',
  profileTimeShift: ''
};

/** Graph titles and attributions need these; a presenter without them is not ready to load. */
export const requiredFields = ['shortDisplayName', 'shortAttribution'];

/** First letter of genus plus first three of species, matching existing presenter names. */
function shortOrganismAbbrev(organismName) {
  const [genus = '', species = ''] = organismName.trim().split(/\s+/);
  return genus.charAt(0).toLowerCase() + species.substring(0, 3).toLowerCase();
}

function organismFromRuns(runs, accession) {
  const name = [...new Set(runs.map(r => r.scientific_name).filter(Boolean))][0];
  if (!name) throw new Error(`No scientific_name in any run of ${accession}`);
  return name;
}

/** GEO MINiML summary text is kept as-is: its own XML/HTML entities pass through intentionally. */
function descriptionFrom(sra, miniml) {
  const summary = miniml?.match(/<Summary[^>]*>([\s\S]*?)<\/Summary>/i);
  if (summary) return summary[1].trim();
  const titles = [...new Set(sra.runs.map(r => r.experiment_title).filter(Boolean))];
  return titles[0] || '';
}

function methodologyFrom(runs) {
  const uniq = (key) => [...new Set(runs.map(r => r[key]).filter(Boolean))];
  const parts = [];
  const strategies = uniq('library_strategy'); if (strategies.length) parts.push(`Library strategy: ${strategies.join(', ')}`);
  const layouts = uniq('library_layout'); if (layouts.length) parts.push(`Layout: ${layouts.join(', ')}`);
  const instruments = uniq('instrument_model'); if (instruments.length) parts.push(`Sequencing: ${instruments.join(', ')}`);
  return parts.join('. ');
}

/** Phase 1: the presenter record from the proposal's inputs plus curator overrides. */
export function derive(proposalDir, overrides = {}) {
  const m = loadManifest(proposalDir);
  const sra = readInputJson(proposalDir, `${m.accession}_sra_metadata.json`);
  const miniml = findInputBySuffix(proposalDir, '_family.xml');
  const runs = sra.runs || [];
  const organismName = organismFromRuns(runs, m.accession);
  const multiple = new Set(runs.map(r => r.sample_accession)).size > 1 ? 'true' : 'false';

  return applyOverrides({
    schemaVersion: PRESENTER_SCHEMA_VERSION,
    name: `${shortOrganismAbbrev(organismName)}_${m.accession}_rnaSeq_RSRC`,
    displayName: `RNA-Seq analysis of <i>${organismName}</i>`,
    shortDisplayName: '',
    shortAttribution: '',
    summary: `RNA-Seq analysis of <i>${organismName}</i>`,
    description: descriptionFrom(sra, miniml),
    methodology: methodologyFrom(runs),
    protocol: '', caveat: '', acknowledgement: '', releasePolicy: '',
    pubmedIds: [],
    links: [{ text: 'NCBI Bioproject', url: `https://www.ncbi.nlm.nih.gov/bioproject/${m.accession}` }],
    history: {},
    injectorProps: { hasMultipleSamples: multiple, isDESeq: multiple }
  }, overrides);
}

export function presenterName(proposalDir) {
  return readPresenter(proposalDir, { requiredFields }).name;
}

/** Phase 2: XML from the manifest and the presenter record only. */
export function render(proposalDir) {
  const m = loadManifest(proposalDir);
  const p = readPresenter(proposalDir, { requiredFields });
  const contacts = contactElements(m.contacts.additional);
  const pubmeds = pubmedElements(p.pubmedIds);

  return `  <datasetPresenter name="${escapeXml(p.name)}"
                    projectName="${m.project}">
    <displayName><![CDATA[${escapeForCDATA(p.displayName)}]]></displayName>
    <shortDisplayName>${escapeXml(p.shortDisplayName)}</shortDisplayName>
    <shortAttribution>${escapeXml(p.shortAttribution)}</shortAttribution>
    <summary><![CDATA[${escapeForCDATA(p.summary)}]]></summary>
    <description><![CDATA[

<b>General Description:</b> ${escapeForCDATA(p.description)}
<br><br><b>Methodology used:</b> ${escapeForCDATA(p.methodology)}

                  ]]></description>
    <protocol>${escapeXml(p.protocol)}</protocol>
    <caveat>${escapeXml(p.caveat)}</caveat>
    <acknowledgement>${escapeXml(p.acknowledgement)}</acknowledgement>
    <releasePolicy>${escapeXml(p.releasePolicy)}</releasePolicy>
    <history buildNumber="${m.targetBuild}"/>
    <primaryContactId>${escapeXml(m.contacts.primary)}</primaryContactId>
${contacts ? contacts + '\n' : ''}${linkElements(p.links)}
${pubmeds ? pubmeds + '\n' : ''}    <templateInjector className="org.apidb.apicommon.model.datasetInjector.RNASeq">
${injectorProps(injectorDefaults, p.injectorProps)}
    </templateInjector>
  </datasetPresenter>`;
}
