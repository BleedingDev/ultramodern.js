import { fs } from '@modern-js/utils';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import { compile } from '../src';
import { createIsolatedTsExample } from './helpers';

describe('typescript', () => {
  const loadEsmModule = async (distDir: string, entry: string) => {
    await fs.outputJSON(path.join(distDir, 'package.json'), { type: 'module' });
    return import(`${pathToFileURL(entry).href}?t=${Date.now()}`);
  };

  it('compile typescript', async () => {
    const { example, tempRoot } = await createIsolatedTsExample();
    const tsconfigPath = path.join(example, './tsconfig.json');
    const distDir = path.join(example, './dist');
    const sharedDir = path.join(example, './shared');
    const apiDir = path.join(example, './api');
    const serverDir = path.join(example, './server');

    try {
      await compile(
        example,
        {
          alias: {
            '@modern-js/runtime/server': path.join(
              sharedDir,
              './runtime/server',
            ),
          },
        } as any,
        {
          sourceDirs: [sharedDir, apiDir, serverDir],
          distDir,
          tsconfigPath,
        },
      );

      const distApiDir = path.join(example, './dist', './api');

      const api = require(distApiDir).default;
      expect(api()).toEqual('runtime-shared-api');

      const distServerDir = path.join(distDir, './server');
      const server = require(distServerDir).default;
      expect(server()).toEqual('shared-server');

      const files = await fs.readdir(distServerDir);
      expect(files.length).toBe(2);

      const distSrcDir = path.join(distDir, './src');
      expect(await fs.pathExists(distSrcDir)).toBeFalsy();

      const mapAliasFile = path.join(distApiDir, './map-alias.js');
      expect(await fs.pathExists(mapAliasFile)).toBeTruthy();
      // ignore
      // const mapAliasContent = (await fs.readFile(mapAliasFile)).toString();
      // expect(mapAliasContent).toMatchSnapshot();
    } finally {
      await fs.remove(tempRoot);
    }
  });

  it('should keep .js suffix for aliased imports in esm output', async () => {
    const { example, tempRoot } = await createIsolatedTsExample();
    const tsconfigPath = path.join(example, './tsconfig.esm.json');
    const distDir = path.join(example, './dist-esm');
    const sharedDir = path.join(example, './shared');
    const apiDir = path.join(example, './api');
    const serverDir = path.join(example, './server');

    try {
      await compile(
        example,
        {
          alias: {
            '@modern-js/runtime/server': path.join(
              sharedDir,
              './runtime/server',
            ),
          },
        } as any,
        {
          sourceDirs: [sharedDir, apiDir, serverDir],
          distDir,
          tsconfigPath,
          moduleType: 'module',
        },
      );

      const api = await loadEsmModule(
        distDir,
        path.join(distDir, './api/index.js'),
      );
      const jsAlias = await loadEsmModule(
        distDir,
        path.join(distDir, './api/js-alias.js'),
      );
      const relative = await loadEsmModule(
        distDir,
        path.join(distDir, './api/relative.js'),
      );

      expect(api.default()).toBe('runtime-shared-api');
      expect(jsAlias.default()).toBe('shared-js-alias');
      expect(relative.default()).toBe('shared-relative');
    } finally {
      await fs.remove(tempRoot);
    }
  });
  it('forces Node-executable emission when app tsconfig resolves to bundler module settings', async () => {
    // Regression: TS-Go v7 resolves unpinned app tsconfigs to
    // module=preserve/moduleResolution=bundler, which used to leak bare
    // `import` statements into the CommonJS server dist (Node then fails on
    // extensionless ESM imports at runtime).
    const { example, tempRoot } = await createIsolatedTsExample();
    const tsconfigPath = path.join(example, './tsconfig.bundler.json');
    const distDir = path.join(example, './dist-bundler');
    const sharedDir = path.join(example, './shared');
    const apiDir = path.join(example, './api');
    const serverDir = path.join(example, './server');

    try {
      await compile(
        example,
        {
          alias: {
            '@modern-js/runtime/server': path.join(
              sharedDir,
              './runtime/server',
            ),
          },
        } as any,
        {
          sourceDirs: [sharedDir, apiDir, serverDir],
          distDir,
          tsconfigPath,
        },
      );

      const api = require(path.join(distDir, './api')).default;
      expect(api()).toEqual('runtime-shared-api');
    } finally {
      await fs.remove(tempRoot);
    }
  });

  it('rewrites emitted server-config aliases before surfacing TS-Go diagnostics', async () => {
    const example = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), 'server-config-alias-')),
    );
    const distDir = path.join(example, 'dist');
    const serverDir = path.join(example, 'server');
    const sharedDir = path.join(example, 'shared');

    await fs.outputJSON(path.join(example, 'tsconfig.json'), {
      compilerOptions: {
        declaration: false,
        module: 'CommonJS',
        moduleResolution: 'Node',
        target: 'ES2019',
        baseUrl: './',
        paths: {
          '@shared/*': ['./shared/*'],
        },
      },
      include: ['server', 'shared'],
    });
    await fs.outputFile(
      path.join(sharedDir, 'repro.ts'),
      `export const value = 'alias test';\n`,
    );
    await fs.outputFile(
      path.join(serverDir, 'modern.server.ts'),
      [
        `import { value } from '@shared/repro';`,
        `const mustBeNumber: number = value;`,
        `export default mustBeNumber;`,
        ``,
      ].join('\n'),
    );

    try {
      await expect(
        compile(example, {} as any, {
          sourceDirs: [serverDir, sharedDir],
          distDir,
          tsconfigPath: path.join(example, 'tsconfig.json'),
          throwErrorInsteadOfExit: true,
        }),
      ).rejects.toThrow(/TS-Go compilation failed/);

      const serverOutput = require(
        path.join(distDir, 'server/modern.server.js'),
      );
      expect(serverOutput.default).toBe('alias test');
    } finally {
      await fs.remove(example);
    }
  });

  it('should resolve tsx directory entries and emit runnable js in esm output', async () => {
    const example = path.join(__dirname, './fixtures', './tsx-example');
    const tsconfigPath = path.join(example, './tsconfig.esm.json');
    const distDir = path.join(example, './dist-esm');
    const sharedDir = path.join(example, './shared');
    const serverDir = path.join(example, './server');

    try {
      // No alias and no tsconfig `paths`: relative specifiers still have to be
      // rewritten for native ESM.
      await compile(example, { alias: {} } as any, {
        sourceDirs: [sharedDir, serverDir],
        distDir,
        tsconfigPath,
        moduleType: 'module',
      });

      const server = await loadEsmModule(
        distDir,
        path.join(distDir, './server/index.js'),
      );
      expect(server.default()).toBe('foo-bar-helper-mjs-legacy-cjs-data-json');

      // `jsx: preserve` would emit `foo/index.jsx`, which Node cannot load.
      expect(
        await fs.pathExists(path.join(distDir, './server/foo/index.js')),
      ).toBeTruthy();
      expect(
        await fs.pathExists(path.join(distDir, './server/foo/index.jsx')),
      ).toBeFalsy();

      // Source files must not be copied next to their compiled output.
      expect(
        await fs.pathExists(path.join(distDir, './server/foo/index.tsx')),
      ).toBeFalsy();
    } finally {
      await fs.remove(distDir);
    }
  });

  it('should keep specifiers that are not compiled to js in esm output', async () => {
    const example = path.join(__dirname, './fixtures', './tsx-example');
    const tsconfigPath = path.join(example, './tsconfig.esm.json');
    const distDir = path.join(example, './dist-esm-assets');
    const sharedDir = path.join(example, './shared');
    const serverDir = path.join(example, './server');

    try {
      await compile(example, { alias: {} } as any, {
        sourceDirs: [sharedDir, serverDir],
        distDir,
        tsconfigPath,
        moduleType: 'module',
      });

      const server = await loadEsmModule(
        distDir,
        path.join(distDir, './server/index.js'),
      );
      expect(server.default()).toBe('foo-bar-helper-mjs-legacy-cjs-data-json');
      await expect(server.loadData()).resolves.toMatchObject({
        default: { name: 'data-json' },
      });
      await expect(server.loadLocaleTemplate('en')).resolves.toMatchObject({
        locale: 'en',
      });
      await expect(server.loadLocaleConcat('en')).resolves.toMatchObject({
        locale: 'en',
      });

      expect(
        await fs.pathExists(path.join(distDir, './shared/data.json')),
      ).toBeTruthy();
      expect(
        await fs.pathExists(path.join(distDir, './server/helper.mjs')),
      ).toBeTruthy();
      expect(
        await fs.pathExists(path.join(distDir, './server/legacy.cjs')),
      ).toBeTruthy();
    } finally {
      await fs.remove(distDir);
    }
  });
});
