import { records } from './records.js';
import { matchesBuild } from './matches-build.js';
import { ids } from './ids.js';
import { pipelineFindings } from './pipeline-findings.js';
import { entryShape } from './entry-shape.js';
import { organismRecord } from './organism-record.js';

/** Run order matters: records first, so the report's preprocess sha256s come from it. */
export const validators = [records, matchesBuild, ids, pipelineFindings, entryShape, organismRecord];
