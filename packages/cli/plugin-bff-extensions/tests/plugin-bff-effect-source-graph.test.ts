import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadEffectSourceModule } from '../src/effect-source-loader/loader';

const writeFile = async (filename: string, source: string) => {
  await fs.promises.mkdir(path.dirname(filename), { recursive: true });
  await fs.promises.writeFile(filename, source);
};

const writeTsconfig = (appDir: string, compilerOptions: object = {}) =>
  writeFile(
    path.join(appDir, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        module: 'ESNext',
        moduleResolution: 'Bundler',
        paths: {},
        ...compilerOptions,
      },
    }),
  );

const symlinkDir = async (target: string, linkPath: string) => {
  await fs.promises.mkdir(path.dirname(linkPath), { recursive: true });
  await fs.promises.symlink(
    target,
    linkPath,
    process.platform === 'win32' ? 'junction' : 'dir',
  );
};

const writeEsmPackage = async (dir: string, name: string, index: string) => {
  await writeFile(
    path.join(dir, 'package.json'),
    JSON.stringify({ name, type: 'module', exports: './index.js' }),
  );
  await writeFile(path.join(dir, 'index.js'), index);
};

describe('Effect source graph loading', () => {
  test('resolves the most specific TypeScript path alias, not the broader prefix', async () => {
    const appDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'modern-plugin-bff-effect-alias-'),
    );

    try {
      const entryFile = path.join(appDir, 'api', 'index.ts');
      const specificFile = path.join(appDir, 'specific', 'value.ts');
      const broadFile = path.join(appDir, 'fallback', 'specific', 'value.ts');
      await writeTsconfig(appDir, {
        baseUrl: '.',
        paths: { '@/*': ['fallback/*'], '@/specific/*': ['specific/*'] },
      });
      await writeFile(broadFile, `export const selected = 'broad-alias';`);
      await writeFile(
        specificFile,
        `export const selected = 'specific-alias';`,
      );
      await writeFile(
        entryFile,
        `export { selected } from '@/specific/value';`,
      );

      const dependencies: string[] = [];
      const loaded = (await loadEffectSourceModule({
        appDir,
        resourcePath: entryFile,
        onDependency: dependency => dependencies.push(dependency),
      })) as { selected: string };

      expect(loaded.selected).toBe('specific-alias');
      expect(dependencies).not.toContain(broadFile);
    } finally {
      await fs.promises.rm(appDir, { recursive: true, force: true });
    }
  });

  test('keeps workspace-owned transitive dependencies executable after relocating the entry', async () => {
    const fixtureDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'modern-plugin-bff-effect-workspace-dependency-'),
    );
    const appDir = path.join(fixtureDir, 'app');
    const workspacePackageDir = path.join(fixtureDir, 'workspace-package');

    try {
      await writeTsconfig(appDir);
      await writeEsmPackage(
        workspacePackageDir,
        'workspace-package',
        `import { suffix } from 'workspace-transitive-dependency';
export const message = \`workspace-\${suffix}\`;`,
      );
      await writeEsmPackage(
        path.join(
          workspacePackageDir,
          'node_modules',
          'workspace-transitive-dependency',
        ),
        'workspace-transitive-dependency',
        `export const suffix = 'dependency';`,
      );
      await symlinkDir(
        workspacePackageDir,
        path.join(appDir, 'node_modules', 'workspace-package'),
      );

      const entryFile = path.join(appDir, 'api', 'index.ts');
      await writeFile(
        entryFile,
        `export { message } from 'workspace-package';`,
      );

      const loaded = (await loadEffectSourceModule({
        appDir,
        resourcePath: entryFile,
      })) as { message: string };

      expect(loaded.message).toBe('workspace-dependency');
    } finally {
      await fs.promises.rm(fixtureDir, { recursive: true, force: true });
    }
  });
});
