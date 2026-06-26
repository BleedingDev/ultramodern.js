import { fs } from '@modern-js/utils';
import os from 'os';
import path from 'path';
import { compile } from '../src';
import { createIsolatedTsExample } from './helpers';

describe('typescript', () => {
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

      const apiContent = await fs.readFile(
        path.join(distDir, './api/index.js'),
      );
      const jsAliasContent = await fs.readFile(
        path.join(distDir, './api/js-alias.js'),
      );
      const relativeContent = await fs.readFile(
        path.join(distDir, './api/relative.js'),
      );

      expect(apiContent.toString()).toMatch(
        /from ['"]\.\.\/shared\/index\.js['"]/,
      );
      expect(jsAliasContent.toString()).toMatch(
        /from ['"]\.\.\/shared\/index\.js['"]/,
      );
      expect(relativeContent.toString()).toMatch(
        /from ['"]\.\.\/shared\/index\.js['"]/,
      );
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

      const apiContent = (
        await fs.readFile(path.join(distDir, './api/index.js'))
      ).toString();
      expect(apiContent).not.toMatch(/^import /m);

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

      const serverOutput = await fs.readFile(
        path.join(distDir, 'server/modern.server.js'),
        'utf8',
      );

      expect(serverOutput).not.toContain('@shared/repro');
      expect(serverOutput).toContain('require("../shared/repro")');
    } finally {
      await fs.remove(example);
    }
  });
});
