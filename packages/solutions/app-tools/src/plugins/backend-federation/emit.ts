import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveUltramodernReleaseIdentity } from '@modern-js/app-tools-extensions/release-identity';
import { createBackendFederationEntryIntegrity } from '@modern-js/server-runtime-extensions/backend-federation-security/node';
import {
  BACKEND_FEDERATION_MANIFEST_FILE as BACKEND_MANIFEST_FILE,
  BACKEND_FEDERATION_REMOTE_ENTRY_FILE as BACKEND_REMOTE_ENTRY_FILE,
  stampUltramodernBuildArtifactIdentity,
  ULTRAMODERN_BUILD_ARTIFACT_FILE,
} from '@modern-js/utils/universal';
import type { AppTools, CliPlugin } from '../../types';
import {
  createBackendManifest,
  createBackendRemoteEntrySource,
} from './codegen';
import {
  type BackendFederationApp,
  buildArtifactPathFor,
  buildModulePathFor,
  COMPACT_CONFIG_PATH,
  createStampedDeliveryUnit,
  findBackendFederationApp,
  findWorkspaceRoot,
  readBuildIdentity,
  resolveWorkspaceSourceRevision,
} from './config';

export type { BackendFederationBuildIdentity } from './config';

export type BackendFederationArtifactResult = {
  appId: string;
  manifestPath: string;
  containerPath: string;
  deliveryUnitArtifactPath?: string;
  remoteName: string;
  remoteType: string;
};

export const emitBackendFederationArtifacts = async (
  appDirectory: string,
  distDirectory: string,
): Promise<BackendFederationArtifactResult | undefined> => {
  const workspaceRoot = findWorkspaceRoot(appDirectory);
  if (!workspaceRoot) {
    return undefined;
  }

  const effectApiPath = path.join(appDirectory, 'api/effect-api.ts');
  const backendFederationConfigPath = path.join(
    appDirectory,
    'backend-federation.config.ts',
  );
  if (!existsSync(effectApiPath) || !existsSync(backendFederationConfigPath)) {
    return undefined;
  }

  const app = await findBackendFederationApp(workspaceRoot, appDirectory);
  if (!app) {
    return undefined;
  }
  const buildIdentity = await readBuildIdentity(appDirectory);
  const compactDeliveryUnit = app.compactDeliveryUnit;
  const hasCompactDeliveryUnit =
    compactDeliveryUnit !== undefined &&
    (compactDeliveryUnit.unitId !== undefined ||
      compactDeliveryUnit.buildMarker !== undefined ||
      compactDeliveryUnit.packageName !== undefined ||
      compactDeliveryUnit.version !== undefined);
  const hasBuildIdentity =
    buildIdentity.unitId !== undefined ||
    buildIdentity.buildVersion !== undefined ||
    buildIdentity.packageName !== undefined ||
    buildIdentity.version !== undefined;

  if (hasBuildIdentity) {
    const compactConfigPath = path.join(workspaceRoot, COMPACT_CONFIG_PATH);
    const buildIdentityPath = existsSync(buildArtifactPathFor(appDirectory))
      ? buildArtifactPathFor(appDirectory)
      : buildModulePathFor(appDirectory);
    const mismatches: string[] = [];
    const compare = (
      label: string,
      a?: string,
      b?: string,
      leftLabel = 'deliveryUnit',
    ) => {
      if (a !== undefined && b !== undefined && a !== b) {
        mismatches.push(
          `${label}: ${leftLabel}=${a} vs ultramodern-build=${b}`,
        );
      }
    };
    compare('appId', app.id, buildIdentity.appId, 'topology');

    if (hasCompactDeliveryUnit) {
      compare('unitId', compactDeliveryUnit?.unitId, buildIdentity.unitId);
      compare(
        'buildMarker/build',
        compactDeliveryUnit?.buildMarker,
        buildIdentity.buildVersion,
      );
      compare(
        'packageName',
        compactDeliveryUnit?.packageName,
        buildIdentity.packageName,
      );
      compare('version', compactDeliveryUnit?.version, buildIdentity.version);
    }

    if (mismatches.length > 0) {
      throw new Error(
        `[backend-federation-build] Delivery-unit identity drift between ${compactConfigPath} (topology) and ${buildIdentityPath}: ${mismatches.join('; ')}`,
      );
    }
  }

  const unitId = compactDeliveryUnit?.unitId ?? buildIdentity.unitId;
  const generationBuildMarker =
    compactDeliveryUnit?.buildMarker ?? buildIdentity.buildVersion;
  const sourceRevision = await resolveWorkspaceSourceRevision(workspaceRoot);
  const buildVersion =
    generationBuildMarker && unitId
      ? resolveUltramodernReleaseIdentity({
          generationBuildMarker,
          unitId,
          workspaceRoot,
        }).buildMarker
      : undefined;
  const packageName =
    compactDeliveryUnit?.packageName ??
    buildIdentity.packageName ??
    app.packageName;
  const version = compactDeliveryUnit?.version ?? buildIdentity.version;
  const deliveryUnit = createStampedDeliveryUnit({
    appId: app.id,
    unitId,
    buildMarker: buildVersion,
    packageName,
    version,
    sourceRevision,
  });
  const stampedBuildArtifact = buildIdentity.artifact
    ? stampUltramodernBuildArtifactIdentity(buildIdentity.artifact, {
        buildMarker:
          buildVersion ?? buildIdentity.artifact.deliveryUnit.buildMarker,
        sourceRevision,
      })
    : undefined;

  const resolvedApp: BackendFederationApp = {
    ...app,
    packageName,
    version,
    buildVersion,
    unitId,
    sourceRevision,
    deliveryUnit,
  };

  const manifestPath = path.join(distDirectory, BACKEND_MANIFEST_FILE);
  const entryPath = path.join(distDirectory, BACKEND_REMOTE_ENTRY_FILE);
  const deliveryUnitArtifactPath = stampedBuildArtifact
    ? path.join(distDirectory, ULTRAMODERN_BUILD_ARTIFACT_FILE)
    : undefined;
  const entrySource = await createBackendRemoteEntrySource(
    workspaceRoot,
    resolvedApp,
    effectApiPath,
    entryPath,
  );
  await fs.mkdir(distDirectory, { recursive: true });
  await fs.writeFile(entryPath, entrySource);
  await fs.writeFile(
    manifestPath,
    `${JSON.stringify(createBackendManifest(workspaceRoot, distDirectory, resolvedApp, createBackendFederationEntryIntegrity(entrySource)), null, 2)}\n`,
  );
  if (stampedBuildArtifact && deliveryUnitArtifactPath) {
    await fs.writeFile(
      deliveryUnitArtifactPath,
      `${JSON.stringify(stampedBuildArtifact, null, 2)}\n`,
    );
  }

  return {
    appId: resolvedApp.id,
    manifestPath,
    containerPath: entryPath,
    ...(deliveryUnitArtifactPath ? { deliveryUnitArtifactPath } : {}),
    remoteName: resolvedApp.backendName,
    remoteType: resolvedApp.remoteType,
  };
};

export default (): CliPlugin<AppTools> => ({
  name: '@modern-js/backend-federation-build',
  setup(api) {
    api.onAfterBuild(async () => {
      const { appDirectory, distDirectory } = api.getAppContext();
      await emitBackendFederationArtifacts(appDirectory, distDirectory);
    });
  },
});
