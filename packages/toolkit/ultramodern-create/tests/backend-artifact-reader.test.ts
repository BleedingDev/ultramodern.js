import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import type { DeliveryUnitRecord } from '@modern-js/backend-federation-contracts';

const require = createRequire(import.meta.url);
// Use the same public, built package entry that the shipped Node script loads.
const contracts: typeof import('@modern-js/backend-federation-contracts') =
  require('@modern-js/backend-federation-contracts');
const consumerPackageRoots = {
  '@modern-js/backend-federation-contracts': fs.realpathSync(
    path.resolve(__dirname, '../../backend-federation-contracts'),
  ),
  '@modern-js/bff-effect': fs.realpathSync(
    path.resolve(__dirname, '../../../server/bff-effect'),
  ),
};
const consumerDependencies = Object.fromEntries(
  Object.entries(consumerPackageRoots).map(([name, packageRoot]) => [
    name,
    JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'))
      .version,
  ]),
);
const generatorScript = path.resolve(
  __dirname,
  '../templates/workspace-scripts/generate-node-backend-federation.mjs',
);
const record: DeliveryUnitRecord = {
  schemaVersion: contracts.DELIVERY_UNIT_SCHEMA_VERSION,
  kind: contracts.DELIVERY_UNIT_KIND,
  appId: 'catalog',
  unitId: 'reader-proof/catalog',
  packageName: '@reader-proof/catalog',
  version: '0.1.0',
  buildMarker: 'reader-proof-build',
  sourceRevision: 'workspace',
  deployProfile: contracts.DELIVERY_UNIT_DEPLOY_PROFILE,
};

function createUiArtifact() {
  const router = {
    name: '@tanstack/react-router',
    version: '1.171.15',
    coreVersion: '1.171.15',
    coreName: '@tanstack/router-core',
  };
  const provider = { ...router, framework: 'tanstack' as const };
  return contracts.createUltramodernBuildArtifact(record, {
    ui: {
      identity: {
        renderer: 'react',
        appId: record.appId,
        entryName: 'main',
        protocolVersion: 1,
        buildId: record.buildMarker,
      },
      profile: {
        renderer: 'react',
        protocolVersion: 1,
        compiler: { name: '@rsbuild/plugin-react', version: '2.1.1' },
        hydration: { name: 'react-dom', version: '19.3.0' },
        router,
      },
      routerBindings: {
        main: {
          owner: '@modern-js/plugin-tanstack',
          evidence: 'file-routes',
          defaultProvider: provider,
          providers: [provider],
        },
      },
    },
  });
}

function createFixture(
  artifact: unknown,
  topologyIdentity = contracts.deliveryUnitContractBlock(record),
) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'um-backend-artifact-reader-')),
  );
  const appRoot = path.join(root, 'verticals/catalog');
  const outputDir = path.join(appRoot, 'dist');
  const writeJson = (relativePath: string, value: unknown) => {
    const target = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
  };
  try {
    writeJson('package.json', { private: true });
    writeJson('verticals/catalog/package.json', {
      name: record.packageName,
      version: record.version,
      dependencies: consumerDependencies,
    });
    const installedScope = path.join(appRoot, 'node_modules/@modern-js');
    fs.mkdirSync(installedScope, { recursive: true });
    for (const [name, packageRoot] of Object.entries(consumerPackageRoots)) {
      fs.symlinkSync(
        packageRoot,
        path.join(appRoot, 'node_modules', name),
        process.platform === 'win32' ? 'junction' : 'dir',
      );
    }
    writeJson('verticals/catalog/shared/ultramodern-build.json', artifact);
    writeJson('topology/reference-topology.json', {
      schemaVersion: 1,
      verticals: [
        {
          id: record.appId,
          kind: 'vertical',
          path: 'verticals/catalog',
          package: record.packageName,
          surfaceProfile: 'api-only',
          deliveryUnit: topologyIdentity,
          backendFederation: {
            name: 'readerProofCatalogBackend',
            remoteType: 'commonjs-module',
            exposes: [contracts.BACKEND_FEDERATION_EFFECT_EXPOSE],
          },
        },
      ],
    });
    writeJson('topology/local-overlays/development.json', {
      serverExecution: {
        catalog: {
          node: {
            manifestUrl: 'http://localhost:3101/backend-mf-manifest.json',
            containerEntry: 'http://localhost:3101/backendRemoteEntry.cjs',
          },
        },
      },
    });
    fs.mkdirSync(path.join(appRoot, 'api'));
    fs.writeFileSync(
      path.join(appRoot, 'api/effect-api.ts'),
      "export const apiIdentity: string = 'backend-artifact-reader';\n",
    );
    return {
      root,
      outputDir,
      run: () =>
        spawnSync(process.execPath, [generatorScript, '--app', record.appId], {
          cwd: root,
          env: { ...process.env, ULTRAMODERN_WORKSPACE_ROOT: root },
          encoding: 'utf8',
          timeout: 15000,
        }),
      clean: () => fs.rmSync(root, { recursive: true, force: true }),
    };
  } catch (error) {
    fs.rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

const malformedArtifacts = [
  {
    name: 'schema 1',
    artifact: () => ({
      ...contracts.createUltramodernBuildArtifact(record),
      schemaVersion: 1,
    }),
    error: /\.schemaVersion: must be 2/u,
  },
  {
    name: 'a non-exact compiler profile',
    artifact: () => {
      const artifact = createUiArtifact();
      const ui = artifact.surfaces.ui!;
      return {
        ...artifact,
        surfaces: {
          ...artifact.surfaces,
          ui: {
            ...ui,
            rendererProfile: {
              ...ui.rendererProfile,
              compiler: { ...ui.rendererProfile.compiler, version: '^2.1.0' },
            },
          },
        },
      };
    },
    error: /rendererProfile\.compiler\.version: must be an exact version/u,
  },
  {
    name: 'current UI metadata missing its renderer identity',
    artifact: () => {
      const artifact = createUiArtifact();
      return {
        ...artifact,
        surfaces: {
          ...artifact.surfaces,
          ui: { ...artifact.surfaces.ui, rendererIdentity: undefined },
        },
      };
    },
    error: /rendererIdentity: must be an object/u,
  },
  {
    name: 'current UI metadata missing its router bindings',
    artifact: () => {
      const artifact = createUiArtifact();
      return {
        ...artifact,
        surfaces: {
          ...artifact.surfaces,
          ui: { ...artifact.surfaces.ui, routerBindings: undefined },
        },
      };
    },
    error: /routerBindings: is required on the UI surface/u,
  },
  {
    name: 'current UI metadata from another build',
    artifact: () => {
      const artifact = createUiArtifact();
      const ui = artifact.surfaces.ui!;
      return {
        ...artifact,
        surfaces: {
          ...artifact.surfaces,
          ui: {
            ...ui,
            rendererIdentity: {
              ...ui.rendererIdentity,
              buildId: 'other-build',
            },
          },
        },
      };
    },
    error: /rendererIdentity\.buildId: must match/u,
  },
  {
    name: 'a build alias without the current buildMarker',
    artifact: () => {
      const artifact = contracts.createUltramodernBuildArtifact(record);
      return {
        ...artifact,
        deliveryUnit: { ...artifact.deliveryUnit, buildMarker: undefined },
      };
    },
    error: /deliveryUnit\.buildMarker: must be a non-empty string/u,
  },
];

for (const invalid of malformedArtifacts) {
  test(`backend artifact reader rejects ${invalid.name} before outputs`, () => {
    const fixture = createFixture(invalid.artifact());
    try {
      const result = fixture.run();
      assert.ifError(result.error);
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, invalid.error);
      assert.equal(fs.existsSync(fixture.outputDir), false);
    } finally {
      fixture.clean();
    }
  });
}

for (const field of contracts.DELIVERY_UNIT_IDENTITY_FIELDS) {
  test(`backend artifact reader rejects a topology ${field} mismatch before outputs`, () => {
    const fixture = createFixture(
      contracts.createUltramodernBuildArtifact(record),
      {
        ...contracts.deliveryUnitContractBlock(record),
        [field]: 'other-value',
      },
    );
    try {
      const result = fixture.run();
      assert.ifError(result.error);
      assert.equal(result.status, 1, result.stderr);
      assert.match(
        result.stderr,
        /topology, package\.json and stamped build identity disagree/u,
      );
      assert.equal(fs.existsSync(fixture.outputDir), false);
    } finally {
      fixture.clean();
    }
  });
}

test('backend artifact reader accepts a headless schema 2 artifact and emits an executable container', async () => {
  const artifact = contracts.createUltramodernBuildArtifact(record);
  assert.equal(artifact.schemaVersion, 2);
  assert.equal(Object.hasOwn(artifact.surfaces, 'ui'), false);
  const fixture = createFixture(artifact);
  try {
    const result = fixture.run();
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    const entryPath = path.join(fixture.outputDir, 'backendRemoteEntry.cjs');
    const entryBytes = fs.readFileSync(entryPath);
    const manifest = JSON.parse(
      fs.readFileSync(
        path.join(fixture.outputDir, 'backend-mf-manifest.json'),
        'utf8',
      ),
    );
    assert.equal(manifest.buildVersion, record.buildMarker);
    assert.equal(manifest.entry.byteLength, entryBytes.byteLength);
    assert.equal(
      manifest.entry.sha256,
      createHash('sha256').update(entryBytes).digest('hex'),
    );
    assert.equal(manifest.backendFederation.deliveryUnit.unitId, record.unitId);
    assert.equal(
      manifest.backendFederation.deliveryUnit.sourceRevision,
      record.sourceRevision,
    );
    const container = require(entryPath);
    const factory = container.get(contracts.BACKEND_FEDERATION_EFFECT_EXPOSE);
    const namespace = await factory();
    assert.equal(namespace.apiIdentity, 'backend-artifact-reader');
    assert.equal(
      namespace.backendFederationContract.compatibility.build,
      record.buildMarker,
    );
    assert.equal(
      namespace.backendFederationContract.compatibility.unitId,
      record.unitId,
    );
    assert.equal(
      namespace.backendFederationContract.compatibility.sourceRevision,
      record.sourceRevision,
    );
  } finally {
    fixture.clean();
  }
});
