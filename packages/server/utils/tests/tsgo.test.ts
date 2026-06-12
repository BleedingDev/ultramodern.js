import { fs } from '@modern-js/utils';
import os from 'os';
import path from 'path';
import {
  createResolvedTsgoConfig,
  getTsgoBinPath,
} from '../src/compilers/typescript';

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
    });
    await fs.outputFile(path.join(pkgDir, 'bin/tsgo.js'), '// stub\n');

    const binPath = getTsgoBinPath(tmpDir);

    expect(binPath).toBe(path.join(pkgDir, 'bin/tsgo.js'));
  });

  it('falls back to the dependency tree of @modern-js/server-utils', () => {
    // No app-local install: resolution must still succeed via this package's
    // own module tree (hoisted installs / the workspace devDependency).
    const binPath = getTsgoBinPath(tmpDir);

    expect(binPath).toMatch(/tsgo\.js$/);
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
    const example = path.join(__dirname, './fixtures', './ts-example');
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
      await fs.remove(resolvedConfigPath);
    }
  });

  it('uses unique file names for concurrent compiles in one process', async () => {
    const example = path.join(__dirname, './fixtures', './ts-example');
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
      await fs.remove(first.resolvedConfigPath);
      await fs.remove(second.resolvedConfigPath);
    }
  });
});
