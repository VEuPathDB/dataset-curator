#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { sampleAnnotationsToStf } from './lib/stf.js';

const bioproject = process.argv[2];
const datasetName = process.argv[3];
const outputBase = process.argv[4] || 'outputs';

if (!bioproject || !datasetName) {
  console.error('Usage: sample-annotations-to-stf.js <BIOPROJECT> <datasetName> [outputBase]');
  process.exit(1);
}

const annotationsPath = path.join('.curation', 'tmp', `${bioproject}_sample_annotations.json`);
const outputDir = path.join(outputBase, datasetName);

if (!fs.existsSync(annotationsPath)) {
  console.error('Annotations file not found:', annotationsPath);
  process.exit(1);
}

const { tsv, yaml } = sampleAnnotationsToStf(JSON.parse(fs.readFileSync(annotationsPath, 'utf8')));
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, 'entity-sample.tsv'), tsv);
fs.writeFileSync(path.join(outputDir, 'entity-sample.yaml'), yaml);

console.log(`Written to ${outputDir}/entity-sample.{tsv,yaml}`);
