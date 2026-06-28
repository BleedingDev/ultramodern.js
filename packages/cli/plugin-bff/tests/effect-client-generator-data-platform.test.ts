import fs from 'node:fs';
import path from 'node:path';
import { createOperationContractHash } from '@modern-js/bff-core';
import {
  generateEffectClient,
  renderEffectClientDeclaration,
} from '../src/utils/effectClientGenerator';

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

module.exports = { api };
`,
  );

  return { appDir, apiDir, resourcePath };
};

describe('effect client generator data-platform integration', () => {
  test('generates a manifest module backed by the shared effect-client runtime', async () => {
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

      expect(artifacts).toBeTruthy();
      const generated = artifacts!.code;

      // The runtime is imported, not inlined into the generated module.
      expect(generated).toContain(
        'from "@modern-js/plugin-bff/effect-client-runtime"',
      );
      expect(generated).toContain('createGeneratedEffectClient(');
      expect(generated).not.toContain('__prepareEffectRequest');
      expect(generated).not.toContain('__shouldAttachEnvelopeHeader');

      // Endpoint manifest with per-endpoint contract hashes.
      const expectedHash = createOperationContractHash(
        {
          name: 'ping',
          httpMethod: 'GET',
          routePath: '/api/ping',
        },
        'test-effect-app',
      );
      expect(generated).toContain(`"schemaHash": "${expectedHash}"`);
      // operationVersion derived from the producer package major (2.1.0).
      expect(generated).toContain('"operationVersion": 2');

      // Cross-project + batch transport configuration survives.
      expect(generated).toContain('"requestId": "test-effect-app"');
      expect(generated).toContain('"appNamespace": "test-effect-app"');
      expect(generated).toContain('"endpoint": "/api/_data/custom-batch"');
      expect(generated).toContain('"maxBatchSize": 12');
      expect(generated).toContain('"maxBatchBytes": 8192');
      expect(generated).toContain('"flushIntervalMs": 5');
      expect(generated).toContain('"requestTimeoutMs": 4000');

      expect(generated).toContain(
        'export { client, createEffectRequestContext, operationManifest }',
      );
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

      const readHash = (code: string) => {
        const match = code.match(/"schemaHash": "([0-9a-f]{64})"/);
        return match?.[1];
      };

      expect(readHash(bundle!.code)).toBeTruthy();
      expect(readHash(local!.code)).toBeTruthy();
      // bundle target hashes against the package requestId, local against 'default'
      expect(readHash(bundle!.code)).not.toBe(readHash(local!.code));
    } finally {
      await fs.promises.rm(appDir, { recursive: true, force: true });
    }
  });

  test('generated code and declaration snapshots', async () => {
    const { appDir, apiDir, resourcePath } = await createFixtureApp();

    try {
      const artifacts = await generateEffectClient({
        appDir,
        apiDir,
        resourcePath,
        prefix: '/api',
        port: 8080,
        target: 'bundle',
      });
      expect(artifacts!.code).toMatchSnapshot();
      expect(artifacts!.declaration).toMatchSnapshot();
    } finally {
      await fs.promises.rm(appDir, { recursive: true, force: true });
    }
  });

  test('declaration preserves group/endpoint structure for the typed client', async () => {
    const { appDir, apiDir, resourcePath } = await createFixtureApp();

    try {
      const artifacts = await generateEffectClient({
        appDir,
        apiDir,
        resourcePath,
        prefix: '/api',
        port: 8080,
        target: 'bundle',
      });
      const declaration = artifacts!.declaration;

      expect(declaration).toContain('"greetings": {');
      expect(declaration).toContain('"ping": EffectClientOperation;');
      expect(declaration).toContain('"ping": EffectOperationDescriptor;');
      expect(declaration).toContain(
        'export declare const client: GeneratedEffectClient;',
      );
      // The typed client is no longer erased to Record<string, ...>.
      expect(declaration).not.toContain(
        'export declare const client: EffectClient;',
      );
    } finally {
      await fs.promises.rm(appDir, { recursive: true, force: true });
    }
  });

  test('declaration includes operation manifest contract', () => {
    const declaration = renderEffectClientDeclaration();
    expect(declaration).toContain('EffectOperationManifest');
    expect(declaration).toContain('EffectOperationContext');
    expect(declaration).toContain('EffectRequestContext');
    expect(declaration).toContain('createEffectRequestContext');
    expect(declaration).toContain('operationManifest');
  });
});
