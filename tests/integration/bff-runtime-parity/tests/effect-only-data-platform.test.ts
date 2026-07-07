/**
 * @jest-environment node
 */

import { createRequire } from 'node:module';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import {
  acquireFixtureLock,
  type ReleaseFixtureLock,
} from '../../../utils/fixtureLock';
import {
  getPort,
  killApp,
  modernBuild,
  modernServe,
} from '../../../utils/modernTestUtils';

const projectRoot = path.resolve(__dirname, '../../..');
const crossProjectApiApp = path.join(
  projectRoot,
  'integration/bff-cross-project/bff-api-app',
);
const ensureWorkspacePackages = [
  '@modern-js/create-request',
  '@modern-js/bff-core',
  '@modern-js/plugin-bff',
  '@modern-js/server-runtime',
];

const readFixture = (relativePath: string) =>
  fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');

const generatedEffectClientPath =
  'integration/bff-cross-project/bff-api-app/dist-1/client/effect/index.js';

const requireFromApiApp = createRequire(
  path.join(crossProjectApiApp, 'package.json'),
);

/**
 * Extracts a `const <name> = {...};` JSON object literal emitted by the
 * effect client generator (the generator pretty-prints plain JSON, so the
 * literal is parseable as-is).
 */
const readGeneratedJsonConst = (
  code: string,
  name: string,
): Record<string, any> => {
  const match = code.match(
    new RegExp(`const ${name} = (\\{[\\s\\S]*?\\n\\});`),
  );
  if (!match) {
    throw new Error(`Generated client does not declare const ${name} = {...}`);
  }
  return JSON.parse(match[1]);
};

describe('effect-only cross-project BFF contracts', () => {
  let servePort = 0;
  let servedApiApp: any;
  let releaseFixtureLock: ReleaseFixtureLock | undefined;

  beforeAll(async () => {
    releaseFixtureLock = await acquireFixtureLock(crossProjectApiApp);
    await modernBuild(crossProjectApiApp, [], { ensureWorkspacePackages });
    servePort = await getPort();
    servedApiApp = await modernServe(crossProjectApiApp, servePort, {});
    // The generated client is a browser artifact: give it a page origin
    // before anything imports it (configure() captures the origin).
    (
      globalThis as typeof globalThis & {
        location?: { origin: string };
      }
    ).location = {
      origin: `http://127.0.0.1:${servePort}`,
    };
  });

  afterAll(async () => {
    try {
      await killApp(servedApiApp);
    } finally {
      await releaseFixtureLock?.();
    }
  });

  test('generated effect client delegates batch transport and envelope wiring to the shared runtime', () => {
    const code = readFixture(generatedEffectClientPath);

    // The generated module is a thin manifest + one call into the shared
    // effect-client runtime; transport/envelope code is no longer inlined.
    expect(code).toContain(
      'import * as __requestRuntime from "@modern-js/plugin-bff/client";',
    );
    expect(code).toContain(
      'import { createGeneratedEffectClient } from "@modern-js/plugin-bff/effect-client-runtime";',
    );
    expect(code).toContain(
      'createGeneratedEffectClient(__manifest, __config, __requestRuntime)',
    );
    expect(code).not.toContain('createDataBatchTransport');
    expect(code).not.toContain('encodeRequestEnvelopeHeader');

    // The runtime receives the batch/envelope wiring through __config.
    const config = readGeneratedJsonConst(code, '__config');
    expect(config.appNamespace).toBe('bff-api-app');
    expect(config.requestId).toBe('bff-api-app');
    expect(config.httpMethodDecider).toBe('functionName');
    expect(typeof config.port).toBe('number');
    expect(config.defaultOrigin).toMatch(/^http:\/\/localhost:\d+$/);
    expect(config.batch).toMatchObject({
      enabled: true,
      endpoint: '/api-app/_data/batch',
    });
    expect(config.batch.allowedMethods).toContain('GET');
    for (const key of [
      'flushIntervalMs',
      'maxBatchSize',
      'maxBatchBytes',
      'requestTimeoutMs',
    ]) {
      expect(config.batch[key]).toBeGreaterThan(0);
    }
  });

  test('effect-client runtime preserves strict envelope fallback semantics', async () => {
    // Resolve the runtime module exactly where the generated import points.
    const runtime = requireFromApiApp(
      '@modern-js/plugin-bff/effect-client-runtime',
    );
    const dataPlatform = requireFromApiApp(
      '@modern-js/plugin-bff/data-platform',
    );

    const manifest = {
      endpoints: [
        {
          apiId: 'EffectHttpApi',
          group: 'greetings',
          endpoint: 'hello',
          method: 'GET',
          routePath: '/api-app/effect/hello',
          schemaHash: 'a'.repeat(64),
          operationVersion: 2,
        },
      ],
    };
    const config = {
      appNamespace: 'bff-api-app',
      port: 3399,
      defaultOrigin: 'http://localhost:3399',
      httpMethodDecider: 'functionName',
      batch: {
        enabled: false,
        endpoint: '/api-app/_data/batch',
        flushIntervalMs: 8,
        maxBatchSize: 16,
        maxBatchBytes: 65536,
        requestTimeoutMs: 10000,
        allowedMethods: ['GET'],
      },
    };

    const sentPayloads: Array<Record<string, any>> = [];
    const createRequestCalls: Array<Record<string, any>> = [];
    const requestRuntime = {
      createRequest: (options: Record<string, any>) => {
        createRequestCalls.push(options);
        return (payload: Record<string, any>) => {
          sentPayloads.push(payload);
          return Promise.resolve({ ok: true });
        };
      },
    };

    const generated = runtime.createGeneratedEffectClient(
      manifest,
      config,
      requestRuntime,
    );

    // The per-operation contract flows into the request creator.
    expect(createRequestCalls[0].operationContext).toMatchObject({
      operationId: 'GET:/api-app/effect/hello',
      routePath: '/api-app/effect/hello',
      method: 'GET',
      schemaHash: 'a'.repeat(64),
      operationVersion: 2,
    });

    // Strict envelope: an envelope construction failure must fail the call
    // (the runtime surfaces it synchronously, same as the legacy inline
    // template; wrap so the assertion holds for sync or async failure).
    await expect(
      Promise.resolve().then(() =>
        generated.client.greetings.hello({
          dataPlatform: { requireEnvelope: true, requireTraceContext: true },
        }),
      ),
    ).rejects.toThrow('Trace context is required');

    // Non-strict: the same failure falls back to the bare request.
    sentPayloads.length = 0;
    await expect(
      generated.client.greetings.hello({
        dataPlatform: { requireTraceContext: true },
      }),
    ).resolves.toEqual({ ok: true });
    expect(sentPayloads).toHaveLength(1);
    expect(
      sentPayloads[0].headers?.[dataPlatform.DEFAULT_DATA_ENVELOPE_HEADER],
    ).toBeUndefined();

    // Happy path: envelope header attached, per-request batch opt-out honored.
    sentPayloads.length = 0;
    await expect(
      generated.client.greetings.hello({
        dataPlatform: { allowCrossOriginEnvelope: true, batch: false },
      }),
    ).resolves.toEqual({ ok: true });
    expect(sentPayloads).toHaveLength(1);
    const headers = sentPayloads[0].headers as Record<string, string>;
    expect(headers[dataPlatform.DEFAULT_DATA_BATCH_HEADER]).toBe('off');
    expect(typeof headers[dataPlatform.DEFAULT_DATA_ENVELOPE_HEADER]).toBe(
      'string',
    );
    expect(
      headers[dataPlatform.DEFAULT_DATA_ENVELOPE_HEADER].length,
    ).toBeGreaterThan(0);
  });

  test('generated runtime wrapper preserves producer requestId bootstrap contract', () => {
    const runtimeCode = readFixture(
      'integration/bff-cross-project/bff-api-app/dist-1/runtime/index.js',
    );

    expect(runtimeCode).toContain(
      'const { configure: _configure } = require("@modern-js/plugin-bff/client");',
    );
    expect(runtimeCode).toContain(
      'exports.initProducerClient = initProducerClient',
    );
    expect(runtimeCode).toContain('requestId: "bff-api-app"');
  });

  test('generated effect client emits operation manifest for contract-aware consumers', async () => {
    const code = readFixture(generatedEffectClientPath);
    const manifest = readGeneratedJsonConst(code, '__manifest');

    const sdkPackageJson = JSON.parse(
      fs.readFileSync(path.join(crossProjectApiApp, 'package.json'), 'utf8'),
    ) as { version: string };
    const expectedOperationVersion = Number.parseInt(
      sdkPackageJson.version.split('.')[0],
      10,
    );

    expect(Array.isArray(manifest.endpoints)).toBe(true);
    expect(manifest.endpoints.length).toBeGreaterThan(0);
    for (const endpoint of manifest.endpoints) {
      expect(endpoint).toEqual(
        expect.objectContaining({
          apiId: expect.any(String),
          group: expect.any(String),
          endpoint: expect.any(String),
          method: expect.any(String),
          routePath: expect.any(String),
        }),
      );
      // Real per-operation contract hash, not a placeholder.
      expect(endpoint.schemaHash).toMatch(/^[0-9a-f]{64}$/);
      // Contract version derived from the SDK package's semver major.
      expect(Number.isInteger(endpoint.operationVersion)).toBe(true);
      expect(endpoint.operationVersion).toBeGreaterThanOrEqual(1);
      expect(endpoint.operationVersion).toBe(expectedOperationVersion);
    }

    // Hashes are schema-derived: distinct operations hash differently.
    const hashes = new Set(
      manifest.endpoints.map(
        (endpoint: { schemaHash: string }) => endpoint.schemaHash,
      ),
    );
    expect(hashes.size).toBe(manifest.endpoints.length);

    const hello = manifest.endpoints.find(
      (endpoint: { group: string; endpoint: string }) =>
        endpoint.group === 'greetings' && endpoint.endpoint === 'hello',
    );
    expect(hello).toMatchObject({
      method: 'GET',
      routePath: '/api-app/effect/hello',
    });

    // The built module exposes the manifest per group/endpoint.
    const effectModule = await import(
      pathToFileURL(
        path.join(crossProjectApiApp, 'dist-1/client/effect/index.js'),
      ).href
    );
    expect(effectModule.operationManifest.greetings.hello).toMatchObject({
      appNamespace: 'bff-api-app',
      operationId: `GET:${hello.routePath}`,
      schemaHash: hello.schemaHash,
      operationVersion: expectedOperationVersion,
    });
    expect(typeof effectModule.client.greetings.hello).toBe('function');
    expect(typeof effectModule.createEffectRequestContext).toBe('function');
  });

  test('generated effect client requestContext propagates locale and traceparent end-to-end', async () => {
    (
      globalThis as typeof globalThis & {
        location?: { origin: string };
      }
    ).location = {
      origin: `http://127.0.0.1:${servePort}`,
    };
    const effectModule = await import(
      pathToFileURL(
        path.join(crossProjectApiApp, 'dist-1/client/effect/index.js'),
      ).href
    );

    const requestContext = effectModule.createEffectRequestContext({
      locale: 'cs-CZ',
      traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
    });

    const response = await effectModule.client.greetings.traceHeader({
      requestContext,
      dataPlatform: {
        batch: false,
      },
    });

    expect(response).toEqual({
      runtime: 'effect',
      locale: 'cs-CZ',
      traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
    });
  });
});
