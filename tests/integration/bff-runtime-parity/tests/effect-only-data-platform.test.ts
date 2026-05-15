/**
 * @jest-environment node
 */
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
  'integration/bff-corss-project/bff-api-app',
);
const ensureWorkspacePackages = [
  '@modern-js/create-request',
  '@modern-js/bff-core',
  '@modern-js/plugin-bff',
  '@modern-js/server-runtime',
];

const readFixture = (relativePath: string) =>
  fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');

describe('effect-only cross-project BFF contracts', () => {
  let servePort = 0;
  let servedApiApp: any;
  let releaseFixtureLock: ReleaseFixtureLock | undefined;

  beforeAll(async () => {
    releaseFixtureLock = await acquireFixtureLock(crossProjectApiApp);
    await modernBuild(crossProjectApiApp, [], { ensureWorkspacePackages });
    servePort = await getPort();
    servedApiApp = await modernServe(crossProjectApiApp, servePort, {});
  });

  afterAll(async () => {
    try {
      await killApp(servedApiApp);
    } finally {
      await releaseFixtureLock?.();
    }
  });

  test('generated effect client includes batch transport and envelope integration hooks', () => {
    const code = readFixture(
      'integration/bff-corss-project/bff-api-app/dist-1/client/effect/index.js',
    );

    expect(code).toContain('createDataBatchTransport');
    expect(code).toContain('DEFAULT_DATA_BATCH_HEADER');
    expect(code).toContain('createRequestEnvelope');
    expect(code).toContain('DEFAULT_DATA_ENVELOPE_HEADER');
    expect(code).toContain('const __REQUEST_ID = "bff-api-app"');
    expect(code).toContain('requestId: __REQUEST_ID');
    expect(code).toContain('createEffectRequestContext');
    expect(code).toContain('request.requestContext');
  });

  test('generated effect client encodes strict envelope fallback semantics', () => {
    const code = readFixture(
      'integration/bff-corss-project/bff-api-app/dist-1/client/effect/index.js',
    );

    expect(code).toContain(
      'if (!strictEnvelope && !__shouldAttachEnvelopeHeader(dataPlatform))',
    );
    expect(code).toContain('if (dataPlatform.batch === false)');
    expect(code).toContain("headers[DEFAULT_DATA_BATCH_HEADER] = 'off'");
    expect(code).toContain('headers[headerName] = encodeRequestEnvelopeHeader');
    expect(code).toContain('if (strictEnvelope) {');
    expect(code).toContain('throw error;');
  });

  test('generated runtime wrapper preserves producer requestId bootstrap contract', () => {
    const runtimeCode = readFixture(
      'integration/bff-corss-project/bff-api-app/dist-1/runtime/index.js',
    );

    expect(runtimeCode).toContain(
      'const { configure: _configure } = require("@modern-js/plugin-bff/client");',
    );
    expect(runtimeCode).toContain(
      'exports.initProducerClient = initProducerClient',
    );
    expect(runtimeCode).toContain('requestId: "bff-api-app"');
  });

  test('generated effect client emits operation manifest for contract-aware consumers', () => {
    const code = readFixture(
      'integration/bff-corss-project/bff-api-app/dist-1/client/effect/index.js',
    );

    expect(code).toContain('const operationManifest =');
    expect(code).toContain('"appNamespace":"bff-api-app"');
    expect(code).toContain('"group":"greetings"');
    expect(code).toContain('"endpoint":"hello"');
    expect(code).toContain(
      'export { client, createEffectRequestContext, operationManifest };',
    );
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
