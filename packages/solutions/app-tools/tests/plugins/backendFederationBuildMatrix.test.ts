import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createUltramodernReleaseBuildMarker } from '@modern-js/app-tools-extensions/release-identity';
import {
  ULTRAMODERN_BUILD_ARTIFACT_PATH,
  ULTRAMODERN_BUILD_MODULE_PATH,
} from '@modern-js/utils/universal';
import { readBuildIdentity } from '../../src/plugins/backend-federation/config';
import { emitBackendFederationArtifacts } from '../../src/plugins/backendFederationBuild';

type ConfigShape = 'compact' | 'full';
type IdentitySource = 'json' | 'legacy-ts';

const unitId = 'tractor-store-vertical-demo/explore';
const appId = 'explore';
const packageName = '@tractor-store-vertical-demo/explore';
const version = '0.1.0';
const buildMarker = 'tractor-explore-build-1234';
const containerEntry =
  'https://delivery.example.test/explore/assets/backendRemoteEntry.cjs';
const manifestUrl =
  'https://delivery.example.test/explore/backend-mf-manifest.json';
const uiManifestUrl = 'https://delivery.example.test/explore/mf-manifest.json';
const expectedPublicPath = 'https://delivery.example.test/explore/assets/';

const tempDirectories: string[] = [];

const createTempDir = async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'modern-backend-mf-'));
  tempDirectories.push(dir);
  return dir;
};

const writeJson = async (filePath: string, value: unknown) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
};

const createBuildArtifact = (overrides: Record<string, unknown> = {}) => {
  const deliveryUnit = {
    schemaVersion: 1,
    kind: 'microvertical-delivery-unit',
    appId,
    unitId,
    packageName,
    version,
    sourceRevision: 'json-source',
    buildMarker,
    deployProfile: 'cloudflare-ssr-mf-effect-v1',
    build: buildMarker,
    ...overrides,
  };

  return {
    schemaVersion: 1,
    kind: 'ultramodern-build-artifact',
    deliveryUnit,
    surfaces: {
      ui: { ...deliveryUnit, surface: 'ui' },
      api: { ...deliveryUnit, surface: 'api' },
    },
  };
};

const writeJsonBuildIdentity = async (
  appDirectory: string,
  overrides: Record<string, unknown> = {},
) => {
  await writeJson(
    path.join(appDirectory, ULTRAMODERN_BUILD_ARTIFACT_PATH),
    createBuildArtifact(overrides),
  );
};

const writeLegacyBuildIdentity = async (
  appDirectory: string,
  overrides: Record<string, unknown> = {},
) => {
  const identity = {
    appId,
    build: buildMarker,
    packageName,
    version,
    unitId,
    sourceRevision: 'legacy-source',
    ...overrides,
  };
  const modulePath = path.join(appDirectory, ULTRAMODERN_BUILD_MODULE_PATH);

  await fs.mkdir(path.dirname(modulePath), { recursive: true });
  await fs.writeFile(
    modulePath,
    [
      'export const ultramodernBuildIdentity = {',
      `  appId: '${identity.appId}',`,
      `  build: '${identity.build}',`,
      `  packageName: '${identity.packageName}',`,
      `  version: '${identity.version}',`,
      `  unitId: '${identity.unitId}',`,
      `  sourceRevision: '${identity.sourceRevision}',`,
      '};',
      '',
    ].join('\n'),
  );
};

const createTopologyApp = (configShape: ConfigShape) => {
  const baseApp = {
    id: appId,
    kind: 'vertical',
    package: packageName,
    path: 'verticals/explore',
    port: 3021,
    api: {
      prefix: '/explore-api',
      stem: 'explore',
    },
    moduleFederation: {
      name: 'verticalExplore',
      manifestUrl: uiManifestUrl,
    },
    deliveryUnit: {
      unitId,
      buildMarker,
      sourceRevision: 'topology-source',
      packageName,
      version,
    },
  };

  if (configShape === 'compact') {
    return {
      ...baseApp,
      backendFederation: {
        name: 'verticalExploreBackend',
        versionBoundary: {
          ui: {
            manifestUrl: uiManifestUrl,
          },
        },
        executionSurfaces: {
          node: {
            remoteName: 'verticalExploreBackend',
            manifestUrl,
            containerEntry,
            remoteType: 'commonjs-module',
          },
        },
      },
    };
  }

  return {
    ...baseApp,
    serverExecution: {
      node: {
        remoteName: 'verticalExploreBackend',
        manifestUrl,
        containerEntry,
        remoteType: 'commonjs-module',
      },
    },
  };
};

const writeWorkspace = async ({
  configShape,
  identityOverrides = {},
  identitySource,
}: {
  configShape: ConfigShape;
  identityOverrides?: Record<string, unknown>;
  identitySource: IdentitySource;
}) => {
  const workspaceRoot = await createTempDir();
  const appDirectory = path.join(workspaceRoot, 'verticals/explore');
  const distDirectory = path.join(
    appDirectory,
    `dist-${configShape}-${identitySource}`,
  );

  await fs.mkdir(path.join(appDirectory, 'api'), { recursive: true });
  await fs.writeFile(
    path.join(appDirectory, 'api/effect-api.ts'),
    'export const backendFederationContract = {};\n',
  );
  await fs.writeFile(
    path.join(appDirectory, 'backend-federation.config.ts'),
    'export default {};\n',
  );
  await writeJson(path.join(workspaceRoot, '.modernjs/ultramodern.json'), {
    topology: {
      apps: [createTopologyApp(configShape)],
    },
  });

  if (identitySource === 'json') {
    await writeJsonBuildIdentity(appDirectory, identityOverrides);
  } else {
    await writeLegacyBuildIdentity(appDirectory, identityOverrides);
  }

  return { appDirectory, distDirectory };
};

const withSourceRevision = async <T>(
  sourceRevision: string,
  run: () => Promise<T>,
) => {
  const previous = process.env.ULTRAMODERN_SOURCE_REVISION;
  process.env.ULTRAMODERN_SOURCE_REVISION = sourceRevision;

  try {
    return await run();
  } finally {
    if (previous === undefined) {
      delete process.env.ULTRAMODERN_SOURCE_REVISION;
    } else {
      process.env.ULTRAMODERN_SOURCE_REVISION = previous;
    }
  }
};

afterEach(async () => {
  await Promise.all(
    tempDirectories
      .splice(0)
      .map(dir => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe('backend federation build emit matrix', () => {
  const scenarios = [
    {
      name: 'compact config with JSON build identity',
      configShape: 'compact',
      identitySource: 'json',
      identitySourceRevision: 'json-source',
    },
    {
      name: 'compact config with legacy TS build identity',
      configShape: 'compact',
      identitySource: 'legacy-ts',
      identitySourceRevision: 'legacy-source',
    },
    {
      name: 'full config with JSON build identity',
      configShape: 'full',
      identitySource: 'json',
      identitySourceRevision: 'json-source',
    },
    {
      name: 'full config with legacy TS build identity',
      configShape: 'full',
      identitySource: 'legacy-ts',
      identitySourceRevision: 'legacy-source',
    },
  ] as const;

  for (const [scenarioIndex, scenario] of scenarios.entries()) {
    it(`emits complete manifest identity for ${scenario.name}`, async () => {
      const { appDirectory, distDirectory } = await writeWorkspace(scenario);

      const buildIdentity = await readBuildIdentity(appDirectory);

      expect(buildIdentity).toEqual(
        expect.objectContaining({
          appId,
          buildVersion: buildMarker,
          packageName,
          sourceRevision: scenario.identitySourceRevision,
          unitId,
          version,
        }),
      );
      if (scenario.identitySource === 'json') {
        expect(buildIdentity.artifact).toEqual(expect.any(Object));
      } else {
        expect(buildIdentity.artifact).toBeUndefined();
      }

      const sourceRevision = String(scenarioIndex + 3).repeat(40);
      const releaseBuildMarker = createUltramodernReleaseBuildMarker({
        generationBuildMarker: buildMarker,
        sourceRevision,
        unitId,
      });
      const result = await withSourceRevision(sourceRevision, () =>
        emitBackendFederationArtifacts(appDirectory, distDirectory),
      );

      expect(result).toEqual(
        expect.objectContaining({
          appId,
          remoteName: 'verticalExploreBackend',
          remoteType: 'commonjs-module',
        }),
      );

      const manifest = JSON.parse(
        await fs.readFile(
          path.join(distDirectory, 'backend-mf-manifest.json'),
          {
            encoding: 'utf8',
          },
        ),
      );

      expect(manifest.entry.url).toBe(containerEntry);
      expect(manifest.metaData.publicPath).toBe(expectedPublicPath);
      expect(manifest.metaData.ssrPublicPath).toBe(expectedPublicPath);
      expect(manifest.backendFederation.appId).toBe(appId);
      expect(manifest.backendFederation.containerEntry).toBe(containerEntry);
      expect(manifest.backendFederation.deliveryUnit).toEqual(
        expect.objectContaining({
          buildMarker: releaseBuildMarker,
          sourceRevision,
          unitId,
        }),
      );
      expect(manifest.backendFederation.versionBoundary).toEqual(
        expect.objectContaining({
          buildVersion: releaseBuildMarker,
          invariant: 'web-and-api-same-build',
          packageName,
          version,
        }),
      );
      expect(manifest.backendFederation.versionBoundary.deliveryUnit).toEqual(
        expect.objectContaining({
          buildMarker: releaseBuildMarker,
          sourceRevision,
          unitId,
        }),
      );
    });
  }

  for (const identitySource of ['json', 'legacy-ts'] as const) {
    it(`rejects cross-vertical appId drift for ${identitySource} build identity`, async () => {
      const { appDirectory, distDirectory } = await writeWorkspace({
        configShape: 'compact',
        identityOverrides: { appId: 'inventory' },
        identitySource,
      });

      await expect(
        withSourceRevision('f'.repeat(40), () =>
          emitBackendFederationArtifacts(appDirectory, distDirectory),
        ),
      ).rejects.toThrow(
        /appId: topology=explore vs ultramodern-build=inventory/u,
      );
    });
  }
});
