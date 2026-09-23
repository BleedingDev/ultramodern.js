import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveUltramodernReleaseIdentity } from '@modern-js/app-tools-extensions/release-identity';
import {
  BACKEND_FEDERATION_MANIFEST_FILE as BACKEND_MANIFEST_FILE,
  BACKEND_FEDERATION_REMOTE_ENTRY_FILE as BACKEND_REMOTE_ENTRY_FILE,
  stampUltramodernBuildArtifactIdentity,
  ULTRAMODERN_BUILD_ARTIFACT_FILE,
} from '@modern-js/backend-federation-contracts';
import { createBackendFederationEntryIntegrity } from '@modern-js/server-runtime-extensions/backend-federation-security/node';
import {
  createBackendManifest,
  createBackendRemoteEntrySource,
} from './codegen';
import {
  type BackendFederationApp,
  buildArtifactPathFor,
  createStampedDeliveryUnit,
  findBackendFederationApp,
  findWorkspaceRoot,
  REFERENCE_TOPOLOGY_PATH,
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
  const topologyDeliveryUnit = app.topologyDeliveryUnit;
  const hasTopologyDeliveryUnit =
    topologyDeliveryUnit !== undefined &&
    (topologyDeliveryUnit.unitId !== undefined ||
      topologyDeliveryUnit.buildMarker !== undefined ||
      topologyDeliveryUnit.packageName !== undefined ||
      topologyDeliveryUnit.version !== undefined);
  const hasBuildIdentity =
    buildIdentity.unitId !== undefined ||
    buildIdentity.buildVersion !== undefined ||
    buildIdentity.packageName !== undefined ||
    buildIdentity.version !== undefined;

  if (hasBuildIdentity) {
    const topologyPath = path.join(workspaceRoot, REFERENCE_TOPOLOGY_PATH);
    const buildIdentityPath = buildArtifactPathFor(appDirectory);
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

    if (hasTopologyDeliveryUnit) {
      compare('unitId', topologyDeliveryUnit?.unitId, buildIdentity.unitId);
      compare(
        'buildMarker/build',
        topologyDeliveryUnit?.buildMarker,
        buildIdentity.buildVersion,
      );
      compare(
        'packageName',
        topologyDeliveryUnit?.packageName,
        buildIdentity.packageName,
      );
      compare('version', topologyDeliveryUnit?.version, buildIdentity.version);
    }
    compare(
      'packageName',
      app.packageName,
      buildIdentity.packageName,
      'package.json',
    );
    compare(
      'packageName',
      topologyDeliveryUnit?.packageName,
      app.packageName,
      'topology',
    );
    compare('version', app.version, buildIdentity.version, 'package.json');
    compare('version', topologyDeliveryUnit?.version, app.version, 'topology');

    if (mismatches.length > 0) {
      throw new Error(
        `[backend-federation-build] Delivery-unit identity drift between ${topologyPath}, package.json and ${buildIdentityPath}: ${mismatches.join('; ')}`,
      );
    }
  }

  const unitId = topologyDeliveryUnit?.unitId ?? buildIdentity.unitId;
  const generationBuildMarker =
    topologyDeliveryUnit?.buildMarker ?? buildIdentity.buildVersion;
  const sourceRevision = await resolveWorkspaceSourceRevision(workspaceRoot);
  const buildVersion =
    generationBuildMarker && unitId
      ? resolveUltramodernReleaseIdentity({
          generationBuildMarker,
          unitId,
          workspaceRoot,
        }).buildMarker
      : undefined;
  const packageName = app.packageName;
  const version = app.version;
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

export default () => ({
  name: '@modern-js/backend-federation-build',
  setup(api: {
    getAppContext(): { appDirectory: string; distDirectory: string };
    onAfterBuild(handler: () => Promise<void>): void;
  }) {
    api.onAfterBuild(async () => {
      const { appDirectory, distDirectory } = api.getAppContext();
      await emitBackendFederationArtifacts(appDirectory, distDirectory);
    });
  },
});
