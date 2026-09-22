import path from 'node:path';
import { readWorkspaceReleaseCohort } from '../../ultramodern-release-cohort';
import {
  checkReleaseCohortParity,
  formatReleaseCohortParityReport,
} from '../../ultramodern-workspace/cohort-parity';
import { createUltramodernConfig } from '../../ultramodern-workspace/contracts';
import { createShellHost } from '../../ultramodern-workspace/descriptors';
import {
  checkPatchParity,
  formatPatchParityReport,
} from '../../ultramodern-workspace/patch-parity';
import { validateWorkspace } from '../../ultramodern-workspace/validation/workspace';
import { createWorkspaceValidationContract } from '../../ultramodern-workspace/workspace-validation-contract';
import {
  readJsonObject,
  readUltramodernWorkspaceInputs,
  workspaceAppsFromToolingConfig,
} from '../config';
import { type CommandContext, createPackageRoot } from './context';

export function runValidate(context: CommandContext) {
  // A workspace that still carries a previous cohort's patch keeps applying it,
  // and the mismatch only shows up much later as an opaque `require.resolve`
  // failure inside `modern build`. Name the file here instead.
  const patchProblems = checkPatchParity({
    workspaceRoot: context.workspaceRoot,
    createPackageRoot,
  });
  if (patchProblems.length > 0) {
    process.stderr.write(`${formatPatchParityReport(patchProblems)}\n`);
    return 1;
  }

  const workspace = readUltramodernWorkspaceInputs(context.workspaceRoot, {
    overlay: readJsonObject(
      path.join(
        context.workspaceRoot,
        'topology/local-overlays/development.json',
      ),
    ),
  });
  const {
    config,
    verticals: remotes,
    primaryShell,
    additionalShells,
  } = workspace;
  const compactApps = workspaceAppsFromToolingConfig(
    config,
    context.workspaceRoot,
  );
  const compactPrimaryShell =
    compactApps.find(app => app.kind === 'shell') ?? createShellHost(remotes);
  // Overlay ports govern local endpoints; compact metadata retains its own
  // canonical ports and policy rather than adopting the observed projections.
  const compactConfig = createUltramodernConfig(
    config.workspace.packageScope,
    'workspace-validation-contract',
    { strategy: 'workspace', modernPackageVersion: 'workspace:*' },
    compactApps,
    config.features.tailwind,
    undefined,
    additionalShells,
    compactPrimaryShell,
    remotes,
  ) as Record<string, unknown>;
  const declaredCompact = readJsonObject(config.sourcePath);
  const compactTopology = compactConfig.topology as {
    apps: Array<{
      id: string;
      deploy: { cloudflare: Record<string, unknown> };
    }>;
  };
  for (const app of compactTopology.apps) {
    const declared = declaredCompact.topology?.apps?.find(
      (entry: { id: string }) => entry.id === app.id,
    )?.deploy?.cloudflare;
    // Business routes and assertions are consumer inputs, independently
    // exercised by the runtime proof. Framework deployment fields retain
    // their canonical expectations.
    for (const key of [
      'routes',
      'distributedSsrProofRoutes',
      'jsonSmokeChecks',
    ]) {
      if (declared && Object.hasOwn(declared, key)) {
        app.deploy.cloudflare[key] = declared[key];
      }
    }
  }
  // Same class of drift as a stale cohort patch, for the authenticated cohort
  // projection: a version-only adoption keeps the previous cohort's
  // `source.commit`, and nothing downstream reads it, so the misreported
  // provenance is silent. An installed cohort must ship a readable projection;
  // a local-source workspace has none to compare against.
  const cohortProblem = checkReleaseCohortParity({
    workspaceRoot: context.workspaceRoot,
    createPackageRoot,
    requireTemplate: config.packageSource?.strategy === 'install',
  });
  if (cohortProblem) {
    process.stderr.write(`${formatReleaseCohortParityReport(cohortProblem)}\n`);
    return 1;
  }
  const releaseCohort =
    config.packageSource?.strategy === 'install'
      ? readWorkspaceReleaseCohort(context.workspaceRoot)
      : undefined;
  const contract = createWorkspaceValidationContract(
    config.workspace.packageScope,
    config.features.tailwind,
    remotes,
    releaseCohort,
    additionalShells,
    primaryShell,
    compactConfig,
    // Team attribution is authored configuration. The validator separately
    // checks each owner's package/path against the normalized app topology.
    readJsonObject(path.join(context.workspaceRoot, 'topology/ownership.json')),
    undefined,
    context.workspaceRoot,
  );

  validateWorkspace(context.workspaceRoot, contract);
  return 0;
}
