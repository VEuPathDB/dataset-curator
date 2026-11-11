import { readFileSync } from 'node:fs';

/** plugin.json is three levels up from shared/scripts/lib and four from skills/<name>/scripts/lib. */
export const pluginVersion = () => {
  for (const rel of ['../../../.claude-plugin/plugin.json', '../../../../.claude-plugin/plugin.json']) {
    try {
      return JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf-8')).version;
    } catch { /* try the next location */ }
  }
  throw new Error('Cannot read .claude-plugin/plugin.json; run this script from the skill or from shared/scripts');
};
