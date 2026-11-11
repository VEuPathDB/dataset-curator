import { loadManifest, readCuratedJson } from './_common.js';
import { organismsOf } from '../lib/manifest.js';
import { UPDATE_FILENAME } from './functional-update/update.js';

export const datasetClasses = ['productNames', 'GeneOntologyAssociations', 'EnzymeCommissionAssociations', 'geneName', 'comments', 'aliases'];
export const validationWorkspace = 'functional-update-validation';
export const singleEntry = true;
/** The proposal adds a history row to the organism's genome presenter instead of rendering its own. */
export const amendsPresenters = true;
export const requiredOrganismConstants = { genomeVersion: /^\S+$/ };
export const injectorDefaults = {};
export const requiredFields = [];
export const requiredInjectorProps = [];
export const UPDATE_RECORD_FILENAME = UPDATE_FILENAME;
export const ownRecordFiles = [UPDATE_FILENAME];

export const presenterNames = (dir) => [`${organismsOf(loadManifest(dir))[0]}_primary_genome_RSRC`];

export const readUpdate = (dir) => readCuratedJson(dir, UPDATE_FILENAME);
