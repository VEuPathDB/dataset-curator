import { join } from 'node:path';

export function presenterFileRelativePath(project) {
  return `Model/lib/xml/datasetPresenters/${project}.xml`;
}

export function presenterFilePath(repoPath, project) {
  return join(repoPath, presenterFileRelativePath(project));
}

const PRESENTERS_DIR = 'Model/lib/xml/datasetPresenters';

export function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A SQL LIKE pattern as an anchored RegExp: % is any run, _ any one character. */
export function likeToRegExp(pattern) {
  return new RegExp(`^${[...pattern].map((c) => (c === '%' ? '.*' : c === '_' ? '.' : escapeRegExp(c))).join('')}$`, 's');
}

/** Every datasetNamePattern on ref as { path, pattern }; like presenterNameExists, commented-out presenters count. */
export function namePatternsOnRef(git, ref) {
  return git.grepOnRef(ref, 'datasetNamePattern *= *"[^"]*"', PRESENTERS_DIR)
    .flatMap(({ path, text }) => [...text.matchAll(/datasetNamePattern\s*=\s*"([^"]*)"/g)].map((m) => ({ path, pattern: m[1] })));
}

/**
 * Note: this is a plain regex scan, not an XML parser, so it will also match
 * a name that appears inside an XML comment. Deliberately conservative.
 */
export function presenterNameExists(fileContent, name) {
  return new RegExp(`<datasetPresenter\\s+name\\s*=\\s*"${escapeRegExp(name)}"`).test(fileContent);
}

export function extractPresenterName(block) {
  const m = block.match(/<datasetPresenter\s+name\s*=\s*"([^"]+)"/);
  if (!m) throw new Error('Rendered block has no <datasetPresenter name="..."> element');
  return m[1];
}

/** Inserts before the final closing root tag; dataset types own their own indentation. */
export function insertPresenter(fileContent, block) {
  const nl = fileContent.includes('\r\n') ? '\r\n' : '\n';
  const closing = '</datasetPresenters>';
  const idx = fileContent.lastIndexOf(closing);
  if (idx === -1) throw new Error(`Presenter file has no closing ${closing} tag`);
  const before = fileContent.slice(0, idx).replace(/\s*$/, `${nl}${nl}`);
  const normalizedBlock = block.replace(/\r?\n/g, nl);
  return `${before}${normalizedBlock}${nl}${nl}${closing}${nl}`;
}

/** The genome and annotation attributes a new history row copies from the presenter's latest row. */
export const HISTORY_CARRIED = ['genomeSource', 'genomeVersion', 'annotationSource', 'annotationVersion'];

const xmlEscape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const attrsOf = (text) => Object.fromEntries([...text.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)].map(([, k, v]) => [k, v]));

function presenterBlock(xml, name) {
  const re = new RegExp(`<datasetPresenter\\s+name\\s*=\\s*"${escapeRegExp(name)}"[\\s\\S]*?</datasetPresenter>`, 'g');
  const found = [...xml.matchAll(re)];
  if (found.length !== 1) throw new Error(found.length ? `${found.length} presenters are named ${name}` : `no presenter is named ${name}`);
  return { start: found[0].index, text: found[0][0] };
}

function indentAt(text, at) {
  const lead = text.slice(text.lastIndexOf('\n', at - 1) + 1, at);
  return /^[ \t]*$/.test(lead) ? lead : '    ';
}

function historyRows(block) {
  return [...block.matchAll(/<history\b([^>]*?)(?:\/>|>[\s\S]*?<\/history>)/g)].map((m) => ({
    index: m.index, end: m.index + m[0].length, raw: m[0], attrs: attrsOf(m[1]), indent: indentAt(block, m.index)
  }));
}

/** Sets an attribute on a row's start tag, adding it before the tag closes when absent. */
function setAttr(raw, key, value) {
  const re = new RegExp(`(\\s${key}\\s*=\\s*")[^"]*(")`);
  if (re.test(raw)) return raw.replace(re, (whole, open, close) => `${open}${xmlEscape(value)}${close}`);
  return raw.replace(/\s*(\/?>)/, (whole, end) => ` ${key}="${xmlEscape(value)}"${end}`);
}

/**
 * Adds a history row for op.build to presenter op.presenter, copying HISTORY_CARRIED from its latest row
 * (op.carry wins); a row already there for the build only moves functionalAnnotationVersion forward.
 * Idempotent. Refuses a missing or repeated presenter and a carried value nothing gives.
 */
export function appendHistory(xml, { presenter, build, functional, text, carry = {} }) {
  if (!/^\d+$/.test(String(build))) throw new Error(`appendHistory needs a build number; got "${build}"`);
  const { start, text: block } = presenterBlock(xml, presenter);
  const rows = historyRows(block);
  const replaceBlock = (next) => xml.slice(0, start) + next + xml.slice(start + block.length);
  const same = rows.filter((r) => r.attrs.buildNumber === String(build));
  if (same.length > 1) throw new Error(`${presenter} has ${same.length} history rows for build ${build}`);
  if (same.length) {
    const [row] = same;
    const had = row.attrs.functionalAnnotationVersion;
    if (had !== undefined) {
      if (Number.isNaN(Date.parse(had))) throw new Error(`${presenter} build ${build} has functionalAnnotationVersion "${had}", which is not a date`);
      if (!(Date.parse(functional.version) > Date.parse(had))) return xml;
    }
    const updated = setAttr(setAttr(row.raw, 'functionalAnnotationSource', functional.source), 'functionalAnnotationVersion', functional.version);
    return replaceBlock(block.slice(0, row.index) + updated + block.slice(row.end));
  }
  const latest = rows.reduce((best, r) => (best === null || Number(r.attrs.buildNumber) > Number(best.attrs.buildNumber) ? r : best), null);
  const values = Object.fromEntries(HISTORY_CARRIED.map((k) => [k, carry[k] ?? latest?.attrs[k] ?? '']));
  const missing = HISTORY_CARRIED.filter((k) => !values[k]);
  if (missing.length) {
    throw new Error(`${presenter}'s latest history row has no ${missing.join(', ')}; pass ${missing.map((k) => `--history ${k}=<value>`).join(' ')}`);
  }
  const nl = xml.includes('\r\n') ? '\r\n' : '\n';
  const last = rows.at(-1);
  const indent = last ? last.indent : '    ';
  const pad = `${indent}        `;
  const a = (k, v) => `${k}="${xmlEscape(v)}"`;
  const row = `<history ${a('buildNumber', build)}${nl}${pad}${a('genomeSource', values.genomeSource)} ${a('genomeVersion', values.genomeVersion)}`
    + `${nl}${pad}${a('annotationSource', values.annotationSource)} ${a('annotationVersion', values.annotationVersion)}`
    + `${nl}${pad}${a('functionalAnnotationSource', functional.source)} ${a('functionalAnnotationVersion', functional.version)}>${xmlEscape(text)}</history>`;
  if (last) return replaceBlock(`${block.slice(0, last.end)}${nl}${indent}${row}${block.slice(last.end)}`);
  const close = block.lastIndexOf('</datasetPresenter>');
  return replaceBlock(`${block.slice(0, close).replace(/[ \t]*$/, '')}${indent}${row}${nl}  ${block.slice(close)}`);
}
