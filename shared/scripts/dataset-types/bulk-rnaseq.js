import {
  loadManifest, readInputJson, findInputBySuffix, readPresenter, applyOverrides, requireIdentity, PRESENTER_SCHEMA_VERSION,
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

export const datasetClass = 'rnaSeqExperiment';

/** Graph titles and attributions need these; a presenter without them is not ready to load. */
export const requiredFields = ['shortDisplayName', 'shortAttribution'];

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

/** The GEO series release date; the platform in the same MINiML has its own. */
function seriesReleaseDate(miniml) {
  const series = miniml?.match(/<Series\b[^>]*>([\s\S]*?)<\/Series>/)?.[1];
  return series?.match(/<Release-Date>\s*(\d{4}-\d{2}-\d{2})\s*<\/Release-Date>/)?.[1];
}

/** Surname as a name token: last word, diacritics dropped, letters and digits only. */
function surnameToken(fullName) {
  const last = (fullName || '').trim().split(/\s+/).pop() || '';
  return last.normalize('NFD').replace(/[^A-Za-z0-9]/g, '');
}

/**
 * Phase 1: default name and version. Either may be undefined, in which case
 * the curator must supply it.
 */
export function deriveIdentity(stagedDir, { primaryContactName } = {}) {
  const version = seriesReleaseDate(findInputBySuffix(stagedDir, '_family.xml'));
  const surname = surnameToken(primaryContactName);
  return { version, name: surname && version ? `${surname}_${version.slice(0, 4)}` : undefined };
}

/** Matches the datasetName of the rnaSeqExperiment datasetLoader in classes.xml. */
const nameFor = (m) => `${m.organismAbbrev}_${m.name}_rnaSeq_RSRC`;

/** Phase 1: the presenter record from the proposal's inputs plus curator overrides. */
export function derivePresenter(proposalDir, overrides = {}) {
  const m = loadManifest(proposalDir);
  requireIdentity(m, datasetClass);
  const sra = readInputJson(proposalDir, `${m.accession}_sra_metadata.json`);
  const miniml = findInputBySuffix(proposalDir, '_family.xml');
  const runs = sra.runs || [];
  const organismName = organismFromRuns(runs, m.accession);
  const multiple = new Set(runs.map(r => r.sample_accession)).size > 1 ? 'true' : 'false';

  return applyOverrides({
    schemaVersion: PRESENTER_SCHEMA_VERSION,
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
  const m = loadManifest(proposalDir);
  requireIdentity(m, datasetClass);
  return nameFor(m);
}

/** Phase 2: XML from the manifest and the presenter record only. */
export function renderPresenter(proposalDir) {
  const m = loadManifest(proposalDir);
  requireIdentity(m, datasetClass);
  const p = readPresenter(proposalDir, { requiredFields });
  const contacts = contactElements(m.contacts.additional);
  const pubmeds = pubmedElements(p.pubmedIds);

  return `  <datasetPresenter name="${escapeXml(nameFor(m))}"
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
