import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { createOperationContractHash } from '@modern-js/server-runtime-extensions/bff-policy/node';
import { resolveEffectOperationContracts } from '../src/effect-source-loader';

const fixtureRequire = createRequire(import.meta.url);

const createFixtureApp = async () => {
  const appDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'modern-bff-effect-client-'),
  );
  const apiDir = path.join(appDir, 'api');
  const resourcePath = path.join(apiDir, 'index.js');
  await fs.promises.mkdir(apiDir, { recursive: true });
  const packageLinks = path.join(appDir, 'node_modules/@modern-js');
  await fs.promises.mkdir(packageLinks, { recursive: true });
  await fs.promises.symlink(
    path.dirname(fixtureRequire.resolve('@modern-js/bff-effect/package.json')),
    path.join(packageLinks, 'bff-effect'),
    'dir',
  );
  const appRequire = createRequire(resourcePath);
  expect(appRequire.resolve('@modern-js/bff-effect/effect-client')).toBe(
    fixtureRequire.resolve('@modern-js/bff-effect/effect-client'),
  );
  await fs.promises.writeFile(
    path.join(appDir, 'package.json'),
    JSON.stringify({ name: 'test-effect-app', version: '2.1.0' }),
  );
  await fs.promises.writeFile(
    resourcePath,
    `const { HttpApi, HttpApiEndpoint, HttpApiGroup, Layer, Schema } = require('@modern-js/bff-effect/effect-client');
const api = HttpApi.make('CodegenTestApi').add(
  HttpApiGroup.make('greetings').add(
    HttpApiEndpoint.get('ping', '/ping', { success: Schema.Boolean }),
  ),
);
module.exports = { api, layer: Layer.empty };`,
  );
  return { apiDir, appDir, resourcePath };
};

describe('Effect server operation contracts', () => {
  test('derives policy identity from the shared HttpApi without generating a client', async () => {
    const { appDir, resourcePath } = await createFixtureApp();
    try {
      const contracts = await resolveEffectOperationContracts({
        appDir,
        resourcePath,
        prefix: '/api',
        requestId: 'catalog-service',
      });
      const expectedHash = createOperationContractHash(
        { name: 'ping', httpMethod: 'GET', routePath: '/api/ping' },
        'catalog-service',
      );
      expect(contracts?.['GET:/api/ping']).toMatchObject({
        method: 'GET',
        operationVersion: 2,
        requestId: 'catalog-service',
        routePath: '/api/ping',
        schemaHash: expectedHash,
      });
      const defaults = await resolveEffectOperationContracts({
        appDir,
        resourcePath,
        prefix: '/api',
      });
      expect(defaults?.['GET:/api/ping']).toMatchObject({
        requestId: 'test-effect-app',
        operationVersion: 2,
      });
    } finally {
      await fs.promises.rm(appDir, { recursive: true, force: true });
    }
  });

  test('applies source.globalVars while it loads the HttpApi contract', async () => {
    const { appDir, resourcePath } = await createFixtureApp();
    try {
      await fs.promises.writeFile(
        resourcePath,
        `const { HttpApi, HttpApiEndpoint, HttpApiGroup, Layer, Schema } = require('@modern-js/bff-effect/effect-client');
const api = HttpApi.make('GlobalVarsApi').add(
  HttpApiGroup.make('build').add(
    HttpApiEndpoint.get('marker', BFF_MARKER_PATH, { success: Schema.String }),
  ),
);
module.exports = { api, layer: Layer.empty };`,
      );
      const contracts = await resolveEffectOperationContracts({
        appDir,
        resourcePath,
        prefix: '/api',
        globalVars: { BFF_MARKER_PATH: '/build-marker' },
      });
      expect(contracts?.['GET:/api/build-marker']).toMatchObject({
        method: 'GET',
        routePath: '/api/build-marker',
      });
    } finally {
      await fs.promises.rm(appDir, { recursive: true, force: true });
    }
  });
});
