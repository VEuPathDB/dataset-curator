import { createHash } from 'node:crypto';
import { join } from 'node:path';

// Releases are YYYY-MM; anything else in the corpus root (latest, _v2 copies, scripts) is not one.
const RELEASE = /^\d{4}-\d{2}$/;

export const datasetIdOf = (datasetName) => `DS_${createHash('sha1').update(datasetName).digest('hex').slice(0, 10)}`;

/** Where one organism's STF goes, relative to @@manualDeliveryDir@@. */
export function corpusDir(corpus, release, { datasetName, abbrev }) {
  return corpus.layout === 'per-dataset'
    ? join(corpus.root, release, 'final', datasetName)
    : join(corpus.root, release, 'incoming', datasetName, abbrev);
}

function earlierReleases(remote, root, release) {
  const releases = remote.list(root);
  if (releases === null) throw new Error(`Cannot read the STF corpus at ${remote.where(root)}; check manualDelivery in env.json`);
  return releases.filter((r) => RELEASE.test(r) && r < release);
}

/**
 * Dataset names already published in a release before release (or retired),
 * read through remote under manualRoot. The target release is this build's,
 * so a re-delivery of the same dataset passes.
 */
export function corpusClashes({ remote, manualRoot, corpus, release, datasets }) {
  const root = join(manualRoot, corpus.root);
  const earlier = earlierReleases(remote, root, release);
  if (corpus.layout === 'per-dataset') {
    const published = earlier.map((r) => [r, new Set(remote.list(join(root, r, 'final')) ?? [])]);
    const retired = new Set((remote.readText(join(root, 'retired-datasets.tsv')) ?? '').split('\n')
      .filter((l) => l && !l.startsWith('#')).map((l) => l.split('\t')[0]));
    return datasets.flatMap(({ datasetName }) => {
      // Later releases link earlier datasets, so only the first release is the real one.
      const first = published.find(([, names]) => names.has(datasetName));
      return [
        ...(first ? [`${datasetName} is already in ${first[0]}/final`] : []),
        ...(retired.has(datasetName) ? [`${datasetName} is retired (retired-datasets.tsv)`] : [])
      ];
    });
  }
  return datasets.flatMap(({ datasetName, abbrev, project }) => {
    const id = datasetIdOf(datasetName);
    return earlier.flatMap((r) => {
      const where = `${r}/final/${project}/${abbrev}`;
      const tsv = remote.readText(join(root, where, 'entity-sample.tsv'));
      if (!tsv) return [];
      const [header, ...rows] = tsv.split('\n');
      const col = header.split('\t').indexOf('dataset_id');
      return col >= 0 && rows.some((row) => row.split('\t')[col] === id) ? [`${datasetName} (${id}) is already in ${where}`] : [];
    });
  });
}

/** What a person runs once the dataset's STF is on the server; re-runnable. */
export function corpusStep(corpus, release, manualDelivery) {
  const root = join(manualDelivery.root, corpus.root);
  return corpus.layout === 'per-dataset'
    ? `ssh ${manualDelivery.host} '${join(root, 'make-cumulative-links.sh')} ${release}'`
    : `Merge ${manualDelivery.host}:${root}/${release}/incoming/ into its ${release}/final/ by hand (study-wrangler harmonization; not automated yet)`;
}
