import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { createOperationContractHash } from '@modern-js/bff-core';
import { build } from 'esbuild';
import * as clientGeneratorSurface from '../src/client-generator';
import {
  generateEffectClient,
  resolveEffectEntryFile,
} from '../src/client-generator';
import * as sourceLoaderSurface from '../src/effect-source-loader';
import { generateEffectWorkerRuntimeWrapper } from '../src/effect-source-loader';

const fixtureRequire = createRequire(import.meta.url);

const createFixtureApp = async () => {
  const appDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'modern-bff-effect-client-'),
  );
  const apiDir = path.join(appDir, 'api');
  const resourcePath = path.join(apiDir, 'index.js');
  await fs.promises.mkdir(apiDir, { recursive: true });
  await fs.promises.writeFile(
    path.join(appDir, 'package.json'),
    JSON.stringify({ name: 'test-effect-app', version: '2.1.0' }),
  );
  await fs.promises.writeFile(
    resourcePath,
    `const { HttpApi, HttpApiEndpoint, HttpApiGroup, Layer, Schema } = require('@modern-js/plugin-bff/effect-client');
const api = HttpApi.make('CodegenTestApi').add(
  HttpApiGroup.make('greetings').add(
    HttpApiEndpoint.get('ping', '/ping', { success: Schema.Boolean }),
  ),
);
module.exports = { api, layer: Layer.empty };`,
  );
  return { apiDir, appDir, resourcePath };
};

async function executeGeneratedClient(code: string) {
  const result = await build({
    bundle: true,
    format: 'cjs',
    platform: 'node',
    stdin: {
      contents: code,
      resolveDir: __dirname,
      sourcefile: 'generated-effect-client.mjs',
    },
    write: false,
    plugins: [
      {
        name: 'effect-client-runtime',
        setup(buildApi) {
          buildApi.onResolve({ filter: /.*/ }, args =>
            args.kind === 'entry-point'
              ? undefined
              : { namespace: 'runtime', path: args.path },
          );
          buildApi.onLoad({ filter: /.*/, namespace: 'runtime' }, args => ({
            contents: args.path.endsWith('/effect-client-runtime')
              ? `export function createGeneratedEffectClient(manifest, config) {
  const client = { __config: config, __manifest: manifest };
  const operationManifest = {};
  for (const endpoint of manifest.endpoints) {
    client[endpoint.group] ||= {};
    operationManifest[endpoint.group] ||= {};
    const descriptor = { ...endpoint, appNamespace: config.appNamespace };
    client[endpoint.group][endpoint.endpoint] = async request => ({ request, descriptor });
    operationManifest[endpoint.group][endpoint.endpoint] = descriptor;
  }
  return { client, operationManifest, createEffectRequestContext: value => value };
}`
              : 'export const requestRuntime = true;',
            loader: 'js',
          }));
        },
      },
    ],
  });
  const output = result.outputFiles[0]?.text;
  if (!output) {
    throw new Error('generated Effect client bundle was empty');
  }
  const moduleRecord: { exports: Record<string, any> } = { exports: {} };
  Function(
    'module',
    'exports',
    'require',
    output,
  )(moduleRecord, moduleRecord.exports, fixtureRequire);
  return moduleRecord.exports;
}

describe('Effect client generation', () => {
  test('keeps the two substantive Node tooling surfaces explicit', () => {
    expect(Object.keys(clientGeneratorSurface).sort()).toEqual([
      'generateEffectClient',
      'generateEffectClientCode',
      'resolveEffectEntryFile',
    ]);
    expect(Object.keys(sourceLoaderSurface).sort()).toEqual([
      'bundleEffectEntryForNode',
      'generateEffectClientCode',
      'generateEffectWorkerRuntimeWrapper',
      'resolveEffectEntryFile',
    ]);
  });

  test('normalizes a missing Effect entry to undefined', async () => {
    const appDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'modern-bff-effect-entry-'),
    );
    const apiDir = path.join(appDir, 'api');

    try {
      await fs.promises.mkdir(apiDir, { recursive: true });
      expect(resolveEffectEntryFile({ apiDir, appDir })).toBeUndefined();

      const entry = path.join(apiDir, 'index.ts');
      await fs.promises.writeFile(entry, 'export const value = true;');
      expect(resolveEffectEntryFile({ apiDir, appDir })).toBe(entry);
    } finally {
      await fs.promises.rm(appDir, { recursive: true, force: true });
    }
  });

  test('generates exact public compatibility imports, endpoint types, and operation contracts', async () => {
    const { apiDir, appDir, resourcePath } = await createFixtureApp();

    try {
      const artifacts = await generateEffectClient({
        apiDir,
        appDir,
        resourcePath,
        prefix: '/api',
        port: 8080,
        target: 'bundle',
        requestId: 'catalog-service',
      });
      expect(artifacts).not.toBeNull();
      if (!artifacts) {
        return;
      }

      expect(artifacts.code).toContain(
        `from "@modern-js/plugin-bff/effect-client-runtime"`,
      );
      expect(artifacts.code).toContain(`from "@modern-js/plugin-bff/client"`);
      expect(artifacts.declaration).toContain(
        `"greetings": {\n    "ping": EffectClientOperation;`,
      );
      expect(artifacts.declaration).not.toContain(
        'Record<string, Record<string, EffectClientOperation>>',
      );

      const expectedHash = createOperationContractHash(
        { name: 'ping', httpMethod: 'GET', routePath: '/api/ping' },
        'catalog-service',
      );
      expect(artifacts.operationContracts['GET:/api/ping']).toMatchObject({
        method: 'GET',
        operationVersion: 2,
        requestId: 'catalog-service',
        routePath: '/api/ping',
        schemaHash: expectedHash,
      });

      const generated = await executeGeneratedClient(artifacts.code);
      await expect(
        generated.client.greetings.ping({ name: 'Ada' }),
      ).resolves.toMatchObject({
        request: { name: 'Ada' },
        descriptor: { schemaHash: expectedHash },
      });
    } finally {
      await fs.promises.rm(appDir, { recursive: true, force: true });
    }
  });

  test('worker generation stays isolated and merges generated contracts last', async () => {
    const { apiDir, appDir, resourcePath } = await createFixtureApp();

    try {
      const dependencies: string[] = [];
      const wrapper = await generateEffectWorkerRuntimeWrapper(
        { addDependency: dependency => dependencies.push(dependency) },
        {
          apiDir,
          appDir,
          port: 8080,
          prefix: '/api',
          requestId: 'catalog-service',
        },
        resourcePath,
      );

      expect(wrapper).toContain(
        `from '@modern-js/plugin-bff/effect-edge/dispatcher'`,
      );
      expect(wrapper).toContain(`${resourcePath}?modern-bff-runtime-source`);
      expect(wrapper).toContain(
        '...policy.expectedOperationContracts,\n      ...__generatedOperationContracts',
      );
      expect(wrapper).not.toContain('@modern-js/bff-effect');
      expect(dependencies).toContain(path.join(appDir, 'package.json'));
    } finally {
      await fs.promises.rm(appDir, { recursive: true, force: true });
    }
  });
});
