import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const writeJson = (filePath: string, value: unknown) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value));
};

test('generated Node backend container adopts the host registry before evaluating its expose', async () => {
  const workspaceRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'generated-node-backend-container-'),
  );
  try {
    writeJson(path.join(workspaceRoot, 'package.json'), { private: true });
    const scope = path.join(workspaceRoot, 'node_modules/@modern-js');
    fs.mkdirSync(scope, { recursive: true });
    fs.symlinkSync(
      path.resolve(__dirname, '../../../server/bff-effect'),
      path.join(scope, 'bff-effect'),
      'dir',
    );
    writeJson(path.join(workspaceRoot, 'topology/reference-topology.json'), {
      schemaVersion: 1,
      verticals: [
        {
          id: 'catalog',
          kind: 'vertical',
          path: 'verticals/catalog',
          package: '@test/catalog',
          deliveryUnit: { unitId: 'catalog-unit' },
          backendFederation: {
            name: 'catalogBackend',
            exposes: ['./effect-api'],
            remoteType: 'commonjs-module',
          },
        },
      ],
    });
    writeJson(
      path.join(workspaceRoot, 'topology/local-overlays/development.json'),
      {
        serverExecution: {
          catalog: {
            node: {
              manifestUrl: 'http://localhost:3021/backend-mf-manifest.json',
              containerEntry: 'http://localhost:3021/backendRemoteEntry.cjs',
            },
          },
        },
      },
    );
    const appDirectory = path.join(workspaceRoot, 'verticals/catalog');
    writeJson(path.join(appDirectory, 'package.json'), {
      name: '@test/catalog',
      version: '1.0.0',
    });
    writeJson(path.join(appDirectory, 'shared/ultramodern-build.json'), {
      deliveryUnit: {
        unitId: 'catalog-unit',
        packageName: '@test/catalog',
        version: '1.0.0',
        buildMarker: 'catalog-build',
        sourceRevision: 'abc123',
      },
    });
    fs.mkdirSync(path.join(appDirectory, 'api'), { recursive: true });
    fs.writeFileSync(
      path.join(appDirectory, 'api/effect-api.ts'),
      `import { defineEffectBff, HttpApi, Layer } from '@modern-js/bff-effect/effect-edge';
(globalThis as any).__catalogEffectApiEvaluations =
  ((globalThis as any).__catalogEffectApiEvaluations ?? 0) + 1;
export const runtime = defineEffectBff({ api: HttpApi.make('Catalog'), layer: Layer.empty });
`,
    );

    execFileSync(
      process.execPath,
      [
        path.resolve(
          __dirname,
          '../templates/workspace-scripts/generate-node-backend-federation.mjs',
        ),
      ],
      {
        cwd: workspaceRoot,
        env: { ...process.env, ULTRAMODERN_WORKSPACE_ROOT: workspaceRoot },
        stdio: 'pipe',
      },
    );

    const globals = globalThis as { __catalogEffectApiEvaluations?: number };
    delete globals.__catalogEffectApiEvaluations;
    const container = createRequire(__filename)(
      path.join(appDirectory, 'dist/backendRemoteEntry.cjs'),
    );
    assert.equal(globals.__catalogEffectApiEvaluations, undefined);

    const registered: unknown[] = [];
    const hostRegistry = {
      register<T>(factory: T) {
        registered.push(factory);
        return factory;
      },
      is: (factory: unknown) => registered.includes(factory),
    };
    await container.init({
      '@modern-js/bff-effect/handler-factory-registry': {
        '0.0.0': { get: async () => () => hostRegistry },
      },
    });
    assert.equal(globals.__catalogEffectApiEvaluations, undefined);

    const exposed = await (await container.get('./effect-api'))();
    assert.equal(globals.__catalogEffectApiEvaluations, 1);
    assert.equal(registered.length, 1);
    assert.equal(hostRegistry.is(exposed.runtime.createHandler), true);
    assert.equal(exposed.backendFederationContract.name, 'catalogBackend');
    delete globals.__catalogEffectApiEvaluations;
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});
