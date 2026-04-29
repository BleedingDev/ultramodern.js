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
});
