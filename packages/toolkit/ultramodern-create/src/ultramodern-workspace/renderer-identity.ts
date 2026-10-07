import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import {
  assertRendererProfileCompatibility,
  DELIVERY_UNIT_IDENTITY_FIELDS,
  immutableRendererRouterBindings,
  type RendererRouterBinding,
  type RendererRouterBindings,
  type RouterPackageBinding,
  type UltramodernBuildArtifact,
  validateRendererIdentity,
  validateRendererProfile,
  validateRendererRouterBindings,
  validateUltramodernBuildArtifact,
} from '@modern-js/backend-federation-contracts';
import { resolveCandidateRendererProfile } from '@modern-js/ultramodern-app-tools';
import { yaml } from '@modern-js/utils';
import { createBuildMarker, createDeliveryUnitRecord } from './delivery-unit';
import { appEmitsBrowserUi } from './descriptors';
import { captureWorkspaceRendererEvaluations } from './renderer-config-evaluation';
import { isNativeRendererPackage } from './renderer-generations';
import {
  getRendererGenerationProfile,
  isApplicationRenderer,
} from './renderer-profile';
import type {
  ApplicationRenderer,
  RendererGenerationProfile,
  WorkspaceApp,
  WorkspaceRendererIdentity,
  WorkspaceRendererProfile,
} from './types';
import {
  assertAuthoredRendererDependencyPins,
  assertRendererDependencies,
} from './validation/renderer';
import { readRendererFrameworkPackageEvidence } from './validation/renderer-framework-evidence';

export type WorkspaceRendererEvaluation = {
  renderer: ApplicationRenderer;
  entries: readonly { entryName: string; isMainEntry: boolean }[];
  primaryEntryName: string;
  routerBindings: RendererRouterBindings;
};

function bindRouterProviderReleaseVersions(
  bindings: RendererRouterBindings,
  generation: RendererGenerationProfile,
): RendererRouterBindings {
  const selected = generation.profile.router;
  if (!isNativeRendererPackage(selected.name))
    return immutableRendererRouterBindings(bindings);
  const evidence = readRendererFrameworkPackageEvidence(selected.name);
  if (evidence.kind !== 'release-cohort')
    return immutableRendererRouterBindings(bindings);
  if (selected.version !== evidence.version) {
    throw new Error(
      `Router ${selected.name} profile disagrees with its authenticated producer version.`,
    );
  }
  const candidate = resolveCandidateRendererProfile(generation.renderer);
  if (candidate.router.name !== selected.name) {
    throw new Error(
      `Router ${selected.name} profile disagrees with its owning source package.`,
    );
  }
  const bindProvider = (
    provider: RouterPackageBinding,
  ): RouterPackageBinding => {
    if (provider.name !== selected.name) return provider;
    if (
      provider.version !== candidate.router.version &&
      provider.version !== evidence.version
    ) {
      throw new Error(
        `Router ${selected.name} captured provider version ${provider.version} disagrees with its source profile and authenticated producer version.`,
      );
    }
    return { ...provider, version: evidence.version };
  };
  const resolved: Record<string, RendererRouterBinding> = {};
  for (const [entryName, binding] of Object.entries(bindings)) {
    // Only these authenticated native infrastructure owners author the source
    // profile tuple. Foreign router owners retain their captured identities.
    if (binding.owner !== `${selected.name}-infrastructure`) {
      resolved[entryName] = binding;
      continue;
    }
    const defaultProvider = bindProvider(binding.defaultProvider);
    if (binding.evidence === 'provider-registry') {
      resolved[entryName] = {
        ...binding,
        defaultProvider,
        providers: binding.providers.map(bindProvider),
      };
    } else {
      resolved[entryName] = {
        ...binding,
        defaultProvider,
        providers: [bindProvider(binding.providers[0])],
      };
    }
  }
  return immutableRendererRouterBindings(resolved);
}

/** Local metadata is a projection; selection is resolved only from app config. */
export async function reconcileWorkspaceRendererIdentities(
  workspaceRoot: string,
  scope: string,
  apps: readonly WorkspaceApp[],
  options: {
    env?: string;
    command?: string;
    evaluations?: ReadonlyMap<string, WorkspaceRendererEvaluation>;
    immutableArtifacts?: ReadonlyMap<string, UltramodernBuildArtifact>;
  } = {},
): Promise<WorkspaceApp[]> {
  const evaluations =
    options.evaluations ??
    (await captureWorkspaceRendererEvaluations(workspaceRoot, apps, options));
  const workspaceConfigPath = path.join(workspaceRoot, 'pnpm-workspace.yaml');
  const workspaceCatalogs = fs.existsSync(workspaceConfigPath)
    ? (yaml.load(fs.readFileSync(workspaceConfigPath, 'utf8')) as {
        catalog?: Record<string, string>;
        catalogs?: Record<string, Record<string, string>>;
      })
    : {};
  const reconciled: WorkspaceApp[] = [];
  for (const app of apps) {
    const manifestPath = path.join(
      workspaceRoot,
      app.directory,
      'package.json',
    );
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (typeof manifest.version !== 'string' || !manifest.version.trim()) {
      throw new Error(
        `${manifestPath} requires a package version for renderer identity.`,
      );
    }
    const {
      renderer: _renderer,
      rendererIdentity: _identity,
      rendererIdentities: _identities,
      rendererProfile: _profile,
      routerBindings: _routerBindings,
      rendererGenerationProfile: _generation,
      rendererCapabilities: _capabilities,
      ...membership
    } = app;
    let resolved: WorkspaceApp;
    let entryNames: string[] = [];
    if (!appEmitsBrowserUi(app)) {
      assertRendererDependencies(
        manifest,
        'none',
        undefined,
        workspaceCatalogs,
      );
      resolved = { ...membership, renderer: 'none' };
    } else {
      const evaluation = evaluations.get(app.id);
      if (!evaluation)
        throw new Error(
          `Application ${app.id} is missing its checked config evaluation.`,
        );
      if (!isApplicationRenderer(evaluation.renderer)) {
        throw new Error(
          `Application ${app.id} has no resolved renderer from modern.config.`,
        );
      }
      const generation = getRendererGenerationProfile(evaluation.renderer);
      assertAuthoredRendererDependencyPins(
        manifest,
        generation,
        workspaceCatalogs,
      );
      const entryResolution = evaluation;
      if (
        !entryResolution ||
        !entryResolution.entries.length ||
        !entryResolution.entries.some(
          entry => entry.entryName === entryResolution.primaryEntryName,
        )
      ) {
        throw new Error(
          `Application ${app.id} requires entry identities from the owning entry resolver.`,
        );
      }
      const entryName = entryResolution.primaryEntryName;
      entryNames = entryResolution.entries.map(entry => entry.entryName);
      if (
        !validateRendererRouterBindings(
          evaluation.routerBindings,
          entryNames,
          'routerBindings',
          generation.routerFrameworks,
        ).ok
      ) {
        throw new Error(
          `Application ${app.id} has invalid router bindings from the owning entry resolver.`,
        );
      }
      const routerBindings = bindRouterProviderReleaseVersions(
        evaluation.routerBindings,
        generation,
      );
      if (
        !validateRendererRouterBindings(
          routerBindings,
          entryNames,
          'routerBindings',
          generation.routerFrameworks,
        ).ok
      ) {
        throw new Error(
          `Application ${app.id} has invalid router bindings for its authenticated producer.`,
        );
      }
      resolved = {
        ...membership,
        renderer: evaluation.renderer,
        rendererProfile: generation.profile,
        rendererGenerationProfile: generation,
        rendererCapabilities: { ...generation.capabilities },
        routerBindings,
        rendererIdentity: {
          renderer: evaluation.renderer,
          appId: app.id,
          entryName,
          protocolVersion: 1,
          buildId: '',
        },
      };
    }
    const buildMarker = createBuildMarker(scope, resolved, manifest.version);
    resolved.deliveryUnit = createDeliveryUnitRecord(
      scope,
      resolved,
      manifest.version,
    );
    if (resolved.rendererIdentity) {
      resolved.rendererIdentity = {
        ...resolved.rendererIdentity,
        buildId: buildMarker,
      };
      resolved.rendererIdentities = Object.fromEntries(
        entryNames.map(entryName => {
          const identity = { ...resolved.rendererIdentity!, entryName };
          return [
            entryName,
            {
              ...identity,
              buildId: createBuildMarker(
                scope,
                { ...resolved, rendererIdentity: identity },
                manifest.version,
              ),
            },
          ];
        }),
      );
    }
    const immutable = options.immutableArtifacts?.get(app.id);
    if (immutable) assertWorkspaceRendererArtifact(resolved, immutable);
    reconciled.push(resolved);
  }
  return reconciled;
}

/** Exact ABI data, without mutable admission/generation capability claims. */
export type RendererMetadataPhase = 'resolved' | 'source-authoring';

export function rendererMetadataProjection(
  app: WorkspaceApp,
  phase: RendererMetadataPhase = 'resolved',
): {
  renderer: NonNullable<WorkspaceApp['renderer']>;
  rendererIdentity?: WorkspaceRendererIdentity;
  rendererIdentities?: Record<string, WorkspaceRendererIdentity>;
  rendererProfile?: WorkspaceRendererProfile;
  routerBindings?: RendererRouterBindings;
  rendererCapabilities?: WorkspaceApp['rendererCapabilities'];
} {
  if (!appEmitsBrowserUi(app)) return { renderer: 'none' };
  if (
    !isApplicationRenderer(app.renderer) ||
    !app.rendererProfile ||
    !app.rendererIdentity ||
    !app.rendererIdentities
  ) {
    throw new Error(
      `Application ${app.id} requires renderer identity reconciled from modern.config.`,
    );
  }
  const resolvedIdentity = app.rendererIdentity;
  const identity = validateRendererIdentity(resolvedIdentity);
  const profile = validateRendererProfile(app.rendererProfile);
  if (
    !identity.ok ||
    !profile.ok ||
    resolvedIdentity.appId !== app.id ||
    resolvedIdentity.renderer !== app.renderer ||
    app.rendererProfile.renderer !== app.renderer
  ) {
    throw new Error(
      `Application ${app.id} has an invalid renderer identity/profile projection.`,
    );
  }
  for (const [entryName, entryIdentity] of Object.entries(
    app.rendererIdentities ?? {},
  )) {
    if (
      !validateRendererIdentity(entryIdentity).ok ||
      entryIdentity.entryName !== entryName ||
      entryIdentity.appId !== app.id ||
      entryIdentity.renderer !== app.renderer ||
      entryIdentity.protocolVersion !== app.rendererProfile.protocolVersion
    ) {
      throw new Error(
        `Application ${app.id} has an invalid renderer identity for entry ${entryName}.`,
      );
    }
  }
  const primary = app.rendererIdentities[resolvedIdentity.entryName];
  if (
    !primary ||
    Object.keys(resolvedIdentity).some(
      field =>
        resolvedIdentity[field as keyof WorkspaceRendererIdentity] !==
        primary[field as keyof WorkspaceRendererIdentity],
    )
  ) {
    throw new Error(
      `Application ${app.id} primary renderer identity disagrees with its entry map.`,
    );
  }
  if (phase === 'resolved' && !app.routerBindings) {
    throw new Error(
      `Application ${app.id} requires router bindings captured from modern.config.`,
    );
  }
  if (
    app.routerBindings !== undefined &&
    !validateRendererRouterBindings(
      app.routerBindings,
      Object.keys(app.rendererIdentities),
      'routerBindings',
      getRendererGenerationProfile(app.renderer).routerFrameworks,
    ).ok
  ) {
    throw new Error(`Application ${app.id} has invalid router bindings.`);
  }
  return {
    renderer: app.renderer,
    rendererIdentity: { ...resolvedIdentity },
    ...(app.rendererIdentities
      ? { rendererIdentities: structuredClone(app.rendererIdentities) }
      : {}),
    rendererProfile: {
      renderer: app.rendererProfile.renderer,
      protocolVersion: app.rendererProfile.protocolVersion,
      compiler: { ...app.rendererProfile.compiler },
      hydration: { ...app.rendererProfile.hydration },
      router: { ...app.rendererProfile.router },
    },
    ...(app.routerBindings !== undefined
      ? { routerBindings: immutableRendererRouterBindings(app.routerBindings) }
      : {}),
    rendererCapabilities: {
      ...(
        app.rendererGenerationProfile ??
        getRendererGenerationProfile(app.renderer)
      ).capabilities,
    },
  };
}

/** Published identity is immutable even when local projection is regenerable. */
export function assertWorkspaceRendererArtifact(
  app: WorkspaceApp,
  artifact: UltramodernBuildArtifact,
): void {
  if (!validateUltramodernBuildArtifact(artifact).ok) {
    throw new Error(
      `Application ${app.id} has an invalid immutable build artifact.`,
    );
  }
  for (const field of [
    ...DELIVERY_UNIT_IDENTITY_FIELDS,
    'appId',
    'packageName',
    'version',
    'deployProfile',
    'schemaVersion',
    'kind',
  ] as const) {
    if (
      app.deliveryUnit?.[field] === undefined ||
      app.deliveryUnit[field] !== artifact.deliveryUnit[field]
    ) {
      throw new Error(
        `Application ${app.id} immutable delivery-unit identity ${field} disagrees with the resolved workspace.`,
      );
    }
  }
  const projection = rendererMetadataProjection(app);
  const ui = artifact.surfaces.ui;
  if (projection.renderer === 'none') {
    if (ui)
      throw new Error(
        `Headless unit ${app.id} cannot consume a UI build identity.`,
      );
    return;
  }
  if (!ui || !projection.rendererProfile || !projection.rendererIdentity) {
    throw new Error(
      `Application ${app.id} requires an immutable UI build identity.`,
    );
  }
  assertRendererProfileCompatibility(
    projection.rendererProfile,
    ui.rendererProfile,
  );
  if (!isDeepStrictEqual(projection.routerBindings, ui.routerBindings)) {
    throw new Error(
      `Application ${app.id} immutable router bindings disagree with the owning entry resolver.`,
    );
  }
  for (const field of [
    'renderer',
    'appId',
    'entryName',
    'protocolVersion',
    'buildId',
  ] as const) {
    if (projection.rendererIdentity[field] !== ui.rendererIdentity[field]) {
      throw new Error(
        `Application ${app.id} immutable renderer identity ${field} disagrees with modern.config.`,
      );
    }
  }
}
