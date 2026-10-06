import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { shellAppArtifacts } from './add-vertical/shell-files';
import { createAppRuntimeConfig } from './app-files';
import type { UltramodernBridgeConfig } from './bridge-config';
import { resolveRemoteRefs } from './descriptors';
import {
  projectAddedShellDevelopmentOverlay,
  projectAddedVerticalDevelopmentOverlay,
  projectResolvedDevelopmentOverlay,
} from './development-overlay-projection';
import { formatGeneratedSourceCandidates } from './fs-io';
import {
  createAppModernConfig,
  createRemoteModuleFederationConfig,
  createShellModuleFederationConfig,
} from './module-federation';
import { createAppPackage } from './package-json';
import { createPublicWebAppArtifacts } from './public-surface';
import { resolveWorkspaceRenderer } from './renderer-profile';
import type { ResolvedPackageSource, WorkspaceApp } from './types';
import { preserveConsumerWorkspaceArtifacts } from './workspace-artifact-ownership';

type Source = { relativePath: string; content: string };

type GeneratedConfigProjectionEvidence = {
  configRelativePath: string;
  originalConfigSha256: string;
  canonicalScriptInputs: ReadonlyMap<string, string>;
  // Authored replacements of known config inputs remain read-only. They never
  // receive an artifact receipt authorizing projected content.
  preservedScriptInputs: ReadonlyMap<string, string>;
  artifacts: ReadonlyMap<
    string,
    { originalSha256: string; projectedSha256: ReadonlySet<string> }
  >;
};

export type GeneratedConfigProjection = Readonly<{
  kind: 'canonical-generated-config-projection';
}>;

const verifiedProjections = new WeakMap<
  GeneratedConfigProjection,
  GeneratedConfigProjectionEvidence
>();

// Generated React configs read workspace policy through
// presetUltramodernWorkspace, so the topology is a consumed config input. Its
// generated revision exists only after the generator writes it; the owning
// operation binds those exact bytes before any consumed-input check.
const WORKSPACE_POLICY_INPUT = 'topology/reference-topology.json';
const workspacePolicyRevisions = new WeakMap<
  GeneratedConfigProjection,
  Set<string>
>();

/** Bind the generator's own topology revision to its config projections. */
export function projectGeneratedWorkspacePolicy(
  projections: readonly GeneratedConfigProjection[],
  content: string,
): void {
  const [formatted] = formatGeneratedSourceCandidates([
    [WORKSPACE_POLICY_INPUT, content],
  ]);
  for (const projection of projections) {
    const revisions = workspacePolicyRevisions.get(projection);
    if (!revisions) continue;
    revisions.add(sha256(content));
    revisions.add(sha256(formatted));
  }
}

/** Bind the topology the generator has just written in its staging root. */
export function projectWrittenWorkspacePolicy(
  projections: readonly GeneratedConfigProjection[],
  workspaceRoot: string,
): void {
  projectGeneratedWorkspacePolicy(
    projections,
    fs.readFileSync(path.join(workspaceRoot, WORKSPACE_POLICY_INPUT), 'utf8'),
  );
}

export function generatedConfigProjectionEvidence(
  projection: GeneratedConfigProjection,
): GeneratedConfigProjectionEvidence {
  const evidence = verifiedProjections.get(projection);
  if (!evidence) throw new Error('Unverified generated config projection.');
  return evidence;
}

const sha256 = (source: string) =>
  createHash('sha256').update(source).digest('hex');
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

/** These inputs determine generated entry, renderer and server composition. */
function entryInputs(app: WorkspaceApp, finalizeIdentities = false) {
  const {
    verticalRefs,
    deliveryUnit,
    rendererIdentity,
    rendererIdentities,
    routerBindings,
    ...rest
  } = app;
  const identity = (value: typeof rendererIdentity) => {
    if (!value) return value;
    const { buildId, ...entry } = value;
    return entry;
  };
  return {
    ...rest,
    ...(finalizeIdentities
      ? {}
      : { rendererIdentity: identity(rendererIdentity), routerBindings }),
    rendererIdentities:
      !finalizeIdentities && rendererIdentities
        ? Object.fromEntries(
            Object.entries(rendererIdentities).map(([name, value]) => [
              name,
              identity(value),
            ]),
          )
        : undefined,
  };
}

function appSources(options: {
  scope: string;
  app: WorkspaceApp;
  apps: WorkspaceApp[];
  packageSource: ResolvedPackageSource;
  enableTailwind: boolean;
  bridge?: UltramodernBridgeConfig;
}) {
  const { scope, app, apps, packageSource, enableTailwind, bridge } = options;
  const verticals = apps.filter(candidate => candidate.kind === 'vertical');
  const remotes =
    app.kind === 'shell' ? resolveRemoteRefs(app, verticals) : verticals;
  const config: Source = {
    relativePath: `${app.directory}/modern.config.ts`,
    content: createAppModernConfig(app, enableTailwind),
  };
  const artifacts: Source[] = [
    ...(app.kind === 'shell'
      ? shellAppArtifacts(
          scope,
          packageSource,
          enableTailwind,
          verticals,
          bridge,
          app,
        ).artifacts
      : [config]),
    {
      relativePath: `${app.directory}/package.json`,
      content: json(
        createAppPackage(
          scope,
          app,
          packageSource,
          enableTailwind,
          verticals,
          bridge,
        ),
      ),
    },
  ];
  const scriptInputs = [config];
  if (resolveWorkspaceRenderer(app) === 'react') {
    const federation: Source = {
      relativePath: `${app.directory}/module-federation.config.ts`,
      content:
        app.kind === 'shell'
          ? createShellModuleFederationConfig(scope, app, remotes)
          : createRemoteModuleFederationConfig(scope, app, verticals),
    };
    if (
      !artifacts.some(source => source.relativePath === federation.relativePath)
    )
      artifacts.push(federation);
    const publicWeb = createPublicWebAppArtifacts(app);
    scriptInputs.push(
      federation,
      {
        relativePath: publicWeb.routeMetadataFile.path,
        content: publicWeb.routeMetadataFile.content,
      },
      {
        relativePath: publicWeb.jsonLdHelperFile.path,
        content: publicWeb.jsonLdHelperFile.content,
      },
      {
        relativePath: publicWeb.routeHeadFile.path,
        content: publicWeb.routeHeadFile.content,
      },
      ...publicWeb.routeMetaFiles.map(file => ({
        relativePath: file.path,
        content: file.content,
      })),
      {
        relativePath: `${app.directory}/src/modern.runtime.ts`,
        content: createAppRuntimeConfig(app, scope, remotes),
      },
    );
  }
  return { config, artifacts, scriptInputs };
}

/**
 * Prove both ends of an owning build projection. A custom config or script
 * provides no authority; the original evaluator snapshot remains the baseline.
 */
export function createGeneratedConfigProjections(options: {
  workspaceRoot: string;
  scope: string;
  beforeApps: WorkspaceApp[];
  afterApps: WorkspaceApp[];
  packageSource: ResolvedPackageSource;
  beforeTailwind: boolean;
  afterTailwind: boolean;
  bridge?: UltramodernBridgeConfig;
  /** Actual owning entry discovery may finalize only the overlay identity tuple. */
  finalizeIdentities?: true;
}): GeneratedConfigProjection[] {
  const overlayPath = 'topology/local-overlays/development.json';
  const originalOverlay = JSON.parse(
    fs.readFileSync(path.join(options.workspaceRoot, overlayPath), 'utf8'),
  );
  if (
    !originalOverlay ||
    typeof originalOverlay !== 'object' ||
    Array.isArray(originalOverlay) ||
    originalOverlay.schemaVersion !== 1 ||
    !originalOverlay.ports ||
    typeof originalOverlay.ports !== 'object' ||
    Array.isArray(originalOverlay.ports)
  )
    throw new Error(
      'Generated development overlay projection requires validated workspace data.',
    );
  const addedApps = options.afterApps.filter(
    app => !options.beforeApps.some(before => before.id === app.id),
  );
  if (
    options.finalizeIdentities ? addedApps.length !== 0 : addedApps.length !== 1
  )
    return [];
  const addedApp = addedApps[0];
  let projectedOverlay: Record<string, any>;
  if (options.finalizeIdentities) {
    projectedOverlay = projectResolvedDevelopmentOverlay(
      options.scope,
      originalOverlay,
      options.afterApps.filter(app => {
        const original = options.beforeApps.find(
          before => before.id === app.id,
        );
        return (
          !isDeepStrictEqual(original?.deliveryUnit, app.deliveryUnit) ||
          !isDeepStrictEqual(original?.routerBindings, app.routerBindings)
        );
      }),
    );
  } else {
    if (!addedApp) return [];
    projectedOverlay =
      addedApp.kind === 'shell'
        ? projectAddedShellDevelopmentOverlay(originalOverlay, addedApp)
        : projectAddedVerticalDevelopmentOverlay(
            options.scope,
            originalOverlay,
            options.beforeApps.filter(app => app.kind === 'vertical'),
            addedApp,
          );
  }
  const beforeOverlay: Source = {
    relativePath: overlayPath,
    content: json(originalOverlay),
  };
  const afterOverlay: Source = {
    relativePath: overlayPath,
    content: json(projectedOverlay),
  };
  const projections: GeneratedConfigProjection[] = [];
  for (const beforeApp of options.beforeApps) {
    const afterApp = options.afterApps.find(app => app.id === beforeApp.id);
    if (
      !afterApp ||
      !isDeepStrictEqual(
        entryInputs(beforeApp, options.finalizeIdentities),
        entryInputs(afterApp, options.finalizeIdentities),
      )
    )
      continue;
    const before = appSources({
      ...options,
      app: beforeApp,
      apps: options.beforeApps,
      enableTailwind: options.beforeTailwind,
    });
    const after = appSources({
      ...options,
      app: afterApp,
      apps: options.afterApps,
      enableTailwind: options.afterTailwind,
    });
    const originalCandidates = [
      ...before.artifacts,
      ...before.scriptInputs,
      beforeOverlay,
    ];
    const { canonicalGeneratedPaths } = preserveConsumerWorkspaceArtifacts(
      options.workspaceRoot,
      originalCandidates,
    );
    if (!canonicalGeneratedPaths.has(before.config.relativePath)) continue;
    const originalHash = (relative: string) =>
      sha256(
        fs.readFileSync(path.join(options.workspaceRoot, relative), 'utf8'),
      );
    const nextSources = options.finalizeIdentities
      ? [afterOverlay]
      : [...after.artifacts, afterOverlay];
    const formatted = formatGeneratedSourceCandidates(
      nextSources.map(source => [source.relativePath, source.content] as const),
    );
    const artifacts = new Map<
      string,
      { originalSha256: string; projectedSha256: ReadonlySet<string> }
    >();
    for (const [index, source] of nextSources.entries()) {
      if (!canonicalGeneratedPaths.has(source.relativePath)) continue;
      artifacts.set(source.relativePath, {
        originalSha256: originalHash(source.relativePath),
        projectedSha256: new Set([
          sha256(source.content),
          sha256(formatted[index]),
        ]),
      });
    }
    const projection: GeneratedConfigProjection = Object.freeze({
      kind: 'canonical-generated-config-projection',
    });
    if (
      resolveWorkspaceRenderer(beforeApp) === 'react' &&
      fs.existsSync(path.join(options.workspaceRoot, WORKSPACE_POLICY_INPUT))
    ) {
      const revisions = new Set<string>();
      artifacts.set(WORKSPACE_POLICY_INPUT, {
        originalSha256: originalHash(WORKSPACE_POLICY_INPUT),
        projectedSha256: revisions,
      });
      workspacePolicyRevisions.set(projection, revisions);
    }
    verifiedProjections.set(projection, {
      configRelativePath: before.config.relativePath,
      originalConfigSha256: originalHash(before.config.relativePath),
      canonicalScriptInputs: new Map(
        before.scriptInputs
          .filter(source => canonicalGeneratedPaths.has(source.relativePath))
          .map(source => [
            source.relativePath,
            originalHash(source.relativePath),
          ]),
      ),
      preservedScriptInputs: new Map(
        before.scriptInputs
          .filter(
            source =>
              !canonicalGeneratedPaths.has(source.relativePath) &&
              fs.existsSync(
                path.join(options.workspaceRoot, source.relativePath),
              ),
          )
          .map(source => [
            source.relativePath,
            originalHash(source.relativePath),
          ]),
      ),
      artifacts,
    });
    projections.push(projection);
  }
  return projections;
}
