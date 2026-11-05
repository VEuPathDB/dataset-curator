export function parseGff(text) {
  const raw = text.split('\n');
  const trailingNewline = raw.at(-1) === '';
  if (trailingNewline) raw.pop();
  const lines = raw.map((line, i) => {
    if (line.endsWith('\r')) throw new Error(`GFF line ${i + 1} ends in CR; convert to LF`);
    if (line.startsWith('##FASTA')) throw new Error(`embedded FASTA in GFF (line ${i + 1}) is not supported`);
    if (line === '' || line.startsWith('#')) return { kind: 'comment', text: line };
    const cols = line.split('\t');
    if (cols.length !== 9) throw new Error(`GFF line ${i + 1} has ${cols.length} tab-separated columns, not 9`);
    for (const [name, value] of [['start', cols[3]], ['end', cols[4]]]) {
      if (!/^\d+$/.test(value)) throw new Error(`GFF line ${i + 1} has a ${name} that is not a non-negative integer: "${value}"`);
    }
    return { kind: 'feature', feature: parseFeature(cols) };
  });
  return { lines, trailingNewline };
}

function parseFeature([seqId, source, type, start, end, score, strand, phase, col9]) {
  const feature = { seqId, source, type, start: Number(start), end: Number(end), score, strand, phase, attrs: [] };
  if (String(feature.start) !== start) feature.rawStart = start;
  if (String(feature.end) !== end) feature.rawEnd = end;
  if (col9 === '.' || col9 === '') return { ...feature, emptyAttrs: col9 };
  const trailingSemicolon = col9.endsWith(';');
  feature.attrs = (trailingSemicolon ? col9.slice(0, -1) : col9).split(';').map((kv) => {
    const i = kv.indexOf('=');
    return i < 0 ? [kv, null] : [kv.slice(0, i), kv.slice(i + 1)];
  });
  return trailingSemicolon ? { ...feature, trailingSemicolon } : feature;
}

export function serializeFeature(f) {
  const col9 = f.attrs.length
    ? f.attrs.map(([k, v]) => (v === null ? k : `${k}=${v}`)).join(';') + (f.trailingSemicolon ? ';' : '')
    : (f.emptyAttrs ?? '.');
  const start = f.rawStart !== undefined && Number(f.rawStart) === f.start ? f.rawStart : f.start;
  const end = f.rawEnd !== undefined && Number(f.rawEnd) === f.end ? f.rawEnd : f.end;
  return [f.seqId, f.source, f.type, start, end, f.score, f.strand, f.phase, col9].join('\t');
}

export function serializeGff(graph) {
  const text = graph.lines.map((l) => (l.kind === 'comment' ? l.text : serializeFeature(l.feature))).join('\n');
  return graph.trailingNewline ? `${text}\n` : text;
}

export const newFeature = ({ seqId, source, type, start, end, strand, attrs }) =>
  ({ seqId, source, type, start, end, score: '.', strand, phase: '.', attrs });

export const features = (graph) => graph.lines.filter((l) => l.kind === 'feature').map((l) => l.feature);
export const seqIdsOf = (graph) => [...new Set(features(graph).map((f) => f.seqId))];

export const getAttr = (f, key) => f.attrs.find(([k]) => k === key)?.[1] ?? null;
export const getValues = (f, key) => { const v = getAttr(f, key); return v ? v.split(',') : []; };
export const idOf = (f) => getAttr(f, 'ID');
export const parentsOf = (f) => getValues(f, 'Parent');

export function decode(value) {
  return value.replace(/(?:%[0-9A-Fa-f]{2})+/g, (run) => {
    const bytes = Buffer.from(run.replace(/%/g, ''), 'hex');
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      return run;
    }
  });
}

export const encode = (value) =>
  [...String(value)].map((c) => (/[\t\n\r%;=&,\x00-\x1f\x7f]/.test(c) ? `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}` : c)).join('');

export function setRawAttr(f, key, raw) {
  const existing = f.attrs.find(([k]) => k === key);
  if (existing) { existing[1] = raw; return; }
  const afterId = f.attrs.findIndex(([k]) => k === 'ID') + 1;
  f.attrs.splice(key === 'Parent' && afterId > 0 ? afterId : f.attrs.length, 0, [key, raw]);
}

/** The value is decoded text and gets encoded; an array becomes a multi-value, each element encoded. */
export function setAttr(f, key, value) {
  setRawAttr(f, key, Array.isArray(value) ? value.map(encode).join(',') : encode(value));
}

export function deleteAttrs(f, keys) {
  const kept = f.attrs.filter(([k]) => !keys.includes(k));
  const changed = kept.length !== f.attrs.length;
  f.attrs = kept;
  return changed;
}

/** Lines sharing an ID and type are one feature; lines without an ID stand alone. */
export function featureGroups(graph) {
  const groups = [];
  const byKey = new Map();
  for (const f of features(graph)) {
    const id = idOf(f);
    const key = id === null ? null : `${id}\t${f.type}`;
    if (key !== null && byKey.has(key)) { byKey.get(key).lines.push(f); continue; }
    const group = { id, type: f.type, lines: [f] };
    groups.push(group);
    if (key !== null) byKey.set(key, group);
  }
  return groups;
}

export function cloneGraph(graph) {
  const lines = graph.lines.map((l) =>
    (l.kind === 'comment' ? { ...l } : { kind: 'feature', feature: { ...l.feature, attrs: l.feature.attrs.map((a) => [...a]) } }));
  return { ...graph, lines };
}

/** A snapshot: rebuild after editing the graph. */
export function indexGraph(graph) {
  const children = new Map();
  for (const f of features(graph)) {
    for (const p of parentsOf(f)) {
      if (!children.has(p)) children.set(p, []);
      children.get(p).push(f);
    }
  }
  return { childrenOf: (id) => children.get(id) ?? [] };
}

export function renameIds(graph, mapping) {
  for (const f of features(graph)) {
    const id = idOf(f);
    if (id !== null && mapping.has(id)) setRawAttr(f, 'ID', mapping.get(id));
    const parents = parentsOf(f);
    if (parents.some((p) => mapping.has(p))) setRawAttr(f, 'Parent', parents.map((p) => mapping.get(p) ?? p).join(','));
  }
}

export function renameSequences(graph, mapping) {
  for (const line of graph.lines) {
    if (line.kind === 'feature') { line.feature.seqId = mapping.get(line.feature.seqId) ?? line.feature.seqId; continue; }
    const region = line.text.match(/^##sequence-region\s+(\S+)/);
    if (region && mapping.has(region[1])) {
      line.text = line.text.replace(/^(##sequence-region\s+)\S+/, (_, prefix) => prefix + mapping.get(region[1]));
    }
  }
}

export function withInsertions(graph, { before = new Map(), after = new Map() }) {
  const wrap = (fs) => (fs ?? []).map((feature) => ({ kind: 'feature', feature }));
  const lines = graph.lines.flatMap((line) =>
    (line.kind === 'feature' ? [...wrap(before.get(line.feature)), line, ...wrap(after.get(line.feature))] : [line]));
  return { ...graph, lines };
}

export const withoutFeatures = (graph, drop) =>
  ({ ...graph, lines: graph.lines.filter((l) => l.kind !== 'feature' || !drop.has(l.feature)) });

/** Header lines, `###`, and the features and sequence-region blocks of the chosen sequences. */
export function subsetGff(graph, seqIds) {
  let block = null;
  const lines = graph.lines.filter((line) => {
    if (line.kind === 'feature') return seqIds.has(line.feature.seqId);
    const region = line.text.match(/^##sequence-region\s+(\S+)/);
    if (region) block = region[1];
    return line.text === '###' || block === null || seqIds.has(block);
  });
  return { ...graph, lines };
}
