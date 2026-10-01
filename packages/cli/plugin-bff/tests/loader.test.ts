import os from 'node:os';
import path from 'node:path';
import { fs } from '@modern-js/utils';
import loader, { type APILoaderOptions } from '../src/loader';

async function run(
  resourcePath: string,
  source: string,
  options: APILoaderOptions,
) {
  return new Promise<string>((resolve, reject) => {
    void loader
      .call(
        {
          resourcePath,
          resourceQuery: '',
          cacheable: () => {},
          getOptions: () => options,
          async: () => (error: Error | null | undefined, code?: string) =>
            error ? reject(error) : resolve(code ?? ''),
        } as never,
        source,
      )
      .catch(reject);
  });
}

test('native loader emits lambda clients without the Effect loader', async () => {
  const appDir = await fs.mkdtemp(path.join(os.tmpdir(), 'native-bff-loader-'));
  try {
    const lambdaDir = path.join(appDir, 'api/lambda');
    const resourcePath = path.join(lambdaDir, 'ping.ts');
    const source =
      'export default async function handler() { return { ok: true }; }';
    await fs.outputFile(resourcePath, source);
    await fs.outputJSON(path.join(appDir, 'package.json'), {
      name: 'native-loader',
    });
    const code = await run(resourcePath, source, {
      appDir,
      apiDir: path.join(appDir, 'api'),
      lambdaDir,
      existLambda: true,
      prefix: '/api',
      port: 8080,
      target: 'bundle',
    });
    expect(code.length).toBeGreaterThan(0);
  } finally {
    await fs.remove(appDir);
  }
});

test('emits an executable diagnostic module for platform-native paths', async () => {
  const resourcePath = String.raw`D:\a\ultramodern.js\app\api\effect\index.ts`;
  const code = await run(resourcePath, 'export const invalid = true;', {
    apiDir: String.raw`D:\a\ultramodern.js\app\api`,
    appDir: String.raw`D:\a\ultramodern.js\app`,
    lambdaDir: String.raw`D:\a\ultramodern.js\app\api\lambda`,
    existLambda: false,
    port: 8080,
    prefix: '/api',
    target: 'web',
  });
  expect(() => Function(code)()).toThrow(
    `The file ${resourcePath} is not allowed to be imported in src directory, only API definition files are allowed.`,
  );
});

test.each([false, true])(
  'native loader forwards the neutral plugin and reports transform rejection=%s once',
  async reject => {
    const appDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'bff-loader-transform-'),
    );
    try {
      const lambdaDir = path.join(appDir, 'api/lambda');
      const resourcePath = path.join(lambdaDir, 'ping.ts');
      const source = 'export default () => "pong";';
      await fs.outputFile(resourcePath, source);
      await fs.outputJSON(path.join(appDir, 'package.json'), {
        name: 'loader-transform',
      });
      const plugin = path.join(appDir, 'transform.cjs');
      await fs.writeFile(
        plugin,
        reject
          ? 'exports.modifyClient = () => { throw new Error("loader transform rejected"); };'
          : 'exports.modifyClient = draft => { draft.statements.push("export const loaderTransform = true;"); };',
      );
      const callback = rstest.fn();
      await loader.call(
        {
          resourcePath,
          cacheable: () => {},
          async: () => callback,
          getOptions: () => ({
            appDir,
            apiDir: path.join(appDir, 'api'),
            lambdaDir,
            existLambda: true,
            prefix: '/api',
            port: 3000,
            target: 'client',
            clientCodegenPlugin: plugin,
            requestId: 'configured-loader-id',
          }),
        } as never,
        source,
      );
      expect(callback).toHaveBeenCalledTimes(1);
      if (reject) {
        expect(callback.mock.calls[0]?.[0]).toMatchObject({
          name: 'ClientCodegenError',
        });
      } else {
        expect(callback.mock.calls[0]?.[0]).toBeUndefined();
      }
    } finally {
      await fs.remove(appDir);
    }
  },
);
