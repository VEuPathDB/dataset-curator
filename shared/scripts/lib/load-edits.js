import { appendHistory, presenterFileRelativePath } from './presenter-file.js';
import { setEntryVersion, datasetFileRelativePath } from './dataset-file.js';

/** Every edit a dataset type's loadEdits may return: the file it changes, how messages name it, and its applier. */
const OPS = {
  appendHistory: {
    target: (op) => presenterFileRelativePath(op.project),
    label: (op) => `history ${op.presenter} build ${op.build}`,
    apply: appendHistory
  },
  setEntryVersion: {
    target: (op) => datasetFileRelativePath(op.project, op.organism),
    label: (op) => `${op.datasetClass} ${op.name} version ${op.version} in ${op.organism}`,
    apply: setEntryVersion
  }
};

function opOf(op) {
  if (!Object.hasOwn(OPS, op?.op)) throw new Error(`unknown load edit ${JSON.stringify(op?.op)}`);
  return OPS[op.op];
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
    try {
      files.set(relFile, apply(before, op));
    } catch (e) {
      throw new Error(`${relFile}: ${editLabel(op)}: ${e.message}`);
    }
  }
  return [...files].map(([relFile, content]) => ({ relFile, content }));
}
