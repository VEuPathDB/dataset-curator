import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { proposalRelativePath } from './manifest.js';
import { verifiableTicket } from './verification-ops.js';
import { validatorsFor } from '../dataset-types/validators.js';
import { runValidators, verdictOf, formatReportComment, REPORT_SCHEMA_VERSION } from './validation.js';
import { createToolResolver, ASK } from './validation-env.js';
import { openVerifyWorkspace, openLoadWorkspace } from './validation-workspace.js';
import { buildFitnessValidator } from './build-fitness.js';
import { excludeScratch, SCRATCH_DIR } from './config.js';

export const reportPath = (repoPath, accession) => join(repoPath, SCRATCH_DIR, 'tmp', 'verify', `${accession}.json`);

/**
 * Validates a merged proposal as origin/master has it, with the tools of its
 * verify workspace under the root the data loader named, plus buildFitness when
 * against names a ref. refresh moves that workspace to the current refs and
 * rebuild reruns its build. Writes the report under .curation/tmp/verify/ and,
 * unless post is false, posts it on the ticket for mark-ready. Returns { report, path, ticket }.
 */
export async function validateProposal({ git, ticket, repoPath, accession, workspace, refresh = false, rebuild = false, against = null, post = true, exec, validators }) {
  const { ticket: ref, manifest } = verifiableTicket(git, accession, 'it is not validated');
  const chosen = validators ?? validatorsFor(manifest.datasetType);
  if (!chosen.length) throw new Error(`No validators for datasetType "${manifest.datasetType}"; verify ${accession} by hand`);
  if (against && !git.refExists(against)) throw new Error(`${against} does not exist; fetch it or name another ref`);
  const tools = createToolResolver(openVerifyWorkspace({ root: workspace, datasetType: manifest.datasetType, accession, refresh, rebuild, exec }), { exec });
  const relDir = proposalRelativePath(accession);
  const scratch = mkdtempSync(join(tmpdir(), 'validate-'));
  let findings;
  try {
    git.exportTree('origin/master', relDir, scratch);
    const ctx = { proposalDir: join(scratch, relDir), manifest, git, against, exec };
    findings = await runValidators([...chosen, ...(against ? [buildFitnessValidator] : [])], ctx, tools.resolveTool);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  const report = {
    schemaVersion: REPORT_SCHEMA_VERSION, accession, datasetType: manifest.datasetType,
    proposalTree: git.objectId('origin/master', relDir), against, workspace: tools.workspace,
    tools: tools.versions(), repos: tools.repos(), findings, verdict: verdictOf(findings)
  };
  excludeScratch(repoPath);
  const path = reportPath(repoPath, accession);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(report, null, 2) + '\n');
  if (post) await ticket.comment(ref, formatReportComment(report));
  return { report, path, ticket: ref };
}

/** For load: validate({ proposalDir, manifest }) runs the content validators of the proposal's type in loads/<rebuild>/. */
export function contentValidation({ workspace, rebuildBranch, refresh = false, exec }) {
  const resolvers = new Map();
  const toolsFor = (datasetType) => {
    if (!resolvers.has(datasetType)) {
      resolvers.set(datasetType, createToolResolver(openLoadWorkspace({ root: workspace, datasetType, rebuildBranch, refresh, exec }), { exec }));
    }
    return resolvers.get(datasetType);
  };
  return async ({ proposalDir, manifest }) => {
    const validators = validatorsFor(manifest.datasetType);
    if (!validators.length) return [];
    if (!workspace) throw new Error(`--workspace is required for ${manifest.datasetType}: ${ASK}`);
    return runValidators(validators, { proposalDir, manifest, exec }, toolsFor(manifest.datasetType).resolveTool);
  };
}
