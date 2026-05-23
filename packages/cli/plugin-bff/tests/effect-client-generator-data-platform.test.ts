import fs from 'node:fs';
import path from 'node:path';
import {
  generateEffectClientCode,
  renderEffectClientDeclaration,
} from '../src/utils/effectClientGenerator';

describe('effect client generator data-platform integration', () => {
  test('generates client code with envelope integration and operation manifest', async () => {
    const appDir = await fs.promises.mkdtemp(
      path.join(__dirname, '.tmp-effect-client-'),
    );

    try {
      const apiDir = path.join(appDir, 'api');
      const effectDir = path.join(apiDir, 'effect');
      await fs.promises.mkdir(effectDir, { recursive: true });

      await fs.promises.writeFile(
        path.join(appDir, 'package.json'),
        JSON.stringify({ name: 'test-effect-app', version: '1.0.0' }, null, 2),
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
    HttpApiEndpoint.get('ping', '/effect/ping', {
      success: Schema.Struct({
        ok: Schema.Boolean,
      }),
    }),
  ),
);

module.exports = { api };
`,
      );

      const code = await generateEffectClientCode({
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

      expect(code).toBeTruthy();
      const generated = code as string;

      expect(generated).toContain('from "@modern-js/plugin-bff/data-platform"');
      expect(generated).toContain('createRequestEnvelope');
      expect(generated).toContain('encodeRequestEnvelopeHeader');
      expect(generated).toContain('createDataBatchTransport');
      expect(generated).toContain('__DEFAULT_BATCH_CONFIG');
      expect(generated).toContain('/api/_data/custom-batch');
      expect(generated).toContain('operationManifest');
      expect(generated).toContain('dataPlatform');
      expect(generated).toContain('allowCrossOriginEnvelope');
      expect(generated).toContain('__shouldAttachEnvelopeHeader');
      expect(generated).toContain('__configureRequest');
      expect(generated).toContain('"appNamespace":"test-effect-app"');
      expect(generated).toContain('operationContext');
      expect(generated).toContain('"schemaHash"');
      expect(generated).toContain('"operationVersion":1');
      expect(generated).toContain('createEffectRequestContext');
      expect(generated).toContain('request.requestContext');
      expect(generated).toContain('createRequestContextHeaders');
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
