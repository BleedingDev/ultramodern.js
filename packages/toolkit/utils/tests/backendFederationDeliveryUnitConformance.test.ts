import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { validateBackendFederationManifest as validateRuntimeBackendFederationManifest } from '../../../cli/plugin-bff/src/runtime/effect/backend-federation-manifest/validation';
import { createBackendManifest } from '../../../solutions/app-tools/src/plugins/backend-federation/codegen';
import {
  type BackendFederationApp,
  createStampedDeliveryUnit,
  readBuildIdentity,
} from '../../../solutions/app-tools/src/plugins/backend-federation/config';
import { createUltramodernBuildArtifactJson } from '../../ultramodern-create/src/ultramodern-workspace/module-federation';
import type { WorkspaceApp } from '../../ultramodern-create/src/ultramodern-workspace/types';
import {
  BACKEND_FEDERATION_EFFECT_EXPOSE,
  type DeliveryUnitRecord,
  ULTRAMODERN_BUILD_ARTIFACT_PATH,
  type UltramodernBuildArtifact,
  validateBackendFederationManifest,
  validateDeliveryUnitRecord,
  validateUltramodernBuildArtifact,
} from '../src/universal/backend-federation-contract';

type IdentityField = 'unitId' | 'buildMarker' | 'sourceRevision';
type RequiredBuildIdentityField = IdentityField | 'appId';

const packageScope = 'acme';
const workspaceApp: WorkspaceApp = {
  id: 'checkout',
  directory: 'verticals/checkout',
  packageSuffix: 'checkout',
  displayName: 'Checkout',
  kind: 'vertical',
  domain: 'checkout',
  portEnv: 'CHECKOUT_PORT',
  port: 3301,
  mfName: 'checkout',
  exposes: {},
  api: {
    stem: 'checkout',
    prefix: '/checkout-api',
    consumedBy: ['shell'],
  },
  ownership: {
    team: 'platform',
    slack: '#platform',
    pagerDuty: 'platform',
    runbookRef: 'runbooks/checkout',
    adrRef: 'docs/adr/0019-ultramodern-microvertical-delivery-unit.md',
    blastRadius: {
      tier: 'tier-2',
      references: ['checkout'],
    },
  },
};

const manifestValidationOptions = {
  path: 'manifest',
  requireEffectExpose: true,
  requireEffectRuntime: true,
  requireVersionFields: true,
} as const;

const identityFields: IdentityField[] = [
  'unitId',
  'buildMarker',
  'sourceRevision',
];
const requiredBuildIdentityFields: RequiredBuildIdentityField[] = [
  ...identityFields,
  'appId',
];

const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const recordField = (
  value: Record<string, unknown>,
  field: string,
): Record<string, unknown> => {
  const record = value[field];
  expect(record).toEqual(expect.any(Object));
  return record as Record<string, unknown>;
};

const createFixture = async () => {
  const workspaceRoot = await mkdtemp(
    path.join(tmpdir(), 'backend-federation-contract-'),
  );
  const appDirectory = path.join(workspaceRoot, workspaceApp.directory);
  const artifactPath = path.join(appDirectory, ULTRAMODERN_BUILD_ARTIFACT_PATH);
  const artifact = JSON.parse(
    createUltramodernBuildArtifactJson(packageScope, workspaceApp),
  ) as UltramodernBuildArtifact;

  await mkdir(path.dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);

  return {
    appDirectory,
    artifact,
    distDirectory: path.join(appDirectory, 'dist'),
    workspaceRoot,
  };
};

const removeFixture = async (workspaceRoot: string) => {
  await rm(workspaceRoot, { recursive: true, force: true });
};

const createConformanceState = async () => {
  const fixture = await createFixture();
  const buildIdentity = await readBuildIdentity(fixture.appDirectory);
  const deliveryUnit = createStampedDeliveryUnit({
    appId: buildIdentity.appId ?? workspaceApp.id,
    unitId: buildIdentity.unitId,
    buildMarker: buildIdentity.buildVersion,
    packageName: buildIdentity.packageName,
    version: buildIdentity.version,
    sourceRevision: buildIdentity.sourceRevision ?? 'workspace',
  });

  expect(deliveryUnit).toBeDefined();

  const backendApp: BackendFederationApp = {
    id: buildIdentity.appId ?? workspaceApp.id,
    directory: workspaceApp.directory,
    packageName: buildIdentity.packageName,
    version: buildIdentity.version,
    buildVersion: buildIdentity.buildVersion,
    unitId: buildIdentity.unitId,
    sourceRevision: buildIdentity.sourceRevision,
    deliveryUnit,
    port: workspaceApp.port,
    apiPrefix: workspaceApp.api?.prefix ?? '/checkout-api',
    apiStem: workspaceApp.api?.stem ?? 'checkout',
    backendName: 'checkoutBackend',
    manifestUrl: `http://localhost:${workspaceApp.port}/backend-mf-manifest.json`,
    containerEntry: `http://localhost:${workspaceApp.port}/backendRemoteEntry.cjs`,
    remoteType: 'commonjs-module',
    uiManifestUrl: `http://localhost:${workspaceApp.port}/mf-manifest.json`,
  };
  const manifest = createBackendManifest(
    fixture.workspaceRoot,
    fixture.distDirectory,
    backendApp,
  );

  return {
    ...fixture,
    backendApp,
    buildIdentity,
    deliveryUnit: deliveryUnit!,
    manifest,
  };
};

const expectReadBuildIdentityRejects = async (
  field: RequiredBuildIdentityField,
) => {
  const fixture = await createFixture();
  try {
    const artifact = cloneJson(fixture.artifact);
    removeDeliveryUnitField(artifact, field);
    await writeFile(
      path.join(fixture.appDirectory, ULTRAMODERN_BUILD_ARTIFACT_PATH),
      `${JSON.stringify(artifact, null, 2)}\n`,
    );

    await expect(readBuildIdentity(fixture.appDirectory)).rejects.toThrow(
      'Invalid delivery-unit build artifact',
    );
  } finally {
    await removeFixture(fixture.workspaceRoot);
  }
};

const removeDeliveryUnitField = (
  artifact: UltramodernBuildArtifact,
  field: RequiredBuildIdentityField,
) => {
  for (const deliveryUnit of [
    artifact.deliveryUnit,
    artifact.surfaces.ui,
    artifact.surfaces.api,
  ]) {
    delete (deliveryUnit as Partial<DeliveryUnitRecord>)[field];
    if (field === 'buildMarker') {
      delete (deliveryUnit as { build?: string }).build;
    }
  }
};

const removeManifestDeliveryUnitField = (
  manifest: ReturnType<typeof createBackendManifest>,
  field: IdentityField,
) => {
  const backendFederation = recordField(manifest, 'backendFederation');
  const topDeliveryUnit = recordField(backendFederation, 'deliveryUnit');
  const versionBoundary = recordField(backendFederation, 'versionBoundary');
  const boundaryDeliveryUnit = recordField(versionBoundary, 'deliveryUnit');

  delete topDeliveryUnit[field];
  delete boundaryDeliveryUnit[field];
};

describe('backend federation delivery-unit conformance', () => {
  it('keeps create, app-tools, runtime, and utils on the same identity shape', async () => {
    const state = await createConformanceState();
    try {
      const artifactDeliveryUnit = state.artifact.deliveryUnit;
      expect(validateUltramodernBuildArtifact(state.artifact).ok).toBe(true);
      expect(validateDeliveryUnitRecord(artifactDeliveryUnit).ok).toBe(true);
      expect(state.buildIdentity).toMatchObject({
        appId: artifactDeliveryUnit.appId,
        buildVersion: artifactDeliveryUnit.buildMarker,
        packageName: artifactDeliveryUnit.packageName,
        sourceRevision: artifactDeliveryUnit.sourceRevision,
        unitId: artifactDeliveryUnit.unitId,
        version: artifactDeliveryUnit.version,
      });

      const backendFederation = recordField(
        state.manifest,
        'backendFederation',
      );
      const topDeliveryUnit = recordField(backendFederation, 'deliveryUnit');
      const versionBoundary = recordField(backendFederation, 'versionBoundary');
      const boundaryDeliveryUnit = recordField(versionBoundary, 'deliveryUnit');

      for (const deliveryUnit of [topDeliveryUnit, boundaryDeliveryUnit]) {
        expect(deliveryUnit).toMatchObject({
          buildMarker: artifactDeliveryUnit.buildMarker,
          sourceRevision: artifactDeliveryUnit.sourceRevision,
          unitId: artifactDeliveryUnit.unitId,
        });
      }
      expect(state.deliveryUnit).toMatchObject({
        buildMarker: artifactDeliveryUnit.buildMarker,
        sourceRevision: artifactDeliveryUnit.sourceRevision,
        unitId: artifactDeliveryUnit.unitId,
      });

      expect(
        validateBackendFederationManifest(
          state.manifest,
          manifestValidationOptions,
        ),
      ).toEqual({ ok: true, errors: [] });
      expect(() =>
        validateRuntimeBackendFederationManifest(state.manifest, {
          buildMarker: artifactDeliveryUnit.buildMarker,
          buildVersion: artifactDeliveryUnit.buildMarker,
          packageName: artifactDeliveryUnit.packageName,
          remoteName: state.backendApp.backendName,
          unitId: artifactDeliveryUnit.unitId,
          version: artifactDeliveryUnit.version,
        }),
      ).not.toThrow();
      expect(
        validateBackendFederationManifest(state.manifest, {
          ...manifestValidationOptions,
          requireEffectExpose: true,
        }).ok,
      ).toBe(true);
      expect(
        recordField(backendFederation, 'versionBoundary').buildVersion,
      ).toBe(artifactDeliveryUnit.buildMarker);
      expect(backendFederation.expose).toBe(BACKEND_FEDERATION_EFFECT_EXPOSE);
    } finally {
      await removeFixture(state.workspaceRoot);
    }
  });

  it('rejects missing required identity fields in each validator that sees them', async () => {
    const state = await createConformanceState();
    try {
      for (const field of requiredBuildIdentityFields) {
        const artifact = cloneJson(state.artifact);
        removeDeliveryUnitField(artifact, field);

        expect(validateUltramodernBuildArtifact(artifact).ok).toBe(false);
        expect(validateDeliveryUnitRecord(artifact.deliveryUnit).ok).toBe(
          false,
        );
        await expectReadBuildIdentityRejects(field);
      }

      for (const field of identityFields) {
        const invalidManifest = cloneJson(state.manifest);
        removeManifestDeliveryUnitField(invalidManifest, field);

        expect(
          validateBackendFederationManifest(
            invalidManifest,
            manifestValidationOptions,
          ).ok,
        ).toBe(false);
        expect(() =>
          createBackendManifest(state.workspaceRoot, state.distDirectory, {
            ...state.backendApp,
            deliveryUnit: {
              ...state.deliveryUnit,
              [field]: undefined,
            },
          }),
        ).toThrow('Invalid backend federation manifest');
      }

      for (const field of ['unitId', 'buildMarker'] as const) {
        const invalidManifest = cloneJson(state.manifest);
        removeManifestDeliveryUnitField(invalidManifest, field);

        expect(() =>
          validateRuntimeBackendFederationManifest(invalidManifest, {
            buildMarker: state.artifact.deliveryUnit.buildMarker,
            buildVersion: state.artifact.deliveryUnit.buildMarker,
            packageName: state.artifact.deliveryUnit.packageName,
            remoteName: state.backendApp.backendName,
            unitId: state.artifact.deliveryUnit.unitId,
            version: state.artifact.deliveryUnit.version,
          }),
        ).toThrow('mismatch');
      }
    } finally {
      await removeFixture(state.workspaceRoot);
    }
  });
});
