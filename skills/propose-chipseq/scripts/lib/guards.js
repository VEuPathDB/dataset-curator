/**
 * Refusals shared by the proposal and load flows, so both stop the same way:
 * one sentence saying what is wrong, then the command that fixes it.
 */

/** message may be a string or a thunk, so a tailored message costs nothing when the tree is clean. */
export function assertClean(git, message) {
  if (git.isClean()) return;
  const tailored = typeof message === 'function' ? message() : message;
  throw new Error(tailored ||
    `VEuPathDatasets working tree is not clean; commit or stash first. Inspect with: git -C '${git.repoPath}' status`);
}

export function assertOnBranch(git, expected, recoveryHint, { because = '' } = {}) {
  const current = git.currentBranch() || 'detached HEAD';
  if (current === expected) return current;
  throw new Error(`Expected to be on ${expected}, but on "${current}".${because ? ` ${because}` : ''}\nRecover with:\n  ${recoveryHint}`);
}
