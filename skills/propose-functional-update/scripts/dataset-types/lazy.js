import { fileURLToPath } from 'node:url';

/**
 * Runs a loader thunk (an arrow function around a dynamic import with a literal path) defined in the module at
 * importerUrl. If that import fails because the file is not in this skill (a skill carries only the dataset types it handles), throws a plain error naming
 * what is missing; a module missing from inside the loaded module is a real fault and propagates unchanged.
 */
export async function loadLazy(load, importerUrl, what) {
  try {
    return await load();
  } catch (e) {
    const own = e?.code === 'ERR_MODULE_NOT_FOUND' && String(e.message).includes(`imported from ${fileURLToPath(importerUrl)}`);
    if (own) throw new Error(`This skill does not include ${what}`, { cause: e });
    throw e;
  }
}
