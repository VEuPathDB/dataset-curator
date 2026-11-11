/** The released site's GFF for an organism: Current_Release/<organismNameForFiles>/gff/data/ on its project site. */
export const gffDirectoryUrl = (project, nameForFiles) => `https://${project.toLowerCase()}.org/common/downloads/Current_Release/${nameForFiles}/gff/data/`;

export function pickGff(html, dirUrl) {
  const names = [...new Set([...html.matchAll(/href="([^"/?#]+\.gff)"/g)].map((m) => m[1]))];
  if (names.length !== 1) throw new Error(`${dirUrl} lists ${names.length} .gff files (${names.join(', ') || 'none'}); expected one`);
  return names[0];
}

/** PlasmoDB-68_Pfalciparum3D7.gff → "68". */
export const releaseOf = (file) => /-(\d+)_/.exec(file)?.[1] ?? null;

export async function fetchReleasedGff({ project, nameForFiles, fetchImpl = fetch }) {
  const dir = gffDirectoryUrl(project, nameForFiles);
  const text = async (url) => {
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return res.text();
  };
  const file = pickGff(await text(dir), dir);
  return { url: `${dir}${file}`, file, release: releaseOf(file), text: await text(`${dir}${file}`) };
}
