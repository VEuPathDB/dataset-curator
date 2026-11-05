import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { read as readManifest, projectOf, organismsOf } from '../lib/manifest.js';
import { IDENTITY_PROPS } from '../lib/dataset-classes.js';
import { deliveryLocation, datasetNameOf } from '../lib/artifacts.js';

export const PRESENTER_FILENAME = 'presenter.json';
export const PRESENTER_SCHEMA_VERSION = 1;
export const DATASET_FILENAME = 'dataset.json';
export const DATASET_SCHEMA_VERSION = 1;
export const TEXT_FIELDS = [
  'displayName', 'shortDisplayName', 'shortAttribution', 'summary', 'description',
  'methodology', 'protocol', 'caveat', 'acknowledgement', 'releasePolicy'
];
export const PRESENTER_OVERRIDE_KEYS = [...TEXT_FIELDS, 'pubmedIds', 'injectorProps', 'organisms'];
const ALWAYS_REQUIRED = ['displayName', 'summary', 'description'];
const XML_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;
/** displayName is shown as plain text, so markup such as <i>…</i> would appear literally. */
const HTML_TAG = /<\/?[A-Za-z][^>]*>/;

/** Every caller validated the manifest strictly before rendering, so the settled copy a load renders from is accepted here. */
export function loadManifest(proposalDir) {
  return readManifest(proposalDir, { settled: true });
}

export function parseJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch (e) {
    throw new Error(`${path} is not valid JSON: ${e.message}`);
  }
}

export function readInputJson(proposalDir, filename, { optional = false } = {}) {
  const path = join(proposalDir, 'inputs', filename);
  if (!existsSync(path)) {
    if (optional) return null;
    throw new Error(`Required input missing: ${path}`);
  }
  return parseJson(path);
}

export function readCuratedJson(proposalDir, filename) {
  const path = join(proposalDir, 'curated', filename);
  if (!existsSync(path)) throw new Error(`Required curated file missing: ${path}`);
  return parseJson(path);
}

export function findInputBySuffix(proposalDir, suffix) {
  const dir = join(proposalDir, 'inputs');
  if (!existsSync(dir)) return null;
  const matches = readdirSync(dir).sort().filter(f => f.endsWith(suffix));
  if (matches.length > 1) throw new Error(`Multiple ${suffix} files in ${dir}: ${matches.join(', ')}`);
  return matches.length ? readFileSync(join(dir, matches[0]), 'utf-8') : null;
}

export const OVERRIDE_SECTIONS = ['name', 'version', 'presenter', 'dataset', 'organism', 'annotation', 'staging'];
const DATASET_OVERRIDE_KEYS = ['props', 'source'];
/** The curated organism record of a genome proposal; curators override these under "organism". */
export const ORGANISM_RECORD_KEYS = [
  'organismFullName', 'organismNameForFiles', 'strainAbbrev', 'speciesNcbiTaxonId', 'hasTemporaryNcbiTaxonId',
  'genomeSource', 'genomeVersion', 'isAnnotatedGenome', 'taxonFilterForNRProteinsAlignedToGenome',
  'isReferenceStrain', 'referenceStrainOrganismAbbrev', 'familyRepOrganismAbbrev'
];
const ORGANISM_OVERRIDE_KEYS = ['species', 'strain', 'ncbiTaxonId', ...ORGANISM_RECORD_KEYS];

const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

/**
 * Curator overrides: { name, version, presenter: {...}, dataset: { props, source }, organism: { species, strain, ncbiTaxonId },
 * annotation, staging }; the last two are checked by manifest validation.
 * An unknown key is a typo, not a no-op, so it is refused.
 */
export function readOverrides(path) {
  if (!path) return {};
  const o = parseJson(path);
  if (!isObject(o)) throw new Error(`${path} must be a JSON object`);
  const flat = Object.keys(o).filter(k => PRESENTER_OVERRIDE_KEYS.includes(k));
  if (flat.length) {
    throw new Error(`${path}: ${flat.join(', ')} now go under "presenter", e.g. { "presenter": { "${flat[0]}": ... } }`);
  }
  const refuse = (where, keys, allowed) => {
    const unknown = keys.filter(k => !allowed.includes(k));
    if (unknown.length) throw new Error(`${path}: unknown ${where}keys ${unknown.join(', ')}; allowed: ${allowed.join(', ')}`);
  };
  refuse('', Object.keys(o), OVERRIDE_SECTIONS);
  for (const [section, allowed] of [['presenter', PRESENTER_OVERRIDE_KEYS], ['dataset', DATASET_OVERRIDE_KEYS], ['organism', ORGANISM_OVERRIDE_KEYS]]) {
    if (o[section] === undefined) continue;
    if (!isObject(o[section])) throw new Error(`${path}: "${section}" must be an object`);
    refuse(`${section} `, Object.keys(o[section]), allowed);
  }
  return o;
}

/** A type's assertCuratedAgree: throws listing every error its checkCurated finds. */
export function assertCuratedAgreeWith(checkCurated) {
  return (proposalDir) => {
    const errors = checkCurated(proposalDir);
    if (errors.length) throw new Error(`Curated artifacts of ${loadManifest(proposalDir).accession} disagree:\n  - ${errors.join('\n  - ')}`);
  };
}

/** Derived values first, curator overrides on top; injectorProps merge by name, per organism too. */
export function applyOverrides(derived, overrides = {}) {
  const { injectorProps, organisms, ...rest } = overrides;
  const { organisms: derivedOrganisms, ...base } = derived;
  const merged = mergeOrganisms(derivedOrganisms, organisms);
  const empty = merged === undefined || (isObject(merged) && !Object.keys(merged).length);
  return { ...base, ...rest, injectorProps: { ...derived.injectorProps, ...injectorProps }, ...(empty ? {} : { organisms: merged }) };
}

/**
 * Per-organism entries merged by abbreviation, injectorProps by prop; overrides
 * win. A malformed override passes through unchanged for validation to report.
 */
function mergeOrganisms(derived, overrides) {
  if (overrides === undefined) return derived;
  if (!isObject(overrides) || !isObject(derived ?? {})) return overrides;
  return Object.fromEntries([...new Set([...Object.keys(derived ?? {}), ...Object.keys(overrides)])].map((a) =>
    [a, a in overrides ? mergeOrganism(derived?.[a], overrides[a]) : derived[a]]));
}

function mergeOrganism(derived, over) {
  if (!isObject(over) || !isObject(derived ?? {})) return over;
  if (over.injectorProps !== undefined && !isObject(over.injectorProps)) return { ...derived, ...over };
  return { ...derived, ...over, injectorProps: { ...derived?.injectorProps, ...over.injectorProps } };
}

export const presenterPath = (proposalDir) => join(proposalDir, 'curated', PRESENTER_FILENAME);

const stringMapErrors = (v, where) => {
  if (!isObject(v) || !Object.values(v).every((x) => typeof x === 'string')) return [`${where} must be an object of string values`];
  return Object.keys(v).filter((name) => !XML_NAME.test(name)).map((name) => `${where} has an invalid name "${name}"`);
};

function presenterOrganismErrors(organisms, requiredInjectorProps) {
  if (organisms === undefined) return [];
  if (!isObject(organisms)) return ['organisms must be an object of { injectorProps } by organism'];
  return Object.entries(organisms).flatMap(([abbrev, o]) => {
    const at = `organisms.${abbrev}`;
    if (!isObject(o) || Object.keys(o).some((k) => k !== 'injectorProps')) return [`${at} may hold only injectorProps`];
    const errors = stringMapErrors(o.injectorProps ?? {}, `${at}.injectorProps`);
    if (errors.length) return errors;
    return requiredInjectorProps
      .filter((k) => k in (o.injectorProps ?? {}) && o.injectorProps[k].trim() === '')
      .map((k) => `${at}.injectorProps.${k} is required and is empty`);
  });
}

/** Returns error strings; empty means the record can be rendered. */
export function validatePresenter(p, { requiredFields = [], requiredInjectorProps = [] } = {}) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return ['presenter must be a JSON object'];
  const errors = [];
  if (p.schemaVersion !== PRESENTER_SCHEMA_VERSION) errors.push(`schemaVersion must be ${PRESENTER_SCHEMA_VERSION}`);
  if (p.name !== undefined) errors.push('name is derived from the manifest and must not be stored in the presenter record');
  for (const f of TEXT_FIELDS) {
    if (typeof p[f] !== 'string') errors.push(`${f} must be a string`);
  }
  for (const f of [...ALWAYS_REQUIRED, ...requiredFields]) {
    if (typeof p[f] === 'string' && p[f].trim() === '') errors.push(`${f} is required and is empty`);
  }
  if (typeof p.displayName === 'string' && HTML_TAG.test(p.displayName)) {
    errors.push('displayName must be plain text, without HTML tags such as <i>');
  }
  if (!Array.isArray(p.pubmedIds) || !p.pubmedIds.every(id => typeof id === 'string' && /^\d+$/.test(id))) {
    errors.push('pubmedIds must be an array of numeric strings');
  }
  if (!Array.isArray(p.links) || !p.links.every(l => typeof l?.text === 'string' && /^https?:\/\//.test(l?.url))) {
    errors.push('links must be an array of { text, url } with http(s) URLs');
  }
  for (const key of ['history', 'injectorProps']) errors.push(...stringMapErrors(p[key], key));
  for (const k of requiredInjectorProps) {
    if (typeof p.injectorProps?.[k] !== 'string' || p.injectorProps[k].trim() === '') errors.push(`injectorProps.${k} is required and is empty`);
  }
  errors.push(...presenterOrganismErrors(p.organisms, requiredInjectorProps));
  return errors;
}

export function assertValidPresenter(p, opts, where = PRESENTER_FILENAME) {
  const errors = validatePresenter(p, opts);
  if (errors.length) throw new Error(`Invalid ${where}:\n  - ${errors.join('\n  - ')}`);
}

export function readPresenter(proposalDir, opts) {
  const path = presenterPath(proposalDir);
  if (!existsSync(path)) throw new Error(`No curated/${PRESENTER_FILENAME} in ${proposalDir}; re-run write-proposal.js`);
  const p = parseJson(path);
  assertValidPresenter(p, opts, path);
  return p;
}

export function escapeForCDATA(text) {
  return String(text).replace(/\]\]>/g, ']]&gt;');
}

export function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function contactElements(ids) {
  return ids.map(id => `    <contactId>${escapeXml(id)}</contactId>`).join('\n');
}

export function pubmedElements(ids) {
  return ids.map(id => `    <pubmedId>${escapeXml(id)}</pubmedId>`).join('\n');
}

export function linkElements(links) {
  return links.map(l => `    <link>
      <text>${escapeXml(l.text)}</text>
      <url>${escapeXml(l.url)}</url>
    </link>`).join('\n');
}

/** The presenter elements between the opening tag and the injectors, as RNA-seq and DNA-seq render them. */
export function presenterBodyXml(p, m, build) {
  const contacts = contactElements(m.contacts.additional);
  const pubmeds = pubmedElements(p.pubmedIds);
  return `    <displayName><![CDATA[${escapeForCDATA(p.displayName)}]]></displayName>
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
    <history buildNumber="${escapeXml(build)}"/>
    <primaryContactId>${escapeXml(m.contacts.primary)}</primaryContactId>
${contacts ? contacts + '\n' : ''}${linkElements(p.links)}
${pubmeds ? pubmeds + '\n' : ''}`;
}

/** Renders <prop> lines: the datasetType's current defaults, replaced by name from the presenter record. */
export function injectorProps(defaults, chosen = {}) {
  return Object.entries({ ...defaults, ...chosen })
    .map(([name, value]) => `      <prop name="${escapeXml(name)}">${escapeXml(value)}</prop>`)
    .join('\n');
}

/** Returns chosen prop names absent from the datasetType's injectorDefaults, for the CLI's stderr warning. */
export function unknownInjectorProps(defaults, chosen = {}) {
  return Object.keys(chosen).filter(k => !(k in defaults));
}

// --- dataset record (an entry's props and source) -----------------------------

export const SOURCE_TYPES = ['sra', 'server', 'url'];
export const RUN_ACCESSION = /^[SED]RR\d+$/;

/** runAccessions is checked only when given, which is at derive time. */
function validateSource(source, { runAccessions } = {}) {
  if (!isObject(source) || !SOURCE_TYPES.includes(source.type)) return [`source.type must be one of ${SOURCE_TYPES.join(', ')}`];
  const errors = [];
  if (source.type === 'sra' && runAccessions !== undefined) {
    const bad = runAccessions.filter((r) => !RUN_ACCESSION.test(r));
    if (!runAccessions.length) errors.push('source "sra" needs run accessions in the SRA metadata');
    if (bad.length) errors.push(`source "sra" needs SRA/ENA/DDBJ run accessions; not: ${bad.join(', ')}`);
  }
  if (source.type === 'server' && !(Array.isArray(source.paths) && source.paths.length && source.paths.every((p) => typeof p === 'string' && p.startsWith('/')))) {
    errors.push('source "server" needs paths: a non-empty array of absolute paths');
  }
  if (source.type === 'url' && !(Array.isArray(source.urls) && source.urls.length && source.urls.every((u) => typeof u === 'string' && /^https?:\/\//.test(u)))) {
    errors.push('source "url" needs urls: a non-empty array of http(s) URLs');
  }
  return errors;
}

const identityPropError = (p) => `props.${p} comes from the entry and its organism and must not be set here`;

/**
 * The record against its classes.xml class: exactly the class's props other
 * than identity, as strings (empty only for optionalProps), plus a read source the data loaders can reach.
 */
export function validateDataset(d, classDef, opts = {}) {
  const optional = opts.optionalProps ?? [];
  if (!isObject(d)) return ['dataset must be a JSON object'];
  const errors = [];
  if (d.schemaVersion !== DATASET_SCHEMA_VERSION) errors.push(`schemaVersion must be ${DATASET_SCHEMA_VERSION}`);
  if (!isObject(d.props)) {
    errors.push('props must be an object');
  } else {
    const entry = { props: d.props };
    errors.push(...entryPropErrors(entry, classDef), ...blankPropErrors(entry, classDef, optional));
  }
  return [...errors, ...validateSource(d.source, opts)];
}

export function assertValidDataset(d, classDef, opts, where = DATASET_FILENAME) {
  const errors = validateDataset(d, classDef, opts);
  if (errors.length) throw new Error(`Invalid ${where}:\n  - ${errors.join('\n  - ')}`);
}

// --- dataset entries (curated/datasets.json) ---------------------------------

export const DATASETS_FILENAME = 'datasets.json';
export const DATASETS_SCHEMA_VERSION = 2;
const LEGACY_IDENTITY = ['datasetClass', 'name', 'version'];
const ENTRY_KEYS = ['datasetClass', 'name', 'version', 'props', 'source'];
const CLASS_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;
const LITERAL_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;
const ONE_CONSTANT = /^\$\$\w+\$\$$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const isDate = (v) => typeof v === 'string' && DATE.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
/** How messages name an entry, as written: class and name, and the soTerm that tells a genome's same-named sequence entries apart. */
const soTermSuffix = (e) => (typeof e.props?.soTerm === 'string' ? ` (${e.props.soTerm})` : '');
export const entryKind = (e) => (typeof e.props?.soTerm === 'string' ? `${e.datasetClass}, ${e.props.soTerm}` : e.datasetClass);
export const entryLabel = (e) => `${e.datasetClass} ${e.name}${soTermSuffix(e)}`;
/** The entry as a clash message names it: its class and name, then its soTerm when it has one. */
export const entryNamed = (e) => `${e.datasetClass} named "${e.name}"${soTermSuffix(e)}`;
/** How a load commit names a proposal's datasets: the one name, or a count. */
export const entriesLabel = (entries) => (entries.length === 1 ? entries[0].name : `${entries.length} datasets`);

const readLocal = (path) => (existsSync(path) ? readFileSync(path, 'utf-8') : null);
/** A reader for datasetsOf and constantsOf of a proposal as ref has it; paths are repository-relative. */
export const readerOnRef = (git, ref) => (path) => (git.fileExistsOnRef(ref, path) ? git.showFile(ref, path) : null);

/** Problems with the identity fields an entry has; a literal name may not be built from the accession. */
export function entryIdentityErrors(e, { accession, literalOnly = false } = {}) {
  const errors = [];
  if (e.datasetClass !== undefined && (typeof e.datasetClass !== 'string' || !CLASS_NAME.test(e.datasetClass))) {
    errors.push('datasetClass must be a classes.xml class name');
  }
  if (e.name !== undefined) {
    if (typeof e.name !== 'string' || !(LITERAL_NAME.test(e.name) || (!literalOnly && ONE_CONSTANT.test(e.name)))) {
      errors.push(literalOnly
        ? 'name may contain only letters, digits and underscores, and must start with a letter'
        : 'name may contain only letters, digits and underscores, and must start with a letter, or be one $$constant$$');
    } else if (accession && LITERAL_NAME.test(e.name) && e.name.toLowerCase().includes(accession.toLowerCase())) {
      errors.push(`name "${e.name}" must be readable, not built from the accession`);
    }
  }
  if (e.version !== undefined && !(isDate(e.version) || (!literalOnly && typeof e.version === 'string' && ONE_CONSTANT.test(e.version)))) {
    errors.push(literalOnly ? 'version must be a date, YYYY-MM-DD' : 'version must be a date, YYYY-MM-DD, or one $$constant$$');
  }
  return errors;
}

/** Each entry's shape, before any class or constant is consulted. Identity (the resolved datasetName) needs classes.xml; assertValidEntries checks it. */
export function entriesErrors(entries, manifest) {
  const errors = [];
  entries.forEach((e, i) => {
    if (!isObject(e)) {
      errors.push(`datasets[${i}] must be an object { ${ENTRY_KEYS.join(', ')} }`);
      return;
    }
    const at = typeof e.datasetClass === 'string' && typeof e.name === 'string' ? entryLabel(e) : `datasets[${i}]`;
    const stringProps = isObject(e.props) && Object.values(e.props).every((v) => typeof v === 'string');
    const problems = [
      ...ENTRY_KEYS.filter((k) => e[k] === undefined).map((k) => `${k} is required`),
      ...Object.keys(e).filter((k) => !ENTRY_KEYS.includes(k)).map((k) => `${k} is not an entry field`),
      ...entryIdentityErrors(e, { accession: manifest.accession }),
      ...(e.props === undefined || stringProps ? [] : ['props must be an object of string values']),
      ...(e.source === undefined ? [] : validateSource(e.source))
    ];
    errors.push(...problems.map((p) => `${at}: ${p}`));
  });
  return errors;
}

/**
 * The proposal's dataset entries [{ datasetClass, name, version, props, source }]: the one reader of
 * curated/datasets.json, and of the shape before it (manifest datasetClass, name and version with a
 * schemaVersion 1 curated/dataset.json), which reads as one entry. Shape only; assertValidEntries checks
 * classes, constants and delivery paths. read(path) returns a file's text or null. lenient returns whatever
 * entries are found without validating them, for reading another proposal's names; invalid JSON still throws.
 */
export function datasetsOf(proposalDir, manifest, { read = readLocal, lenient = false } = {}) {
  const json = (f) => {
    const path = join(proposalDir, 'curated', f);
    const text = read(path);
    if (text === null) return undefined;
    try { return JSON.parse(text); } catch (e) { throw new Error(`${path} is not valid JSON: ${e.message}`); }
  };
  const v2 = json(DATASETS_FILENAME);
  const v1 = json(DATASET_FILENAME);
  const legacy = LEGACY_IDENTITY.filter((k) => manifest[k] !== undefined);
  const problems = [];
  let entries = [];
  // Old dataset.json files may predate "source"; every type that wrote them read from SRA by default.
  if (v2 !== undefined && v1 !== undefined) {
    problems.push(`curated/${DATASET_FILENAME} and curated/${DATASETS_FILENAME} are both present; re-run write-proposal.js, which keeps only ${DATASETS_FILENAME}`);
    if (isObject(v2) && Array.isArray(v2.datasets)) entries = v2.datasets;
  } else if (v2 !== undefined) {
    if (legacy.length) problems.push(`the manifest's ${legacy.join(', ')} and curated/${DATASETS_FILENAME} both give dataset identity; re-run write-proposal.js`);
    if (!isObject(v2) || v2.schemaVersion !== DATASETS_SCHEMA_VERSION || !Array.isArray(v2.datasets)) {
      problems.push(`curated/${DATASETS_FILENAME} must be { "schemaVersion": ${DATASETS_SCHEMA_VERSION}, "datasets": [...] }`);
    } else {
      entries = v2.datasets;
    }
  } else if (legacy.length) {
    if (v1 === undefined) problems.push(`the manifest's ${legacy.join(', ')} need curated/${DATASET_FILENAME}; re-run write-proposal.js`);
    else if (!isObject(v1) || v1.schemaVersion !== DATASET_SCHEMA_VERSION) problems.push(`curated/${DATASET_FILENAME} must be a schemaVersion ${DATASET_SCHEMA_VERSION} object`);
    else entries = [{ datasetClass: manifest.datasetClass, name: manifest.name, version: manifest.version, props: v1.props, source: v1.source ?? { type: 'sra' } }];
  } else if (v1 !== undefined) {
    problems.push(`curated/${DATASET_FILENAME} has no identity: the manifest has no datasetClass, name and version; re-run write-proposal.js`);
  }
  if (lenient) return entries;
  if (!problems.length) problems.push(...entriesErrors(entries, manifest));
  if (problems.length) throw new Error(`Invalid dataset entries of ${manifest.accession}:\n  - ${problems.join('\n  - ')}`);
  return entries;
}

const oneEntryMessage = (manifest, count) => `${manifest.datasetType} proposals hold exactly one dataset entry; this one has ${count}`;

/** The one entry of a single-entry type's proposal. */
export function onlyEntry(proposalDir, m) {
  const entries = datasetsOf(proposalDir, m);
  if (entries.length !== 1) throw new Error(`${oneEntryMessage(m, entries.length)}. Re-run write-proposal.js`);
  return entries[0];
}

export const ORGANISM_RECORD_FILENAME = 'organism.json';
/** Constants every organism file defines, so any entry may reference them. */
export const ORGANISM_FILE_CONSTANTS = ['projectName', 'organismAbbrev', 'strainAbbrev', 'ncbiTaxonId', 'speciesNcbiTaxonId'];
const CONSTANT_REF = /\$\$(\w+)\$\$/g;

/**
 * The entry with every $$constant$$ in name, version and props replaced from constants. Throws naming
 * the entry and the constant when one is unknown, or when the version does not resolve to a date.
 */
export function resolveEntry(entry, constants) {
  const fill = (value) => value.replace(CONSTANT_REF, (whole, key) => {
    if (!Object.hasOwn(constants, key)) {
      throw new Error(`${entryLabel(entry)}: ${whole} is not a known constant (curated/${ORGANISM_RECORD_FILENAME}, ${ORGANISM_FILE_CONSTANTS.join(', ')}, or one the dataset type requires)`);
    }
    return constants[key];
  });
  const resolved = {
    ...entry,
    name: fill(entry.name),
    version: fill(entry.version),
    props: Object.fromEntries(Object.entries(entry.props).map(([k, v]) => [k, fill(v)]))
  };
  if (!isDate(resolved.version)) throw new Error(`${entryLabel(entry)}: version ${entry.version} resolves to "${resolved.version}", not a date YYYY-MM-DD`);
  return resolved;
}

/**
 * What an entry's $$constants$$ resolve to for one organism: the proposal's own constants and the
 * organism's project and abbreviation. Constants every organism file defines, and those the type
 * requires at load, stay $$references$$: only the organism file knows them.
 */
export function constantsFor(manifest, organism, constants = {}, datasetType = {}) {
  const atLoad = [...ORGANISM_FILE_CONSTANTS, ...Object.keys(datasetType.requiredOrganismConstants ?? {})];
  return {
    ...Object.fromEntries(atLoad.map((k) => [k, `$$${k}$$`])),
    ...constants,
    projectName: projectOf(manifest, organism),
    organismAbbrev: organism
  };
}

/** The organism constants the proposal introduces: curated/organism.json "constants", or {}. */
export function constantsOf(proposalDir, { read = readLocal } = {}) {
  const path = join(proposalDir, 'curated', ORGANISM_RECORD_FILENAME);
  const text = read(path);
  if (text === null) return {};
  let record;
  try { record = JSON.parse(text); } catch (e) { throw new Error(`${path} is not valid JSON: ${e.message}`); }
  if (record?.constants === undefined) return {};
  const errors = [
    ...stringMapErrors(record.constants, 'constants'),
    ...ORGANISM_FILE_CONSTANTS.filter((k) => isObject(record.constants) && Object.hasOwn(record.constants, k)).map((k) => `constants may not set ${k}; the organism file owns it`)
  ];
  if (errors.length) throw new Error(`Invalid ${path}:\n  - ${errors.join('\n  - ')}`);
  return record.constants;
}

/**
 * One entry for one organism: resolved, with its datasetName (its identity) and delivery location.
 * resolveEntry names the entry in its own errors; an unfilled class placeholder is named here.
 */
export function entryForOrganism(manifest, entry, classDef, organism, { constants = {}, datasetType = {} } = {}) {
  const resolved = resolveEntry(entry, constantsFor(manifest, organism, constants, datasetType));
  try {
    return { resolved, datasetName: datasetNameOf(manifest, classDef, organism, resolved), ...deliveryLocation(manifest, classDef, organism, resolved) };
  } catch (err) {
    throw new Error(`${entryLabel(entry)}: ${err.message}`);
  }
}

/** Every entry for every organism: [{ entry, label, organism, datasetName, target, relative, file }], organism by organism. */
export function entryDeliveries(manifest, entries, { classOf, constants = {}, datasetType = {} }) {
  return organismsOf(manifest).flatMap((organism) => entries.map((entry) => {
    const { resolved, ...placed } = entryForOrganism(manifest, entry, classOf(entry.datasetClass), organism, { constants, datasetType });
    return { entry, label: entryLabel(entry), organism, ...placed };
  }));
}

/** An entry's props against its class: exactly the class's props but the identity ones, as strings, empty allowed. */
export function entryPropErrors(entry, classDef) {
  const expected = classDef.props.filter((p) => !IDENTITY_PROPS.includes(p));
  return [
    ...expected.filter((p) => typeof entry.props?.[p] !== 'string').map((p) => `props.${p} is required by class ${classDef.className}`),
    ...Object.keys(entry.props ?? {}).filter((p) => !expected.includes(p))
      .map((p) => (IDENTITY_PROPS.includes(p) ? identityPropError(p) : `props.${p} is not a prop of class ${classDef.className}`))
  ];
}

const CHOOSE_NAME = 'choose another "name" in --overrides';
const DISTINCT_NAME = 'give the entry a distinct name, for example by appending a numeric suffix';
/** What to do about a clashing name: a single-entry type's name is the curator's override, a multi-entry type's is in the entry. */
export const nameAdvice = (datasetType) => (datasetType.singleEntry ? CHOOSE_NAME : DISTINCT_NAME);

const UNIQUE_DELIVERY = 'delivery directories must be unique: make the names distinct, for example by appending a numeric suffix to one';

/**
 * Problems with well-shaped entries: class, count and props; then, for entries with right props, constants,
 * version, placeholders, and per organism a shared datasetName or delivery directory. Messages lead with entryLabel.
 */
export function entryTypeErrors(entries, { manifest, datasetType, classOf, constants = {} }) {
  if (typeof classOf !== 'function') throw new TypeError('entryTypeErrors needs classOf(className) → classDef');
  const errors = [];
  if (datasetType.singleEntry && entries.length !== 1) {
    errors.push(oneEntryMessage(manifest, entries.length));
  }
  const namedBy = new Map();
  const deliveredBy = new Map();
  for (const e of entries) {
    const at = entryLabel(e);
    const identityErrors = entryIdentityErrors(e, { accession: manifest.accession, literalOnly: Boolean(datasetType.singleEntry) });
    if (identityErrors.length) {
      errors.push(...identityErrors.map((p) => `${at}: ${p}`));
      continue;
    }
    if (!datasetType.datasetClasses.includes(e.datasetClass)) {
      errors.push(`${at}: ${manifest.datasetType} proposals hold ${datasetType.datasetClasses.join(', ')}, not ${e.datasetClass}`);
      continue;
    }
    let classDef;
    try { classDef = classOf(e.datasetClass); } catch (err) { errors.push(`${at}: ${err.message}`); continue; }
    const propErrors = entryPropErrors(e, classDef);
    if (propErrors.length) {
      errors.push(...propErrors.map((p) => `${at}: ${p}`));
      continue;
    }
    for (const organism of organismsOf(manifest)) {
      let placed;
      try { placed = entryForOrganism(manifest, e, classDef, organism, { constants, datasetType }); } catch (err) { errors.push(err.message); continue; }
      const { datasetName, relative } = placed;
      const named = `${organism} ${datasetName}`;
      if (namedBy.has(named)) errors.push(`${namedBy.get(named)} and ${at} both load as ${datasetName}`);
      else namedBy.set(named, at);
      if (deliveredBy.has(relative)) errors.push(`${deliveredBy.get(relative)} and ${at} both deliver to ${relative}; ${UNIQUE_DELIVERY}`);
      else deliveredBy.set(relative, at);
    }
  }
  // Errors with no organism in them repeat for every organism.
  return [...new Set(errors)];
}

/**
 * The proposal's entries once valid in shape (datasetsOf) and against the type, classes.xml
 * (classOf(className) → classDef) and curated/organism.json constants; throws listing every problem.
 * Write, publish, load, mark-ready and prepare-delivery run it before changing anything.
 */
export function assertValidEntries(proposalDir, manifest, datasetType, { classOf, read = readLocal } = {}) {
  const entries = datasetsOf(proposalDir, manifest, { read });
  const errors = entryTypeErrors(entries, { manifest, datasetType, classOf, constants: constantsOf(proposalDir, { read }) });
  if (errors.length) throw new Error(`Invalid dataset entries of ${manifest.accession}:\n  - ${errors.join('\n  - ')}`);
  return entries;
}

/** A <dataset> element as organism files write them: the class's props in class order, project and organism as $$constants$$. */
export function datasetElement(entry, classDef) {
  const values = { projectName: '$$projectName$$', organismAbbrev: '$$organismAbbrev$$', name: entry.name, version: entry.version, ...entry.props };
  const lines = classDef.props.map((p) => `    <prop name="${escapeXml(p)}">${escapeXml(values[p])}</prop>`);
  return `  <dataset class="${escapeXml(classDef.className)}">\n${lines.join('\n')}\n  </dataset>`;
}

/** Props an entry leaves empty though its type needs a value; allowed may stay empty. */
export function blankPropErrors(entry, classDef, allowed = []) {
  return classDef.props.filter((p) => !IDENTITY_PROPS.includes(p) && !allowed.includes(p) && entry.props[p] === '')
    .map((p) => `props.${p} is required by class ${classDef.className}`);
}

/**
 * Every entry's <dataset> element, in entry order, a blank line apart: the one place an entry is checked
 * and rendered. Props are checked against the class, then (when those are right) by the type's optional
 * entryProblems(proposalDir, manifest, entry, classDef). Callers guard against zero entries.
 */
export function renderDatasets(proposalDir, manifest, datasetType, classOf) {
  return datasetsOf(proposalDir, manifest).map((entry) => {
    let classDef;
    try { classDef = classOf(entry.datasetClass); } catch (err) { throw new Error(`${entryLabel(entry)}: ${err.message}`); }
    const classProblems = entryPropErrors(entry, classDef);
    const problems = classProblems.length ? classProblems : datasetType.entryProblems?.(proposalDir, manifest, entry, classDef) ?? [];
    if (problems.length) throw new Error(`Invalid dataset ${entryLabel(entry)} of ${manifest.accession}:\n  - ${problems.join('\n  - ')}`);
    return datasetElement(entry, classDef);
  }).join('\n\n');
}

/** Phase 1 has no build; previews show this in its place. */
export const PREVIEW_BUILD = 'NN';

export function requireBuild(build) {
  if (typeof build !== 'string' || build === '') throw new Error('renderPresenter needs a build: the ticket milestone at load, PREVIEW_BUILD in Phase 1');
  return build;
}
