import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { partitionName } from '../../../genome/genome-build.js';
import { recordsOrNull } from './records.js';

const NAME = 'ids';
const SAMPLE = 5;
/** GAF puts its source in column 1 and the feature ID in column 2. */
const idColumn = (datasetClass) => (datasetClass === 'GeneOntologyAssociations' ? 1 : 0);

/** Gene, transcript and protein IDs ISF loads, from each partition's transcriptInfoAndIds; null when one is gone, which records reports. */
function loadedIds(found, workArea) {
  const ids = { gene: new Set(), transcript: new Set(), protein: new Set() };
  for (const part of found.genomeBuild.partitions) {
    for (const file of Object.keys(found.trial.outputs[partitionName(part)] ?? {})) {
      const path = join(workArea, part.dir, file);
      if (!existsSync(path)) return null;
      for (const line of readFileSync(path, 'utf-8').split('\n')) {
        if (!line) continue;
        const cols = line.split('\t');
        ids.gene.add(cols[0]);
        ids.transcript.add(cols[4]);
        ids.protein.add(`${cols[4]}-p1`);
      }
    }
  }
  return ids;
}

export const ids = {
  name: NAME,
  kind: 'preprocess',
  tools: [],
  run: async ({ workArea }) => {
    const found = recordsOrNull(workArea);
    if (!found) return [];
    const loaded = loadedIds(found, workArea);
    if (!loaded) return [];
    return found.functional.datasets.flatMap((d) => {
      const known = loaded[d.ids.level];
      const where = `${d.datasetClass} ${d.name}`;
      if (!known) return [{ validator: NAME, severity: 'error', message: `${where}: ID level "${d.ids.level}" is not gene, transcript or protein` }];
      if (!existsSync(join(workArea, d.file))) return [];
      const lines = readFileSync(join(workArea, d.file), 'utf-8').split('\n').filter((l) => l && !l.startsWith('!'));
      const missing = [...new Set(lines.map((l) => l.split('\t')[idColumn(d.datasetClass)]))].filter((id) => !known.has(id));
      return missing.length
        ? [{ validator: NAME, severity: 'error', message: `${where}: ${missing.length} ${d.ids.level} IDs are not in transcriptInfoAndIds, such as ${missing.slice(0, SAMPLE).join(', ')}` }]
        : [];
    });
  }
};
