import { appendHistory, presenterFileRelativePath } from './presenter-file.js';
import { setEntryVersion, datasetFileRelativePath } from './dataset-file.js';

/** Every edit a dataset type's loadEdits may return: the file it changes, how messages name it, and its applier. */
const OPS = {
  appendHistory: {
    requires: ['project', 'presenter', 'build', 'functional'],
    target: (op) => presenterFileRelativePath(op.project),
    label: (op) => `history ${op.presenter} build ${op.build}`,
    apply: appendHistory
  },
  setEntryVersion: {
    requires: ['project', 'organism', 'datasetClass', 'name', 'version'],
    target: (op) => datasetFileRelativePath(op.project, op.organism),
    label: (op) => `${op.datasetClass} ${op.name} version ${op.version} in ${op.organism}`,
    apply: setEntryVersion
  }
};

function opOf(op) {
  if (!Object.hasOwn(OPS, op?.op)) throw new Error(`unknown load edit ${JSON.stringify(op?.op)}`);
  const def = OPS[op.op];
  for (const field of def.requires) {
    if (op[field] === undefined || op[field] === null || op[field] === '') throw new Error(`load edit ${op.op} needs ${field}`);
  }
  return def;
}

export const editTarget = (op) => opOf(op).target(op);
export const editLabel = (op) => opOf(op).label(op);

/** Applies ops in order to the files read(relFile) gives, each file read once; returns [{ relFile, content }] in first-touched order. */
export function applyEdits(ops, read) {
  const files = new Map();
  for (const op of ops) {
    const { target, apply } = opOf(op);
    const relFile = target(op);
    const before = files.has(relFile) ? files.get(relFile) : read(relFile);
    if (typeof before !== 'string') throw new Error(`${relFile}: ${editLabel(op)}: file not found`);
    try {
      files.set(relFile, apply(before, op));
    } catch (e) {
      throw new Error(`${relFile}: ${editLabel(op)}: ${e.message}`, { cause: e });
    }
  }
  return [...files].map(([relFile, content]) => ({ relFile, content }));
}
