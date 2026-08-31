import path from 'node:path';
import { fs as fse } from '@modern-js/utils';
import {
  type DeliveryUnitIdentity,
  isUltramodernBuildArtifact,
  nonEmptyString,
  toDeliveryUnitIdentity,
  ULTRAMODERN_BUILD_ARTIFACT_PATH,
  ULTRAMODERN_BUILD_MODULE_PATH,
} from '@modern-js/utils/universal';
import { resolveUltramodernReleaseIdentity } from '../../../../ultramodern-release-identity';
import { isRecord } from './utils';

const COMPACT_CONFIG_PATH = '.modernjs/ultramodern.json';

export type DeliveryUnitStamp = DeliveryUnitIdentity & {
  surfaces: {
    ui?: DeliveryUnitIdentity & { surface: 'ui' };
    api?: DeliveryUnitIdentity & { surface: 'api' };
  };
};

type CompactAppResolution = {
  app?: Record<string, unknown>;
  workspaceRoot: string;
};

const findWorkspaceRoot = async (
  appDirectory: string,
): Promise<string | undefined> => {
  let current = path.resolve(appDirectory);

  for (;;) {
    if (await fse.pathExists(path.join(current, COMPACT_CONFIG_PATH))) {
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

const resolveCompactApp = async (
  appDirectory: string,
): Promise<CompactAppResolution | undefined> => {
  const workspaceRoot = await findWorkspaceRoot(appDirectory);
  if (!workspaceRoot) {
    return undefined;
  }

  let compactConfig: unknown;
  try {
    compactConfig = await fse.readJSON(
      path.join(workspaceRoot, COMPACT_CONFIG_PATH),
    );
  } catch {
    return { workspaceRoot };
  }

  if (!isRecord(compactConfig)) {
    return { workspaceRoot };
  }

  const topology = isRecord(compactConfig.topology)
    ? compactConfig.topology
    : undefined;
  const apps = Array.isArray(topology?.apps) ? topology.apps : undefined;
  if (!apps) {
    return { app: compactConfig, workspaceRoot };
  }

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
  return {
    ...(isRecord(app) ? { app } : {}),
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
 * compact config (`.modernjs/ultramodern.json`). This is the topology source
 * of truth the Cloudflare worker snapshot is verified against.
 */
export const resolveTopologyDeliveryUnit = async (
  appDirectory: string,
): Promise<DeliveryUnitStamp | undefined> => {
  const resolved = await resolveCompactApp(appDirectory);
  if (!resolved?.app) {
    return undefined;
  }
  const identity = toDeliveryUnitIdentity(resolved.app.deliveryUnit);
  return identity
    ? createDeliveryUnitStamp(
        stampReleaseIdentity(identity, resolved.workspaceRoot),
        resolved.app,
      )
    : undefined;
};

/**
 * Resolve the delivery-unit identity actually bundled into the worker by
 * parsing the generated `shared/ultramodern-build.ts` module. This is the
 * worker snapshot / declared surface source that gets stamped into the manifest.
 */
export const resolveWorkerDeliveryUnitStamp = async (
  appDirectory: string,
): Promise<DeliveryUnitStamp | undefined> => {
  const buildArtifactPath = path.join(
    appDirectory,
    ULTRAMODERN_BUILD_ARTIFACT_PATH,
  );
  const buildModulePath = path.join(
    appDirectory,
    ULTRAMODERN_BUILD_MODULE_PATH,
  );
  let identity: DeliveryUnitIdentity | undefined;

  if (await fse.pathExists(buildArtifactPath)) {
    const artifact = await fse.readJSON(buildArtifactPath);
    if (!isUltramodernBuildArtifact(artifact)) {
      return undefined;
    }
    identity = toDeliveryUnitIdentity(artifact.deliveryUnit);
  } else if (await fse.pathExists(buildModulePath)) {
    console.warn(
      `[cloudflare] ${buildArtifactPath} missing; falling back to legacy regex parsing of ${buildModulePath}. Regenerate the workspace to emit ultramodern-build.json.`,
    );
    const source = await fse.readFile(buildModulePath, 'utf8');
    identity = toDeliveryUnitIdentity({
      buildMarker: source.match(/\bbuild:\s*['"]([^'"]+)['"]/u)?.[1],
      unitId: source.match(/\bunitId:\s*['"]([^'"]+)['"]/u)?.[1],
      sourceRevision: source.match(
        /\bsourceRevision:\s*['"]([^'"]+)['"]/u,
      )?.[1],
    });
  }

  if (!identity) {
    return undefined;
  }
  const resolved = await resolveCompactApp(appDirectory);
  if (resolved) {
    identity = stampReleaseIdentity(identity, resolved.workspaceRoot);
  }
  return createDeliveryUnitStamp(identity, resolved?.app);
};
