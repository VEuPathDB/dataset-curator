import {
  loadManifest, readInputJson, findInputBySuffix, loadOverrides, escapeForCDATA, escapeXml, contactElements, pubmedElements, injectorProps
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

/** GEO MINiML summary text is inserted inside CDATA as-is: its own XML/HTML entities pass through intentionally. */
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

function nameFor(m, runs) {
  return `${shortOrganismAbbrev(organismFromRuns(runs, m.accession))}_${m.accession}_rnaSeq_RSRC`;
}

export function presenterName(proposalDir) {
  const m = loadManifest(proposalDir);
  const sra = readInputJson(proposalDir, `${m.accession}_sra_metadata.json`);
  return nameFor(m, sra.runs || []);
}

export function render(proposalDir) {
  const m = loadManifest(proposalDir);
  const o = loadOverrides(proposalDir);
  const sra = readInputJson(proposalDir, `${m.accession}_sra_metadata.json`);
  const miniml = findInputBySuffix(proposalDir, '_family.xml');

  const runs = sra.runs || [];
  const organismName = organismFromRuns(runs, m.accession);
  const organismDisplay = `<i>${organismName}</i>`;
  const sampleCount = new Set(runs.map(r => r.sample_accession)).size;
  const hasMultipleSamples = sampleCount > 1 ? 'true' : 'false';

  const description = o.description ?? descriptionFrom(sra, miniml);
  const methodology = o.methodology ?? methodologyFrom(runs);
  const pubmedIds = o.pubmedIds ?? [];
  const contacts = contactElements(m.contacts.additional);
  const pubmeds = pubmedElements(pubmedIds);

  return `  <datasetPresenter name="${nameFor(m, runs)}"
                    projectName="${m.project}">
    <displayName><![CDATA[${escapeForCDATA(o.displayName ?? `RNA-Seq analysis of ${organismDisplay}`)}]]></displayName>
    <shortDisplayName>${escapeXml(o.shortDisplayName ?? '')}</shortDisplayName>
    <shortAttribution>${escapeXml(o.shortAttribution ?? '')}</shortAttribution>
    <summary><![CDATA[${escapeForCDATA(o.summary ?? `RNA-Seq analysis of ${organismDisplay}`)}]]></summary>
    <description><![CDATA[

<b>General Description:</b> ${escapeForCDATA(description)}
<br><br><b>Methodology used:</b> ${escapeForCDATA(methodology)}

                  ]]></description>
    <protocol></protocol>
    <caveat></caveat>
    <acknowledgement></acknowledgement>
    <releasePolicy></releasePolicy>
    <history buildNumber="${m.targetBuild}"/>
    <primaryContactId>${escapeXml(m.contacts.primary)}</primaryContactId>
${contacts ? contacts + '\n' : ''}    <link>
      <text>NCBI Bioproject</text>
      <url>https://www.ncbi.nlm.nih.gov/bioproject/${m.accession}</url>
    </link>
${pubmeds ? pubmeds + '\n' : ''}    <templateInjector className="org.apidb.apicommon.model.datasetInjector.RNASeq">
${injectorProps({ ...injectorDefaults, hasMultipleSamples, isDESeq: hasMultipleSamples }, o.injectorProps)}
    </templateInjector>
  </datasetPresenter>`;
}
