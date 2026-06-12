import { fs } from '@modern-js/utils';
import path from 'path';
import { generateClient } from '../../src/client/generateClient';

const PWD = path.resolve(__dirname, '../fixtures/function');

describe('client', () => {
  test('generateClient should works correctly', async () => {
    const prefix = '/api';
    const port = 3000;
    const resourcePath = path.resolve(
      __dirname,
      '../fixtures/function/lambda/[id]/origin/foo.ts',
    );
    const source = await fs.readFile(resourcePath, 'utf-8');

    const result = await generateClient({
      appDir: __dirname,
      prefix,
      port,
      resourcePath,
      source,
      apiDir: PWD,
      lambdaDir: path.join(PWD, './lambda'),
      requireResolve: ((input: any) => input) as any,
    });
    expect(result.isOk).toBeTruthy();
    expect(result.value).toMatchSnapshot();
  });

  test('generateClient should support operator', async () => {
    const prefix = '/';
    const port = 3000;
    const resourcePath = path.resolve(
      __dirname,
      '../fixtures/function/lambda/normal/origin/index.ts',
    );
    const source = await fs.readFile(resourcePath, 'utf-8');

    const result = await generateClient({
      appDir: __dirname,
      prefix,
      port,
      resourcePath,
      source,
      apiDir: PWD,
      lambdaDir: path.join(PWD, './lambda'),
      requireResolve: ((input: any) => input) as any,
    });
    expect(result.isOk).toBeTruthy();
    expect(result.value).toMatchSnapshot();
  });

  test('generateClient should support cross project invocation', async () => {
    const prefix = '/';
    const port = 3000;
    const resourcePath = path.resolve(
      __dirname,
      '../fixtures/function/lambda/normal/origin/index.ts',
    );
    const source = await fs.readFile(resourcePath, 'utf-8');

    const result = await generateClient({
      appDir: __dirname,
      prefix,
      port,
      resourcePath,
      source,
      apiDir: PWD,
      lambdaDir: path.join(PWD, './lambda'),
      requireResolve: ((input: any) => input) as any,
      target: 'bundle',
    });
    expect(result.isOk).toBeTruthy();
    expect(result.value).toContain(
      `import { createRequest } from "@modern-js/plugin-bff/client";`,
    );
    expect(result.value).toContain(`export const operationSchemaHash`);
    expect(result.value).toContain(`export const operationVersion`);
    expect(result.value).toContain(`export const operationManifest`);
  });

  test('generateClient should default bundle producer clients to secure bootstrap path', async () => {
    const prefix = '/';
    const port = 3000;
    const resourcePath = path.resolve(
      __dirname,
      '../fixtures/function/lambda/normal/origin/index.ts',
    );
    const source = await fs.readFile(resourcePath, 'utf-8');

    const result = await generateClient({
      appDir: __dirname,
      prefix,
      port,
      resourcePath,
      source,
      apiDir: PWD,
      lambdaDir: path.join(PWD, './lambda'),
      requireResolve: ((input: any) => input) as any,
      target: 'bundle',
      requestId: 'producer-app',
    });

    expect(result.isOk).toBeTruthy();
    expect(result.value).toContain('export const initProducerClient =');
    expect(result.value).toContain('requestId: "producer-app"');
    expect(result.value).toContain('requireEnvelope: true');
    expect(result.value).toContain('enabled: true');
    expect(result.value).toContain('strict: true');
    expect(result.value).toContain('requireSchemaHash: true');
    expect(result.value).toContain('requireOperationVersion: true');
  });

  describe('upload operators', () => {
    const UPLOAD_PWD = path.resolve(__dirname, '../fixtures/upload');
    const uploadResourcePath = path.resolve(UPLOAD_PWD, 'lambda/index.ts');

    const generateUploadClient = async (requestId?: string) => {
      const source = await fs.readFile(uploadResourcePath, 'utf-8');
      return generateClient({
        appDir: __dirname,
        prefix: '/api',
        port: 3000,
        resourcePath: uploadResourcePath,
        source,
        apiDir: UPLOAD_PWD,
        lambdaDir: path.join(UPLOAD_PWD, 'lambda'),
        requireResolve: ((input: any) => input) as any,
        ...(requestId ? { target: 'bundle', requestId } : {}),
      });
    };

    test('emits createUploader for upload handlers (vanilla path)', async () => {
      const result = await generateUploadClient();

      expect(result.isOk).toBeTruthy();
      expect(result.value).toContain(
        'import { createRequest, createUploader } from',
      );
      expect(result.value).toMatch(
        /export var upload = createUploader\(\{"path":"\/api\/upload"\}\);/,
      );
      // non-upload sibling handlers still use createRequest
      expect(result.value).toContain('export var get = createRequest(');
    });

    test('emits createUploader with requestId and operation context for producer SDKs', async () => {
      const result = await generateUploadClient('producer-app');

      expect(result.isOk).toBeTruthy();
      expect(result.value).toContain(
        'const { createRequest, createUploader } = requestRuntime;',
      );

      const uploaderCall = result.value.match(
        /export var upload = createUploader\((\{.*?\})\);/s,
      );
      expect(uploaderCall).toBeTruthy();
      const uploaderOptions = JSON.parse(uploaderCall![1]!);
      expect(uploaderOptions).toMatchObject({
        path: '/api/upload',
        requestId: 'producer-app',
        operationContext: {
          operationId: 'upload',
          routePath: '/api/upload',
          method: 'POST',
          operationVersion: 1,
        },
      });
      expect(typeof uploaderOptions.operationContext.schemaHash).toBe('string');
      expect(
        uploaderOptions.operationContext.schemaHash.length,
      ).toBeGreaterThan(0);
    });
  });
});
