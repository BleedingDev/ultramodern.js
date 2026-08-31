import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { promisify } from 'node:util';
import { createOperationContractHash } from '@modern-js/bff-core';
import { generateEffectClient } from '@modern-js/plugin-bff-extensions/client-generator';
import { build } from 'esbuild';

const execFileAsync = promisify(execFile);
const fixtureRequire = createRequire(import.meta.url);

const createFixtureApp = async () => {
  const appDir = await fs.promises.mkdtemp(
    path.join(__dirname, '.tmp-effect-client-'),
  );
  const apiDir = path.join(appDir, 'api');
  const effectDir = path.join(apiDir, 'effect');
  await fs.promises.mkdir(effectDir, { recursive: true });

  await fs.promises.writeFile(
    path.join(appDir, 'package.json'),
    JSON.stringify({ name: 'test-effect-app', version: '2.1.0' }, null, 2),
  );

  const resourcePath = path.join(effectDir, 'index.js');
  await fs.promises.writeFile(
    resourcePath,
    `const {
      HttpApi,
      HttpApiEndpoint,
      HttpApiGroup,
      Layer,
      Schema,
    } = require('@modern-js/plugin-bff/effect-client');

const api = HttpApi.make('CodegenTestApi').add(
  HttpApiGroup.make('greetings').add(
    HttpApiEndpoint.get('ping', '/ping', {
      success: Schema.Struct({
        ok: Schema.Boolean,
      }),
    }),
  ),
);

    module.exports = { api, layer: Layer.empty };
    `,
  );

  return { appDir, apiDir, resourcePath };
};

async function executeGeneratedEffectClient(code: string) {
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
          buildApi.onResolve({ filter: /.*/ }, args => {
            if (args.kind === 'entry-point') {
              return undefined;
            }
            return { namespace: 'effect-client-runtime', path: args.path };
          });
          buildApi.onLoad(
            { filter: /.*/, namespace: 'effect-client-runtime' },
            args => {
              if (args.path.endsWith('/effect-client-runtime')) {
                return {
                  contents: [
                    'export function createGeneratedEffectClient(manifest, config) {',
                    '  const client = { __config: config, __manifest: manifest };',
                    '  const operationManifest = {};',
                    '  for (const endpoint of manifest.endpoints) {',
                    '    client[endpoint.group] ||= {};',
                    '    operationManifest[endpoint.group] ||= {};',
                    '    const descriptor = { ...endpoint, appNamespace: config.appNamespace, operationId: endpoint.endpoint, version: endpoint.operationVersion };',
                    '    client[endpoint.group][endpoint.endpoint] = async request => ({ request, descriptor });',
                    '    operationManifest[endpoint.group][endpoint.endpoint] = descriptor;',
                    '  }',
                    '  return { client, operationManifest, createEffectRequestContext: context => context };',
                    '}',
                  ].join('\n'),
                  loader: 'js',
                };
              }
              return {
                contents: 'export const requestRuntime = true;',
                loader: 'js',
              };
            },
          );
        },
      },
    ],
  });
  const output = result.outputFiles[0]?.text;
  if (!output) {
    throw new Error('generated Effect client bundle was empty');
  }
  const moduleRecord: { exports: Record<string, any> } = { exports: {} };
  const evaluate = new Function('module', 'exports', 'require', output);
  evaluate(moduleRecord, moduleRecord.exports, fixtureRequire);
  return moduleRecord.exports;
}

async function typecheckGeneratedDeclaration(
  appDir: string,
  declaration: string,
) {
  const fixtureDir = path.join(appDir, 'declaration-contract');
  await fs.promises.mkdir(fixtureDir, { recursive: true });
  await fs.promises.writeFile(path.join(fixtureDir, 'index.d.ts'), declaration);
  await fs.promises.writeFile(
    path.join(fixtureDir, 'consumer.ts'),
    [
      "import { client, createEffectRequestContext, operationManifest } from './index';",
      "const response: Promise<unknown> = client.greetings.ping({ name: 'Ada' });",
      'const endpoint: string = operationManifest.greetings.ping.endpoint;',
      "const context = createEffectRequestContext({ locale: 'cs' });",
      'void response;',
      'void endpoint;',
      'void context;',
    ].join('\n'),
  );
  await fs.promises.writeFile(
    path.join(fixtureDir, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          module: 'Preserve',
          moduleResolution: 'Bundler',
          noEmit: true,
          noUnusedLocals: true,
          strict: true,
          target: 'ESNext',
          types: [],
        },
        include: ['*.ts', '*.d.ts'],
      },
      null,
      2,
    ),
  );
  try {
    await execFileAsync(
      process.platform === 'win32' ? 'tsgo.cmd' : 'tsgo',
      ['-p', 'tsconfig.json'],
      {
        cwd: fixtureDir,
        shell: process.platform === 'win32',
      },
    );
  } catch (error) {
    const output = error as { stderr?: string; stdout?: string };
    throw new Error([output.stdout, output.stderr].filter(Boolean).join('\n'));
  }
}

describe('effect client generator data-platform integration', () => {
  test('executes manifest and batch configuration through the shared runtime', async () => {
    const { appDir, apiDir, resourcePath } = await createFixtureApp();

    try {
      const artifacts = await generateEffectClient({
        appDir,
        apiDir,
        resourcePath,
        prefix: '/api',
        port: 8080,
        target: 'bundle',
        dataPlatformBatch: {
          endpoint: '/_data/custom-batch',
          maxBatchSize: 12,
          maxBatchBytes: 8192,
          flushIntervalMs: 5,
          requestTimeoutMs: 4000,
          allowedMethods: ['GET'],
        },
      });
      if (!artifacts) {
        throw new Error('Effect client artifacts were not generated');
      }
      const generated = await executeGeneratedEffectClient(artifacts.code);
      const expectedHash = createOperationContractHash(
        {
          name: 'ping',
          httpMethod: 'GET',
          routePath: '/api/ping',
        },
        'test-effect-app',
      );

      expect(generated.client.__manifest.endpoints).toEqual([
        {
          apiId: 'CodegenTestApi',
          group: 'greetings',
          endpoint: 'ping',
          method: 'GET',
          routePath: '/api/ping',
          schemaHash: expectedHash,
          operationVersion: 2,
        },
      ]);
      expect(generated.client.__config).toMatchObject({
        appNamespace: 'test-effect-app',
        requestId: 'test-effect-app',
        batch: {
          endpoint: '/api/_data/custom-batch',
          maxBatchSize: 12,
          maxBatchBytes: 8192,
          flushIntervalMs: 5,
          requestTimeoutMs: 4000,
          allowedMethods: ['GET'],
        },
      });
      await expect(
        generated.client.greetings.ping({ name: 'Ada' }),
      ).resolves.toMatchObject({
        request: { name: 'Ada' },
        descriptor: {
          endpoint: 'ping',
          operationVersion: 2,
          schemaHash: expectedHash,
        },
      });
      await typecheckGeneratedDeclaration(appDir, artifacts.declaration);
    } finally {
      await fs.promises.rm(appDir, { recursive: true, force: true });
    }
  });

  test('per-endpoint hashes are scoped to the producer requestId', async () => {
    const { appDir, apiDir, resourcePath } = await createFixtureApp();

    try {
      const bundle = await generateEffectClient({
        appDir,
        apiDir,
        resourcePath,
        prefix: '/api',
        port: 8080,
        target: 'bundle',
      });
      const local = await generateEffectClient({
        appDir,
        apiDir,
        resourcePath,
        prefix: '/api',
        port: 8080,
      });
      if (!bundle || !local) {
        throw new Error('Effect client artifacts were not generated');
      }
      const bundleClient = await executeGeneratedEffectClient(bundle.code);
      const localClient = await executeGeneratedEffectClient(local.code);

      expect(
        bundleClient.operationManifest.greetings.ping.schemaHash,
      ).toHaveLength(64);
      expect(
        localClient.operationManifest.greetings.ping.schemaHash,
      ).toHaveLength(64);
      expect(bundleClient.operationManifest.greetings.ping.schemaHash).not.toBe(
        localClient.operationManifest.greetings.ping.schemaHash,
      );
    } finally {
      await fs.promises.rm(appDir, { recursive: true, force: true });
    }
  });

  test('publishes the exact client manifest as server operation contracts', async () => {
    const { appDir, apiDir, resourcePath } = await createFixtureApp();

    try {
      const artifacts = await generateEffectClient({
        appDir,
        apiDir,
        resourcePath,
        prefix: '/api',
        port: 8080,
        target: 'bundle',
        requestId: 'catalog-service',
      });
      if (!artifacts) {
        throw new Error('Effect client artifacts were not generated');
      }
      const generated = await executeGeneratedEffectClient(artifacts.code);
      const endpoint = generated.client.__manifest.endpoints[0];
      const routeContract = artifacts.operationContracts['GET:/api/ping'];

      expect(artifacts).toMatchObject({
        operationVersion: 2,
        requestId: 'catalog-service',
      });
      expect(routeContract).toMatchObject({
        requestId: 'catalog-service',
        operationVersion: 2,
        method: 'GET',
        routePath: '/api/ping',
        schemaHash: endpoint.schemaHash,
      });
      expect(
        artifacts.operationContracts['operation:catalog-service:ping'],
      ).toBe(routeContract);
    } finally {
      await fs.promises.rm(appDir, { recursive: true, force: true });
    }
  });
});
