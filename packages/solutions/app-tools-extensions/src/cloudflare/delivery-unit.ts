import path from 'node:path';
import {
  type DeliveryUnitIdentity,
  isUltramodernBuildArtifact,
  nonEmptyString,
  toDeliveryUnitIdentity,
  ULTRAMODERN_BUILD_ARTIFACT_PATH,
} from '@modern-js/backend-federation-contracts';
import { fs as fse } from '@modern-js/utils';
import { resolveUltramodernReleaseIdentity } from '../release-identity';
import { isRecord } from './utils';

const TOPOLOGY_PATH = 'topology/reference-topology.json';

export type DeliveryUnitStamp = DeliveryUnitIdentity & {
  surfaces: {
    ui?: DeliveryUnitIdentity & { surface: 'ui' };
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

const createDeliveryUnitStamp = (
  identity: DeliveryUnitIdentity,
  app?: Record<string, unknown>,
): DeliveryUnitStamp => {
  const surfaceProfile = nonEmptyString(app?.surfaceProfile);
  const emitsUi = surfaceProfile !== 'api-only';
  const emitsApi = surfaceProfile !== 'ui-only';

  return {
    ...identity,
    surfaces: {
      ...(emitsUi ? { ui: { ...identity, surface: 'ui' as const } } : {}),
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
  return createDeliveryUnitStamp(
    stampReleaseIdentity(identity, resolved.workspaceRoot),
    resolved.app,
  );
};

/**
 * Resolve the delivery-unit identity actually bundled into the worker by
 * reading the generated `shared/ultramodern-build.json` artifact. This is the
 * worker snapshot / declared surface source that gets stamped into the manifest.
 */
export const resolveWorkerDeliveryUnitStamp = async (
  appDirectory: string,
): Promise<DeliveryUnitStamp | undefined> => {
  const buildArtifactPath = path.join(
    appDirectory,
    ULTRAMODERN_BUILD_ARTIFACT_PATH,
  );
  let identity: DeliveryUnitIdentity | undefined;

  if (await fse.pathExists(buildArtifactPath)) {
    const artifact = await fse.readJSON(buildArtifactPath);
    if (!isUltramodernBuildArtifact(artifact)) {
      return undefined;
    }
    identity = toDeliveryUnitIdentity(artifact.deliveryUnit);
  }

  if (!identity) {
    return undefined;
  }
  const resolved = await resolveTopologyApp(appDirectory);
  if (resolved) {
    identity = stampReleaseIdentity(identity, resolved.workspaceRoot);
  }
  return createDeliveryUnitStamp(identity, resolved?.app);
};
