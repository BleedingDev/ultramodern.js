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
import { isRecord } from './utils';

const COMPACT_CONFIG_PATH = '.modernjs/ultramodern.json';

export type DeliveryUnitStamp = DeliveryUnitIdentity & {
  surfaces: {
    ui: DeliveryUnitIdentity & { surface: 'ui' };
    api: DeliveryUnitIdentity & { surface: 'api' };
  };
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

/**
 * Resolve the delivery-unit record declared for this app by the workspace
 * compact config (`.modernjs/ultramodern.json`). This is the topology source
 * of truth the Cloudflare worker snapshot is verified against.
 */
export const resolveTopologyDeliveryUnit = async (
  appDirectory: string,
): Promise<DeliveryUnitIdentity | undefined> => {
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
    return undefined;
  }

  if (!isRecord(compactConfig)) {
    return undefined;
  }

  const topology = isRecord(compactConfig.topology)
    ? compactConfig.topology
    : undefined;
  const apps = Array.isArray(topology?.apps) ? topology.apps : undefined;
  const resolvedAppDirectory = path.resolve(appDirectory);

  if (apps) {
    for (const app of apps) {
      if (!isRecord(app)) {
        continue;
      }

      const appPath = nonEmptyString(app.path);
      if (
        appPath &&
        path.resolve(workspaceRoot, appPath.replace(/^\.\/+/u, '')) ===
          resolvedAppDirectory
      ) {
        return toDeliveryUnitIdentity(app.deliveryUnit);
      }
    }

    return undefined;
  }

  // Single-app compact config: fall back to a top-level declaration.
  return toDeliveryUnitIdentity(compactConfig.deliveryUnit);
};

/**
 * Resolve the delivery-unit identity actually bundled into the worker by
 * parsing the generated `shared/ultramodern-build.ts` module. This is the
 * worker snapshot / UI+API surface source that gets stamped into the manifest.
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

  return {
    ...identity,
    surfaces: {
      ui: { ...identity, surface: 'ui' },
      api: { ...identity, surface: 'api' },
    },
  };
};
