import { createRequire } from 'node:module';
import { fs } from '@modern-js/utils';
import os from 'os';
import path from 'path';
import { compile } from '../src/common';
import {
  createResolvedTsgoConfig,
  getTsgoBinPath,
} from '../src/compilers/tsgo';
import { createIsolatedTsExample } from './helpers';

const require = createRequire(import.meta.url);

describe('getTsgoBinPath', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), 'server-utils-tsgo-')),
    );
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  it('prefers the app-local @typescript/native install', async () => {
    const pkgDir = path.join(tmpDir, 'node_modules/@typescript/native');
    await fs.outputJSON(path.join(pkgDir, 'package.json'), {
      name: 'typescript',
      version: '7.0.0-test',
      exports: { './package.json': './package.json' },
      bin: { tsc: './bin/tsc' },
    });
    await fs.outputFile(path.join(pkgDir, 'bin/tsc'), '// stub\n');

    expect(getTsgoBinPath(tmpDir)).toBe(path.join(pkgDir, 'bin/tsc'));
  });

  it('supports app-local @typescript/native-preview installs', async () => {
    const pkgDir = path.join(tmpDir, 'node_modules/@typescript/native-preview');
    await fs.outputJSON(path.join(pkgDir, 'package.json'), {
      name: '@typescript/native-preview',
      version: '0.0.0-test',
      bin: {
        tsgo: './bin/tsgo',
      },
    });
    await fs.outputFile(path.join(pkgDir, 'bin/tsgo'), '// stub\n');

    const binPath = getTsgoBinPath(tmpDir);

    expect(binPath).toBe(path.join(pkgDir, 'bin/tsgo'));
  });

  it('falls back to the dependency tree of @modern-js/server-utils', () => {
    // No app-local install: resolution must still succeed via this package's
    // own module tree (hoisted installs / the workspace devDependency).
    const binPath = getTsgoBinPath(tmpDir);

    expect(binPath).toMatch(/tsgo(?:\.js)?$/);
    expect(fs.existsSync(binPath)).toBe(true);
  });

  it('throws an actionable error when tsgo cannot be resolved anywhere', () => {
    expect(() => getTsgoBinPath(tmpDir, [tmpDir])).toThrow(
      /Please install "@typescript\/native"/,
    );
  });
});

describe('createResolvedTsgoConfig', () => {
  it('bases the resolved config beside the tsconfig, including nested tsconfig paths', async () => {
    const { example, tempRoot } = await createIsolatedTsExample();
    const nestedDir = path.join(example, 'nested');
    const tsconfigPath = path.join(nestedDir, 'tsconfig.json');
    const sourceDirs = [
      path.join(example, 'shared'),
      path.join(example, 'api'),
      path.join(example, 'server'),
    ];

    const { config, resolvedConfigPath } = await createResolvedTsgoConfig(
      example,
      tsconfigPath,
      sourceDirs,
      getTsgoBinPath(example),
    );

    try {
      // The temp config lives beside the tsconfig so the relative `files`
      // emitted by --showConfig keep their base directory.
      expect(path.dirname(resolvedConfigPath)).toBe(nestedDir);
      expect(await fs.pathExists(resolvedConfigPath)).toBe(true);

      // `files` are relative to the tsconfig directory and must survive the
      // source-dir filtering even when the tsconfig sits in a subdirectory.
      const resolvedFiles = (config.files ?? []).map(file =>
        path.resolve(nestedDir, file),
      );
      expect(resolvedFiles).toContain(path.join(example, 'api/index.ts'));
      expect(resolvedFiles).toContain(path.join(example, 'shared/index.ts'));
      expect(resolvedFiles).toContain(path.join(example, 'server/index.ts'));
    } finally {
      await fs.remove(tempRoot);
    }
  });

  it.each([
    { name: 'missing', excludeFiles: undefined },
    { name: 'empty', excludeFiles: [] },
  ])(
    'retains declaration roots with $name exclusions',
    async ({ excludeFiles }) => {
      const { example, tempRoot } = await createIsolatedTsExample();
      const tsconfigPath = path.join(example, 'tsconfig.json');
      const declaration = path.join(example, 'src/client/register.gen.d.ts');

      try {
        await fs.outputFile(declaration, 'export interface Client {}\n');
        const { config } = await createResolvedTsgoConfig(
          example,
          tsconfigPath,
          [path.join(example, 'api')],
          getTsgoBinPath(example),
          excludeFiles,
        );
        const resolvedFiles = (config.files ?? []).map(file =>
          path.resolve(example, file),
        );
        expect(resolvedFiles).toContain(declaration);
        expect(resolvedFiles).toContain(
          path.join(example, 'modern-app-env.d.ts'),
        );
        expect(resolvedFiles).toContain(path.join(example, 'api/index.ts'));
      } finally {
        await fs.remove(tempRoot);
      }
    },
  );

  it('excludes only exact root paths when the tsconfig is nested', async () => {
    const { example, tempRoot } = await createIsolatedTsExample();
    const tsconfigDir = path.join(example, 'nested');
    const excluded = path.join(example, 'src/client/register.gen.d.ts');
    const neighbors = [
      path.join(example, 'src/client/register-extra.gen.d.ts'),
      path.join(example, 'src/another-client/register.gen.d.ts'),
    ];
    try {
      for (const file of [excluded, ...neighbors]) {
        await fs.outputFile(file, 'export interface Client {}\n');
      }
      const { config } = await createResolvedTsgoConfig(
        example,
        path.join(tsconfigDir, 'tsconfig.json'),
        [path.join(example, 'api'), path.join(example, 'shared')],
        getTsgoBinPath(example),
        [excluded],
      );
      const resolvedFiles = (config.files ?? []).map(file =>
        path.resolve(tsconfigDir, file),
      );
      expect(resolvedFiles).not.toContain(excluded);
      for (const file of neighbors) expect(resolvedFiles).toContain(file);
      expect(resolvedFiles).toContain(path.join(example, 'api/index.ts'));
      expect(resolvedFiles).toContain(path.join(example, 'shared/index.ts'));
      expect(resolvedFiles).toContain(
        path.join(example, 'modern-app-env.d.ts'),
      );
    } finally {
      await fs.remove(tempRoot);
    }
  });

  it('emits executable output for concurrent consumers with app build flags', async () => {
    const { example, tempRoot } = await createIsolatedTsExample(
      'server-utils-tsgo-consumer-',
    );
    const consumerDir = path.join(example, 'consumer');
    const tsconfigPath = path.join(example, 'tsconfig.consumer.json');

    await fs.outputFile(
      path.join(consumerDir, 'dependency.ts'),
      'export const value = 41;\n',
    );
    await fs.outputFile(
      path.join(consumerDir, 'entry.ts'),
      "import { value } from './dependency.ts';\nexport default value + 1;\n",
    );
    await fs.outputJSON(tsconfigPath, {
      compilerOptions: {
        allowImportingTsExtensions: true,
        composite: true,
        declaration: true,
        declarationMap: true,
        emitDeclarationOnly: true,
        incremental: true,
        module: 'preserve',
        moduleResolution: 'Bundler',
        noEmit: true,
      },
      include: ['consumer'],
    });

    const build = (distName: string) =>
      compile(example, { alias: {} } as any, {
        sourceDirs: [consumerDir],
        distDir: path.join(example, distName),
        moduleType: 'commonjs',
        throwErrorInsteadOfExit: true,
        tsconfigPath,
      });

    try {
      await Promise.all([build('dist-a'), build('dist-b')]);

      for (const distName of ['dist-a', 'dist-b']) {
        const outputPath = path.join(example, distName, 'consumer/entry.js');
        expect(await fs.pathExists(outputPath)).toBe(true);
        expect(require(outputPath).default).toBe(42);
        await expect(fs.readFile(outputPath, 'utf8')).resolves.toContain(
          './dependency.js',
        );
      }
    } finally {
      await fs.remove(tempRoot);
    }
  });
});
