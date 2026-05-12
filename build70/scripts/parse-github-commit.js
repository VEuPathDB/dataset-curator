#!/usr/bin/env node

import https from 'https';
import { execSync } from 'child_process';

const commitUrl = process.argv[2];
if (!commitUrl) {
  console.error('Usage: parse-github-commit.js <github-commit-url>');
  process.exit(1);
}

const shaMatch = commitUrl.match(/\/commit\/([a-f0-9]+)/);
if (!shaMatch) {
  console.error('Could not extract SHA from URL:', commitUrl);
  process.exit(1);
}
const sha = shaMatch[1];

// Local checkout of ApiCommonPresenters (relative to curation workspace)
const REPO_PATH = 'veupathdb-repos/ApiCommonPresenters';

function fetchUrl(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      headers: { 'User-Agent': 'dataset-curator', ...headers }
    };
    https.get(options, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        fetchUrl(res.headers.location, headers).then(resolve).catch(reject);
        return;
      }
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    }).on('error', reject);
  });
}

async function resolveBioprojectAccession(numericId) {
  const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=bioproject&id=${numericId}&retmode=json`;
  const result = await fetchUrl(url);
  if (result.status !== 200) {
    throw new Error(`NCBI esummary failed (${result.status}) for id ${numericId}`);
  }
  const data = JSON.parse(result.body);
  const uid = (data.result.uids || [])[0] || Object.keys(data.result).find(k => k !== 'uids');
  if (!uid || !data.result[uid]) {
    throw new Error(`No result from NCBI esummary for id ${numericId}`);
  }
  return data.result[uid].project_acc;
}

async function main() {
  // Use local git checkout — repo is private
  let diff;
  try {
    diff = execSync(`git -C ${REPO_PATH} show ${sha}`, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  } catch (err) {
    console.error('git show failed:', err.message);
    process.exit(1);
  }
  const lines = diff.split('\n');
  const addedLines = lines.filter(l => l.startsWith('+')).join('\n');

  // Extract datasetName — required
  const nameMatch = addedLines.match(/datasetPresenter\s+name="([^"]+)"/);
  if (!nameMatch) {
    console.error('Could not find datasetPresenter name in diff');
    process.exit(1);
  }
  const datasetName = nameMatch[1];

  // Extract projectName — first try from attribute, then from the +++ filename line
  let projectName = null;
  const projectNameAttrMatch = addedLines.match(/datasetPresenter[^>]*projectName="([^"]+)"/);
  if (projectNameAttrMatch) {
    projectName = projectNameAttrMatch[1];
  } else {
    const fileLineMatch = lines.find(l => l.startsWith('+++ b/'));
    if (fileLineMatch) {
      const fileNameMatch = fileLineMatch.match(/([^/]+)\.xml$/);
      if (fileNameMatch) projectName = fileNameMatch[1];
    }
  }

  // Strip CDATA markers before matching URLs
  const addedLinesClean = addedLines.replace(/<!\[CDATA\[|\]\]>/g, '');
  let bioprojectAccession = null;
  const bioprojectMatch = addedLinesClean.match(/ncbi\.nlm\.nih\.gov\/bioproject\/([^\s<"&\]]+)/);
  if (bioprojectMatch) {
    const raw = bioprojectMatch[1].replace(/\/$/, '');
    if (/^\d+$/.test(raw)) {
      bioprojectAccession = await resolveBioprojectAccession(raw);
    } else {
      bioprojectAccession = raw;
    }
  }

  const pubmedMatch = addedLinesClean.match(/<pubmedId>(\d+)<\/pubmedId>/);
  const pubmedId = pubmedMatch ? pubmedMatch[1] : null;

  const classNameMatch = addedLines.match(/templateInjector[^>]*className="([^"]+)"/);
  const className = classNameMatch ? classNameMatch[1] : null;
  const RNASEQ_CLASSES = [
    'org.apidb.apicommon.model.datasetInjector.RNASeq',
    'org.apidb.apicommon.model.datasetInjector.RNASeqEbi',
  ];
  if (!className || !RNASEQ_CLASSES.includes(className)) {
    console.error(`NOT_RNASEQ: className="${className ?? 'not found'}" — skipping`);
    process.exit(2);
  }

  console.log(JSON.stringify({ datasetName, projectName, bioprojectAccession, pubmedId }, null, 2));
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
