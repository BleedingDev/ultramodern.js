import { fs } from '@modern-js/utils';
import os from 'os';
import path from 'path';
import {
  createResolvedTsgoConfig,
  getTsgoBinPath,
} from '../src/compilers/typescript';
import { createIsolatedTsExample } from './helpers';

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

  it('prefers the app-local @typescript/native-preview install', async () => {
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

  it('supports older native-preview installs with bin/tsgo.js', async () => {
    const pkgDir = path.join(tmpDir, 'node_modules/@typescript/native-preview');
    await fs.outputJSON(path.join(pkgDir, 'package.json'), {
      name: '@typescript/native-preview',
      version: '0.0.0-test',
    });
    await fs.outputFile(path.join(pkgDir, 'bin/tsgo.js'), '// stub\n');

    const binPath = getTsgoBinPath(tmpDir);

    expect(binPath).toBe(path.join(pkgDir, 'bin/tsgo.js'));
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
      /Please install "@typescript\/native-preview"/,
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
      path.join(example, 'dist-nested'),
      sourceDirs,
      undefined,
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

  it('filters app-side generated declarations out of BFF server compiles', async () => {
    const { example, tempRoot } = await createIsolatedTsExample();
    const tsconfigPath = path.join(example, 'tsconfig.json');
    const sourceDirs = [
      path.join(example, 'api'),
      path.join(example, 'shared'),
    ];

    await fs.outputFile(
      path.join(example, 'src/modern-tanstack/register.gen.d.ts'),
      "import type { router } from './index/router.gen';\nexport type RegisteredRouter = typeof router;\n",
    );
    await fs.outputFile(
      path.join(example, 'src/modern-tanstack/index/router.gen.ts'),
      "import page from '../../routes/page';\nexport const router = { page };\n",
    );
    await fs.outputFile(
      path.join(example, 'src/routes/page.tsx'),
      'export default function Page() { return null; }\n',
    );

    const { config, resolvedConfigPath } = await createResolvedTsgoConfig(
      example,
      tsconfigPath,
      path.join(example, 'dist-bff'),
      sourceDirs,
      undefined,
      getTsgoBinPath(example),
    );

    try {
      const resolvedFiles = (config.files ?? []).map(file =>
        path.resolve(example, file),
      );
      expect(resolvedFiles).toContain(path.join(example, 'api/index.ts'));
      expect(resolvedFiles).toContain(path.join(example, 'shared/index.ts'));
      expect(resolvedFiles).toContain(
        path.join(example, 'modern-app-env.d.ts'),
      );
      expect(resolvedFiles).not.toContain(
        path.join(example, 'src/modern-tanstack/register.gen.d.ts'),
      );
      expect(resolvedFiles).not.toContain(
        path.join(example, 'src/modern-tanstack/index/router.gen.ts'),
      );
    } finally {
      await fs.remove(resolvedConfigPath);
      await fs.remove(tempRoot);
    }
  });

  it('uses unique file names for concurrent compiles in one process', async () => {
    const { example, tempRoot } = await createIsolatedTsExample();
    const tsconfigPath = path.join(example, 'tsconfig.json');
    const sourceDirs = [path.join(example, 'api')];
    const binPath = getTsgoBinPath(example);

    const [first, second] = await Promise.all([
      createResolvedTsgoConfig(
        example,
        tsconfigPath,
        path.join(example, 'dist-a'),
        sourceDirs,
        undefined,
        binPath,
      ),
      createResolvedTsgoConfig(
        example,
        tsconfigPath,
        path.join(example, 'dist-b'),
        sourceDirs,
        undefined,
        binPath,
      ),
    ]);

    try {
      expect(first.resolvedConfigPath).not.toBe(second.resolvedConfigPath);
    } finally {
      await fs.remove(tempRoot);
    }
  });

  it('forces emit even when app tsconfig sets noEmit', async () => {
    const { example, tempRoot } = await createIsolatedTsExample();
    const tsconfigPath = path.join(example, 'tsconfig.noemit.json');
    const sourceDirs = [path.join(example, 'api')];

    const { config, resolvedConfigPath } = await createResolvedTsgoConfig(
      example,
      tsconfigPath,
      path.join(example, 'dist-noemit'),
      sourceDirs,
      undefined,
      getTsgoBinPath(example),
    );

    try {
      expect(config.compilerOptions?.noEmit).toBe(false);
      await expect(fs.readJSON(resolvedConfigPath)).resolves.toMatchObject({
        compilerOptions: {
          noEmit: false,
        },
      });
    } finally {
      await fs.remove(tempRoot);
    }
  });

  it('disables composite project settings but keeps declaration emit', async () => {
    const { example, tempRoot } = await createIsolatedTsExample();
    const tsconfigPath = path.join(example, 'tsconfig.composite.json');
    const sourceDirs = [
      path.join(example, 'api'),
      path.join(example, 'shared'),
    ];

    await fs.outputJSON(tsconfigPath, {
      extends: './tsconfig.json',
      compilerOptions: {
        composite: true,
        declaration: true,
        declarationMap: true,
        emitDeclarationOnly: true,
        incremental: true,
        noEmit: false,
        tsBuildInfoFile: './node_modules/.cache/app.tsbuildinfo',
      },
      include: ['api', 'shared', 'modern-app-env.d.ts'],
      references: [{ path: '../shared-contracts' }],
    });

    const { config, resolvedConfigPath } = await createResolvedTsgoConfig(
      example,
      tsconfigPath,
      path.join(example, 'dist-composite'),
      sourceDirs,
      undefined,
      getTsgoBinPath(example),
    );

    try {
      // `declaration` is the app's decision: crossProject BFF apps publish
      // handler declarations and the generated client facades re-export them,
      // so a resolved `declaration: true` must survive. Only the
      // project-build-shaped options are normalized away, and the emit stays a
      // one-shot JS emit (`emitDeclarationOnly: false`).
      expect(config.compilerOptions).toMatchObject({
        composite: false,
        declaration: true,
        declarationMap: false,
        emitDeclarationOnly: false,
        incremental: false,
        noEmit: false,
      });
      expect(config.compilerOptions).not.toHaveProperty('tsBuildInfoFile');
      expect(config).not.toHaveProperty('references');
      await expect(fs.readJSON(resolvedConfigPath)).resolves.toMatchObject({
        compilerOptions: {
          composite: false,
          declaration: true,
          declarationMap: false,
          emitDeclarationOnly: false,
          incremental: false,
          noEmit: false,
        },
      });
      await expect(fs.readJSON(resolvedConfigPath)).resolves.not.toHaveProperty(
        'references',
      );
    } finally {
      await fs.remove(resolvedConfigPath);
      await fs.remove(tempRoot);
    }
  });

  it('keeps allowImportingTsExtensions valid when forcing emit', async () => {
    const { example, tempRoot } = await createIsolatedTsExample();
    const tsconfigPath = path.join(example, 'tsconfig.allow-importing-ts.json');
    const sourceDirs = [path.join(example, 'api')];

    await fs.outputJSON(tsconfigPath, {
      compilerOptions: {
        allowImportingTsExtensions: true,
        module: 'preserve',
        moduleResolution: 'Bundler',
        noEmit: true,
        target: 'ESNext',
      },
      files: ['api/index.ts'],
    });

    const { config, resolvedConfigPath } = await createResolvedTsgoConfig(
      example,
      tsconfigPath,
      path.join(example, 'dist-allow-importing-ts'),
      sourceDirs,
      'module',
      getTsgoBinPath(example),
    );

    try {
      expect(config.compilerOptions?.allowImportingTsExtensions).toBe(true);
      expect(config.compilerOptions?.noEmit).toBe(false);
      expect(config.compilerOptions?.rewriteRelativeImportExtensions).toBe(
        true,
      );
      await expect(fs.readJSON(resolvedConfigPath)).resolves.toMatchObject({
        compilerOptions: {
          allowImportingTsExtensions: true,
          noEmit: false,
          rewriteRelativeImportExtensions: true,
        },
      });
    } finally {
      await fs.remove(resolvedConfigPath);
      await fs.remove(tempRoot);
    }
  });
});
