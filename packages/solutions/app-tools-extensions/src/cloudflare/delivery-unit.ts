import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import {
  assertRendererProfileCompatibility,
  assertUltramodernBuildArtifact,
  type DeliveryUnitIdentity,
  formatBackendFederationValidationErrors,
  immutableRendererRouterBindings,
  nonEmptyString,
  type RendererIdentity,
  type RendererProfile,
  type RendererRouterBindings,
  toDeliveryUnitIdentity,
  ULTRAMODERN_BUILD_ARTIFACT_FILE,
  ULTRAMODERN_BUILD_ARTIFACT_PATH,
  validateRendererIdentity,
  validateRendererProfile,
  validateRendererRouterBindings,
} from '@modern-js/backend-federation-contracts';
import { fs as fse } from '@modern-js/utils';
import { resolveUltramodernReleaseIdentity } from '../release-identity';
import { isRecord } from './utils';

const TOPOLOGY_PATH = 'topology/reference-topology.json';

export type DeliveryUnitStamp = DeliveryUnitIdentity & {
  surfaces: {
    ui?: DeliveryUnitIdentity & {
      surface: 'ui';
      rendererIdentity: RendererIdentity;
      rendererProfile: RendererProfile;
      routerBindings: RendererRouterBindings;
    };
    api?: DeliveryUnitIdentity & { surface: 'api' };
  };
};

type TopologyAppResolution = {
  app?: Record<string, unknown>;
  workspaceRoot: string;
};

const findWorkspaceRoot = async (
  appDirectory: string,
): Promise<string | undefined> => {
  let current = path.resolve(appDirectory);

  for (;;) {
    if (await fse.pathExists(path.join(current, TOPOLOGY_PATH))) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return undefined;
    }

    current = parent;
  }
};

const stampReleaseIdentity = (
  identity: DeliveryUnitIdentity,
  workspaceRoot: string,
): DeliveryUnitIdentity => {
  if (identity.sourceRevision !== 'workspace') {
    return identity;
  }
  return {
    ...identity,
    ...resolveUltramodernReleaseIdentity({
      generationBuildMarker: identity.buildMarker,
      unitId: identity.unitId,
      workspaceRoot,
    }),
  };
};

const resolveTopologyApp = async (
  appDirectory: string,
): Promise<TopologyAppResolution | undefined> => {
  const workspaceRoot = await findWorkspaceRoot(appDirectory);
  if (!workspaceRoot) {
    return undefined;
  }

  const topology: unknown = await fse.readJSON(
    path.join(workspaceRoot, TOPOLOGY_PATH),
  );
  if (
    !isRecord(topology) ||
    !isRecord(topology.shell) ||
    !Array.isArray(topology.verticals) ||
    (topology.shells !== undefined && !Array.isArray(topology.shells))
  ) {
    throw new Error(
      '[cloudflare-delivery-unit] Invalid declared reference topology.',
    );
  }
  const apps = [
    topology.shell,
    ...topology.verticals,
    ...(Array.isArray(topology.shells) ? topology.shells : []),
  ];

  const resolvedAppDirectory = path.resolve(appDirectory);
  const app = apps.find(candidate => {
    if (!isRecord(candidate)) {
      return false;
    }
    const appPath = nonEmptyString(candidate.path);
    return (
      appPath !== undefined &&
      path.resolve(workspaceRoot, appPath.replace(/^\.\/+/u, '')) ===
        resolvedAppDirectory
    );
  });
  if (!isRecord(app)) {
    throw new Error(
      `[cloudflare-delivery-unit] ${appDirectory} is missing from the declared reference topology.`,
    );
  }
  return {
    app,
    workspaceRoot,
  };
};

const createTopologyDeliveryUnitStamp = (
  identity: DeliveryUnitIdentity,
  app: Record<string, unknown>,
): DeliveryUnitStamp => {
  const surfaceProfile = nonEmptyString(app.surfaceProfile);
  if (
    surfaceProfile !== undefined &&
    !['api-only', 'ui-only', 'full-stack'].includes(surfaceProfile)
  ) {
    throw new Error(
      '[cloudflare-delivery-unit] Declared app has an invalid surface profile.',
    );
  }
  const emitsUi = surfaceProfile !== 'api-only';
  const emitsApi = surfaceProfile !== 'ui-only';
  let ui: DeliveryUnitStamp['surfaces']['ui'];
  if (emitsUi) {
    const routerBindings = isRecord(app.routerBindings)
      ? app.routerBindings
      : {};
    const errors = [
      ...validateRendererIdentity(app.rendererIdentity).errors,
      ...validateRendererProfile(app.rendererProfile).errors,
      ...validateRendererRouterBindings(
        app.routerBindings,
        Object.keys(routerBindings),
        'routerBindings',
        (app.rendererIdentity as RendererIdentity | undefined)?.renderer,
      ).errors,
    ];
    if (errors.length) {
      throw new Error(
        `[cloudflare-delivery-unit] ${formatBackendFederationValidationErrors(errors)}`,
      );
    }
    const rendererIdentity = app.rendererIdentity as RendererIdentity;
    const rendererProfile = app.rendererProfile as RendererProfile;
    if (!Object.hasOwn(routerBindings, rendererIdentity.entryName))
      throw new Error(
        '[cloudflare-delivery-unit] Topology routerBindings must include the primary renderer identity entry.',
      );
    const declaredIdentity = toDeliveryUnitIdentity(app.deliveryUnit);
    if (
      rendererIdentity.renderer !== app.renderer ||
      rendererIdentity.renderer !== rendererProfile.renderer ||
      rendererIdentity.appId !== app.id ||
      rendererIdentity.buildId !== declaredIdentity?.buildMarker
    ) {
      throw new Error(
        '[cloudflare-delivery-unit] Topology UI renderer metadata must match its app and delivery-unit identity.',
      );
    }
    ui = {
      ...identity,
      surface: 'ui',
      rendererIdentity: { ...rendererIdentity, buildId: identity.buildMarker },
      rendererProfile,
      routerBindings: immutableRendererRouterBindings(
        routerBindings as RendererRouterBindings,
      ),
    };
  } else if (
    app.rendererIdentity !== undefined ||
    app.rendererProfile !== undefined ||
    app.routerBindings !== undefined
  ) {
    throw new Error(
      '[cloudflare-delivery-unit] API-only topology must not declare a UI renderer identity or profile.',
    );
  }

  return {
    ...identity,
    surfaces: {
      ...(ui ? { ui } : {}),
      ...(emitsApi ? { api: { ...identity, surface: 'api' as const } } : {}),
    },
  };
};

/**
 * Resolve the delivery-unit record declared for this app by the workspace
 * reference topology. This is the topology source
 * of truth the Cloudflare worker snapshot is verified against.
 */
export const resolveTopologyDeliveryUnit = async (
  appDirectory: string,
): Promise<DeliveryUnitStamp | undefined> => {
  const resolved = await resolveTopologyApp(appDirectory);
  if (!resolved?.app) {
    return undefined;
  }
  const identity = toDeliveryUnitIdentity(resolved.app.deliveryUnit);
  if (!identity) {
    throw new Error(
      '[cloudflare-delivery-unit] Declared app is missing a valid delivery-unit identity.',
    );
  }
  return createTopologyDeliveryUnitStamp(
    stampReleaseIdentity(identity, resolved.workspaceRoot),
    resolved.app,
  );
};

/**
 * Preserve the finalized build artifact already stamped from renderer-build.json.
 * The generation artifact cannot attest the compiled application.
 */
export const resolveWorkerDeliveryUnitStamp = async (
  appDirectory: string,
  distDirectory: string,
): Promise<DeliveryUnitStamp | undefined> => {
  const buildArtifactPath = path.join(
    distDirectory,
    ULTRAMODERN_BUILD_ARTIFACT_FILE,
  );
  if (!(await fse.pathExists(buildArtifactPath))) {
    if (
      await fse.pathExists(
        path.join(appDirectory, ULTRAMODERN_BUILD_ARTIFACT_PATH),
      )
    )
      throw new Error(
        '[cloudflare-delivery-unit] Finalized build artifact is required before worker output stamping.',
      );
    return undefined;
  }
  const artifact: unknown = await fse.readJSON(buildArtifactPath);
  assertUltramodernBuildArtifact(artifact);
  const identity: DeliveryUnitIdentity = {
    unitId: artifact.deliveryUnit.unitId,
    buildMarker: artifact.deliveryUnit.buildMarker,
    sourceRevision: artifact.deliveryUnit.sourceRevision,
  };
  const resolved = await resolveTopologyApp(appDirectory);
  const stampedArtifact = artifact;
  let emitsApi = true;
  if (resolved?.app) {
    if (stampedArtifact.deliveryUnit.appId !== resolved.app.id) {
      throw new Error(
        '[cloudflare-delivery-unit] Build artifact appId must match the declared topology app.',
      );
    }
    const declaredIdentity = toDeliveryUnitIdentity(resolved.app.deliveryUnit);
    if (!declaredIdentity) {
      throw new Error(
        '[cloudflare-delivery-unit] Declared app is missing a valid delivery-unit identity.',
      );
    }
    const expected = createTopologyDeliveryUnitStamp(identity, resolved.app);
    for (const field of ['unitId'] as const) {
      if (declaredIdentity[field] !== identity[field]) {
        throw new Error(
          `[cloudflare-delivery-unit] Build artifact ${field} must match the declared topology delivery-unit identity.`,
        );
      }
    }
    const ui = stampedArtifact.surfaces.ui;
    if (Boolean(expected.surfaces.ui) !== Boolean(ui)) {
      throw new Error(
        '[cloudflare-delivery-unit] Build artifact UI surface must match the declared topology surface profile.',
      );
    }
    if (expected.surfaces.ui && ui) {
      if (
        !isDeepStrictEqual(
          expected.surfaces.ui.routerBindings,
          ui.routerBindings,
        )
      )
        throw new Error(
          '[cloudflare-delivery-unit] Finalized build routerBindings must match the declared topology router bindings.',
        );
      for (const field of [
        'renderer',
        'appId',
        'entryName',
        'protocolVersion',
        'buildId',
      ] as const) {
        if (
          expected.surfaces.ui.rendererIdentity[field] !==
          ui.rendererIdentity[field]
        ) {
          throw new Error(
            `[cloudflare-delivery-unit] Build artifact UI rendererIdentity.${field} must match the declared topology renderer identity.`,
          );
        }
      }
      assertRendererProfileCompatibility(
        expected.surfaces.ui.rendererProfile,
        ui.rendererProfile,
      );
    }
    emitsApi = expected.surfaces.api !== undefined;
  }
  return {
    ...stampedArtifact.deliveryUnit,
    surfaces: {
      ...(emitsApi ? { api: stampedArtifact.surfaces.api } : {}),
      ...(stampedArtifact.surfaces.ui
        ? { ui: stampedArtifact.surfaces.ui }
        : {}),
    },
  };
};
