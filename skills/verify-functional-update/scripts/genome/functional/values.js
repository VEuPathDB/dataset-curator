import { decode, getValues } from '../gff.js';

export const GO_ASPECTS = Object.freeze({ go_function: 'F', go_process: 'P', go_component: 'C' });
const GO_START = /^[^|]*\|\d+\|/;
const EVIDENCE = /^[A-Z]{2,3}$/;
export const GO_EVIDENCE_CODES = Object.freeze(new Set('EXP IDA IPI IMP IGI IEP HTP HDA HMP HGI HEP IBA IBD IKR IRD ISS ISO ISA ISM IGC RCA TAS NAS IC ND IEA'.split(' ')));
const EC = /^\d+(?:\.(?:\d+|-)){3}$/;

const cell = (value) => value.replace(/[\t\r\n]+/g, ' ').trim();
const pipes = (text) => text.split('|').length - 1;

/** One attribute's values over a feature's lines, split on raw commas and then decoded, so an encoded %2C stays in its value. */
export function attrValues(group, key) {
  const values = [];
  for (const line of group.lines) {
    for (const raw of getValues(line, key)) {
      const value = cell(decode(raw));
      if (value && !values.includes(value)) values.push(value);
    }
  }
  return values;
}

/** An NCBI go_* value, `term|GO id digits|PMIDs|evidence`, or null when it is not one. */
export function parseGo(raw) {
  const parts = raw.split('|').map((part) => cell(decode(part)));
  if (parts.length !== 4 || !/^\d{1,7}$/.test(parts[1])) return null;
  const pmids = parts[2].split(/[,;\s]+/).filter(Boolean);
  if (pmids.some((pmid) => !/^\d+$/.test(pmid))) return null;
  const evidence = parts[3] || 'IEA';
  if (!EVIDENCE.test(evidence)) return null;
  return { goId: `GO:${parts[1].padStart(7, '0')}`, reference: pmids.map((pmid) => `PMID:${pmid}`).join('|'), evidence };
}

/**
 * A feature's go_* values. A raw comma separates terms but may also sit inside a PMID list, so a piece that does not
 * start a term continues the previous one while that one has fewer than four fields.
 */
export function goValues(group, key) {
  const values = [];
  const bad = [];
  for (const line of group.lines) {
    const pieces = [];
    for (const raw of getValues(line, key)) {
      if (!raw) continue;
      if (pieces.length && pipes(pieces.at(-1)) < 3 && !GO_START.test(raw)) pieces[pieces.length - 1] += `,${raw}`;
      else pieces.push(raw);
    }
    for (const piece of pieces) {
      const go = parseGo(piece);
      if (go) values.push(go);
      else bad.push(cell(decode(piece)));
    }
  }
  return { values, bad };
}

export const isEc = (value) => EC.test(value);

export function parseDbxref(value) {
  const i = value.indexOf(':');
  return i > 0 && i < value.length - 1 ? { prefix: value.slice(0, i), id: value.slice(i + 1) } : null;
}

export const dbxrefDatasetName = (prefix) => `${prefix.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_from_annotation`;
