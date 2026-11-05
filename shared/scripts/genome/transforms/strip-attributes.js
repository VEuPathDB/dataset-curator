import { cloneGraph, deleteAttrs, features, idOf, spanLabel } from '../gff.js';

export function stripAttributesProblems(args) {
  const problems = [];
  if (typeof args.type !== 'string' || !args.type) problems.push('args.type must be a feature type');
  if (!Array.isArray(args.keys) || !args.keys.length || args.keys.some((k) => typeof k !== 'string' || !k)) problems.push('args.keys must be a non-empty list of attribute keys');
  else if (args.keys.includes('ID') || args.keys.includes('Parent')) problems.push('args.keys must not include ID or Parent');
  const unknown = Object.keys(args).filter((k) => k !== 'type' && k !== 'keys');
  if (unknown.length) problems.push(`unknown args: ${unknown.join(', ')}`);
  return problems;
}

export function stripAttributes(input, { type, keys }) {
  const graph = cloneGraph(input);
  const changed = new Set();
  for (const f of features(graph)) {
    if (f.type === type && deleteAttrs(f, keys)) changed.add(idOf(f) ?? spanLabel(f));
  }
  return { graph, changes: [...changed].map((id) => ({ id })) };
}
