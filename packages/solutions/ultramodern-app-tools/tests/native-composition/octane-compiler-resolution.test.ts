import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SERVICE_WORKER_ENVIRONMENT_NAME } from '@modern-js/builder';
import { createRsbuild } from '@rsbuild/core';
import { afterEach, describe, expect, it } from '@rstest/core';
import { resolveNativeRendererAdapter } from '../../src/native-composition/renderer-registration';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

function write(filename: string, source: string) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, source);
}

describe('Octane compiler module resolution', () => {
  it('resolves native link APIs and TSRX components without extension reordering', async () => {
    const root = fs.realpathSync(
      fs.mkdtempSync(
        path.join(process.env.OWNED_TEMP_DIR ?? os.tmpdir(), 'octane-ext-'),
      ),
    );
    roots.push(root);
    write(
      path.join(root, 'package.json'),
      JSON.stringify({ name: 'octane-native-resolution', private: true }),
    );
    // The native router names its API linkApi.ts separately from Link.tsrx.
    const router = path.join(root, 'node_modules/@octanejs/fixture-router/src');
    write(path.join(router, 'linkApi.ts'), 'export const linkOptions = 1;\n');
    write(path.join(router, 'Link.tsrx'), 'export const Link = 1;\n');
    write(path.join(root, 'src/Counter.tsrx'), 'export const Counter = 1;\n');
    write(path.join(root, 'src/index.ts'), 'export {};\n');
    // The application owns the compiler that its adapter resolves.
    const compilerPackage = path.join(
      root,
      'node_modules/@octanejs/rspack-plugin',
    );
    fs.symlinkSync(
      fs.realpathSync(
        path.join(__dirname, '../../node_modules/@octanejs/rspack-plugin'),
      ),
      compilerPackage,
      'junction',
    );

    const rsbuild = await createRsbuild({
      cwd: root,
      rsbuildConfig: {
        source: { entry: { index: './src/index.ts' } },
        plugins: [
          resolveNativeRendererAdapter('octane').compiler({
            rendererIdentities: () => ({}),
            workerEnvironmentName: SERVICE_WORKER_ENVIRONMENT_NAME,
          }),
        ],
      },
    });
    const compiler = await rsbuild.createCompiler();
    const single = 'compilers' in compiler ? compiler.compilers[0] : compiler;
    const resolver = single.resolverFactory.get('normal', {
      ...single.options.resolve,
      dependencyType: 'esm',
    });
    try {
      expect(resolver.resolveSync({}, router, './linkApi')).toBe(
        path.join(router, 'linkApi.ts'),
      );
      expect(resolver.resolveSync({}, router, './Link')).toBe(
        path.join(router, 'Link.tsrx'),
      );
      expect(
        resolver.resolveSync({}, path.join(root, 'src'), './Counter'),
      ).toBe(path.join(root, 'src/Counter.tsrx'));
    } finally {
      await new Promise<void>((resolve, reject) =>
        compiler.close(error => (error ? reject(error) : resolve())),
      );
    }
  }, 120_000);
});
